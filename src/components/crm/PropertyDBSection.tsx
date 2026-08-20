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
  elevator?: boolean | null;
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
  updated_at?: string;
  last_status_at?: string;
  /** Linked master-list contacts, embedded by the GET via contact_id / owner_client_id. */
  contact?: CrmContact | null;
  owner?: CrmContact | null;
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

// Options for the agent Add-Property form (see AddPropertyModal).
const ADD_ASSET_TYPES = ['Retail', 'Office', 'Industrial', 'Flex', 'Mixed-Use', 'Land', 'Medical', 'Multifamily'];
const ADD_VACANCY = ['Vacant', 'Occupied', 'Available', 'Under Contract', 'Leased', 'Sold', 'Off-Market'];

// A row from the master contact list (crm_clients). Listing brokers LINK to one of
// these (crm_prospective_properties.contact_id) instead of being re-typed per property.
interface CrmContact {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  business_name?: string | null;
  brokerage?: string | null;
  email?: string | null;
  phone?: string | null;
  cell_phone?: string | null;
  type?: string | null;
}
const personName = (c: CrmContact) => `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
const contactLabel = (c: CrmContact) => personName(c) || c.business_name || c.email || 'Unnamed contact';
const contactCompany = (c: CrmContact) => c.business_name || c.brokerage || '';
const contactPhone = (c: CrmContact) => c.phone || c.cell_phone || '';

/**
 * Shrink an oversized image flyer client-side before upload — a big photo blows
 * past the vision model's ~5 MB per-image limit, which would look identical to the
 * old size error. Never throws (falls back to the original); PDFs and small/GIF
 * images pass through untouched.
 */
async function downscaleIfLargeImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size <= 3_500_000) return file;
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const maxDim = 2200;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const cx = canvas.getContext('2d');
    if (!cx) return file;
    cx.drawImage(img, 0, 0, w, h);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (blob && blob.size < file.size) {
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
  } catch {
    /* fall back to the original file */
  }
  return file;
}

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

// "Last updated" freshness for a Property DB record. Lets the broker glance at
// how current the data is when calling on a listing ("added to my site ~3d ago").
// Uses updated_at (bumped when the ingestion re-sees a listing), falling back to
// created_at. Green = fresh, slate = recent, amber = aging (worth re-verifying).
function freshness(p: Property): { label: string; full: string; bg: string; color: string } | null {
  const iso = (p.updated_at as string) || (p.created_at as string);
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const label = days <= 0 ? 'Today' : days === 1 ? 'Yesterday'
    : days < 7 ? `${days}d ago` : days < 31 ? `${Math.floor(days / 7)}w ago`
    : days < 365 ? `${Math.floor(days / 30)}mo ago` : `${Math.floor(days / 365)}y ago`;
  const tone = days <= 7 ? { bg: '#ecfdf5', color: '#15803d' }
    : days <= 45 ? { bg: '#f1f5f9', color: '#64748b' }
    : { bg: '#fff7ed', color: '#b45309' };
  const full = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return { label, full, ...tone };
}

function UpdatedChip({ p, compact }: { p: Property; compact?: boolean }) {
  const f = freshness(p);
  if (!f) return null;
  return (
    <span title={`Data last updated ${f.full}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: compact ? 10.5 : 11, fontWeight: 600, background: f.bg, color: f.color, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      🕒 {f.label}
    </span>
  );
}

