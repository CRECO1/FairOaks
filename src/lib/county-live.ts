// Live county-appraisal lookup by street address — free public GIS, no key. Bexar County (San Antonio) only for now.
// The Bexar Appraisal District's official parcel layer answers owner, parcel number, legal description and DBA for any street address; it
// does NOT give a current appraised value ("N/A" until the year is certified), so none is shown from here. See the county-appraisal-enrichment
// notes for the other counties' services (Kendall / Comal / Dallas) if they are added later.

const BEXAR = 'https://maps.bcad.org/arcgis/rest/services/PAMapSearch/MapServer/6/query';
const PFX = 'PAMaps.dbo.web_map_property.';
const DIRECTIONAL = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

export interface CountyParcel { parcel: string; propId?: number; legal?: string; dba?: string; use?: string; appraised?: number }
export interface CountyLive { county: string; source: string; year?: number; owner: string; situs: string; parcels: CountyParcel[] }

/** "7830 Louis Pasteur Dr" → { num: '7830', core: 'LOUIS' }. Null when it does not start with a street number. */
export function streetParts(address: string): { num: string; core: string } | null {
  if (!/^\s*\d{1,6}\s+[A-Za-z]/.test(String(address ?? ''))) return null;   // "5,000-7,000 SF warehouse…" is a size, not a street number
  const toks = String(address ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!toks.length || !/^\d{1,6}$/.test(toks[0])) return null;
  const core = toks.slice(1).find(t => !DIRECTIONAL.has(t) && /^[a-z0-9]{3,}$/.test(t));
  return core ? { num: toks[0], core: core.toUpperCase() } : null;
}

type Raw = { attributes?: Record<string, unknown> };

export async function lookupBexar(address: string): Promise<CountyLive | null> {
  const p = streetParts(address);
  if (!p) return null;
  const where = `${PFX}situs LIKE '${p.num} %${p.core.replace(/'/g, "''")}%'`;
  const url = `${BEXAR}?${new URLSearchParams({ where, outFields: '*', returnGeometry: 'false', resultRecordCount: '12', f: 'json' })}`;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j = (await r.json()) as { features?: Raw[]; error?: unknown };
    if (j.error || !Array.isArray(j.features)) return null;
    const rows = j.features.map(f => Object.fromEntries(Object.entries(f.attributes ?? {}).map(([k, v]) => [k.split('.').pop() as string, v])));
    // Only rows whose site address really starts with this street number and street (the LIKE is loose).
    const ok = rows.filter(a => new RegExp(`^${p.num}\\s+(?:[NSEW]{1,2}\\s+)?${p.core}`, 'i').test(String(a.situs ?? '')));
    if (!ok.length) return null;
    const val = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : undefined; };
    const owners = [...new Set(ok.map(a => String(a.owner_name ?? '').trim()).filter(Boolean))];
    return {
      county: 'Bexar County', source: 'Bexar Appraisal District (BCAD)',
      year: Number(ok[0].prop_val_yr) || undefined,
      owner: owners.join(' · ') || '',
      situs: String(ok[0].situs ?? '').trim(),
      parcels: ok.slice(0, 6).map(a => ({
        parcel: String(a.geo_id ?? '').trim(), propId: Number(a.pacs_prop_id) || undefined,
        legal: String(a.legal_desc ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) || undefined,
        dba: String(a.dba_name ?? '').trim() || undefined, use: String(a.prop_type_desc ?? '').trim() || undefined, appraised: val(a.appraised_val),
      })),
    };
  } catch { return null; } finally { clearTimeout(timer); }
}
