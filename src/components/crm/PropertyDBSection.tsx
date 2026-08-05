'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';

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
  created_at?: string;
  [k: string]: unknown;
}

interface Props {
  businessUnit: string;
  isAdmin: boolean;
  authToken?: string;
  onToast: (msg: string) => void;
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

export default function PropertyDBSection({ businessUnit, authToken, onToast }: Props) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [assetFilter, setAssetFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [active, setActive]     = useState<Property | null>(null);

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
      setProperties(json.properties ?? []);
    } catch {
      onToast('Could not load the Property DB');
    }
    setLoading(false);
  }, [businessUnit, authHeaders, onToast]);

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
      if (!q) return true;
      return [p.name, p.address, p.city, p.submarket, p.listing_company, p.listing_agent_name]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [properties, search, assetFilter, statusFilter]);

  const inputStyle: React.CSSProperties = {
    padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14,
    fontFamily: "'DM Sans',sans-serif", background: '#fff', color: '#111',
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <input
          placeholder="🔍  Search address, city, submarket, broker…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 320px', minWidth: 220 }}
        />
        <select value={assetFilter} onChange={e => setAssetFilter(e.target.value)} style={inputStyle}>
          <option value="">All Types</option>
          {assetTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">All Statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {filtered.map(p => {
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

      {active && <DetailModal p={active} onClose={() => setActive(null)} />}
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  if (kids.every(k => k === null)) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0 20px' }}>{children}</div>
    </div>
  );
}

function DetailModal({ p, onClose }: { p: Property; onClose: () => void }) {
  const as = assetStyle(p.asset_type);
  const links: [string, unknown][] = [
    ['Brochure', p.brochure_url], ['Flyer', p.flyer_url], ['Listing', p.listing_url],
    ['Floor plan', p.floorplan_url], ['Virtual tour', p.virtual_tour_url],
  ];
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '5vh 16px', overflowY: 'auto' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, maxWidth: 760, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)', fontFamily: "'DM Sans',sans-serif" }}
      >
        <div style={{ height: 6, background: as.color, borderTopLeftRadius: 16, borderTopRightRadius: 16 }} />
        <div style={{ padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.1 }}>
                {p.name || p.address || 'Property'}
              </div>
              <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
                {[p.address, p.suite].filter(Boolean).join(', ')}{(p.address || p.suite) && cityLine(p) ? ' · ' : ''}{cityLine(p)}
              </div>
            </div>
            <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 18, color: '#6b7280', flexShrink: 0 }}>✕</button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0 24px' }}>
            {p.asset_type && <span style={{ fontSize: 13, fontWeight: 600, background: as.bg, color: as.color, padding: '3px 11px', borderRadius: 6 }}>{p.asset_type}{p.property_subtype ? ` · ${p.property_subtype}` : ''}</span>}
            {p.vacancy_status && <span style={{ fontSize: 13, fontWeight: 600, background: '#dcfce7', color: '#15803d', padding: '3px 11px', borderRadius: 6 }}>{p.vacancy_status}</span>}
            {p.building_class && <span style={{ fontSize: 13, fontWeight: 600, background: '#eef2ff', color: '#4338ca', padding: '3px 11px', borderRadius: 6 }}>Class {p.building_class}</span>}
          </div>

          <Group title="Size & Space">
            <Field label="Building SF" value={p.size_sf ? Number(p.size_sf).toLocaleString() : null} />
            <Field label="Available SF" value={p.available_sf ? Number(p.available_sf).toLocaleString() : null} />
            <Field label="Year built" value={p.year_built} />
          </Group>
          <Group title="Pricing">
            <Field label="Listing type" value={p.listing_type} />
            <Field label="Asking rate" value={fmtRate(p.asking_rate) || null} />
            <Field label="Sale price" value={p.sale_price ? fmt$(p.sale_price) : null} />
            <Field label="Price / SF" value={p.price_per_sf ? `$${p.price_per_sf}` : null} />
            <Field label="Cap rate" value={p.cap_rate ? `${p.cap_rate}%` : null} />
          </Group>
          <Group title="Industrial / Building Specs">
            <Field label="Clear height" value={p.clear_height_ft ? `${p.clear_height_ft} ft` : null} />
            <Field label="Dock doors" value={p.dock_doors} />
            <Field label="Grade doors" value={p.grade_doors} />
            <Field label="Parking" value={p.parking_spaces} />
            <Field label="Zoning" value={p.zoning} />
          </Group>
          <Group title="Location">
            <Field label="Submarket" value={p.submarket} />
            <Field label="County" value={p.county} />
          </Group>
          <Group title="Listing Contact">
            <Field label="Company" value={p.listing_company} />
            <Field label="Agent" value={p.listing_agent_name} />
            <Field label="Phone" value={p.listing_agent_phone} />
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
                   style={{ fontSize: 13, fontWeight: 600, color: '#c9922c', textDecoration: 'none', border: '1px solid #f0e2c4', background: '#fffdf6', padding: '6px 12px', borderRadius: 8 }}>
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
