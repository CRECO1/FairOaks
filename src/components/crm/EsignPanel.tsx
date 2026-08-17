'use client';
// The E-Sign panel for a deal: lists the deal's documents with their signature status,
// sends a document for signature with a flexible (add/remove/reorder) signer list, and
// manages an out-for-signature request (nudge the current signer, fix a pending signer's
// email, add another signer, or cancel). Backed by /api/crm/envelopes.
import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface PickContact { id: string; first_name?: string; last_name?: string; business_name?: string; email?: string; type?: string }
interface Doc { id: string; title?: string; form_id?: string; url?: string | null; updated_at?: string; crm_forms?: { name?: string; form_code?: string } | null }
interface Signer { id: string; signer_role: string; name: string; email: string; signing_order: number; status: string; sent_at?: string | null; viewed_at?: string | null; signed_at?: string | null }
interface Envelope { id: string; submission_id?: string | null; status: string; executed_url?: string | null; title?: string; created_at?: string; crm_envelope_signers?: Signer[] }
interface Draft { role: string; name: string; email: string }

const GOLD = '#c9922c';
const ROLES = [['client', 'Client'], ['landlord', 'Landlord'], ['agent', 'Agent'], ['seller', 'Seller'], ['buyer', 'Buyer'], ['witness', 'Witness'], ['other', 'Other']] as const;
const roleLabel = (r: string) => (ROLES.find(([v]) => v === r)?.[1] as string) || (r ? r[0].toUpperCase() + r.slice(1) : 'Signer');
const fieldTypeLabel = (t: string) => t === 'signature' ? 'Signature' : t === 'initial' ? 'Initials' : t === 'date' ? 'Date' : t.charAt(0).toUpperCase() + t.slice(1);
const cName = (c: PickContact) => c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact';
const INP: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13.5, fontFamily: "'DM Sans',sans-serif", color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' };
const ctrl: React.CSSProperties = { fontSize: 12, fontWeight: 800, lineHeight: 1, color: '#8a6d3b', background: '#fbf6e9', border: '1px solid #e6d3a2', borderRadius: 5, cursor: 'pointer', padding: '3px 6px' };
const mini: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' };
const signedCount = (e?: Envelope) => (e?.crm_envelope_signers || []).filter(s => s.status === 'signed' || s.signed_at).length;
const ago = (iso?: string | null) => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`; };
const authOf = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});

// ── Send a document for signature (dynamic signer list) ──────────────────────
function SendView({ doc, dealId, clients, dealClient, agentName, agentEmail, authToken, showToast, onCancel, onSent }: {
  doc: Doc; dealId: string; clients: PickContact[]; dealClient?: { name?: string; email?: string };
  agentName?: string; agentEmail?: string; authToken?: string; showToast?: (m: string) => void; onCancel: () => void; onSent: () => void;
}) {
  const [signers, setSigners] = useState<Draft[]>([{ role: 'client', name: dealClient?.name || '', email: dealClient?.email || '' }]);
  const [message, setMessage] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Placed signature fields on this document, grouped by role, so the agent can drop
  // any that don't apply to this deal (e.g. a 2nd seller block on a single-seller sale).
  const [fieldGroups, setFieldGroups] = useState<{ role: string; types: string[]; keep: boolean }[]>([]);
  const [docValues, setDocValues] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/crm/form-submissions/${doc.id}`, { headers: authOf(authToken) })
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        const vals: Array<Record<string, unknown>> = Array.isArray(j.submission?.values) ? j.submission.values : [];
        setDocValues(vals);
        const sig = vals.filter(x => ['signature', 'initial', 'date'].includes(String(x.type)));
        const byRole = new Map<string, string[]>();
        for (const s of sig) { const r = String(s.signerRole || 'client'); if (!byRole.has(r)) byRole.set(r, []); byRole.get(r)!.push(String(s.type)); }
        setFieldGroups(Array.from(byRole.entries()).map(([role, types]) => ({ role, types, keep: true })));
      })
      .catch(() => { if (alive) setFieldGroups([]); });
    return () => { alive = false; };
  }, [doc.id, authToken]);
  const set = (i: number, p: Partial<Draft>) => setSigners(s => s.map((x, k) => k === i ? { ...x, ...p } : x));
  const move = (i: number, d: -1 | 1) => setSigners(s => { const j = i + d; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const suggestions = (q: string) => q.trim() ? clients.filter(c => cName(c).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];

  async function send() {
    const clean = signers.filter(s => s.name.trim() && s.email.includes('@')).map((s, i) => ({ signer_role: s.role, name: s.name.trim(), email: s.email.trim(), signing_order: i + 1 }));
    if (!clean.length) { showToast?.('Add at least one signer with a valid email'); return; }
    setBusy(true);
    try {
      // Persist any trimmed signature fields before sending, so no dropped field is signed.
      const removedRoles = fieldGroups.filter(g => !g.keep).map(g => g.role);
      if (removedRoles.length && docValues.length) {
        const kept = docValues.filter(v => !(['signature', 'initial', 'date'].includes(String(v.type)) && removedRoles.includes(String(v.signerRole || 'client'))));
        const removedCount = docValues.length - kept.length;
        const up = await fetch(`/api/crm/form-submissions/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ values: kept, logSummary: `Removed ${removedCount} signature field${removedCount === 1 ? '' : 's'} (${removedRoles.map(roleLabel).join(', ')}) before sending` }) });
        if (!up.ok) { showToast?.('Could not update the signature fields'); return; }
      }
      const r = await fetch('/api/crm/envelopes', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ submission_id: doc.id, deal_id: dealId, title: doc.title || doc.crm_forms?.name, message, signers: clean }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not send'); return; }
      showToast?.(j.sent ? `📤 Sent to ${clean[0].email} ✓` : 'Request created');
      onSent();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 8 }}>‹ Back</button>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#1a1a1a', marginBottom: 2 }}>Send for signature</div>
      <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: 14 }}><strong>{doc.title || doc.crm_forms?.name}</strong> — signers are emailed in order; each signs, then the next is notified.</div>

      {fieldGroups.length > 0 && (() => {
        const keptCount = fieldGroups.filter(g => g.keep).reduce((n, g) => n + g.types.length, 0);
        const anyRemoved = fieldGroups.some(g => !g.keep);
        return (
          <div style={{ fontSize: 12.5, color: '#15803d', background: '#ecfdf5', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
            <div style={{ fontWeight: 800 }}>✒ {keptCount} signature field{keptCount === 1 ? '' : 's'} on this document</div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {fieldGroups.map((g, gi) => {
                const counts = g.types.reduce((m, t) => { m[t] = (m[t] || 0) + 1; return m; }, {} as Record<string, number>);
                const summary = Object.entries(counts).map(([t, n]) => n > 1 ? `${n} ${fieldTypeLabel(t)}` : fieldTypeLabel(t)).join(' + ');
                return (
                  <div key={g.role} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, background: '#fff', border: '1px solid #d6f0dd', borderRadius: 7, padding: '5px 4px 5px 9px', opacity: g.keep ? 1 : 0.6 }}>
                    <span style={{ fontWeight: 700, color: '#166534', textDecoration: g.keep ? 'none' : 'line-through' }}>{roleLabel(g.role)}</span>
                    <span style={{ color: '#4b7d5b', textDecoration: g.keep ? 'none' : 'line-through' }}>{summary}</span>
                    <span style={{ flex: 1 }} />
                    {g.keep
                      ? <button onClick={() => setFieldGroups(prev => prev.map((x, j) => j === gi ? { ...x, keep: false } : x))} title="Remove these fields — no one will sign here" style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fff', border: '1px solid #fecaca', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Remove</button>
                      : <button onClick={() => setFieldGroups(prev => prev.map((x, j) => j === gi ? { ...x, keep: true } : x))} title="Restore these fields" style={{ fontSize: 11, fontWeight: 700, color: '#15803d', background: '#fff', border: '1px solid #bbf7d0', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Undo</button>}
                  </div>
                );
              })}
            </div>
            {anyRemoved && <div style={{ fontSize: 11, color: '#8a6d3b', marginTop: 6 }}>Removed fields won’t be signed. Saved to the document when you send.</div>}
          </div>
        );
      })()}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {signers.map((s, i) => {
          const sugg = pick === i ? suggestions(s.name) : [];
          return (
            <div key={i} style={{ border: '1px solid #eef0f2', borderRadius: 10, padding: 10, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#9ca3af' }}>{i + 1}.</span>
                <select value={s.role} onChange={e => set(i, { role: e.target.value })} style={{ ...INP, width: 'auto', flex: '0 0 120px', padding: '5px 8px', fontSize: 12.5 }}>
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <span style={{ flex: 1 }} />
                <button onClick={() => move(i, -1)} disabled={i === 0} title="Up" style={{ ...ctrl, opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                <button onClick={() => move(i, 1)} disabled={i === signers.length - 1} title="Down" style={{ ...ctrl, opacity: i === signers.length - 1 ? 0.3 : 1 }}>↓</button>
                {signers.length > 1 && <button onClick={() => setSigners(list => list.filter((_, k) => k !== i))} title="Remove" style={{ ...ctrl, color: '#dc2626', borderColor: '#fecaca', background: '#fff' }}>✕</button>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ position: 'relative' }}>
                  <input value={s.name} onChange={e => { set(i, { name: e.target.value }); setPick(i); }} onFocus={() => setPick(i)} onBlur={() => setTimeout(() => setPick(p => (p === i ? null : p)), 150)} placeholder="Name" style={{ ...INP, fontSize: 13.5 }} />
                  {sugg.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginTop: 2, boxShadow: '0 6px 20px rgba(0,0,0,0.1)', maxHeight: 180, overflowY: 'auto' }}>
                      {sugg.map(c => (
                        <button key={c.id} onMouseDown={() => set(i, { name: cName(c), email: c.email || '' })} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 11px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 13 }} onMouseEnter={e => (e.currentTarget.style.background = '#faf7ef')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                          {cName(c)}{c.email ? <span style={{ color: '#9ca3af', fontSize: 11 }}> · {c.email}</span> : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input value={s.email} onChange={e => set(i, { email: e.target.value })} placeholder="Email" style={{ ...INP, fontSize: 13.5 }} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setSigners(s => [...s, { role: 'other', name: '', email: '' }])} style={{ fontSize: 12.5, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px dashed #e6d3a2', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>＋ Add signer</button>
        {agentName && !signers.some(s => s.role === 'agent') && <button onClick={() => setSigners(s => [...s, { role: 'agent', name: agentName, email: agentEmail || '' }])} style={{ fontSize: 12.5, fontWeight: 700, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>＋ Me (agent)</button>}
      </div>

      <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Optional message to the signers…" style={{ ...INP, minHeight: 54, resize: 'vertical', marginTop: 12 }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
        <button onClick={send} disabled={busy} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Sending…' : '📤 Send for signature'}</button>
      </div>
    </div>
  );
}

// ── Manage an out-for-signature request ──────────────────────────────────────
function ManageView({ doc, env, authToken, showToast, onBack, onReload }: {
  doc: Doc; env?: Envelope; authToken?: string; showToast?: (m: string) => void; onBack: () => void; onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [add, setAdd] = useState<Draft>({ role: 'other', name: '', email: '' });
  if (!env) { return <div style={{ fontFamily: "'DM Sans',sans-serif" }}><button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13 }}>‹ Back</button></div>; }
  const signers = (env.crm_envelope_signers || []).slice().sort((a, b) => a.signing_order - b.signing_order);
  const current = signers.find(s => s.status !== 'signed' && !s.signed_at);

  async function act(body: Record<string, unknown>, okMsg: string, back = false) {
    setBusy(true);
    const r = await fetch('/api/crm/envelopes', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ envelope_id: env!.id, ...body }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { showToast?.(j.error || 'Action failed'); return; }
    showToast?.(okMsg); if (back) onBack(); else onReload();
  }
  async function copyLink(signerId: string) {
    const r = await fetch('/api/crm/envelopes', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ envelope_id: env!.id, action: 'get_link', signer_id: signerId }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { showToast?.(j.error || 'Could not get link'); return; }
    try { await navigator.clipboard.writeText(j.url); showToast?.('Sign link copied ✓'); } catch { window.prompt('Copy this signer’s link:', j.url); }
  }

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 8 }}>‹ Back</button>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#1a1a1a', marginBottom: 2 }}>{doc.title || doc.crm_forms?.name}</div>
      <div style={{ fontSize: 12.5, color: '#1d4ed8', marginBottom: 14 }}>📤 Out for signature · {signedCount(env)}/{signers.length} signed</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {signers.map(s => {
          const done = s.status === 'signed' || !!s.signed_at;
          const isCurrent = current?.id === s.id;
          return (
            <div key={s.id} style={{ border: '1px solid #eef0f2', borderRadius: 10, padding: '9px 12px', background: done ? '#f0fdf4' : isCurrent ? '#eff6ff' : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#9ca3af' }}>{s.signing_order}.</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a1a' }}>{s.name} <span style={{ fontSize: 11, color: '#9ca3af', textTransform: 'capitalize' }}>· {s.signer_role}</span></div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{s.email}</div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap', ...(done ? { background: '#dcfce7', color: '#15803d' } : isCurrent ? { background: '#dbeafe', color: '#1d4ed8' } : { background: '#f3f4f6', color: '#6b7280' }) }}>
                  {done ? '✓ Signed' : isCurrent ? (s.viewed_at ? '👁 Viewed' : `⏳ Waiting ${ago(s.sent_at)}`) : 'Up next'}
                </span>
              </div>
              {!done && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {editId === s.id ? (
                    <>
                      <input value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="new email" style={{ ...INP, fontSize: 12.5, padding: '5px 8px' }} />
                      <button onClick={() => { act({ action: 'update_signer', signer_id: s.id, email: editEmail }, 'Signer updated ✓'); setEditId(null); }} style={{ ...mini, background: GOLD, color: '#fff', border: 'none' }}>Save</button>
                      <button onClick={() => setEditId(null)} style={mini}>✕</button>
                    </>
                  ) : (
                    <>
                      {isCurrent && <button disabled={busy} onClick={() => act({ action: 'nudge' }, `Reminder sent to ${s.email} ✓`)} style={{ ...mini, color: '#a06a12', borderColor: '#f0e2c4' }}>🔔 Nudge</button>}
                      <button onClick={() => { setEditId(s.id); setEditEmail(s.email); }} style={mini}>✎ Fix email</button>
                      <button onClick={() => copyLink(s.id)} title="Copy this signer's private link to share manually" style={mini}>🔗 Link</button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {adding ? (
        <div style={{ border: '1px dashed #e6d3a2', borderRadius: 10, padding: 10, marginTop: 8, background: '#fffdf6' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select value={add.role} onChange={e => setAdd(a => ({ ...a, role: e.target.value }))} style={{ ...INP, width: 'auto', flex: '0 0 110px', padding: '5px 8px', fontSize: 12.5 }}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <input value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} placeholder="Name" style={{ ...INP, fontSize: 13 }} />
            <input value={add.email} onChange={e => setAdd(a => ({ ...a, email: e.target.value }))} placeholder="Email" style={{ ...INP, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button disabled={busy} onClick={() => { if (!add.name.trim() || !add.email.includes('@')) { showToast?.('Name + valid email'); return; } act({ action: 'add_signer', name: add.name, email: add.email, role: add.role }, 'Signer added ✓'); setAdding(false); setAdd({ role: 'other', name: '', email: '' }); }} style={{ ...mini, background: GOLD, color: '#fff', border: 'none' }}>Add signer</button>
            <button onClick={() => setAdding(false)} style={mini}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ fontSize: 12.5, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px dashed #e6d3a2', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', marginTop: 10 }}>＋ Add signer</button>
      )}

      <div style={{ borderTop: '1px solid #f3f4f6', marginTop: 14, paddingTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" style={{ ...mini, textDecoration: 'none', color: '#6b7280' }}>PDF ↗</a>}
        <span style={{ flex: 1 }} />
        <button disabled={busy} onClick={() => { if (window.confirm('Cancel this signature request? Signers can no longer sign; the document stays so you can edit + re-send.')) act({ action: 'void' }, 'Signature request cancelled', true); }} style={{ ...mini, color: '#b91c1c', borderColor: '#fecaca' }}>⊘ Cancel request</button>
      </div>
    </div>
  );
}

interface Props {
  dealId: string;
  clients?: PickContact[];
  dealClient?: { name?: string; email?: string };
  agentName?: string;
  agentEmail?: string;
  authToken?: string;
  showToast?: (m: string) => void;
}

export default function EsignPanel({ dealId, clients = [], dealClient, agentName, agentEmail, authToken, showToast }: Props) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [envByDoc, setEnvByDoc] = useState<Record<string, Envelope>>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<{ t: 'list' } | { t: 'send'; doc: Doc } | { t: 'manage'; doc: Doc }>({ t: 'list' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ds, es] = await Promise.all([
        fetch(`/api/crm/form-submissions?deal_id=${dealId}`, { headers: authOf(authToken) }).then(r => r.json()),
        fetch(`/api/crm/envelopes?deal_id=${dealId}`, { headers: authOf(authToken) }).then(r => r.json()),
      ]);
      setDocs(Array.isArray(ds.submissions) ? ds.submissions : []);
      const map: Record<string, Envelope> = {};
      for (const e of (es.envelopes ?? []) as Envelope[]) { if (e.submission_id && !map[e.submission_id]) map[e.submission_id] = e; }
      setEnvByDoc(map);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [dealId, authToken]);

  useEffect(() => { load(); }, [load]);

  const statusOf = useCallback((doc: Doc): 'draft' | 'sent' | 'completed' => {
    const e = envByDoc[doc.id];
    if (!e || e.status === 'voided') return 'draft';
    if (e.status === 'completed') return 'completed';
    return 'sent';
  }, [envByDoc]);

  const ordered = useMemo(() => {
    const rank = (d: Doc) => ({ sent: 0, draft: 1, completed: 2 }[statusOf(d)]);
    return [...docs].sort((a, b) => rank(a) - rank(b) || (b.updated_at || '').localeCompare(a.updated_at || ''));
  }, [docs, statusOf]);

  if (view.t === 'send') return <SendView doc={view.doc} dealId={dealId} clients={clients} dealClient={dealClient} agentName={agentName} agentEmail={agentEmail} authToken={authToken} showToast={showToast} onCancel={() => setView({ t: 'list' })} onSent={() => { setView({ t: 'list' }); load(); }} />;
  if (view.t === 'manage') return <ManageView doc={view.doc} env={envByDoc[view.doc.id]} authToken={authToken} showToast={showToast} onBack={() => { setView({ t: 'list' }); load(); }} onReload={load} />;

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#1a1a1a', marginBottom: 10 }}>✍️ E-Sign</div>
      {loading ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>
        : ordered.length === 0 ? <div style={{ fontSize: 13, color: '#9ca3af' }}>No documents on this deal yet. Fill a form on the deal and it shows here, ready to send for signature.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ordered.map(doc => {
              const st = statusOf(doc); const env = envByDoc[doc.id];
              return (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #eef0f2', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                  <span style={{ fontSize: 18 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title || doc.crm_forms?.name || 'Document'}</div>
                    <div style={{ fontSize: 11.5, marginTop: 1 }}>
                      {st === 'sent' ? <span style={{ color: '#1d4ed8', fontWeight: 700 }}>📤 Out for signature · {signedCount(env)}/{(env?.crm_envelope_signers || []).length}</span>
                        : st === 'completed' ? <span style={{ color: '#15803d', fontWeight: 700 }}>✓ Signed</span>
                        : <span style={{ color: '#9ca3af' }}>Draft</span>}
                    </div>
                  </div>
                  {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" style={{ ...mini, textDecoration: 'none', color: '#6b7280' }}>PDF ↗</a>}
                  {st === 'sent' ? <button onClick={() => setView({ t: 'manage', doc })} style={{ ...mini, color: '#a06a12', borderColor: '#f0e2c4' }}>Manage</button>
                    : st === 'completed' ? (env?.executed_url ? <a href={env.executed_url} target="_blank" rel="noreferrer" style={{ ...mini, textDecoration: 'none', color: '#15803d', borderColor: '#bbf7d0', background: '#f0fdf4' }}>Signed ↗</a> : <span style={{ ...mini, color: '#9ca3af', cursor: 'default' }}>Signed</span>)
                    : <button onClick={() => setView({ t: 'send', doc })} disabled={!doc.form_id} style={{ ...mini, background: GOLD, color: '#fff', border: 'none', cursor: doc.form_id ? 'pointer' : 'default' }}>📤 Send</button>}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
