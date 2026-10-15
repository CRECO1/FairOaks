'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getOpenDoc, announceDocUpdated } from '@/lib/open-doc';

// The in-CRM copilot: a slide-out chat that talks to /api/crm/assistant, which runs a
// Claude tool-use loop over the agent's CRM. Writes are confirmed before they run.
type Block = { type: string; text?: string; name?: string; input?: unknown };
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
/** A write the copilot has queued. `id` is the server's signed approval ticket: sending
 *  it back is what authorises that exact call, so it is never inspected here. */
type Pending = { id: string; name: string; summary: string };
/** A UI directive the server asks the browser to apply — currently just navigation. */
type ClientAction = { type: 'navigate'; page: string; tab?: string; label: string } | { type: 'doc-updated'; submissionId: string };

const GOLD = '#c9922c';

// ── The chat log lives for 24 hours ─────────────────────────────────────────────
// The panel unmounts when it is closed and the page can refresh, so the conversation is
// kept in localStorage per agent. Each message carries the time it was written; on load
// anything older than 24h is dropped — but only at a boundary where a new question starts,
// so a tool call is never separated from its result (the API rejects that).
const KEEP_MS = 24 * 60 * 60 * 1000;
const PENDING_KEEP_MS = 25 * 60 * 1000;     // approval tickets are valid for 30 minutes server-side
const MAX_SAVED_CHARS = 450_000;            // keep localStorage writes small and fast
const SEND_LIMIT_CHARS = 100_000;           // the server refuses > 120k chars or > 150 messages
const SEND_LIMIT_MSGS = 120;
type Saved = { v: 1; messages: Msg[]; stamps: number[]; pending?: Pending[]; pendingAt?: number };
const storeKey = (userId?: string) => `crm-copilot-chat:v1:${userId || 'anon'}`;

// A plain user question (not a tool_result) — the safe place to start a conversation from.
function startsQuestion(m: Msg): boolean {
  if (m.role !== 'user') return false;
  if (typeof m.content === 'string') return true;
  return m.content.some(b => b.type === 'text') && !m.content.some(b => b.type === 'tool_result');
}
function pruneOld(messages: Msg[], stamps: number[], now = Date.now()): { messages: Msg[]; stamps: number[] } {
  const cut = now - KEEP_MS;
  let from = 0;
  while (from < messages.length && (stamps[from] ?? now) < cut) from++;
  if (from === 0) return { messages, stamps };
  // Advance to the next question so no tool_use / tool_result pair is split.
  while (from < messages.length && !startsQuestion(messages[from])) from++;
  return { messages: messages.slice(from), stamps: stamps.slice(from) };
}
// Drop the oldest whole exchanges until what we send is within the server's limits.
function fitForSend(messages: Msg[]): Msg[] {
  let out = messages;
  while (out.length > 1 && (out.length > SEND_LIMIT_MSGS || JSON.stringify(out).length > SEND_LIMIT_CHARS)) {
    let i = 1;
    while (i < out.length && !startsQuestion(out[i])) i++;
    if (i >= out.length) break;
    out = out.slice(i);
  }
  return out;
}
function loadSaved(userId?: string): Saved | null {
  try {
    const raw = localStorage.getItem(storeKey(userId));
    if (!raw) return null;
    const j = JSON.parse(raw) as Saved;
    if (j?.v !== 1 || !Array.isArray(j.messages) || !Array.isArray(j.stamps)) return null;
    const { messages, stamps } = pruneOld(j.messages, j.stamps);
    if (!messages.length) { localStorage.removeItem(storeKey(userId)); return null; }
    return { v: 1, messages, stamps, pending: j.pending, pendingAt: j.pendingAt };
  } catch { return null; }
}

const SUGGESTIONS = [
  'What tasks do I have open?',
  'Show my deals in the LOI stage',
  'Create a task to follow up with…',
  'Add a new contact to the CRM',
  'Fill this contract in from a contact',
  'Look up a property or business online',
];

// Web answers carry source links; make them tappable. Only http(s) — anything else in
// the model's text stays plain text, never an href.
const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;
function linkify(text: string): React.ReactNode[] {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part;
    const url = part.replace(/[.,;:!?]+$/, '');
    const tail = part.slice(url.length);
    return <React.Fragment key={i}><a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' }}>{url}</a>{tail}</React.Fragment>;
  });
}

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
  open_page: 'opened a section',
  complete_task: 'completed a task', add_note: 'added a note', update_deal_stage: 'moved a deal',
  find_property: 'found a property', list_properties: 'checked properties', get_property: 'looked up a property',
  list_forms: 'listed forms', draft_lease: 'drafted a lease', autofill_loi: 'pre-filled a letter of intent', complete_loi: 'completed a letter of intent',
  generate_lease: 'generated the lease', start_form: 'started a form', send_for_signature: 'sent for e-signature',
  send_email: 'sent an email', schedule_event: 'scheduled an event',
  create_contact: 'added a contact', update_contact: 'updated a contact', create_property: 'added a property',
  read_document: 'read a document', fill_document: 'filled in a document', edit_loi: 'edited a letter of intent', draft_campaign: 'drafted a campaign',
};

