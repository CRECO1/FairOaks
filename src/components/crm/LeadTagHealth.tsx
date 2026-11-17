'use client';
import React, { useEffect, useState } from 'react';

type Item = { id: string; name: string; source: string; at: string; snippet: string | null };

/** Admin health line: of the leads that arrived this week, how many were tagged to a property at import, and which named none. */
export default function LeadTagHealth({ authToken, onOpenContact }: { authToken?: string; onOpenContact?: (id: string) => void }) {
  const [d, setD] = useState<{ total: number; tagged: number; untagged: number; items: Item[]; calls?: { total: number; tagged: number }; removed?: { total: number; items: { id: string; name: string; at: string }[] } | null } | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [jobs, setJobs] = useState<{ key: string; label: string; when: string; realLabel?: string; status?: 'ok' | 'failed' | 'late' | 'never' | 'waiting'; hoursSince?: number | null; lastReal?: { ran_at: string; summary: string | null } | null; note?: string | null; runs: { ran_at: string; ok: boolean; summary: string | null }[] }[] | null>(null);
  const [showJobs, setShowJobs] = useState(false);
  const [gm, setGm] = useState<{ mailboxes: { email: string; name: string; needsReconnect: boolean; checkedAt: string | null }[]; filedToday: { received: number; sent: number }; lastFiledAt: string | null; lastLeadImportAt: string | null; healthy: boolean } | null>(null);
  const [showGm, setShowGm] = useState(false);
  const [preview, setPreview] = useState<{ listings: number; messages: { to: string; title: string; body: string }[] } | null | 'loading'>(null);
  const [testText, setTestText] = useState('');
  const [testOut, setTestOut] = useState<{ listing: string; how: string }[] | null | 'loading'>(null);
  const runTest = async () => {
    if (!testText.trim()) return;
    setTestOut('loading');
    const r = await fetch('/api/crm/tag-test', { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: testText }) }).catch(() => null);
    const j = r?.ok ? await r.json() : null;
    setTestOut(j ? j.matches : null);
  };
  const loadPreview = async () => {
    setPreview('loading');
    const r = await fetch('/api/crm/inquiry-digest-preview', { headers: { Authorization: `Bearer ${authToken}` } }).catch(() => null);
    setPreview(r?.ok ? await r.json() : null);
  };
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!authToken) return;
    let alive = true;
    fetch('/api/crm/gmail-health', { headers: { Authorization: `Bearer ${authToken}` } }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setGm(j); }).catch(() => {});
    fetch('/api/crm/job-runs', { headers: { Authorization: `Bearer ${authToken}` } }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j?.jobs) setJobs(j.jobs); }).catch(() => {});
    fetch('/api/crm/lead-tag-health', { headers: { Authorization: `Bearer ${authToken}` } }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setD(j); }).catch(() => {});
    return () => { alive = false; };
  }, [authToken]);
  if (!d) return null;
  return (
    <div style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)' }}>
      {d.total > 0 && <button onClick={() => d.untagged > 0 && setOpen(o => !o)} title="Leads from the last 7 days: how many were tagged to a property when they arrived"
        style={{ background: 'none', border: 'none', padding: 0, cursor: d.untagged > 0 ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 12.5, color: 'inherit', textAlign: 'left' }}>
        🏠 Leads, last 7 days: <b>{d.total}</b> new · <b style={{ color: 'var(--k-0f766e, #0f766e)' }}>{d.tagged}</b> tagged to a property{d.untagged > 0 && <> · <b style={{ color: '#b45309' }}>{d.untagged}</b> named no property {open ? '▾' : '▸'}</>}
      </button>}
      {d.calls && d.calls.total > 0 && <div title="Phone bot and voicemail summaries from the last 7 days: how many named one of our properties and were tagged to it" style={{ marginTop: 3 }}>📞 Bot &amp; voicemail calls, last 7 days: <b>{d.calls.total}</b> · <b style={{ color: 'var(--k-0f766e, #0f766e)' }}>{d.calls.tagged}</b> tagged to a property</div>}
      {d.removed && d.removed.total > 0 && (
        <div style={{ marginTop: 3 }}>
          <button onClick={() => setShowRemoved(o => !o)} title="Every contact delete is logged; merging duplicates deletes the extra one" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: 'inherit', textAlign: 'left' }}>🗑 Contacts removed or merged, last 7 days: <b>{d.removed.total}</b> {showRemoved ? '▾' : '▸'}</button>
          {showRemoved && d.removed.items.map(r => <div key={r.id + r.at} style={{ fontSize: 12, marginLeft: 14 }}>{r.name} · {new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>)}
        </div>
      )}
      {gm && (
        <div style={{ marginTop: 3 }}>
          <button onClick={() => setShowGm(o => !o)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: 'inherit', textAlign: 'left' }}>
            ✉ Gmail: <b style={{ color: gm.healthy ? 'var(--k-0f766e, #0f766e)' : '#b91c1c' }}>{gm.mailboxes.length === 0 ? 'no mailbox connected' : gm.healthy ? `${gm.mailboxes.length} mailbox${gm.mailboxes.length === 1 ? '' : 'es'} healthy` : 'a mailbox needs reconnecting'}</b>
            {' · '}{gm.filedToday.received + gm.filedToday.sent} email{gm.filedToday.received + gm.filedToday.sent === 1 ? '' : 's'} filed today{gm.lastFiledAt ? ` (last ${new Date(gm.lastFiledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})` : ''} {showGm ? '▾' : '▸'}
          </button>
          {showGm && (
            <div style={{ marginTop: 4, marginLeft: 14, fontSize: 12.5 }}>
              {gm.mailboxes.map(m => <div key={m.email} style={{ color: m.needsReconnect ? '#b91c1c' : undefined }}>{m.needsReconnect ? '⚠' : '✓'} {m.name || m.email} <span style={{ color: 'var(--k-9ca3af, #9ca3af)' }}>· {m.email}{m.needsReconnect ? ' · Google stopped accepting it: reconnect from that person’s sidebar' : ''}</span></div>)}
              <div style={{ color: 'var(--k-9ca3af, #9ca3af)', marginTop: 2 }}>{gm.filedToday.received} received · {gm.filedToday.sent} sent filed today{gm.lastLeadImportAt ? ` · lead-email import last filed ${new Date(gm.lastLeadImportAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</div>
            </div>
          )}
        </div>
      )}
      {jobs && (
        <div style={{ marginTop: 3 }}>
          <button onClick={() => setShowJobs(o => !o)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: 'inherit', textAlign: 'left' }}>⚙ Tagging jobs{jobs.filter(j => j.status === 'late' || j.status === 'failed').length > 0 && <b style={{ color: '#b91c1c' }}> · {jobs.filter(j => j.status === 'late' || j.status === 'failed').length} need a look</b>} {showJobs ? '▾' : '▸'}</button>
          {showJobs && (
            <div style={{ marginTop: 4, marginLeft: 6 }}>
              {jobs.map(j => {
                const last = j.runs[0];
                return (
                  <div key={j.key} style={{ marginBottom: 6 }}>
                    <div><b style={{ color: 'var(--k-374151, #374151)' }}>{j.label}</b> <span style={{ fontSize: 11.5 }}>· {j.when}</span>
                      {j.status === 'late' && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '1px 7px' }}>{j.hoursSince == null ? 'never ran' : `silent ${Math.round(j.hoursSince / 24 * 10) / 10} days`}</span>}
                      {j.status === 'failed' && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '1px 7px' }}>last run failed</span>}
                    </div>
                    {last
                      ? <div style={{ fontSize: 12, color: last.ok ? 'var(--k-0f766e, #0f766e)' : '#b91c1c' }}>{last.ok ? '✓' : '✗'} {new Date(last.ran_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {last.summary}</div>
                      : <div style={{ fontSize: 12 }}>{j.status === 'waiting' ? 'Waiting for the first real call summary that names a property.' : 'No run recorded yet (it logs itself the next time it runs).'}</div>}
                    {j.realLabel && j.key !== 'tagging-selfcheck' && <div style={{ fontSize: 11.5, color: j.lastReal ? 'var(--k-6b7280, #6b7280)' : '#b45309' }}>{j.lastReal ? `Last real event (${j.realLabel}): ${new Date(j.lastReal.ran_at).toLocaleString('en-US', { month: 'short', day: 'numeric' })}` : `Not seen on a real event yet (${j.realLabel})`}</div>}
                    {j.note && <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af, #9ca3af)' }}>{j.note}</div>}
                  </div>
                );
              })}
              <button onClick={loadPreview} disabled={preview === 'loading'} style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', cursor: 'pointer' }}>{preview === 'loading' ? 'Looking…' : 'Preview today’s alert (sends nothing)'}</button>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--k-374151, #374151)', marginBottom: 3 }}>Test the tagger (nothing is saved)</div>
                <textarea value={testText} onChange={e => setTestText(e.target.value)} placeholder="Paste a note or call summary, e.g. “caller asked about 1222 Chulie Dr”" rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 16, padding: '6px 8px', border: '1px solid var(--k-e5e7eb, #e5e7eb)', borderRadius: 8, fontFamily: 'inherit' }} />
                <button onClick={runTest} disabled={testOut === 'loading' || !testText.trim()} style={{ marginTop: 4, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', cursor: 'pointer' }}>{testOut === 'loading' ? 'Testing…' : 'What would it tag?'}</button>
                {testOut && testOut !== 'loading' && (testOut.length === 0
                  ? <div style={{ marginTop: 4, fontSize: 12.5 }}>No property found in that text.</div>
                  : testOut.map((m, i) => <div key={i} style={{ marginTop: 4, fontSize: 12.5 }}>🏠 <b>{m.listing}</b> <span style={{ color: 'var(--k-9ca3af, #9ca3af)' }}>· via {m.how}</span></div>))}
              </div>
              {preview && preview !== 'loading' && (
                <div style={{ marginTop: 6, fontSize: 12.5 }}>
                  {preview.messages.length === 0 ? 'Nothing to send right now: no new tagged inquiries since the last run.' : preview.messages.map((m, i) => (
                    <div key={i} style={{ background: 'var(--k-f9fafb, #f9fafb)', border: '1px solid #eef0f2', borderRadius: 8, padding: '6px 10px', marginBottom: 5 }}>
                      <div style={{ fontSize: 11.5 }}>To {m.to}</div><div><b>{m.title}</b></div><div>{m.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 6 }}>
          {d.items.map(i => (
            <button key={i.id} onClick={() => onOpenContact?.(i.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'var(--k-fff, #fff)', border: '1px solid #eef0f2', borderRadius: 10, padding: '7px 11px', marginBottom: 5, cursor: onOpenContact ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--k-111, #111)' }}>{i.name}</span> <span style={{ fontSize: 11.5 }}>· {i.source} · {new Date(i.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              {i.snippet && <div style={{ fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.snippet}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
