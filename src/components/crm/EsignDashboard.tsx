'use client';
// Global E-Sign dashboard. Two halves: documents an agent has imported and is still
// preparing (drop a PDF in, place the signature/date fields, send), and everything
// already out for signature — who each is waiting on and for how long.
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface Signer { id: string; name: string; email: string; signer_role: string; signing_order: number; status: string; sent_at?: string | null; viewed_at?: string | null; signed_at?: string | null; declined_at?: string | null; decline_reason?: string | null; in_person?: boolean }
interface Envelope { id: string; deal_id?: string | null; title?: string; status: string; created_at?: string; archived_at?: string | null; sent_by?: string | null; business_unit?: string | null; executed_url?: string | null; executed_clean_url?: string | null; crm_deals?: { id: string; property?: string; client?: string } | null; crm_envelope_signers?: Signer[] }

// A document imported for signing: a submission with no library form behind it.
export interface ImportedDoc { id: string; title?: string; url?: string | null; deal_id?: string | null; listing_id?: string | null; updated_at?: string; envelope?: { id: string; status: string } | null }

interface Props {
  authToken?: string; showToast?: (m: string) => void; onOpenDeal?: (dealId: string) => void;
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

const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const ago = (iso?: string | null) => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; };
const mini: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '8px 12px', minHeight: 36, cursor: 'pointer', whiteSpace: 'nowrap' };

