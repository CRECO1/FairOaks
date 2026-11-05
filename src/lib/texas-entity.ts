// Free Texas business-entity lookup for the copilot: who is behind "Smith Holdings LLC"?
//
// Two public Texas Comptroller sources, no key and no login:
//  1. data.texas.gov dataset 9cir-efmm (Active Franchise Taxpayers) — search by name → taxpayer number, mailing address,
//     Secretary of State file number, formation date, status.
//  2. comptroller.texas.gov/data-search/franchise-tax/<taxpayerNumber> — the JSON behind the Franchise Tax Account Status
//     page: registered agent + the officers / directors / members on the latest Public Information Report (names, titles, city). The page itself is rendered by JavaScript, so a plain web fetch of it returns an empty template — this
//     endpoint is what makes the officer list reachable at all.
// It reads public records only and changes nothing. Sole proprietorships, partnerships and trade names (DBAs) are not in
// it; those need the web search or the county assumed-name records.

const SOCRATA = 'https://data.texas.gov/resource/9cir-efmm.json';
const CPA = 'https://comptroller.texas.gov/data-search/franchise-tax/';
const TIMEOUT_MS = 12_000;

export interface TexasEntityMatch {
  taxpayer_number: string;
  name: string;
  address: string;
  status: string;
  formed: string | null;
  sos_file_number: string | null;
  org_type: string | null;
}

export interface TexasEntityDetail extends TexasEntityMatch {
  registered_agent: string | null;
  registered_office: string | null;
  right_to_transact: string | null;
  report_year: string | null;
  officers: { name: string; title: string | null; address: string | null }[];
}

const ORG_TYPE: Record<string, string> = {
  CL: 'Limited liability company', CC: 'Corporation', CP: 'Corporation', CF: 'Corporation (foreign)', LP: 'Limited partnership',
  LL: 'Limited liability partnership', PA: 'Professional association', NP: 'Nonprofit', CN: 'Nonprofit corporation',
};

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CRECO-CRM/1.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const dateOnly = (v: unknown) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

/** Letters, digits and spaces only — this goes inside a SoQL string literal. */
function cleanName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9&.,' -]/g, ' ').replace(/'/g, "''").replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function searchTexasEntities(name: string, city?: string): Promise<TexasEntityMatch[]> {
  const n = cleanName(name).toUpperCase();
  if (n.length < 3) return [];
  // Every word must appear, in any order, so "Boerne Hardware" still finds "BOERNE HARDWARE & SUPPLY LLC".
  // Generic words are dropped: the state record says "CIBOLO CREEK BREWING, LLC" where people say "Cibolo Creek Brewing Company".
  const GENERIC = /^(LLC|L\.L\.C|INC|INCORPORATED|LP|LTD|CO|COMPANY|CORP|CORPORATION|THE|AND|OF|&)\.?,?$/;
  const words = n.split(' ').filter(w => w.length > 1 && !GENERIC.test(w));
  if (!words.length) return [];
  const clauses = words.map(w => `upper(taxpayer_name) like '%${w.replace(/[.,]/g, '')}%'`);
  const c = city ? cleanName(city).toUpperCase() : '';
  if (c) clauses.push(`upper(taxpayer_city) = '${c}'`);
  const url = `${SOCRATA}?$where=${encodeURIComponent(clauses.join(' AND '))}&$limit=60&$order=${encodeURIComponent('sos_charter_date DESC')}`;
  const rows = await getJson(url);
  if (!Array.isArray(rows)) return [];
  // The state search is substring-only ("SHAM" also finds SHAMROCK), so rank here: the whole phrase beats scattered words,
  // and whole-word hits beat partial ones. Without this the real company can sit past the cut-off behind newer lookalikes.
  const phrase = words.map(w => w.replace(/[.,]/g, '')).join(' ');
  const score = (nm: string) => {
    const u = ` ${String(nm).toUpperCase().replace(/[.,']/g, '')} `;
    const whole = words.filter(w => u.includes(` ${w.replace(/[.,]/g, '')} `)).length;
    return (u.includes(` ${phrase} `) ? 100 : u.includes(phrase) ? 60 : 0) + whole * 10 - Math.min(20, Math.max(0, u.length - phrase.length) / 4);
  };
  rows.sort((a: any, b: any) => score(b.taxpayer_name) - score(a.taxpayer_name));
  return rows.slice(0, 8).map((r: any) => ({
    taxpayer_number: String(r.taxpayer_number ?? ''),
    name: String(r.taxpayer_name ?? ''),
    address: [r.taxpayer_address, r.taxpayer_city, r.taxpayer_state, r.taxpayer_zip].filter(Boolean).join(', '),
    status: r.sos_status_code === 'A' && r.right_to_transact_business_code === 'A' ? 'Active' : `SOS ${r.sos_status_code ?? '?'} / right to transact ${r.right_to_transact_business_code ?? '?'}`,
    formed: dateOnly(r.sos_charter_date),
    sos_file_number: r.secretary_of_state_sos_or_coa_file_number ? String(r.secretary_of_state_sos_or_coa_file_number) : null,
    org_type: ORG_TYPE[String(r.taxpayer_organizational_type ?? '')] ?? (r.taxpayer_organizational_type ? String(r.taxpayer_organizational_type) : null),
  })).filter(m => m.taxpayer_number);
}

