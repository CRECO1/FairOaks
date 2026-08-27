/**
 * Claude-vision extraction: one broker email -> one JSON Extraction object.
 *
 * Per email we send Claude the subject, plain-text body, sender, date, and any
 * inline/attached flyer images. The street address is frequently ONLY in the image,
 * so vision is essential. Claude is instructed to be conservative and NEVER invent
 * an address, price, size, or zip.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ASSET_TYPES, type AssetType, type Extraction, type FetchedEmail } from './types';

/** Haiku: vision-capable + the cheapest tier, to keep the crawl's API spend low.
 *  Overridable via BROKER_INGEST_MODEL (set to a Sonnet id if extraction quality
 *  on messy flyers regresses). */
export const MODEL = process.env.BROKER_INGEST_MODEL || 'claude-haiku-4-5-20251001';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const SYSTEM = `You are a data-extraction engine for a commercial real estate CRM in the San Antonio / South Texas market. You read a single commercial-real-estate broker "available space" email (subject, body, sender, date, and any attached/inline flyer images) and return exactly ONE JSON object describing the primary listed property.

Return ONLY the JSON object, no prose, no markdown fences. Shape:
{
  "is_listing": boolean,
  "name": string|null,
  "address": string|null,
  "suite": string|null,
  "city": string|null,
  "state": string|null,
  "zip": string|null,
  "asset_type": "Retail"|"Industrial"|"Office"|"Flex"|"Mixed-Use"|"Land"|"Medical"|null,
  "size_sf": number|null,
  "asking_rate": string|null,
  "listing_company": string|null,
  "listing_agent_name": string|null,
  "listing_agent_phone": string|null,
  "notes": string|null,
  "property_subtype": string|null,
  "building_class": string|null,
  "year_built": number|null,
  "lot_size_acres": number|null,
  "office_sf": number|null,
  "clear_height_ft": number|null,
  "dock_doors": number|null,
  "grade_doors": number|null,
  "power": string|null,
  "sprinklered": string|null,
  "zoning": string|null,
  "elevator": true|false|null,
  "listing_type": "For Sale"|"For Lease"|"Both"|null,
  "transaction_status": "Available"|"Under Contract"|"Sold"|"Leased"|"Off-Market"|null,
  "sale_price": number|null,
  "price_per_sf": number|null,
  "lease_rate_min": number|null,
  "lease_rate_max": number|null,
  "lease_type": "NNN"|"FSG"|"MG"|"IG"|null,
  "opex_psf": number|null,
  "available_sf": number|null,
  "divisible": boolean|null,
  "highlights": string[]|null,
  "brochure_url": string|null,
  "available_date": string|null
}

RULES:
- Be conservative. NEVER invent an address, price, size, or zip. If a field is not clearly stated in the text or visible in the image, set it to null.
- The street address is often ONLY in the flyer image — read the image carefully for it.
- "is_listing" must be false for: marketplace/portal digests (Crexi, LoopNet, CommercialSearch roundups of many listings), tenant-need / buyer-need broadcasts ("client looking for..."), the recipient's own back-and-forth deal threads, newsletters, event invites, and pure "under contract" / "sold" / "leased" notices. Set is_listing=false and leave the rest null for these.
- "name": the building or property display name (e.g. "Cornerstone Industrial Park 4"). If there is no distinct name, use the street address.
- "address": street line only (number + street), NOT city/state/zip and NOT the suite.
- "suite": suite/unit number only, or null.
- "asset_type": choose EXACTLY one of the seven allowed values. Map warehouse/distribution/logistics/IOS -> "Industrial"; office+showroom+warehouse combos -> "Flex"; unsure -> "Office".
- "size_sf": total available square feet as a plain number (no commas, no units). For a range use the total/max available. Land-only sizes given in acres go in notes, not here (unless a building SF is stated).
- "asking_rate": free text exactly as marketed, e.g. "For Sale $1,550,000 / Lease $13.25/SF NNN" or "$18.00/SF NNN" or "For Sale $2,400,000". null if not stated.
- "listing_company" / "listing_agent_name" / "listing_agent_phone": the listing broker firm and the primary listing agent + phone. If multiple listing agents, put the primary one here and mention the others in notes.
- Structured spec fields — fill from the text/flyer ONLY when clearly stated, else null (NEVER invent):
  - "property_subtype" (Warehouse/Distribution, Flex, Strip Center, Freestanding, Medical Office…); "building_class" (A/B/C only).
  - "year_built" (int); "lot_size_acres" (number); "office_sf"; "clear_height_ft" (number); "dock_doors"/"grade_doors" (counts); "power" (e.g. "3-phase / 800A"); "sprinklered" (e.g. "ESFR"); "zoning" (e.g. "I-1"); "elevator" (true only if the flyer states one, false if it says none, else null).
  - "listing_type" ("For Sale"/"For Lease"/"Both"); "transaction_status" ("Available" unless clearly Under Contract/Sold/Leased/Off-Market).
  - "sale_price" (USD number); "price_per_sf" (sale $/SF); "lease_rate_min"/"lease_rate_max" ($/SF/yr — set both equal if a single rate); "lease_type" (NNN/FSG/MG/IG); "opex_psf".
  - "available_sf"; "divisible" (true if subdividable); "available_date" (ISO date only if a specific date given).
  - "highlights" (array of short marketed bullet strings, or null); "brochure_url" (a PDF flyer link in the body, or null).
- "notes": ONLY facts with no field above — co-brokers (name+phone), per-suite breakdown, unusual terms, and the email date. Do not duplicate the structured fields. Keep concise.`;

