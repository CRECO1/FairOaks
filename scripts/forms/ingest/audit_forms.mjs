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

// Count the white boxes a content stream paints over the page.
//
// This was a regex — white fill colour, then `re`, then a fill operator — and it
// missed the defect entirely. `re` is only one of two ways to state a rectangle;
// plenty of producers (pdf-lib, which our own e-sign path uses, among them) emit
// the same box as an explicit path: `0 0 m  0 40 l  500 40 l  500 0 l  h  f`. A
// six-box overlay scored zero, so a damaged form came back REVIEW rather than
// DAMAGED and the non-zero exit never fired. Nothing about that was visible from
// reading the regex; it took drawing a real overlay and watching it pass.
//
// So walk the stream instead: track the fill colour through q/Q the way a viewer
// does, accumulate each path's bounding box, and count the fills that are white
// and big enough to hide something. Small white marks (anti-aliasing slivers,
// punctuation knocked out of a glyph) are not overlays and are skipped.
const FILL_OPS = new Set(['f', 'F', 'f*', 'b', 'b*', 'B', 'B*']);
const PATH_END_OPS = new Set(['n', 'S', 's']);
// A box has to be at least this big, in unscaled user units, to be hiding a form
// line. A page is 612x792, so this is roughly a third of an inch by a sixteenth.
const MIN_FILL_WIDTH = 20;
const MIN_FILL_HEIGHT = 4;

const allEqual = (nums, v) => nums.length > 0 && nums.every((n) => n === v);

function countWhiteFills(text) {
  const token = /\[[^\]]*\]|\((?:\\.|[^\\()])*\)|<[^>]*>|\/[^\s\/\[\]<>(){}]*|[-+]?[0-9.]+|[A-Za-z'"][A-Za-z0-9'"*]*/g;

  let white = false;              // is the current fill colour white?
  const stack = [];               // q/Q graphics state, fill colour only
  let nums = [];                  // operands seen since the last operator
  let box = null;                 // current path's bounding box
  let count = 0;

  const extend = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!box) box = { x0: x, y0: y, x1: x, y1: y };
    else {
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
    }
  };

  for (const m of text.matchAll(token)) {
    const t = m[0];
    const c = t[0];
    if (c === '[' || c === '(' || c === '<' || c === '/') { nums = []; continue; }
    if ((c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.') {
      const n = Number(t);
      if (Number.isFinite(n)) nums.push(n);
      continue;
    }

    switch (t) {
      case 'q': stack.push(white); break;
      case 'Q': white = stack.length ? stack.pop() : false; break;

      // Fill colour. Grey 1, RGB 1 1 1 and CMYK 0 0 0 0 are all white.
      case 'g': white = allEqual(nums, 1); break;
      case 'rg': white = nums.length === 3 && allEqual(nums, 1); break;
      case 'k': white = nums.length === 4 && allEqual(nums, 0); break;
      case 'sc': case 'scn':
        white = nums.length === 4 ? allEqual(nums, 0) : allEqual(nums, 1);
        break;
      // A colourspace change resets the colour to that space's default: black.
      case 'cs': white = false; break;

      // Path construction.
      case 'm': case 'l':
        if (nums.length >= 2) extend(nums[nums.length - 2], nums[nums.length - 1]);
        break;
      case 'c':
        if (nums.length >= 6) for (let i = 0; i < 6; i += 2) extend(nums[i], nums[i + 1]);
        break;
      case 'v': case 'y':
        if (nums.length >= 4) for (let i = 0; i < 4; i += 2) extend(nums[i], nums[i + 1]);
        break;
      case 're':
        if (nums.length >= 4) {
          const [x, y, w, h] = nums.slice(-4);
          extend(x, y); extend(x + w, y + h);
        }
        break;
      case 'h': break;

      default:
        if (FILL_OPS.has(t)) {
          if (white && box &&
              box.x1 - box.x0 >= MIN_FILL_WIDTH &&
              box.y1 - box.y0 >= MIN_FILL_HEIGHT) count++;
          box = null;
        } else if (PATH_END_OPS.has(t)) {
          box = null;
        }
        break;
    }
    nums = [];
  }
  return count;
}

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

  const whiteFills = countWhiteFills(text);

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
      // Every writer sets storage_path and the app types it non-nullable, so a row
      // without one is a broken row, not a missing PDF. Say that, rather than
      // letting storage report a confusing error about an empty object name.
      if (!f.storage_path) throw new Error('row has no storage_path');
      const { data, error: dlErr } = await db.storage.from(BUCKET).download(f.storage_path);
      if (dlErr) throw new Error(dlErr.message);
      return Buffer.from(await data.arrayBuffer());
    },
  }));
}

const dir = opt('--dir');
// Setup problems here are ordinary operator errors — no credentials, no such
// directory, crm_forms unreachable. Report them as a line of text; a stack trace
// buries the one sentence that says what to do about it.
let sources;
try {
  sources = dir ? await listLocal(dir) : await listBucket();
} catch (err) {
  console.error(err?.message ?? String(err));
  process.exit(2);
}

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
