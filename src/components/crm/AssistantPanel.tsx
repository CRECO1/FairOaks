'use client';

import React, { useEffect, useRef, useState } from 'react';

// The in-CRM copilot: a slide-out chat that talks to /api/crm/assistant, which runs a
// Claude tool-use loop over the agent's CRM. Writes are confirmed before they run.
type Block = { type: string; text?: string; name?: string; input?: unknown };
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
type Pending = { name: string; summary: string };

const GOLD = '#c9922c';

const SUGGESTIONS = [
  'What tasks do I have open?',
  'Show my deals in the LOI stage',
  'Create a task to follow up with…',
  'Add a note to a contact',
];

function textOf(content: string | Block[]): string {
  if (typeof content === 'string') return content;
  return content.filter(b => b.type === 'text').map(b => b.text || '').join('\n').trim();
}
function toolsOf(content: string | Block[]): string[] {
  if (typeof content === 'string') return [];
  return content.filter(b => b.type === 'tool_use').map(b => b.name || 'tool');
}
const TOOL_LABEL: Record<string, string> = {
  search_contacts: 'searched contacts', get_contact: 'looked up a contact', list_tasks: 'checked tasks',
  list_deals: 'checked deals', get_deal: 'looked up a deal', create_task: 'created a task',
  complete_task: 'completed a task', add_note: 'added a note', update_deal_stage: 'moved a deal',
  find_property: 'found a property', list_forms: 'listed forms', draft_lease: 'drafted a lease',
  generate_lease: 'generated the lease', start_form: 'started a form', send_for_signature: 'sent for e-signature',
};

export default function AssistantPanel({ token, onClose }: { token?: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, loading]);

  async function send(text: string, allowWrites = false) {
    if (!text.trim() || loading) return;
    setError(null); setPending([]);
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next); setInput(''); setLoading(true);
    try {
      const res = await fetch('/api/crm/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages: next, allowWrites }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || 'Something went wrong.'); setMessages(messages); }
      else { setMessages(j.messages); setPending(j.pendingWrites || []); }
    } catch { setError('Network error — try again.'); setMessages(messages); }
    finally { setLoading(false); }
  }

  // Render each turn: user text, assistant text, and a subtle line of what tools ran.
  const bubbles = messages.map((m, i) => {
    const txt = textOf(m.content);
    const tools = toolsOf(m.content);
    if (!txt && tools.length === 0) return null; // tool_result turns
    return (
      <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
        <div style={{ maxWidth: '86%' }}>
          {tools.length > 0 && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>🔧 {tools.map(t => TOOL_LABEL[t] || t).join(' · ')}</div>
          )}
          {txt && (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55, padding: '9px 13px', borderRadius: 12,
              background: m.role === 'user' ? GOLD : '#fff', color: m.role === 'user' ? '#fff' : '#1f2937',
              border: m.role === 'user' ? 'none' : '1px solid #e5e7eb', borderBottomRightRadius: m.role === 'user' ? 3 : 12, borderBottomLeftRadius: m.role === 'user' ? 12 : 3 }}>{txt}</div>
          )}
        </div>
      </div>
    );
  });

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(430px, 100vw)', background: '#f7f7f5', boxShadow: '-8px 0 30px rgba(0,0,0,.14)', zIndex: 1200, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans',sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#1a1a1a', color: '#fff', flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>✨</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>CRECO Copilot</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>Your CRM assistant</div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15 }}>✕</button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {messages.length === 0 && (
          <div style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}>Hi — I can look things up and take actions in your CRM. Try:</p>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(s)} style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '9px 12px', marginBottom: 8, cursor: 'pointer', fontSize: 13.5, color: '#374151', fontFamily: 'inherit' }}>{s}</button>
            ))}
          </div>
        )}
        {bubbles}
        {loading && <div style={{ fontSize: 13, color: '#9ca3af', padding: '4px 2px' }}>Thinking…</div>}
        {error && <div style={{ fontSize: 13, color: '#dc2626', padding: '4px 2px' }}>{error}</div>}
      </div>

      {/* Pending confirmation */}
      {pending.length > 0 && !loading && (
        <div style={{ padding: '12px 16px', background: '#fffbeb', borderTop: '1px solid #fde68a', flexShrink: 0 }}>
          <div style={{ fontSize: 13, color: '#92400e', fontWeight: 600, marginBottom: 8 }}>Confirm to run:</div>
          {pending.map((p, i) => <div key={i} style={{ fontSize: 13, color: '#78350f', marginBottom: 6 }}>• {p.summary}</div>)}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => send('Yes, go ahead.', true)} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Confirm &amp; run</button>
            <button onClick={() => { setPending([]); send('Actually, don’t do that.'); }} style={{ background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', background: '#fff', flexShrink: 0, display: 'flex', gap: 8 }}>
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={1} placeholder="Ask or tell me to do something…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          style={{ flex: 1, resize: 'none', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', maxHeight: 120 }} />
        <button onClick={() => send(input)} disabled={loading || !input.trim()} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 10, padding: '0 16px', fontWeight: 700, cursor: loading || !input.trim() ? 'default' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1, fontSize: 14 }}>↑</button>
      </div>
    </div>
  );
}
