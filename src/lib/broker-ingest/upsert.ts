/**
 * Dedup + insert extracted listings into crm_prospective_properties.
 *
 * Dedup: before inserting, fetch existing (name,address) for business_unit=commercial
 * and skip any incoming row whose normalized address matches an existing one
 * (fallback to normalized name). Mirrors the manual importer used to load the first rows.
 *
 * PostgREST bulk-insert gotcha: every object in a POST array MUST have the identical
 * set of keys or you get 400 PGRST102 "All object keys must match". PropertyRecord
 * guarantees a uniform key set (unused fields are null).
 */

import { createHash } from 'crypto';
import type { Extraction, GmailImage, PropertyRecord } from './types';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
/** Public bucket for property flyer thumbnails (same bucket admin uploads use). */
const FLYER_BUCKET = 'images';

/** created_by / owner for inserted rows (the broker-blast account's CRM user). */
export const CREATED_BY = '47668cbf-25c1-480a-baa0-af65fb663dd7';

/** Street-type words stripped during address normalization (per the manual importer). */
const STREET_TYPES = new Set([
  'st', 'street', 'ave', 'avenue', 'dr', 'drive', 'rd', 'road', 'blvd', 'boulevard',
  'pkwy', 'parkway', 'loop', 'expy', 'expressway', 'ln', 'lane', 'ct', 'court',
  'cir', 'circle', 'way', 'hwy', 'highway', 'trl', 'trail', 'pl', 'place',
  'ter', 'terrace', 'row', 'pass', 'fm', 'ih', 'us', 'cove', 'cv', 'run',
]);

function serviceHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** lowercase, strip punctuation and street-type words -> comparable key. */
export function normalizeAddress(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STREET_TYPES.has(w))
    .join(' ')
    .trim();
}

/** Dedup key: normalized address, falling back to normalized name. */
export function dedupKey(name: string | null, address: string | null): string {
  const a = normalizeAddress(address);
  if (a) return a;
  return normalizeAddress(name);
}

/**
 * Secondary dedup key for listings that arrive WITHOUT a street address
 * (broker re-sends where the address lives only in the flyer image the model
 * didn't re-read). Collapses onto an existing property by size + city +
 * brokerage. Returns null when size_sf is missing (too weak to match on).
 */
export function compositeKey(
  sizeSf: number | null,
  city: string | null,
  company: string | null,
): string | null {
  if (typeof sizeSf !== 'number' || !city || !company) return null;
  return `${sizeSf}|${normalizeAddress(city)}|${normalizeAddress(company)}`;
}

/** Map an Extraction onto a uniform-keyed PropertyRecord. */
export function toRecord(e: Extraction, source = 'broker_email'): PropertyRecord {
  return {
    name: e.name ?? e.address ?? null,
    address: e.address ?? null,
    suite: e.suite ?? null,
    city: e.city ?? null,
    state: e.state ?? null,
    zip: e.zip ?? null,
    asset_type: e.asset_type ?? 'Office',
    size_sf: typeof e.size_sf === 'number' ? e.size_sf : null,
    vacancy_status: 'vacant',
    asking_rate: e.asking_rate ?? null,
    listing_company: e.listing_company ?? null,
    listing_agent_name: e.listing_agent_name ?? null,
    listing_agent_phone: e.listing_agent_phone ?? null,
    source,
    notes: e.notes ?? null,
    business_unit: 'commercial',
    created_by: CREATED_BY,
    last_status_at: new Date().toISOString(),
    property_subtype: e.property_subtype ?? null,
    building_class: e.building_class ?? null,
    year_built: e.year_built ?? null,
    lot_size_acres: e.lot_size_acres ?? null,
    office_sf: e.office_sf ?? null,
    clear_height_ft: e.clear_height_ft ?? null,
    dock_doors: e.dock_doors ?? null,
    grade_doors: e.grade_doors ?? null,
    power: e.power ?? null,
    sprinklered: e.sprinklered ?? null,
    zoning: e.zoning ?? null,
    elevator: e.elevator ?? null,
    listing_type: e.listing_type ?? null,
    transaction_status: e.transaction_status ?? 'Available',
    sale_price: e.sale_price ?? null,
    price_per_sf: e.price_per_sf ?? null,
    lease_rate_min: e.lease_rate_min ?? null,
    lease_rate_max: e.lease_rate_max ?? null,
    lease_type: e.lease_type ?? null,
    opex_psf: e.opex_psf ?? null,
    available_sf: e.available_sf ?? null,
    divisible: e.divisible ?? null,
    highlights: e.highlights ?? null,
    brochure_url: e.brochure_url ?? null,
    flyer_url: null, // set later from the email's flyer image (upload → public URL)
    available_date: e.available_date ?? null,
    address_key: dedupKey(e.name, e.address) || null,
  };
}