// Property thumbnail for quick visual ID. Uses a real photo stored on the record
// (photos[0] or flyer_url — e.g. a saved broker flyer); otherwise a placeholder.
function PropertyThumb({ p, height }: { p: Property; height: number }) {
  const photos = p.photos;
  const firstPhoto = Array.isArray(photos) && typeof photos[0] === 'string' ? (photos[0] as string) : undefined;
  const src = firstPhoto || (typeof p.flyer_url === 'string' && p.flyer_url ? p.flyer_url : '');
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div style={{ height, width: '100%', background: 'linear-gradient(135deg,#eef1f4,#e2e6ea)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c2c8cf', fontSize: Math.round(height * 0.3) }}>🏢</div>;
  }
  return (
    <img src={src} alt={p.name || p.address || 'property'} loading="lazy"
      onError={() => setFailed(true)}
      style={{ display: 'block', width: '100%', height, objectFit: 'cover', background: '#f3f4f6' }} />
  );
}

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
  const [showAdd, setShowAdd]   = useState(false);
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
        case 'updated': return p.updated_at ? new Date(p.updated_at as string).getTime() : (p.created_at ? new Date(p.created_at as string).getTime() : 0);
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
        <button
          onClick={() => setShowAdd(true)}
          title="Add a property to the DB — upload a flyer to auto-fill"
          style={{ padding: isMobile ? '11px 16px' : '9px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", background: '#c9922c', color: '#fff', whiteSpace: 'nowrap', ...(isMobile ? { width: '100%', minHeight: 44 } : {}) }}
        >
          ＋ Add Property
        </button>
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
              <option value="updated">Last updated</option>
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
                  <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                    <div style={{ width: 54, height: 54, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                      <PropertyThumb p={p} height={54} />
                    </div>
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
                    <span style={{ marginLeft: 'auto' }}><UpdatedChip p={p} compact /></span>
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
          <table style={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: "'DM Sans',sans-serif" }}>
            <colgroup>
              <col style={{ width: '24%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '9%' }} />
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
                {sortTh('updated', 'Updated')}
              </tr>
            </thead>
            <tbody>
              {paged.map(p => {
                const as = assetStyle(p.asset_type);
                const price = p.listing_type === 'Sale' || p.sale_price ? fmt$(p.sale_price) : fmtRate(p.asking_rate);
                const st = statusPill(p.vacancy_status);
                const loc = [p.address, cityLine(p)].filter(Boolean).join(' · ');
                const avail = p.available_sf && p.available_sf !== p.size_sf ? p.available_sf : null;
                const fresh = freshness(p);
                const ell: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
                return (
                  <tr key={p.id} onClick={() => setActive(p)}
                    style={{ borderTop: '1px solid #f4f5f7', cursor: 'pointer', background: '#fff' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fbf8f1')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                    <td style={{ padding: '10px 12px 10px 16px', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                        <div style={{ width: 42, height: 42, borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>
                          <PropertyThumb p={p} height={42} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...ell, fontWeight: 600, color: '#1a1a1a', fontSize: 14 }} title={p.name || p.address || ''}>{p.name || p.address || '—'}</div>
                          <div style={{ ...ell, color: '#9ca3af', fontSize: 12.5, marginTop: 2 }} title={loc}>{loc || '—'}</div>
                        </div>
                      </div>
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
                    <td style={{ padding: '12px 12px', verticalAlign: 'top' }}>
                      {fresh ? (
                        <div title={`Data last updated ${fresh.full}`}>
                          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: fresh.color, background: fresh.bg, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{fresh.label}</span>
                          <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 2, whiteSpace: 'nowrap' }}>{fresh.full}</div>
                        </div>
                      ) : muted}
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
              <PropertyThumb p={p} height={148} />
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
                  <UpdatedChip p={p} compact />
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
      {showAdd && (
        <AddPropertyModal
          businessUnit={businessUnit}
          authToken={authToken}
          isMobile={isMobile}
          onClose={() => setShowAdd(false)}
          onToast={onToast}
          onAdded={(created) => { setShowAdd(false); load(); if (created) setActive(created); }}
        />
      )}
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

// A broker/owner rendered as a real, actionable contact (call / email) with a
// "Contact" badge when linked to the master list; falls back to the text fields.
function ContactCardRow({ label, contact, fallbackName, fallbackCompany, fallbackPhone, isMobile }: {
  label: string;
  contact: CrmContact | null;
  fallbackName?: string | null;
  fallbackCompany?: string | null;
  fallbackPhone?: string | null;
  isMobile?: boolean;
}) {
  const name = contact ? contactLabel(contact) : (fallbackName || fallbackCompany || '');
  const company = contact ? contactCompany(contact) : (fallbackCompany || '');
  const phone = contact ? contactPhone(contact) : (fallbackPhone || '');
  const email = contact?.email || '';
  if (!name && !company && !phone) return null;
  return (
    <div style={{ background: contact ? '#f4f9f4' : '#fbfbfa', border: `1px solid ${contact ? '#cfe6cf' : '#eef0f2'}`, borderRadius: 12, padding: '14px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          {label}
          {contact && <span style={{ color: '#15803d', background: '#dcfce7', padding: '2px 7px', borderRadius: 20, fontSize: 9.5, letterSpacing: .3 }}>👤 Contact</span>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginTop: 3 }}>{name || company}</div>
        {company && name !== company && <div style={{ fontSize: 13, color: '#6b7280' }}>{company}</div>}
        {email && <a href={`mailto:${email}`} style={{ fontSize: 12.5, color: '#a06a12', textDecoration: 'none', display: 'inline-block', marginTop: 2 }}>✉ {email}</a>}
      </div>
      {phone && (
        <a href={`tel:${phone}`} style={{ fontSize: 13, fontWeight: 700, color: '#a06a12', textDecoration: 'none', border: '1px solid #f0e2c4', background: '#fffdf6', padding: '8px 14px', borderRadius: 8, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', minHeight: isMobile ? 44 : undefined }}>📞 {phone}</a>
      )}
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

          {/* Listing broker + owner — real linked contacts (call / email) when available */}
          <ContactCardRow label="Listing Broker" contact={p.contact ?? null}
            fallbackName={p.listing_agent_name} fallbackCompany={p.listing_company} fallbackPhone={p.listing_agent_phone} isMobile={isMobile} />
          <ContactCardRow label="Owner" contact={p.owner ?? null}
            fallbackName={p.owner_name} fallbackPhone={(p.owner_phone as string | undefined) ?? null} isMobile={isMobile} />

          <Group title="Building & Specs">
            <Field label="Subtype" value={p.property_subtype} />
            <Field label="Building class" value={p.building_class} />
            <Field label="Clear height" value={p.clear_height_ft ? `${p.clear_height_ft} ft` : null} />
            <Field label="Dock doors" value={p.dock_doors} />
            <Field label="Grade doors" value={p.grade_doors} />
            <Field label="Parking" value={p.parking_spaces} />
            <Field label="Elevator" value={p.elevator == null ? null : p.elevator ? 'Yes' : 'No'} />
            <Field label="Zoning" value={p.zoning} />
            <Field label="Lease type" value={p.lease_type} />
          </Group>
          <Group title="Location">
            <Field label="Submarket" value={p.submarket} />
            <Field label="County" value={p.county} />
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
            {[
              p.source ? `Source: ${p.source}` : '',
              p.created_at ? `Added ${new Date(p.created_at as string).toLocaleDateString()}` : '',
              (p.updated_at && (!p.created_at || new Date(p.updated_at as string).getTime() - new Date(p.created_at as string).getTime() > 86_400_000))
                ? `Updated ${new Date(p.updated_at as string).toLocaleDateString()}` : '',
            ].filter(Boolean).join('  ·  ')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Contact picker — search the master contact list, link, or add once ────────
// Mirrors the RentRoll contact-linking pattern so contacts are never duplicated.
// Reused for the listing broker (contact_id) and the owner (owner_client_id).

function ContactPicker({ authToken, linked, initialQuery, draft, onLink, createType = 'Broker' }: {
  authToken?: string;
  linked: CrmContact | null;
  initialQuery?: string;
  draft: { name?: string; company?: string; phone?: string; email?: string };
  onLink: (c: CrmContact | null) => void;
  createType?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CrmContact[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const headers = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return h;
  }, [authToken]);

  // Debounced search whenever the query changes while the picker is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/contacts?q=${encodeURIComponent(q.trim())}&limit=20`, { headers });
        const json = await res.json();
        if (!cancelled) setResults(res.ok ? (json.contacts ?? []) : []);
      } catch {
        if (!cancelled) setResults([]);
      }
      if (!cancelled) setBusy(false);
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open, headers]);

  // When the flyer hands us a broker name, open the picker pre-searched on it.
  useEffect(() => {
    if (initialQuery && initialQuery.trim() && !linked) { setQ(initialQuery.trim()); setOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const createFromDraft = async () => {
    const name = (draft.name || q).trim();
    const parts = name.split(/\s+/).filter(Boolean);
    setCreating(true);
    try {
      const res = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: parts[0] || null,
          last_name: parts.slice(1).join(' ') || null,
          business_name: draft.company || null,
          phone: draft.phone || null,
          email: draft.email || null,
          type: createType,
        }),
      });
      const json = await res.json();
      if (res.ok && json.contact) { onLink(json.contact); setOpen(false); }
    } catch { /* ignore — agent can retry */ }
    setCreating(false);
  };

  const inp: React.CSSProperties = {
    padding: '9px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14,
    fontFamily: "'DM Sans',sans-serif", background: '#fff', color: '#111', width: '100%', boxSizing: 'border-box',
  };

  if (linked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#f4f9f4', border: '1px solid #cfe6cf', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>🔗</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>{contactLabel(linked)}</div>
          <div style={{ fontSize: 12, color: '#4b7a4b' }}>{[contactCompany(linked), contactPhone(linked), linked.email].filter(Boolean).join(' · ') || 'Linked contact'}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#15803d', background: '#dcfce7', padding: '3px 8px', borderRadius: 20 }}>from contacts</span>
        <button type="button" onClick={() => onLink(null)} style={{ border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>✕ Unlink</button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 12 }}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          style={{ ...inp, textAlign: 'left', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center', gap: 8 }}>
          🔗 Link a contact from your list…
        </button>
      ) : (
        <div style={{ border: '1px solid #c9922c', borderRadius: 10, padding: 8, background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,.10)' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search contacts by name, company, phone…" style={inp} />
          <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
            {busy && <div style={{ fontSize: 12, color: '#9ca3af', padding: '8px 4px' }}>Searching…</div>}
            {!busy && results.map(c => (
              <button type="button" key={c.id} onClick={() => { onLink(c); setOpen(false); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 6px', cursor: 'pointer', borderRadius: 6 }}
                onMouseOver={e => (e.currentTarget.style.background = '#f7f4ec')}
                onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#111' }}>{contactLabel(c)}{c.type ? <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}> · {c.type}</span> : null}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{[contactCompany(c), contactPhone(c), c.email].filter(Boolean).join(' · ')}</div>
              </button>
            ))}
            {!busy && results.length === 0 && (
              <div style={{ fontSize: 12.5, color: '#9ca3af', padding: '8px 4px' }}>No contacts match{q.trim() ? ` “${q.trim()}”` : ''}.</div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
            <button type="button" onClick={createFromDraft} disabled={creating || !(draft.name || draft.company || q.trim())}
              style={{ border: 'none', background: (creating || !(draft.name || draft.company || q.trim())) ? '#dcc79a' : '#c9922c', color: '#fff', fontWeight: 700, fontSize: 12.5, padding: '7px 12px', borderRadius: 7, cursor: creating ? 'default' : 'pointer' }}>
              {creating ? 'Adding…' : `＋ Add ${(draft.name || q.trim() || 'new').slice(0, 24)} to contacts`}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={{ border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontWeight: 600, fontSize: 12.5, padding: '7px 12px', borderRadius: 7, cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add-Property modal (agent-facing: upload a flyer to auto-fill) ────────────

function AddPropertyModal({
  businessUnit, authToken, isMobile, onClose, onToast, onAdded,
}: {
  businessUnit: string;
  authToken?: string;
  isMobile: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  onAdded: (created: Property | null) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({ listing_type: 'Lease', vacancy_status: 'Vacant' });
  const [flyerUrl, setFlyerUrl] = useState<string | null>(null);
  const [brochureUrl, setBrochureUrl] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readMsg, setReadMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [linkedContact, setLinkedContact] = useState<CrmContact | null>(null);
  const [brokerQuery, setBrokerQuery] = useState('');
  const [ownerContact, setOwnerContact] = useState<CrmContact | null>(null);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Link (or unlink) a master-list contact as the listing broker; mirror its
  // name/company/phone into the text fields so the card + list still show them.
  const handleLink = (c: CrmContact | null) => {
    setLinkedContact(c);
    if (c) {
      setForm(f => ({
        ...f,
        listing_agent_name: personName(c) || f.listing_agent_name || '',
        listing_company: contactCompany(c) || f.listing_company || '',
        listing_agent_phone: contactPhone(c) || f.listing_agent_phone || '',
      }));
    }
  };

  // Same, for the property owner (owner_client_id + owner_name/owner_phone).
  const handleOwnerLink = (c: CrmContact | null) => {
    setOwnerContact(c);
    if (c) {
      setForm(f => ({
        ...f,
        owner_name: contactLabel(c) || f.owner_name || '',
        owner_phone: contactPhone(c) || f.owner_phone || '',
      }));
    }
  };

  const readFlyer = async (file: File) => {
    setReading(true); setError(null); setReadMsg(null);
    try {
      // Big flyers exceed Vercel's 4.5 MB serverless body limit, so upload the file
      // STRAIGHT to storage via a signed URL and let the server read it back. Large
      // photos also exceed the vision model's per-image limit, so shrink them first.
      const prepared = await downscaleIfLargeImage(file);
      const mime = prepared.type;
      const authH: Record<string, string> = {};
      if (authToken) authH.Authorization = `Bearer ${authToken}`;
      const jsonH = { ...authH, 'Content-Type': 'application/json' };
      // 1) signed upload URL (tiny request)
      const pre = await fetch('/api/crm/property-db/extract-flyer', {
        method: 'POST', headers: jsonH,
        body: JSON.stringify({ filename: prepared.name, mime, file_size: prepared.size }),
      });
      const pj = await pre.json();
      if (!pre.ok) { setError(pj.error || 'Could not start the upload.'); setReading(false); return; }
      // 2) upload the flyer directly to storage — no serverless body limit applies
      const put = await fetch(pj.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: prepared });
      if (!put.ok) { setError('The upload did not finish — please try again.'); setReading(false); return; }
      // 3) read it back from storage + extract the fields
      const res = await fetch('/api/crm/property-db/extract-flyer', {
        method: 'PUT', headers: jsonH,
        body: JSON.stringify({ storage_path: pj.storagePath, mime }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not read the flyer.'); setReading(false); return; }
      const ex = (json.extraction ?? {}) as Record<string, unknown>;
      setForm(prev => {
        const next = { ...prev };
        const put = (k: string, v: unknown) => { if (v !== null && v !== undefined && v !== '') next[k] = String(v); };
        put('name', ex.name); put('address', ex.address); put('suite', ex.suite);
        put('city', ex.city); put('state', ex.state); put('zip', ex.zip);
        put('asset_type', ex.asset_type); put('property_subtype', ex.property_subtype);
        put('building_class', ex.building_class);
        put('size_sf', ex.size_sf); put('available_sf', ex.available_sf);
        put('asking_rate', ex.asking_rate); put('sale_price', ex.sale_price);
        put('price_per_sf', ex.price_per_sf);
        put('year_built', ex.year_built); put('clear_height_ft', ex.clear_height_ft);
        put('dock_doors', ex.dock_doors); put('grade_doors', ex.grade_doors);
        put('zoning', ex.zoning); put('lease_type', ex.lease_type);
        put('listing_company', ex.listing_company); put('listing_agent_name', ex.listing_agent_name);
        put('listing_agent_phone', ex.listing_agent_phone);
        put('notes', ex.notes);
        if (typeof ex.brochure_url === 'string') put('brochure_url', ex.brochure_url);
        if (Array.isArray(ex.highlights) && ex.highlights.length) next.highlights = (ex.highlights as string[]).join('\n');
        const lt = typeof ex.listing_type === 'string' ? ex.listing_type : '';
        if (lt) next.listing_type = /sale/i.test(lt) && /lease/i.test(lt) ? 'Both' : /sale/i.test(lt) ? 'Sale' : 'Lease';
        return next;
      });
      if (json.flyerUrl) setFlyerUrl(json.flyerUrl as string);
      if (json.brochureUrl) setBrochureUrl(json.brochureUrl as string);
      setShowMore(true);
      const bq = typeof ex.listing_agent_name === 'string' ? ex.listing_agent_name
        : typeof ex.listing_company === 'string' ? ex.listing_company : '';
      if (bq && !linkedContact) setBrokerQuery(bq);
      const hasListing = ex.name || ex.address;
      setReadMsg(hasListing
        ? '✓ Flyer read — review the fields below, then save.'
        : 'Flyer uploaded, but no listing could be identified in it. Enter the details manually.');
    } catch {
      setError('Could not read the flyer. Enter the details manually.');
    }
    setReading(false);
  };

  const submit = async () => {
    if (!form.name?.trim() && !form.address?.trim()) { setError('Enter at least a property name or address.'); return; }
    setSaving(true); setError(null);
    try {
      const h: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) h.Authorization = `Bearer ${authToken}`;
      const payload: Record<string, unknown> = { ...form, business_unit: businessUnit };
      if (flyerUrl) payload.flyer_url = flyerUrl;
      if (brochureUrl && !form.brochure_url) payload.brochure_url = brochureUrl;
      if (linkedContact) payload.contact_id = linkedContact.id;
      if (ownerContact) payload.owner_client_id = ownerContact.id;
      const res = await fetch('/api/crm/property-db', { method: 'POST', headers: h, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not save the property.'); setSaving(false); return; }
      onToast('✓ Property added to the DB');
      onAdded((json.property ?? null) as Property | null);
    } catch {
      setError('Could not save the property.'); setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    padding: '9px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14,
    fontFamily: "'DM Sans',sans-serif", background: '#fff', color: '#111', width: '100%', boxSizing: 'border-box',
  };
  const F = (key: string, label: string, o?: { area?: boolean; select?: string[]; ph?: string; span?: boolean; num?: boolean }) => (
    <div style={{ marginBottom: 12, ...(o?.span ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={{ fontSize: 11, letterSpacing: .4, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {o?.select ? (
        <select value={form[key] ?? ''} onChange={e => set(key, e.target.value)} style={inp}>
          <option value="">—</option>
          {o.select.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
      ) : o?.area ? (
        <textarea value={form[key] ?? ''} onChange={e => set(key, e.target.value)} rows={3} placeholder={o?.ph} style={{ ...inp, resize: 'vertical' }} />
      ) : (
        <input value={form[key] ?? ''} onChange={e => set(key, e.target.value)} placeholder={o?.ph} inputMode={o?.num ? 'decimal' : undefined} style={inp} />
      )}
    </div>
  );
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0 16px' };
  const secTitle: React.CSSProperties = { fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, margin: '6px 0 10px' };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.5)', zIndex: 1100, display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-end' : 'flex-start', padding: isMobile ? 0 : '5vh 16px', overflowY: isMobile ? 'hidden' : 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', maxWidth: isMobile ? '100%' : 720, width: '100%', boxShadow: '0 24px 70px rgba(0,0,0,.32)', fontFamily: "'DM Sans',sans-serif", borderRadius: isMobile ? '18px 18px 0 0' : 16, ...(isMobile ? { maxHeight: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom)' } : {}) }}>
        <div style={{ height: 6, background: '#c9922c', borderTopLeftRadius: isMobile ? 18 : 16, borderTopRightRadius: isMobile ? 18 : 16, flexShrink: 0 }} />
        <div style={{ padding: isMobile ? '18px 18px 20px' : 28, ...(isMobile ? { overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, minHeight: 0 } : {}) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: isMobile ? 23 : 26, fontWeight: 600, color: '#1a1a1a' }}>Add a Property</div>
            <button onClick={onClose} aria-label="Close" style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, width: isMobile ? 44 : 34, height: isMobile ? 44 : 34, cursor: 'pointer', fontSize: 18, color: '#6b7280' }}>✕</button>
          </div>

          {/* Flyer dropzone — upload a PDF/image and Claude vision fills the form */}
          <label
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) readFlyer(f); }}
            style={{ display: 'block', border: '2px dashed #e0cfa0', background: reading ? '#fbf3df' : '#fffdf6', borderRadius: 12, padding: '18px 16px', textAlign: 'center', cursor: reading ? 'default' : 'pointer', marginBottom: 16 }}>
            {/* accept="image/*" reliably offers the camera on phones and lets iOS
                hand back a JPEG (HEIC photos are converted on capture). */}
            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) readFlyer(f); e.target.value = ''; }} />
            {reading ? (
              <div style={{ color: '#a06a12', fontWeight: 700, fontSize: 14 }}>⏳ Reading the flyer with AI…</div>
            ) : (
              <>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{isMobile ? '📸' : '📄'}</div>
                <div style={{ fontWeight: 700, color: '#8a6a1e', fontSize: 14 }}>{isMobile ? 'Take a photo of the flyer to auto-fill' : 'Upload a flyer to auto-fill'}</div>
                <div style={{ fontSize: 12, color: '#b08a4a', marginTop: 3 }}>{isMobile ? 'Snap a photo, or choose a PDF/image' : 'Drop a PDF or image here, or click to browse'} — the details are read from it and filled in below for you to review.</div>
              </>
            )}
          </label>
          {readMsg && <div style={{ fontSize: 13, color: readMsg.startsWith('✓') ? '#15803d' : '#b45309', marginBottom: 14, fontWeight: 600 }}>{readMsg}</div>}

          {/* Core fields */}
          <div style={grid}>
            {F('name', 'Property / Listing Name', { span: true })}
            {F('address', 'Address')}
            {F('suite', 'Suite')}
            {F('city', 'City')}
            {F('state', 'State')}
            {F('zip', 'ZIP')}
            {F('asset_type', 'Type', { select: ADD_ASSET_TYPES })}
            {F('property_subtype', 'Subtype')}
            {F('listing_type', 'For', { select: ['Lease', 'Sale', 'Both'] })}
            {F('vacancy_status', 'Status', { select: ADD_VACANCY })}
            {F('size_sf', 'Building SF', { num: true })}
            {F('available_sf', 'Available SF', { num: true })}
            {F('asking_rate', 'Asking Rate', { ph: '$18.00/SF NNN' })}
            {F('sale_price', 'Sale Price', { num: true })}
          </div>

          <div style={secTitle}>Listing Broker</div>
          <ContactPicker
            authToken={authToken}
            linked={linkedContact}
            initialQuery={brokerQuery}
            draft={{ name: form.listing_agent_name, company: form.listing_company, phone: form.listing_agent_phone }}
            onLink={handleLink}
            createType="Broker"
          />
          <div style={grid}>
            {F('listing_company', 'Company')}
            {F('listing_agent_name', 'Agent')}
            {F('listing_agent_phone', 'Phone')}
          </div>

          <div style={secTitle}>Owner</div>
          <ContactPicker
            authToken={authToken}
            linked={ownerContact}
            draft={{ name: form.owner_name, phone: form.owner_phone }}
            onLink={handleOwnerLink}
            createType="Landlord/Investor"
          />
          <div style={grid}>
            {F('owner_name', 'Owner Name')}
            {F('owner_phone', 'Owner Phone')}
          </div>

          <div style={{ ...secTitle, cursor: 'pointer', userSelect: 'none' }} onClick={() => setShowMore(m => !m)}>
            {showMore ? '▾' : '▸'} More details
          </div>
          {showMore && (
            <>
              <div style={grid}>
                {F('building_class', 'Building Class', { select: ['A', 'B', 'C'] })}
                {F('price_per_sf', 'Price / SF', { num: true })}
                {F('cap_rate', 'Cap Rate %', { num: true })}
                {F('lease_type', 'Lease Type', { select: ['NNN', 'FSG', 'MG', 'IG'] })}
                {F('year_built', 'Year Built', { num: true })}
                {F('clear_height_ft', 'Clear Height (ft)', { num: true })}
                {F('dock_doors', 'Dock Doors', { num: true })}
                {F('grade_doors', 'Grade Doors', { num: true })}
                {F('parking_spaces', 'Parking Spaces', { num: true })}
                {F('zoning', 'Zoning')}
                {F('submarket', 'Submarket')}
                {F('county', 'County')}
              </div>
              <div style={grid}>
                {F('highlights', 'Highlights (one per line)', { area: true, span: true })}
                {F('description', 'Description', { area: true, span: true })}
                {F('notes', 'Notes', { area: true, span: true })}
                {F('brochure_url', 'Brochure URL', { span: true })}
                {F('listing_url', 'Listing URL', { span: true })}
              </div>
            </>
          )}

          {error && <div style={{ fontSize: 13, color: '#dc2626', marginTop: 6, fontWeight: 600 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16, ...(isMobile ? { position: 'sticky', bottom: 0, background: '#fff', paddingTop: 12 } : {}) }}>
            <button onClick={onClose} disabled={saving}
              style={{ padding: '10px 18px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#6b7280', fontWeight: 600, fontSize: 14, cursor: 'pointer', minHeight: isMobile ? 44 : undefined }}>Cancel</button>
            <button onClick={submit} disabled={saving || reading}
              style={{ padding: '10px 20px', border: 'none', borderRadius: 8, background: (saving || reading) ? '#dcc79a' : '#c9922c', color: '#fff', fontWeight: 700, fontSize: 14, cursor: (saving || reading) ? 'default' : 'pointer', minHeight: isMobile ? 44 : undefined }}>
              {saving ? 'Saving…' : 'Add to Property DB'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
