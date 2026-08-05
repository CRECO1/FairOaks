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

/** Vision-capable, cost-effective; overridable via BROKER_INGEST_MODEL. */
export const MODEL = process.env.BROKER_INGEST_MODEL || 'claude-sonnet-4-6';

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
- "notes": concise, readable free text for specs that have no dedicated column — dock doors, clear height, power, zoning, year built, co-brokers, per-suite breakdown, acreage, and the email date. Not templated; just the useful facts.`;

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
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: content as Anthropic.MessageParam['content'] }],
  });

  const textBlock = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const text = textBlock?.text ?? '';
  return normalizeExtraction(parseJsonObject(text));
}
