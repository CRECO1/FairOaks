'use client';

/**
 * LiveDocEditor — a full-screen, Google-Docs-style document that several teammates edit at once.
 *
 *   TipTap (ProseMirror) for the page, Yjs for conflict-free concurrent edits, SupabaseYjsProvider (private Realtime channel
 *   `drive-doc:<id>`) for the live traffic, and /api/crm/drive/doc-state/<id> for durable saves.
 *
 * The live Y.Doc is owned by the module-level registry (lib/collab/doc-registry) rather than by this component, so React
 * remounts never create a second identity or wipe presence. Saves send only the Yjs updates made since the last save; the
 * server merges them, so two people saving at once never overwrite each other. Every open tab saves every update it sees
 * (its own and its peers'), so a doc survives even if the person who typed last closes the laptop mid-sentence.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { toBase64, fromBase64 } from 'lib0/buffer';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { createClient } from '@/lib/supabase/client';
import { acquireDoc, releaseDoc, type CollabHandle } from '@/lib/collab/doc-registry';
import type { CollabStatus } from '@/lib/collab/supabase-yjs-provider';
import type { DriveComment, DriveDoc } from '@/lib/drive-types';
import { docExtensions } from './doc-extensions';
import { DocStyles } from './DocStyles';
import { LetterheadHeader, LetterheadFooter } from './Letterhead';
import { exportDocPdf } from './doc-export';
import { CommentsPanel, HistoryPanel } from './DocPanel';
import type { DrivePerson } from './DocsDrive';

export interface DocUser { id: string; name: string }
interface Peer { name: string; color: string }
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const COLORS = ['#c9922c', '#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#4f46e5'];
export const colorFor = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; };

interface Props {
  docId: string;
  authToken?: string;
  user: DocUser;
  isMobile: boolean;
  onClose: () => void;
  onShare?: (doc: DriveDoc) => void;
  onToast: (msg: string) => void;
  /** Tell the list the title changed so it isn't stale when the doc is closed. */
  onTitle?: (id: string, title: string) => void;
  /** Teammates, for @mentions and for naming who wrote a comment or saved a version. */
  people?: DrivePerson[];
  isAdmin?: boolean;
}

