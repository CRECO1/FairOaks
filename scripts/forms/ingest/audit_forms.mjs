// Audit every published transaction form for the "cleaned away the wrong stream" defect.
//
// clean_pdf.mjs strips the e-sign overlay off a flattened PDF by keeping some of the
// page's /Contents streams and dropping the rest. Its default is "keep all but the
// last" — but the ingest README's own worked example is `--keep 1`, i.e. keep the
// SECOND of two. Where the blank form is the last stream, the default therefore keeps
// the overlay and deletes the form. The result still opens, still carries the
// letterhead and logos, and still shows the flattened values and their underlines —
// it is simply missing the form itself. That is invisible to every check we had,
// because nothing ever asserted the output still had a form in it.
//
// This finds those. For each page it counts what is actually drawn:
//
//   textChars   total characters drawn by Tj/TJ. A real blank form page runs to
//               thousands; an overlay-only page has just the filled values.
//   whiteFills  white-filled rectangles — the overlay's way of hiding the blank.
//               Present in quantity only in an overlay.
//
// A page with almost no text AND white fills is an overlay with the form deleted.
// Little text and no white fills is more likely a genuinely sparse page (a signature
// page, an exhibit), so it is reported separately rather than called damage.
//
// Usage:
//   node scripts/forms/ingest/audit_forms.mjs                 # audit the storage bucket
//   node scripts/forms/ingest/audit_forms.mjs --dir ./forms   # audit local PDFs
//   node scripts/forms/ingest/audit_forms.mjs --json          # machine-readable
//
// Bucket mode needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// Exits non-zero when anything is reported DAMAGED, so CI can gate on it.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFArray, PDFRawStream } from 'pdf-lib';

const BUCKET = 'transaction-forms';

// A page drawing fewer characters than this is not a filled-out form page.
const MIN_TEXT_CHARS = 350;
// Enough white boxes to be an overlay hiding a form, not a stray design element.
const MIN_WHITE_FILLS = 3;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const asJson = flag('--json');

const decode = (stream) => {
  if (!stream) return '';
  try {
    const bytes = stream instanceof PDFRawStream ? stream.asUint8Array() : stream.getContents();
    try { return inflateSync(Buffer.from(bytes)).toString('latin1'); }
    catch { return Buffer.from(bytes).toString('latin1'); }
  } catch { return ''; }
};

/** What a single page actually draws. */
function analysePage(pdf, page) {
  const node = page.node;
  const contents = node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const text = refs.map((r) => decode(r && pdf.context.lookup(r))).join('\n');

  // Count every glyph the page draws, in BOTH of PDF's string forms. Real TREC
  // forms are CID-encoded and draw hex strings — <03ED> — not parenthesised ones,
  // so counting only (...) reports zero characters for a perfectly healthy form
  // and flags it as damage. Both forms appear bare inside TJ arrays as well as
  // before Tj/'/", so they are counted wherever they occur rather than only when
  // anchored to an operator.
  let textChars = 0;
  for (const m of text.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
    textChars += Math.max(m[0].length - 2, 0);
  }
  for (const m of text.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
    textChars += Math.floor(m[1].replace(/\s/g, '').length / 2);
  }
  // Text-showing operators, as a second signal independent of encoding.
  const drawnStrings =
    (text.match(/\bTJ\b/g)?.length ?? 0) + (text.match(/\bTj\b/g)?.length ?? 0);

  // White fill followed by a rectangle fill, i.e. painting over the blank.
  let whiteFills = 0;
  const whiteThenRect = /(?:1\s+1\s+1\s+rg|1\s+g)[\s\S]{0,200}?re\s*(?:f|F|f\*)\b/g;
  for (const _ of text.matchAll(whiteThenRect)) whiteFills++;

  return { streams: refs.length, textChars, drawnStrings, whiteFills };
}

function verdictFor(pages) {
  const bad = [];
  const thin = [];
  for (const [i, p] of pages.entries()) {
    if (p.textChars < MIN_TEXT_CHARS && p.whiteFills >= MIN_WHITE_FILLS) bad.push(i + 1);
    else if (p.textChars < MIN_TEXT_CHARS) thin.push(i + 1);
  }
  if (bad.length) return { status: 'DAMAGED', pages: bad };
  if (thin.length) return { status: 'REVIEW', pages: thin };
  return { status: 'OK', pages: [] };
}

async function auditBytes(name, bytes) {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const pages = pdf.getPages().map((p) => analysePage(pdf, p));
    if (!pages.length) return { name, status: 'REVIEW', detail: 'no pages', pages: [] };
    const v = verdictFor(pages);
    return { name, status: v.status, flagged: v.pages, pageCount: pages.length, pages };
  } catch (err) {
    return { name, status: 'ERROR', detail: err?.message ?? String(err), pages: [] };
  }
}

async function listLocal(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extname(entry).toLowerCase() === '.pdf') out.push(full);
    }
  };
  walk(dir);
  return out.map((p) => ({ name: basename(p), load: async () => readFileSync(p) }));
}

async function listBucket() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --dir <path>.');
  }
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(base, key, { auth: { persistSession: false } });

  const { data: forms, error } = await db
    .from('crm_forms')
    .select('id, name, form_code, storage_path, business_unit')
    .order('name');
  if (error) throw new Error(`crm_forms: ${error.message}`);

  return (forms ?? []).map((f) => ({
    name: `${f.name}${f.form_code ? ` (${f.form_code})` : ''}`,
    path: f.storage_path,
    load: async () => {
      const { data, error: dlErr } = await db.storage.from(BUCKET).download(f.storage_path);
      if (dlErr) throw new Error(dlErr.message);
      return Buffer.from(await data.arrayBuffer());
    },
  }));
}

const dir = opt('--dir');
const sources = dir ? await listLocal(dir) : await listBucket();

if (!sources.length) {
  console.error(dir ? `No PDFs under ${dir}` : 'No rows in crm_forms.');
  process.exit(1);
}

const results = [];
for (const src of sources) {
  let bytes;
  try { bytes = await src.load(); }
  catch (err) { results.push({ name: src.name, status: 'ERROR', detail: err.message, pages: [] }); continue; }
  results.push(await auditBytes(src.name, bytes));
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const icon = { OK: '  ok  ', DAMAGED: ' DMG  ', REVIEW: ' ???  ', ERROR: ' ERR  ' };
  for (const r of results) {
    const where = r.flagged?.length ? ` pages ${r.flagged.join(',')}` : '';
    console.log(`${icon[r.status] ?? '  ?   '} ${r.name}${where}${r.detail ? ` — ${r.detail}` : ''}`);
    if (r.status !== 'OK' && r.pages?.length) {
      for (const [i, p] of r.pages.entries()) {
        console.log(`          p${i + 1}: ${p.textChars} chars, ${p.drawnStrings} strings, ${p.whiteFills} white fills, ${p.streams} stream(s)`);
      }
    }
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n${results.length} form(s): ${n('OK')} ok, ${n('DAMAGED')} damaged, ${n('REVIEW')} to review, ${n('ERROR')} unreadable`);
  if (n('DAMAGED')) console.log('\nDamaged forms must be re-ingested from the original PDF; see scripts/forms/ingest/README.md.');
}

process.exit(results.some((r) => r.status === 'DAMAGED') ? 1 : 0);
