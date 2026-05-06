/**
 * SABOR RESO Web API client
 * Handles authentication, token caching, and data fetching from the
 * San Antonio Board of Realtors RESO OData v4 API.
 *
 * Docs:  https://api-sabor.connectmls.com/reso/webapi/
 * Auth:  https://sabor-auth.connectmls.com/authenticate/signin
 */

const AUTH_URL  = 'https://sabor-auth.connectmls.com/authenticate/signin';
const API_BASE  = 'https://api-sabor.connectmls.com/reso/webapi';

// ─── In-memory token cache ────────────────────────────────────────────────────
// Vercel serverless functions are stateless, but token caching within the same
// warm instance avoids hammering the auth endpoint on every request.
let _cachedToken: string | null = null;
let _tokenExpiry = 0;

// ─── RESO Data Types ──────────────────────────────────────────────────────────

export interface ResoProperty {
  ListingKey: string;
  ListingId?: string;
  StandardStatus: 'Active' | 'Pending' | 'Closed' | 'Expired' | 'Withdrawn' | 'CancelledByMutualAgreement' | string;
  MlsStatus?: string;
  ListPrice: number;
  OriginalListPrice?: number;
  ClosePrice?: number;
  CloseDate?: string;
  ListingContractDate?: string;
  OnMarketDate?: string;
  ModificationTimestamp?: string;
  StatusChangeTimestamp?: string;
  // Location
  UnparsedAddress?: string;
  StreetNumber?: string;
  StreetDirPrefix?: string;
  StreetName?: string;
  StreetSuffix?: string;
  UnitNumber?: string;
  City?: string;
  StateOrProvince?: string;
  PostalCode?: string;
  CountyOrParish?: string;
  SubdivisionName?: string;
  Latitude?: number;
  Longitude?: number;
  // Property details
  PropertyType?: string;
  PropertySubType?: string;
  BedsTotal?: number;
  BathroomsTotalInteger?: number;
  BathroomsFull?: number;
  BathroomsHalf?: number;
  LivingArea?: number;
  BuildingAreaTotal?: number;
  LotSizeAcres?: number;
  LotSizeSquareFeet?: number;
  YearBuilt?: number;
  StoriesTotal?: number;
  GarageSpaces?: number;
  Cooling?: string;
  Heating?: string;
  // Financial
  TaxAnnualAmount?: number;
  TaxYear?: number;
  AssociationFee?: number;
  AssociationFeeFrequency?: string;
  // Agent / office
  ListAgentKey?: string;
  ListAgentMlsId?: string;
  ListAgentFullName?: string;
  ListAgentEmail?: string;
  ListAgentDirectPhone?: string;
  ListOfficeKey?: string;
  ListOfficeMlsId?: string;
  ListOfficeName?: string;
  // Content
  PublicRemarks?: string;
  // Media
  MediaCount?: number;
  Media?: ResoMedia[];
}

export interface ResoMedia {
  MediaKey?: string;
  ResourceRecordKey?: string;
  MediaURL?: string;
  MediaType?: string;
  MediaCategory?: string;
  Order?: number;
  PreferredPhotoYN?: boolean;
  ImageHeight?: number;
  ImageWidth?: number;
  ImageSizeDescription?: string;
  ModificationTimestamp?: string;
}

export interface ResoResponse<T> {
  '@odata.context'?: string;
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  value: T[];
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function authenticate(): Promise<string> {
  // Return cached token if still valid (with 2-min buffer)
  if (_cachedToken && Date.now() < _tokenExpiry - 120_000) {
    return _cachedToken;
  }

  const username = process.env.SABOR_RESO_USERNAME;
  const password = process.env.SABOR_RESO_PASSWORD;

  if (!username || !password) {
    throw new Error('SABOR_RESO_USERNAME and SABOR_RESO_PASSWORD env vars are required');
  }

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ Username: username, Password: password }),
  });

  if (!res.ok) {
    throw new Error(`SABOR auth failed: HTTP ${res.status}`);
  }

  const data = await res.json();

  // The JWT token field name may vary — handle common variants
  const token: string =
    data.access_token ?? data.accessToken ?? data.token ?? data.jwt ?? data.id_token;
  if (!token) {
    throw new Error('SABOR auth succeeded but no token found in response: ' + JSON.stringify(data));
  }

  const expiresIn: number = data.expires_in ?? data.expiresIn ?? 3600;

  _cachedToken = token;
  _tokenExpiry = Date.now() + expiresIn * 1000;

  return token;
}

