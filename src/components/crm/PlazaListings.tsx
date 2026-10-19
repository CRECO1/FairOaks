'use client';
// Plaza Site → Directory: the businesses shown on fairoaksranchplaza.com/directory and the home page.
// Each business gets a private link to confirm its own details + logo. Nothing a tenant submits is public until you Approve.
import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface Invite { id: string; token: string; contact_name: string | null; contact_email: string | null; status: 'invited' | 'submitted' | 'approved' | 'declined'; submitted: Record<string, string> | null; submitted_at: string | null }
interface Listing {
  id: string; name: string; suite: string; building: number | null; category: string | null; description: string; phone: string | null;
  website: string | null; hours: string | null; published: boolean; logo_url: string | null; invite: Invite | null;
}
interface Props { authToken?: string; showToast?: (m: string) => void; isMobile?: boolean }

const SITE = 'https://fairoaksranchplaza.com';
const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans',sans-serif" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 4, display: 'block' };
const btn: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', minHeight: 38, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
const primary: React.CSSProperties = { ...btn, color: '#fff', background: '#C9922C', border: '1px solid #C9922C' };
const STATUS: Record<string, { text: string; color: string }> = {
  invited: { text: 'Invited — no reply yet', color: '#6b7280' }, submitted: { text: 'Needs your review', color: '#b45309' },
  approved: { text: 'Confirmed & approved', color: '#166534' }, declined: { text: 'Declined', color: '#991b1b' },
};

async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  let out = c.toDataURL('image/png');
  if (out.length > 300000) {
    // JPEG has no transparency (it would turn a transparent logo black), so flatten onto white first.
    const j = document.createElement('canvas'); j.width = c.width; j.height = c.height;
    const g = j.getContext('2d')!; g.fillStyle = '#ffffff'; g.fillRect(0, 0, j.width, j.height); g.drawImage(c, 0, 0);
    out = j.toDataURL('image/jpeg', 0.85);
  }
  return out;
}

