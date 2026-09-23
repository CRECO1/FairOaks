// Re-file the form library into its folders (crm_forms.category) and pin the
// forms that should lead a folder.
//
//   node --env-file=.env.local scripts/forms/ingest/organize_categories.mjs [--apply]
//
// Dry-run by default: prints every move and leaves the DB alone. Pass --apply to
// write. Re-running is a no-op once the library matches this file, so this doubles
// as the checked-in description of how the library is meant to be organised.
//
// Folders are matched by form NAME. crm_forms.name is also how FORM_PACKETS binds
// forms to deal types, so renaming a form breaks its packet — moving one between
// folders does not. Only `category` and `pinned` are touched here.
import { readFileSync } from 'node:fs';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) { console.error('Missing Supabase env'); process.exit(1); }
const APPLY = process.argv.includes('--apply');

// name-matching rules, first match wins, evaluated per business unit
const RULES = [
  // ── commercial ────────────────────────────────────────────────────────────
  [/^Commercial Lease$|^Commercial Sublease$|^Commercial Lease Application$/, 'Leasing'],
  [/^Commercial Lease (Amendment|Guaranty)$|^Commercial Lease Construction Addendum|^Commercial Landlord/, 'Lease Addenda & Exhibits'],
  [/^Commercial Contract — (Improved|Unimproved) Property$/, 'Purchase'],
  [/^Commercial Contract (Amendment|Exhibit|Financing Addendum|Termination Notice)/, 'Purchase Addenda & Exhibits'],

  // ── residential (TREC) ────────────────────────────────────────────────────
  // ORDER MATTERS, and two TREC titles are why:
  //  · 62-0 "Seller's Notice to Buyer of Removal of Contingency Under Addendum
  //    for Back-Up Contract" is a NOTICE whose title contains "Addendum".
  //  · "Notice of Buyer's/Seller's Termination of Contract" are NOTICES whose
  //    titles end in "Contract".
  // So the notice rules run before the addendum and contract rules. All the
  // notice patterns are ^-anchored, so a form merely containing one of those
  // words further along (e.g. "Addendum Containing Notice of Obligation…")
  // still falls through to the right rule.
  [/^Seller's Notice to Buyer of Removal of Contingency/, 'Residential Notices & Disclosures'],
  [/^(Notice|Seller's Disclosure|Disclosure|Condominium Resale|Subdivision Information|Landlord's Floodplain)/, 'Residential Notices & Disclosures'],
  [/Temporary Residential Lease$/, 'Residential Temporary Leases'],
  [/Addendum/, 'Residential Addenda'],
  [/Contract( \(|$)|^Amendment to Contract$/, 'Residential Contracts'],
];

// forms that should sort to the top of their folder
const PIN = ['One to Four Family Residential Contract (Resale)'];

const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const rest = async (p, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${p}`, { ...init, headers: h });
  const t = await r.text();
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${p} -> ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};

const forms = await rest('crm_forms?select=id,name,category,business_unit,pinned&order=business_unit,name');
const moves = [];
const pins = [];
const unmatched = [];

for (const f of forms) {
  // Folders that are already exactly right, and one-off collections, stay put.
  if (['Letters of Intent', 'Listing Agreements', 'Compensation', 'Disclosures', 'Agent Onboarding', '8000 Fair Oaks Plaza'].includes(f.category ?? '')) {
    // still allow pinning inside them
  } else {
    const rule = RULES.find(([re]) => re.test(f.name));
    if (!rule) unmatched.push(f);
    else if (rule[1] !== f.category) moves.push({ ...f, to: rule[1] });
  }
  const shouldPin = PIN.includes(f.name);
  if (shouldPin !== !!f.pinned && (shouldPin || f.category?.startsWith('Residential'))) pins.push({ ...f, to: shouldPin });
}

console.log(`${forms.length} forms · ${moves.length} to move · ${pins.length} pin change(s) · ${unmatched.length} unmatched\n`);
for (const m of moves) console.log(`  ${(m.category ?? '—').padEnd(28)} → ${m.to.padEnd(32)} ${m.name.slice(0, 58)}`);
if (pins.length) { console.log(); for (const p of pins) console.log(`  ${p.to ? '★ pin  ' : '☆ unpin'} ${p.name.slice(0, 64)}`); }
if (unmatched.length) { console.log('\n⚠ no rule matched (left alone):'); for (const u of unmatched) console.log(`    [${u.category}] ${u.name}`); }

if (!APPLY) { console.log('\nDry run — pass --apply to write.'); process.exit(0); }

for (const m of moves) await rest(`crm_forms?id=eq.${m.id}`, { method: 'PATCH', body: JSON.stringify({ category: m.to }) });
for (const p of pins) await rest(`crm_forms?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: p.to }) });
console.log(`\n✓ applied ${moves.length} move(s), ${pins.length} pin change(s)`);
