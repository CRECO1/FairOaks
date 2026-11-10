// The county-appraisal block the Property DB appends to a property's notes (see the county enrichment job):
//   [County Appraisal · BCAD 2025] Owner: BROWN MARK A & LAURA L; Market $403,740 (land $199,560 / imp $204,180); 1.53 ac;
//   Parcel 34780-002-0114; Use RES; Legal: CB 34780A LOT NW 255.6 FT …
// Read it back into fields so the deal card can show them. Pure and forgiving: a part that isn't there is simply left out.

export interface CountyAppraisal {
  /** "BCAD 2025" — which appraisal district, and which tax year. */
  source: string;
  owner?: string;
  market?: number;
  land?: number;
  improvements?: number;
  acres?: number;
  parcel?: string;
  use?: string;
  legal?: string;
}

const money = (s?: string) => { const n = s ? Number(s.replace(/[^0-9.]/g, '')) : NaN; return Number.isFinite(n) && n > 0 ? n : undefined; };

export function parseCountyAppraisal(notes?: string | null): CountyAppraisal | null {
  const m = /\[County Appraisal\s*[·\-–]\s*([^\]]+)\]\s*([^\n]*)/.exec(String(notes ?? ''));
  if (!m) return null;
  const body = m[2];
  const get = (re: RegExp) => re.exec(body)?.[1]?.trim();
  const out: CountyAppraisal = { source: m[1].trim().replace(/\s+/g, ' ') };
  const owner = get(/Owner:\s*([^;]+?)\s*(?:;|$)/); if (owner) out.owner = owner;
  const market = money(get(/Market\s*(\$[\d,]+)/)); if (market) out.market = market;
  const land = money(get(/land\s*(\$[\d,]+)/i)); if (land) out.land = land;
  const imp = money(get(/imp(?:rovements?)?\s*(\$[\d,]+)/i)); if (imp) out.improvements = imp;
  const ac = get(/([\d.]+)\s*ac\b/i); if (ac && Number(ac) > 0) out.acres = Number(ac);
  const parcel = get(/Parcel\s*([^;]+?)\s*(?:;|$)/); if (parcel) out.parcel = parcel;
  const use = get(/\bUse\s+([A-Z0-9]{2,6})\b/); if (use) out.use = use;
  const legal = get(/Legal:\s*(.+)$/); if (legal) out.legal = legal.slice(0, 160);
  return out;
}

/** "BCAD" → a plain name for the footer; unknown codes are shown as written. */
export const COUNTY_NAME: Record<string, string> = { BCAD: 'Bexar County', 'Kendall CAD': 'Kendall County', 'Comal CAD': 'Comal County', 'Guadalupe CAD': 'Guadalupe County', DCAD: 'Dallas County' };
