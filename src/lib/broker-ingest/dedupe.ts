/**
 * Periodic cleanup for source='digest' rows.
 *
 * Marketplace digests get extracted twice under slightly different forms — most
 * often the same listing once WITH its street address and once without — and the
 * crawl's address-keyed dedup can't catch them (a blank address has no key to match
 * on). This collapses those name+city collisions: it keeps the richest copy, folds
 * any field the losers have that the keeper lacks INTO the keeper (fill-empty, never
 * overwrite), then deletes the redundant rows.
 *
 * Conservative by construction: two rows are only merged when they share a city AND
 * a normalized street address — or when a group has a single address that its
 * address-less copies clearly belong to. Two DIFFERENT addresses under one name
 * (distinct spaces/buildings) are always left alone.
 */

import { normalizeAddress } from './upsert';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();

function serviceHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Loose normalization for grouping names/cities (no street-type stripping). */
function normText(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

type Row = Record<string, unknown> & { id: string };

/** Columns pulled per digest row: identity + everything we might fold into a keeper. */
const SELECT =
  'id,name,address,suite,city,state,zip,size_sf,asking_rate,asset_type,property_subtype,' +
  'listing_company,listing_agent_name,listing_agent_phone,year_built,lot_size_acres,notes,flyer_url,created_at';

/** Fields folded from a loser into the keeper when the keeper's value is empty. */
const FILL_FIELDS = [
  'address', 'suite', 'city', 'state', 'zip', 'size_sf', 'asking_rate', 'asset_type',
  'property_subtype', 'listing_company', 'listing_agent_name', 'listing_agent_phone',
  'year_built', 'lot_size_acres', 'notes', 'flyer_url',
];

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}
function richness(r: Row): number {
  return FILL_FIELDS.reduce((n, f) => n + (isEmpty(r[f]) ? 0 : 1), 0);
}

async function fetchDigestRows(): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_prospective_properties?select=${SELECT}&business_unit=eq.commercial&source=eq.digest&order=created_at`,
      { headers: { ...serviceHeaders(), Range: `${from}-${from + PAGE - 1}` } },
    );
    if (!res.ok) break;
    const rows: Row[] = await res.json();
    if (!rows?.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function patchRow(id: string, patch: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/crm_prospective_properties?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...serviceHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}
async function deleteRows(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await fetch(
    `${SUPABASE_URL}/rest/v1/crm_prospective_properties?source=eq.digest&id=in.(${ids.join(',')})`,
    { method: 'DELETE', headers: { ...serviceHeaders(), Prefer: 'return=minimal' } },
  );
}

/** Merge a set of confirmed-duplicate rows into their richest member, delete the rest. */
async function collapse(list: Row[], commit: boolean): Promise<{ merged: number; deleted: number }> {
  const keeper = list
    .slice()
    .sort((a, b) => richness(b) - richness(a) || String(a.created_at).localeCompare(String(b.created_at)))[0];
  const losers = list.filter((r) => r.id !== keeper.id);
  if (!losers.length) return { merged: 0, deleted: 0 };

  const patch: Record<string, unknown> = {};
  for (const l of losers) {
    for (const f of FILL_FIELDS) {
      if (!(f in patch) && isEmpty(keeper[f]) && !isEmpty(l[f])) patch[f] = l[f];
    }
  }
  if ('address' in patch) {
    patch.address_key = normalizeAddress(String(patch.address)) || normalizeAddress(String(keeper.name ?? '')) || null;
  }

  let merged = 0;
  if (commit) {
    if (Object.keys(patch).length) { await patchRow(keeper.id, patch); merged = 1; }
    await deleteRows(losers.map((l) => l.id));
  }
  return { merged, deleted: losers.length };
}

export interface DedupeResult {
  scanned: number;
  /** Duplicate groups collapsed. */
  groups: number;
  /** Keepers that gained at least one field from a loser. */
  merged: number;
  /** Redundant rows removed. */
  deleted: number;
}

export async function dedupeDigestDuplicates(opts: { commit: boolean }): Promise<DedupeResult> {
  const rows = await fetchDigestRows();

  // Group by name + city.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const nk = normText(r.name);
    if (!nk) continue;
    const key = `${nk}|${normText(r.city)}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }

  let groupCount = 0, merged = 0, deleted = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const addrs = new Set(list.map((r) => normalizeAddress(String(r.address ?? ''))).filter(Boolean));

    if (addrs.size >= 2) {
      // Distinct addresses under one name = distinct listings. Only collapse exact
      // address matches; never merge across addresses, and leave blank-address rows
      // (ambiguous — could belong to any of them) untouched.
      const byAddr = new Map<string, Row[]>();
      for (const r of list) {
        const a = normalizeAddress(String(r.address ?? ''));
        if (!a) continue;
        const b = byAddr.get(a);
        if (b) b.push(r); else byAddr.set(a, [r]);
      }
      for (const bucket of byAddr.values()) {
        if (bucket.length < 2) continue;
        const res = await collapse(bucket, opts.commit);
        groupCount++; merged += res.merged; deleted += res.deleted;
      }
      continue;
    }

    // 0 or 1 distinct address in the group → one listing (addressed copy + its
    // address-less / duplicate extractions). Collapse the whole group.
    const res = await collapse(list, opts.commit);
    groupCount++; merged += res.merged; deleted += res.deleted;
  }

  return { scanned: rows.length, groups: groupCount, merged, deleted };
}
