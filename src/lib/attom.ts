/**
 * ATTOM Data API client
 * Docs: https://api.developer.attomdata.com
 * Auth: apikey header
 *
 * Sign up for a free 30-day trial at https://www.attomdata.com/solutions/property-data-api/
 * Add ATTOM_API_KEY to your .env.local / Vercel environment variables.
 */

const BASE = 'https://api.developer.attomdata.com/propertyapi/v1.0.0';

async function attomFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.ATTOM_API_KEY;
  if (!key) throw new Error('ATTOM_API_KEY not configured');

  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      apikey: key,
      accept: 'application/json',
    },
    next: { revalidate: 3600 }, // cache 1 hour
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ATTOM ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AttomPropertyDetail {
  identifier: {
    attomId: number;
    fips: string;
    apn: string;
  };
  address: {
    line1: string;
    line2: string;
    oneLine: string;
  };
  summary: {
    propclass: string;
    proptype: string;
    yearbuilt: number;
    propLandUse: string;
    propIndicator: string;
  };
  building?: {
    size?: { universalsize?: number; livingsize?: number };
    rooms?: { beds?: number; bathstotal?: number };
    interior?: { fplcind?: string };
    parking?: { garagetype?: string; prkgSize?: number };
  };
  lot?: {
    lotsize1?: number;
    lotsize2?: number;
  };
  assessment?: {
    assessed?: { assdttlvalue?: number; assdlandvalue?: number; assdimprvalue?: number };
    market?: { mktttlvalue?: number; mktlandvalue?: number; mktimprvalue?: number };
    tax?: { taxamt?: number; taxyear?: number };
  };
  sale?: {
    amount?: { saleamt?: number };
    calculation?: { pricepersizeunit?: number };
    salesearchdate?: string;
  };
}

export interface AttomSaleComp {
  identifier: { attomId: number };
  address: { oneLine: string; line1: string; line2: string };
  summary: { proptype: string; yearbuilt?: number };
  building?: { size?: { universalsize?: number } };
  sale?: {
    amount?: { saleamt?: number };
    salesearchdate?: string;
    calculation?: { pricepersizeunit?: number };
  };
}

export interface PropertyIntel {
  detail: AttomPropertyDetail | null;
  comps: AttomSaleComp[];
  error?: string;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/** Parse a full address string into address1 + address2 for ATTOM */
export function parseAddress(fullAddress: string): { address1: string; address2: string } {
  // Try to split on last comma-separated city/state portion
  // e.g. "123 Main St, San Antonio, TX 78201" → address1="123 Main St", address2="San Antonio, TX 78201"
  const parts = fullAddress.split(',').map(p => p.trim());
  if (parts.length >= 3) {
    return {
      address1: parts[0],
      address2: parts.slice(1).join(', '),
    };
  }
  // fallback: split at first comma
  const idx = fullAddress.indexOf(',');
  if (idx > 0) {
    return {
      address1: fullAddress.slice(0, idx).trim(),
      address2: fullAddress.slice(idx + 1).trim(),
    };
  }
  return { address1: fullAddress, address2: '' };
}

/** Fetch full property detail for a given address */
export async function getPropertyDetail(address1: string, address2: string): Promise<AttomPropertyDetail | null> {
  try {
    const data = await attomFetch<{ property: AttomPropertyDetail[] }>('/property/detail', {
      address1,
      address2,
    });
    return data.property?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Fetch nearby sale comps within radius miles */
export async function getSaleComps(
  address1: string,
  address2: string,
  radius = '0.25',
  pagesize = '6',
): Promise<AttomSaleComp[]> {
  try {
    const data = await attomFetch<{ property: AttomSaleComp[] }>('/sale/snapshot', {
      address1,
      address2,
      radius,
      pagesize,
    });
    return data.property ?? [];
  } catch {
    return [];
  }
}

/** Fetch both detail + comps in parallel */
export async function getPropertyIntel(fullAddress: string): Promise<PropertyIntel> {
  try {
    const { address1, address2 } = parseAddress(fullAddress);
    if (!address1) return { detail: null, comps: [], error: 'Invalid address' };

    const [detail, comps] = await Promise.all([
      getPropertyDetail(address1, address2),
      getSaleComps(address1, address2),
    ]);

    return { detail, comps };
  } catch (err: any) {
    return { detail: null, comps: [], error: err.message ?? String(err) };
  }
}
