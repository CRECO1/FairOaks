'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

const PropertyMap = dynamic(() => import('./PropertyMap'), {
  ssr: false,
  loading: () => <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>Loading map…</div>,
});

// ── Types ────────────────────────────────────────────────────────────────────
// Mirrors crm_prospective_properties (the broker-ingested Property DB). Only the
// fields the UI reads are typed; the row carries ~89 columns so we keep an index.
interface Property {
  id: string;
  business_unit: string;
  name?: string;
  address?: string;
  suite?: string;
  city?: string;
  state?: string;
  zip?: string;
  asset_type?: string;
  property_subtype?: string;
  building_class?: string;
  size_sf?: number | null;
  available_sf?: number | null;
  vacancy_status?: string;
  listing_type?: string;
  asking_rate?: string | number | null;
  sale_price?: number | null;
  price_per_sf?: number | null;
  cap_rate?: number | null;
  listing_company?: string;
  listing_agent_name?: string;
  listing_agent_phone?: string;
  submarket?: string;
  county?: string;
  year_built?: number | null;
  clear_height_ft?: number | null;
  dock_doors?: number | null;
  grade_doors?: number | null;
  parking_spaces?: number | null;
  zoning?: string;
  owner_name?: string;
  description?: string;
  highlights?: string;
  notes?: string;
  brochure_url?: string;
  flyer_url?: string;
  listing_url?: string;
  floorplan_url?: string;
  virtual_tour_url?: string;
  source?: string;
  tags?: string[] | string | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at?: string;
  [k: string]: unknown;
}

interface Props {
  businessUnit: string;
  isAdmin: boolean;
  authToken?: string;
  onToast: (msg: string) => void;
  onCount?: (n: number) => void;
  isMobile?: boolean;
}

const ASSET_COLORS: Record<string, { bg: string; color: string }> = {
  Retail:      { bg: '#fef3c7', color: '#b45309' },
  Office:      { bg: '#dbeafe', color: '#1d4ed8' },
  Industrial:  { bg: '#f1f5f9', color: '#475569' },
  Land:        { bg: '#dcfce7', color: '#15803d' },
  Multifamily: { bg: '#f3e8ff', color: '#7e22ce' },
  'Mixed-Use': { bg: '#fce7f3', color: '#be185d' },
  Medical:     { bg: '#cffafe', color: '#0e7490' },
  Flex:        { bg: '#fff7ed', color: '#c2410c' },
};