export default function PlazaListings({ authToken, showToast, isMobile }: Props) {
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'review' | 'waiting' | 'live'>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', suite: '', building: '', category: '', description: '', phone: '', website: '', hours: '' });
  const [adding, setAdding] = useState(false);
  const [newBiz, setNewBiz] = useState({ name: '', suite: '', building: '1', category: '', contact_name: '', contact_email: '' });

  const load = useCallback(async () => {
    const r = await fetch('/api/crm/plaza-listings', { headers: auth(authToken) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast?.(j.error || 'Could not load'); setRows([]); return; }
    setRows(j.listings || []);
  }, [authToken, showToast]);
  useEffect(() => { if (authToken) load(); }, [authToken, load]);

  const post = async (body: Record<string, unknown>, ok: string) => {
    const r = await fetch('/api/crm/plaza-listings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast?.(j.error || 'Something went wrong'); return false; }
    showToast?.(ok); load(); return true;
  };
  const patch = async (id: string, body: Record<string, unknown>, ok: string) => {
    const r = await fetch(`/api/crm/plaza-listings?id=${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast?.(j.error || 'Could not save'); return false; }
    showToast?.(ok); load(); return true;
  };

  const linkFor = (l: Listing) => l.invite ? `${SITE}/claim/${l.invite.token}` : '';
  const copy = async (l: Listing) => { try { await navigator.clipboard.writeText(linkFor(l)); showToast?.('Link copied — send it to the business'); } catch { window.prompt('Copy this link:', linkFor(l)); } };
  const mailto = (l: Listing) => {
    const who = l.invite?.contact_name?.split(' ')[0] || 'there';
    const body = `Hi ${who},\n\nWe're launching the new Fair Oaks Ranch Plaza website (fairoaksranchplaza.com) and we'd love to feature ${l.name} — it's a home for the businesses and the Fair Oaks Ranch community.\n\nCould you take two minutes to confirm your listing? You can add your logo, phone, website, hours and a short description. Nothing is published until you confirm:\n\n${linkFor(l)}\n\nThank you!\nFair Oaks Ranch Plaza`;
    return `mailto:${l.invite?.contact_email ?? ''}?subject=${encodeURIComponent(`Confirm your listing on the Fair Oaks Ranch Plaza website`)}&body=${encodeURIComponent(body)}`;
  };
  const uploadLogo = async (l: Listing, file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { showToast?.('Use a PNG, JPG or WebP image'); return; }
    try { await post({ action: 'logo', id: l.id, logo_data: await shrink(file) }, 'Logo saved'); } catch { showToast?.('Could not read that image'); }
  };

  const counts = useMemo(() => {
    const r = rows ?? [];
    return { review: r.filter(x => x.invite?.status === 'submitted').length, waiting: r.filter(x => x.invite?.status === 'invited').length, live: r.filter(x => x.published).length };
  }, [rows]);
  const shown = (rows ?? []).filter(l => filter === 'all' || (filter === 'review' && l.invite?.status === 'submitted') || (filter === 'waiting' && l.invite?.status === 'invited') || (filter === 'live' && l.published));
  const chip = (id: typeof filter, text: string): React.CSSProperties => ({ ...btn, ...(filter === id ? { background: '#111827', color: '#fff', border: '1px solid #111827' } : {}) });
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 620 }}>
          The businesses on <a href={`${SITE}/directory`} target="_blank" rel="noopener noreferrer" style={{ color: '#a06a12', fontWeight: 700 }}>fairoaksranchplaza.com</a>. Send each one its private link; they add their logo and details, then you <b>Approve</b> to publish. Businesses already on the plaza’s monument sign are live now with name and suite only.
        </div>
        {!adding && <button style={primary} onClick={() => setAdding(true)}>＋ Add business</button>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button style={chip('all', '')} onClick={() => setFilter('all')}>All ({rows?.length ?? 0})</button>
        <button style={chip('review', '')} onClick={() => setFilter('review')}>Needs review ({counts.review})</button>
        <button style={chip('waiting', '')} onClick={() => setFilter('waiting')}>Waiting on reply ({counts.waiting})</button>
        <button style={chip('live', '')} onClick={() => setFilter('live')}>Live ({counts.live})</button>
      </div>

      {adding && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 14, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr 1.4fr', gap: 12 }}>
            <div><span style={label}>Business name</span><input style={input} value={newBiz.name} onChange={e => setNewBiz({ ...newBiz, name: e.target.value })} /></div>
            <div><span style={label}>Suite</span><input style={input} value={newBiz.suite} onChange={e => setNewBiz({ ...newBiz, suite: e.target.value })} /></div>
            <div><span style={label}>Building</span><select style={input} value={newBiz.building} onChange={e => setNewBiz({ ...newBiz, building: e.target.value })}><option>1</option><option>2</option><option>3</option></select></div>
            <div><span style={label}>Category</span><input style={input} value={newBiz.category} onChange={e => setNewBiz({ ...newBiz, category: e.target.value })} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <div><span style={label}>Contact name</span><input style={input} value={newBiz.contact_name} onChange={e => setNewBiz({ ...newBiz, contact_name: e.target.value })} /></div>
            <div><span style={label}>Contact email</span><input style={input} value={newBiz.contact_email} onChange={e => setNewBiz({ ...newBiz, contact_email: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={primary} onClick={async () => { if (await post({ action: 'create', ...newBiz }, 'Added — copy their link to invite them')) { setAdding(false); setNewBiz({ name: '', suite: '', building: '1', category: '', contact_name: '', contact_email: '' }); } }}>Add</button>
            <button style={btn} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {rows === null && <div style={{ color: '#9ca3af' }}>Loading…</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {shown.map(l => {
          const st = l.invite ? STATUS[l.invite.status] : null;
          const sub = l.invite?.submitted;
          return (
            <div key={l.id} style={{ background: '#fff', border: `1px solid ${l.invite?.status === 'submitted' ? '#f59e0b' : '#e5e7eb'}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {l.logo_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={l.logo_url} alt="" style={{ width: 64, height: 64, objectFit: 'contain', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }} />
                  : <div style={{ width: 64, height: 64, border: '1px dashed #d1d5db', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#9ca3af' }}>no logo</div>}
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: l.published ? '#16a34a' : '#9ca3af' }}>{l.published ? 'Live on site' : 'Not public'} · Bldg {l.building ?? '—'} · Suite {l.suite || '—'}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{l.name}{l.category ? <span style={{ fontWeight: 500, color: '#6b7280', fontSize: 13 }}> · {l.category}</span> : null}</div>
                  {st && <div style={{ fontSize: 13, fontWeight: 700, color: st.color }}>{st.text}</div>}
                  <div style={{ fontSize: 12.5, color: '#6b7280' }}>{l.invite?.contact_name || l.invite?.contact_email ? `Contact: ${[l.invite?.contact_name, l.invite?.contact_email].filter(Boolean).join(' · ')}` : 'No contact on file'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button style={btn} onClick={() => copy(l)}>Copy link</button>
                  <a style={{ ...btn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} href={mailto(l)}>Email invite</a>
                  <button style={btn} onClick={() => { setEditing(editing === l.id ? null : l.id); setForm({ name: l.name, suite: l.suite, building: String(l.building ?? ''), category: l.category ?? '', description: l.description, phone: l.phone ?? '', website: l.website ?? '', hours: l.hours ?? '' }); }}>{editing === l.id ? 'Close' : 'Edit'}</button>
                  <button style={btn} onClick={() => patch(l.id, { published: !l.published }, l.published ? 'Hidden from the site' : 'Now live on the site')}>{l.published ? 'Hide' : 'Publish'}</button>
                </div>
              </div>

              {l.invite?.status === 'submitted' && sub && (
                <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>Submitted by {sub.contact_name || 'the business'}{l.invite.submitted_at ? ` on ${new Date(l.invite.submitted_at).toLocaleDateString()}` : ''} — review, then approve</div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '6px 18px', fontSize: 13.5 }}>
                    {([['Name', sub.display_name, l.name], ['Category', sub.category, l.category], ['Phone', sub.phone, l.phone], ['Website', sub.website, l.website], ['Hours', sub.hours, l.hours], ['Description', sub.description, l.description]] as const).map(([k, nv, ov]) => (
                      <div key={k} style={{ gridColumn: k === 'Description' || k === 'Hours' ? '1 / -1' : undefined }}>
                        <b>{k}:</b> {nv || <i style={{ color: '#9ca3af' }}>—</i>}{(nv || '') !== (ov || '') && ov ? <span style={{ color: '#9ca3af' }}> (was: {ov})</span> : null}
                      </div>
                    ))}
                  </div>
                  {sub.logo_data && (/* eslint-disable-next-line @next/next/no-img-element */ <div style={{ marginTop: 10 }}><b style={{ fontSize: 13 }}>New logo:</b><br /><img src={sub.logo_data} alt="Submitted logo" style={{ width: 120, height: 120, objectFit: 'contain', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', marginTop: 4 }} /></div>)}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button style={primary} onClick={() => post({ action: 'approve', id: l.id }, 'Approved — live within 5 minutes')}>Approve &amp; publish</button>
                    <button style={btn} onClick={() => { if (window.confirm('Decline this submission? Nothing will be published.')) post({ action: 'decline', id: l.id }, 'Declined'); }}>Decline</button>
                  </div>
                </div>
              )}

              {editing === l.id && (
                <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr 1.4fr', gap: 10 }}>
                    <div><span style={label}>Name</span><input style={input} value={form.name} onChange={e => set('name', e.target.value)} /></div>
                    <div><span style={label}>Suite</span><input style={input} value={form.suite} onChange={e => set('suite', e.target.value)} /></div>
                    <div><span style={label}>Building</span><select style={input} value={form.building} onChange={e => set('building', e.target.value)}><option value="">—</option><option>1</option><option>2</option><option>3</option></select></div>
                    <div><span style={label}>Category</span><input style={input} value={form.category} onChange={e => set('category', e.target.value)} /></div>
                  </div>
                  <div><span style={label}>Description</span><textarea style={{ ...input, minHeight: 70 }} value={form.description} maxLength={400} onChange={e => set('description', e.target.value)} /></div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                    <div><span style={label}>Phone</span><input style={input} value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
                    <div><span style={label}>Website</span><input style={input} value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://…" /></div>
                  </div>
                  <div><span style={label}>Hours</span><textarea style={{ ...input, minHeight: 56 }} value={form.hours} onChange={e => set('hours', e.target.value)} /></div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button style={primary} onClick={async () => { if (await patch(l.id, { ...form, building: form.building }, 'Saved')) setEditing(null); }}>Save</button>
                    <label style={{ ...btn, display: 'inline-flex', alignItems: 'center' }}>Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={e => { uploadLogo(l, e.target.files?.[0]); e.target.value = ''; }} /></label>
                    <button style={btn} onClick={() => { if (window.confirm('Replace this business’s private link? The old link stops working and any submission is cleared.')) post({ action: 'newlink', id: l.id }, 'New link created — copy it'); }}>New link</button>
                    <button style={{ ...btn, color: '#b91c1c' }} onClick={() => { if (window.confirm(`Delete "${l.name}" from the directory?`)) fetch(`/api/crm/plaza-listings?id=${l.id}`, { method: 'DELETE', headers: auth(authToken) }).then(() => { showToast?.('Deleted'); load(); }); }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
