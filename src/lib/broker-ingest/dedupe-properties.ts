/**
 * Periodic cleanup for property-level duplicates in crm_prospective_properties:
 * the SAME building ingested more than once (a broker email re-processed, or a
 * LoopNet "Pky" vs a broker's "Parkway" for one address). The crawl's dedup misses
 * these when the address formatting differs.
 *
 * Groups by a CANONICAL address (I-10 / IH-10 / Interstate 10 → i10; FM/US/Loop/
 * Hwy normalized; suites + street-type words stripped) plus city + state, keeps the
 * richest copy, folds any field it's missing in from the losers (photos, contact_id,
 * everything — never overwrites), and deletes the redundant rows. Idempotent.
 *
 * Conservative: only merges rows sharing a canonical street address AND city AND
 * state — the same address in two different cities is left alone (a "100 Main St"
 * exists in many towns). Never deletes source='agent_manual' rows.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();

function serviceHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

/** Street-type words dropped from a canonical address (directionals are KEPT). */
const STREET = new Set(['st','street','ave','avenue','av','rd','road','dr','drive','blvd','boulevard','pkwy','parkway','pky','ln','lane','ct','court','cir','circle','way','trl','trail','pl','place','ter','terrace','pass','cove','cv','run','ste','suite','bldg','building','unit','no','number','#']);

/** Canonical street address: highways/FM roads joined, suites + street types stripped. */
function canon(addr: unknown): string {
  if (!addr) return '';
  let s = ' ' + String(addr).toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ') + ' ';
  s = s.replace(/\b(i|ih|interstate)\s+h?\s*(\d+)/g, ' i$2 ')
       .replace(/\b(u\s?s|us)\s+(hwy|highway|route)?\s*(\d+)/g, ' us$3 ')
       .replace(/\b(fm|rm|farm to market|ranch to market)\s+(\d+)/g, ' fm$2 ')
       .replace(/\b(loop)\s+(\d+)/g, ' loop$2 ')
       .replace(/\b(sh|state highway|hwy|highway)\s+(\d+)/g, ' hwy$2 ');
  return s.split(/\s+/).filter((t) => t && !STREET.has(t)).join(' ').trim();
}
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isEmpty = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

type Row = Record<string, unknown> & { id: string };
/** Fields that count toward "richest" and are folded from a loser into the keeper. */
const FILL = ['address','suite','city','state','zip','size_sf','asking_rate','asset_type','listing_company','listing_agent_name','notes','sale_price','year_built'];
const richness = (r: Row) =>
  FILL.reduce((n, f) => n + (isEmpty(r[f]) ? 0 : 1), 0) +
  (Array.isArray(r.photos) && r.photos[0] ? 2 : 0) + (r.contact_id ? 2 : 0);
/** Never folded/overwritten on the keeper. */
const PROTECT = new Set(['id', 'created_at', 'updated_at', 'business_unit', 'created_by', 'source', 'address_key']);

async function getAll(base: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}${base}&offset=${from}&limit=1000`, { headers: serviceHeaders() });
    if (!res.ok) break;
    const rows: Row[] = await res.json();
    if (!rows?.length) break;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
async function patchRow(id: string, patch: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/crm_prospective_properties?id=eq.${id}`, {
    method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  });
}
async function deleteRows(ids: string[]): Promise<void> {
  if (!ids.length) return;
  // Guard: only ever delete non-manual commercial rows.
  await fetch(
    `${SUPABASE_URL}/rest/v1/crm_prospective_properties?business_unit=eq.commercial&source=neq.agent_manual&id=in.(${ids.join(',')})`,
    { method: 'DELETE', headers: { ...serviceHeaders(), Prefer: 'return=minimal' } },
  );
}

const GROUP_COLS =
  'id,name,address,suite,city,state,zip,size_sf,asking_rate,asset_type,listing_company,listing_agent_name,notes,sale_price,year_built,photos,contact_id';

export interface DedupePropertiesResult {
  scanned: number;
  groups: number;
  merged: number;
  deleted: number;
}

export async function dedupeProperties(opts: { commit: boolean }): Promise<DedupePropertiesResult> {
  const rows = await getAll(`/rest/v1/crm_prospective_properties?business_unit=eq.commercial&select=${GROUP_COLS}&order=id`);

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const a = canon(r.address);
    const key = a ? `${a}|${norm(r.city)}|${norm(r.state)}` : `name:${norm(r.name)}|${norm(r.city)}`;
    if (!key.replace(/[|:]/g, '').trim()) continue;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const dups = [...groups.values()].filter((g) => g.length > 1);

  const result: DedupePropertiesResult = { scanned: rows.length, groups: dups.length, merged: 0, deleted: 0 };
  if (!dups.length) return result;

  // Fetch FULL rows for a complete merge (the grouping select omits many columns).
  const memberIds = dups.flatMap((g) => g.map((r) => r.id));
  const full = new Map<string, Row>();
  for (let i = 0; i < memberIds.length; i += 100) {
    const chunk = memberIds.slice(i, i + 100);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_prospective_properties?id=in.(${chunk.join(',')})&select=*`, { headers: serviceHeaders() });
    if (!res.ok) continue;
    for (const r of (await res.json()) as Row[]) full.set(r.id, r);
  }

  for (const g of dups) {
    const members = g.map((r) => full.get(r.id)).filter((r): r is Row => !!r);
    if (members.length < 2) continue;
    members.sort((a, b) => richness(b) - richness(a) || String(a.created_at).localeCompare(String(b.created_at)));
    const keeper = members[0];
    // Only non-manual rows are eligible for deletion; a manual add is kept as-is.
    const losers = members.slice(1).filter((l) => l.source !== 'agent_manual');
    if (!losers.length) continue;

    const patch: Record<string, unknown> = {};
    for (const l of losers) {
      for (const k of Object.keys(l)) {
        if (PROTECT.has(k)) continue;
        if (isEmpty(keeper[k]) && !isEmpty(l[k]) && !(k in patch)) patch[k] = l[k];
      }
    }
    if (opts.commit) {
      if (Object.keys(patch).length) { await patchRow(keeper.id, patch); result.merged++; }
      await deleteRows(losers.map((l) => l.id));
    } else if (Object.keys(patch).length) {
      result.merged++;
    }
    result.deleted += losers.length;
  }
  return result;
}