function assetStyle(a?: string) {
  return ASSET_COLORS[a ?? ''] ?? { bg: '#f1f5f9', color: '#475569' };
}
function fmtSf(n?: number | null) { return n ? `${Number(n).toLocaleString()} SF` : ''; }
function fmt$(n?: number | null) {
  if (n == null) return '';
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Number(n).toLocaleString()}`;
}
function fmtRate(r?: string | number | null) {
  if (r == null || r === '') return '';
  return typeof r === 'number' ? `$${r}` : String(r);
}
function cityLine(p: Property) {
  return [p.city, p.state].filter(Boolean).join(', ') + (p.zip ? ` ${p.zip}` : '');
}
function statusPill(s?: string) {
  const v = (s || '').toLowerCase();
  if (/vacan|avail/.test(v)) return { bg: '#dcfce7', color: '#15803d' };
  if (/leas|occup|sold|pend/.test(v)) return { bg: '#dbeafe', color: '#1d4ed8' };
  return { bg: '#f1f5f9', color: '#64748b' };
}
const muted = <span style={{ color: '#d1d5db' }}>—</span>;

export default function PropertyDBSection({ businessUnit, authToken, onToast, onCount, isMobile = false }: Props) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [assetFilter, setAssetFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [active, setActive]     = useState<Property | null>(null);
  const [view, setView]         = useState<'rows' | 'cards' | 'map'>('rows');
  const [sort, setSort]         = useState<{ key: string; dir: 1 | -1 }>({ key: '', dir: 1 });
  const [sourceFilter, setSourceFilter]   = useState('');
  const [listingFilter, setListingFilter] = useState('');
  const [page, setPage]         = useState(1);
  const PAGE_SIZE = 50;

  const authHeaders = useMemo<Record<string, string>>(
    () => {
      const h: Record<string, string> = {};
      if (authToken) h.Authorization = `Bearer ${authToken}`;
      return h;
    },
    [authToken],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/property-db?business_unit=${businessUnit}`, { headers: authHeaders });
      const json = await res.json();
      const list = json.properties ?? [];
      setProperties(list);
      onCount?.(list.length);
    } catch {
      onToast('Could not load the Property DB');
    }
    setLoading(false);
  }, [businessUnit, authHeaders, onToast, onCount]);

  useEffect(() => { load(); }, [load]);

  const assetTypes = useMemo(
    () => Array.from(new Set(properties.map(p => p.asset_type).filter(Boolean))).sort() as string[],
    [properties],
  );
  const statuses = useMemo(
    () => Array.from(new Set(properties.map(p => p.vacancy_status).filter(Boolean))).sort() as string[],
    [properties],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return properties.filter(p => {
      if (assetFilter && p.asset_type !== assetFilter) return false;
      if (statusFilter && p.vacancy_status !== statusFilter) return false;
      if (sourceFilter) {
        const s = (p.source || '').toLowerCase();
        if (sourceFilter === 'loopnet' && !s.includes('loopnet')) return false;
        if (sourceFilter === 'crexi' && !s.includes('crexi')) return false;
        if (sourceFilter === 'broker' && (s.includes('loopnet') || s.includes('crexi'))) return false;
      }
      if (listingFilter) {
        const lt = (p.listing_type || '').toLowerCase();
        if (listingFilter === 'lease' && !(lt.includes('lease') || lt.includes('both'))) return false;
        if (listingFilter === 'sale'  && !(lt.includes('sale')  || lt.includes('both'))) return false;
      }
      if (!q) return true;
      return [p.name, p.address, p.city, p.submarket, p.listing_company, p.listing_agent_name]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [properties, search, assetFilter, statusFilter, sourceFilter, listingFilter]);

  const rateNum = (p: Property): number => {
    if (p.sale_price != null) return p.sale_price;
    if (typeof p.asking_rate === 'number') return p.asking_rate;
    const n = parseFloat(String(p.asking_rate ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : -1;
  };
  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const val = (p: Property): string | number => {
      switch (sort.key) {
        case 'name': return (p.name || p.address || '').toLowerCase();
        case 'submarket': return (p.submarket || p.city || '').toLowerCase();
        case 'type': return (p.asset_type || '').toLowerCase();
        case 'size': return p.size_sf ?? -1;
        case 'rate': return rateNum(p);
        case 'status': return (p.vacancy_status || '').toLowerCase();
        default: return 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * sort.dir;
      if (va > vb) return 1 * sort.dir;
      return 0;
    });
  }, [filtered, sort]); // eslint-disable-line

  // Render-side pagination: the list/cards views draw only the current page so
  // the DOM stays light at 1000s of rows. The map view still plots every match.
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const paged = useMemo(() => sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE), [sorted, pageClamped]);
  // Any filter/search/sort change resets to page 1.
  useEffect(() => { setPage(1); }, [search, assetFilter, statusFilter, sourceFilter, listingFilter, sort]);

  const sortTh = (key: string, label: string, align: 'left' | 'right' = 'left') => (
    <th onClick={() => setSort(s => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }))}
      style={{ padding: '12px 12px', fontWeight: 700, textAlign: align, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: sort.key === key ? '#b07d1f' : '#9ca3af' }}>
      {label}<span style={{ opacity: sort.key === key ? 1 : 0.3 }}>{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ' ↕'}</span>
    </th>
  );

  const inputStyle: React.CSSProperties = {
    padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14,
    fontFamily: "'DM Sans',sans-serif", background: '#fff', color: '#111',
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 10 }}>
        <input
          placeholder="🔍  Search address, city, submarket, broker…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 320px', minWidth: 220 }}
        />
        <select value={assetFilter} onChange={e => setAssetFilter(e.target.value)} style={{ ...inputStyle, ...(isMobile ? { flex: '1 1 0', minWidth: 0 } : {}) }}>
          <option value="">All Types</option>
          {assetTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, ...(isMobile ? { flex: '1 1 0', minWidth: 0 } : {}) }}>
          <option value="">All Statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={listingFilter} onChange={e => setListingFilter(e.target.value)} style={{ ...inputStyle, ...(isMobile ? { flex: '1 1 0', minWidth: 0 } : {}) }}>
          <option value="">Lease &amp; Sale</option>
          <option value="lease">For Lease</option>
          <option value="sale">For Sale</option>
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{ ...inputStyle, ...(isMobile ? { flex: '1 1 0', minWidth: 0 } : {}) }} title="Where the listing came from">
          <option value="">All Sources</option>
          <option value="broker">Broker / Calls</option>
          <option value="loopnet">LoopNet</option>
          <option value="crexi">Crexi</option>
        </select>
        <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', ...(isMobile ? { width: '100%' } : {}) }}>
          {(['rows', 'cards', 'map'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: isMobile ? '11px 10px' : '9px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", background: view === v ? '#c9922c' : '#fff', color: view === v ? '#fff' : '#6b7280', ...(isMobile ? { flex: 1, minHeight: 44 } : {}) }}>
              {v === 'rows' ? '☰ List' : v === 'cards' ? '▦ Cards' : '📍 Map'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14, fontWeight: 600 }}>
        {loading ? 'Loading…' : `${filtered.length}${filtered.length !== properties.length ? ` of ${properties.length}` : ''} propert${filtered.length === 1 ? 'y' : 'ies'} in the Property DB`}
      </div>

      {/* Grid */}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '60px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🏢</div>
          No properties match. Broker-DB listings arrive automatically from your Gmail “Property DB” label.
        </div>
      )}

      {/* ── Mobile list view — the 7-column table needs ~960px, so a phone gets
             a dense card per property with the same fields, no pinch-zoom. ── */}
      {view === 'rows' && !loading && filtered.length > 0 && isMobile && (
        <div>
          {/* Sorting lives in the table headers on desktop; on mobile it needs its own control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, flexShrink: 0 }}>Sort</span>
            <select
              value={sort.key}
              onChange={e => setSort({ key: e.target.value, dir: 1 })}
              style={{ ...inputStyle, flex: 1, minWidth: 0, minHeight: 44 }}
            >
              <option value="">Default order</option>
              <option value="name">Property</option>
              <option value="submarket">Submarket</option>
              <option value="type">Type</option>
              <option value="size">Size</option>
              <option value="rate">Rate / Price</option>
              <option value="status">Status</option>
            </select>
            <button
              onClick={() => setSort(s => ({ key: s.key || 'name', dir: (s.dir === 1 ? -1 : 1) as 1 | -1 }))}
              aria-label={sort.dir === 1 ? 'Sort ascending' : 'Sort descending'}
              style={{ minWidth: 44, minHeight: 44, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#6b7280', fontSize: 15, cursor: 'pointer', flexShrink: 0 }}
            >
              {sort.dir === 1 ? '↑' : '↓'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {paged.map(p => {
              const as = assetStyle(p.asset_type);
              const st = statusPill(p.vacancy_status);
              const price = p.listing_type === 'Sale' || p.sale_price ? fmt$(p.sale_price) : fmtRate(p.asking_rate);
              const loc = [p.address, cityLine(p)].filter(Boolean).join(' · ');
              const avail = p.available_sf && p.available_sf !== p.size_sf ? p.available_sf : null;
              return (
                <button key={p.id} onClick={() => setActive(p)}
                  style={{ textAlign: 'left', width: '100%', background: '#fff', border: '1px solid #eef0f2', borderLeft: `4px solid ${as.color}`, borderRadius: 12, padding: '14px 15px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.25 }}>{p.name || p.address || '—'}</div>
                      {loc && <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 2 }}>{loc}</div>}
                    </div>
                    {price && <div style={{ fontSize: 15, fontWeight: 700, color: '#b07d1f', whiteSpace: 'nowrap', flexShrink: 0 }}>{price}</div>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' }}>
                    {p.asset_type && <span style={{ fontSize: 11.5, fontWeight: 600, background: as.bg, color: as.color, padding: '3px 9px', borderRadius: 20 }}>{p.asset_type}</span>}
                    {p.vacancy_status && <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: .3, textTransform: 'uppercase', color: st.color, background: st.bg, padding: '3px 9px', borderRadius: 20 }}>{p.vacancy_status}</span>}
                    {p.size_sf ? <span style={{ fontSize: 12.5, color: '#374151' }}>{fmtSf(p.size_sf)}</span> : null}
                    {avail ? <span style={{ fontSize: 12, color: '#9ca3af' }}>{fmtSf(avail)} avail</span> : null}
                  </div>
                  {(p.submarket || p.county || p.listing_company || p.listing_agent_name) && (
                    <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid #f3f4f6', fontSize: 12, color: '#9ca3af', display: 'flex', flexWrap: 'wrap', gap: '3px 12px' }}>
                      {p.submarket && <span>📍 {p.submarket}{p.county ? ` · ${p.county} Co.` : ''}</span>}
                      {(p.listing_agent_name || p.listing_company) && <span>🏷 {[p.listing_agent_name, p.listing_company].filter(Boolean).join(' · ')}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {view === 'rows' && !loading && filtered.length > 0 && !isMobile && (
        <div style={{ overflowX: 'auto', border: '1px solid #eef0f2', borderRadius: 12, background: '#fff' }}>
          <table style={{ width: '100%', minWidth: 960, borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: "'DM Sans',sans-serif" }}>
            <colgroup>
              <col style={{ width: '26%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 10.5, letterSpacing: .7, textTransform: 'uppercase', borderBottom: '1px solid #eef0f2' }}>
                {sortTh('name', 'Property')}
                {sortTh('submarket', 'Submarket')}
                {sortTh('type', 'Type')}
                {sortTh('size', 'Size', 'right')}
                {sortTh('rate', 'Rate / Price', 'right')}
                <th style={{ padding: '12px 12px', fontWeight: 700, color: '#9ca3af' }}>Broker</th>
                {sortTh('status', 'Status')}
              </tr>
            </thead>
            <tbody>
              {paged.map(p => {
                const as = assetStyle(p.asset_type);
                const price = p.listing_type === 'Sale' || p.sale_price ? fmt$(p.sale_price) : fmtRate(p.asking_rate);
                const st = statusPill(p.vacancy_status);
                const loc = [p.address, cityLine(p)].filter(Boolean).join(' · ');
                const avail = p.available_sf && p.available_sf !== p.size_sf ? p.available_sf : null;
                const ell: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
                return (
                  <tr key={p.id} onClick={() => setActive(p)}
                    style={{ borderTop: '1px solid #f4f5f7', cursor: 'pointer', background: '#fff' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fbf8f1')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                    <td style={{ padding: '12px 12px 12px 16px', verticalAlign: 'top' }}>
                      <div style={{ ...ell, fontWeight: 600, color: '#1a1a1a', fontSize: 14 }} title={p.name || p.address || ''}>{p.name || p.address || '—'}</div>
                      <div style={{ ...ell, color: '#9ca3af', fontSize: 12.5, marginTop: 2 }} title={loc}>{loc || '—'}</div>
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top', color: '#374151', fontSize: 13 }}>
                      <div style={ell} title={p.submarket || ''}>{p.submarket || muted}</div>
                      {p.county && <div style={{ ...ell, color: '#9ca3af', fontSize: 11.5, marginTop: 1 }} title={p.county}>{p.county} Co.</div>}
                    </td>
                    <td style={{ padding: '12px 10px', verticalAlign: 'top' }}>
                      {p.asset_type ? <span style={{ display: 'inline-block', maxWidth: '100%', ...ell, fontSize: 11.5, fontWeight: 600, background: as.bg, color: as.color, padding: '3px 9px', borderRadius: 20 }} title={p.asset_type}>{p.asset_type}</span> : muted}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', verticalAlign: 'top' }}>
                      <div style={{ color: '#374151', fontSize: 13.5, whiteSpace: 'nowrap' }}>{fmtSf(p.size_sf) || muted}</div>
                      {avail && <div style={{ color: '#9ca3af', fontSize: 11.5, marginTop: 1, whiteSpace: 'nowrap' }}>{fmtSf(avail)} avail</div>}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, color: price ? '#b07d1f' : '#d1d5db', fontSize: 13, ...ell, verticalAlign: 'top' }} title={String(price || '')}>{price || '—'}</td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top' }}>
                      <div style={{ ...ell, color: '#374151', fontSize: 13 }} title={p.listing_company || ''}>{p.listing_company || muted}</div>
                      {p.listing_agent_name && <div style={{ ...ell, color: '#9ca3af', fontSize: 12, marginTop: 1 }} title={p.listing_agent_name}>{p.listing_agent_name}</div>}
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top' }}>
                      {p.vacancy_status ? <span style={{ display: 'inline-block', maxWidth: '100%', ...ell, fontSize: 10.5, fontWeight: 700, letterSpacing: .3, textTransform: 'uppercase', color: st.color, background: st.bg, padding: '3px 9px', borderRadius: 20 }} title={p.vacancy_status}>{p.vacancy_status}</span> : muted}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === 'cards' && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {paged.map(p => {
          const as = assetStyle(p.asset_type);
          const price = p.listing_type === 'Sale' || p.sale_price ? fmt$(p.sale_price) : fmtRate(p.asking_rate);
          return (
            <button
              key={p.id}
              onClick={() => setActive(p)}
              style={{
                textAlign: 'left', background: '#fff', border: '1px solid #eef0f2', borderRadius: 12,
                padding: 0, cursor: 'pointer', overflow: 'hidden', fontFamily: "'DM Sans',sans-serif",
                boxShadow: '0 1px 2px rgba(0,0,0,.04)', transition: 'box-shadow .15s, transform .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,.09)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,.04)'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ height: 4, background: as.color }} />
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 19, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.15 }}>
                    {p.name || p.address || 'Untitled property'}
                  </div>
                  {p.vacancy_status && (
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#15803d', background: '#dcfce7', padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                      {p.vacancy_status}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 3 }}>
                  {[p.address, p.suite].filter(Boolean).join(', ')}
                  {(p.address || p.suite) && cityLine(p) ? ' · ' : ''}{cityLine(p)}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
                  {p.asset_type && (
                    <span style={{ fontSize: 12, fontWeight: 600, background: as.bg, color: as.color, padding: '2px 9px', borderRadius: 5 }}>
                      {p.asset_type}{p.property_subtype ? ` · ${p.property_subtype}` : ''}
                    </span>
                  )}
                  {p.size_sf ? <span style={{ fontSize: 12, color: '#374151' }}>{fmtSf(p.size_sf)}</span> : null}
                  {price ? <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: '#c9922c' }}>{price}</span> : null}
                </div>
                {(p.listing_company || p.listing_agent_name) && (
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 10, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
                    {p.listing_agent_name}{p.listing_agent_name && p.listing_company ? ' · ' : ''}{p.listing_company}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      )}

      {/* Pagination (list + cards; the map plots all matches) */}
      {(view === 'rows' || view === 'cards') && !loading && sorted.length > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 18, fontFamily: "'DM Sans',sans-serif" }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageClamped <= 1}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: pageClamped <= 1 ? '#f9fafb' : '#fff', color: pageClamped <= 1 ? '#c7cbd1' : '#374151', fontSize: 13, fontWeight: 700, cursor: pageClamped <= 1 ? 'default' : 'pointer' }}>← Prev</button>
          <span style={{ fontSize: 13, color: '#6b7280', minWidth: 150, textAlign: 'center' }}>
            {(pageClamped - 1) * PAGE_SIZE + 1}–{Math.min(pageClamped * PAGE_SIZE, sorted.length)} of {sorted.length.toLocaleString()} · page {pageClamped}/{totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={pageClamped >= totalPages}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: pageClamped >= totalPages ? '#f9fafb' : '#fff', color: pageClamped >= totalPages ? '#c7cbd1' : '#374151', fontSize: 13, fontWeight: 700, cursor: pageClamped >= totalPages ? 'default' : 'pointer' }}>Next →</button>
        </div>
      )}

      {view === 'map' && !loading && (
        <div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10 }}>
            {filtered.filter(p => p.latitude != null && p.longitude != null).length} of {filtered.length} shown — properties without a geocoded address aren’t on the map yet. Click a pin for details.
          </div>
          <PropertyMap properties={sorted} onSelect={(p) => setActive(p as Property)} />
        </div>
      )}

      {active && <DetailModal p={active} onClose={() => setActive(null)} isMobile={isMobile} />}
    </div>
  );
}

