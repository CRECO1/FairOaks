// Remove a third party's stamp from a blank form PDF, on every page.
//
//   node scripts/forms/ingest/strip_stamp.mjs <in.pdf> <out.pdf> --match "Texas Ally|Juston Martinez"
//   …add --dry to list what would go without writing.
//
// Different problem from clean_pdf.mjs. That one drops an appended overlay
// stream, which is how zipForm/dotloop flatten a FILLED form. A forms-portal
// export instead imports the blank as a template XObject (`/TPL1 Do`) and draws
// the brokerage's footer as ordinary text operators in the page stream beside
// it. There is no stream to drop — the stamp and the form share one — so the
// text-drawing operators have to come out individually.
//
// Only whole BT…ET text objects containing a match are removed, so the form
// itself, its rules and its boxes are untouched.
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFRawStream } from 'pdf-lib';
import { inflateSync } from 'node:zlib';

const [inPath, outPath, ...rest] = process.argv.slice(2);
const mIdx = rest.indexOf('--match');
if (!inPath || !outPath || mIdx === -1) {
  console.error('usage: strip_stamp.mjs <in.pdf> <out.pdf> --match "<regex>" [--dry]');
  process.exit(1);
}
const match = new RegExp(rest[mIdx + 1], 'i');
const dry = rest.includes('--dry');

const decode = (s) => {
  const bytes = s instanceof PDFRawStream ? s.asUint8Array() : s.getContents();
  try { return inflateSync(Buffer.from(bytes)).toString('latin1'); } catch { return Buffer.from(bytes).toString('latin1'); }
};

const pdf = await PDFDocument.load(readFileSync(inPath), { updateMetadata: false });
let removed = 0;

pdf.getPages().forEach((page, pageIdx) => {
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const rebuilt = [];
  for (const ref of refs) {
    let text = decode(pdf.context.lookup(ref));
    // A text object is BT … ET. Drop only the ones that draw the stamp.
    text = text.replace(/BT\b[\s\S]*?\bET/g, (block) => {
      const drawn = [...block.matchAll(/\((?:\\.|[^\\)])*\)/g)].map((m) => m[0]).join(' ');
      if (!match.test(drawn)) return block;
      removed++;
      console.log(`  page ${pageIdx + 1}: ${drawn.slice(0, 96)}`);
      return '';
    });
    rebuilt.push(text);
  }
  if (dry) return;
  const stream = pdf.context.flateStream(rebuilt.join('\n'));
  const arr = PDFArray.withContext(pdf.context);
  arr.push(pdf.context.register(stream));
  page.node.set(PDFName.of('Contents'), arr);
});

console.log(`${removed} stamped text object(s)`);
if (dry) process.exit(0);
for (const setter of ['setTitle', 'setAuthor', 'setSubject', 'setProducer', 'setCreator']) pdf[setter]('');
pdf.setKeywords([]);
writeFileSync(outPath, await pdf.save({ useObjectStreams: false }));
console.log(`✓ ${outPath}`);
