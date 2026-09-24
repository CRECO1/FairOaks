// Publish a blank form PDF + its fill-once field map to the live CRM library.
//   1. upsert the PDF into the `transaction-forms` storage bucket
//   2. upsert the `crm_forms` row (matched on business_unit + name)
//   3. replace that form's `crm_form_fields` from the field map
// Idempotent — safe to re-run after re-cleaning the PDF or editing the fields.
//
//   node --env-file=.env.local scripts/forms/ingest/publish_form.mjs <config.json>
//
// config.json: { name, form_code, category, business_unit, pdf, fields, storage_path }
//   `pdf` and `fields` are paths relative to the config file.
//
// Generalised from scripts/forms/loi_purchase/publish.js so every future TXR /
// TREC import uses one publisher instead of a per-form copy.
// .mjs, not .js — the repo root package.json is "type":"module", so a CommonJS
// require() here dies with "require is not defined in ES module scope".
import fs from 'node:fs';
import path from 'node:path';
import { analysePdf, describePages } from './lib/verify_pdf.mjs';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const cfgPath = process.argv[2];
if (!cfgPath) { console.error('usage: publish_form.mjs <config.json>'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const rel = (p) => path.resolve(path.dirname(cfgPath), p);
const BUCKET = 'transaction-forms';

const h = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, ...extra });
async function rest(p, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${p}`, { ...init, headers: h(init.headers) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${p} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

try {
  const pdf = fs.readFileSync(rel(cfg.pdf));
  const fields = JSON.parse(fs.readFileSync(rel(cfg.fields), 'utf8'));
  const fieldPages = Math.max(...fields.map((f) => f.page));

  // ── Gate: nothing reaches the bucket unverified ────────────────────────────
  // Every form is published through here, so this catches a stripped form whatever
  // produced it — a wrong --keep, a truncated download, a future tool — not just the
  // one failure mode clean_pdf.mjs now guards. A form was once published as its own
  // e-sign overlay with the blank deleted out of it, and stayed that way, because
  // nothing between the cleaner and the bucket ever asked whether a form was still in
  // the file. Now something does.
  const check = await analysePdf(pdf);
  if (check.status === 'ERROR') {
    throw new Error(`Refusing to publish: ${rel(cfg.pdf)} could not be read as a PDF — ${check.detail}`);
  }
  if (check.status === 'DAMAGED') {
    throw new Error(
      `Refusing to publish: page(s) ${check.flagged.join(', ')} of ${cfg.pdf} draw almost no text but carry
` +
      `white-filled rectangles — an e-sign overlay whose blank form has been stripped.
${describePages(check.pages)}
` +
      `Re-clean from the original with an explicit --keep (see README), or pass --allow-suspect if this is genuinely correct.`
    );
  }
  if (check.status === 'REVIEW' && !process.argv.includes('--allow-suspect')) {
    throw new Error(
      `Refusing to publish: page(s) ${check.flagged.join(', ')} of ${cfg.pdf} draw very little text.
${describePages(check.pages)}
` +
      `That is normal for a signature page or an exhibit. Confirm it renders, then re-run with --allow-suspect.`
    );
  }

  // page_count was derived from the FIELD MAP, so it recorded what the fields expected
  // and never what the PDF actually had. A field mapped to a page the PDF does not
  // contain cannot be stamped, and one mapped onto the wrong page stamps a value in the
  // wrong place on a legal document — which looks plausible and is worse than a blank.
  if (fieldPages > check.pageCount) {
    throw new Error(
      `Refusing to publish: the field map references page ${fieldPages}, but ${cfg.pdf} has ` +
      `${check.pageCount} page(s). Fields would stamp onto pages that do not exist.`
    );
  }
  if (fieldPages < check.pageCount) {
    console.warn(`⚠ ${cfg.pdf} has ${check.pageCount} pages; the field map only reaches page ${fieldPages}.`);
  }
  // Record the PDF's real page count, not the field map's high-water mark.
  const pageCount = check.pageCount;
  console.log(`✓ verified: ${check.pageCount} page(s), ${check.pages.map((x) => x.textChars).join('/')} chars per page`);

  const up = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${cfg.storage_path}`, {
    method: 'POST', headers: h({ 'Content-Type': 'application/pdf', 'x-upsert': 'true' }), body: pdf,
  });
  if (!up.ok) throw new Error(`storage upload -> ${up.status} ${await up.text()}`);
  console.log('✓ storage:', cfg.storage_path, `(${pdf.length} bytes)`);

  const form = {
    business_unit: cfg.business_unit, name: cfg.name, form_code: cfg.form_code,
    category: cfg.category, storage_path: cfg.storage_path, page_count: pageCount,
  };
  const existing = await rest(`crm_forms?business_unit=eq.${form.business_unit}&name=eq.${encodeURIComponent(form.name)}&select=id`);
  let formId;
  if (existing.length) {
    formId = existing[0].id;
    await rest(`crm_forms?id=eq.${formId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    console.log('✓ crm_forms updated:', formId);
  } else {
    const ins = await rest('crm_forms', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(form) });
    formId = ins[0].id;
    console.log('✓ crm_forms inserted:', formId);
  }

  await rest(`crm_form_fields?form_id=eq.${formId}`, { method: 'DELETE' });
  const rows = fields.map((f, i) => ({
    form_id: formId, page: f.page, x: f.fx, y: f.fy, w: f.fw, h: 0.022,
    type: f.type, label: f.label, field_key: f.field_key, sort: i,
    default_value: f.default || null,
  }));
  await rest('crm_form_fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) });
  console.log(`✓ crm_form_fields: ${rows.length} (${rows.filter((r) => r.type === 'text').length} text, ${rows.filter((r) => r.type === 'check').length} check), ${pageCount} page(s)`);
  console.log('\nform_id:', formId);
} catch (e) { console.error('ERR', e.message); process.exit(1); }
