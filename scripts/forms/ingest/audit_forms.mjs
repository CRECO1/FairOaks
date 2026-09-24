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
import { analysePdf } from './lib/verify_pdf.mjs';

const BUCKET = 'transaction-forms';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const asJson = flag('--json');

async function auditBytes(name, bytes) {
  const r = await analysePdf(bytes);
  return { name, ...r };
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
