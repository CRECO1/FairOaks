/**
 * SABOR RESO Web API client
 * Handles authentication, token caching, and data fetching from the
 * San Antonio Board of Realtors RESO OData v4 API.
 *
 * Docs:  https://api-sabor.connectmls.com/reso/webapi/
 * Auth:  https://sabor-auth.connectmls.com/authenticate/signin
 *
 * Field notes (confirmed against live API):
 *  - Primary key is ListingId (numeric string), NOT ListingKey
 *  - Bedrooms field is BedroomsTotal, not BedsTotal
 *  - StandardStatus is an OData enum — filter with ODataService.StandardStatus'ACTIVE'
 *  - City, MlsStatus are also enum types — filter via contains() or avoid filtering them
 *  - ListAgentFullName is absent — build from ListAgentFirstName + ListAgentLastName
 *  - ListAgentEmail is absent — use ListAgentCellPhone / ListAgentOfficePhone
 *  - Media ResourceRecordID matches ListingId (not ResourceRecordKey)
 */

const AUTH_URL = 'https://sabor-auth.connectmls.com/authenticate/signin';
const API_BASE = 'https://api-sabor.connectmls.com/reso/webapi';

// OData enum namespace prefix used for filter expressions
const ENUM = 'ODataService.StandardStatus';

// ─── In-memory token cache ────────────────────────────────────────────────────
let _cachedToken: string | null = null;
let _tokenExpiry = 0;

// ─── RESO Data Types ──────────────────────────────────────────────────────────

export interface ResoProperty {
  // Primary identifier — SABOR uses ListingId as the unique key
  ListingId: string;
  // Coordinates (returned by SABOR if available)
  Latitude?: number;
  Longitude?: number;
  // Status
  StandardStatus: string;  // enum: 'ACTIVE' | 'ACTIVE_UNDER_CONTRACT' | 'CLOSED' | 'EXPIRED' | 'HOLD' | etc.
  MlsStatus?: string;      // 'ACT' | 'PND' | 'SLD' etc.
  // Price
  ListPrice: number;
  OriginalListPrice?: number;
  CloseDate?: string;
  // Dates
  ListingContractDate?: string;
  OnMarketDate?: string;
  ModificationTimestamp?: string;
  StatusChangeTimestamp?: string;
  // Location
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
  // Property details — SABOR-specific field names
  PropertyType?: string;           // 'RR' = Residential, 'CO' = Condo, 'CM' = Commercial, etc.
  PropertySubType_RR?: string;     // 'SFDET' = Single Family Detached, etc.
  BedroomsTotal?: number;          // NOTE: not BedsTotal
  BathroomsFull?: number;
  BathroomsHalf?: number;
  LivingArea?: number;
  LotSizeAcres?: number;
  YearBuilt?: number;
  StoriesTotal?: number;
  GarageSpaces?: number;
  // Financial
  TaxAnnualAmount?: number;
  AssociationFee?: number;
  // Agent / office — SABOR splits name into First+Last, no email field
  ListAgentFirstName?: string;
  ListAgentLastName?: string;
  ListAgentMlsId?: string;
  ListAgentCellPhone?: string;
  ListAgentOfficePhone?: string;
  ListOfficeName?: string;
  // Content
  PublicRemarks?: string;
  PhotosCount?: number;
  // Media (populated separately)
  Media?: ResoMedia[];
}

export interface ResoMedia {
  MediaKey?: string;
  ResourceRecordID?: string;   // matches ListingId
  ResourceRecordKey?: string;  // internal hex key
  MediaURL?: string;
  Order?: number;
  ImageHeight?: number;
  ImageWidth?: number;
  ModificationTimestamp?: string;
}

export interface ResoResponse<T> {
  '@odata.context'?: string;
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  value: T[];
}

// ─── Status filter helpers ────────────────────────────────────────────────────

/** Build an OData enum filter expression for StandardStatus.
 *  SABOR does not support `in` for enum types — use `or` conditions instead.
 */
