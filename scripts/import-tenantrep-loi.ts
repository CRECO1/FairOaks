// Import an already-generated tenant-rep LOI (PDF) into the editable form-docs system:
// parse its terms into builder_data, re-render the branded PDF with the builder's own
// renderer (so the stored file and the editor agree), and file a crm_form_submissions
// row on the deal — it then shows under CRM FORMS and opens in LoiBuilder.
//
//   npx tsx scripts/import-tenantrep-loi.ts --deal-match Goen --out <dir> <loi.pdf> [...]
//        (dry run: parses, renders, writes <out>/*.json + *.pdf, touches nothing)
//   ...same + --apply --env .env.local      (uploads PDF + inserts the submission row)
//
// Re-running with --apply is idempotent per title+deal: an existing row is updated.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLoi } from '../src/lib/loi-doc';
import { leaseSpec, type LoiPurchaseData, type LoiTermRow } from '../src/lib/loi-spec';

const LEASE_FORM_ID = '185d29b9-6fbe-4611-b6c4-9e5e2d54ecf2';   // "Letter of Intent to Lease"
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes('--apply');
const dealMatch = flag('--deal-match') ?? 'Goen';
const outDir = flag('--out') ?? '.';
const envFile = flag('--env');
const pdfs = args.filter((a, i) => a.endsWith('.pdf') && args[i - 1] !== '--out');

const CHROME = /Where your real estate ventures|8000 Fair Oaks Pkwy|^\s*$/;

function parse(pdfPath: string): LoiPurchaseData {
  const raw = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  const lines = raw.split('\n').map(l => l.replace(/\f/g, '')).filter(l => !CHROME.test(l));
  const iTitle = lines.findIndex(l => /LETTER OF INTENT TO LEASE/.test(l));
  const subtitle = lines[iTitle + 1].trim();
  const get = (re: RegExp) => lines.find(l => re.test(l))?.replace(re, '').trim() ?? '';
  const loiDate = get(/^Date:\s*/);
  const to = get(/^To:\s*/);
  const reLine = get(/^Re:\s*/);
  // Intro paragraph: from "On behalf of" through the line ending in "terms:".
  const iIntro = lines.findIndex(l => /^On behalf of/.test(l));
  const iTerms = lines.findIndex((l, i) => i >= iIntro && /terms:\s*$/.test(l));
  const intro = lines.slice(iIntro, iTerms + 1).map(l => l.trim()).join(' ');
  // Term rows: label in column 0, value from the second column; continuation lines are
  // indented. A label that wrapped ("Tenant Improvement" / "Allowance:") has no colon yet.
  const iEnd = lines.findIndex((l, i) => i > iTerms && /^This Letter of Intent is merely/.test(l));
  const terms: LoiTermRow[] = [];
  for (const l of lines.slice(iTerms + 1, iEnd)) {
    const m = /^(\S.*?)\s{3,}(\S.*)$/.exec(l);
    const last = terms[terms.length - 1];
    if (m) {
      if (last && !last.label.endsWith(':')) { last.label += ' ' + m[1].trim(); last.value += (last.value ? ' ' : '') + m[2].trim(); }
      else terms.push({ id: `t${terms.length + 1}`, label: m[1].trim(), value: m[2].trim() });
    } else if (/^\S/.test(l) && last && !last.label.endsWith(':')) {
      last.label += ' ' + l.trim();                         // label-only wrap line
    } else if (last) {
      last.value += (last.value ? ' ' : '') + l.trim();
    }
  }
  const iSinc = lines.findIndex(l => /^Sincerely,/.test(l));
  const signer = lines[iSinc + 1].trim();
  const contact = lines[iSinc + 2].trim();
  const [agentPhone, agentEmail] = [/\(\d{3}\)\s*\d{3}-\d{4}/.exec(contact)?.[0] ?? '', /\S+@\S+/.exec(contact)?.[0] ?? ''];
  const tenant = /^(.+?)(?:,? or its|$)/.exec(terms.find(t => t.label === 'Tenant:')?.value ?? '')?.[1] ?? 'Tenant';
  return {
    variant: 'tenantrep',
    loiDate, addresseeName: to, addresseeAddr1: '', addresseeAddr2: '', reLine,
    subtitle, intro, terms, additionalTerms: '',
    agentName: signer, agentEmail, agentPhone,
    // Two acceptance blocks, matching the original letter: tenant then landlord.
    sellers: [{ entity: `${tenant} (Tenant)`, signatory: '' }, { entity: 'Landlord', signatory: '' }],
  };
}

