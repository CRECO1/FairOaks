'use client';
// Calls and texts on a contact's card — the same rows the Calling Log shows,
// narrowed to this person. Calls and voicemails from Talkroute, bot calls,
// and every text thread with them (reply right here).
import React, { useCallback, useEffect, useState } from 'react';

interface CallRow { id: string; source: string; kind: string; direction: string; result: string | null; from_number: string | null; to_number: string | null; started_at: string; duration_sec: number | null; transcript: string | null; summary: string | null; intent: string | null; needs_follow_up: boolean; handled_at: string | null; ai_meta: Record<string, unknown> | null }
interface TextMsg { id: string; conversation_id: string; direction: 'inbound' | 'outbound'; body: string | null; attachments: Array<{ id: string; link?: string; fileType?: string }> | null; sent_at: string; sent_by: string | null }
interface Thread { conversation_id: string; number: string | null; our_number: string | null; last: TextMsg; count: number; unanswered: boolean }

interface Props { clientId: string; authToken?: string; businessUnit: string; showToast?: (m: string) => void; onOpenLog?: () => void }

const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const mini: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif" };
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dur = (s: number | null) => s == null ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
const pretty = (n: string | null) => { const d = String(n ?? '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (n || ''); };

function badge(c: CallRow): { text: string; bg: string; fg: string } {
  const r = c.result ?? '';
  if (c.source === 'voicebot') return { text: 'Bot answered', bg: '#ede9fe', fg: '#6d28d9' };
  if (c.kind === 'voicemail') return { text: 'Voicemail', bg: '#fef3c7', fg: '#92400e' };
  if (r === 'missed') return { text: 'Missed', bg: '#fee2e2', fg: '#b91c1c' };
  if (r === 'hangup') return c.direction !== 'outbound' && (c.duration_sec ?? 99) < 60 ? { text: 'Gave up waiting', bg: '#ffedd5', fg: '#9a3412' } : { text: 'Hung up', bg: '#f3f4f6', fg: '#6b7280' };
  if (r === 'answered') return { text: c.direction === 'outbound' ? 'We called' : 'Answered', bg: '#dcfce7', fg: '#15803d' };
  return { text: c.direction === 'outbound' ? 'We called' : 'Call', bg: '#f3f4f6', fg: '#6b7280' };
}

export default function ContactComms({ clientId, authToken, businessUnit, showToast, onOpenLog }: Props) {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAllCalls, setShowAllCalls] = useState(false);
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, TextMsg[]>>({});
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const h = auth(authToken);
    try {
      const [cj, tj] = await Promise.all([
        fetch(`/api/crm/calls?contact_id=${clientId}&business_unit=${businessUnit}`, { headers: h }).then(r => r.json()),
        fetch(`/api/crm/texts?contact_id=${clientId}&business_unit=${businessUnit}`, { headers: h }).then(r => r.json()),
      ]);
      setCalls(Array.isArray(cj.calls) ? cj.calls : []);
      setThreads(Array.isArray(tj.threads) ? tj.threads : []);
    } catch { /* section just stays empty */ }
    finally { setLoaded(true); }
  }, [authToken, clientId, businessUnit]);
  useEffect(() => { load(); }, [load]);

  async function openT(t: Thread) {
    if (openThread === t.conversation_id) { setOpenThread(null); return; }
    setOpenThread(t.conversation_id);
    if (msgs[t.conversation_id]) return;
    try {
      const j = await fetch(`/api/crm/texts?conversation=${encodeURIComponent(t.conversation_id)}&business_unit=${businessUnit}`, { headers: auth(authToken) }).then(r => r.json());
      setMsgs(m => ({ ...m, [t.conversation_id]: j.messages ?? [] }));
    } catch { /* preview stays */ }
  }
  async function send(t: Thread) {
    const body = (reply[t.conversation_id] || '').trim();
    if (!body) return;
    setBusy(t.conversation_id);
    try {
      const r = await fetch('/api/crm/texts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ conversation_id: t.conversation_id, body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not send'); return; }
      setReply(rp => ({ ...rp, [t.conversation_id]: '' }));
      setMsgs(m => ({ ...m, [t.conversation_id]: [...(m[t.conversation_id] ?? []), j.message] }));
      showToast?.('Text sent ✓'); load();
    } finally { setBusy(null); }
  }
  async function handleCall(c: CallRow) {
    setBusy(c.id);
    try {
      const r = await fetch(`/api/crm/calls?id=${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ handled: true }) });
      if (r.ok) { showToast?.('Marked as handled ✓'); load(); }
    } finally { setBusy(null); }
  }

  if (!loaded) return null;
  if (!calls.length && !threads.length) return null;
  const shownCalls = showAllCalls ? calls : calls.slice(0, 5);

  return (
    <div style={{ marginTop: 14, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>📞 Calls &amp; 💬 Texts</div>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{calls.length} call{calls.length === 1 ? '' : 's'} · {threads.length} text thread{threads.length === 1 ? '' : 's'}</span>
        {onOpenLog && <button onClick={onOpenLog} style={{ fontSize: 12, color: '#a06a12', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Open Calling Log →</button>}
      </div>

      {threads.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {threads.map(t => {
            const open = openThread === t.conversation_id;
            return (
              <div key={t.conversation_id} style={{ background: '#fff', border: `1px solid ${t.unanswered ? '#f3e4c4' : '#eef0f2'}`, borderLeft: `3px solid ${t.unanswered ? '#c9922c' : '#e5e7eb'}`, borderRadius: 10, padding: '9px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => openT(t)}>
                  <span>💬</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: '#6b7280' }}>{when(t.last.sent_at)} · {pretty(t.number)} · {t.count} message{t.count === 1 ? '' : 's'}{t.unanswered && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '1px 6px' }}>Needs reply</span>}</div>
                    {!open && <div style={{ fontSize: 13, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.last.direction === 'outbound' ? '↩ You: ' : ''}{t.last.body || '📎 Attachment'}</div>}
                  </div>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>{open ? '▾' : '▸'}</span>
                </div>
                {open && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto', fontSize: 13 }}>
                      {(msgs[t.conversation_id] ?? []).map(m => (
                        <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'outbound' ? 'flex-end' : 'flex-start' }}>
                          <div style={{ maxWidth: '80%', background: m.direction === 'outbound' ? '#fdf6e9' : '#f3f4f6', borderRadius: 9, padding: '5px 9px' }}>
                            {m.body && <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}
                            {(m.attachments ?? []).map(a => a.link ? <a key={a.id} href={a.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#1d4ed8' }}>📎 attachment</a> : null)}
                            <div style={{ fontSize: 10.5, color: '#9ca3af' }}>{when(m.sent_at)}{m.sent_by ? ` · ${m.sent_by}` : ''}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'flex-end' }}>
                      <textarea value={reply[t.conversation_id] ?? ''} onChange={e => setReply(rp => ({ ...rp, [t.conversation_id]: e.target.value }))} placeholder="Reply by text…"
                        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(t); }}
                        style={{ flex: 1, minHeight: 40, padding: '7px 9px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
                      <button onClick={() => send(t)} disabled={busy === t.conversation_id || !(reply[t.conversation_id] || '').trim()} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }}>Send</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {calls.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shownCalls.map(c => {
            const b = badge(c);
            const pending = c.needs_follow_up && !c.handled_at;
            const open = openCall === c.id;
            const detail = c.summary || c.transcript;
            return (
              <div key={c.id} style={{ background: '#fff', border: `1px solid ${pending ? '#f3e4c4' : '#eef0f2'}`, borderLeft: `3px solid ${pending ? '#c9922c' : '#e5e7eb'}`, borderRadius: 10, padding: '9px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{c.source === 'voicebot' ? '🤖' : c.kind === 'voicemail' ? '📼' : c.direction === 'outbound' ? '📤' : '📞'}</span>
                  <div style={{ flex: 1, minWidth: 0, cursor: detail ? 'pointer' : 'default' }} onClick={() => detail && setOpenCall(open ? null : c.id)}>
                    <div style={{ fontSize: 12.5, color: '#6b7280' }}>
                      {when(c.started_at)}{c.duration_sec ? ` · ${dur(c.duration_sec)}` : ''}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: b.fg, background: b.bg, borderRadius: 6, padding: '1px 6px' }}>{b.text}</span>
                      {c.intent && <span style={{ marginLeft: 6, color: '#a06a12', fontWeight: 600 }}>{c.intent}</span>}
                      {c.ai_meta?.property ? <span style={{ marginLeft: 6, color: '#374151' }}>🏢 {String(c.ai_meta.property)}</span> : null}
                      {c.handled_at && <span style={{ marginLeft: 6, color: '#15803d', fontWeight: 700 }}>✓ handled</span>}
                    </div>
                    {detail && <div style={{ fontSize: 13, color: '#111', marginTop: 2, whiteSpace: open ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{open ? (c.summary ? `${c.summary}${c.transcript ? `\n\n${c.transcript}` : ''}` : c.transcript) : detail}</div>}
                  </div>
                  {pending && <button onClick={() => handleCall(c)} disabled={busy === c.id} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }}>✓ Handled</button>}
                </div>
              </div>
            );
          })}
          {calls.length > 5 && <button onClick={() => setShowAllCalls(v => !v)} style={{ ...mini, alignSelf: 'flex-start', color: '#9ca3af' }}>{showAllCalls ? 'Show fewer' : `Show all ${calls.length} calls`}</button>}
        </div>
      )}
    </div>
  );
}