export function statusFilter(statuses: string[]): string {
  const parts = statuses.map(s => `StandardStatus eq ${ENUM}'${s}'`);
  return parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`;
}

/** Active + Pending (under contract) listings */
export const ACTIVE_FILTER = statusFilter(['ACTIVE', 'ACTIVE_UNDER_CONTRACT']);

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

  const basic = Buffer.from(`${username}:${password}`).toString('base64');

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    },
    // Body must be empty per SABOR vendor instructions
  });

  if (!res.ok) {
    throw new Error(`SABOR auth failed: HTTP ${res.status}`);
  }

  const data = await res.json();

  const token: string =
    data.access_token ?? data.accessToken ?? data.token ?? data.jwt ?? data.id_token;
  if (!token) {
    throw new Error('SABOR auth succeeded but no token found in response: ' + JSON.stringify(data));
  }

  // Token expires_in is seconds; SABOR JWTs are ~24h
  const expiresIn: number = data.expires_in ?? data.expiresIn ?? 86400;

  _cachedToken = token;
  _tokenExpiry = Date.now() + expiresIn * 1000;

  return token;
}

// ─── Generic fetch helper ─────────────────────────────────────────────────────

async function resoFetch<T>(path: string, params: Record<string, string> = {}): Promise<ResoResponse<T>> {
  const token = await authenticate();

  // SABOR requires literal $ in OData param names ($select, $filter, etc.)
  // URLSearchParams encodes $ → %24 which SABOR rejects as "URI is malformed"
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `${API_BASE}/${path}${qs ? '?' + qs : ''}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    },
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
  filter?: string;
  select?: string;
  top?: number;
  skip?: number;
  orderby?: string;
  count?: boolean;
  expand?: string;
}

// Note: ClosePrice and StreetSuffix are not valid SABOR fields — omit to avoid 400
const DEFAULT_SELECT = [
  'ListingId', 'StandardStatus', 'MlsStatus',
  'ListPrice', 'OriginalListPrice', 'CloseDate',
  'ListingContractDate', 'OnMarketDate', 'ModificationTimestamp',
  'StreetNumber', 'StreetDirPrefix', 'StreetName',
  'UnitNumber', 'City', 'StateOrProvince', 'PostalCode',
  'CountyOrParish', 'SubdivisionName',
  'PropertyType', 'PropertySubType_RR',
  'BedroomsTotal', 'BathroomsFull', 'BathroomsHalf',
  'LivingArea', 'LotSizeAcres', 'YearBuilt',
  'StoriesTotal', 'GarageSpaces',
  'TaxAnnualAmount', 'AssociationFee',
  'ListAgentFirstName', 'ListAgentLastName', 'ListAgentMlsId',
  'ListAgentCellPhone', 'ListAgentOfficePhone', 'ListOfficeName',
  'PhotosCount', 'PublicRemarks',
  'Latitude', 'Longitude',
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
 * Fetch all pages of a property search, auto-following @odata.nextLink.
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
    if (!res['@odata.nextLink'] || res.value.length < (opts.top ?? 200)) break;
    skip += (opts.top ?? 200);
  }

  return all;
}

// ─── Media queries ────────────────────────────────────────────────────────────

/**
 * Fetch media for multiple listings in batches of 20.
 * SABOR: use ResourceRecordID (= ListingId) not ResourceRecordKey.
 * Returns a map of ListingId → MediaURL[]
 */
export async function getMediaBatch(listingIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  // SABOR ResourceRecordID doesn't support `in` filter — use `or` conditions
  // Keep batches small to avoid URL length limits
  const BATCH = 10;

  for (let i = 0; i < listingIds.length; i += BATCH) {
    const chunk = listingIds.slice(i, i + BATCH);
    // Build filter as: (ResourceRecordID eq 'X' or ResourceRecordID eq 'Y' ...)
    const filterExpr = chunk.map(k => `ResourceRecordID eq '${k}'`).join(' or ');
    const filter = chunk.length === 1 ? filterExpr : `(${filterExpr})`;
    try {
      const res = await resoFetch<ResoMedia>('Media', {
        $filter: filter,
        $orderby: 'Order asc',
        $select: 'ResourceRecordID,MediaURL,Order,ImageHeight,ImageWidth',
        $top: '500',
      });
      for (const m of res.value) {
        if (!m.ResourceRecordID || !m.MediaURL) continue;
        const arr = map.get(m.ResourceRecordID) ?? [];
        arr.push(m.MediaURL);
        map.set(m.ResourceRecordID, arr);
      }
    } catch (err) {
      console.error('Media batch fetch error:', err);
    }
  }

  return map;
}

// ─── Property → Listing mapper ────────────────────────────────────────────────

