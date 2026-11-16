'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DrivePerson } from '@/components/crm/drive/DocsDrive';
import QuickText from '@/components/crm/QuickText';

// "Secure documents" on a contact card: ask a tenant for an application / ID / pay stubs / bank statements through a
// private expiring upload link. Files live in their own private bucket and are shown only to the broker, whoever made the
// request, the contact's owner, and agents added here. Every download is a 5-minute link and is logged.

interface Item { key: string; label: string }
interface SFile { id: string; item_key: string | null; name: string; file_size: number | null; created_at: string; scan_status?: string | null }
interface Req {
  id: string; status: 'open' | 'revoked'; recipient_name: string | null; recipient_email: string | null; note: string | null; items: Item[];
  expires_at: string; purge_after: string; keep_files: boolean; purged_at: string | null; sent_at: string | null; first_viewed_at: string | null;
  view_count: number; last_upload_at: string | null; submitted_at: string | null; created_at: string; created_by: string | null;
  shared_with: string[] | null; link: string | null; files: SFile[]; deal_id?: string | null; deal_label?: string | null;
}
interface TextContact { id: string; name: string; first_name: string; phone: string | null; business_unit: string }
interface LogRow { id: number; actor_label: string; action: string; detail: string | null; created_at: string }

const PRESETS: Record<string, { label: string; items: Item[] }> = {
  tenant: { label: 'Tenant (individual / personal guaranty)', items: [
    { key: 'application', label: 'Completed rental application' }, { key: 'id', label: 'Government photo ID' }, { key: 'paystubs', label: 'Last 3 pay stubs' },
    { key: 'bank', label: 'Last 3 months of bank statements' }, { key: 'tax', label: 'Last 2 years of tax returns' } ] },
  business: { label: 'Business tenant', items: [
    { key: 'application', label: 'Completed rental application' }, { key: 'id', label: 'Government photo ID (each owner / guarantor)' },
    { key: 'financials', label: 'Business financial statements (last 2 years)' }, { key: 'biztax', label: 'Business tax returns (last 2 years)' },
    { key: 'bank', label: 'Last 3 months of business bank statements' }, { key: 'pfs', label: 'Personal financial statement (guarantor)' } ] },
  other: { label: 'Blank — I will list what I need', items: [] },
};