export async function texasEntityDetail(taxpayerNumber: string, base?: TexasEntityMatch): Promise<TexasEntityDetail | null> {
  const id = taxpayerNumber.replace(/\D/g, '');
  if (id.length < 8 || id.length > 14) return null;
  const j = await getJson(CPA + id);
  const d = j?.success ? j.data : null;
  if (!d) return null;
  const addr = (s?: string, c?: string, st?: string, z?: string) => [s, c, st, z].filter(x => x && String(x).trim()).join(', ') || null;
  const officers = (Array.isArray(d.officerInfo) ? d.officerInfo : []).slice(0, 12).map((o: any) => ({
    name: title(String(o.AGNT_NM ?? '').trim()),
    title: o.AGNT_TITL_TX ? title(String(o.AGNT_TITL_TX).trim()) : null,
    // City and state only: the street on a Public Information Report is usually the officer's home, and nobody needs it to know who owns the business.
    address: addr(undefined, o.CITY_NM, o.ST_CD) ,
  })).filter((o: { name: string }) => o.name);
  return {
    taxpayer_number: id,
    name: String(d.name ?? base?.name ?? ''),
    address: addr(d.mailingAddressStreet, d.mailingAddressCity, d.mailingAddressState, d.mailingAddressZip) ?? base?.address ?? '',
    status: base?.status ?? String(d.sosRegistrationStatus ?? ''),
    formed: base?.formed ?? (d.effectiveSosRegistrationDate ? String(d.effectiveSosRegistrationDate) : null),
    sos_file_number: d.sosFileNumber ? String(d.sosFileNumber) : base?.sos_file_number ?? null,
    org_type: base?.org_type ?? null,
    registered_agent: d.registeredAgentName ? title(String(d.registeredAgentName)) : null,
    registered_office: addr(d.registeredOfficeAddressStreet, d.registeredOfficeAddressCity, d.registeredOfficeAddressState, d.registeredOfficeAddressZip),
    right_to_transact: d.rightToTransactTX ? String(d.rightToTransactTX) : null,
    report_year: d.reportYear ? String(d.reportYear) : null,
    officers,
  };
}

/** True when the entity name contains the searched words as one phrase (ignoring LLC/Inc and punctuation). */
export function containsPhrase(entityName: string, query: string): boolean {
  const norm = (x: string) => ` ${x.toUpperCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim()} `;
  const q = norm(query).trim().split(' ').filter(w => !/^(LLC|INC|INCORPORATED|LP|LTD|CO|COMPANY|CORP|CORPORATION|THE|AND|OF|&)$/.test(w)).join(' ');
  return !!q && norm(entityName).includes(` ${q}`);
}