// ── Detail modal ─────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  const display = Array.isArray(value) ? value.join(', ') : String(value);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: .5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#1f2937', marginTop: 2 }}>{display}</div>
    </div>
  );
}

function fieldHasValue(node: React.ReactNode): boolean {
  if (!React.isValidElement(node)) return false;
  if (node.type === Field) {
    const v = (node.props as { value?: unknown }).value;
    return !(v == null || v === '' || (Array.isArray(v) && v.length === 0));
  }
  const ch = (node.props as { children?: React.ReactNode })?.children;
  return React.Children.toArray(ch).some(fieldHasValue);
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  if (!React.Children.toArray(children).some(fieldHasValue)) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0 20px' }}>{children}</div>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value?: string | null; accent?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ background: accent ? '#fdf6e9' : '#f8fafc', borderRadius: 10, padding: '12px 14px', border: `1px solid ${accent ? '#f0e2c4' : '#eef0f2'}` }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: accent ? '#a06a12' : '#1a1a1a', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={value}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginTop: 5 }}>{label}</div>
    </div>
  );
}

function DetailModal({ p, onClose, isMobile = false }: { p: Property; onClose: () => void; isMobile?: boolean }) {
  const as = assetStyle(p.asset_type);
  const st = statusPill(p.vacancy_status);
  const isSale = p.listing_type === 'Sale' || p.sale_price != null;
  const priceVal = isSale ? (p.sale_price ? fmt$(p.sale_price) : null) : (fmtRate(p.asking_rate) || null);
  const links: [string, unknown][] = [
    ['Brochure', p.brochure_url], ['Flyer', p.flyer_url], ['Listing', p.listing_url],
    ['Floor plan', p.floorplan_url], ['Virtual tour', p.virtual_tour_url],
  ];
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-end' : 'flex-start', padding: isMobile ? 0 : '5vh 16px', overflowY: isMobile ? 'hidden' : 'auto' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', maxWidth: isMobile ? '100%' : 800, width: '100%', boxShadow: '0 24px 70px rgba(0,0,0,.32)', fontFamily: "'DM Sans',sans-serif",
          borderRadius: isMobile ? '18px 18px 0 0' : 16,
          ...(isMobile ? { maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom)' } : {}),
        }}
      >
        <div style={{ height: 6, background: as.color, borderTopLeftRadius: isMobile ? 18 : 16, borderTopRightRadius: isMobile ? 18 : 16, flexShrink: 0 }} />
        <div style={{ padding: isMobile ? '18px 18px 24px' : 28, ...(isMobile ? { overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, minHeight: 0 } : {}) }}>
          {/* Header — the close button stays pinned at the top of the sheet on a phone */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', ...(isMobile ? { position: 'sticky', top: 0, background: '#fff', paddingBottom: 8, zIndex: 2 } : {}) }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: isMobile ? 23 : 28, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.15 }}>
                {p.name || p.address || 'Property'}
              </div>
              <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
                {[p.address, p.suite].filter(Boolean).join(', ')}{(p.address || p.suite) && cityLine(p) ? ' · ' : ''}{cityLine(p)}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, width: isMobile ? 44 : 34, height: isMobile ? 44 : 34, cursor: 'pointer', fontSize: 18, color: '#6b7280', flexShrink: 0 }}>✕</button>
          </div>

          {/* Badges */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0 20px' }}>
            {p.asset_type && <span style={{ fontSize: 13, fontWeight: 600, background: as.bg, color: as.color, padding: '3px 11px', borderRadius: 20 }}>{p.asset_type}{p.property_subtype ? ` · ${p.property_subtype}` : ''}</span>}
            {p.vacancy_status && <span style={{ fontSize: 13, fontWeight: 600, background: st.bg, color: st.color, padding: '3px 11px', borderRadius: 20 }}>{p.vacancy_status}</span>}
            {p.building_class && <span style={{ fontSize: 13, fontWeight: 600, background: '#eef2ff', color: '#4338ca', padding: '3px 11px', borderRadius: 20 }}>Class {p.building_class}</span>}
          </div>

          {/* Hero stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10, marginBottom: 22 }}>
            <StatTile label={isSale ? 'Sale Price' : 'Asking Rate'} value={priceVal} accent />
            <StatTile label="Building SF" value={p.size_sf ? `${Number(p.size_sf).toLocaleString()} SF` : null} />
            <StatTile label="Available" value={p.available_sf ? `${Number(p.available_sf).toLocaleString()} SF` : null} />
            <StatTile label="Price / SF" value={p.price_per_sf ? `$${p.price_per_sf}` : null} />
            <StatTile label="Cap Rate" value={p.cap_rate ? `${p.cap_rate}%` : null} />
            <StatTile label="Year Built" value={p.year_built ? String(p.year_built) : null} />
          </div>

          {/* Broker card */}
          {(p.listing_company || p.listing_agent_name) && (
            <div style={{ background: '#fbfbfa', border: '1px solid #eef0f2', borderRadius: 12, padding: '14px 16px', marginBottom: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700 }}>Listing Broker</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginTop: 3 }}>{p.listing_agent_name || p.listing_company}</div>
                {p.listing_agent_name && p.listing_company && <div style={{ fontSize: 13, color: '#6b7280' }}>{p.listing_company}</div>}
              </div>
              {p.listing_agent_phone && (
                <a href={`tel:${p.listing_agent_phone}`} style={{ fontSize: 13, fontWeight: 700, color: '#a06a12', textDecoration: 'none', border: '1px solid #f0e2c4', background: '#fffdf6', padding: '8px 14px', borderRadius: 8, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', minHeight: isMobile ? 44 : undefined }}>📞 {p.listing_agent_phone}</a>
              )}
            </div>
          )}

          <Group title="Building & Specs">
            <Field label="Subtype" value={p.property_subtype} />
            <Field label="Building class" value={p.building_class} />
            <Field label="Clear height" value={p.clear_height_ft ? `${p.clear_height_ft} ft` : null} />
            <Field label="Dock doors" value={p.dock_doors} />
            <Field label="Grade doors" value={p.grade_doors} />
            <Field label="Parking" value={p.parking_spaces} />
            <Field label="Zoning" value={p.zoning} />
            <Field label="Lease type" value={p.lease_type} />
          </Group>
          <Group title="Location">
            <Field label="Submarket" value={p.submarket} />
            <Field label="County" value={p.county} />
            <Field label="Owner" value={p.owner_name} />
          </Group>

          {(p.description || p.highlights || p.notes) && (
            <Group title="Details">
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Highlights" value={p.highlights} />
                <Field label="Description" value={p.description} />
                <Field label="Notes" value={p.notes} />
              </div>
            </Group>
          )}

          {links.some(([, v]) => v) && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
              {links.filter(([, v]) => v).map(([label, url]) => (
                <a key={label} href={String(url)} target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: 13, fontWeight: 600, color: '#c9922c', textDecoration: 'none', border: '1px solid #f0e2c4', background: '#fffdf6', padding: isMobile ? '11px 14px' : '6px 12px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', minHeight: isMobile ? 44 : undefined }}>
                  {label} ↗
                </a>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: '#c0c4cc', borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
            {p.source ? `Source: ${p.source}` : ''}{p.source && p.created_at ? ' · ' : ''}
            {p.created_at ? `Added ${new Date(p.created_at as string).toLocaleDateString()}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