export function resoPropertyToListing(p: ResoProperty, images: string[] = []) {
  const streetParts = [p.StreetNumber, p.StreetDirPrefix, p.StreetName, p.StreetSuffix]
    .filter(Boolean).join(' ');
  const unit = p.UnitNumber ? ` #${p.UnitNumber}` : '';
  const fullAddress = `${streetParts}${unit}`.trim();
  // SABOR city enum values are all-caps with NO spaces (e.g. "SANANTONIO", "FAIROAKSRANCH").
  // Map known compound city names back to proper display form.
  // SABOR City enum values strip spaces and truncate to ~10 chars.
  // Map confirmed enum member names → proper display strings.
  const CITY_MAP: Record<string, string> = {
    FAIROAKSRA:   'Fair Oaks Ranch',
    SANANTONIO:   'San Antonio',
    GREYFOREST:   'Grey Forest',
    NEWBRAUNFE:   'New Braunfels',
    FREDERICKS:   'Fredericksburg',
    UNIVERSALC:   'Universal City',
    SPRINGBRAN:   'Spring Branch',
    CASTROVILL:   'Castroville',
    LIVEOAK:      'Live Oak',
    STONEOAK:     'Stone Oak',
    BULVERDE:     'Bulverde',
    HELOTES:      'Helotes',
    BOERNE:       'Boerne',
    CONVERSE:     'Converse',
    KERRVILLE:    'Kerrville',
    CIBOLO:       'Cibolo',
    LAVERNIA:     'La Vernia',
    SATTLER:      'Sattler',
    TARPLEY:      'Tarpley',
  };
  const rawCity = (p.City ?? '').toUpperCase().replace(/\s+/g, '');
  const city = CITY_MAP[rawCity]
    ?? (p.City ?? '').replace(/\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  const state = p.StateOrProvince ?? 'TX';
  const zip = p.PostalCode ?? '';

  // Map SABOR StandardStatus enum values → our internal status strings
  const statusMap: Record<string, string> = {
    ACTIVE: 'active',
    ACTIVE_UNDER_CONTRACT: 'pending',
    COMING_SOON: 'active',
    HOLD: 'pending',
    CLOSED: 'sold',
    EXPIRED: 'off-market',
    CANCELED: 'off-market',
    WITHDRAWN: 'off-market',
    DELETE: 'off-market',
  };
  const status = statusMap[p.StandardStatus] ?? 'off-market';

  const agentName = [p.ListAgentFirstName, p.ListAgentLastName].filter(Boolean).join(' ') || null;
  const agentPhone = p.ListAgentCellPhone ?? p.ListAgentOfficePhone ?? null;

  const title = fullAddress || p.ListingId;
  // Full ListingId appended so detail page can reliably extract it from the slug
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + '-' + p.ListingId;

  const bathrooms = (p.BathroomsFull ?? 0) + (p.BathroomsHalf ? 0.5 : 0);

  return {
    listing_key:            p.ListingId,
    mls_number:             p.ListingId,
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
    close_date:             p.CloseDate ?? null,
    bedrooms:               p.BedroomsTotal ?? 0,
    bathrooms,
    sqft:                   p.LivingArea ?? 0,
    lot_size:               p.LotSizeAcres ? `${p.LotSizeAcres} ac` : null,
    lot_size_acres:         p.LotSizeAcres ?? null,
    year_built:             p.YearBuilt ?? null,
    property_type:          (p.PropertySubType_RR ?? p.PropertyType ?? 'RR').toLowerCase(),
    subdivision_name:       p.SubdivisionName ?? null,
    garage_spaces:          p.GarageSpaces ?? null,
    hoa_fee:                p.AssociationFee ?? null,
    tax_annual_amount:      p.TaxAnnualAmount ?? null,
    list_agent_name:        agentName,
    list_agent_email:       null,
    list_agent_phone:       agentPhone,
    list_office_name:       p.ListOfficeName ?? null,
    description:            p.PublicRemarks ?? null,
    images:                 images.length > 0 ? images : null,
    modification_timestamp: p.ModificationTimestamp ?? null,
    listing_date:           p.OnMarketDate ?? p.ListingContractDate ?? null,
    latitude:               p.Latitude ?? null,
    longitude:              p.Longitude ?? null,
    source:                 'mls',
    synced_at:              new Date().toISOString(),
  };
}
