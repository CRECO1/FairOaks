'use client';
// Plaza Site → Local businesses: the vendor/resource directory on fairoaksranchplaza.com/local.
// Tick "Locally owned & operated" only for businesses an owner has confirmed — it drives the public badge.
import React, { useCallback, useEffect, useState } from 'react';
import Skeleton from '@/components/crm/Skeleton';

interface Vendor {
  id: string; name: string; category: string; description: string; phone: string | null; website: string | null;
  address: string | null; note: string | null; featured: boolean; published: boolean; local_owned: boolean;
}
interface Props { authToken?: string; showToast?: (m: string) => void; isMobile?: boolean }

const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans',sans-serif" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: 'var(--k-9ca3af)', marginBottom: 4, display: 'block' };
const btn: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--k-374151)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, padding: '9px 14px', minHeight: 40, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
const primary: React.CSSProperties = { ...btn, color: '#fff', background: '#C9922C', border: '1px solid #C9922C' };
const blank = { name: '', category: '', description: '', phone: '', website: '', address: '', note: '', featured: false, published: true, local_owned: false };

export default function PlazaVendors({ authToken, showToast, isMobile }: Props) {
  const [rows, setRows] = useState<Vendor[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/crm/plaza-vendors', { headers: auth(authToken) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast?.(j.error || 'Could not load'); setRows([]); return; }
    setRows(j.vendors || []);
  }, [authToken, showToast]);
  useEffect(() => { if (authToken) load(); }, [authToken, load]);

  const startEdit = (v: Vendor) => {
    setForm({ name: v.name, category: v.category, description: v.description, phone: v.phone ?? '', website: v.website ?? '', address: v.address ?? '', note: v.note ?? '', featured: v.featured, published: v.published, local_owned: v.local_owned });
    setEditing(v.id);
  };
  const set = (k: keyof typeof blank, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) { showToast?.('Add a name'); return; }
    setBusy(true);
    const r = await fetch(editing === 'new' ? '/api/crm/plaza-vendors' : `/api/crm/plaza-vendors?id=${editing}`, {
      method: editing === 'new' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify(form),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { showToast?.(j.error || 'Could not save'); return; }
    showToast?.(form.published ? 'Saved — live on the site within 5 minutes' : 'Saved (hidden)');
    setEditing(null); load();
  }
  async function patch(v: Vendor, body: Partial<Vendor>, msg: string) {
    const r = await fetch(`/api/crm/plaza-vendors?id=${v.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify(body) });
    if (!r.ok) { showToast?.('Could not update'); return; }
    showToast?.(msg); load();
  }
  async function remove(v: Vendor) {
    if (!window.confirm(`Delete "${v.name}"? This cannot be undone.`)) return;
    const r = await fetch(`/api/crm/plaza-vendors?id=${v.id}`, { method: 'DELETE', headers: auth(authToken) });
    if (!r.ok) { showToast?.('Could not delete'); return; }
    showToast?.('Deleted'); load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--k-6b7280)', maxWidth: 560 }}>
          The public <a href="https://fairoaksranchplaza.com/local" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--k-a06a12)', fontWeight: 700 }}>Local Business &amp; Vendor Resource</a>. Focus is locally owned and operated businesses — only tick that box once the owner is confirmed.
        </div>
        {!editing && <button style={primary} onClick={() => { setForm(blank); setEditing('new'); }}>＋ Add business</button>}
      </div>

      {editing && (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, padding: isMobile ? 14 : 20, marginBottom: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <div><span style={label}>Business name</span><input style={input} value={form.name} maxLength={160} onChange={e => set('name', e.target.value)} /></div>
            <div><span style={label}>Category</span><input style={input} value={form.category} maxLength={80} onChange={e => set('category', e.target.value)} placeholder="e.g. Plumbing, Restaurants, Golf & Recreation" /></div>
          </div>
          <div><span style={label}>Description</span><textarea style={{ ...input, minHeight: 100, resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 14 }}>
            <div><span style={label}>Phone</span><input style={input} value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div><span style={label}>Website</span><input style={input} value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://…" /></div>
            <div><span style={label}>Address</span><input style={input} value={form.address} onChange={e => set('address', e.target.value)} /></div>
          </div>
          <div><span style={label}>Note (small print under the description)</span><input style={input} value={form.note} maxLength={300} onChange={e => set('note', e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 14, fontWeight: 600 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.local_owned} onChange={e => set('local_owned', e.target.checked)} /> Locally owned &amp; operated (confirmed)</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.featured} onChange={e => set('featured', e.target.checked)} /> Featured (listed first)</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.published} onChange={e => set('published', e.target.checked)} /> Show on the public site</label>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={primary} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button style={btn} onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {rows === null && <Skeleton rows={4} />}
      {rows && rows.length === 0 && !editing && <div style={{ padding: 24, border: '1px dashed var(--k-d1d5db)', borderRadius: 12, color: 'var(--k-6b7280)' }}>No businesses yet.</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {(rows ?? []).map(v => (
          <div key={v.id} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 260px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: v.published ? 'var(--k-16a34a)' : 'var(--k-9ca3af)' }}>
                {v.published ? 'Published' : 'Hidden'} · {v.category}{v.featured ? ' · Featured' : ''}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '2px 0' }}>{v.name}</div>
              <div style={{ fontSize: 13, color: v.local_owned ? 'var(--k-166534)' : 'var(--k-9ca3af)', fontWeight: 600 }}>{v.local_owned ? '✓ Locally owned & operated' : 'Local ownership not confirmed — no badge'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={btn} onClick={() => startEdit(v)}>Edit</button>
              <button style={btn} onClick={() => patch(v, { local_owned: !v.local_owned }, v.local_owned ? 'Badge removed' : 'Confirmed locally owned')}>{v.local_owned ? 'Remove badge' : 'Confirm local'}</button>
              <button style={btn} onClick={() => patch(v, { published: !v.published }, v.published ? 'Hidden' : 'Published — live within 5 minutes')}>{v.published ? 'Hide' : 'Publish'}</button>
              <button style={{ ...btn, color: 'var(--k-b91c1c)' }} onClick={() => remove(v)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
