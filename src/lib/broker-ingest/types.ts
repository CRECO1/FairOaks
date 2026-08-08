/**
 * Shared types for the broker-email -> Claude-extraction -> CRM ingestion pipeline.
 *
 * Reads commercial-real-estate broker "available space" listing emails from the
 * already-connected Gmail account (zack@crecotx.com) and inserts new buildings
 * into crm_prospective_properties (business_unit = 'commercial').
 */

/** The only asset_type values crm_prospective_properties accepts. */
export const ASSET_TYPES = [
  'Retail',
  'Industrial',
  'Office',
  'Flex',
  'Mixed-Use',
  'Land',
  'Medical',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

/** A base64 image (inline or attachment) pulled from a Gmail message. */
export interface GmailImage {
  /** One of image/jpeg | image/png | image/gif | image/webp (Claude-vision supported). */
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** Standard (non-URL-safe) base64. */
  data: string;
}

/** A fetched Gmail message reduced to what the extractor needs. */
export interface FetchedEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  /** RFC 2822 Date header, as-is. */
  date: string;
  /** Plain-text body (HTML stripped when only HTML is present). */
  body: string;
  /** Inline/attached flyer images, base64. */
  images: GmailImage[];
}

/**
 * The JSON contract Claude returns for each email. Be conservative: unknown -> null.
 * `is_listing=false` for marketplace digests, tenant-need broadcasts, the recipient's
 * own deal threads, and pure under-contract/sold notices (pipeline SKIPS these).
 */
export interface Extraction {
  is_listing: boolean;
  name: string | null;
  address: string | null;
  suite: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  asset_type: AssetType | null;
  size_sf: number | null;
  asking_rate: string | null;
  listing_company: string | null;
  listing_agent_name: string | null;
  listing_agent_phone: string | null;
  notes: string | null;
  // ── rich fields (fill only when clearly present in the email/flyer) ──
  property_subtype: string | null;   // Warehouse/Distribution, Flex, Strip Center, Medical, …
  building_class: string | null;     // A / B / C
  year_built: number | null;
  lot_size_acres: number | null;
  office_sf: number | null;
  clear_height_ft: number | null;
  dock_doors: number | null;
  grade_doors: number | null;
  power: string | null;              // e.g. "3-phase / 800A"
  sprinklered: string | null;        // e.g. "ESFR", "wet", "none"
  zoning: string | null;
  listing_type: string | null;       // "For Sale" | "For Lease" | "Both"
  transaction_status: string | null; // "Available" | "Under Contract" | "Sold" | "Leased" | "Off-Market"
  sale_price: number | null;         // USD
  price_per_sf: number | null;       // USD/SF (sale)
  lease_rate_min: number | null;     // $/SF/yr
  lease_rate_max: number | null;     // $/SF/yr
  lease_type: string | null;         // NNN | FSG | MG | IG
  opex_psf: number | null;           // $/SF/yr
  available_sf: number | null;
  divisible: boolean | null;
  highlights: string[] | null;
  brochure_url: string | null;
  available_date: string | null;     // ISO date if a specific availability date is stated
}

/**
 * A row ready to POST to crm_prospective_properties. EVERY record MUST carry the
 * identical set of keys (PostgREST bulk insert rejects mismatched keys with
 * PGRST102 "All object keys must match"), so unused fields are set to null.
 */
export interface PropertyRecord {
  name: string | null;
  address: string | null;
  suite: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  asset_type: AssetType;
  size_sf: number | null;
  vacancy_status: 'vacant';
  asking_rate: string | null;
  listing_company: string | null;
  listing_agent_name: string | null;
  listing_agent_phone: string | null;
  source: 'broker_email';
  notes: string | null;
  business_unit: 'commercial';
  created_by: string;
  last_status_at: string;
  // ── rich fields (nullable columns added by property-db-schema.sql) ──
  property_subtype: string | null;
  building_class: string | null;
  year_built: number | null;
  lot_size_acres: number | null;
  office_sf: number | null;
  clear_height_ft: number | null;
  dock_doors: number | null;
  grade_doors: number | null;
  power: string | null;
  sprinklered: string | null;
  zoning: string | null;
  listing_type: string | null;
  transaction_status: string | null;
  sale_price: number | null;
  price_per_sf: number | null;
  lease_rate_min: number | null;
  lease_rate_max: number | null;
  lease_type: string | null;
  opex_psf: number | null;
  available_sf: number | null;
  divisible: boolean | null;
  highlights: string[] | null;
  brochure_url: string | null;
  available_date: string | null;
  address_key: string | null;
}