// ─── Generic fetch helper ─────────────────────────────────────────────────────

async function resoFetch<T>(path: string, params: Record<string, string> = {}): Promise<ResoResponse<T>> {
  const token = await authenticate();

  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}/${path}${qs ? '?' + qs : ''}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    },
    // Prevent Next.js from caching MLS data at the fetch level
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`RESO API error ${res.status} for ${url}: ${body}`);
  }

  return res.json();
}

// ─── Property queries ─────────────────────────────────────────────────────────

export interface PropertySearchOptions {
  /** OData $filter expression, e.g. "City eq 'San Antonio' and StandardStatus eq 'Active'" */
  filter?: string;
  /** Fields to select — defaults to a comprehensive set */
  select?: string;
  /** Max records per page (default 200, max varies by MLS) */
  top?: number;
  /** Skip N records (for pagination) */
  skip?: number;
  /** Order by field, e.g. "ModificationTimestamp desc" */
  orderby?: string;
  /** Include @odata.count in response */
  count?: boolean;
  /** Expand related resources inline, e.g. "Media" */
  expand?: string;
}

const DEFAULT_SELECT = [
  'ListingKey', 'ListingId', 'StandardStatus', 'MlsStatus',
  'ListPrice', 'OriginalListPrice', 'ClosePrice', 'CloseDate',
  'ListingContractDate', 'OnMarketDate', 'ModificationTimestamp',
  'UnparsedAddress', 'StreetNumber', 'StreetDirPrefix', 'StreetName',
  'StreetSuffix', 'UnitNumber', 'City', 'StateOrProvince', 'PostalCode',
  'CountyOrParish', 'SubdivisionName', 'Latitude', 'Longitude',
  'PropertyType', 'PropertySubType',
  'BedsTotal', 'BathroomsTotalInteger', 'BathroomsFull', 'BathroomsHalf',
  'LivingArea', 'LotSizeAcres', 'LotSizeSquareFeet', 'YearBuilt',
  'StoriesTotal', 'GarageSpaces',
  'TaxAnnualAmount', 'AssociationFee', 'AssociationFeeFrequency',
  'ListAgentFullName', 'ListAgentEmail', 'ListAgentDirectPhone',
  'ListOfficeName', 'MediaCount',
  'PublicRemarks',
].join(',');

export async function searchProperties(opts: PropertySearchOptions = {}): Promise<ResoResponse<ResoProperty>> {
  const params: Record<string, string> = {
    $select: opts.select ?? DEFAULT_SELECT,
    $top: String(opts.top ?? 200),
  };
  if (opts.filter)  params['$filter']  = opts.filter;
  if (opts.skip)    params['$skip']    = String(opts.skip);
  if (opts.orderby) params['$orderby'] = opts.orderby;
  if (opts.count)   params['$count']   = 'true';
  if (opts.expand)  params['$expand']  = opts.expand;

  return resoFetch<ResoProperty>('Property', params);
}

/**
 * Fetch all pages of a property search, auto-following @odata.nextLink
 * until all results are collected (or maxPages is reached).
 */
export async function searchPropertiesAll(
  opts: PropertySearchOptions = {},
  maxPages = 20
): Promise<ResoProperty[]> {
  const all: ResoProperty[] = [];
  let page = 0;
  let skip = opts.skip ?? 0;

  while (page < maxPages) {
    const res = await searchProperties({ ...opts, skip, top: opts.top ?? 200 });
    all.push(...res.value);
    page++;

    // No more pages
    if (!res['@odata.nextLink'] || res.value.length < (opts.top ?? 200)) break;
    skip += (opts.top ?? 200);
  }

  return all;
}

// ─── Media queries ────────────────────────────────────────────────────────────

export async function getMediaForListing(listingKey: string): Promise<ResoMedia[]> {
  const res = await resoFetch<ResoMedia>('Media', {
    $filter: `ResourceRecordKey eq '${listingKey}' and ResourceName eq 'Property'`,
    $orderby: 'Order asc',
    $select: 'MediaKey,ResourceRecordKey,MediaURL,MediaType,MediaCategory,Order,PreferredPhotoYN,ImageHeight,ImageWidth,ImageSizeDescription',
    $top: '50',
  });
  return res.value;
}

/**
 * Fetch media for multiple listings in batches of 20 to avoid overly long URLs.
 * Returns a map of ListingKey → MediaURL[]
 */