export default function LiveDocEditor({ docId, authToken, user, isMobile, onClose, onShare, onToast, onTitle, people = [], isAdmin = false }: Props) {
  const [doc, setDoc] = useState<DriveDoc | null>(null);
  const [state, setState] = useState<Uint8Array | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await fetch(`/api/crm/drive/doc-state/${docId}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
        const j = await r.json().catch(() => ({}));
        if (off) return;
        if (!r.ok) { setErr(j?.error || 'Could not open this document'); return; }
        setDoc(j.doc as DriveDoc);
        setState(j.state ? fromBase64(j.state) : null);
      } catch { if (!off) setErr('Could not open this document — check your connection'); }
    })();
    return () => { off = true; };
  }, [docId, authToken]);

  if (err) {
    return (
      <Frame isMobile={isMobile}>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 15, color: 'var(--k-374151)', marginBottom: 14 }}>{err}</div>
          <button type="button" onClick={onClose} style={btnStyle(isMobile)}>← Back to Docs</button>
        </div>
      </Frame>
    );
  }
  if (!doc || state === undefined) return <Frame isMobile={isMobile}><div style={{ padding: 28, color: 'var(--k-9ca3af)', fontSize: 14 }}>Opening…</div></Frame>;
  return <DocWorkspace key={docId} doc={doc} initialState={state} authToken={authToken} user={user} isMobile={isMobile} onClose={onClose} onShare={onShare} onToast={onToast} onTitle={onTitle} people={people} isAdmin={isAdmin} />;
}

function DocWorkspace({ doc, initialState, authToken, user, isMobile, onClose, onShare, onToast, onTitle, people = [], isAdmin = false }: Omit<Props, 'docId'> & { doc: DriveDoc; initialState: Uint8Array | null }) {
  const [handle, setHandle] = useState<CollabHandle | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [save, setSave] = useState<SaveState>('saved');
  const [title, setTitle] = useState(doc.title);
  const me = useMemo<Peer>(() => ({ name: user.name || 'Teammate', color: colorFor(user.id) }), [user.id, user.name]);
  const [panel, setPanel] = useState<null | 'comments' | 'history'>(null);
  const [comments, setComments] = useState<DriveComment[]>([]);
  const [anchor, setAnchor] = useState<{ from: number; to: number; text: string } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const commentsReload = useRef<() => Promise<void>>(async () => {});
  const authRef = useRef(authToken); authRef.current = authToken;
  const toastRef = useRef(onToast); toastRef.current = onToast;

  // ── connect + persistence ─────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    if (authToken) supabase.realtime.setAuth(authToken); // the private channel is authorised with this person's login
    const h = acquireDoc(supabase, doc.id, { onStatus: setStatus, initialState });
    h.awareness.setLocalStateField('user', me);

    const refreshPeers = () => {
      const list: Peer[] = [];
      const seen = new Set<string>();
      h.awareness.getStates().forEach((s, clientId) => {
        if (clientId === h.ydoc.clientID) return;
        const u = (s as { user?: Peer }).user;
        if (u?.name && !seen.has(u.name + u.color)) { seen.add(u.name + u.color); list.push(u); }
      });
      setPeers(list);
    };
    h.awareness.on('change', refreshPeers);
    refreshPeers();

    // Live title: peers see a rename as it happens. (The first title shown is always the saved one, so a stale value left in
    // the shared state can never override a rename made from the list.)
    const meta = h.ydoc.getMap<unknown>('meta');
    const onMeta = (ev: Y.YMapEvent<unknown>) => {
      if (ev.transaction.local) return;
      if (ev.keysChanged.has('commentsRev')) void loadComments();   // a teammate commented, replied or resolved
      if (!ev.keysChanged.has('title')) return;
      const t = meta.get('title');
      if (typeof t === 'string') { setTitle(t); onTitle?.(doc.id, t); }
    };
    meta.observe(onMeta);
    const loadComments = async () => {
      try {
        const r = await fetch(`/api/crm/drive/comments/${doc.id}`, { headers: authRef.current ? { Authorization: `Bearer ${authRef.current}` } : {} });
        if (r.ok) setComments(((await r.json()) as { comments: DriveComment[] }).comments ?? []);
      } catch { /* the panel retries when it opens */ }
    };
    void loadComments();
    commentsReload.current = loadComments;
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void loadComments(); }, 30_000);

    // Saving: collect every update (not the initial seed), merge, send after typing pauses (or every 8 s while typing).
    const pending: Uint8Array[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let saving = false;
    let again = false;
    const headers = () => ({ 'Content-Type': 'application/json', ...(authRef.current ? { Authorization: `Bearer ${authRef.current}` } : {}) });
    const flush = async (leaving = false) => {
      clearTimeout(timer); clearTimeout(maxTimer); timer = undefined; maxTimer = undefined;
      if (!pending.length) return;
      if (saving) { again = true; return; }
      const batch = pending.splice(0);
      const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
      const b64 = toBase64(merged);
      saving = true; setSave('saving');
      try {
        const r = await fetch(`/api/crm/drive/doc-state/${doc.id}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ update: b64 }), keepalive: leaving && b64.length < 60_000 });
        if (!r.ok) {
          // A document that was trashed or un-shared mid-edit can't be saved — say so instead of retrying forever.
          if (r.status === 404 || r.status === 410) { setSave('error'); toastRef.current('This document is no longer available — your last changes could not be saved'); return; }
          throw new Error(String(r.status));
        }
        if (!pending.length) setSave('saved');
      } catch {
        pending.unshift(merged); setSave('error');
        clearTimeout(retry); retry = setTimeout(() => void flush(), 5000);
      } finally {
        saving = false;
        if ((again || pending.length) && !retry) { again = false; timer = setTimeout(() => void flush(), 400); }
      }
    };
    // "Save now and wait until it's really on the server" — used before saving a named version or restoring one.
    flushRef.current = async () => {
      await flush();
      for (let i = 0; i < 30 && (saving || pending.length); i++) { await new Promise(r => setTimeout(r, 150)); if (!saving && pending.length) await flush(); }
    };
    const onUpdate = (u: Uint8Array, origin: unknown) => {
      if (origin === 'seed') return;
      pending.push(u);
      setSave(s => (s === 'saving' ? s : 'dirty'));
      clearTimeout(timer); timer = setTimeout(() => void flush(), 1500);
      if (!maxTimer) maxTimer = setTimeout(() => void flush(), 8000);
    };
    h.ydoc.on('update', onUpdate);
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(true); };
    const onPageHide = () => void flush(true);
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (pending.length || saving) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);

    setHandle(h);
    return () => {
      h.awareness.off('change', refreshPeers);
      meta.unobserve(onMeta);
      h.ydoc.off('update', onUpdate);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearTimeout(retry); clearInterval(poll);
      void flush(true);
      releaseDoc(doc.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // ── title ─────────────────────────────────────────────────────────────────
  const titleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onTitleInput = (v: string) => {
    setTitle(v);
    handle?.ydoc.getMap<string>('meta').set('title', v);
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      const t = v.trim();
      if (!t) return;
      onTitle?.(doc.id, t);
      try {
        await fetch(`/api/crm/drive/items/doc/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(authRef.current ? { Authorization: `Bearer ${authRef.current}` } : {}) }, body: JSON.stringify({ title: t }) });
      } catch { /* the next keystroke retries */ }
    }, 700);
  };

  const dot = status === 'connected' ? '#16a34a' : status === 'connecting' ? '#d97706' : '#dc2626';
  const statusLabel = status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : status === 'denied' ? 'No live access' : 'Reconnecting…';
  const saveLabel = save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes' : 'Couldn’t save — retrying';

  return (
    <Frame isMobile={isMobile}>
      <header style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, padding: isMobile ? '8px 10px' : '10px 18px', background: 'var(--k-fff)', borderBottom: '1px solid var(--k-e5e7eb)', flexShrink: 0 }}>
        <button type="button" onClick={onClose} aria-label="Back to Docs" style={{ ...iconBtn(isMobile), fontSize: 18 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input value={title} onChange={e => onTitleInput(e.target.value)} aria-label="Document title" maxLength={300}
            style={{ width: '100%', border: '1px solid transparent', borderRadius: 6, background: 'transparent', fontSize: isMobile ? 16 : 17, fontWeight: 600, color: 'var(--k-1a1a1a)', padding: '3px 6px', fontFamily: "'DM Sans',sans-serif", textOverflow: 'ellipsis' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--k-d1d5db)')} onBlur={e => (e.currentTarget.style.borderColor = 'transparent')} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11.5, color: 'var(--k-9ca3af)', padding: '0 6px', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />{statusLabel}</span>
            <span style={{ color: save === 'error' ? 'var(--k-dc2626)' : undefined }}>{saveLabel}</span>
            {doc.visibility === 'private' && <span>🔒 Private</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }} aria-label={peers.length ? `${peers.length} other ${peers.length === 1 ? 'person is' : 'people are'} here` : 'Only you'}>
          {[me, ...peers].slice(0, 5).map((p, i) => (
            <span key={i} title={i === 0 ? `${p.name} (you)` : p.name}
              style={{ width: 28, height: 28, borderRadius: '50%', background: p.color, color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: i ? -7 : 0, border: '2px solid var(--k-fff)' }}>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
          {peers.length > 4 && <span style={{ fontSize: 11, marginLeft: 4, color: 'var(--k-6b7280)' }}>+{peers.length - 4}</span>}
        </div>
        <button type="button" onClick={() => setPanel(p => (p === 'comments' ? null : 'comments'))} aria-pressed={panel === 'comments'} aria-label="Comments" title="Comments"
          style={{ ...btnStyle(isMobile), padding: '0 10px', background: panel === 'comments' ? 'var(--k-fdf6e9)' : 'var(--k-fff)', position: 'relative' }}>
          💬{comments.some(c => !c.parent_id && !c.resolved_at) && <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--k-a06a12)' }}>{comments.filter(c => !c.parent_id && !c.resolved_at).length}</span>}
        </button>
        <button type="button" onClick={() => setPanel(p => (p === 'history' ? null : 'history'))} aria-pressed={panel === 'history'} aria-label="Version history" title="Version history"
          style={{ ...btnStyle(isMobile), padding: '0 10px', background: panel === 'history' ? 'var(--k-fdf6e9)' : 'var(--k-fff)' }}>🕘</button>
        <button type="button" disabled={!editor} onClick={async () => { if (!editor) return; try { await flushRef.current(); await exportDocPdf(doc.id, authToken, title); } catch (e) { onToast((e as Error).message || 'Could not make the PDF'); } }}
          aria-label="Download as PDF" title="Download as PDF" style={{ ...btnStyle(isMobile), padding: '0 10px' }}>⬇ PDF</button>
        {onShare && <button type="button" onClick={() => onShare(doc)} style={{ ...btnStyle(isMobile), background: '#c9922c', color: '#fff', border: 'none' }}>Share</button>}
      </header>
      {status === 'denied' && (
        <div style={{ background: 'var(--k-fffbeb)', color: 'var(--k-92400e)', padding: '8px 16px', fontSize: 13, borderBottom: '1px solid var(--k-fde68a)' }}>
          Live editing isn’t available for you on this document. What you type is saved, but others won’t see it until they reload.
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {handle ? (
          <DocSurface handle={handle} me={me} isMobile={isMobile} onEditor={setEditor}
            onComment={() => {
              if (!editor) return;
              const { from, to } = editor.state.selection;
              const text = from !== to ? editor.state.doc.textBetween(from, to, ' ').trim() : '';
              setAnchor(text ? { from, to, text: text.slice(0, 500) } : null);
              setPanel('comments'); void commentsReload.current();
            }}
            onHighlightClick={() => { setPanel('comments'); void commentsReload.current(); }} />
        ) : <div style={{ padding: 28, color: 'var(--k-9ca3af)' }}>Connecting…</div>}
        {handle && panel === 'comments' && (
          <CommentsPanel docId={doc.id} authToken={authToken} me={user} people={people} isMobile={isMobile} isAdmin={isAdmin} onToast={onToast} onClose={() => { setPanel(null); setAnchor(null); }}
            editor={editor} comments={comments} reload={() => commentsReload.current()} anchor={anchor} clearAnchor={() => setAnchor(null)}
            bump={() => handle.ydoc.getMap<unknown>('meta').set('commentsRev', Date.now())} />
        )}
        {handle && panel === 'history' && (
          <HistoryPanel docId={doc.id} authToken={authToken} me={user} people={people} isMobile={isMobile} onToast={onToast} onClose={() => setPanel(null)} ydoc={handle.ydoc} flush={() => flushRef.current()} />
        )}
      </div>
    </Frame>
  );
}

function DocSurface({ handle, me, isMobile, onEditor, onComment, onHighlightClick }: { handle: CollabHandle; me: Peer; isMobile: boolean; onEditor: (e: Editor | null) => void; onComment: () => void; onHighlightClick: () => void }) {
  const clickRef = useRef(onHighlightClick); clickRef.current = onHighlightClick;
  // CRECO letterhead on/off is a setting of the document itself (shared, saved with it), so everyone sees the same page.
  const [letterhead, setLetterhead] = useState(() => handle.ydoc.getMap<unknown>('meta').get('letterhead') === true);
  useEffect(() => {
    const m = handle.ydoc.getMap<unknown>('meta');
    const f = () => setLetterhead(m.get('letterhead') === true);
    m.observe(f); f();
    return () => m.unobserve(f);
  }, [handle.ydoc]);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...docExtensions(),
      Placeholder.configure({ placeholder: 'Start typing — or press “/” … everyone on this doc sees it live.' }),
      Collaboration.configure({ document: handle.ydoc }),
      CollaborationCursor.configure({ provider: { awareness: handle.awareness }, user: me }),
    ],
    editorProps: {
      attributes: { class: 'drive-doc', spellcheck: 'true' },
      handleClick: (_v, _pos, ev) => { if ((ev.target as HTMLElement | null)?.closest?.('.comment-hl')) clickRef.current(); return false; },
    },
  }, [handle.ydoc]);
  useEffect(() => { onEditor(editor); return () => onEditor(null); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Toolbar editor={editor} isMobile={isMobile} onComment={onComment} letterhead={letterhead} onLetterhead={() => handle.ydoc.getMap<unknown>('meta').set('letterhead', !letterhead)} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--k-f3f4f6)', padding: isMobile ? '0' : '24px 16px 60px' }}>
        <div style={{ maxWidth: 816, margin: '0 auto', minHeight: isMobile ? '100%' : 1056, background: 'var(--k-fff)', boxShadow: isMobile ? 'none' : '0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.05)', borderRadius: isMobile ? 0 : 4, padding: isMobile ? '18px 16px 80px' : '56px 72px 80px' }}>
          {letterhead && <LetterheadHeader />}
          <EditorContent editor={editor} />
          {letterhead && <LetterheadFooter />}
        </div>
      </div>
      <DocStyles />
    </div>
  );
}

// ── toolbar ────────────────────────────────────────────────────────────────

function Toolbar({ editor, isMobile, onComment, letterhead, onLetterhead }: { editor: Editor | null; isMobile: boolean; onComment: () => void; letterhead: boolean; onLetterhead: () => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const f = () => force(n => n + 1);
    editor.on('transaction', f);
    return () => { editor.off('transaction', f); };
  }, [editor]);
  const openLink = useCallback(() => {
    if (!editor) return;
    setLinkUrl((editor.getAttributes('link').href as string | undefined) ?? '');
    setLinkOpen(true);
  }, [editor]);
  if (!editor) return <div style={{ height: 44, borderBottom: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)' }} />;
  const c = () => editor.chain().focus();
  const B = ({ on, label, title, active, disabled }: { on: () => void; label: ReactNode; title: string; active?: boolean; disabled?: boolean }) => (
    <button type="button" title={title} aria-label={title} aria-pressed={!!active} disabled={disabled}
      onMouseDown={e => e.preventDefault()} onClick={on}
      style={{ minWidth: isMobile ? 40 : 32, height: isMobile ? 40 : 32, padding: '0 8px', border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer', flexShrink: 0, fontSize: 14, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", background: active ? 'var(--k-fdf6e9)' : 'transparent', color: disabled ? 'var(--k-d1d5db)' : active ? 'var(--k-a06a12)' : 'var(--k-374151)' }}>
      {label}
    </button>
  );
  const Sep = () => <span aria-hidden style={{ width: 1, height: 20, background: 'var(--k-e5e7eb)', margin: '0 4px', flexShrink: 0 }} />;
  const block = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';
  const inTable = editor.isActive('table');
  return (
    <div style={{ background: 'var(--k-fff)', borderBottom: '1px solid var(--k-e5e7eb)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <B on={() => c().undo().run()} label="↶" title="Undo" />
        <B on={() => c().redo().run()} label="↷" title="Redo" />
        <Sep />
        <select aria-label="Text style" value={block} onChange={e => { const v = e.target.value; if (v === 'p') c().setParagraph().run(); else c().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run(); }}
          style={{ height: isMobile ? 40 : 32, border: '1px solid var(--k-e5e7eb)', borderRadius: 6, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13.5, padding: '0 6px', flexShrink: 0 }}>
          <option value="p">Normal</option><option value="h1">Title</option><option value="h2">Heading</option><option value="h3">Subheading</option>
        </select>
        <Sep />
        <B on={() => c().toggleBold().run()} active={editor.isActive('bold')} label={<b>B</b>} title="Bold" />
        <B on={() => c().toggleItalic().run()} active={editor.isActive('italic')} label={<i>I</i>} title="Italic" />
        <B on={() => c().toggleUnderline().run()} active={editor.isActive('underline')} label={<u>U</u>} title="Underline" />
        <B on={() => c().toggleStrike().run()} active={editor.isActive('strike')} label={<s>S</s>} title="Strikethrough" />
        <B on={() => c().toggleHighlight().run()} active={editor.isActive('highlight')} label="🖍" title="Highlight" />
        <B on={openLink} active={editor.isActive('link')} label="🔗" title="Link" />
        <B on={onComment} label="💬＋" title="Comment on the selected words" />
        <Sep />
        <B on={() => c().toggleBulletList().run()} active={editor.isActive('bulletList')} label="•≡" title="Bulleted list" />
        <B on={() => c().toggleOrderedList().run()} active={editor.isActive('orderedList')} label="1≡" title="Numbered list" />
        <B on={() => c().toggleTaskList().run()} active={editor.isActive('taskList')} label="☑" title="Checklist" />
        <B on={() => c().toggleBlockquote().run()} active={editor.isActive('blockquote')} label="❝" title="Quote" />
        <Sep />
        <B on={() => c().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} label="⇤" title="Align left" />
        <B on={() => c().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} label="↔" title="Center" />
        <B on={() => c().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} label="⇥" title="Align right" />
        <Sep />
        <B on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} disabled={inTable} label="▦" title="Insert table" />
        {inTable && <>
          <B on={() => c().addRowAfter().run()} label="＋row" title="Add row below" />
          <B on={() => c().addColumnAfter().run()} label="＋col" title="Add column right" />
          <B on={() => c().deleteRow().run()} label="−row" title="Delete row" />
          <B on={() => c().deleteColumn().run()} label="−col" title="Delete column" />
          <B on={() => c().deleteTable().run()} label="🗑▦" title="Delete table" />
        </>}
        <B on={() => c().setHorizontalRule().run()} label="―" title="Divider line" />
        <Sep />
        <B on={onLetterhead} active={letterhead} label="🏷 Letterhead" title="CRECO letterhead — logo header and footer on every page (and on the PDF)" />
      </div>
      {linkOpen && (
        <form onSubmit={e => { e.preventDefault(); const u = linkUrl.trim(); if (!u) c().unsetLink().run(); else c().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|tel:)/i.test(u) ? u : `https://${u}` }).run(); setLinkOpen(false); }}
          style={{ display: 'flex', gap: 6, padding: '6px 8px 8px', alignItems: 'center' }}>
          <input autoFocus value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="Paste a link (leave empty to remove)" inputMode="url"
            style={{ flex: 1, minWidth: 0, height: isMobile ? 40 : 32, border: '1px solid var(--k-d1d5db)', borderRadius: 6, padding: '0 10px', fontSize: 14, background: 'var(--k-fff)', color: 'var(--k-1a1a1a)' }} />
          <button type="submit" style={btnStyle(isMobile)}>Apply</button>
          <button type="button" onClick={() => setLinkOpen(false)} style={{ ...btnStyle(isMobile), background: 'none', border: 'none' }}>Cancel</button>
        </form>
      )}
    </div>
  );
}

// ── chrome + styles ────────────────────────────────────────────────────────

function Frame({ isMobile, children }: { isMobile: boolean; children: ReactNode }) {
  return (
    <div role="dialog" aria-label="Document" style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', background: 'var(--k-f3f4f6)', paddingTop: isMobile ? 'env(safe-area-inset-top, 0px)' : 0 }}>
      {children}
    </div>
  );
}

const btnStyle = (isMobile: boolean): React.CSSProperties => ({ height: isMobile ? 40 : 32, padding: '0 14px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", flexShrink: 0 });
const iconBtn = (isMobile: boolean): React.CSSProperties => ({ width: isMobile ? 40 : 34, height: isMobile ? 40 : 34, border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--k-374151)', cursor: 'pointer', flexShrink: 0 });
