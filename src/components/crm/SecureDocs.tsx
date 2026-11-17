'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DrivePerson } from '@/components/crm/drive/DocsDrive';
import QuickText from '@/components/crm/QuickText';
import { secureState } from '@/lib/secure-status';
import { UploadTray, useUploadQueue, type UpRunner } from '@/components/crm/UploadTray';
import { putWithProgress } from '@/lib/upload-client';

// "Secure documents" on a contact card: ask a tenant for an application / ID / pay stubs / bank statements through a
// private expiring upload link. Files live in their own private bucket and are shown only to the broker, whoever made the
// request, the contact's owner, and agents added here. Every download is a 5-minute link and is logged.

interface Item { key: string; label: string }
interface SFile { id: string; item_key: string | null; name: string; file_size: number | null; created_at: string; scan_status?: string | null; uploaded_by?: string | null }
interface Req {
  id: string; status: 'open' | 'revoked'; recipient_name: string | null; recipient_email: string | null; note: string | null; items: Item[];
  expires_at: string; purge_after: string; keep_files: boolean; purged_at: string | null; sent_at: string | null; first_viewed_at: string | null;
  view_count: number; last_upload_at: string | null; submitted_at: string | null; created_at: string; created_by: string | null;
  shared_with: string[] | null; link: string | null; files: SFile[]; deal_id?: string | null; deal_label?: string | null;
  client_id?: string | null; kind?: 'request' | 'folder'; name?: string | null; has_password?: boolean; guest_view?: boolean;
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

const statusOf = (r: Req) => secureState({ ...r, fileCount: r.files.length });
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.csv';
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;   // the same test the server applies before it sends
// A password that is easy to read out over the phone and hard to guess: two plain words and four digits.
const WORDS = ['Maple', 'River', 'Cedar', 'Stone', 'Amber', 'Field', 'Harbor', 'Canyon', 'Meadow', 'Summit', 'Prairie', 'Juniper', 'Copper', 'Willow', 'Falcon', 'Garnet', 'Lantern', 'Orchard', 'Pebble', 'Quartz', 'Ranch', 'Saddle', 'Timber', 'Valley', 'Wagon', 'Yarrow', 'Bluff', 'Creek', 'Dune', 'Ember', 'Grove', 'Mesa'];
function makePassword(): string {
  const n = new Uint32Array(3); crypto.getRandomValues(n);
  return `${WORDS[n[0] % WORDS.length]}-${WORDS[n[1] % WORDS.length]}-${String(1000 + (n[2] % 9000))}`;
}

export default function SecureDocs({ clientId, dealId, requestId, onChanged, autoOpen, autoScroll, onAutoOpened, authToken, userId, role, showToast, profiles, onPreview }: {
  /** A contact card passes clientId; a deal card passes dealId (the request then goes to the deal's contact). */
  clientId?: string; dealId?: string;
  /** My Drive opens ONE folder: just that folder's card, with no heading and no request form. */
  requestId?: string; onChanged?: () => void;
  /** Open the request form and scroll it into view (set by the contacts list's 🔒 button). */
  autoOpen?: boolean; onAutoOpened?: () => void;
  /** Just bring this section into view (opened from the My Drive index) — no form. */
  autoScroll?: boolean; authToken?: string; userId?: string; role?: string | null; showToast: (m: string) => void; profiles?: DrivePerson[];
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
  // Password on the link: for a new request (reqPw) and for an existing folder (pwFor = its id).
  const [reqPw, setReqPw] = useState('');
  const [reqView, setReqView] = useState(false);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pwText, setPwText] = useState('');
  const [pwView, setPwView] = useState(true);
  // Small in-card forms for a stand-alone folder: who to email its link to (mailFor = its id), and a new name (renameFor).
  const [mailFor, setMailFor] = useState<string | null>(null);
  const [mailTo, setMailTo] = useState('');
  const [mailBusy, setMailBusy] = useState(false);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  // An agent adding their own files to a folder.
  const [dropOn, setDropOn] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const addTarget = useRef<Req | null>(null);
  const auth = useCallback((): Record<string, string> => (authToken ? { Authorization: `Bearer ${authToken}` } : {}), [authToken]);
  const json = useCallback((): Record<string, string> => ({ 'Content-Type': 'application/json', ...auth() }), [auth]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/crm/secure-requests?${requestId ? `id=${requestId}` : dealId ? `dealId=${dealId}` : `clientId=${clientId}`}`, { headers: auth() });
      const j = await r.json().catch(() => ({}));
      setReqs(r.ok ? (j.requests ?? []) : []);
      setContact(r.ok ? (j.contact ?? null) : null);
    } catch { setReqs([]); }
  }, [clientId, dealId, requestId, auth]);
  // Reset only when the card is for a DIFFERENT contact/deal. (A login-token refresh changes `load` too — that must reload the list, never close a form someone is filling in.)
  useEffect(() => { setReqs(null); setCreating(false); setLogs({}); setSharing(null); setTextFor(null); setPwFor(null); setMailFor(null); setRenameFor(null); }, [clientId, dealId, requestId]);
  useEffect(() => { load(); }, [load]);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const consumed = useRef(onAutoOpened);
  consumed.current = onAutoOpened;   // latest callback without re-running the effects below on every parent render
  const openedByList = useRef(false);
  useEffect(() => () => { scrollTimers.current.forEach(clearTimeout); }, []);   // only when the section goes away
  useEffect(() => {
    if (!autoOpen && !autoScroll) return;
    if (autoOpen) { openedByList.current = true; setCreating(true); }   // at once — never wait on the list of earlier requests (that fetch can take seconds on a cold start)
    // The card is still laying out (sections above fill in and push this down), so look again a few times; a retry only scrolls if the section has drifted out of view.
    scrollTimers.current.forEach(clearTimeout);
    scrollTimers.current = [60, 400, 1000, 2500].map(ms => setTimeout(() => {
      const el = rootRef.current; if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top < 60 || top > window.innerHeight * 0.5) el.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, ms));
    if (!autoOpen) scrollTimers.current.push(setTimeout(() => consumed.current?.(), 2800));   // scroll-only: done once it has settled
  }, [autoOpen, autoScroll]);
  // The list's request stays alive until the person closes the form (Cancel, or after creating one). If the card is rebuilt in the
  // meantime — which happens in the first seconds after the page loads — the new copy simply opens the form again.
  useEffect(() => {
    if (!creating && openedByList.current) { openedByList.current = false; consumed.current?.(); }
  }, [creating]);

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
      const r = await fetch('/api/crm/secure-requests', { method: 'POST', headers: json(), body: JSON.stringify({ ...(dealId ? { dealId } : { clientId }), items, note, email: email || undefined, send: sendMail, ...(reqPw ? { password: reqPw, guestView: reqView } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || 'Could not create the request'); return; }
      const hadPw = !!reqPw;
      setCreating(false); setNote(''); setEmail(''); setReqPw(''); setReqView(false);
      if (j.request?.link) { try { await navigator.clipboard.writeText(j.request.link); } catch { /* clipboard may be blocked */ } }
      if (hadPw) showToast('Created. Give them the password by phone or text — never by email.');
      else showToast(j.emailed ? 'Secure link emailed — and copied to your clipboard' : sendMail ? `Request saved, but the email failed${j.emailError ? ` (${j.emailError})` : ''}. Link copied — send it yourself.` : 'Secure link copied to your clipboard');
      await load();
    } finally { setSaving(false); }
  };

  const patch = async (r: Req, body: Record<string, unknown>, ok?: string) => {
    const res = await fetch('/api/crm/secure-requests', { method: 'PATCH', headers: json(), body: JSON.stringify({ id: r.id, ...body }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(j.error || 'That did not work'); return false; }
    if (ok) showToast(ok);
    await load(); onChanged?.();
    if (logs[r.id]) void showLog(r, true);
    return true;
  };

  // Add files of your own: straight to storage, then the server runs the same type + safety checks a visitor's upload gets.
  // The shared queue (pre-check, HEIC → JPG, progress, Retry, failure log) is UploadTray.tsx; ctx = the folder's request id.
  const runSecureUpload: UpRunner = async (file, { setPct, ctx }) => {
    const id = String(ctx ?? '');
    const pre = await fetch('/api/crm/secure-requests', { method: 'POST', headers: json(), body: JSON.stringify({ action: 'presign', id, filename: file.name, file_size: file.size }) });
    const pj = await pre.json().catch(() => ({}));
    if (!pre.ok) return { ok: false, stage: 'start', error: pj.error || `Could not start the upload (${pre.status})` };
    const put = await putWithProgress(pj.uploadUrl, file, pj.contentType, setPct);
    if (!put.ok) return { ok: false, stage: 'send', error: put.status === 0 ? 'The connection dropped while sending — check your signal and press Retry.' : `Storage refused the file (${put.status}).` };
    const conf = await fetch('/api/crm/secure-requests', { method: 'POST', headers: json(), body: JSON.stringify({ action: 'confirm', id, storagePath: pj.storagePath, filename: file.name }) });
    const cj = await conf.json().catch(() => ({}));
    if (!conf.ok) return { ok: false, stage: 'save', error: cj.error || `Could not save the file (${conf.status}) — press Retry.` };
    return { ok: true, note: 'scanned and added to the secure folder' };
  };
  const upQ = useUploadQueue({ profile: 'secure', target: 'secure', run: runSecureUpload, authToken: undefined, onAllDone: () => { void load(); onChanged?.(); } });
  const addFiles = async (r: Req, picked: FileList | File[] | null) => { void upQ.add(picked, r.id); };
  const addingTo = (id: string) => upQ.items.some(i => i.ctx === id && (i.state === 'queued' || i.state === 'working'));

  const savePassword = async (r: Req) => {
    if (await patch(r, { action: 'set_password', password: pwText, guestView: pwView }, 'Password saved. Give it to them by phone or text — never by email.')) { setPwFor(null); setPwText(''); }
  };

  const sendFolderLink = async (r: Req) => {
    const to = mailTo.trim();
    if (!EMAIL_OK.test(to) || mailBusy) return;
    setMailBusy(true);
    try {
      if (await patch(r, { action: 'resend', email: to }, r.has_password ? `Link emailed to ${to}. Give them the password by phone or text.` : `Link emailed to ${to}`)) { setMailFor(null); setMailTo(''); }
    } finally { setMailBusy(false); }
  };
  const saveName = async (r: Req) => {
    const n = renameText.trim();
    if (!n) return;
    if (n === (r.name ?? '') || await patch(r, { action: 'rename', name: n }, 'Renamed')) setRenameFor(null);
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
    showToast(`${f.name} deleted`); await load(); onChanged?.();
  };
  const delAll = async (r: Req) => {
    if (!confirm(`Delete this whole secure folder${r.files.length ? ` and its ${r.files.length} file${r.files.length === 1 ? '' : 's'}` : ''}? The link stops working and this cannot be undone.`)) return;
    const res = await fetch('/api/crm/secure-requests', { method: 'DELETE', headers: json(), body: JSON.stringify({ id: r.id }) });
    if (!res.ok) { showToast((await res.json().catch(() => ({})))?.error || 'Could not delete'); return; }
    showToast('Secure folder deleted'); await load(); onChanged?.();
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
      a.download = `${(r.name || r.recipient_name || 'secure-documents').replace(/[^\w .-]/g, '_')} - documents.zip`;
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
    return `${first ? `Hi ${first}, ` : 'Hi, '}${me ? `${me} with ` : ''}CRECO here. Please upload your documents through this private link (please don’t email them): ${r.link} — it works until ${exp}.${r.has_password ? ' It needs a password — I’ll give you that by phone.' : ''} Questions? Call (210) 817-3443.`;
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
    <div ref={rootRef} style={{ marginBottom: 22, scrollMarginTop: 68 }}>
      <input ref={addInput} type="file" multiple accept={ACCEPT} hidden onChange={e => { const t = addTarget.current; const fl = e.target.files ? Array.from(e.target.files) : []; e.target.value = ''; if (t) void addFiles(t, fl); }} />
      {!requestId && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={label}>🔒 Secure documents{list.length ? ` (${list.length})` : ''}</div>
        <button type="button" onClick={() => setCreating(c => !c)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c9922c', fontSize: 12, fontWeight: 700, padding: touch ? '0 10px' : 0, minHeight: touch ? 40 : undefined }}>
          {creating ? 'Cancel' : '＋ Request documents'}
        </button>
      </div>}

      {creating && !requestId && (
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
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input value={reqPw} onChange={e => setReqPw(e.target.value)} type="text" autoComplete="off" placeholder="Password on the link (optional, 8+ characters)" style={{ flex: 1, minWidth: 0, padding: 9, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', fontSize: 14, boxSizing: 'border-box' }} />
            <button type="button" onClick={() => setReqPw(makePassword())} style={btn}>Suggest</button>
          </div>
          {reqPw && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, marginBottom: 4 }}>
                <input type="checkbox" checked={reqView} onChange={e => setReqView(e.target.checked)} /> With the password they can also open the files in this folder
              </label>
              <div style={{ fontSize: 12, color: 'var(--k-a06a12)', marginBottom: 8 }}>🔑 Give them the password by phone or text — it is never put in the email. It can’t be shown again after this, only replaced.</div>
            </>
          )}
          <button type="button" disabled={saving} onClick={create} style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: touch ? '12px 18px' : '8px 16px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
            {saving ? 'Creating…' : sendMail ? 'Create & email link' : 'Create link'}
          </button>
        </div>
      )}

      {reqs === null ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af)' }}>Loading…</div>
        : list.length === 0 ? (!creating && <div style={{ fontSize: 13, color: '#d1d5db' }}>{requestId ? 'This folder isn’t available to you.' : 'Nothing requested yet. Ask for a rental application, ID or bank statements through a private upload link.'}</div>)
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(r => {
              const st = statusOf(r);
              const live = r.status === 'open' && !r.purged_at && Date.parse(r.expires_at) > Date.now();
              const byItem = (k: string) => r.files.filter(f => (f.item_key ?? 'other') === k);
              const isFolder = r.kind === 'folder';
              const groups: { key: string; label: string }[] = [...r.items, { key: 'other', label: r.items.length ? 'Other' : 'Files' }];
              const log = logs[r.id];
              const whoAdded = (f: SFile) => (f.uploaded_by ? (f.uploaded_by === userId ? 'added by you' : `added by ${nameOf((profiles ?? []).find(p => p.id === f.uploaded_by) ?? { id: '' })}`) : isFolder ? 'through the link' : '');
              return (
                <div key={r.id} onDragOver={e => { if (!r.purged_at && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropOn(r.id); } }} onDragLeave={() => setDropOn(d => (d === r.id ? null : d))}
                  onDrop={e => { if (r.purged_at || !e.dataTransfer.files.length) return; e.preventDefault(); setDropOn(null); void addFiles(r, Array.from(e.dataTransfer.files)); }}
                  style={{ background: 'var(--k-fff)', border: `1px solid ${dropOn === r.id ? '#c9922c' : 'var(--k-e5e7eb)'}`, outline: dropOn === r.id ? '2px dashed #c9922c' : 'none', outlineOffset: 2, borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: st.color, background: st.bg, borderRadius: 999, padding: '3px 9px' }}>{st.text}</span>
                    <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>
                      {isFolder ? `${r.name ?? 'Secure folder'} · Created ${day(r.created_at)}` : <>{r.deal_label && !dealId ? `${r.deal_label} · ` : ''}Asked {day(r.created_at)}{r.recipient_name ? ` · ${r.recipient_name}` : ''}{r.recipient_email ? ` · ${r.recipient_email}` : ''}</>}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 4 }}>
                    {r.purged_at ? 'Files were deleted.' : r.keep_files ? 'Files kept until you delete them.' : `Files auto-delete ${day(r.purge_after)}.`}
                    {live && ` Link works until ${day(r.expires_at)}.`}
                    {r.view_count > 0 && ` Opened ${r.view_count}×.`}
                    {(r.shared_with?.length ?? 0) > 0 && ` Shared with ${r.shared_with!.length} other agent${r.shared_with!.length === 1 ? '' : 's'}.`}
                  </div>
                  {!r.purged_at && (live || r.has_password) && (
                    <div style={{ fontSize: 11.5, marginTop: 3, color: r.has_password ? '#15803d' : 'var(--k-a06a12)' }}>
                      {r.has_password ? `🔑 Password required to get in · with it they can ${r.guest_view ? 'open the files and add their own' : 'only add files'}` : '🔓 No password — the link can only add files, never open them'}
                    </div>
                  )}

                  {!r.purged_at && groups.map(g => {
                    const fs = byItem(g.key);
                    if (g.key === 'other' && !fs.length) return null;
                    return (
                      <div key={g.key} style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: fs.length ? '#15803d' : 'var(--k-9ca3af)' }}>{fs.length ? '✓' : '○'} {g.label}</div>
                        {fs.map(f => (
                          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0 0 16px' }}>
                            <span style={{ flex: '1 1 140px', minWidth: 0, fontSize: 13, overflowWrap: 'anywhere' }}>📄 {f.name} <span style={{ color: 'var(--k-9ca3af)' }}>{[kb(f.file_size), day(f.created_at), whoAdded(f)].filter(Boolean).join(' · ')}</span>{f.scan_status === 'clean' && <span title="Passed the in-house safety scan when it was uploaded" style={{ color: '#15803d', fontWeight: 600, marginLeft: 6, fontSize: 12 }}>✓ scanned</span>}</span>
                            {onPreview && /\.(pdf|png|jpe?g|webp)$/i.test(f.name) && <button type="button" style={btn} onClick={() => openFile(f, true)}>👁 View</button>}
                            <button type="button" style={{ ...btn, background: '#111', color: '#fff', border: 'none' }} onClick={() => openFile(f, false)}>↓ Open</button>
                            <button type="button" aria-label={`Delete ${f.name}`} onClick={() => delFile(f)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 15, padding: '4px 2px' }}>🗑</button>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {!r.purged_at && isFolder && r.files.length === 0 && !addingTo(r.id) && !upQ.items.some(i => i.ctx === r.id) && <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', marginTop: 8 }}>No files yet. Add your own, or drop them onto this card.</div>}
                  <UploadTray items={upQ.items.filter(i => i.ctx === r.id)} onRetry={upQ.retry} onDismiss={upQ.dismiss} />
                  {!r.purged_at && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      <button type="button" style={{ ...btn, color: '#a06a12', borderColor: '#f0e2c4', background: 'var(--k-fdf6e9)' }} disabled={addingTo(r.id)} onClick={() => { addTarget.current = r; addInput.current?.click(); }}>＋ Add files</button>
                      {r.files.length > 1 && <button type="button" style={btn} disabled={zipping === r.id} onClick={() => downloadAll(r)}>{zipping === r.id ? 'Preparing…' : `↓ Download all (${r.files.length})`}</button>}
                      {live && <button type="button" style={btn} onClick={() => copy(r.link)}>Copy link</button>}
                      {live && <button type="button" style={btn} aria-expanded={r.client_id ? undefined : mailFor === r.id} onClick={() => {
                        if (r.client_id) { void patch(r, { action: 'resend' }, 'Link emailed'); return; }
                        setMailTo(r.recipient_email ?? ''); setRenameFor(null); setMailFor(m => (m === r.id ? null : r.id));
                      }}>{r.sent_at ? 'Resend email' : 'Email link'}</button>}
                      {live && contact && <button type="button" style={btn} onClick={() => setTextFor(t => (t === r.id ? null : r.id))}>💬 Text link</button>}
                      {live ? <button type="button" style={btn} onClick={() => patch(r, { action: 'revoke' }, 'Link closed')}>Close link</button>
                        : <button type="button" style={btn} onClick={() => patch(r, { action: 'extend' }, isFolder && !r.sent_at && !r.view_count ? 'Link created — it works for 14 days' : 'Link reopened for 14 days')}>{isFolder && !r.sent_at && !r.view_count ? 'Create a link' : 'Reopen link'}</button>}
                      {mayShare(r) && <button type="button" style={btn} onClick={() => { setPwFor(p => (p === r.id ? null : r.id)); setPwText(''); setPwView(r.has_password ? !!r.guest_view : true); }}>{r.has_password ? '🔑 Change password' : '🔑 Set a password'}</button>}
                      {live && <button type="button" style={btn} onClick={() => patch(r, { action: 'extend' }, 'Link extended 14 days')}>Extend</button>}
                      <button type="button" style={btn} onClick={() => patch(r, { action: r.keep_files ? 'unkeep' : 'keep' }, r.keep_files ? 'Auto-delete back on' : 'Files will be kept')}>{r.keep_files ? 'Turn auto-delete on' : 'Keep files'}</button>
                      {mayShare(r) && <button type="button" style={btn} onClick={() => setSharing(s => (s === r.id ? null : r.id))}>Who can see</button>}
                      {isFolder && mayShare(r) && <button type="button" style={btn} aria-expanded={renameFor === r.id} onClick={() => { setRenameText(r.name ?? ''); setMailFor(null); setRenameFor(x => (x === r.id ? null : r.id)); }}>Rename</button>}
                      <button type="button" style={btn} onClick={() => showLog(r)}>{log ? 'Hide activity' : 'Activity'}</button>
                      <button type="button" style={{ ...btn, color: '#b91c1c' }} onClick={() => delAll(r)}>Delete folder</button>
                    </div>
                  )}
                  {r.purged_at && <div style={{ marginTop: 8 }}><button type="button" style={btn} onClick={() => showLog(r)}>{log ? 'Hide activity' : 'Activity'}</button></div>}

                  {mailFor === r.id && live && !r.client_id && (
                    <form onSubmit={e => { e.preventDefault(); void sendFolderLink(r); }} style={{ marginTop: 8, background: 'var(--k-f9fafb, #f9fafb)', borderRadius: 8, padding: 10 }}>
                      <label htmlFor={`mail-${r.id}`} style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--k-374151)', marginBottom: 6 }}>Email this folder’s link to</label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input id={`mail-${r.id}`} autoFocus value={mailTo} onChange={e => setMailTo(e.target.value)} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="name@example.com"
                          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setMailFor(null); } }}
                          style={{ flex: '1 1 200px', minWidth: 0, padding: 9, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', fontSize: touch ? 16 : 14, boxSizing: 'border-box' }} />
                        <button type="submit" disabled={mailBusy || !EMAIL_OK.test(mailTo.trim())} style={{ ...btn, background: !mailBusy && EMAIL_OK.test(mailTo.trim()) ? '#111' : 'var(--k-e5e7eb)', color: !mailBusy && EMAIL_OK.test(mailTo.trim()) ? '#fff' : 'var(--k-9ca3af)', border: 'none' }}>{mailBusy ? 'Sending…' : 'Send link'}</button>
                        <button type="button" style={btn} onClick={() => setMailFor(null)}>Cancel</button>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--k-6b7280)', marginTop: 8, lineHeight: 1.5 }}>
                        {r.sent_at && r.recipient_email ? `Last emailed to ${r.recipient_email}. ` : ''}The link works until {day(r.expires_at)}.
                        {r.has_password
                          ? <span style={{ color: 'var(--k-a06a12)' }}> The password is not in the email. Give it to them by phone or text.</span>
                          : ' With no password, they can add files but not open any.'}
                      </div>
                    </form>
                  )}
                  {renameFor === r.id && isFolder && !r.purged_at && (
                    <form onSubmit={e => { e.preventDefault(); void saveName(r); }} style={{ marginTop: 8, background: 'var(--k-f9fafb, #f9fafb)', borderRadius: 8, padding: 10 }}>
                      <label htmlFor={`name-${r.id}`} style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--k-374151)', marginBottom: 6 }}>Folder name</label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input id={`name-${r.id}`} autoFocus onFocus={e => e.currentTarget.select()} value={renameText} onChange={e => setRenameText(e.target.value)} maxLength={80} autoComplete="off"
                          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setRenameFor(null); } }}
                          style={{ flex: '1 1 200px', minWidth: 0, padding: 9, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', fontSize: touch ? 16 : 14, boxSizing: 'border-box' }} />
                        <button type="submit" disabled={!renameText.trim()} style={{ ...btn, background: renameText.trim() ? '#111' : 'var(--k-e5e7eb)', color: renameText.trim() ? '#fff' : 'var(--k-9ca3af)', border: 'none' }}>Save name</button>
                        <button type="button" style={btn} onClick={() => setRenameFor(null)}>Cancel</button>
                      </div>
                    </form>
                  )}
                  {pwFor === r.id && !r.purged_at && (
                    <div style={{ marginTop: 8, background: 'var(--k-f9fafb, #f9fafb)', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--k-6b7280)', marginBottom: 6, lineHeight: 1.5 }}>
                        Anyone outside the team needs the link <strong>and</strong> this password. After 5 wrong tries the link locks for 15 minutes; after 15 it closes and you’re alerted. {r.has_password ? 'Saving a new one signs out anyone who is in.' : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input value={pwText} onChange={e => setPwText(e.target.value)} type="text" autoComplete="off" placeholder="New password (8+ characters)" style={{ flex: 1, minWidth: 0, padding: 9, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', fontSize: 14, boxSizing: 'border-box' }} />
                        <button type="button" onClick={() => setPwText(makePassword())} style={btn}>Suggest</button>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, marginBottom: 8 }}>
                        <input type="checkbox" checked={pwView} onChange={e => setPwView(e.target.checked)} /> With the password they can also open the files in this folder
                      </label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" disabled={pwText.length < 8} onClick={() => void savePassword(r)} style={{ ...btn, background: pwText.length >= 8 ? '#111' : 'var(--k-e5e7eb)', color: pwText.length >= 8 ? '#fff' : 'var(--k-9ca3af)', border: 'none' }}>Save password</button>
                        {pwText && <button type="button" style={btn} onClick={async () => { try { await navigator.clipboard.writeText(pwText); showToast('Password copied'); } catch { showToast('Could not copy — select it and copy'); } }}>Copy it</button>}
                        {r.has_password && <button type="button" style={{ ...btn, color: '#b91c1c' }} onClick={async () => { if (confirm('Remove the password? The link goes back to upload-only and nobody outside the team can open files.')) { if (await patch(r, { action: 'clear_password' }, 'Password removed')) setPwFor(null); } }}>Remove password</button>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--k-a06a12)', marginTop: 8 }}>Copy it now — it can’t be shown again, only replaced. Give it to them by phone or text, never by email.</div>
                    </div>
                  )}
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
                      <div style={{ fontSize: 12, color: 'var(--k-6b7280)', marginBottom: 6 }}>{isFolder && !r.client_id ? 'The broker and whoever made this folder always see it.' : <>The broker, the contact’s owner, whoever made the request{dealId || r.deal_id ? ' and everyone on the deal' : ''} always see this.</>} Tick anyone else who should.</div>
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