export default function EsignDashboard({ authToken, showToast, onOpenDeal, onCompose, onPreview, isSuperAdmin, refreshKey = 0 }: Props) {
  const [envs, setEnvs] = useState<Envelope[]>([]);
  const [docs, setDocs] = useState<ImportedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);   // include cancelled + completed
  const [byAgent, setByAgent] = useState('');     // '' = every agent
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    try {
      const j = await fetch('/api/crm/esign-import', { headers: auth(authToken) }).then(r => r.json());
      setDocs(Array.isArray(j.documents) ? j.documents : []);
    } catch { setDocs([]); }
  }, [authToken]);
  useEffect(() => { loadDocs(); }, [loadDocs, refreshKey]);

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
      const j = await fetch(`/api/crm/envelopes?${showAll ? 'scope=all' : 'pending=1'}`, { headers: auth(authToken) }).then(r => r.json());
      const list = (Array.isArray(j.envelopes) ? j.envelopes : []) as Envelope[];
      list.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')); // oldest (most overdue) first
      setEnvs(list);
    } catch { setEnvs([]); }
    finally { setLoading(false); }
  }, [authToken, showAll]);

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
    if (!window.confirm(`Archive "${env.title || 'this request'}"?\n\nIt moves out of the active list. Everything is kept — tick “Show cancelled & completed” to find it again.`)) return;
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

  async function nudge(env: Envelope) {
    setBusy(env.id);
    try {
      const r = await fetch('/api/crm/envelopes', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ envelope_id: env.id, action: 'nudge' }) });
      const j = await r.json().catch(() => ({}));
      showToast?.(r.ok ? `🔔 Reminder sent${j.to ? ` to ${j.to}` : ''} ✓` : (j.error || 'Could not nudge'));
    } finally { setBusy(null); load(); }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap', rowGap: 8 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, fontWeight: 700, margin: 0, color: '#111', whiteSpace: 'nowrap' }}>✍️ Signature requests</h2>
        <span style={{ fontSize: 13, color: '#9ca3af' }}>{loading ? '' : `${envs.filter(e => !byAgent || e.sent_by === byAgent).length} ${showAll ? 'requests' : 'out for signature'}${byAgent ? ` · ${byAgent}` : ''}`}</span>
        {/* Pushes the controls right without forcing them onto their own line;
            `flex-grow` on a zero-basis spacer was wrapping Refresh on desktop. */}
        <span style={{ flex: '1 1 auto', minWidth: 0 }} />
        {(() => {
          const agents = Array.from(new Set(envs.map(e => e.sent_by).filter(Boolean) as string[])).sort();
          if (agents.length < 2) return null;
          return (
            <select value={byAgent} onChange={e => setByAgent(e.target.value)} title="Show only one agent's documents"
              style={{ fontSize: 12.5, padding: '5px 8px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontFamily: "'DM Sans',sans-serif" }}>
              <option value="">All agents</option>
              {agents.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          );
        })()}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#6b7280', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Show cancelled &amp; completed
        </label>
        <button onClick={load} style={{ ...mini, color: '#9ca3af', flexShrink: 0 }}>⟳ Refresh</button>
      </div>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0, marginBottom: 18 }}>Import a document to be signed, or track the ones already out. Nudge the current signer or jump to the deal to manage.</p>

      {/* ── Import ── */}
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) importFile(f); }}
        onClick={() => !uploading && fileRef.current?.click()}
        style={{ border: `2px dashed ${dragging ? '#c9922c' : '#e6d3a2'}`, background: dragging ? '#fdf6e9' : '#fffdf6', borderRadius: 12,
          padding: '20px 18px', textAlign: 'center', cursor: uploading ? 'default' : 'pointer', marginBottom: 22 }}>
        <div style={{ fontSize: 26, marginBottom: 4 }}>{uploading ? '⏳' : '📥'}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#111' }}>{uploading ? 'Importing…' : 'Send a document for signature'}</div>
        <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 3 }}>
          Drop a PDF here or click to browse — add the signers, drag where each of them signs and dates, then review before it goes out.
        </div>
      </div>

      {/* ── Imported, not yet sent ── */}
      {docs.filter(d => !d.envelope).length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Ready to prepare &amp; send</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {docs.filter(d => !d.envelope).map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, rowGap: 10, background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: '13px 16px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>📄</span>
                <div style={{ flex: '1 1 190px', minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || 'Document'}</div>
                  <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 1 }}>Imported{d.updated_at ? ` · ${ago(d.updated_at)}` : ''} · not sent yet</div>
                </div>
                <button onClick={() => removeDoc(d)} title="Remove this document" style={{ ...mini, color: '#e5b4b4', borderColor: '#f3e4e4' }}>✕</button>
                {onCompose && <button onClick={() => onCompose({ doc: d })} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }}>Prepare &amp; send →</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <div style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</div>
        : envs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ca3af' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>Nothing is waiting to be signed.</div>
            <div style={{ fontSize: 13 }}>Import a document above, or send one from a deal's E-Sign tab.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af' }}>{showAll ? 'All signature requests' : 'Out for signature'}</div>
            {envs.filter(env => !byAgent || env.sent_by === byAgent).map(env => {
              const signers = (env.crm_envelope_signers || []).slice().sort((a, b) => a.signing_order - b.signing_order);
              const done = signers.filter(s => s.status === 'signed' || s.signed_at).length;
              const declinedBy = signers.find(s => s.status === 'declined' || s.declined_at);
              const current = declinedBy ? undefined : signers.find(s => s.status !== 'signed' && !s.signed_at);
              const dealName = env.crm_deals?.property || env.crm_deals?.client || 'Deal';
              return (
                <div key={env.id} style={{ display: 'flex', alignItems: 'center', gap: 12, rowGap: 10, background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: '13px 16px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>📄</span>
                  {/* Needs a basis wide enough to be worth a line of its own; below that
                      the actions wrap underneath instead of off the side of the screen. */}
                  <div style={{ flex: '1 1 190px', minWidth: 0 }}>
                    <div title={env.title || 'Document'} style={{ fontSize: 14.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{env.title || 'Document'}</div>
                    <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 1 }}>
                      {env.sent_by && <><span style={{ fontWeight: 700, color: '#6b7280' }}>{env.sent_by}</span> · </>}
                      {dealName} · {done}/{signers.length} signed
                      {showAll && env.status !== 'sent' && env.status !== 'in_progress' && (
                        <span style={{ marginLeft: 6, fontWeight: 700, color: env.status === 'completed' ? '#15803d' : '#b91c1c' }}>
                          · {env.status === 'completed' ? 'Completed' : env.status === 'voided' ? 'Cancelled' : env.status === 'declined' ? 'Declined' : env.status}
                        </span>
                      )}
                      {env.archived_at && <span style={{ marginLeft: 6, fontWeight: 700, color: '#6b7280' }}>· 🗄 Archived</span>}
                    </div>
                    {declinedBy ? (
                      <div style={{ fontSize: 12.5, color: '#b91c1c', marginTop: 3, fontWeight: 600 }}>
                        ✋ Declined by {declinedBy.name}
                        {declinedBy.decline_reason && <span style={{ color: '#6b7280', fontWeight: 400 }}> — “{declinedBy.decline_reason}”</span>}
                      </div>
                    ) : current && (
                      <div style={{ fontSize: 12.5, color: '#1d4ed8', marginTop: 3, fontWeight: 600 }}>
                        {current.in_person ? '🖊 To sign in person: ' : '⏳ Waiting on '}{current.name} <span style={{ color: '#9ca3af', fontWeight: 400 }}>· {current.email}{current.in_person ? '' : current.viewed_at ? ' · viewed' : current.sent_at ? ` · sent ${ago(current.sent_at)}` : ''}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  {/* A completed request is where you come to fetch the executed
                      document — view it, or save it without the certificate. */}
                  {env.status === 'completed' && (env.executed_clean_url || env.executed_url) && (() => {
                    const view = env.executed_clean_url || env.executed_url!;
                    const file = `${(env.title || 'document').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-signed.pdf`;
                    const dl = (u: string) => `${u}${u.includes('?') ? '&' : '?'}download=${encodeURIComponent(file)}`;
                    return (
                      <>
                        <button onClick={() => onPreview?.({ url: view, name: file })} title="View the signed document"
                          style={{ ...mini, color: '#15803d', borderColor: '#bbf7d0', background: '#f0fdf4' }}>📄 View signed</button>
                        <a href={dl(view)} title="Download the signed document (no Certificate of Completion)"
                          style={{ ...mini, textDecoration: 'none', color: '#15803d', borderColor: '#bbf7d0', background: '#f0fdf4', display: 'inline-flex', alignItems: 'center' }}>⬇</a>
                        {env.executed_url && env.executed_clean_url && (
                          <a href={dl(env.executed_url)} title="Download with the Certificate of Completion"
                            style={{ ...mini, textDecoration: 'none', color: '#6b7280', display: 'inline-flex', alignItems: 'center' }}>⬇ + cert</a>
                        )}
                      </>
                    );
                  })()}
                  {/* Offered for whoever's turn it is, not only pre-marked recipients —
                      a tenant can turn up at the office without anyone planning for it. */}
                  {current && (
                    <button disabled={busy === env.id} onClick={() => signInPerson(env)}
                      title={`Open ${current.name}'s signing page on this device`}
                      style={{ ...mini, color: '#5b3d91', borderColor: '#ded2f2', background: '#faf7ff' }}>
                      {busy === env.id ? '…' : '🖊 In person'}
                    </button>
                  )}
                  {current && !current.in_person && <button disabled={busy === env.id} onClick={() => nudge(env)} style={{ ...mini, color: '#a06a12', borderColor: '#f0e2c4' }}>{busy === env.id ? '…' : '🔔 Nudge'}</button>}
                  {env.status !== 'voided' && !env.archived_at && <button disabled={busy === env.id} onClick={() => voidEnv(env)} title="Stop this request — the document stays" style={{ ...mini, color: '#b91c1c', borderColor: '#fecaca' }}>⊘ Void</button>}
                  {env.archived_at
                    ? <button disabled={busy === env.id} onClick={() => restoreEnv(env)} title="Put this back in the active list" style={{ ...mini }}>↩︎ Restore</button>
                    : <button disabled={busy === env.id} onClick={() => archiveEnv(env)} title="File this away — everything is kept" style={{ ...mini }}>🗄 Archive</button>}
                  {isSuperAdmin && <button disabled={busy === env.id} onClick={() => purgeEnv(env)} title="Permanently delete — destroys the signatures and the executed copy" style={{ ...mini, color: '#fff', background: '#b91c1c', border: 'none' }}>🗑</button>}
                  {env.deal_id && onOpenDeal && <button onClick={() => onOpenDeal(env.deal_id!)} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }}>Open →</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
