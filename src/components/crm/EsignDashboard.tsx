'use client';
// Global E-Sign dashboard. Two halves: documents an agent has imported and is still
// preparing (drop a PDF in, place the signature/date fields, send), and everything
// already out for signature — who each is waiting on and for how long.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRememberedState, useRememberedSelection } from '@/lib/view-memory';

interface Stats {
  sent: number; tracked: number;
  email_opened: number; email_opened_pct: number;
  bounced: number; bounced_pct: number;
  viewed: number; viewed_pct: number;
  signed: number; signed_pct: number;
  declined: number; declined_pct: number;
  median_hours_to_sign: number | null;
}

interface ActEvent { id: string; event: string; actor: string | null; ip: string | null; user_agent: string | null; meta: Record<string, unknown> | null; created_at: string; signer_name: string | null }

interface Signer { id: string; name: string; email: string; signer_role: string; signing_order: number; status: string; sent_at?: string | null; viewed_at?: string | null; signed_at?: string | null; declined_at?: string | null; decline_reason?: string | null; in_person?: boolean; delivery?: string | null }
interface Envelope { id: string; deal_id?: string | null; title?: string; status: string; created_at?: string; archived_at?: string | null; sent_by?: string | null; business_unit?: string | null; executed_url?: string | null; executed_clean_url?: string | null; crm_deals?: { id: string; property?: string; client?: string } | null; crm_envelope_signers?: Signer[] }

// A document imported for signing: a submission with no library form behind it.
export interface ImportedDoc { id: string; title?: string; url?: string | null; deal_id?: string | null; listing_id?: string | null; updated_at?: string; form_id?: string | null; source_path?: string | null; envelope?: { id: string; status: string } | null }

// Identity of the underlying DOCUMENT, as opposed to the row. Re-importing the
// same PDF writes a new object with a fresh `<epoch>_` prefix, so the original
// filename is what actually says "this is the same paper"; a document generated
// from the library has no file, and is identified by which form it came from.
//
// The trailing " (1)" is dropped too: that is the browser's own suffix for
// downloading the same file twice, so `Amendment-signed (1).pdf` is the same
// paper as `Amendment-signed.pdf` — and keeping them apart was enough to leave
// a document on the queue whose signing had already completed under the other
// name, which is the whole complaint.
const docKey = (d: ImportedDoc) => {
  if (!d.source_path) return `form:${d.form_id ?? ''}|${(d.title ?? '').trim().toLowerCase()}`;
  const file = d.source_path.split('/').pop()!
    .replace(/^\d{10,}_/, '')
    .replace(/(?:[ _]\(\d+\)|__\d+_)(?=\.[a-z0-9]+$|$)/i, '')
    .toLowerCase();
  return `file:${file}`;
};

export interface DealDoc { id: string; name?: string; storage_path?: string; created_at?: string }

interface Props {
  authToken?: string; showToast?: (m: string) => void; onOpenDeal?: (dealId: string) => void;
  // Deals whose folders can be pulled from when starting a signature request.
  deals?: { id: string; client?: string | null; property?: string | null; stage?: string | null }[];
  // Only the account owner may destroy a signature request; everyone else archives.
  isSuperAdmin?: boolean;
  // Opens the envelope composer: with a freshly dropped file, or on a document
  // already imported and still being prepared.
  onCompose?: (arg: { file?: File; doc?: ImportedDoc }) => void;
  // Bumped by the parent whenever the editor saves, so the list re-reads the doc.
  refreshKey?: number;
  // Opens a PDF in the app's own viewer rather than forcing a download.
  onPreview?: (file: { url: string; name: string }) => void;
}

// Same set Transaction Docs uses. The lead sync opens a Prospect deal for every
// inbound email, so the raw list is mostly autoresponders and phone numbers —
// nothing anyone is sending a contract on. Stage-less deals are kept: those are
// hand-made and simply never moved along.
const ACTIVE_STAGES = ['Active', 'LOI', 'In Contract'];

const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const ago = (iso?: string | null) => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; };
const mini: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '8px 12px', minHeight: 36, cursor: 'pointer', whiteSpace: 'nowrap' };

