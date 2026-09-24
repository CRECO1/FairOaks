// Strip an e-sign/zipForm overlay off a flattened PDF, leaving the blank form.
//
// dotloop, zipForm and DocuSign all "flatten" a filled form by APPENDING a
// content stream to the page: for each value they paint a white rectangle over
// the blank, draw the text, then redraw the underline. The original blank is
// still there, untouched, as an earlier stream in the page's /Contents array —
// so dropping the appended stream(s) gives back the pristine form.
//
//   node --experimental-modules clean_pdf.mjs <in.pdf> <out.pdf> [--keep 0,1]
//
// --keep  indexes (into /Contents) of the streams to KEEP. Default: all but the
//         last. Run with --inspect first to see what each stream contains.
//
// Also removed: /Annots (signature + verification links), /AcroForm, the XMP
// metadata and document info, and any /XObject the surviving streams don't draw
// — otherwise the signature images stay in the file even though nothing paints
// them. Orphaned objects are dropped on save because pdf-lib only serialises
// what is reachable; verify_clean.mjs re-checks the output bytes regardless.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, PDFStream } from 'pdf-lib';
import { inflateSync } from 'node:zlib';

const [inPath, outPath, ...rest] = process.argv.slice(2);
if (!inPath) { console.error('usage: clean_pdf.mjs <in.pdf> <out.pdf> [--keep 0,1] [--inspect]'); process.exit(1); }
const inspect = rest.includes('--inspect');
const keepArg = rest.includes('--keep') ? rest[rest.indexOf('--keep') + 1] : null;

const decode = (stream) => {
  const bytes = stream instanceof PDFRawStream ? stream.asUint8Array() : stream.getContents();
  try { return inflateSync(Buffer.from(bytes)).toString('latin1'); } catch { return Buffer.from(bytes).toString('latin1'); }
};

const pdf = await PDFDocument.load(readFileSync(inPath), { updateMetadata: false });
const page = pdf.getPages()[0];
const node = page.node;

// Only page 1 is processed. /Contents, /Annots and /XObject are per-page, so on a
// multi-page form every later page keeps BOTH its flattening overlay AND its
// signature widgets — the catalog-level deletions below do not reach them. That
// leaves the signer's trail in the file the header claims to remove it from.
if (pdf.getPageCount() > 1) {
  console.warn(
    `⚠ ${pdf.getPageCount()} pages, but only page 1 is cleaned.\n` +
    `  Pages 2-${pdf.getPageCount()} keep their overlay and their /Annots (signature widgets,\n` +
    `  verification links). Check them before publishing this form.`
  );
}

// /Contents is either one stream or an array of them.
const contents = node.get(PDFName.of('Contents'));
const refs = contents instanceof PDFArray ? contents.asArray() : [node.get(PDFName.of('Contents'))];

if (inspect) {
  refs.forEach((ref, i) => {
    const text = decode(pdf.context.lookup(ref));
    const drawn = [...text.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)].map((m) => m[0].slice(1, -3).trim());
    console.log(`\n── /Contents[${i}] ${ref} — ${text.length} bytes, ${drawn.length} drawn strings`);
    console.log(drawn.slice(0, 40).map((s) => `     ${s}`).join('\n'));
  });
  process.exit(0);
}

// How much text a stream draws, in BOTH of PDF's string forms. TREC forms are
// CID-encoded and draw hex strings — <03ED> — so counting only parenthesised
// strings scores a full form at zero.
const glyphCount = (text) => {
  let n = 0;
  for (const m of text.matchAll(/\((?:\\.|[^\\()])*\)/g)) n += Math.max(m[0].length - 2, 0);
  for (const m of text.matchAll(/<([0-9A-Fa-f\s]+)>/g)) n += Math.floor(m[1].replace(/\s/g, '').length / 2);
  return n;
};

const weights = refs.map((r) => glyphCount(decode(pdf.context.lookup(r))));