export default function AssistantPanel({ token, userId, onClose, onNavigate }: {
  token?: string;
  /** The signed-in agent's id — keys the saved chat so two agents on one browser never share it. */
  userId?: string;
  onClose: () => void;
  /** Applies a navigate directive: switches the CRM page (and sub-tab, where the destination has one). */
  onNavigate?: (page: string, tab?: string) => void;
}) {
  // Restored synchronously on first render so the log is already there when the panel opens.
  const restored = useRef<Saved | null | undefined>(undefined);
  if (restored.current === undefined) restored.current = typeof window === 'undefined' ? null : loadSaved(userId);
  const [messages, setMessages] = useState<Msg[]>(restored.current?.messages ?? []);
  const [stamps, setStamps] = useState<number[]>(restored.current?.stamps ?? []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Pending[]>(() => {
    const r = restored.current;
    return r?.pending?.length && r.pendingAt && Date.now() - r.pendingAt < PENDING_KEEP_MS ? r.pending : [];
  });
  const pendingAtRef = useRef<number>(restored.current?.pendingAt ?? 0);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, loading]);

  // Save the log whenever it changes. Never throws: private windows / full storage just mean no history.
  useEffect(() => {
    try {
      if (!messages.length) { localStorage.removeItem(storeKey(userId)); return; }
      const body: Saved = { v: 1, messages, stamps, pending: pending.length ? pending : undefined, pendingAt: pending.length ? pendingAtRef.current : undefined };
      const text = JSON.stringify(body);
      if (text.length <= MAX_SAVED_CHARS) localStorage.setItem(storeKey(userId), text);
      else {
        // Too big to keep whole: keep the most recent exchanges.
        const fit = fitForSend(messages);
        const skip = messages.length - fit.length;
        localStorage.setItem(storeKey(userId), JSON.stringify({ v: 1, messages: fit, stamps: stamps.slice(skip) } satisfies Saved));
      }
    } catch { /* history is a convenience, never a failure */ }
  }, [messages, stamps, pending, userId]);

  function newChat() {
    if (loading) return;
    setMessages([]); setStamps([]); setPending([]); setError(null);
    try { localStorage.removeItem(storeKey(userId)); } catch { /* ignore */ }
  }

  /**
   * One turn. `confirm` carries the approval tickets for writes the agent just okayed —
   * the server replays those exact calls rather than asking the model to produce them
   * again, so what runs is what was shown on the confirmation card.
   */
  async function send(text: string, confirmTickets: string[] = []) {
    const confirming = confirmTickets.length > 0;
    if ((!text.trim() && !confirming) || loading) return;
    setError(null); setPending([]);
    // Confirming adds no new question — the conversation carries on from where it was.
    const next: Msg[] = confirming ? messages : [...messages, { role: 'user', content: text }];
    const prevStamps = confirming ? stamps : [...stamps, Date.now()];
    setMessages(next); setStamps(prevStamps); if (!confirming) setInput(''); setLoading(true);
    try {
      const res = await fetch('/api/crm/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        // The saved log can outgrow what the server accepts in one request; send the recent tail.
        body: JSON.stringify({ messages: fitForSend(next), ...(confirming ? { confirm: confirmTickets } : {}), openDoc: getOpenDoc() }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || 'Something went wrong.'); setMessages(messages); setStamps(stamps); }
      else {
        const nowMs = Date.now();
        const got = j.messages as Msg[];
        setMessages(got);
        // Messages that were already in the log keep their time; new ones get now.
        setStamps(got.map((_, i) => prevStamps[i] ?? nowMs));
        pendingAtRef.current = nowMs;
        setPending(j.pendingWrites || []);
        // Apply any UI directives the server returned. Navigation runs after the
        // reply is in state so the agent sees what was said as the screen changes.
        for (const a of (j.clientActions ?? []) as ClientAction[]) {
          if (a.type === 'navigate') onNavigate?.(a.page, a.tab);
          // The Copilot just edited a document: any editor showing it reloads, live.
          else if (a.type === 'doc-updated') announceDocUpdated(a.submissionId);
        }
      }
    } catch { setError('Network error — try again.'); setMessages(messages); setStamps(stamps); }
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
              border: m.role === 'user' ? 'none' : '1px solid #e5e7eb', borderBottomRightRadius: m.role === 'user' ? 3 : 12, borderBottomLeftRadius: m.role === 'user' ? 12 : 3 }}>{m.role === 'assistant' ? linkify(txt) : txt}</div>
          )}
        </div>
      </div>
    );
  });

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(430px, 100vw)', background: '#f7f7f5', boxShadow: '-8px 0 30px rgba(0,0,0,.14)', zIndex: 1200, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans',sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(14px + env(safe-area-inset-top)) 16px 14px', background: '#1a1a1a', color: '#fff', flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>✨</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>CRECO Copilot</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>{messages.length ? 'Chat is kept for 24 hours' : 'Your CRM assistant'}</div>
        </div>
        {messages.length > 0 && (
          <button onClick={newChat} disabled={loading} title="Clear this conversation and start fresh" style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, padding: '0 10px', height: 36, flexShrink: 0, cursor: loading ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, opacity: loading ? 0.5 : 1, fontFamily: 'inherit' }}>New chat</button>
        )}
        <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
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
          {pending.map((p, i) => <div key={i} style={{ fontSize: 13, color: '#78350f', marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>• {p.summary}</div>)}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => send('', pending.map(p => p.id))} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '11px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Confirm &amp; run</button>
            <button onClick={() => { setPending([]); send('Actually, don’t do that.'); }} style={{ background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 18px', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '12px 12px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid #e5e7eb', background: '#fff', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={1} placeholder="Ask or tell me to do something…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          style={{ flex: 1, resize: 'none', border: '1px solid #e5e7eb', borderRadius: 10, padding: '11px 12px', fontSize: 16, fontFamily: 'inherit', outline: 'none', minHeight: 44, maxHeight: 120, boxSizing: 'border-box' }} />
        <button onClick={() => send(input)} disabled={loading || !input.trim()} aria-label="Send" style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 10, width: 44, height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, cursor: loading || !input.trim() ? 'default' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1, fontSize: 18 }}>↑</button>
      </div>
    </div>
  );
}