function loadEnv(file: string) {
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

(async () => {
  if (!pdfs.length) { console.error('usage: import-tenantrep-loi.ts [--apply --env f] --out dir a.pdf b.pdf'); process.exit(1); }
  mkdirSync(outDir, { recursive: true });
  const logo = new Uint8Array(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/creco-letterhead-logo.png')));
  const spec = leaseSpec('tenantrep');
  const built = [];
  for (const p of pdfs) {
    const data = parse(p);
    const { pdfBytes, sigFields } = await renderLoi(data, logo, spec);
    const base = path.basename(p, '.pdf');
    writeFileSync(path.join(outDir, `${base}.builder_data.json`), JSON.stringify(data, null, 2));
    writeFileSync(path.join(outDir, `${base}.rendered.pdf`), pdfBytes);
    console.log(`parsed ${base}: ${data.terms.length} terms, ${sigFields.length} sig fields`);
    built.push({ base, data, pdfBytes, sigFields, title: base });   // = the uploaded file's name, which is how the deal's Uploaded Files row finds its editable twin
  }
  if (!apply) { console.log('\nDRY RUN — nothing written to Supabase. Re-run with --apply --env <file>.'); return; }

  if (envFile) loadEnv(envFile);
  const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_BASE || !KEY) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const rest = async (p: string, init: RequestInit = {}) => {
    const r = await fetch(`${URL_BASE}/rest/v1/${p}`, { ...init, headers: { ...H, 'Content-Type': 'application/json', ...(init.headers as object) } });
    const t = await r.text();
    if (!r.ok) throw new Error(`${init.method || 'GET'} ${p} -> ${r.status} ${t}`);
    return t ? JSON.parse(t) : null;
  };
  const deals = await rest(`crm_deals?client=ilike.*${encodeURIComponent(dealMatch)}*&select=id,client,property,stage,business_unit,created_by`);
  if (deals.length !== 1) throw new Error(`expected exactly 1 deal matching "${dealMatch}", got ${deals.length}: ${JSON.stringify(deals)}`);
  const deal = deals[0];
  console.log('deal:', deal.id, deal.client, '|', deal.property);
  for (const b of built) {
    const filled = `submissions/${LEASE_FORM_ID}/import_${Date.now()}_${b.base}.pdf`;
    const up = await fetch(`${URL_BASE}/storage/v1/object/transaction-forms/${filled}`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: b.pdfBytes,
    });
    if (!up.ok) throw new Error(`storage upload -> ${up.status} ${await up.text()}`);
    const row = {
      form_id: LEASE_FORM_ID, deal_id: deal.id, business_unit: deal.business_unit ?? 'commercial',
      title: b.title, values: b.sigFields, builder_data: b.data, filled_path: filled,
      status: 'saved', created_by: deal.created_by ?? null, updated_at: new Date().toISOString(),
    };
    const ex = await rest(`crm_form_submissions?deal_id=eq.${deal.id}&title=eq.${encodeURIComponent(b.title)}&select=id`);
    if (ex.length) { await rest(`crm_form_submissions?id=eq.${ex[0].id}`, { method: 'PATCH', body: JSON.stringify(row) }); console.log('updated', ex[0].id, b.title); }
    else { const ins = await rest('crm_form_submissions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }); console.log('inserted', ins[0].id, b.title); }
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