export default function EsignDashboard({ authToken, showToast, onOpenDeal, onCompose, onPreview, isSuperAdmin, deals = [], refreshKey = 0 }: Props) {
  const [envs, setEnvs] = useState<Envelope[]>([]);
  const [docs, setDocs] = useState<ImportedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);   // include cancelled + completed
  const [byAgent, setByAgent] = useState('');     // '' = every agent
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pickDeal, setPickDeal] = useState(false);          // the "from a deal" picker is open
  const [dealPick, setDealPick] = useState<string | null>(null); // which deal is expanded in it
  const [dealDocs, setDealDocs] = useState<DealDoc[] | null>(null); // null = still loading
  const [dealQ, setDealQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);         // envelope shown in the detail drawer
  // A refresh lands back on the same tab and reopens the same request.
  const [tab, setTab] = useRememberedState<'out' | 'drafts' | 'signed' | 'closed'>('esign:tab', 'out', ['out', 'drafts', 'signed', 'closed'] as const);
  const [q, setQ] = useState('');
  const [acts, setActs] = useState<Record<string, ActEvent[]>>({}); // cached per envelope
  const [stats, setStats] = useState<Stats | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    try {
      const j = await fetch('/api/crm/esign-import', { headers: auth(authToken) }).then(r => r.json());
      setDocs(Array.isArray(j.documents) ? j.documents : []);
    } catch { setDocs([]); }
  }, [authToken]);
  useEffect(() => { loadDocs(); }, [loadDocs, refreshKey]);

  // Pull a document out of a deal's folder — the counter-signed lease the other
  // side emailed over, say — instead of downloading it and dropping it back in.
  const loadDealDocs = useCallback(async (dealId: string) => {
    setDealPick(dealId); setDealDocs(null);
    try {
      const j = await fetch(`/api/crm/docs?dealId=${dealId}`, { headers: auth(authToken) }).then(r => r.json());
      // Deal folders also hold Word files and photos; only a PDF can be signed.
      setDealDocs((Array.isArray(j.docs) ? j.docs : []).filter((d: DealDoc) => /\.pdf$/i.test(d.storage_path ?? d.name ?? '')));
    } catch { setDealDocs([]); showToast?.('Could not load that deal’s documents'); }
  }, [authToken, showToast]);

  const chooseDealDoc = useCallback(async (docId: string) => {
    setUploading(true);
    try {
      const r = await fetch('/api/crm/esign-import', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ from_deal_doc_id: docId }) });
      const j = await r.json();
      if (!r.ok) { showToast?.(j.error || 'Could not open that document'); return; }
      setPickDeal(false); setDealPick(null); setDealDocs(null);
      onCompose?.({ doc: j.submission });
    } catch { showToast?.('Could not open that document'); }
    finally { setUploading(false); }
  }, [authToken, onCompose, showToast]);

  // A dropped file goes straight into the composer, which does the upload as its
  // first step — so the agent lands on "Set Up Envelope" with the document in place.
  const importFile = useCallback((file: File) => {
    if (!/\.pdf$/i.test(file.name)) { showToast?.('Only PDFs can be sent for signature — save it as a PDF first'); return; }
    onCompose?.({ file });
  }, [showToast, onCompose]);

  const removeDoc = useCallback(async (d: ImportedDoc) => {
    if (!window.confirm(`Remove "${d.title || 'this document'}" from E-Sign? The file is deleted.`)) return;
    const r = await fetch(`/api/crm/esign-import?id=${d.id}`, { method: 'DELETE', headers: auth(authToken) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast?.(j.error || 'Could not remove it'); return; }
    setDocs(ds => ds.filter(x => x.id !== d.id));
  }, [authToken, showToast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Always pull everything — completed docs stay on the page (archived UNDER the
      // active ones), so the fetch can't be scoped to just what's pending. The
      // `showAll` toggle only decides whether the cancelled/archived group renders.
      const j = await fetch('/api/crm/envelopes?scope=all', { headers: auth(authToken) }).then(r => r.json());
      const list = (Array.isArray(j.envelopes) ? j.envelopes : []) as Envelope[];
      list.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')); // oldest (most overdue) first
      setEnvs(list);
    } catch { setEnvs([]); }
    finally { setLoading(false); }
    // Rates are computed over every request, not the filtered page, so they are
    // fetched separately rather than derived from `list`.
    try {
      const sj = await fetch('/api/crm/envelopes?stats=1', { headers: auth(authToken) }).then(r => r.json());
      setStats(sj.stats ?? null);
    } catch { /* the list is the point; rates are extra */ }
  }, [authToken]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Stop a request that shouldn't go through…
  async function voidEnv(env: Envelope) {
    if (!window.confirm(`Cancel "${env.title || 'this request'}"?\n\nSigners can no longer sign it. The document stays, so you can fix it and re-send.`)) return;
    setBusy(env.id);
    try {
      const r = await fetch('/api/crm/envelopes', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ envelope_id: env.id, action: 'void' }) });
      const j = await r.json().catch(() => ({}));
      showToast?.(r.ok ? 'Signature request cancelled' : (j.error || 'Could not cancel it'));
    } finally { setBusy(null); load(); loadDocs(); }
  }
  // …file one away without losing it. The record, the signers and every signature
  // are kept — a deal's signing history is a business record, not queue clutter.
  async function archiveEnv(env: Envelope) {
    if (!window.confirm(`Archive "${env.title || 'this request'}"?\n\nIt moves out of the active list. Everything is kept — tick “Show cancelled & archived” to find it again.`)) return;
    setBusy(env.id);
    try {
      const r = await fetch(`/api/crm/envelopes?id=${env.id}`, { method: 'DELETE', headers: auth(authToken) });
      const j = await r.json().catch(() => ({}));
      showToast?.(r.ok ? 'Signature request archived' : (j.error || 'Could not archive it'));
    } finally { setBusy(null); load(); loadDocs(); }
  }
  async function restoreEnv(env: Envelope) {
    setBusy(env.id);
    try {
      const r = await fetch(`/api/crm/envelopes?id=${env.id}`, { method: 'PUT', headers: auth(authToken) });
      const j = await r.json().catch(() => ({}));
      showToast?.(r.ok ? 'Restored' : (j.error || 'Could not restore it'));
    } finally { setBusy(null); load(); loadDocs(); }
  }
  // …and the one action that actually destroys something. Owner only.
  async function purgeEnv(env: Envelope) {
    if (!window.confirm(`Permanently delete "${env.title || 'this request'}"?\n\nEvery signature${env.status === 'completed' ? ' and THE FULLY EXECUTED PDF' : ''} is destroyed. This cannot be undone — Archive keeps the history instead.`)) return;
    setBusy(env.id);
    try {
      const r = await fetch(`/api/crm/envelopes?id=${env.id}&purge=1`, { method: 'DELETE', headers: auth(authToken) });
      const j = await r.json().catch(() => ({}));
      showToast?.(r.ok ? 'Permanently deleted' : (j.error || 'Could not delete it'));
    } finally { setBusy(null); load(); loadDocs(); }
  }

  // Fetches the signing link on demand rather than shipping every access token to
  // the browser with the list, and records that the agent hosted the session.
  async function signInPerson(env: Envelope) {
    setBusy(env.id);
    try {
      const r = await fetch('/api/crm/envelopes', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ envelope_id: env.id, action: 'in_person_url' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) { showToast?.(j.error || 'Could not open the signing page'); return; }
      showToast?.(`🖊 Hand the device to ${j.signer?.name ?? 'the signer'}`);
      window.open(j.url, '_blank', 'noopener');
    } finally { setBusy(null); load(); }
  }

  // Document activity. Fetched when a request's drawer opens — most are never opened,
  // and the trail only grows, so a cached copy stays correct for the life of the page.
  useEffect(() => {
    if (!openId || acts[openId]) return;
    let live = true;
    fetch(`/api/crm/envelopes?activity=${openId}`, { headers: auth(authToken) })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (live && j) setActs(prev => ({ ...prev, [openId]: j.events ?? [] })); })
      .catch(() => { /* leave the drawer without a trail rather than erroring the page */ });
    return () => { live = false; };
  }, [openId, acts, authToken]);

  async function nudge(env: Envelope) {
    setBusy(env.id);
    try {
      const r = await fetch('/api/crm/envelopes', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ envelope_id: env.id, action: 'nudge' }) });
      const j = await r.json().catch(() => ({}));
      showToast?.(r.ok ? `🔔 Reminder sent${j.to ? ` to ${j.to}` : ''} ✓` : (j.error || 'Could not nudge'));
    } finally { setBusy(null); load(); }
  }

  // Everything lives on one page, grouped top-to-bottom: what's still out for
  // signature, then the completed docs archived directly beneath them (so a signed
  // doc never disappears), then — only when the toggle is on — the cancelled/archived
  // ones. A completed doc drops into its own group automatically; no manual archiving.
  // ── The "ready to prepare & send" queue ──────────────────────────────────
  // Every import stays here whether or not it gets sent, so working through one
  // document — drop it, look at it, drop a corrected copy — used to leave a row
  // behind per attempt, and the queue read as a pile of duplicates of paper that
  // was in fact long since signed. Two rules fix that, and neither deletes a row:
  //   1. one entry per DOCUMENT, the newest, counting the copies behind it;
  //   2. no entry at all once that document has been signed to completion.
  // Only `completed` supersedes. A voided request means the send was called off,
  // and the unsent copy sitting here is very likely the retry — hiding it would
  // take away the thing the agent is reaching for.
  const queue = (() => {
    const byDoc = new Map<string, ImportedDoc[]>();
    for (const d of docs) {
      const k = docKey(d);
      const rows = byDoc.get(k);
      if (rows) rows.push(d); else byDoc.set(k, [d]);
    }
    const out: Array<{ doc: ImportedDoc; dupes: number }> = [];
    for (const rows of byDoc.values()) {
      if (rows.some(r => r.envelope?.status === 'completed')) continue;
      const unsent = rows.filter(r => !r.envelope)
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
      if (unsent.length) out.push({ doc: unsent[0], dupes: unsent.length - 1 });
    }
    return out.sort((a, b) => (b.doc.updated_at ?? '').localeCompare(a.doc.updated_at ?? ''));
  })();

  // Active deals only, unless the agent searches — then everything is fair game,
  // since the one they want may be closed.
  const dealChoices = (() => {
    const q = dealQ.trim().toLowerCase();
    const pool = q ? deals : deals.filter(d => !d.stage || ACTIVE_STAGES.includes(d.stage));
    return pool.filter(d => !q || `${d.client ?? ''} ${d.property ?? ''}`.toLowerCase().includes(q)).slice(0, 60);
  })();

  const shown = envs.filter(env => !byAgent || env.sent_by === byAgent);
  const isClosed = (e: Envelope) => !!e.archived_at || e.status === 'voided' || e.status === 'declined';
  const activeEnvs = shown.filter(e => !isClosed(e) && e.status !== 'completed');
  const completedEnvs = shown.filter(e => !isClosed(e) && e.status === 'completed');
  const closedEnvs = shown.filter(isClosed);
  const groups: Array<{ key: string; label: string; rows: Envelope[] }> = [
    { key: 'active', label: 'Out for signature', rows: activeEnvs },
    { key: 'done', label: 'Signed & completed', rows: completedEnvs },
    ...(showAll ? [{ key: 'closed', label: 'Cancelled & archived', rows: closedEnvs }] : []),
  ].filter(g => g.rows.length > 0);

  useRememberedSelection('esign:open', openId, !loading, id => { if (envs.some(e => e.id === id)) setOpenId(id); });
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  // Reminds every stalled signer in one go, one at a time so the sends stay ordered.
  async function nudgeAll(list: Array<{ id: string }>) {
    if (!window.confirm(`Send a reminder to the current signer on ${list.length} requests?`)) return;
    setBusy('all');
    let ok = 0;
    for (const e of list) {
      try {
        const r = await fetch('/api/crm/envelopes', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ envelope_id: e.id, action: 'nudge' }) });
        if (r.ok) ok++;
      } catch { /* counted as not sent */ }
    }
    showToast?.(`Reminders sent: ${ok} of ${list.length}`);
    setBusy(null); load();
  }

  const agents = Array.from(new Set(envs.map(e => e.sent_by).filter(Boolean) as string[])).sort();
  const median = stats?.median_hours_to_sign ?? null;
  const turn = median == null ? null : median < 1 ? `${Math.round(median * 60)}m` : median < 48 ? `${Math.round(median)}h` : `${Math.round(median / 24)}d`;
  const metrics: string[] = stats && stats.sent > 0 ? [
    `${stats.sent} sent`,
    ...(stats.tracked ? [`${stats.email_opened_pct}% email opened`] : []),
    `${stats.viewed_pct}% doc opened`,
    `${stats.signed_pct}% signed`,
    ...(turn ? [`${turn} typical turnaround`] : []),
  ] : [];
  const primaryBtn: React.CSSProperties = { ...mini, background: '#c9922c', color: '#fff', border: 'none' };

  // ── Derived views ─────────────────────────────────────────────────────────
  const needle = q.trim().toLowerCase();
  const matches = (e: Envelope) => !needle || [e.title, e.crm_deals?.property, e.crm_deals?.client, e.sent_by, ...(e.crm_envelope_signers || []).flatMap(s => [s.name, s.email])]
    .some(v => (v ?? '').toLowerCase().includes(needle));
  const outRows = activeEnvs.filter(matches);
  const signedRows = completedEnvs.filter(matches);
  const closedRows = closedEnvs.filter(matches);
  const draftRows = queue.filter(({ doc }) => !needle || (doc.title ?? '').toLowerCase().includes(needle));
  const tabs: Array<{ key: typeof tab; label: string; n: number }> = [
    { key: 'out', label: 'Out for signature', n: activeEnvs.length },
    { key: 'drafts', label: 'Drafts', n: queue.length },
    { key: 'signed', label: 'Signed', n: completedEnvs.length },
    { key: 'closed', label: 'Cancelled & archived', n: closedEnvs.length },
  ];

  // What needs a human today — surfaced above the list so a stalled signature never
  // sits unnoticed in the middle of it. Declined / bounced / gone quiet for 3+ days.
  type Attn = { env: Envelope; tone: 'bad' | 'warn'; text: string; action: 'nudge' | null };
  const attention: Attn[] = shown.filter(e => !e.archived_at && e.status !== 'voided' && e.status !== 'completed').flatMap((e): Attn[] => {
    const sg = (e.crm_envelope_signers || []).slice().sort((a, b) => a.signing_order - b.signing_order);
    const declined = sg.find(s => s.status === 'declined' || s.declined_at);
    if (declined) return [{ env: e, tone: 'bad', text: `${declined.name} declined${declined.decline_reason ? ` — “${declined.decline_reason}”` : ''}`, action: null }];
    const cur = sg.find(s => s.status !== 'signed' && !s.signed_at);
    if (!cur) return [];
    if (cur.delivery && ['bounced', 'complained', 'failed'].includes(cur.delivery)) return [{ env: e, tone: 'bad', text: `Email to ${cur.name} didn’t arrive — check the address`, action: null }];
    const days = cur.sent_at ? Math.floor((Date.now() - new Date(cur.sent_at).getTime()) / 86400000) : 0;
    if (!cur.in_person && days >= 3) return [{ env: e, tone: 'warn', text: `${cur.name} ${cur.viewed_at ? 'opened it but hasn’t signed' : 'hasn’t opened it'} · ${days} days`, action: 'nudge' }];
    return [];
  }).slice(0, 4);

  const openEnv = envs.find(e => e.id === openId) ?? null;

  const signerChips = (env: Envelope) => {
    const sg = (env.crm_envelope_signers || []).slice().sort((a, b) => a.signing_order - b.signing_order);
    const cur = sg.find(s => s.status !== 'signed' && !s.signed_at && s.status !== 'declined' && !s.declined_at);
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {sg.map((s, i) => {
          const signed = s.status === 'signed' || !!s.signed_at;
          const declined = s.status === 'declined' || !!s.declined_at;
          const isCur = cur?.id === s.id;
          return (
            <span key={s.id} title={`${s.name} — ${signed ? 'signed' : declined ? 'declined' : isCur ? 'waiting' : 'later'}`}
              style={{ width: 26, height: 26, borderRadius: '50%', marginLeft: i ? -6 : 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 800, border: '2px solid #fff', boxSizing: 'border-box',
                background: signed ? '#16a34a' : declined ? '#dc2626' : isCur ? '#fdf0d5' : '#f1f2f4', color: signed || declined ? '#fff' : isCur ? '#92400e' : '#9ca3af',
                outline: isCur ? '1.5px solid #c9922c' : 'none' }}>
              {signed ? '✓' : (s.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
          );
        })}
      </div>
    );
  };

  const statusLine = (env: Envelope): { text: string; color: string } => {
    const sg = (env.crm_envelope_signers || []).slice().sort((a, b) => a.signing_order - b.signing_order);
    if (env.status === 'completed') return { text: 'Fully signed', color: '#15803d' };
    if (env.status === 'voided') return { text: 'Cancelled', color: '#b91c1c' };
    const dec = sg.find(s => s.status === 'declined' || s.declined_at);
    if (dec) return { text: `Declined by ${dec.name}`, color: '#b91c1c' };
    const cur = sg.find(s => s.status !== 'signed' && !s.signed_at);
    if (!cur) return { text: env.status, color: '#6b7280' };
    return { text: `${cur.in_person ? 'In person: ' : 'Waiting on '}${cur.name}${cur.sent_at && !cur.in_person ? ` · ${ago(cur.sent_at)}` : ''}`, color: '#1d4ed8' };
  };

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, rowGap: 8, flexWrap: 'wrap', background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: '12px 16px', cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: "'DM Sans',sans-serif" };

  return (
    <div className="es-touch" style={{ maxWidth: 940, margin: '0 auto', fontFamily: "'DM Sans',sans-serif", ...(dragging ? { outline: '2px dashed #c9922c', outlineOffset: 6, borderRadius: 12 } : {}) }}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) importFile(f); }}>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />

      {/* ── Header: title, one-line pulse, the two ways to start ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 10, marginBottom: 16 }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, margin: 0, color: '#111' }}>Signatures</h2>
          <div title={stats && stats.tracked < stats.sent ? `Email opens are tracked for ${stats.tracked} of ${stats.sent} invites — only mail sent since delivery tracking was switched on reports back.` : undefined}
            style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 2 }}>{metrics.length ? metrics.join('  ·  ') : ' '}</div>
        </div>
        <button onClick={() => { setPickDeal(true); setDealPick(null); setDealDocs(null); }} disabled={uploading} style={mini}>From a deal</button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={primaryBtn}>{uploading ? 'Importing…' : '+ Upload PDF'}</button>
      </div>

      {/* ── Needs attention ── */}
      {attention.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#b45309' }}>Needs attention · {attention.length}</span>
            {attention.filter(a => a.action === 'nudge').length > 1 && (
              <button disabled={busy === 'all'} onClick={() => nudgeAll(attention.filter(a => a.action === 'nudge').map(a => a.env))} style={{ ...mini, padding: '4px 10px', minHeight: 0, color: '#a06a12', borderColor: '#f0e2c4' }}>{busy === 'all' ? 'Sending…' : 'Nudge all'}</button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attention.map(a => (
              <div key={a.env.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: a.tone === 'bad' ? '#fef6f6' : '#fffaf0', border: `1px solid ${a.tone === 'bad' ? '#f8d7d7' : '#f6e3b8'}`, borderRadius: 10, padding: '9px 13px' }}>
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.env.title || 'Document'}</div>
                  <div style={{ fontSize: 12.5, color: a.tone === 'bad' ? '#b91c1c' : '#92400e' }}>{a.text}</div>
                </div>
                {a.action === 'nudge' && <button disabled={busy === a.env.id} onClick={() => nudge(a.env)} style={{ ...mini, color: '#a06a12', borderColor: '#f0e2c4' }}>{busy === a.env.id ? '…' : 'Nudge'}</button>}
                <button onClick={() => setOpenId(a.env.id)} style={mini}>Details</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs + search ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', rowGap: 8, borderBottom: '1px solid #eef0f2', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', flex: '1 1 auto' }} role="tablist">
          {tabs.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              style={{ background: 'none', border: 'none', borderBottom: `2px solid ${tab === t.key ? '#c9922c' : 'transparent'}`, padding: '9px 12px', fontSize: 13.5, fontWeight: tab === t.key ? 800 : 600, color: tab === t.key ? '#111' : '#6b7280', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", marginBottom: -1, whiteSpace: 'nowrap' }}>
              {t.label}{t.n > 0 && <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, color: tab === t.key ? '#a06a12' : '#9ca3af' }}>{t.n}</span>}
            </button>
          ))}
        </div>
        {agents.length > 1 && (
          <select value={byAgent} onChange={e => setByAgent(e.target.value)} title="Show only one agent's documents"
            style={{ fontSize: 12.5, padding: '6px 8px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontFamily: "'DM Sans',sans-serif" }}>
            <option value="">All agents</option>
            {agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search signature requests"
          style={{ fontSize: 13, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 7, width: 150, fontFamily: "'DM Sans',sans-serif", marginBottom: 6 }} />
      </div>

      {/* ── Pick a document out of a deal's folder ── */}
      {pickDeal && (
        <div className="crm-sheet" onClick={e => { if (e.target === e.currentTarget) setPickDeal(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
          <div className="crm-sheet-panel" style={{ background: '#fff', borderRadius: 16, padding: 22, width: '100%', maxWidth: 520, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>
                {dealPick ? 'Pick a document' : 'Pick a deal'}
              </h3>
              <button onClick={() => (dealPick ? (setDealPick(null), setDealDocs(null)) : setPickDeal(false))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1 }}>
                {dealPick ? '‹' : '✕'}
              </button>
            </div>

            {!dealPick ? (
              dealChoices.length === 0 && !dealQ ? <div style={{ fontSize: 13, color: '#9ca3af' }}>No active deals in this workspace yet.</div> : (
                <>
                  <input autoFocus value={dealQ} onChange={e => setDealQ(e.target.value)} placeholder="Search deals…"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13.5, marginBottom: 10, fontFamily: "'DM Sans',sans-serif" }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: '54vh', overflowY: 'auto' }}>
                    {dealChoices.map(d => (
                      <button key={d.id} onClick={() => loadDealDocs(d.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 12px', border: '1px solid #f1f2f4', borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                        <span style={{ fontSize: 16 }}>📁</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#111' }}>{d.client || 'Deal'}</span>
                          {d.property && <span style={{ display: 'block', fontSize: 12, color: '#9ca3af' }}>{d.property}</span>}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#a06a12' }}>›</span>
                      </button>
                    ))}
                  </div>
                </>
              )
            ) : dealDocs === null ? <div style={{ fontSize: 13, color: '#9ca3af', padding: '10px 0' }}>Loading…</div>
              : dealDocs.length === 0 ? (
                <div style={{ fontSize: 13, color: '#9ca3af', padding: '10px 0' }}>
                  No PDFs in this deal&apos;s folder. Only PDFs can be sent for signature — a Word file or a photo has to be saved as a PDF first.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: '54vh', overflowY: 'auto' }}>
                  {dealDocs.map(d => (
                    <button key={d.id} disabled={uploading} onClick={() => chooseDealDoc(d.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 12px', border: '1px solid #f1f2f4', borderRadius: 8, background: '#fff', cursor: uploading ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                      <span style={{ fontSize: 16 }}>📄</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: '#111', overflowWrap: 'anywhere' }}>{d.name || d.storage_path?.split('/').pop()}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#a06a12', flexShrink: 0 }}>Use →</span>
                    </button>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}


      {/* ── List for the active tab ── */}
      {loading ? <div style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tab === 'drafts' && (draftRows.length === 0
            ? <Empty title="No drafts" body="Upload a PDF or pull one from a deal to start a request." />
            : draftRows.map(({ doc: d, dupes }) => (
              <div key={d.id} style={{ ...rowStyle, cursor: 'default' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || 'Document'}</div>
                  <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 1 }}>
                    Imported{d.updated_at ? ` · ${ago(d.updated_at)}` : ''}{dupes > 0 && ` · newest of ${dupes + 1} copies`}
                  </div>
                </div>
                <button onClick={() => removeDoc(d)} title="Remove this document" style={{ ...mini, color: '#b91c1c', borderColor: '#f3e4e4' }}>Remove</button>
                {d.url && onPreview && <button onClick={() => onPreview({ url: d.url!, name: `${d.title || 'Document'}.pdf` })} style={mini}>Preview</button>}
                {onCompose && <button onClick={() => onCompose({ doc: d })} style={primaryBtn}>Prepare &amp; send</button>}
              </div>
            )))}

          {tab !== 'drafts' && (() => {
            const rows = tab === 'out' ? outRows : tab === 'signed' ? signedRows : closedRows;
            if (rows.length === 0) return needle
              ? <Empty title="No matches" body="Nothing here matches your search." />
              : tab === 'out' ? <Empty title="Nothing is waiting on a signature" body="Start a request with Upload PDF or From a deal." />
              : tab === 'signed' ? <Empty title="No signed documents yet" body="Completed requests collect here." />
              : <Empty title="Nothing cancelled or archived" body="" />;
            // Signed documents are history, not work: one compact line each, newest first,
            // grouped by month, instead of a full card per request.
            if (tab === 'signed') {
              const when = (e: Envelope) => {
                const t = (e.crm_envelope_signers || []).map(x => x.signed_at).filter(Boolean).sort().pop() || e.created_at || '';
                return t;
              };
              const sorted = [...rows].sort((x, y) => when(y).localeCompare(when(x)));
              const months: Array<{ label: string; items: Envelope[] }> = [];
              for (const e of sorted) {
                const t = when(e);
                const label = t ? new Date(t).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Earlier';
                const last = months[months.length - 1];
                if (last && last.label === label) last.items.push(e); else months.push({ label, items: [e] });
              }
              return months.map(m => (
                <div key={m.label} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', margin: '6px 2px' }}>{m.label} · {m.items.length}</div>
                  <div style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, overflow: 'hidden' }}>
                    {m.items.map((env, i) => {
                      const names = (env.crm_envelope_signers || []).map(x => x.name).filter(Boolean).join(', ');
                      const dealName = env.crm_deals?.property || env.crm_deals?.client;
                      const t = when(env);
                      const view = env.executed_clean_url || env.executed_url;
                      return (
                        <div key={env.id} onClick={() => setOpenId(env.id)} role="button" tabIndex={0}
                          onKeyDown={e => { if (e.key === 'Enter') setOpenId(env.id); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', borderTop: i ? '1px solid #f4f5f7' : 'none' }}>
                          <span style={{ color: '#16a34a', fontWeight: 800, flexShrink: 0 }}>✓</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div title={env.title || 'Document'} style={{ fontSize: 13.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{env.title || 'Document'}</div>
                            <div style={{ fontSize: 12, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[dealName, names].filter(Boolean).join(' · ')}</div>
                          </div>
                          <span style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>{t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                          {view && onPreview && (
                            <button onClick={e => { e.stopPropagation(); onPreview({ url: view, name: `${(env.title || 'document').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-signed.pdf` }); }}
                              style={{ ...mini, padding: '5px 10px', minHeight: 0, color: '#15803d', borderColor: '#bbf7d0', background: '#f0fdf4', flexShrink: 0 }}>View</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            }
            return rows.map(env => {
              const sg = env.crm_envelope_signers || [];
              const st = statusLine(env);
              const dealName = env.crm_deals?.property || env.crm_deals?.client;
              return (
                <button key={env.id} onClick={() => setOpenId(env.id)} style={rowStyle}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div title={env.title || 'Document'} style={{ fontSize: 14.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{env.title || 'Document'}</div>
                    <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 1 }}>{[dealName, env.sent_by, env.created_at ? `sent ${ago(env.created_at)}` : null].filter(Boolean).join(' · ')}</div>
                  </div>
                  {signerChips(env)}
                  <div style={{ flex: '0 1 230px', minWidth: 130, textAlign: 'right' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: st.color }}>{st.text}</div>
                    <div style={{ fontSize: 11.5, color: '#9ca3af' }}>{sg.filter(s => s.status === 'signed' || s.signed_at).length} of {sg.length} signed</div>
                  </div>
                  <span aria-hidden style={{ color: '#c4c8cf', fontSize: 18 }}>›</span>
                </button>
              );
            });
          })()}
        </div>
      )}

      {/* ── Detail drawer: signers, actions and the audit trail for one request ── */}
      {openEnv && (() => {
        const env = openEnv;
        const sg = (env.crm_envelope_signers || []).slice().sort((a, b) => a.signing_order - b.signing_order);
        const declinedBy = sg.find(s => s.status === 'declined' || s.declined_at);
        const current = declinedBy ? undefined : sg.find(s => s.status !== 'signed' && !s.signed_at);
        const st = statusLine(env);
        const file = `${(env.title || 'document').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-signed.pdf`;
        const dl = (u: string) => `${u}${u.includes('?') ? '&' : '?'}download=${encodeURIComponent(file)}`;
        const signedUrl = env.executed_clean_url || env.executed_url;
        const link: React.CSSProperties = { background: 'none', border: 'none', padding: 0, fontSize: 12.5, fontWeight: 600, color: '#6b7280', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textDecoration: 'underline' };
        const evs = acts[env.id];
        return (
          <div onClick={e => { if (e.target === e.currentTarget) setOpenId(null); }} style={{ position: 'fixed', inset: 0, zIndex: 650, background: 'rgba(17,24,39,.35)', display: 'flex', justifyContent: 'flex-end' }}>
            <aside role="dialog" aria-label="Signature request details" style={{ width: 'min(460px, 100vw)', height: '100%', background: '#fff', boxShadow: '-12px 0 40px rgba(0,0,0,.14)', overflowY: 'auto', padding: '20px 22px 32px', fontFamily: "'DM Sans',sans-serif", boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, margin: 0, color: '#111', overflowWrap: 'anywhere' }}>{env.title || 'Document'}</h3>
                  <div style={{ fontSize: 13, fontWeight: 700, color: st.color, marginTop: 3 }}>{st.text}</div>
                  <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 2 }}>{[env.crm_deals?.property || env.crm_deals?.client, env.sent_by, env.archived_at ? 'Archived' : null].filter(Boolean).join(' · ')}</div>
                </div>
                <button onClick={() => setOpenId(null)} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: '#6b7280', cursor: 'pointer' }}>✕</button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0 4px' }}>
                {env.status === 'completed' && signedUrl && <button onClick={() => onPreview?.({ url: signedUrl, name: file })} style={{ ...mini, color: '#15803d', borderColor: '#bbf7d0', background: '#f0fdf4' }}>View signed</button>}
                {current && !current.in_person && <button disabled={busy === env.id} onClick={() => nudge(env)} style={{ ...mini, color: '#a06a12', borderColor: '#f0e2c4' }}>{busy === env.id ? '…' : 'Send reminder'}</button>}
                {current && <button disabled={busy === env.id} onClick={() => signInPerson(env)} style={mini}>Sign in person</button>}
                {env.deal_id && onOpenDeal && <button onClick={() => { setOpenId(null); onOpenDeal(env.deal_id!); }} style={mini}>Open deal</button>}
              </div>

              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', margin: '22px 0 8px' }}>Signers</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sg.map(s => {
                  const signed = s.status === 'signed' || !!s.signed_at;
                  const declined = s.status === 'declined' || !!s.declined_at;
                  const isCur = current?.id === s.id;
                  const when = signed ? `Signed ${ago(s.signed_at)}` : declined ? `Declined ${ago(s.declined_at)}` : s.viewed_at ? `Opened ${ago(s.viewed_at)}` : s.sent_at ? `Sent ${ago(s.sent_at)}` : 'Not sent yet';
                  const dv = !signed && !s.in_person ? s.delivery : null;
                  const bad = dv === 'bounced' || dv === 'complained' || dv === 'failed';
                  return (
                    <div key={s.id} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '9px 11px', borderRadius: 10, border: `1px solid ${isCur ? '#f0e2c4' : '#eef0f2'}`, background: isCur ? '#fffaf0' : '#fff' }}>
                      <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: signed ? '#16a34a' : declined ? '#dc2626' : '#f1f2f4', color: signed || declined ? '#fff' : '#6b7280' }}>{signed ? '✓' : declined ? '!' : s.signing_order}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>{s.name} <span style={{ fontWeight: 500, color: '#9ca3af', textTransform: 'capitalize' }}>· {s.signer_role}</span></div>
                        <div style={{ fontSize: 12, color: '#9ca3af', overflowWrap: 'anywhere' }}>{s.email}{s.in_person ? ' · in person' : ''}</div>
                        <div style={{ fontSize: 12, color: declined ? '#b91c1c' : '#6b7280', marginTop: 2 }}>
                          {when}{declined && s.decline_reason ? ` — “${s.decline_reason}”` : ''}
                          {dv && <span style={{ marginLeft: 8, fontWeight: 700, color: bad ? '#b91c1c' : dv === 'opened' || dv === 'clicked' ? '#15803d' : '#92400e' }}>· email {dv === 'delivered' ? 'delivered, unopened' : dv}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', margin: '22px 0 8px' }}>Activity</div>
              {!evs ? <div style={{ fontSize: 12.5, color: '#9ca3af' }}>Loading…</div>
                : evs.length === 0 ? <div style={{ fontSize: 12.5, color: '#9ca3af' }}>No activity recorded yet.</div>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {evs.map(ev => {
                      const l = ACT_LOOK[ev.event] ?? { icon: '•', label: ev.event, color: '#6b7280' };
                      const who = ev.signer_name || (ev.actor && ev.actor !== 'system' && ev.actor.includes('@') ? ev.actor : null);
                      const d = new Date(ev.created_at);
                      const ua = ev.user_agent || '';
                      const dev = /iPhone|Android|iPad|Mobile/i.test(ua) ? 'mobile' : ua ? 'desktop' : '';
                      return (
                        <div key={ev.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12.5, lineHeight: 1.45 }}>
                          <span style={{ width: 16, flexShrink: 0 }}>{l.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                              <span style={{ flex: 1, minWidth: 0, color: l.color, fontWeight: 600 }}>{l.label}</span>
                              <span style={{ flexShrink: 0, color: '#9ca3af', whiteSpace: 'nowrap' }}>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                            </div>
                            {(who || dev || ev.ip) && (
                              <div style={{ color: '#9ca3af', overflowWrap: 'break-word' }}>
                                {who && <span style={{ color: '#374151' }}>{who}</span>}
                                {dev && <span>{who ? ' · ' : ''}{dev}</span>}
                                {ev.ip && <span>{who || dev ? ' · ' : ''}<span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{ev.ip}</span></span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 26, paddingTop: 14, borderTop: '1px solid #f1f2f4' }}>
                {env.status === 'completed' && signedUrl && <a href={dl(signedUrl)} style={{ ...link, display: 'inline' }}>Download signed</a>}
                {env.status === 'completed' && env.executed_url && env.executed_clean_url && <a href={dl(env.executed_url)} style={link}>Download with certificate</a>}
                {env.archived_at
                  ? <button disabled={busy === env.id} onClick={async () => { await restoreEnv(env); setOpenId(null); }} style={link}>Restore</button>
                  : <button disabled={busy === env.id} onClick={async () => { await archiveEnv(env); setOpenId(null); }} style={link}>Archive</button>}
                {env.status !== 'voided' && !env.archived_at && env.status !== 'completed' && <button disabled={busy === env.id} onClick={() => voidEnv(env)} style={{ ...link, color: '#b91c1c' }}>Cancel request</button>}
                {isSuperAdmin && <button disabled={busy === env.id} onClick={async () => { await purgeEnv(env); setOpenId(null); }} style={{ ...link, color: '#b91c1c' }}>Delete permanently</button>}
              </div>
            </aside>
          </div>
        );
      })()}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 0', color: '#9ca3af' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>{title}</div>
      {body && <div style={{ fontSize: 13, marginTop: 3 }}>{body}</div>}
    </div>
  );
}

// How each audit-trail event reads in the drawer.
const ACT_LOOK: Record<string, { icon: string; label: string; color: string }> = {
  created:   { icon: '📄', label: 'Request created', color: '#6b7280' },
  sent:      { icon: '📤', label: 'Email sent', color: '#6b7280' },
  email_delivered: { icon: '📬', label: 'Email delivered', color: '#6b7280' },
  email_opened:    { icon: '📖', label: 'Email opened', color: '#1e40af' },
  email_clicked:   { icon: '🔗', label: 'Clicked the link', color: '#1e40af' },
  email_bounced:   { icon: '⚠️', label: 'Email bounced', color: '#b91c1c' },
  email_complained:{ icon: '⚠️', label: 'Marked as spam', color: '#b91c1c' },
  email_delayed:   { icon: '⏱', label: 'Delivery delayed', color: '#92400e' },
  email_failed:    { icon: '⚠️', label: 'Email failed to send', color: '#b91c1c' },
  in_person_started: { icon: '🖊', label: 'Signed in person', color: '#5b3d91' },
  signer_added:   { icon: '➕', label: 'Signer added', color: '#6b7280' },
  signer_updated: { icon: '✏️', label: 'Signer updated', color: '#6b7280' },
  archived:  { icon: '🗄', label: 'Archived', color: '#6b7280' },
  opened:    { icon: '👀', label: 'Opened the document', color: '#1e40af' },
  signed:    { icon: '✍️', label: 'Signed', color: '#15803d' },
  declined:  { icon: '🚫', label: 'Declined to sign', color: '#b91c1c' },
  completed: { icon: '✅', label: 'Fully executed', color: '#15803d' },
  voided:    { icon: '⊘', label: 'Voided', color: '#b91c1c' },
};