type Block =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string };
    };

/** Map a raw asset_type guess onto the allowed enum; defaults to Office. */
export function coerceAssetType(raw: string | null | undefined): AssetType | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const exact = ASSET_TYPES.find((t) => t.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const l = s.toLowerCase();
  if (/(warehouse|distribution|logistic|\bios\b|industrial|manufactur)/.test(l)) return 'Industrial';
  if (/(flex|showroom)/.test(l)) return 'Flex';
  if (/(retail|restaurant|storefront)/.test(l)) return 'Retail';
  if (/(medical|dental|health)/.test(l)) return 'Medical';
  if (/(land|acre|pad site|ground lease)/.test(l)) return 'Land';
  if (/(mixed)/.test(l)) return 'Mixed-Use';
  if (/office/.test(l)) return 'Office';
  return 'Office';
}

function parseJsonObject(text: string): any {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found in model output');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function boolOrNull(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['true', 'yes', 'y'].includes(t)) return true;
    if (['false', 'no', 'n'].includes(t)) return false;
  }
  return null;
}

function strArrayOrNull(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length);
  return arr.length ? arr : null;
}

/** Normalize/validate the raw model output into a well-typed Extraction. */
export function normalizeExtraction(raw: any): Extraction {
  const isListing = raw?.is_listing === true;
  return {
    is_listing: isListing,
    name: strOrNull(raw?.name),
    address: strOrNull(raw?.address),
    suite: strOrNull(raw?.suite),
    city: strOrNull(raw?.city),
    state: strOrNull(raw?.state),
    zip: strOrNull(raw?.zip),
    asset_type: coerceAssetType(strOrNull(raw?.asset_type)),
    size_sf: toNumberOrNull(raw?.size_sf),
    asking_rate: strOrNull(raw?.asking_rate),
    listing_company: strOrNull(raw?.listing_company),
    listing_agent_name: strOrNull(raw?.listing_agent_name),
    listing_agent_phone: strOrNull(raw?.listing_agent_phone),
    notes: strOrNull(raw?.notes),
    property_subtype: strOrNull(raw?.property_subtype),
    building_class: strOrNull(raw?.building_class),
    year_built: toNumberOrNull(raw?.year_built),
    lot_size_acres: toNumberOrNull(raw?.lot_size_acres),
    office_sf: toNumberOrNull(raw?.office_sf),
    clear_height_ft: toNumberOrNull(raw?.clear_height_ft),
    dock_doors: toNumberOrNull(raw?.dock_doors),
    grade_doors: toNumberOrNull(raw?.grade_doors),
    power: strOrNull(raw?.power),
    sprinklered: strOrNull(raw?.sprinklered),
    zoning: strOrNull(raw?.zoning),
    elevator: typeof raw?.elevator === 'boolean' ? raw.elevator : null,
    listing_type: strOrNull(raw?.listing_type),
    transaction_status: strOrNull(raw?.transaction_status),
    sale_price: toNumberOrNull(raw?.sale_price),
    price_per_sf: toNumberOrNull(raw?.price_per_sf),
    lease_rate_min: toNumberOrNull(raw?.lease_rate_min),
    lease_rate_max: toNumberOrNull(raw?.lease_rate_max),
    lease_type: strOrNull(raw?.lease_type),
    opex_psf: toNumberOrNull(raw?.opex_psf),
    available_sf: toNumberOrNull(raw?.available_sf),
    divisible: boolOrNull(raw?.divisible),
    highlights: strArrayOrNull(raw?.highlights),
    brochure_url: strOrNull(raw?.brochure_url),
    available_date: strOrNull(raw?.available_date),
  };
}

/** Send one email to Claude and return the normalized Extraction. */
export async function extractListing(email: FetchedEmail): Promise<Extraction> {
  const content: Block[] = [
    {
      type: 'text',
      text: [
        `SUBJECT: ${email.subject}`,
        `FROM: ${email.from}`,
        `DATE: ${email.date}`,
        '',
        'BODY:',
        (email.body || '(no text body)').slice(0, 12000),
        '',
        email.images.length
          ? `(${email.images.length} flyer image(s) attached below — read them for the address and specs.)`
          : '(no images attached)',
      ].join('\n'),
    },
  ];

  for (const img of email.images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mimeType, data: img.data },
    });
  }

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: 'user', content: content as Anthropic.MessageParam['content'] }],
  });

  const textBlock = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const text = textBlock?.text ?? '';
  return normalizeExtraction(parseJsonObject(text));
}

