'use client';
// Plaza Site — post news, events, notices and specials to fairoaksranchplaza.com.
// Published posts appear on the public site within ~5 minutes; drafts stay private.
import React, { useCallback, useEffect, useState } from 'react';
import PlazaVendors from '@/components/crm/PlazaVendors';
import PlazaListings from '@/components/crm/PlazaListings';
import PlazaJobs from '@/components/crm/PlazaJobs';

interface Post {
  id: string; slug: string; kind: 'news' | 'event' | 'notice' | 'promo'; title: string; summary: string; body: string;
  starts_at: string | null; location: string | null; published: boolean; published_at: string;
}
interface Props { authToken?: string; showToast?: (m: string) => void; isMobile?: boolean }

const SITE = 'https://fairoaksranchplaza.com';
const KIND_LABEL: Record<Post['kind'], string> = { news: 'News', event: 'Event', notice: 'Notice', promo: 'Special / promo' };
const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans',sans-serif" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 4, display: 'block' };
const btn: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 14px', minHeight: 40, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
const primary: React.CSSProperties = { ...btn, color: '#fff', background: '#C9922C', border: '1px solid #C9922C' };

// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm".
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmt = (iso: string, time = false) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) });

const blank = { kind: 'news' as Post['kind'], title: '', summary: '', body: '', starts_at: '', location: '', published: true };

