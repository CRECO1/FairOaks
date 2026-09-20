/**
 * Register the agent-onboarding documents as e-signable CRM forms.
 *
 * Run build-onboarding-forms.mjs first: it renders the broker's two .docx
 * files to PDF verbatim and writes generated/blanks.json with the measured
 * position of every fill-in blank. This script uploads the PDFs to the same
 * `transaction-forms` bucket the leases and LOIs live in, creates the
 * crm_forms rows, and places the crm_form_fields — so an onboarding packet
 * goes out through exactly the same envelope flow as a lease.
 *
 * Three forms are created:
 *
 *   1. Independent Contractor Agreement          (2 pages)  — on its own
 *   2. Policies Manual + Acknowledgment          (10 pages) — on its own, for
 *      the annual re-acknowledgment the manual itself requires (§1.1.7)
 *   3. Agent Onboarding Packet                   (12 pages) — 1 and 2 merged,
 *      the single envelope Zack sends to a new agent. The manual is
 *      incorporated by reference into the agreement, so sending them as one
 *      packet means the associate signs having actually been given both.
 *
 * Field roles follow lib/esign.ts, where a placed field binds to the first
 * signer whose role matches:
 *   signer_role null      → the broker fills it in before sending
 *   signer_role 'client'  → the ASSOCIATE fills/signs it
 *   signer_role 'broker'  → ZACK signs it (add himself as a signer, role
 *                           "broker", when composing the envelope)
 *
 * Deliberately NOT pre-filled: the "a Texas ____" entity-type blank and the
 * broker's legal entity name. The documents on file disagree — the real IABS
 * prints "Commercial Real Estate Brokerage, LLC" while other documents say
 * "CRECO LLC" — and guessing the entity type on an executed contract is not
 * something a script should do. Left blank for Zack.
 *
 * Idempotent: re-running replaces the forms' fields and re-uploads the PDFs.
 * Sends nothing.
 *
 * Usage: node scripts/register-onboarding-forms.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');

const GEN = '/Users/creco/Documents/CRECO/Onboarding/generated';
const BUCKET = 'transaction-forms';
const PREFIX = 'commercial/onboarding';
const ZACK = '47668cbf-25c1-480a-baa0-af65fb663dd7';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Supabase env missing'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(pathname, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${pathname}`, {
    ...init,
    headers: { ...H, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function upload(localPath, storagePath) {
  const body = fs.readFileSync(localPath);
  const res = await fetch(`${URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body,
  });
  if (!res.ok) throw new Error(`upload ${storagePath} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return storagePath;
}

// ── Field maps ──────────────────────────────────────────────────────────────
// Index = position in the blank list build-onboarding-forms.mjs produced, which
// is strict document order. Each entry names the blank so the mapping is
// auditable against the printed page.

const ICA_FIELDS = [
  { i: 0,  key: 'effective_date',        label: 'Effective date',                 type: 'text',        role: null },
  { i: 1,  key: 'effective_year',        label: 'Effective year (20__)',          type: 'text',        role: null },
  { i: 2,  key: 'broker_entity_type',    label: 'Broker entity type — CONFIRM WITH ZACK (left blank on purpose)', type: 'text', role: null },
  { i: 3,  key: 'broker_trec_license',   label: 'Broker — TREC License No.',      type: 'text',        role: null, value: '9014367' },
  { i: 4,  key: 'associate_name',        label: 'Associate — full name',          type: 'text',        role: 'client' },
  { i: 5,  key: 'associate_trec_license',label: 'Associate — TREC License No.',   type: 'text',        role: 'client' },
  { i: 6,  key: 'associate_address',     label: 'Associate — address',            type: 'text',        role: 'client' },
  { i: 7,  key: 'broker_signature',      label: 'Broker — signature',             type: 'signature',   role: 'broker' },
  { i: 8,  key: 'broker_sign_date',      label: 'Broker — date signed',           type: 'date_signed', role: 'broker' },
  { i: 9,  key: 'broker_name_title',     label: 'Broker — name / title',          type: 'text',        role: null, value: 'Zachary A. Stovall, Designated Broker' },
  { i: 10, key: 'associate_signature',   label: 'Associate — signature',          type: 'signature',   role: 'client' },
  { i: 11, key: 'associate_sign_date',   label: 'Associate — date signed',        type: 'date_signed', role: 'client' },
  { i: 12, key: 'associate_name_license',label: 'Associate — name / license no.', type: 'text',        role: 'client' },
];

const MANUAL_FIELDS = [
  { i: 0, key: 'ack_signature',     label: 'Associate — signature (acknowledgment)', type: 'signature',   role: 'client' },
  { i: 1, key: 'ack_date',          label: 'Associate — date signed',                type: 'date_signed', role: 'client' },
  { i: 2, key: 'ack_printed_name',  label: 'Associate — printed name',               type: 'text',        role: 'client' },
  { i: 3, key: 'ack_trec_license',  label: 'Associate — TREC License No.',           type: 'text',        role: 'client' },
  { i: 4, key: 'ack_received_by',   label: 'Received for CRECO by — broker signature', type: 'signature', role: 'broker' },
  { i: 5, key: 'ack_received_date', label: 'Received for CRECO — date',              type: 'date_signed', role: 'broker' },
];

const FIELD_H = 0.022;   // same box height the existing templates use

function buildFieldRows(formId, blanks, spec, pageOffset = 0) {
  return spec.map((f, sort) => {
    const b = blanks[f.i];
    if (!b) throw new Error(`blank #${f.i} (${f.key}) missing — re-run build-onboarding-forms.mjs`);
    return {
      form_id: formId,
      page: b.page + pageOffset,
      x: Number(b.x.toFixed(6)),
      y: Number(b.y.toFixed(6)),
      w: Number(b.w.toFixed(6)),
      h: FIELD_H,
      type: f.type,
      signer_role: f.role,
      field_key: f.key,
      label: f.label,
      default_value: f.value ?? null,
      sort,
    };
  });
}

async function upsertForm({ name, category, formCode, storagePath, pageCount }) {
  const existing = await rest(`crm_forms?select=id&name=eq.${encodeURIComponent(name)}`);
  if (existing.length) {
    const id = existing[0].id;
    await rest(`crm_forms?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ category, form_code: formCode, storage_path: storagePath, page_count: pageCount, updated_at: new Date().toISOString() }),
    });
    await rest(`crm_form_fields?form_id=eq.${id}`, { method: 'DELETE' });
    return { id, created: false };
  }
  const [row] = await rest('crm_forms', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      name, category, form_code: formCode, storage_path: storagePath,
      page_count: pageCount, business_unit: 'commercial', created_by: ZACK, pinned: true,
    }]),
  });
  return { id: row.id, created: true };
}

// ── Build the merged packet ─────────────────────────────────────────────────

const icaPath = path.join(GEN, 'CRECO_Independent_Contractor_Agreement.pdf');
const manPath = path.join(GEN, 'CRECO_Brokerage_Policies_and_Procedures_Manual.pdf');
const blanks = JSON.parse(fs.readFileSync(path.join(GEN, 'blanks.json'), 'utf8'));

const icaDoc = await PDFDocument.load(fs.readFileSync(icaPath));
const manDoc = await PDFDocument.load(fs.readFileSync(manPath));
const icaPages = icaDoc.getPageCount();
const manPages = manDoc.getPageCount();

const packet = await PDFDocument.create();
for (const p of await packet.copyPages(icaDoc, icaDoc.getPageIndices())) packet.addPage(p);
for (const p of await packet.copyPages(manDoc, manDoc.getPageIndices())) packet.addPage(p);
packet.setTitle('CRECO Agent Onboarding Packet');
packet.setAuthor('CRECO, Commercial Real Estate Company');
packet.setSubject('Independent Contractor Agreement + Brokerage Policies and Procedures Manual (verbatim)');
const packetPath = path.join(GEN, 'CRECO_Agent_Onboarding_Packet.pdf');
fs.writeFileSync(packetPath, await packet.save());
console.log(`packet: ${icaPages} + ${manPages} = ${packet.getPageCount()} pages → ${packetPath}`);

// ── Upload + register ───────────────────────────────────────────────────────

const uploads = [
  [icaPath, `${PREFIX}/creco_independent_contractor_agreement.pdf`],
  [manPath, `${PREFIX}/creco_brokerage_policies_manual.pdf`],
  [packetPath, `${PREFIX}/creco_agent_onboarding_packet.pdf`],
];
for (const [local, remote] of uploads) {
  await upload(local, remote);
  console.log(`uploaded → ${BUCKET}/${remote}`);
}

const forms = [
  {
    name: 'Independent Contractor Agreement',
    category: 'Agent Onboarding',
    formCode: 'CRECO-ICA',
    storagePath: uploads[0][1],
    pageCount: icaPages,
    rows: (id) => buildFieldRows(id, blanks.ica, ICA_FIELDS),
  },
  {
    name: 'Brokerage Policies and Procedures Manual — Acknowledgment',
    category: 'Agent Onboarding',
    formCode: 'CRECO-POL',
    storagePath: uploads[1][1],
    pageCount: manPages,
    rows: (id) => buildFieldRows(id, blanks.manual, MANUAL_FIELDS),
  },
  {
    name: 'Agent Onboarding Packet — IC Agreement + Policies Manual',
    category: 'Agent Onboarding',
    formCode: 'CRECO-ONBOARD',
    storagePath: uploads[2][1],
    pageCount: packet.getPageCount(),
    // The manual's pages sit after the agreement's in the packet, so its
    // field pages shift by the agreement's page count.
    rows: (id) => [
      ...buildFieldRows(id, blanks.ica, ICA_FIELDS),
      ...buildFieldRows(id, blanks.manual, MANUAL_FIELDS, icaPages),
    ],
  },
];

for (const f of forms) {
  const { id, created } = await upsertForm(f);
  // Re-index sort across the whole form: the packet concatenates two field
  // groups that each start at 0, and sort drives the signer's tab order.
  const rows = f.rows(id).map((r, i) => ({ ...r, sort: i }));
  await rest('crm_form_fields', { method: 'POST', body: JSON.stringify(rows) });
  console.log(`${created ? 'created' : 'updated'}  ${f.name}  (${f.pageCount}p, ${rows.length} fields)  id=${id}`);
}

console.log('\nDone. Nothing was sent — the broker composes and sends each envelope himself.');
