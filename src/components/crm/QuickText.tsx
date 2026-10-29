'use client';
// Text a person from a task, a call or a deal — through the office line's Talkroute thread with them.
// Nothing is sent until someone presses Send. Talkroute's API can only reply inside a thread that already exists
// (a brand-new number is refused: "Bulk messaging is not enabled"), so with no thread we hand over the message
// to copy into the Talkroute app instead; once they reply, the thread exists and this box sends directly.
import React, { useCallback, useEffect, useState } from 'react';

interface Thread { conversation_id: string; number: string | null; our_number: string | null; last: { body: string | null; direction: 'inbound' | 'outbound'; sent_at: string } }
export interface QuickTextTemplate { label: string; body: string }
interface Props {
  authToken?: string; businessUnit: string; contactId?: string | null; phone: string | null; name?: string;
  templates?: QuickTextTemplate[]; showToast?: (m: string) => void; onSent?: (body: string) => void;
}

const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const last10 = (n: string | null | undefined) => String(n ?? '').replace(/\D/g, '').slice(-10);
const pretty = (n: string | null | undefined) => { const d = last10(n); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (n || ''); };
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const chip: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: 'var(--k-374151)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 16, padding: '6px 12px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", minHeight: 32 };

export default function QuickText({ authToken, businessUnit, contactId, phone, name, templates = [], showToast, onSent }: Props) {
  const tail = last10(phone);
  const [thread, setThread] = useState<Thread | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoaded(false);
    if (tail.length !== 10) { setThread(null); setLoaded(true); return; }
    try {
      const qs = contactId ? `contact_id=${encodeURIComponent(contactId)}` : `q=${tail}&days=365`;
      const j = await fetch(`/api/crm/texts?${qs}&business_unit=${businessUnit}`, { headers: auth(authToken) }).then(r => r.json());
      const list: Thread[] = Array.isArray(j.threads) ? j.threads : [];
      setThread(list.find(t => last10(t.number) === tail) ?? null);   // newest first
    } catch { setThread(null); }
    finally { setLoaded(true); }
  }, [authToken, businessUnit, contactId, tail]);
  useEffect(() => { load(); }, [load]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); showToast?.(`${what} copied ✓`); }
    catch { showToast?.('Could not copy — select the text and copy it'); }
  };

  async function send() {
    const text = body.trim();
    if (!text || !thread) return;
    setBusy(true);
    try {
      const r = await fetch('/api/crm/texts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ conversation_id: thread.conversation_id, body: text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not send'); return; }
      setSentNote(`Sent ${when(new Date().toISOString())}`);
      setBody(''); showToast?.('Text sent ✓'); onSent?.(text); load();
    } finally { setBusy(false); }
  }

  if (tail.length !== 10) return <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', fontStyle: 'italic', padding: '6px 0' }}>No phone number on file to text.</div>;
  if (!loaded) return <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', padding: '6px 0' }}>Checking for a text thread…</div>;

  return (
    <div style={{ background: 'var(--k-f8fafc)', border: '1px solid var(--k-e5e9ef)', borderRadius: 12, padding: '12px 14px', marginBottom: 12, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: 'var(--k-475569)', marginBottom: 6 }}>
        💬 Text {name ? name.split(' ')[0] : pretty(phone)} · from the office line{thread?.our_number ? ` ${pretty(thread.our_number)}` : ''}
      </div>
      {thread?.last && (
        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 8, lineHeight: 1.4 }}>
          Last message · {when(thread.last.sent_at)} · {thread.last.direction === 'inbound' ? 'them' : 'us'}: <span style={{ color: 'var(--k-374151)' }}>{(thread.last.body || '📎 attachment').slice(0, 140)}</span>
        </div>
      )}
      {templates.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {templates.filter(t => t.body).map(t => <button key={t.label} type="button" style={chip} onClick={() => { setBody(t.body); setSentNote(null); }}>{t.label}</button>)}
        </div>
      )}
      <textarea value={body} onChange={e => { setBody(e.target.value); setSentNote(null); }} placeholder="Type your text…" rows={3} maxLength={1600}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 16, padding: '8px 10px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontFamily: "'DM Sans',sans-serif", resize: 'vertical' }} />
      {thread ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={send} disabled={busy || !body.trim()}
            style={{ minHeight: 44, padding: '0 20px', borderRadius: 8, border: 'none', background: body.trim() ? '#c9922c' : 'var(--k-e5e7eb)', color: 'var(--k-111)', fontWeight: 800, fontSize: 14, cursor: body.trim() && !busy ? 'pointer' : 'default' }}>
            {busy ? 'Sending…' : `Send to ${pretty(phone)}`}
          </button>
          <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{sentNote ?? 'Goes out only when you press Send.'}</span>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => copy(body.trim(), 'Message')} disabled={!body.trim()}
              style={{ minHeight: 44, padding: '0 16px', borderRadius: 8, border: 'none', background: body.trim() ? '#c9922c' : 'var(--k-e5e7eb)', color: 'var(--k-111)', fontWeight: 800, fontSize: 14, cursor: body.trim() ? 'pointer' : 'default' }}>Copy message</button>
            <button type="button" onClick={() => copy(pretty(phone), 'Number')}
              style={{ minHeight: 44, padding: '0 16px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Copy {pretty(phone)}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 6, lineHeight: 1.45 }}>
            No text thread with this number yet, and Talkroute only lets its own app start one. Paste this into a new text in the Talkroute app, sent from the office line. Once they reply, this box sends directly.
          </div>
        </div>
      )}
    </div>
  );
}
