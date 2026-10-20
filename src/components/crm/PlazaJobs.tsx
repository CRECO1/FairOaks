'use client';
// Plaza Site → Hiring: the "Hire Local" job board at fairoaksranchplaza.com/jobs and the "Now hiring" strip on its home page.
import React, { useCallback, useEffect, useState } from 'react';

interface Job {
  id: string; company: string; title: string; summary: string; location: string | null; employment_type: string | null;
  apply_url: string | null; apply_email: string | null; company_url: string | null; featured: boolean; published: boolean; posted_at: string;
  source?: string; expires_at?: string | null; submitter_name?: string | null; submitter_email?: string | null; submitter_phone?: string | null;
}
interface Props { authToken?: string; showToast?: (m: string) => void; isMobile?: boolean }

const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans',sans-serif" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 4, display: 'block' };
const btn: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 14px', minHeight: 40, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
const primary: React.CSSProperties = { ...btn, color: '#fff', background: '#C9922C', border: '1px solid #C9922C' };
const blank = { company: '', title: '', summary: '', location: '', employment_type: '', apply_url: '', apply_email: '', company_url: '', featured: false, published: true };

export default function PlazaJobs({ authToken, showToast, isMobile }: Props) {
  const [rows, setRows] = useState<Job[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof blank, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    const r = await fetch('/api/crm/plaza-jobs', { headers: auth(authToken) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast?.(j.error || 'Could not load'); setRows([]); return; }
    setRows(j.jobs || []);
  }, [authToken, showToast]);
  useEffect(() => { if (authToken) load(); }, [authToken, load]);

  const startEdit = (j: Job) => {
    setForm({ company: j.company, title: j.title, summary: j.summary, location: j.location ?? '', employment_type: j.employment_type ?? '', apply_url: j.apply_url ?? '', apply_email: j.apply_email ?? '', company_url: j.company_url ?? '', featured: j.featured, published: j.published });
    setEditing(j.id);
  };
  async function save() {
    if (!form.company.trim() || !form.title.trim()) { showToast?.('Add a company and job title'); return; }
    setBusy(true);
    const r = await fetch(editing === 'new' ? '/api/crm/plaza-jobs' : `/api/crm/plaza-jobs?id=${editing}`, { method: editing === 'new' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify(form) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { showToast?.(j.error || 'Could not save'); return; }
    showToast?.(form.published ? 'Saved — live on the site within 5 minutes' : 'Saved (hidden)');
    setEditing(null); load();
  }
  async function patch(j: Job, body: Partial<Job>, msg: string) {
    const r = await fetch(`/api/crm/plaza-jobs?id=${j.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify(body) });
    if (!r.ok) { showToast?.('Could not update'); return; }
    showToast?.(msg); load();
  }
  async function remove(j: Job) {
    if (!window.confirm(`Delete "${j.title}" at ${j.company}? This cannot be undone.`)) return;
    const r = await fetch(`/api/crm/plaza-jobs?id=${j.id}`, { method: 'DELETE', headers: auth(authToken) });
    if (!r.ok) { showToast?.('Could not delete'); return; }
    showToast?.('Deleted'); load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 600 }}>
          Openings on <a href="https://fairoaksranchplaza.com/jobs" target="_blank" rel="noopener noreferrer" style={{ color: '#a06a12', fontWeight: 700 }}>fairoaksranchplaza.com/jobs</a> — local businesses hiring local people. Applicants go straight to the company&apos;s own link or email.
        </div>
        {!editing && <button style={primary} onClick={() => { setForm(blank); setEditing('new'); }}>＋ Add opening</button>}
      </div>

      {editing && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: isMobile ? 14 : 20, marginBottom: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <div><span style={label}>Company</span><input style={input} value={form.company} maxLength={160} onChange={e => set('company', e.target.value)} /></div>
            <div><span style={label}>Job title</span><input style={input} value={form.title} maxLength={160} onChange={e => set('title', e.target.value)} /></div>
          </div>
          <div><span style={label}>Description</span><textarea style={{ ...input, minHeight: 110, resize: 'vertical' }} value={form.summary} maxLength={1500} onChange={e => set('summary', e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <div><span style={label}>Location</span><input style={input} value={form.location} onChange={e => set('location', e.target.value)} placeholder="8000 Fair Oaks Pkwy, Fair Oaks Ranch, TX" /></div>
            <div><span style={label}>Type</span><input style={input} value={form.employment_type} onChange={e => set('employment_type', e.target.value)} placeholder="Full-time, Part-time, Real estate agent…" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 14 }}>
            <div><span style={label}>Apply link</span><input style={input} value={form.apply_url} onChange={e => set('apply_url', e.target.value)} placeholder="https://…" /></div>
            <div><span style={label}>…or apply email</span><input style={input} value={form.apply_email} onChange={e => set('apply_email', e.target.value)} /></div>
            <div><span style={label}>Company website</span><input style={input} value={form.company_url} onChange={e => set('company_url', e.target.value)} placeholder="https://…" /></div>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 14, fontWeight: 600 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.featured} onChange={e => set('featured', e.target.checked)} /> Featured (listed first)</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.published} onChange={e => set('published', e.target.checked)} /> Show on the public site</label>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={primary} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button style={btn} onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {rows === null && <div style={{ color: '#9ca3af' }}>Loading…</div>}
      {rows && rows.length === 0 && !editing && <div style={{ padding: 24, border: '1px dashed #d1d5db', borderRadius: 12, color: '#6b7280' }}>No openings yet.</div>}
      {(() => {
        const pend = (rows ?? []).filter(j => j.source === 'community' && !j.published).length;
        return pend > 0 ? <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 14, fontWeight: 600 }}>{pend} community job posting{pend === 1 ? '' : 's'} waiting for your approval. Review below, edit if needed, then Approve &amp; publish (stays up 60 days).</div> : null;
      })()}
      <div style={{ display: 'grid', gap: 10 }}>
        {(rows ?? []).slice().sort((a, b) => Number(b.source === 'community' && !b.published) - Number(a.source === 'community' && !a.published)).map(j => (
          <div key={j.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 260px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: j.published ? '#16a34a' : j.source === 'community' ? '#d97706' : '#9ca3af' }}>{j.published ? 'Published' : j.source === 'community' ? 'Pending approval' : 'Hidden'}{j.source === 'community' ? ' · Community post' : ''}{j.featured ? ' · Featured' : ''}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '2px 0' }}>{j.title}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>{j.company}{j.location ? ` · ${j.location}` : ''}</div>
              {j.source === 'community' && (
                <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 4 }}>
                  Submitted by {j.submitter_name}{j.submitter_email ? <> · <a href={`mailto:${j.submitter_email}`}>{j.submitter_email}</a></> : null}{j.submitter_phone ? ` · ${j.submitter_phone}` : ''}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={btn} onClick={() => startEdit(j)}>Edit</button>
              <button style={btn} onClick={() => patch(j, { published: !j.published }, j.published ? 'Hidden' : 'Published — live within 5 minutes')}>{j.published ? 'Hide' : j.source === 'community' ? 'Approve & publish' : 'Publish'}</button>
              <button style={{ ...btn, color: '#b91c1c' }} onClick={() => remove(j)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