export default function PlazaPosts({ authToken, showToast, isMobile }: Props) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'posts' | 'vendors' | 'directory' | 'jobs'>('directory');

  const load = useCallback(async () => {
    const r = await fetch('/api/crm/plaza-posts', { headers: auth(authToken) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast?.(j.error || 'Could not load posts'); setPosts([]); return; }
    setPosts(j.posts || []);
  }, [authToken, showToast]);
  useEffect(() => { if (authToken) load(); }, [authToken, load]);

  const startNew = () => { setForm(blank); setEditing('new'); };
  const startEdit = (p: Post) => {
    setForm({ kind: p.kind, title: p.title, summary: p.summary, body: p.body, starts_at: toLocalInput(p.starts_at), location: p.location ?? '', published: p.published });
    setEditing(p.id);
  };

  async function save() {
    if (!form.title.trim()) { showToast?.('Add a title'); return; }
    if (form.kind === 'event' && !form.starts_at) { showToast?.('Events need a date and time'); return; }
    setBusy(true);
    const payload = { ...form, starts_at: form.kind === 'event' || form.starts_at ? form.starts_at : '' };
    const r = await fetch(editing === 'new' ? '/api/crm/plaza-posts' : `/api/crm/plaza-posts?id=${editing}`, {
      method: editing === 'new' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { showToast?.(j.error || 'Could not save'); return; }
    showToast?.(form.published ? 'Saved — live on the site within 5 minutes' : 'Saved as a draft');
    setEditing(null); load();
  }

  async function togglePublish(p: Post) {
    const r = await fetch(`/api/crm/plaza-posts?id=${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ published: !p.published }) });
    if (!r.ok) { showToast?.('Could not update'); return; }
    showToast?.(p.published ? 'Unpublished' : 'Published — live within 5 minutes'); load();
  }
  async function remove(p: Post) {
    if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    const r = await fetch(`/api/crm/plaza-posts?id=${p.id}`, { method: 'DELETE', headers: auth(authToken) });
    if (!r.ok) { showToast?.('Could not delete'); return; }
    showToast?.('Deleted'); load();
  }

  const set = (k: keyof typeof blank, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const tabBtn = (id: 'posts' | 'vendors' | 'directory' | 'jobs', text: string): React.CSSProperties => ({ ...btn, ...(tab === id ? { background: '#111827', color: '#fff', border: '1px solid #111827' } : {}) });
  const tabs = (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <button style={tabBtn('directory', 'Directory')} onClick={() => setTab('directory')}>Directory</button>
      <button style={tabBtn('posts', 'News & events')} onClick={() => setTab('posts')}>News &amp; events</button>
      <button style={tabBtn('vendors', 'Local businesses')} onClick={() => setTab('vendors')}>Local businesses</button>
      <button style={tabBtn('jobs', 'Hiring')} onClick={() => setTab('jobs')}>Hiring</button>
    </div>
  );
  if (tab === 'directory') return (<div><h2 style={{ margin: '0 0 12px', fontSize: 22 }}>Plaza Site</h2>{tabs}<PlazaListings authToken={authToken} showToast={showToast} isMobile={isMobile} /></div>);
  if (tab === 'jobs') return (<div><h2 style={{ margin: '0 0 12px', fontSize: 22 }}>Plaza Site</h2>{tabs}<PlazaJobs authToken={authToken} showToast={showToast} isMobile={isMobile} /></div>);
  if (tab === 'vendors') return (<div><h2 style={{ margin: '0 0 12px', fontSize: 22 }}>Plaza Site</h2>{tabs}<PlazaVendors authToken={authToken} showToast={showToast} isMobile={isMobile} /></div>);

  return (
    <div>
      {tabs}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>Plaza Site</h2>
          <div style={{ fontSize: 13, color: '#6b7280' }}>News, events, notices and specials for <a href={SITE} target="_blank" rel="noopener noreferrer" style={{ color: '#a06a12', fontWeight: 700 }}>fairoaksranchplaza.com</a>. Published posts go live within about 5 minutes.</div>
        </div>
        {!editing && <button style={primary} onClick={startNew}>＋ New post</button>}
      </div>

      {editing && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: isMobile ? 14 : 20, marginBottom: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <div><span style={label}>Type</span>
              <select style={input} value={form.kind} onChange={e => set('kind', e.target.value)}>
                {(Object.keys(KIND_LABEL) as Post['kind'][]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select></div>
            <div><span style={label}>Title</span><input style={input} value={form.title} maxLength={200} onChange={e => set('title', e.target.value)} placeholder="e.g. Parker's Ice Cream: Fall flavors are here" /></div>
          </div>
          {form.kind === 'event' && (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
              <div><span style={label}>Date &amp; time</span><input style={input} type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)} /></div>
              <div><span style={label}>Location</span><input style={input} value={form.location} maxLength={200} onChange={e => set('location', e.target.value)} placeholder="8000 Fair Oaks Pkwy — Building 2 patio" /></div>
            </div>
          )}
          <div><span style={label}>Short summary (shows on cards)</span><input style={input} value={form.summary} maxLength={400} onChange={e => set('summary', e.target.value)} /></div>
          <div><span style={label}>Full text</span><textarea style={{ ...input, minHeight: 160, resize: 'vertical' }} value={form.body} onChange={e => set('body', e.target.value)} placeholder="Blank lines start a new paragraph." /></div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, fontWeight: 600 }}>
            <input type="checkbox" checked={form.published} onChange={e => set('published', e.target.checked)} /> Publish to the public site
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={primary} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button style={btn} onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {posts === null && <div style={{ color: '#9ca3af' }}>Loading…</div>}
      {posts && posts.length === 0 && !editing && (
        <div style={{ padding: 24, border: '1px dashed #d1d5db', borderRadius: 12, color: '#6b7280' }}>No posts yet. Click “＋ New post” to add the first one.</div>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {(posts ?? []).map(p => (
          <div key={p.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 260px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: p.published ? '#16a34a' : '#9ca3af' }}>
                {p.published ? 'Published' : 'Draft'} · {KIND_LABEL[p.kind]}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '2px 0' }}>{p.title}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {p.kind === 'event' && p.starts_at ? `${fmt(p.starts_at, true)}${p.location ? ` · ${p.location}` : ''}` : fmt(p.published_at)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {p.published && <a style={{ ...btn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} href={`${SITE}/news/${p.slug}`} target="_blank" rel="noopener noreferrer">View</a>}
              <button style={btn} onClick={() => startEdit(p)}>Edit</button>
              <button style={btn} onClick={() => togglePublish(p)}>{p.published ? 'Unpublish' : 'Publish'}</button>
              <button style={{ ...btn, color: '#b91c1c' }} onClick={() => remove(p)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