const keep = keepArg ? keepArg.split(',').map(Number) : refs.map((_, i) => i).slice(0, -1);
const kept = refs.filter((_, i) => keep.includes(i));
if (!kept.length) throw new Error('--keep selected no streams');

// The default ("all but the last") assumes the blank form comes first and the
// overlay last. That is not universal — the README's own worked example is
// `--keep 1`, the SECOND of two — and when the order is reversed the default
// keeps the overlay and deletes the form. The output still opens, still carries
// the letterhead, logos and the flattened values with their underlines, and is
// simply missing the form. Nothing downstream noticed, so a form was published
// blank and stayed that way.
//
// So: never silently keep less text than is thrown away.
const keptGlyphs = weights.filter((_, i) => keep.includes(i)).reduce((a, b) => a + b, 0);
const dropGlyphs = weights.filter((_, i) => !keep.includes(i)).reduce((a, b) => a + b, 0);
if (dropGlyphs > keptGlyphs) {
  const detail = weights.map((w, i) => `  /Contents[${i}] ${w} glyphs ${keep.includes(i) ? '(KEEP)' : '(drop)'}`).join('\n');
  throw new Error(
    `Refusing to write: the dropped streams draw MORE text (${dropGlyphs}) than the kept ones (${keptGlyphs}).\n` +
    `This is what stripping the form instead of the overlay looks like.\n${detail}\n` +
    `Run with --inspect, then pass --keep with the stream holding the blank form.`
  );
}
if (!keepArg) {
  console.warn(`⚠ No --keep given; defaulted to [${keep.join(',')}] of ${refs.length} stream(s). Verify against --inspect.`);
}

const keptText = kept.map((r) => decode(pdf.context.lookup(r))).join('\n');
const keptArray = PDFArray.withContext(pdf.context);
kept.forEach((r) => keptArray.push(r));
node.set(PDFName.of('Contents'), keptArray);

// Drop every XObject the surviving streams never draw (signature images etc.).
const xobjects = node.get(PDFName.of('Resources'))?.get?.(PDFName.of('XObject'));
let droppedX = 0;
if (xobjects?.keys) {
  for (const key of [...xobjects.keys()]) {
    if (!new RegExp(`/${key.asString().slice(1)}\\s+Do`).test(keptText)) { xobjects.delete(key); droppedX++; }
  }
}

const annots = node.get(PDFName.of('Annots'));
const droppedAnnots = annots instanceof PDFArray ? annots.size() : annots ? 1 : 0;
node.delete(PDFName.of('Annots'));
pdf.catalog.delete(PDFName.of('AcroForm'));
pdf.catalog.delete(PDFName.of('Metadata'));      // XMP — carries the signer trail
// The tagged-PDF structure tree keeps the signature widget, its PKCS7 blob and
// the verification /URI actions REACHABLE — without this they survive the save
// and a plain qpdf pass, because they are not orphans yet.
pdf.catalog.delete(PDFName.of('StructTreeRoot'));
pdf.catalog.delete(PDFName.of('MarkInfo'));
pdf.catalog.delete(PDFName.of('Perms'));
pdf.catalog.delete(PDFName.of('Names'));
pdf.catalog.delete(PDFName.of('Outlines'));
node.delete(PDFName.of('StructParents'));
for (const setter of ['setTitle', 'setAuthor', 'setSubject', 'setProducer', 'setCreator']) pdf[setter]('');
pdf.setKeywords([]);

writeFileSync(outPath, await pdf.save({ useObjectStreams: false }));
// pdf-lib serialises its whole object table, reachable or not. qpdf rewrites
// from the trailer down, so this pass is what actually DELETES the now-orphaned
// signature and overlay objects from the file bytes.
try {
  execFileSync('qpdf', ['--object-streams=disable', '--replace-input', outPath]);
} catch (e) {
  console.warn('⚠ qpdf pass failed — orphaned objects may remain in the bytes:', e.message);
}
console.log(`✓ ${outPath}`);
console.log(`  kept /Contents[${keep.join(',')}] of ${refs.length}, dropped ${droppedAnnots} annots, ${droppedX} unused XObjects`);