/**
 * Extract a single listing from uploaded flyer media (image(s) or a PDF) instead
 * of an email — powers the agent-facing "Add Property from a flyer" feature.
 * Reuses the SAME system prompt, model, and normalizer as the email pipeline, so
 * the two extraction paths stay consistent.
 */
export async function extractListingFromMedia(
  media: Array<{ kind: 'image' | 'pdf'; mimeType: string; data: string }>,
): Promise<Extraction> {
  const content: unknown[] = [
    {
      type: 'text',
      text:
        'The following is a commercial real estate property flyer / marketing sheet an agent uploaded to add to the CRM. ' +
        'Extract the ONE primary listed property per your instructions. Read every image and page carefully — the street ' +
        'address, size, price, and broker contact are frequently only in the graphics. If a field is not shown, use null.',
    },
  ];
  for (const m of media) {
    if (m.kind === 'pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m.data } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: m.mimeType, data: m.data } });
    }
  }

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: 'user', content: content as Anthropic.MessageParam['content'] }],
  });

  const textBlock = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  return normalizeExtraction(parseJsonObject(textBlock?.text ?? ''));
}

/** Parse a JSON array from model output; returns [] on any failure (never throws). */
function parseJsonArray(text: string): any[] {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const DIGEST_SYSTEM = `You are a data-extraction engine for a commercial real estate CRM (San Antonio / South Texas). You read ONE email and decide whether it is a MARKETPLACE DIGEST — a roundup that lists MULTIPLE distinct commercial properties in a single email (e.g. Crexi "recommended for you" / "featured listings", LoopNet roundups, CommercialSearch / CommercialCafe digests).

Return ONLY a JSON array (no prose, no markdown fences):
- If it IS a multi-listing digest: return one object per DISTINCT property shown. Digests are sparse — usually just a name, a general location, a property type, and a size or price. Extract only what is actually shown; NEVER invent an address, price, size, or zip.
- If it is NOT a multi-listing digest (a single-property email, a tenant/buyer "looking for" broadcast, a newsletter, an event invite, a sold/leased/under-contract notice, or the recipient's own deal thread): return [].

Each object:
{
  "name": string|null,          // listing title / property name exactly as shown
  "address": string|null,       // street line ONLY if explicitly shown, else null (digests often omit it)
  "city": string|null,
  "state": string|null,
  "zip": string|null,
  "asset_type": "Retail"|"Industrial"|"Office"|"Flex"|"Mixed-Use"|"Land"|"Medical"|null,
  "size_sf": number|null,       // plain number if a single building size is shown, else null
  "asking_rate": string|null,   // free text as shown, e.g. "$18.00/SF NNN" or "$1,550,000", else null
  "listing_company": string|null,
  "notes": string|null          // anything else short & useful: submarket, $/SF, broker, "For Sale/Lease"
}

Map asset_type to EXACTLY one of the seven allowed values (warehouse/distribution/IOS -> Industrial; office+warehouse -> Flex; unsure -> null). Ignore anything that isn't commercial real estate.`;

/**
 * Multi-listing DIGEST path. A broker "available space" email is one property, but a
 * marketplace roundup (Crexi/LoopNet/CommercialCafe "recommended"/"featured") packs
 * many — and extractListing() marks those is_listing=false and drops them. This reads
 * the same email and returns EVERY listing in it (thin: name/location/type/size).
 * Returns [] for anything that isn't a genuine multi-listing digest.
 */
export async function extractDigestListings(email: FetchedEmail): Promise<Extraction[]> {
  const content: Block[] = [
    {
      type: 'text',
      text: [
        `SUBJECT: ${email.subject}`,
        `FROM: ${email.from}`,
        `DATE: ${email.date}`,
        '',
        'BODY:',
        (email.body || '(no text body)').slice(0, 16000),
      ].join('\n'),
    },
  ];
  // Some digests are image-based; give the model a few images but keep the call cheap.
  for (const img of email.images.slice(0, 4)) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
  }

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: DIGEST_SYSTEM,
    messages: [{ role: 'user', content: content as Anthropic.MessageParam['content'] }],
  });

  const textBlock = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const rows = parseJsonArray(textBlock?.text ?? '');
  const out: Extraction[] = [];
  for (const raw of rows) {
    const ex = normalizeExtraction({ ...raw, is_listing: true });
    if (!ex.name && !ex.address) continue; // nothing to key on
    // South/Central Texas brokerage — drop the out-of-state deals national digests
    // slip in (net-lease etc.). A blank state is assumed local and kept.
    const st = (ex.state || '').trim().toLowerCase();
    if (st && st !== 'tx' && st !== 'texas') continue;
    ex.notes = ex.notes ? `[Digest] ${ex.notes}` : '[Digest — thin data, verify]';
    out.push(ex);
  }
  return out;
}
