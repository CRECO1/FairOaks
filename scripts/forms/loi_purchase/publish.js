// Publish the generated Letter of Intent to Purchase to the live CRM:
//   1. upsert the blank PDF into the `transaction-forms` storage bucket
//   2. upsert the `crm_forms` row (matched on business_unit + name)
//   3. replace that form's `crm_form_fields` rows from fields.json
// Idempotent — safe to re-run after regenerating the PDF.
//
//   NODE_PATH=../../../node_modules node --env-file=../../../.env.local publish.js
const fs = require('fs');

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const NAME = 'Letter of Intent to Purchase';
const BUCKET = 'transaction-forms';
const STORAGE_PATH = 'commercial/loi_purchase.pdf';
const FORM = { business_unit: 'commercial', name: NAME, form_code: 'LOI-PURCHASE', category: 'Letters of Intent', storage_path: STORAGE_PATH };

const h = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, ...extra });
async function rest(path, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: h(init.headers) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

(async () => {
  const pdf = fs.readFileSync(__dirname + '/loi_purchase.pdf');
  const fields = JSON.parse(fs.readFileSync(__dirname + '/fields.json', 'utf8'));
  const pageCount = Math.max(...fields.map(f => f.page));

  // 1 ── storage (upsert)
  const up = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${STORAGE_PATH}`, {
    method: 'POST', headers: h({ 'Content-Type': 'application/pdf', 'x-upsert': 'true' }), body: pdf,
  });
  if (!up.ok) throw new Error(`storage upload -> ${up.status} ${await up.text()}`);
  console.log('✓ storage:', STORAGE_PATH, `(${pdf.length} bytes)`);

  // 2 ── crm_forms row (update in place if this form already exists)
  const q = `crm_forms?business_unit=eq.${FORM.business_unit}&name=eq.${encodeURIComponent(NAME)}&select=id`;
  const existing = await rest(q);
  const body = { ...FORM, page_count: pageCount };
  let formId;
  if (existing.length) {
    formId = existing[0].id;
    await rest(`crm_forms?id=eq.${formId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    console.log('✓ crm_forms updated:', formId);
  } else {
    const ins = await rest('crm_forms', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) });
    formId = ins[0].id;
    console.log('✓ crm_forms inserted:', formId);
  }

  // 3 ── crm_form_fields (replace)
  await rest(`crm_form_fields?form_id=eq.${formId}`, { method: 'DELETE' });
  const rows = fields.map((f, i) => ({
    form_id: formId, page: f.page, x: f.fx, y: f.fy, w: f.fw, h: 0.022,
    type: f.type, label: f.label, field_key: f.field_key, sort: i,
    default_value: f.default || null,
  }));
  await rest('crm_form_fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) });
  console.log(`✓ crm_form_fields: ${rows.length} boxes (${rows.filter(r => r.default_value).length} with defaults), pages ${pageCount}`);
  console.log('\nform_id:', formId);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
