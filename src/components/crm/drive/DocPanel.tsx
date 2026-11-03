'use client';

/**
 * The side panels of a live document: Comments (anchored to the words, @mentions, replies, resolve) and Version history
 * (automatic + named snapshots, preview, restore). Desktop: a 360px column beside the page. Phone: a bottom sheet.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { fromBase64 } from 'lib0/buffer';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { findCommentRange, removeCommentMark } from '@/lib/collab/comment-mark';
import { docExtensions } from './doc-extensions';
import type { DriveComment, DriveVersion } from '@/lib/drive-types';
import type { DrivePerson } from './DocsDrive';

const GOLD = '#c9922c';

function fmtWhen(iso: string) {
  const d = new Date(iso); const now = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${t}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })}, ${t}`;
}
const fullName = (p?: DrivePerson | null) => (p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : '');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Common {
  docId: string;
  authToken?: string;
  me: { id: string; name: string };
  people: DrivePerson[];
  isMobile: boolean;
  onClose: () => void;
  onToast: (m: string) => void;
}

function useApi(authToken?: string) {
  return useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(init?.headers ?? {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error || 'Something went wrong');
    return j as T;
  }, [authToken]);
}

/** The panel chrome: a column on desktop, a bottom sheet on phones. */
function Shell({ title, isMobile, onClose, children }: { title: string; isMobile: boolean; onClose: () => void; children: React.ReactNode }) {
  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--k-eef0f2)', flexShrink: 0 }}>
      <div style={{ flex: 1, fontSize: 15.5, fontWeight: 700, color: 'var(--k-1a1a1a)' }}>{title}</div>
      <button type="button" onClick={onClose} aria-label={`Close ${title}`} style={{ width: isMobile ? 40 : 30, height: isMobile ? 40 : 30, border: 'none', borderRadius: 8, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontSize: 16, cursor: 'pointer' }}>✕</button>
    </div>
  );
  if (isMobile) {
    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1150, background: 'rgba(17,17,17,.4)', display: 'flex', alignItems: 'flex-end' }}>
        <div onClick={e => e.stopPropagation()} style={{ width: '100%', height: '78dvh', background: 'var(--k-fff)', borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {head}<div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 76 }}>{children}</div>
        </div>
      </div>
    );
  }
  return (
    <aside aria-label={title} style={{ width: 360, flexShrink: 0, background: 'var(--k-fff)', borderLeft: '1px solid var(--k-e5e7eb)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {head}<div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 76 }}>{children}</div>
    </aside>
  );
}

// ── @mention composer ─────────────────────────────────────────────────────

function MentionBox({ people, me, value, onChange, onSubmit, placeholder, cta, busy, autoFocus, isMobile, onCancel }: {
  people: DrivePerson[]; me: string; value: string; onChange: (v: string) => void; onSubmit: (mentions: string[]) => void;
  placeholder: string; cta: string; busy?: boolean; autoFocus?: boolean; isMobile: boolean; onCancel?: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState<string | null>(null);
  const cands = useMemo(() => {
    if (q === null) return [];
    const s = q.toLowerCase();
    return people.filter(p => p.id !== me && fullName(p).toLowerCase().includes(s)).slice(0, 6);
  }, [q, people, me]);
  const detect = (v: string, caret: number) => {
    const m = /(?:^|\s)@([\w.'-]*(?: [\w.'-]*)?)$/.exec(v.slice(0, caret));
    setQ(m ? m[1] : null);
  };
  const pick = (p: DrivePerson) => {
    const el = ta.current; if (!el) return;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@[\w.'-]*(?: [\w.'-]*)?$/, `@${fullName(p)} `);
    const next = before + value.slice(caret);
    onChange(next); setQ(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };
  const mentionsIn = (text: string) => people.filter(p => p.id !== me && fullName(p) && text.includes(`@${fullName(p)}`)).map(p => p.id);
  return (
    <div style={{ position: 'relative' }}>
      <textarea ref={ta} value={value} autoFocus={autoFocus} placeholder={placeholder} rows={3}
        onChange={e => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && value.trim()) { e.preventDefault(); onSubmit(mentionsIn(value)); } if (e.key === 'Escape') setQ(null); }}
        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '9px 10px', fontSize: 14, fontFamily: "'DM Sans',sans-serif", resize: 'vertical', background: 'var(--k-fff)', color: 'var(--k-1a1a1a)' }} />
      {cands.length > 0 && (
        <div role="listbox" style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 5, marginTop: 2, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.14)', overflow: 'hidden' }}>
          {cands.map(p => (
            <button key={p.id} type="button" role="option" onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, minHeight: isMobile ? 44 : 34, padding: '0 12px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 14, color: 'var(--k-1a1a1a)' }}>
              <span style={{ fontWeight: 600 }}>{fullName(p)}</span><span style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{p.role === 'super_admin' ? 'owner' : p.role}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>Type @ to tag a teammate</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {onCancel && <button type="button" onClick={onCancel} style={{ height: isMobile ? 40 : 32, padding: '0 12px', border: 'none', background: 'none', color: 'var(--k-6b7280)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>}
          <button type="button" disabled={!value.trim() || busy} onClick={() => onSubmit(mentionsIn(value))}
            style={{ height: isMobile ? 40 : 32, padding: '0 16px', border: 'none', borderRadius: 8, background: GOLD, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: !value.trim() || busy ? 'default' : 'pointer', opacity: !value.trim() || busy ? .5 : 1 }}>{busy ? 'Posting…' : cta}</button>
        </span>
      </div>
    </div>
  );
}

function Body({ c, people }: { c: DriveComment; people: DrivePerson[] }) {
  const names = c.mentions.map(id => fullName(people.find(p => p.id === id))).filter(Boolean);
  if (!names.length) return <>{c.body}</>;
  const parts = c.body.split(new RegExp(`(@(?:${names.map(esc).join('|')}))`, 'g'));
  return <>{parts.map((s, i) => (i % 2 ? <b key={i} style={{ color: 'var(--k-a06a12)' }}>{s}</b> : <React.Fragment key={i}>{s}</React.Fragment>))}</>;
}

// ── Comments ──────────────────────────────────────────────────────────────

export function CommentsPanel(p: Common & {
  editor: Editor | null;
  comments: DriveComment[];
  reload: () => Promise<void>;
  /** The words selected when "Comment" was pressed (null = a general comment). */
  anchor: { from: number; to: number; text: string } | null;
  clearAnchor: () => void;
  /** Tell everyone else in the doc to reload their comments. */
  bump: () => void;
  isAdmin: boolean;
}) {
  const api = useApi(p.authToken);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const person = (id: string | null) => p.people.find(x => x.id === id);
  const nameFor = (id: string | null) => (id === p.me.id ? 'You' : fullName(person(id)) || 'Teammate');

  const tops = p.comments.filter(c => !c.parent_id);
  const open = tops.filter(c => !c.resolved_at);
  const done = tops.filter(c => c.resolved_at);
  const shown = (showResolved ? done : open).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Pin the highlight to the words the person selected (re-finding them if a teammate typed in the meantime).
  const placeMark = (id: string): boolean => {
    const ed = p.editor, a = p.anchor;
    if (!ed || !a) return false;
    let { from, to } = a;
    if (ed.state.doc.textBetween(from, Math.min(to, ed.state.doc.content.size), ' ') !== a.text) {
      let found = -1;
      ed.state.doc.descendants((node, pos) => { if (found < 0 && node.isText && node.text) { const i = node.text.indexOf(a.text); if (i >= 0) found = pos + i; } });
      if (found < 0) return false;
      from = found; to = found + a.text.length;
    }
    ed.chain().setTextSelection({ from, to }).setMark('comment', { commentId: id }).run();
    return true;
  };

  const post = async (mentions: string[]) => {
    const body = text.trim(); if (!body) return;
    setBusy(true);
    const id = crypto.randomUUID();
    const anchored = placeMark(id);
    try {
      await api(`/api/crm/drive/comments/${p.docId}`, { method: 'POST', body: JSON.stringify({ id, body, mentions, anchor_text: anchored ? p.anchor?.text : null }) });
      setText(''); p.clearAnchor(); await p.reload(); p.bump();
    } catch (e) { if (anchored && p.editor) removeCommentMark(p.editor, id); p.onToast((e as Error).message); }
    setBusy(false);
  };
  const reply = async (parent: string, mentions: string[]) => {
    const body = replyText.trim(); if (!body) return;
    setBusy(true);
    try { await api(`/api/crm/drive/comments/${p.docId}`, { method: 'POST', body: JSON.stringify({ body, mentions, parent_id: parent }) }); setReplyText(''); setReplyTo(null); await p.reload(); p.bump(); }
    catch (e) { p.onToast((e as Error).message); }
    setBusy(false);
  };
  const resolve = async (c: DriveComment, resolved: boolean) => {
    try {
      await api(`/api/crm/drive/comments/${p.docId}?id=${c.id}`, { method: 'PATCH', body: JSON.stringify({ resolved }) });
      if (resolved && p.editor) removeCommentMark(p.editor, c.id);
      await p.reload(); p.bump();
    } catch (e) { p.onToast((e as Error).message); }
  };
  const remove = async (c: DriveComment) => {
    if (!confirm(c.parent_id ? 'Delete this reply?' : 'Delete this comment and its replies?')) return;
    try {
      await api(`/api/crm/drive/comments/${p.docId}?id=${c.id}`, { method: 'DELETE' });
      if (!c.parent_id && p.editor) removeCommentMark(p.editor, c.id);
      await p.reload(); p.bump();
    } catch (e) { p.onToast((e as Error).message); }
  };
  const goTo = (c: DriveComment) => {
    const ed = p.editor; if (!ed) return;
    const r = findCommentRange(ed, c.id);
    if (r) ed.chain().focus().setTextSelection(r).scrollIntoView().run();
    else p.onToast(c.resolved_at ? 'This comment was resolved, so its highlight is gone' : 'Those words have been deleted from the document');
  };

  const small = (label: string, on: () => void, danger?: boolean) => (
    <button type="button" onClick={on} style={{ minHeight: p.isMobile ? 36 : 26, padding: '0 8px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: danger ? 'var(--k-dc2626)' : 'var(--k-6b7280)' }}>{label}</button>
  );
  const msg = (c: DriveComment, isReply: boolean) => (
    <div key={c.id} style={{ padding: isReply ? '8px 0 0 12px' : 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--k-1a1a1a)' }}>{nameFor(c.author_id)}</span>
        <span style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{fmtWhen(c.created_at)}</span>
        {(c.author_id === p.me.id || p.isAdmin) && <span style={{ marginLeft: 'auto' }}>{small('Delete', () => void remove(c), true)}</span>}
      </div>
      <div style={{ fontSize: 14, color: 'var(--k-374151)', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><Body c={c} people={p.people} /></div>
    </div>
  );

  return (
    <Shell title={`Comments${open.length ? ` (${open.length})` : ''}`} isMobile={p.isMobile} onClose={p.onClose}>
      <div style={{ padding: 14, borderBottom: '1px solid var(--k-f0f0f0)' }}>
        {p.anchor ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--k-fffbeb)', borderLeft: `3px solid ${GOLD}`, padding: '6px 10px', borderRadius: 6, marginBottom: 8, fontSize: 12.5, color: 'var(--k-92400e)' }}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>On: “{p.anchor.text.length > 120 ? `${p.anchor.text.slice(0, 120)}…` : p.anchor.text}”</span>
            <button type="button" onClick={p.clearAnchor} aria-label="Comment on the whole document instead" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14 }}>✕</button>
          </div>
        ) : <div style={{ fontSize: 12.5, color: 'var(--k-9ca3af)', marginBottom: 8 }}>Select some words and press 💬 in the toolbar to comment on them, or write a general comment here.</div>}
        <MentionBox people={p.people} me={p.me.id} value={text} onChange={setText} onSubmit={m => void post(m)} placeholder="Add a comment…" cta="Comment" busy={busy} isMobile={p.isMobile} />
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px 0' }}>
        {([[false, `Open (${open.length})`], [true, `Resolved (${done.length})`]] as Array<[boolean, string]>).map(([v, l]) => (
          <button key={l} type="button" onClick={() => setShowResolved(v)} style={{ minHeight: p.isMobile ? 38 : 28, padding: '0 12px', borderRadius: 16, border: `1px solid ${showResolved === v ? GOLD : 'var(--k-e5e7eb)'}`, background: showResolved === v ? 'var(--k-fdf6e9)' : 'var(--k-fff)', color: showResolved === v ? 'var(--k-a06a12)' : 'var(--k-374151)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{l}</button>
        ))}
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.length === 0 && <div style={{ fontSize: 13.5, color: 'var(--k-9ca3af)', textAlign: 'center', padding: '16px 0' }}>{showResolved ? 'No resolved comments.' : 'No open comments yet.'}</div>}
        {shown.map(c => {
          const rs = p.comments.filter(x => x.parent_id === c.id);
          return (
            <div key={c.id} style={{ border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: 11, background: c.resolved_at ? 'var(--k-f9fafb)' : 'var(--k-fff)' }}>
              {c.anchor_text && (
                <button type="button" onClick={() => goTo(c)} title="Jump to these words" style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderLeft: `3px solid ${GOLD}`, background: 'var(--k-fffbeb)', padding: '4px 9px', borderRadius: 4, marginBottom: 8, cursor: 'pointer', fontSize: 12.5, color: 'var(--k-92400e)', overflowWrap: 'anywhere' }}>
                  “{c.anchor_text.length > 100 ? `${c.anchor_text.slice(0, 100)}…` : c.anchor_text}”
                </button>
              )}
              {msg(c, false)}
              {rs.map(r => msg(r, true))}
              {replyTo === c.id ? (
                <div style={{ marginTop: 8 }}>
                  <MentionBox people={p.people} me={p.me.id} value={replyText} onChange={setReplyText} onSubmit={m => void reply(c.id, m)} placeholder="Reply…" cta="Reply" busy={busy} autoFocus isMobile={p.isMobile} onCancel={() => { setReplyTo(null); setReplyText(''); }} />
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
                  {!c.resolved_at && small('Reply', () => { setReplyTo(c.id); setReplyText(''); })}
                  {small(c.resolved_at ? 'Reopen' : '✓ Resolve', () => void resolve(c, !c.resolved_at))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

// ── Version history ───────────────────────────────────────────────────────

export function HistoryPanel(p: Common & {
  ydoc: Y.Doc;
  /** Save what is on screen to the server now (so a snapshot / restore point is up to date). */
  flush: () => Promise<void>;
}) {
  const api = useApi(p.authToken);
  const [versions, setVersions] = useState<DriveVersion[] | null>(null);
  const [name, setName] = useState('');
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ v: DriveVersion; json: unknown; bytes: Uint8Array } | null>(null);
  const who = (id: string | null) => (id === p.me.id ? 'You' : fullName(p.people.find(x => x.id === id)) || 'Teammate');

  const load = useCallback(async () => {
    try { setVersions((await api<{ versions: DriveVersion[] }>(`/api/crm/drive/doc-versions/${p.docId}`)).versions); }
    catch (e) { p.onToast((e as Error).message); setVersions([]); }
  }, [api, p.docId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const saveNamed = async () => {
    setBusy(true);
    try {
      await p.flush();
      await api(`/api/crm/drive/doc-versions/${p.docId}`, { method: 'POST', body: JSON.stringify({ label: name, kind: 'manual' }) });
      setName(''); setNaming(false); p.onToast('Version saved'); await load();
    } catch (e) { p.onToast((e as Error).message); }
    setBusy(false);
  };
  const open = async (v: DriveVersion) => {
    try {
      const j = await api<{ state: string }>(`/api/crm/drive/doc-versions/${p.docId}?version=${v.id}`);
      const bytes = fromBase64(j.state);
      const d = new Y.Doc(); Y.applyUpdate(d, bytes);
      const json = yXmlFragmentToProsemirrorJSON(d.getXmlFragment('default')); d.destroy();
      setPreview({ v, json, bytes });
    } catch (e) { p.onToast((e as Error).message); }
  };
  const restore = async () => {
    if (!preview) return;
    if (!confirm('Restore this version? Everyone editing will see the document change. A copy of the current version is saved first, so you can come back to it.')) return;
    setBusy(true);
    try {
      await p.flush();
      await api(`/api/crm/drive/doc-versions/${p.docId}`, { method: 'POST', body: JSON.stringify({ kind: 'restore' }) });
      const src = new Y.Doc(); Y.applyUpdate(src, preview.bytes);
      const sf = src.getXmlFragment('default');
      p.ydoc.transact(() => {
        const f = p.ydoc.getXmlFragment('default');
        f.delete(0, f.length);
        f.insert(0, sf.toArray().map(n => (n as Y.XmlElement).clone()));
      });
      src.destroy();
      p.onToast('Version restored'); setPreview(null); p.onClose();
    } catch (e) { p.onToast((e as Error).message); }
    setBusy(false);
  };
  const del = async (v: DriveVersion) => {
    if (!confirm('Delete this saved version?')) return;
    try { await api(`/api/crm/drive/doc-versions/${p.docId}?version=${v.id}`, { method: 'DELETE' }); await load(); } catch (e) { p.onToast((e as Error).message); }
  };

  return (
    <>
      <Shell title="Version history" isMobile={p.isMobile} onClose={p.onClose}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--k-f0f0f0)' }}>
          {naming ? (
            <form onSubmit={e => { e.preventDefault(); void saveNamed(); }} style={{ display: 'flex', gap: 6 }}>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Name this version (optional)" maxLength={120}
                style={{ flex: 1, minWidth: 0, height: p.isMobile ? 42 : 34, border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '0 10px', fontSize: 14, background: 'var(--k-fff)', color: 'var(--k-1a1a1a)' }} />
              <button type="submit" disabled={busy} style={{ height: p.isMobile ? 42 : 34, padding: '0 14px', border: 'none', borderRadius: 8, background: GOLD, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{busy ? '…' : 'Save'}</button>
            </form>
          ) : (
            <button type="button" onClick={() => setNaming(true)} style={{ width: '100%', height: p.isMobile ? 44 : 36, border: `1px dashed ${GOLD}`, borderRadius: 8, background: 'var(--k-fdf6e9)', color: 'var(--k-a06a12)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>⭐ Save a version now</button>
          )}
          <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 8, lineHeight: 1.45 }}>The document is also saved automatically every so often while people edit. Open any version to look at it or restore it.</div>
        </div>
        {versions === null && <div style={{ padding: 20, color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading…</div>}
        {versions?.length === 0 && <div style={{ padding: 20, color: 'var(--k-9ca3af)', fontSize: 14, textAlign: 'center' }}>No versions yet — one is saved automatically after you start editing.</div>}
        {versions?.map(v => (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--k-f0f0f0)', paddingRight: 6 }}>
            <button type="button" onClick={() => void open(v)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: '11px 14px', minHeight: p.isMobile ? 56 : 48 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--k-1a1a1a)' }}>{v.kind === 'manual' ? '⭐' : v.kind === 'restore' ? '↩' : '🕘'} {v.label || (v.kind === 'auto' ? 'Automatic save' : 'Saved version')}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 1 }}>{fmtWhen(v.created_at)} · {who(v.created_by)}</span>
            </button>
            {v.kind !== 'auto' && (v.created_by === p.me.id) && <button type="button" aria-label="Delete this version" onClick={() => void del(v)} style={{ width: p.isMobile ? 40 : 30, height: p.isMobile ? 40 : 30, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--k-d1d5db)' }}>🗑</button>}
          </div>
        ))}
      </Shell>
      {preview && <VersionPreview v={preview.v} json={preview.json} who={who(preview.v.created_by)} isMobile={p.isMobile} busy={busy} onClose={() => setPreview(null)} onRestore={() => void restore()} />}
    </>
  );
}

function VersionPreview({ v, json, who, isMobile, busy, onClose, onRestore }: { v: DriveVersion; json: unknown; who: string; isMobile: boolean; busy: boolean; onClose: () => void; onRestore: () => void }) {
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions: docExtensions(), content: json as never, editorProps: { attributes: { class: 'drive-doc' } } }, [json]);
  return (
    <div role="dialog" aria-label="Version preview" style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'var(--k-f3f4f6)', display: 'flex', flexDirection: 'column', paddingTop: isMobile ? 'env(safe-area-inset-top, 0px)' : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '8px 10px' : '10px 18px', background: 'var(--k-fff)', borderBottom: '1px solid var(--k-e5e7eb)', flexWrap: 'wrap' }}>
        <button type="button" onClick={onClose} aria-label="Back" style={{ width: isMobile ? 40 : 34, height: isMobile ? 40 : 34, border: 'none', borderRadius: 8, background: 'transparent', fontSize: 18, cursor: 'pointer', color: 'var(--k-374151)' }}>←</button>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-1a1a1a)' }}>{v.label || (v.kind === 'auto' ? 'Automatic save' : 'Saved version')}</div>
          <div style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{fmtWhen(v.created_at)} · {who} · read-only preview</div>
        </div>
        <button type="button" onClick={onRestore} disabled={busy} style={{ height: isMobile ? 42 : 34, padding: '0 16px', border: 'none', borderRadius: 8, background: GOLD, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>{busy ? 'Restoring…' : 'Restore this version'}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? 0 : '24px 16px 60px' }}>
        <div style={{ maxWidth: 816, margin: '0 auto', minHeight: isMobile ? '100%' : 600, background: 'var(--k-fff)', boxShadow: isMobile ? 'none' : '0 1px 3px rgba(0,0,0,.12)', borderRadius: isMobile ? 0 : 4, padding: isMobile ? '18px 16px 60px' : '48px 64px 60px' }}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