/** Upload a broker flyer image to the public bucket; returns its public URL (or null). */
async function uploadFlyer(flyer: GmailImage): Promise<string | null> {
  try {
    const ext = (flyer.mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const hash = createHash('md5').update(flyer.data).digest('hex').slice(0, 20);
    const path = `property-flyers/${hash}.${ext}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${FLYER_BUCKET}/${path}`, {
      method: 'POST',
      headers: { ...serviceHeaders(), 'Content-Type': flyer.mimeType, 'x-upsert': 'true' },
      body: Buffer.from(flyer.data, 'base64'),
    });
    if (!res.ok && res.status !== 409) {
      console.error('[flyer upload]', res.status, (await res.text()).slice(0, 160));
      return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${FLYER_BUCKET}/${path}`;
  } catch (err) {
    console.error('[flyer upload] error', (err as Error).message);
    return null;
  }
}

/** PATCH just the flyer_url on an existing row (used to backfill photos onto dups). */
async function patchFlyerUrl(id: string, url: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/crm_prospective_properties?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...serviceHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ flyer_url: url }),
  });
}

/**
 * Fetch dedup keys for all existing commercial prospective properties.
 * Includes both the primary address/name key AND the size+city+company
 * composite key, so an address-less re-send collapses onto the existing row.
 */
export async function fetchExistingKeys(): Promise<Set<string>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_prospective_properties?select=name,address,size_sf,city,listing_company&business_unit=eq.commercial`,
    { headers: serviceHeaders() },
  );
  const set = new Set<string>();
  if (!res.ok) return set;
  const rows: Array<{
    name: string | null; address: string | null; size_sf: number | null;
    city: string | null; listing_company: string | null;
  }> = await res.json();
  for (const r of rows ?? []) {
    const k = dedupKey(r.name, r.address);
    if (k) set.add(k);
    const ck = compositeKey(r.size_sf, r.city, r.listing_company);
    if (ck) set.add(ck);
    // Name-based key too: catches a re-extraction that now HAS an address
    // matching an earlier row that was entered WITHOUT one (e.g. a manual
    // quick-add). Prefixed so it only ever matches other name keys.
    const nk = normalizeAddress(r.name);
    if (nk) set.add('name:' + nk);
  }
  return set;
}

interface ExistingRow { id: string; flyer_url: string | null; }

/**
 * Like fetchExistingKeys, but also returns a key → { id, flyer_url } map so the
 * upsert can backfill a flyer photo onto an existing row that has none.
 */
async function fetchExistingRows(): Promise<{ seen: Set<string>; byKey: Map<string, ExistingRow> }> {
  const seen = new Set<string>();
  const byKey = new Map<string, ExistingRow>();
  const add = (k: string | null, row: ExistingRow) => { if (!k) return; seen.add(k); if (!byKey.has(k)) byKey.set(k, row); };
  // PostgREST caps a single response at 1000 rows and the table is well past that,
  // so page through ALL of it — otherwise dedup silently misses every row beyond
  // the first page and the pipeline re-inserts duplicates of them.
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_prospective_properties?select=id,name,address,size_sf,city,listing_company,flyer_url&business_unit=eq.commercial&order=id`,
      { headers: { ...serviceHeaders(), Range: `${from}-${from + PAGE - 1}` } },
    );
    if (!res.ok) break;
    const rows: Array<{ id: string; name: string | null; address: string | null; size_sf: number | null; city: string | null; listing_company: string | null; flyer_url: string | null }> = await res.json();
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      const row: ExistingRow = { id: r.id, flyer_url: r.flyer_url };
      add(dedupKey(r.name, r.address), row);
      add(compositeKey(r.size_sf, r.city, r.listing_company), row);
      const nk = normalizeAddress(r.name);
      add(nk ? 'name:' + nk : null, row);
    }
    if (rows.length < PAGE) break;
  }
  return { seen, byKey };
}

export interface UpsertResult {
  /** How many rows were actually written (0 on a dry run). */
  inserted: number;
  /** Rows skipped because they duplicate an existing/earlier-in-batch property. */
  dupSkipped: number;
  /** Rows dropped because they had neither an address nor a name. */
  skippedNoAddress: number;
  /** Flyer photos uploaded + attached (new inserts + backfilled dups). */
  photosAdded: number;
  /** The de-duplicated records that were (or on a dry run, would be) inserted. */
  records: PropertyRecord[];
}

/**
 * Dedup a batch of extracted listings (each optionally carrying its broker flyer
 * image) against the DB and against each other; when commit=true, bulk-insert the
 * survivors with their flyer photo attached. A dup that matches an existing row
 * missing a flyer gets one uploaded + patched on (the backfill path). Idempotent.
 */
export async function upsertProperties(
  items: Array<{ extraction: Extraction; flyer?: GmailImage }>,
  opts: { commit: boolean; source?: string },
): Promise<UpsertResult> {
  const { seen: existing, byKey } = await fetchExistingRows();
  const seen = new Set<string>(existing);
  const toInsert: PropertyRecord[] = [];
  let dupSkipped = 0;
  let skippedNoAddress = 0;
  let photosAdded = 0;

  // Upload each distinct flyer at most once per run (same content → same path anyway).
  const uploadCache = new Map<GmailImage, string | null>();
  const doUpload = async (flyer: GmailImage): Promise<string | null> => {
    if (uploadCache.has(flyer)) return uploadCache.get(flyer)!;
    const url = await uploadFlyer(flyer);
    uploadCache.set(flyer, url);
    return url;
  };

  for (const { extraction: e, flyer } of items) {
    const rec = toRecord(e, opts.source ?? 'broker_email');
    if (!rec.address && !rec.name) { skippedNoAddress++; continue; }
    const key = dedupKey(rec.name, rec.address);
    if (!key) { skippedNoAddress++; continue; }
    const ck = compositeKey(rec.size_sf, rec.city, rec.listing_company);
    const nk = rec.name ? 'name:' + normalizeAddress(rec.name) : null;

    if (seen.has(key) || (ck && seen.has(ck)) || (nk && seen.has(nk))) {
      dupSkipped++;
      // Backfill: attach a flyer to an existing row that has none.
      if (flyer && opts.commit) {
        const row = byKey.get(key) ?? (ck ? byKey.get(ck) : undefined) ?? (nk ? byKey.get(nk) : undefined);
        if (row && !row.flyer_url) {
          const url = await doUpload(flyer);
          if (url) { await patchFlyerUrl(row.id, url); row.flyer_url = url; photosAdded++; }
        }
      }
      continue;
    }
    seen.add(key);
    if (ck) seen.add(ck);
    if (nk) seen.add(nk);
    // New listing: attach its flyer photo before insert.
    if (flyer && opts.commit) {
      const url = await doUpload(flyer);
      if (url) { rec.flyer_url = url; photosAdded++; }
    }
    toInsert.push(rec);
  }

  if (opts.commit && toInsert.length) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_prospective_properties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...serviceHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(toInsert),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`crm_prospective_properties insert failed (${res.status}): ${t}`);
    }
  }

  return {
    inserted: opts.commit ? toInsert.length : 0,
    dupSkipped,
    skippedNoAddress,
    photosAdded,
    records: toInsert,
  };
}
