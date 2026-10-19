'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getOpenDoc, announceDocUpdated } from '@/lib/open-doc';
import { pruneOld, fitForSend, PENDING_KEEP_MS, STORE_LIMIT_CHARS } from '@/lib/copilot-chat';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES, attachmentInfo, type AttachmentRef } from '@/lib/copilot-attachment-types';

// The in-CRM copilot: a slide-out chat that talks to /api/crm/assistant, which runs a
// Claude tool-use loop over the agent's CRM. Writes are confirmed before they run.
type Block = { type: string; text?: string; name?: string; input?: unknown; copilot_attachment?: AttachmentRef };
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
/** A write the copilot has queued. `id` is the server's signed approval ticket: sending
 *  it back is what authorises that exact call, so it is never inspected here. */
type Pending = { id: string; name: string; summary: string };
/** A UI directive the server asks the browser to apply — currently just navigation. */
type ClientAction = { type: 'navigate'; page: string; tab?: string; label: string } | { type: 'doc-updated'; submissionId: string } | { type: 'refresh'; scope: 'deals' | 'contacts' };

const GOLD = '#c9922c';

// ── The chat log lives for 24 hours ─────────────────────────────────────────────
// Source of truth is the database (/api/crm/assistant/chat), so a conversation follows the
// agent from phone to desktop. localStorage is only a fast first paint and an offline
// fallback. Retention rules (24h, prune at question boundaries) are shared with the server
// in lib/copilot-chat.
// A typed answer to the confirmation card (only used while a card is showing, and only when it is the WHOLE message).
const YES_TYPED = /^\s*(yes|yep|yeah|yup|y|ok|okay|sure|confirm(ed)?|(yes,?\s*)?(please\s*)?(go ahead|do it|confirm(ed)?|proceed|run it|send it|ship it|deploy|merge|approved?)|looks good|sounds good|perfect)\W*$/i;
const NO_TYPED = /^\s*(no|nope|nah|cancel|stop|don'?t|do not|never ?mind|nevermind)\W*$/i;

type Saved = { v: 1; messages: Msg[]; stamps: number[]; pending?: Pending[]; pendingAt?: number; at?: number };
const storeKey = (userId?: string) => `crm-copilot-chat:v1:${userId || 'anon'}`;
function loadSaved(userId?: string): Saved | null {
  try {
    const raw = localStorage.getItem(storeKey(userId));
    if (!raw) return null;
    const j = JSON.parse(raw) as Saved;
    if (j?.v !== 1 || !Array.isArray(j.messages) || !Array.isArray(j.stamps)) return null;
    const { messages, stamps } = pruneOld(j.messages, j.stamps);
    if (!messages.length) { localStorage.removeItem(storeKey(userId)); return null; }
    return { v: 1, messages, stamps, pending: j.pending, pendingAt: j.pendingAt, at: j.at };
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
  // An attachment's own "[Attached file: …]" line is shown as a chip, not as text.
  return content.filter(b => b.type === 'text' && !b.copilot_attachment).map(b => b.text || '').join('\n').trim();
}
function attachmentsOf(content: string | Block[]): AttachmentRef[] {
  if (typeof content === 'string') return [];
  return content.filter(b => b.type === 'text' && b.copilot_attachment).map(b => b.copilot_attachment as AttachmentRef);
}
const kindIcon = (name: string) => { const k = attachmentInfo(name)?.kind; return k === 'image' ? '🖼️' : k === 'pdf' ? '📄' : k === 'xlsx' ? '📊' : k === 'docx' ? '📝' : '📎'; };
const prettySize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** A file the agent is attaching to their next message. */
type Pick = { key: string; name: string; size: number; status: 'uploading' | 'ready' | 'error'; error?: string; ref?: AttachmentRef; preview?: string };
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

export default function AssistantPanel({ token, userId, onClose, onNavigate, onRefresh }: {
  token?: string;
  /** The signed-in agent's id — keys the saved chat so two agents on one browser never share it. */
  userId?: string;
  onClose: () => void;
  /** Applies a navigate directive: switches the CRM page (and sub-tab, where the destination has one). */
  onNavigate?: (page: string, tab?: string) => void;
  /** A confirmed write changed deals or contacts: reload them so the screen matches. */
  onRefresh?: (scope: 'deals' | 'contacts') => void;
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
  const [picks, setPicks] = useState<Pick[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = picks.some(p => p.status === 'uploading');
  const readyRefs = picks.filter(p => p.status === 'ready' && p.ref).map(p => p.ref as AttachmentRef);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, loading]);

  // ── Sync with the database ──────────────────────────────────────────────────
  // Read through a ref: the unmount flush runs a closure from the first render, by which time the token may have rotated.
  const tokenRef = useRef(token); tokenRef.current = token;
  const authHeaders = (json = false): Record<string, string> => ({ ...(json ? { 'Content-Type': 'application/json' } : {}), ...(tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}) });
  const serverReady = useRef(false);          // nothing is written until we have read what is already there
  const serverAt = useRef<string | null>(null); // updated_at of the copy we last read/wrote
  const applyingRemote = useRef(false);       // a change that came FROM the server must not be echoed back

  const latest = useRef<{ messages: Msg[]; stamps: number[]; pending: Pending[]; pendingAt: number }>({ messages: [], stamps: [], pending: [], pendingAt: 0 });
  const dirty = useRef(false);   // local changes the database has not seen yet
  async function putServer(keepalive = false) {
    const l = latest.current;
    if (!l.messages.length) return;
    try {
      const r = await fetch('/api/crm/assistant/chat', {
        method: 'PUT', headers: authHeaders(true), keepalive,
        body: JSON.stringify({ messages: l.messages, stamps: l.stamps, pending: l.pending, pendingAt: l.pending.length ? l.pendingAt : null }),
      });
      if (r.ok) { dirty.current = false; const j = await r.json(); if (j.updatedAt) serverAt.current = j.updatedAt; }
    } catch { /* the local copy still has it; the next open pushes it */ }
  }

  async function pullServer(initial = false) {
    try {
      const r = await fetch('/api/crm/assistant/chat', { headers: authHeaders() });
      if (!r.ok) return;
      const j = await r.json() as { messages: Msg[]; stamps: number[]; pending: Pending[]; pendingAt?: number | null; updatedAt: string | null };
      const localAt = restoredAtRef.current;
      const remoteNewer = !!j.updatedAt && (initial ? (!messagesRef.current.length || Date.parse(j.updatedAt) > localAt) : j.updatedAt !== serverAt.current && Date.parse(j.updatedAt) > localAt);
      let applied = false;
      if (j.messages.length && remoteNewer && !loadingRef.current) {
        applyingRemote.current = true; applied = true;
        pendingAtRef.current = Number(j.pendingAt) || 0;
        setMessages(j.messages); setStamps(j.stamps); setPending(j.pending ?? []);
      }
      serverAt.current = j.updatedAt;
      // This browser holds a newer copy than the database (an earlier save never landed): push it up.
      if (initial && !applied && messagesRef.current.length && (!j.updatedAt || localAt > Date.parse(j.updatedAt))) {
        latest.current = { messages: messagesRef.current, stamps: stampsRef.current, pending: pendingRef.current, pendingAt: pendingAtRef.current };
        await putServer();
      }
    } catch { /* offline: the local copy stands */ }
    finally { if (initial) serverReady.current = true; }
  }
  const messagesRef = useRef<Msg[]>(messages); messagesRef.current = messages;
  const stampsRef = useRef<number[]>(stamps); stampsRef.current = stamps;
  const pendingRef = useRef<Pending[]>(pending); pendingRef.current = pending;
  const loadingRef = useRef(false); loadingRef.current = loading;
  const restoredAtRef = useRef<number>(restored.current?.at ?? 0);
  useEffect(() => { pullServer(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Picking the conversation back up on another device: refresh when this tab regains focus.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') pullServer(false); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save the log whenever it changes: instantly to this browser, a moment later to the database.
  useEffect(() => {
    const at = Date.now();
    try {
      if (!messages.length) { localStorage.removeItem(storeKey(userId)); }
      else {
        let m = messages, st = stamps;
        const full = JSON.stringify({ v: 1, messages: m, stamps: st, pending: pending.length ? pending : undefined, pendingAt: pending.length ? pendingAtRef.current : undefined, at } satisfies Saved);
        if (full.length > STORE_LIMIT_CHARS) { const fit = fitForSend(m); st = st.slice(m.length - fit.length); m = fit; }
        localStorage.setItem(storeKey(userId), JSON.stringify({ v: 1, messages: m, stamps: st, pending: pending.length ? pending : undefined, pendingAt: pending.length ? pendingAtRef.current : undefined, at } satisfies Saved));
        restoredAtRef.current = at;
      }
    } catch { /* history is a convenience, never a failure */ }
    if (applyingRemote.current) { applyingRemote.current = false; return; }
    if (!serverReady.current || !messages.length) return;
    latest.current = { messages, stamps, pending, pendingAt: pendingAtRef.current };
    dirty.current = true;
    const t = setTimeout(() => { putServer(); }, 900);
    return () => clearTimeout(t);
  }, [messages, stamps, pending, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Closing the panel inside the debounce window must not lose the last exchange.
  useEffect(() => () => { if (dirty.current && serverReady.current) putServer(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Attachments: straight to private storage, then a small reference rides along with the message ──
  function dropPreview(p: Pick) { if (p.preview) { try { URL.revokeObjectURL(p.preview); } catch { /* ignore */ } } }
  function removePick(key: string) { setPicks(prev => { prev.filter(p => p.key === key).forEach(dropPreview); return prev.filter(p => p.key !== key); }); }
  async function uploadOne(file: File, key: string) {
    const patch = (u: Partial<Pick>) => setPicks(prev => prev.map(p => p.key === key ? { ...p, ...u } : p));
    try {
      const pre = await fetch('/api/crm/assistant/attachments', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ filename: file.name, size: file.size }) });
      const pj = await pre.json().catch(() => ({}));
      if (!pre.ok) { patch({ status: 'error', error: pj.error || `Couldn't start the upload (${pre.status})` }); return; }
      const put = await fetch(pj.uploadUrl, { method: 'PUT', headers: { 'Content-Type': pj.type || file.type || 'application/octet-stream' }, body: file });
      if (!put.ok) { patch({ status: 'error', error: `Upload failed (${put.status})` }); return; }
      patch({ status: 'ready', ref: { id: pj.id, path: pj.path, name: file.name, type: pj.type, size: file.size } });
    } catch { patch({ status: 'error', error: 'Upload failed — check your connection' }); }
  }
  function addFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);
    const room = ATTACHMENT_MAX_FILES - picks.length;
    if (room <= 0) { setError(`You can attach up to ${ATTACHMENT_MAX_FILES} files per message.`); return; }
    const added: Pick[] = [];
    for (const f of files.slice(0, room)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!attachmentInfo(f.name)) { setError(`I can read photos, PDFs, Word (.docx), Excel (.xlsx), CSV and text files — not “${f.name}”.`); continue; }
      if (f.size > ATTACHMENT_MAX_BYTES) { setError(`${f.name} is over the ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB limit.`); continue; }
      added.push({ key, name: f.name, size: f.size, status: 'uploading', preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined });
      void uploadOne(f, key);
    }
    if (files.length > room) setError(`You can attach up to ${ATTACHMENT_MAX_FILES} files per message — added the first ${room}.`);
    if (added.length) setPicks(prev => [...prev, ...added]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function newChat() {
    if (loading) return;
    setPicks(prev => { prev.forEach(dropPreview); return []; });
    setMessages([]); setStamps([]); setPending([]); setError(null);
    try { localStorage.removeItem(storeKey(userId)); } catch { /* ignore */ }
    fetch('/api/crm/assistant/chat', { method: 'DELETE', headers: authHeaders() }).then(() => { serverAt.current = null; }).catch(() => { /* ignore */ });
  }

  /**
   * One turn. `confirm` carries the approval tickets for writes the agent just okayed —
   * the server replays those exact calls rather than asking the model to produce them
   * again, so what runs is what was shown on the confirmation card.
   */
  async function send(text: string, confirmTickets: string[] = []) {
    // The confirmation card is showing and the agent TYPED their answer instead of clicking: "yes", "confirmed", "go ahead"
    // is the click, "no"/"cancel" is the Cancel button. (Typing used to wipe the card, so a typed "yes" confirmed nothing —
    // and the model then claimed the action had run.)
    if (!confirmTickets.length && !readyRefs.length && pending.length && !loading) {
      if (YES_TYPED.test(text)) return send('', pending.map(p => p.id));
      if (NO_TYPED.test(text)) { setInput(''); setPending([]); return send('Actually, don’t do that.'); }
    }
    const confirming = confirmTickets.length > 0;
    const files = confirming ? [] : readyRefs;
    if ((!text.trim() && !files.length && !confirming) || loading || (!confirming && uploading)) return;
    setError(null); setPending([]);
    // A message with files carries them as small references (the bytes are already in storage); the server
    // turns them back into real content for the model. The reference block's own text is just a label.
    const content: string | Block[] = files.length
      ? [{ type: 'text', text: text.trim() || (files.length === 1 ? 'Please take a look at the attached file.' : 'Please take a look at the attached files.') },
         ...files.map(r => ({ type: 'text', text: `[Attached file: ${r.name}]`, copilot_attachment: r }) as Block)]
      : text;
    // Confirming adds no new question — the conversation carries on from where it was.
    const next: Msg[] = confirming ? messages : [...messages, { role: 'user', content }];
    const prevStamps = confirming ? stamps : [...stamps, Date.now()];
    setMessages(next); setStamps(prevStamps); if (!confirming) { setInput(''); setPicks(prev => { prev.forEach(dropPreview); return []; }); } setLoading(true);
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
          else if (a.type === 'refresh') onRefresh?.(a.scope);
        }
      }
    } catch { setError('Network error — try again.'); setMessages(messages); setStamps(stamps); }
    finally { setLoading(false); }
  }

  // Render each turn: user text, assistant text, and a subtle line of what tools ran.
  const bubbles = messages.map((m, i) => {
    const txt = textOf(m.content);
    const tools = toolsOf(m.content);
    const atts = attachmentsOf(m.content);
    if (!txt && tools.length === 0 && atts.length === 0) return null; // tool_result turns
    return (
      <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
        <div style={{ maxWidth: '86%' }}>
          {tools.length > 0 && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>🔧 {tools.map(t => TOOL_LABEL[t] || t).join(' · ')}</div>
          )}
          {atts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', marginBottom: txt ? 5 : 0 }}>
              {atts.map(a => (
                <span key={a.id} title={a.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', border: '1px solid #e5e7eb', color: '#374151', borderRadius: 8, padding: '4px 9px', fontSize: 12.5, maxWidth: '100%' }}>
                  <span aria-hidden>{kindIcon(a.name)}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>{a.name}</span>
                </span>
              ))}
            </div>
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
    <div
      onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); } }}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(430px, 100vw)', background: '#f7f7f5', boxShadow: '-8px 0 30px rgba(0,0,0,.14)', zIndex: 1200, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans',sans-serif" }}>
      {dragging && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(201,146,44,.12)', border: `3px dashed ${GOLD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: '#92400e', fontWeight: 700, fontSize: 16 }}>Drop files to attach</div>
      )}
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(14px + env(safe-area-inset-top)) 16px 14px', background: '#1a1a1a', color: '#fff', flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>✨</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>CRECO Copilot</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>{messages.length ? 'Chat syncs across your devices · kept 24 hours' : 'Your CRM assistant'}</div>
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

      {/* Files waiting to go with the next message */}
      {picks.length > 0 && (
        <div style={{ padding: '8px 12px 0', background: '#fff', borderTop: '1px solid #e5e7eb', display: 'flex', flexWrap: 'wrap', gap: 6, flexShrink: 0 }}>
          {picks.map(p => (
            <span key={p.key} title={p.error || p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${p.status === 'error' ? '#fecaca' : '#e5e7eb'}`, background: p.status === 'error' ? '#fef2f2' : '#f9fafb', borderRadius: 8, padding: '3px 4px 3px 7px', fontSize: 12.5, color: p.status === 'error' ? '#b91c1c' : '#374151', maxWidth: '100%' }}>
              {p.preview ? <img src={p.preview} alt="" style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 4 }} /> : <span aria-hidden>{kindIcon(p.name)}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{p.name}</span>
              <span style={{ color: '#9ca3af', fontSize: 11.5 }}>{p.status === 'uploading' ? 'uploading…' : p.status === 'error' ? 'failed' : prettySize(p.size)}</span>
              <button onClick={() => removePick(p.key)} aria-label={`Remove ${p.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, lineHeight: 1, padding: '2px 5px', minWidth: 24, minHeight: 24 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '12px 12px calc(12px + env(safe-area-inset-bottom))', borderTop: picks.length ? 'none' : '1px solid #e5e7eb', background: '#fff', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <input ref={fileInputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={e => addFiles(e.target.files)} style={{ display: 'none' }} aria-hidden tabIndex={-1} />
        <button onClick={() => fileInputRef.current?.click()} disabled={loading || picks.length >= ATTACHMENT_MAX_FILES} aria-label="Attach a file or photo" title="Attach a photo, PDF, Word, Excel or CSV"
          style={{ background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 10, width: 44, height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: loading || picks.length >= ATTACHMENT_MAX_FILES ? 'default' : 'pointer', fontSize: 19, opacity: picks.length >= ATTACHMENT_MAX_FILES ? 0.5 : 1 }}>📎</button>
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={1} placeholder={picks.length ? 'Say what to do with the file…' : 'Ask or tell me to do something…'}
          onPaste={e => { const fs = Array.from(e.clipboardData?.files ?? []); if (fs.length) { e.preventDefault(); addFiles(fs); } }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          style={{ flex: 1, resize: 'none', border: '1px solid #e5e7eb', borderRadius: 10, padding: '11px 12px', fontSize: 16, fontFamily: 'inherit', outline: 'none', minHeight: 44, maxHeight: 120, boxSizing: 'border-box' }} />
        <button onClick={() => send(input)} disabled={loading || uploading || (!input.trim() && readyRefs.length === 0)} aria-label="Send" style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 10, width: 44, height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, cursor: loading || !input.trim() ? 'default' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1, fontSize: 18 }}>↑</button>
      </div>
    </div>
  );
}