const kb = (n: number | null) => (n == null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const nameOf = (p: DrivePerson) => [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Agent';

function statusOf(r: Req): { text: string; color: string; bg: string } {
  if (r.purged_at) return { text: 'Deleted', color: '#6b7280', bg: '#f3f4f6' };
  if (r.status === 'revoked') return { text: 'Link closed', color: '#6b7280', bg: '#f3f4f6' };
  if (Date.parse(r.expires_at) <= Date.now()) return { text: 'Link expired', color: '#b45309', bg: '#fef3c7' };
  if (r.submitted_at) return { text: 'Received', color: '#15803d', bg: '#dcfce7' };
  if (r.files.length) return { text: 'Uploading', color: '#1d4ed8', bg: '#dbeafe' };
  if (r.first_viewed_at) return { text: 'Opened — nothing yet', color: '#a06a12', bg: '#fdf6e9' };
  return { text: r.sent_at ? 'Waiting for them' : 'Link not sent', color: '#6b7280', bg: '#f3f4f6' };
}

export default function SecureDocs({ clientId, dealId, autoOpen, onAutoOpened, authToken, userId, role, showToast, profiles, onPreview }: {
  /** A contact card passes clientId; a deal card passes dealId (the request then goes to the deal's contact). */
  clientId?: string; dealId?: string;
  /** Open the request form and scroll it into view (set by the contacts list's 🔒 button). */
  autoOpen?: boolean; onAutoOpened?: () => void; authToken?: string; userId?: string; role?: string | null; showToast: (m: string) => void; profiles?: DrivePerson[];
  onPreview?: (f: { url: string; name: string; type?: string | null }) => void;
}) {
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [contact, setContact] = useState<TextContact | null>(null);
  const [textFor, setTextFor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [preset, setPreset] = useState('tenant');
  const [items, setItems] = useState<Item[]>(PRESETS.tenant.items);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [sendMail, setSendMail] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<Record<string, LogRow[] | null>>({});
  const [sharing, setSharing] = useState<string | null>(null);
  const auth = useCallback((): Record<string, string> => (authToken ? { Authorization: `Bearer ${authToken}` } : {}), [authToken]);
  const json = useCallback((): Record<string, string> => ({ 'Content-Type': 'application/json', ...auth() }), [auth]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/crm/secure-requests?${dealId ? `dealId=${dealId}` : `clientId=${clientId}`}`, { headers: auth() });
      const j = await r.json().catch(() => ({}));
      setReqs(r.ok ? (j.requests ?? []) : []);
      setContact(r.ok ? (j.contact ?? null) : null);
    } catch { setReqs([]); }
  }, [clientId, dealId, auth]);
  // Reset only when the card is for a DIFFERENT contact/deal. (A login-token refresh changes `load` too — that must reload the list, never close a form someone is filling in.)
  useEffect(() => { setReqs(null); setCreating(false); setLogs({}); setSharing(null); setTextFor(null); }, [clientId, dealId]);
  useEffect(() => { load(); }, [load]);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { scrollTimers.current.forEach(clearTimeout); }, []);   // only when the section goes away
  useEffect(() => {
    if (!autoOpen || reqs === null) return;   // wait until the list has loaded so the form does not jump
    setCreating(true);
    // The card is still laying out (sections above fill in), so look again a couple of times; a retry only scrolls if the form is still out of view.
    scrollTimers.current.forEach(clearTimeout);
    scrollTimers.current = [150, 600, 1300].map(ms => setTimeout(() => {
      const el = rootRef.current; if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top < 60 || top > window.innerHeight * 0.5) el.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, ms));
    onAutoOpened?.();
  }, [autoOpen, reqs, onAutoOpened]);

  const pick = (k: string) => { setPreset(k); setItems(PRESETS[k].items); };
  const toggle = (i: Item) => setItems(cur => (cur.some(x => x.key === i.key) ? cur.filter(x => x.key !== i.key) : [...cur, i]));
  const addCustom = () => {
    const label = custom.trim(); if (!label) return;
    setItems(cur => [...cur, { key: `c${Date.now().toString(36)}`, label }]); setCustom('');
  };

  const create = async () => {
    if (!items.length) { showToast('Pick at least one document to ask for.'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/crm/secure-requests', { method: 'POST', headers: json(), body: JSON.stringify({ ...(dealId ? { dealId } : { clientId }), items, note, email: email || undefined, send: sendMail }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || 'Could not create the request'); return; }
      setCreating(false); setNote(''); setEmail('');
      if (j.request?.link) { try { await navigator.clipboard.writeText(j.request.link); } catch { /* clipboard may be blocked */ } }
      showToast(j.emailed ? 'Secure link emailed — and copied to your clipboard' : sendMail ? `Request saved, but the email failed${j.emailError ? ` (${j.emailError})` : ''}. Link copied — send it yourself.` : 'Secure link copied to your clipboard');
      await load();
    } finally { setSaving(false); }
  };

  const patch = async (r: Req, body: Record<string, unknown>, ok?: string) => {
    const res = await fetch('/api/crm/secure-requests', { method: 'PATCH', headers: json(), body: JSON.stringify({ id: r.id, ...body }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(j.error || 'That did not work'); return; }
    if (ok) showToast(ok);
    await load();
    if (logs[r.id]) void showLog(r, true);
  };

  const openFile = async (f: SFile, preview: boolean) => {
    const win = preview ? null : window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const res = await fetch(`/api/crm/secure-requests?fileId=${f.id}`, { headers: auth() });
      const url = res.ok ? ((await res.json()).url as string | undefined) : undefined;
      if (!url) { win?.close(); showToast('Could not open the file.'); return; }
      if (preview && onPreview) onPreview({ url, name: f.name });
      else if (win) win.location.href = url; else window.location.href = url;
    } catch { win?.close(); showToast('Could not open the file.'); }
  };

  const delFile = async (f: SFile) => {
    if (!confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
    const res = await fetch('/api/crm/secure-requests', { method: 'DELETE', headers: json(), body: JSON.stringify({ fileId: f.id }) });
    if (!res.ok) { showToast((await res.json().catch(() => ({})))?.error || 'Could not delete'); return; }
    showToast(`${f.name} deleted`); await load();
  };
  const delAll = async (r: Req) => {
    if (!confirm(`Delete this whole secure folder${r.files.length ? ` and its ${r.files.length} file${r.files.length === 1 ? '' : 's'}` : ''}? The link stops working and this cannot be undone.`)) return;
    const res = await fetch('/api/crm/secure-requests', { method: 'DELETE', headers: json(), body: JSON.stringify({ id: r.id }) });
    if (!res.ok) { showToast((await res.json().catch(() => ({})))?.error || 'Could not delete'); return; }
    showToast('Secure folder deleted'); await load();
  };

  const showLog = async (r: Req, force = false) => {
    if (logs[r.id] && !force) { setLogs(l => { const n = { ...l }; delete n[r.id]; return n; }); return; }
    setLogs(l => ({ ...l, [r.id]: null }));
    const res = await fetch(`/api/crm/secure-requests?logFor=${r.id}`, { headers: auth() });
    const j = await res.json().catch(() => ({}));
    setLogs(l => ({ ...l, [r.id]: res.ok ? (j.log ?? []) : [] }));
  };

  const [zipping, setZipping] = useState<string | null>(null);
  const downloadAll = async (r: Req) => {
    setZipping(r.id);
    try {
      const res = await fetch(`/api/crm/secure-requests?zipFor=${r.id}`, { headers: auth() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(j.error || 'Could not prepare the download'); return; }
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const used = new Set<string>();
      for (const f of j.files as { name: string; url: string }[]) {
        const blob = await (await fetch(f.url)).blob();
        let n = f.name; let k = 1;
        while (used.has(n)) { const dot = f.name.lastIndexOf('.'); n = dot > 0 ? `${f.name.slice(0, dot)} (${++k})${f.name.slice(dot)}` : `${f.name} (${++k})`; }
        used.add(n); zip.file(n, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = `${(r.recipient_name || 'secure-documents').replace(/[^\w .-]/g, '_')} - documents.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch { showToast('Could not build the zip — try opening files one at a time.'); }
    finally { setZipping(null); }
  };

  // The text a tenant gets: who it's from, what to do, the private link, when it stops working, the office number.
  const textMessage = (r: Req) => {
    const me = (profiles ?? []).find(p => p.id === userId)?.first_name?.trim();
    const exp = new Date(r.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
    const first = contact?.first_name?.trim();
    return `${first ? `Hi ${first}, ` : 'Hi, '}${me ? `${me} with ` : ''}CRECO here. Please upload your documents through this private link (please don’t email them): ${r.link} — it works until ${exp}. Questions? Call (210) 817-3443.`;
  };
  const markTexted = async (r: Req, how: 'office-line' | 'own-phone') => {
    try { await fetch('/api/crm/secure-requests', { method: 'PATCH', headers: json(), body: JSON.stringify({ id: r.id, action: 'texted', how }) }); await load(); } catch { /* the log entry is a nicety */ }
  };

  const copy = async (link: string | null) => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); showToast('Secure link copied'); } catch { showToast(link); }
  };

  const label: React.CSSProperties = { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600 };
  const touch = typeof window !== 'undefined' && (window.innerWidth < 768 || window.matchMedia?.('(pointer: coarse)').matches);
  const btn: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, padding: touch ? '9px 12px' : '5px 10px', cursor: 'pointer' };
  const list = reqs ?? [];
  const mayShare = (r: Req) => role === 'super_admin' || r.created_by === userId;

  return (
    <div ref={rootRef} style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={label}>🔒 Secure documents{list.length ? ` (${list.length})` : ''}</div>
        <button type="button" onClick={() => setCreating(c => !c)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c9922c', fontSize: 12, fontWeight: 700, padding: touch ? '0 10px' : 0, minHeight: touch ? 40 : undefined }}>
          {creating ? 'Cancel' : '＋ Request documents'}
        </button>
      </div>

      {creating && (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 10, lineHeight: 1.5 }}>
            They get a private link to upload applications, IDs, pay stubs or bank statements — no login, nothing by email.{dealId ? ' Files stay on this deal and also show on the contact’s card.' : ''} Only you, the contact’s owner and agents you add can open the files. Link works 14 days; files auto-delete after 90.
          </div>
          <select value={preset} onChange={e => pick(e.target.value)} style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', marginBottom: 8, fontSize: 14 }}>
            {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
          {[...PRESETS.tenant.items, ...PRESETS.business.items.filter(b => !PRESETS.tenant.items.some(t => t.key === b.key)), ...items.filter(i => i.key.startsWith('c'))]
            .filter((i, n, a) => a.findIndex(x => x.key === i.key) === n).map(i => (
              <label key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: touch ? '8px 0' : '3px 0', fontSize: 13.5 }}>
                <input type="checkbox" checked={items.some(x => x.key === i.key)} onChange={() => toggle(i)} /> {i.label}
              </label>
            ))}
          <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
            <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} placeholder="Something else to ask for…" style={{ flex: 1, padding: 9, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', fontSize: 14 }} />
            <button type="button" onClick={addCustom} style={btn}>Add</button>
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={600} placeholder="Optional note to them (e.g. “Please include the guarantor’s documents too.”)" style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, marginBottom: 6 }}>
            <input type="checkbox" checked={sendMail} onChange={e => setSendMail(e.target.checked)} /> Email the link to them now
          </label>
          {sendMail && <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Their email (leave blank to use the one on the card)" style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }} />}
          <button type="button" disabled={saving} onClick={create} style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: touch ? '12px 18px' : '8px 16px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
            {saving ? 'Creating…' : sendMail ? 'Create & email link' : 'Create link'}
          </button>
        </div>
      )}

      {reqs === null ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af)' }}>Loading…</div>
        : list.length === 0 ? (!creating && <div style={{ fontSize: 13, color: '#d1d5db' }}>Nothing requested yet. Ask for a rental application, ID or bank statements through a private upload link.</div>)
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(r => {
              const st = statusOf(r);
              const live = r.status === 'open' && !r.purged_at && Date.parse(r.expires_at) > Date.now();
              const byItem = (k: string) => r.files.filter(f => (f.item_key ?? 'other') === k);
              const groups: { key: string; label: string }[] = [...r.items, { key: 'other', label: 'Other' }];
              const log = logs[r.id];
              return (
                <div key={r.id} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: st.color, background: st.bg, borderRadius: 999, padding: '3px 9px' }}>{st.text}</span>
                    <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>
                      {r.deal_label && !dealId ? `${r.deal_label} · ` : ''}Asked {day(r.created_at)}{r.recipient_name ? ` · ${r.recipient_name}` : ''}{r.recipient_email ? ` · ${r.recipient_email}` : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 4 }}>
                    {r.purged_at ? 'Files were deleted.' : r.keep_files ? 'Files kept until you delete them.' : `Files auto-delete ${day(r.purge_after)}.`}
                    {live && ` Link works until ${day(r.expires_at)}.`}
                    {r.view_count > 0 && ` Opened ${r.view_count}×.`}
                    {(r.shared_with?.length ?? 0) > 0 && ` Shared with ${r.shared_with!.length} other agent${r.shared_with!.length === 1 ? '' : 's'}.`}
                  </div>

                  {!r.purged_at && groups.map(g => {
                    const fs = byItem(g.key);
                    if (g.key === 'other' && !fs.length) return null;
                    return (
                      <div key={g.key} style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: fs.length ? '#15803d' : 'var(--k-9ca3af)' }}>{fs.length ? '✓' : '○'} {g.label}</div>
                        {fs.map(f => (
                          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0 0 16px' }}>
                            <span style={{ flex: '1 1 140px', minWidth: 0, fontSize: 13, overflowWrap: 'anywhere' }}>📄 {f.name} <span style={{ color: 'var(--k-9ca3af)' }}>{kb(f.file_size)} · {day(f.created_at)}</span>{f.scan_status === 'clean' && <span title="Passed the in-house safety scan when it was uploaded" style={{ color: '#15803d', fontWeight: 600, marginLeft: 6, fontSize: 12 }}>✓ scanned</span>}</span>
                            {onPreview && /\.(pdf|png|jpe?g|webp)$/i.test(f.name) && <button type="button" style={btn} onClick={() => openFile(f, true)}>👁 View</button>}
                            <button type="button" style={{ ...btn, background: '#111', color: '#fff', border: 'none' }} onClick={() => openFile(f, false)}>↓ Open</button>
                            <button type="button" aria-label={`Delete ${f.name}`} onClick={() => delFile(f)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 15, padding: '4px 2px' }}>🗑</button>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {!r.purged_at && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      {r.files.length > 1 && <button type="button" style={btn} disabled={zipping === r.id} onClick={() => downloadAll(r)}>{zipping === r.id ? 'Preparing…' : `↓ Download all (${r.files.length})`}</button>}
                      {live && <button type="button" style={btn} onClick={() => copy(r.link)}>Copy link</button>}
                      {live && <button type="button" style={btn} onClick={() => patch(r, { action: 'resend' }, 'Link emailed')}>{r.sent_at ? 'Resend email' : 'Email link'}</button>}
                      {live && <button type="button" style={btn} onClick={() => setTextFor(t => (t === r.id ? null : r.id))}>💬 Text link</button>}
                      {live ? <button type="button" style={btn} onClick={() => patch(r, { action: 'revoke' }, 'Link closed')}>Close link</button>
                        : <button type="button" style={btn} onClick={() => patch(r, { action: 'extend' }, 'Link reopened for 14 days')}>Reopen link</button>}
                      {live && <button type="button" style={btn} onClick={() => patch(r, { action: 'extend' }, 'Link extended 14 days')}>Extend</button>}
                      <button type="button" style={btn} onClick={() => patch(r, { action: r.keep_files ? 'unkeep' : 'keep' }, r.keep_files ? 'Auto-delete back on' : 'Files will be kept')}>{r.keep_files ? 'Turn auto-delete on' : 'Keep files'}</button>
                      {mayShare(r) && <button type="button" style={btn} onClick={() => setSharing(s => (s === r.id ? null : r.id))}>Who can see</button>}
                      <button type="button" style={btn} onClick={() => showLog(r)}>{log ? 'Hide activity' : 'Activity'}</button>
                      <button type="button" style={{ ...btn, color: '#b91c1c' }} onClick={() => delAll(r)}>Delete folder</button>
                    </div>
                  )}
                  {r.purged_at && <div style={{ marginTop: 8 }}><button type="button" style={btn} onClick={() => showLog(r)}>{log ? 'Hide activity' : 'Activity'}</button></div>}

                  {textFor === r.id && live && r.link && (
                    <div style={{ marginTop: 8 }}>
                      {contact?.phone ? (
                        <>
                          <QuickText authToken={authToken} businessUnit={contact.business_unit} contactId={contact.id} phone={contact.phone} name={contact.name}
                            initialBody={textMessage(r)} showToast={showToast} onSent={() => { void markTexted(r, 'office-line'); }} />
                          <a href={`sms:${contact.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(textMessage(r))}`} onClick={() => { void markTexted(r, 'own-phone'); }}
                            style={{ display: 'inline-block', fontSize: 12.5, fontWeight: 700, color: 'var(--k-374151)', textDecoration: 'underline', padding: touch ? '8px 0' : 0 }}>Or text it from my own phone</a>
                        </>
                      ) : <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', fontStyle: 'italic' }}>There’s no phone number on this contact to text. Add one, or use “Copy link”.</div>}
                    </div>
                  )}
                  {sharing === r.id && (
                    <div style={{ marginTop: 8, background: 'var(--k-f9fafb, #f9fafb)', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--k-6b7280)', marginBottom: 6 }}>The broker, the contact’s owner, whoever made the request{dealId || r.deal_id ? ' and everyone on the deal' : ''} always see this. Tick anyone else who should.</div>
                      {(profiles ?? []).filter(p => p.id !== r.created_by && p.role !== 'super_admin').map(p => (
                        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, padding: touch ? '7px 0' : '2px 0' }}>
                          <input type="checkbox" checked={(r.shared_with ?? []).includes(p.id)}
                            onChange={e => patch(r, { action: 'share', agentIds: e.target.checked ? [...(r.shared_with ?? []), p.id] : (r.shared_with ?? []).filter(x => x !== p.id) })} /> {nameOf(p)}
                        </label>
                      ))}
                    </div>
                  )}
                  {log !== undefined && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--k-6b7280)' }}>
                      {log === null ? 'Loading…' : log.length === 0 ? 'No activity yet.' : log.map(l => (
                        <div key={l.id} style={{ padding: '2px 0' }}><span style={{ color: 'var(--k-9ca3af)' }}>{when(l.created_at)}</span> · <strong>{l.actor_label}</strong> {l.action}{l.detail ? ` — ${l.detail}` : ''}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
