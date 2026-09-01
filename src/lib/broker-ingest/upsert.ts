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

/** PATCH arbitrary columns on an existing row (flyer backfill + duplicate enrichment). */
async function patchRow(id: string, patch: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/crm_prospective_properties?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...serviceHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

/**
 * Columns we FILL IN on an existing row when a duplicate arrives carrying data the
 * row is missing. Fill-empty only: an incoming dup can ADD data points but never
 * overwrites a value already there, so manual edits and first-sighting provenance
 * survive. Excludes identity/provenance (name, source, business_unit, created_by),
 * the always-defaulted fields (asset_type, transaction_status, vacancy_status),
 * and notes + flyer_url (each handled specially in the dup path below).
 */
const ENRICHABLE_FIELDS: readonly string[] = [
  'address', 'suite', 'city', 'state', 'zip', 'size_sf', 'asking_rate',
  'listing_company', 'listing_agent_name', 'listing_agent_phone',
  'property_subtype', 'building_class', 'year_built', 'lot_size_acres', 'office_sf',
  'clear_height_ft', 'dock_doors', 'grade_doors', 'power', 'sprinklered', 'zoning',
  'elevator', 'listing_type', 'sale_price', 'price_per_sf', 'lease_rate_min',
  'lease_rate_max', 'lease_type', 'opex_psf', 'available_sf', 'divisible',
  'highlights', 'brochure_url', 'available_date',
];

/** null / undefined / blank-string all count as "no value yet" for enrichment. */
function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
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

/** An existing row we might enrich: its id plus its current column values. */
export interface ExistingRow { id: string; data: Record<string, unknown>; }

/** Prefetched dedup index, shared across chunked upsert passes within one run. */
export interface ExistingIndex { seen: Set<string>; byKey: Map<string, ExistingRow>; }

/** Columns pulled for each existing row — dedup keys + flyer + every enrichable field. */
const EXISTING_SELECT =
  'id,name,address,suite,city,state,zip,size_sf,asking_rate,listing_company,' +
  'listing_agent_name,listing_agent_phone,notes,property_subtype,building_class,' +
  'year_built,lot_size_acres,office_sf,clear_height_ft,dock_doors,grade_doors,' +
  'power,sprinklered,zoning,elevator,listing_type,sale_price,price_per_sf,' +
  'lease_rate_min,lease_rate_max,lease_type,opex_psf,available_sf,divisible,' +
  'highlights,brochure_url,available_date,flyer_url';

/**
 * Like fetchExistingKeys, but also returns a key → { id, data } map so the upsert
 * can backfill a flyer photo AND fill in missing data fields on an existing row
 * when a richer duplicate arrives.
 */
export async function fetchExistingRows(): Promise<ExistingIndex> {
  const seen = new Set<string>();
  const byKey = new Map<string, ExistingRow>();
  const add = (k: string | null, row: ExistingRow) => { if (!k) return; seen.add(k); if (!byKey.has(k)) byKey.set(k, row); };
  // PostgREST caps a single response at 1000 rows and the table is well past that,
  // so page through ALL of it — otherwise dedup silently misses every row beyond
  // the first page and the pipeline re-inserts duplicates of them.
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_prospective_properties?select=${EXISTING_SELECT}&business_unit=eq.commercial&order=id`,
      { headers: { ...serviceHeaders(), Range: `${from}-${from + PAGE - 1}` } },
    );
    if (!res.ok) break;
    const rows: Array<Record<string, unknown>> = await res.json();
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      const row: ExistingRow = { id: String(r.id), data: r };
      add(dedupKey(r.name as string | null, r.address as string | null), row);
      add(compositeKey(r.size_sf as number | null, r.city as string | null, r.listing_company as string | null), row);
      const nk = normalizeAddress(r.name as string | null);
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
  /** Existing duplicate rows that gained at least one previously-missing data field. */
  enriched: number;
  /** Total individual fields filled in across all enriched rows. */
  fieldsEnriched: number;
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
  opts: { commit: boolean; source?: string; existing?: ExistingIndex },
): Promise<UpsertResult> {
  // Reuse a caller-provided dedup index when chunking a run (one fetch, mutated as
  // we go so later chunks see earlier chunks' inserts); otherwise fetch our own.
  const { seen, byKey } = opts.existing ?? (await fetchExistingRows());
  const toInsert: PropertyRecord[] = [];
  let dupSkipped = 0;
  let skippedNoAddress = 0;
  let photosAdded = 0;
  let enriched = 0;
  let fieldsEnriched = 0;

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
      // A duplicate isn't just skipped: fold any data it carries that the existing
      // row is missing back onto that row (fill-empty), append genuinely-new notes,
      // and backfill a flyer if the row has none — all in one PATCH. Never overwrite.
      if (opts.commit) {
        const row = byKey.get(key) ?? (ck ? byKey.get(ck) : undefined) ?? (nk ? byKey.get(nk) : undefined);
        if (row) {
          const patch: Record<string, unknown> = {};
          const recFields = rec as unknown as Record<string, unknown>;
          for (const f of ENRICHABLE_FIELDS) {
            const incoming = recFields[f];
            if (isEmpty(row.data[f]) && !isEmpty(incoming)) patch[f] = incoming;
          }
          // If we just learned the street address, refresh the stored dedup key too.
          if ('address' in patch) {
            patch.address_key = dedupKey(String(row.data.name ?? rec.name ?? ''), String(patch.address)) || null;
          }
          // Notes: append new detail (deduped by substring) rather than fill-only, so
          // a richer email adds its notes past a thin [Digest] placeholder — but the
          // same email re-scanned tomorrow won't append twice.
          if (!isEmpty(rec.notes)) {
            const incoming = String(rec.notes).trim();
            const cur = isEmpty(row.data.notes) ? '' : String(row.data.notes);
            if (!cur.includes(incoming)) patch.notes = cur ? `${cur}\n${incoming}` : incoming;
          }
          const dataKeys = Object.keys(patch).filter((k) => k !== 'address_key');
          // Attach a flyer to an existing row that has none (same PATCH).
          if (flyer && isEmpty(row.data.flyer_url)) {
            const url = await doUpload(flyer);
            if (url) { patch.flyer_url = url; photosAdded++; }
          }
          if (Object.keys(patch).length) {
            await patchRow(row.id, patch);
            for (const [k, v] of Object.entries(patch)) row.data[k] = v;
            if (dataKeys.length) { enriched++; fieldsEnriched += dataKeys.length; }
          }
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
    enriched,
    fieldsEnriched,
    records: toInsert,
  };
}
