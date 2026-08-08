'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Listing {
  id: string;
  business_unit: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  type?: string;
  status?: string;
  asking_price?: number | null;
  sq_ft?: number | null;
  lot_size?: string;
  year_built?: string;
  description?: string;
  notes?: string;
  listing_agent_id?: string;
  created_at: string;
  updated_at?: string;
}

interface ListingFile {
  id: string;
  listing_id: string;
  name: string;
  file_type?: string;
  file_size?: number;
  category: string;
  created_at: string;
  url?: string;
}

interface Profile { id: string; first_name: string; last_name: string; role?: string; }

interface Props {
  businessUnit: string;
  isAdmin: boolean;
  authToken?: string;
  profiles: Profile[];
  onToast: (msg: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TYPES = ['Retail', 'Office', 'Industrial', 'Land', 'Multifamily', 'Mixed-Use', 'Medical', 'Flex'];
const STATUSES = ['active', 'pending', 'leased', 'sold', 'off_market'];

const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  active:     { label: 'Active',     bg: '#dcfce7', color: '#15803d' },
  pending:    { label: 'Pending',    bg: '#fef3c7', color: '#b45309' },
  leased:     { label: 'Leased',     bg: '#dbeafe', color: '#1d4ed8' },
  sold:       { label: 'Sold',       bg: '#f3e8ff', color: '#7e22ce' },
  off_market: { label: 'Off Market', bg: '#f1f5f9', color: '#64748b' },
};

const CATEGORIES = [
  { key: 'floor_plan', label: '📐 Floor Plans' },
  { key: 'photo',      label: '📷 Photos' },
  { key: 'brochure',   label: '📄 Brochures' },
  { key: 'document',   label: '📎 Documents' },
];

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  Retail:      { bg: '#fef3c7', color: '#b45309' },
  Office:      { bg: '#dbeafe', color: '#1d4ed8' },
  Industrial:  { bg: '#f1f5f9', color: '#475569' },
  Land:        { bg: '#dcfce7', color: '#15803d' },
  Multifamily: { bg: '#f3e8ff', color: '#7e22ce' },
  'Mixed-Use': { bg: '#fce7f3', color: '#be185d' },
  Medical:     { bg: '#cffafe', color: '#0e7490' },
  Flex:        { bg: '#fff7ed', color: '#c2410c' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n?: number | null) {
  if (!n) return '—';
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${Number(n).toLocaleString()}`;
}

function fmtSqFt(n?: number | null) {
  if (!n) return '—';
  return `${Number(n).toLocaleString()} SF`;
}

function fileIcon(type?: string, cat?: string) {
  if (cat === 'floor_plan') return '📐';
  if (cat === 'photo') return '📷';
  if (cat === 'brochure') return '📄';
  if (type?.includes('pdf')) return '📕';
  if (type?.includes('image')) return '🖼️';
  if (type?.includes('sheet') || type?.includes('excel') || type?.includes('csv')) return '📊';
  if (type?.includes('word') || type?.includes('doc')) return '📝';
  return '📎';
}

function fmtBytes(n?: number | null) {
  if (!n) return '';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// ── Blank forms ──────────────────────────────────────────────────────────────

const BLANK_FORM = {
  name: '', address: '', city: '', state: 'TX', zip: '',
  type: 'Retail', status: 'active', asking_price: '', sq_ft: '',
  lot_size: '', year_built: '', description: '', notes: '', listing_agent_id: '',
};

// ── Main component ────────────────────────────────────────────────────────────

export default function ListingsSection({ businessUnit, isAdmin, authToken, profiles, onToast }: Props) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [typeFilter, setTypeFilter]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Detail panel
  const [active, setActive]     = useState<Listing | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'files'>('info');
  const [editForm, setEditForm] = useState<typeof BLANK_FORM>(BLANK_FORM);
  const [dirty, setDirty]       = useState(false);

  // Files
  const [files, setFiles]           = useState<ListingFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadCat, setUploadCat]   = useState('floor_plan');
  const fileInputRef                = useRef<HTMLInputElement>(null);

  // New listing modal
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<typeof BLANK_FORM>(BLANK_FORM);
  const [creating, setCreating] = useState(false);

  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadListings = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/crm/listings?business_unit=${businessUnit}`, { headers: authHeaders });
    const json = await res.json();
    setListings(json.listings ?? []);
    setLoading(false);
  }, [businessUnit, authToken]); // eslint-disable-line

  useEffect(() => { loadListings(); }, [loadListings]);

  const loadFiles = useCallback(async (listingId: string) => {
    setFilesLoading(true);
    const res = await fetch(`/api/crm/listing-files?listing_id=${listingId}`, { headers: authHeaders });
    const json = await res.json();
    setFiles(json.files ?? []);
    setFilesLoading(false);
  }, [authToken]); // eslint-disable-line

  // ── Open / close listing ────────────────────────────────────────────────────

  function openListing(l: Listing) {
    setActive(l);
    setActiveTab('info');
    setEditForm({
      name: l.name ?? '', address: l.address ?? '', city: l.city ?? '',
      state: l.state ?? 'TX', zip: l.zip ?? '', type: l.type ?? 'Retail',
      status: l.status ?? 'active', asking_price: l.asking_price != null ? String(l.asking_price) : '',
      sq_ft: l.sq_ft != null ? String(l.sq_ft) : '',
      lot_size: l.lot_size ?? '', year_built: l.year_built ?? '',
      description: l.description ?? '', notes: l.notes ?? '',
      listing_agent_id: l.listing_agent_id ?? '',
    });
    setDirty(false);
    setFiles([]);
    loadFiles(l.id);
  }

  function closePanel() { setActive(null); setFiles([]); setDirty(false); }

  // ── Save listing ────────────────────────────────────────────────────────────

  async function saveListing() {
    if (!active) return;
    const body: Record<string, unknown> = { ...editForm };
    body.asking_price = editForm.asking_price !== '' ? Number(editForm.asking_price) : null;
    body.sq_ft        = editForm.sq_ft !== '' ? Number(editForm.sq_ft) : null;
    const res = await fetch(`/api/crm/listings/${active.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    });
    if (!res.ok) { onToast('Error saving listing'); return; }
    const { listing } = await res.json();
    setListings(prev => prev.map(l => l.id === active.id ? listing : l));
    setActive(listing);
    setDirty(false);
    onToast('Listing saved ✓');
  }

  // ── Delete listing ──────────────────────────────────────────────────────────

  async function deleteListing() {
    if (!active || !confirm(`Delete "${active.name}"? This cannot be undone.`)) return;
    await fetch(`/api/crm/listings/${active.id}`, { method: 'DELETE', headers: authHeaders });
    setListings(prev => prev.filter(l => l.id !== active.id));
    closePanel();
    onToast('Listing deleted');
  }

  // ── Create listing ──────────────────────────────────────────────────────────

  async function createListing() {
    if (!newForm.name.trim()) return;
    setCreating(true);
    const body: Record<string, unknown> = { ...newForm, business_unit: businessUnit };
    body.asking_price = newForm.asking_price !== '' ? Number(newForm.asking_price) : null;
    body.sq_ft        = newForm.sq_ft !== '' ? Number(newForm.sq_ft) : null;
    const res = await fetch('/api/crm/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    });
    setCreating(false);
    if (!res.ok) { onToast('Error creating listing'); return; }
    const { listing } = await res.json();
    setListings(prev => [listing, ...prev]);
    setShowNew(false);
    setNewForm(BLANK_FORM);
    onToast('Listing created ✓');
    openListing(listing);
  }

  // ── File upload ─────────────────────────────────────────────────────────────

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!active || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploading(true);
    e.target.value = '';
    try {
      // Step 1: Get a presigned upload URL (small JSON request — no body size limit issue)
      const presignRes = await fetch('/api/crm/listing-files/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          listing_id: active.id,
          filename: file.name,
          category: uploadCat,
          file_size: file.size,
          file_type: file.type || '',
        }),
      });
      const presignJson = await presignRes.json();
      if (!presignRes.ok) { onToast(presignJson.error ?? 'Upload failed'); setUploading(false); return; }

      const { uploadUrl, storagePath, meta } = presignJson;

      // Step 2: PUT the file directly to Supabase Storage (bypasses Vercel body size limit)
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) {
        onToast(`Upload failed (storage error ${putRes.status})`);
        setUploading(false);
        return;
      }

      // Step 3: Save the file record to DB
      const confirmRes = await fetch('/api/crm/listing-files/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...meta, storage_path: storagePath }),
      });
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok) { onToast(confirmJson.error ?? 'Upload failed'); setUploading(false); return; }

      setFiles(prev => [confirmJson.file, ...prev]);
      onToast('File uploaded ✓');
    } catch (err) {
      console.error('[uploadFile] error:', err);
      onToast('Upload failed — check console for details');
    } finally {
      setUploading(false);
    }
  }

  async function deleteFile(fileId: string, name: string) {
    if (!confirm(`Remove "${name}"?`)) return;
    const res = await fetch('/api/crm/listing-files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ fileId }),
    });
    if (!res.ok) { onToast('Error deleting file'); return; }
    setFiles(prev => prev.filter(f => f.id !== fileId));
    onToast('File removed');
  }

  // ── Filtered listings ───────────────────────────────────────────────────────

  const filtered = listings.filter(l => {
    if (typeFilter && l.type !== typeFilter) return false;
    if (statusFilter && l.status !== statusFilter) return false;
    if (search) {
      const s = `${l.name} ${l.address ?? ''} ${l.city ?? ''}`.toLowerCase();
      if (!s.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  // ── Shared input style ──────────────────────────────────────────────────────

  const INP: React.CSSProperties = {
    padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 16,
    color: '#374151', fontFamily: "'DM Sans',sans-serif", width: '100%',
    boxSizing: 'border-box', background: '#fafafa', minHeight: 44,
  };
  const LBL = (s: string) => (
    <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7280', fontWeight: 700, marginBottom: 5, fontFamily: "'DM Sans',sans-serif" }}>{s}</div>
  );

  // ── Form fields (shared by new + edit) ─────────────────────────────────────

  function FormFields({ form, onChange }: { form: typeof BLANK_FORM; onChange: (f: typeof BLANK_FORM) => void }) {
    const set = (k: keyof typeof BLANK_FORM, v: string) => onChange({ ...form, [k]: v });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          {LBL('Property Name *')}
          <input style={INP} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Fair Oaks Commerce Center" />
        </div>
        <div>
          {LBL('Address')}
          <input style={INP} value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street address" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
          <div>{LBL('City')}<input style={INP} value={form.city} onChange={e => set('city', e.target.value)} placeholder="San Antonio" /></div>
          <div>{LBL('State')}<input style={INP} value={form.state} onChange={e => set('state', e.target.value)} placeholder="TX" /></div>
          <div>{LBL('ZIP')}<input style={INP} value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="78258" /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px,100%), 1fr))', gap: 10 }}>
          <div>{LBL('Type')}
            <select style={INP} value={form.type} onChange={e => set('type', e.target.value)}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>{LBL('Status')}
            <select style={INP} value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_CFG[s]?.label ?? s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px,100%), 1fr))', gap: 10 }}>
          <div>{LBL('Asking Price / Rate ($)')}<input style={INP} type="number" value={form.asking_price} onChange={e => set('asking_price', e.target.value)} placeholder="e.g. 28.00 /SF/yr" /></div>
          <div>{LBL('Sq Ft')}<input style={INP} type="number" value={form.sq_ft} onChange={e => set('sq_ft', e.target.value)} placeholder="e.g. 4200" /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px,100%), 1fr))', gap: 10 }}>
          <div>{LBL('Lot Size')}<input style={INP} value={form.lot_size} onChange={e => set('lot_size', e.target.value)} placeholder="e.g. 0.85 acres" /></div>
          <div>{LBL('Year Built')}<input style={INP} value={form.year_built} onChange={e => set('year_built', e.target.value)} placeholder="e.g. 2005" /></div>
        </div>
        <div>
          {LBL('Listing Agent')}
          <select style={INP} value={form.listing_agent_id} onChange={e => set('listing_agent_id', e.target.value)}>
            <option value="">— Unassigned —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
          </select>
        </div>
        <div>
          {LBL('Description')}
          <textarea style={{ ...INP, minHeight: 80, resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Property highlights, features, zoning…" />
        </div>
        <div>
          {LBL('Internal Notes')}
          <textarea style={{ ...INP, minHeight: 60, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Showing instructions, landlord contact, commission notes…" />
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search listings…"
          style={{ ...INP, flex: 1, minWidth: 160, fontSize: 16 }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ ...INP, width: 'auto', flex: 'none', color: typeFilter ? '#111' : '#9ca3af', fontSize: 16 }}>
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ ...INP, width: 'auto', flex: 'none', color: statusFilter ? '#111' : '#9ca3af', fontSize: 16 }}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_CFG[s]?.label}</option>)}
        </select>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{filtered.length} listing{filtered.length !== 1 ? 's' : ''}</span>
          {isAdmin && (
            <button onClick={() => setShowNew(true)}
              style={{ padding: '10px 18px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 44 }}>
              + New Listing
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🏢</div>Loading listings…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>No listings yet</div>
          {isAdmin && <div style={{ fontSize: 13 }}>Click <strong>+ New Listing</strong> to add your first property.</div>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 16 }}>
          {filtered.map(l => {
            const sc = STATUS_CFG[l.status ?? 'active'] ?? STATUS_CFG.active;
            const tc = TYPE_COLORS[l.type ?? ''] ?? { bg: '#f1f5f9', color: '#475569' };
            const agent = profiles.find(p => p.id === l.listing_agent_id);
            return (
              <div key={l.id} onClick={() => openListing(l)}
                style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.05)', transition: 'box-shadow .15s, transform .1s' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,.1)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,.05)'; e.currentTarget.style.transform = 'none'; }}>

                {/* Color bar */}
                <div style={{ height: 4, background: tc.color, opacity: 0.7 }} />

                <div style={{ padding: '16px 18px' }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 700, color: '#111', lineHeight: 1.25, marginBottom: 3 }}>{l.name}</div>
                      {(l.address || l.city) && (
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                          {[l.address, l.city, l.state].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                    <span style={{ ...sc, padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, flexShrink: 0, letterSpacing: 0.3 } as React.CSSProperties}>
                      {sc.label}
                    </span>
                  </div>

                  {/* Type + price row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <span style={{ ...tc, padding: '2px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700 } as React.CSSProperties}>{l.type}</span>
                    {l.sq_ft && <span style={{ fontSize: 12, color: '#6b7280' }}>{fmtSqFt(l.sq_ft)}</span>}
                    {l.asking_price && (
                      <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: '#c9922c' }}>{fmt$(l.asking_price)}</span>
                    )}
                  </div>

                  {/* Description snippet */}
                  {l.description && (
                    <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>
                      {l.description}
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid #f3f4f6' }}>
                    {agent ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#c9922c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                          {agent.first_name[0]}{agent.last_name[0]}
                        </div>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>{agent.first_name} {agent.last_name}</span>
                      </div>
                    ) : <span />}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
                      {new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Detail Panel ──────────────────────────────────────────────────────── */}
      {active && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex' }} onClick={e => { if (e.target === e.currentTarget) closePanel(); }}>
          <div style={{ flex: 1 }} onClick={closePanel} />
          <div style={{ width: Math.min(560, window.innerWidth), background: '#fff', boxShadow: '-4px 0 40px rgba(0,0,0,.16)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

            {/* Panel header */}
            <div style={{ padding: '20px 24px 0', borderBottom: '1px solid #f0f0f0', paddingBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: '#111', lineHeight: 1.2 }}>{active.name}</div>
                  {(active.address || active.city) && (
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 3 }}>
                      {[active.address, active.city, active.state, active.zip].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
                <button onClick={closePanel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, flexShrink: 0, lineHeight: 1 }}>✕</button>
              </div>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0 }}>
                {[{ k: 'info', label: '📋 Details' }, { k: 'files', label: '📁 Files' }].map(t => (
                  <button key={t.k} onClick={() => setActiveTab(t.k as 'info' | 'files')}
                    style={{ padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", color: activeTab === t.k ? '#c9922c' : '#6b7280', borderBottom: `2px solid ${activeTab === t.k ? '#c9922c' : 'transparent'}`, transition: 'all .15s' }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Panel body */}
            <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>

              {/* ── Info tab ── */}
              {activeTab === 'info' && (
                <FormFields form={editForm} onChange={f => { setEditForm(f); setDirty(true); }} />
              )}

              {/* ── Files tab ── */}
              {activeTab === 'files' && (
                <div>
                  {/* Upload row */}
                  {isAdmin && (
                    <div style={{ background: '#f8fafc', border: '1px dashed #d1d5db', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Upload File</div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select value={uploadCat} onChange={e => setUploadCat(e.target.value)}
                          style={{ ...INP, width: 'auto', flex: '1', minWidth: 140, fontSize: 16 }}>
                          {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                          style={{ padding: '10px 20px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1, whiteSpace: 'nowrap', minHeight: 44, flex: 'none' }}>
                          {uploading ? 'Uploading…' : '+ Upload'}
                        </button>
                        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={uploadFile}
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.ppt,.pptx,.zip,.txt,.csv" />
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>PDF, Word, Excel, PowerPoint, images, ZIP — up to 50 MB</div>
                    </div>
                  )}

                  {/* Files by category */}
                  {filesLoading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 14 }}>Loading files…</div>
                  ) : files.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
                      <div style={{ fontSize: 13 }}>No files uploaded yet</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                      {CATEGORIES.map(cat => {
                        const catFiles = files.filter(f => f.category === cat.key);
                        if (catFiles.length === 0) return null;
                        return (
                          <div key={cat.key}>
                            <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 10 }}>{cat.label} ({catFiles.length})</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {catFiles.map(f => (
                                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px' }}>
                                  <span style={{ fontSize: 22, flexShrink: 0 }}>{fileIcon(f.file_type, f.category)}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{fmtBytes(f.file_size)} · {new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                    {f.url && (
                                      <a href={f.url} target="_blank" rel="noopener noreferrer"
                                        style={{ padding: '5px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, color: '#374151', textDecoration: 'none', fontWeight: 600, cursor: 'pointer' }}>
                                        ↓ View
                                      </a>
                                    )}
                                    {isAdmin && (
                                      <button onClick={() => deleteFile(f.id, f.name)}
                                        style={{ padding: '5px 8px', background: 'none', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626', cursor: 'pointer' }}>✕</button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      {/* Uncategorised fallback */}
                      {(() => {
                        const knownCats = new Set(CATEGORIES.map(c => c.key));
                        const other = files.filter(f => !knownCats.has(f.category));
                        if (!other.length) return null;
                        return (
                          <div>
                            <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 10 }}>📎 Other ({other.length})</div>
                            {other.map(f => (
                              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
                                <span style={{ fontSize: 20 }}>{fileIcon(f.file_type)}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{fmtBytes(f.file_size)}</div>
                                </div>
                                {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>↓ View</a>}
                                {isAdmin && <button onClick={() => deleteFile(f.id, f.name)} style={{ padding: '5px 8px', background: 'none', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626', cursor: 'pointer' }}>✕</button>}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Panel footer */}
            {activeTab === 'info' && isAdmin && (
              <div style={{ padding: '14px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 10 }}>
                <button onClick={deleteListing}
                  style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Delete
                </button>
                <button onClick={closePanel}
                  style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Cancel
                </button>
                <button onClick={saveListing} disabled={!dirty}
                  style={{ flex: 1, padding: '9px 18px', borderRadius: 8, border: 'none', background: dirty ? '#c9922c' : '#e5e7eb', color: dirty ? '#fff' : '#9ca3af', fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', fontFamily: "'DM Sans',sans-serif", transition: 'all .15s' }}>
                  Save Changes
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── New Listing Modal ─────────────────────────────────────────────────── */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, margin: 0, color: '#111' }}>New Listing</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <FormFields form={newForm} onChange={setNewForm} />
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowNew(false)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
              <button onClick={createListing} disabled={!newForm.name.trim() || creating}
                style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: newForm.name.trim() ? '#c9922c' : '#e5e7eb', color: newForm.name.trim() ? '#fff' : '#9ca3af', fontSize: 13, fontWeight: 700, cursor: newForm.name.trim() ? 'pointer' : 'default', fontFamily: "'DM Sans',sans-serif" }}>
                {creating ? 'Creating…' : 'Create Listing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