export async function getMediaBatch(listingKeys: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const BATCH = 20;

  for (let i = 0; i < listingKeys.length; i += BATCH) {
    const chunk = listingKeys.slice(i, i + BATCH);
    const filterKeys = chunk.map(k => `'${k}'`).join(',');
    try {
      const res = await resoFetch<ResoMedia>('Media', {
        $filter: `ResourceRecordKey in (${filterKeys}) and ResourceName eq 'Property'`,
        $orderby: 'Order asc',
        $select: 'ResourceRecordKey,MediaURL,Order,PreferredPhotoYN,MediaCategory',
        $top: '500',
      });
      for (const m of res.value) {
        if (!m.ResourceRecordKey || !m.MediaURL) continue;
        if (m.MediaCategory && m.MediaCategory !== 'Photo') continue;
        const arr = map.get(m.ResourceRecordKey) ?? [];
        arr.push(m.MediaURL);
        map.set(m.ResourceRecordKey, arr);
      }
    } catch (err) {
      console.error('Media batch fetch error:', err);
    }
  }

  return map;
}

// ─── Property → Listing mapper ────────────────────────────────────────────────

/**
 * Convert a RESO Property record into the shape expected by the `listings` table.
 * `images` is populated separately after media fetch.
 */
export function resoPropertyToListing(p: ResoProperty, images: string[] = []) {
  const streetParts = [p.StreetNumber, p.StreetDirPrefix, p.StreetName, p.StreetSuffix]
    .filter(Boolean).join(' ');
  const address = p.UnparsedAddress ?? streetParts;
  const unit = p.UnitNumber ? ` #${p.UnitNumber}` : '';
  const fullAddress = `${address}${unit}`;
  const city   = p.City ?? '';
  const state  = p.StateOrProvince ?? 'TX';
  const zip    = p.PostalCode ?? '';

  const statusMap: Record<string, string> = {
    Active: 'active',
    Pending: 'pending',
    Closed: 'sold',
    Expired: 'off-market',
    Withdrawn: 'off-market',
    CancelledByMutualAgreement: 'off-market',
  };
  const status = statusMap[p.StandardStatus] ?? 'off-market';

  const title = fullAddress || p.ListingId || p.ListingKey;
  const slug  = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    + '-' + p.ListingKey.slice(-6);

  return {
    listing_key:            p.ListingKey,
    mls_number:             p.ListingId ?? null,
    title,
    slug,
    price:                  p.ListPrice ?? 0,
    address:                fullAddress,
    city,
    state,
    zip,
    status,
    standard_status:        p.StandardStatus ?? null,
    mls_status:             p.MlsStatus ?? null,
    close_price:            p.ClosePrice ?? null,
    close_date:             p.CloseDate ?? null,
    bedrooms:               p.BedsTotal ?? 0,
    bathrooms:              p.BathroomsTotalInteger ?? (p.BathroomsFull ?? 0) + (p.BathroomsHalf ? 0.5 : 0),
    sqft:                   p.LivingArea ?? 0,
    lot_size:               p.LotSizeAcres ? `${p.LotSizeAcres} ac` : (p.LotSizeSquareFeet ? `${p.LotSizeSquareFeet} sqft` : null),
    lot_size_acres:         p.LotSizeAcres ?? null,
    year_built:             p.YearBuilt ?? null,
    property_type:          (p.PropertySubType ?? p.PropertyType ?? 'Residential').toLowerCase().replace(/\s+/g, '-'),
    subdivision_name:       p.SubdivisionName ?? null,
    garage_spaces:          p.GarageSpaces ?? null,
    latitude:               p.Latitude ?? null,
    longitude:              p.Longitude ?? null,
    hoa_fee:                p.AssociationFee ?? null,
    hoa_frequency:          p.AssociationFeeFrequency ?? null,
    tax_annual_amount:      p.TaxAnnualAmount ?? null,
    list_agent_name:        p.ListAgentFullName ?? null,
    list_agent_email:       p.ListAgentEmail ?? null,
    list_agent_phone:       p.ListAgentDirectPhone ?? null,
    list_office_name:       p.ListOfficeName ?? null,
    description:            p.PublicRemarks ?? null,
    images:                 images.length > 0 ? images : null,
    modification_timestamp: p.ModificationTimestamp ?? null,
    listing_date:           p.OnMarketDate ?? p.ListingContractDate ?? null,
    source:                 'mls',
    synced_at:              new Date().toISOString(),
  };
}
