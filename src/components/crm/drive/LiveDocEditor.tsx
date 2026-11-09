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

import { COLOR_GRID, DOC_COLORS, DOC_FONTS, DOC_SIZES, fontByCss, sizePt } from '@/lib/doc-fonts';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Y from 'yjs';
import { toBase64, fromBase64 } from 'lib0/buffer';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { createClient } from '@/lib/supabase/client';
import { acquireDoc, releaseDoc, type CollabHandle } from '@/lib/collab/doc-registry';
import type { CollabStatus } from '@/lib/collab/supabase-yjs-provider';
import type { DriveComment, DriveDoc } from '@/lib/drive-types';
import { docExtensions } from './doc-extensions';
import { DocStyles } from './DocStyles';
import { LetterheadHeader, LetterheadFooter } from './Letterhead';
import { exportDocPdf, exportDocDocx, printDoc } from './doc-export';
import { ActivityPanel, CommentsPanel, HistoryPanel } from './DocPanel';
import { LINE_SPACINGS } from '@/lib/collab/block-format';
import { SuggestTracking, listSuggestions, resolveSuggestions, type Suggestion } from '@/lib/collab/suggest-marks';
import { safeImageSrc } from '@/lib/collab/image-node';
import { OverflowRow, TBtn, TSep, Ico, Pop, Item, SHEET_CSS, type IcoName } from './SheetParts';
import { FindReplace, countFind, currentFind, replaceAll, replaceOne, setFind, stepFind } from '@/lib/collab/find-replace';
import type { DrivePerson } from './DocsDrive';
import { Frame, btnStyle, iconBtn, colorFor } from './DocChrome';
import SheetWorkspace from './SheetEditor';
import DocMention from './DocMention';

export interface DocUser { id: string; name: string }
interface Peer { name: string; color: string }
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export { colorFor };

interface Props {
  docId: string;
  authToken?: string;
  user: DocUser;
  isMobile: boolean;
  onClose: () => void;
  onShare?: (doc: DriveDoc) => void;
  /** Send this document for e-signature: the caller closes the editor and opens the E-Sign flow with the document's PDF. */
  onSign?: (doc: DriveDoc) => void;
  onToast: (msg: string) => void;
  /** Tell the list the title changed so it isn't stale when the doc is closed. */
  onTitle?: (id: string, title: string) => void;
  /** Teammates, for @mentions and for naming who wrote a comment or saved a version. */
  people?: DrivePerson[];
  isAdmin?: boolean;
  /** The document has loaded (a standalone page uses it to name its browser tab). */
  onLoaded?: (doc: DriveDoc) => void;
}

export default function LiveDocEditor({ docId, authToken, user, isMobile, onClose, onShare, onSign, onToast, onTitle, onLoaded, people = [], isAdmin = false }: Props) {
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
        setDoc(j.doc as DriveDoc); onLoaded?.(j.doc as DriveDoc);
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
  if (doc.kind === 'sheet') return <SheetWorkspace key={docId} doc={doc} initialState={state} authToken={authToken} user={user} isMobile={isMobile} onClose={onClose} onShare={onShare} onToast={onToast} onTitle={onTitle} people={people} isAdmin={isAdmin} />;
  return <DocWorkspace key={docId} doc={doc} initialState={state} authToken={authToken} user={user} isMobile={isMobile} onClose={onClose} onShare={onShare} onSign={onSign} onToast={onToast} onTitle={onTitle} people={people} isAdmin={isAdmin} />;
}

function DocWorkspace({ doc, initialState, authToken, user, isMobile, onClose, onShare, onSign, onToast, onTitle, people = [], isAdmin = false }: Omit<Props, 'docId'> & { doc: DriveDoc; initialState: Uint8Array | null }) {
  const [handle, setHandle] = useState<CollabHandle | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [save, setSave] = useState<SaveState>('saved');
  const [title, setTitle] = useState(doc.title);
  const me = useMemo<Peer>(() => ({ name: user.name || 'Teammate', color: colorFor(user.id) }), [user.id, user.name]);
  const [panel, setPanel] = useState<null | 'comments' | 'history' | 'activity'>(null);
  const [dlOpen, setDlOpen] = useState(false);   // phones: PDF and Word share one ⬇ menu so the header stays on two rows
  // Print straight from the document (button, or Ctrl/Cmd+P): the same pages as the PDF, sent to the printer dialog.
  const doPrint = async () => { if (!editor) return; try { await flushRef.current(); await printDoc(doc.id, authToken, title); } catch (e) { onToast((e as Error).message || 'Could not print this document'); } };
  const doPrintRef = useRef(doPrint); doPrintRef.current = doPrint;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); void doPrintRef.current(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
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
      <header style={{ display: 'flex', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', rowGap: isMobile ? 4 : 0, gap: isMobile ? 4 : 12, padding: isMobile ? '8px 10px' : '10px 18px', background: 'var(--k-fff)', borderBottom: '1px solid var(--k-e5e7eb)', flexShrink: 0 }}>
        <button type="button" onClick={onClose} aria-label="Back to Docs" style={{ ...iconBtn(isMobile), fontSize: 18 }}>←</button>
        <div style={{ flex: isMobile ? '1 1 calc(100% - 56px)' : 1, minWidth: 0 }}>
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
          style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px', background: panel === 'comments' ? 'var(--k-fdf6e9)' : 'var(--k-fff)', position: 'relative' }}>
          💬{comments.some(c => !c.parent_id && !c.resolved_at) && <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--k-a06a12)' }}>{comments.filter(c => !c.parent_id && !c.resolved_at).length}</span>}
        </button>
        <button type="button" onClick={() => setPanel(p => (p === 'activity' ? null : 'activity'))} aria-pressed={panel === 'activity'} aria-label="Activity log" title="Activity — every change to this document"
          style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px', background: panel === 'activity' ? 'var(--k-fdf6e9)' : 'var(--k-fff)' }}>📜</button>
        <button type="button" onClick={() => setPanel(p => (p === 'history' ? null : 'history'))} aria-pressed={panel === 'history'} aria-label="Version history" title="Version history"
          style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px', background: panel === 'history' ? 'var(--k-fdf6e9)' : 'var(--k-fff)' }}>🕘</button>
        {(() => {
          const doPdf = async () => { if (!editor) return; try { await flushRef.current(); await exportDocPdf(doc.id, authToken, title); } catch (e) { onToast((e as Error).message || 'Could not make the PDF'); } };
          const doWord = async () => { if (!editor) return; try { await flushRef.current(); await exportDocDocx(doc.id, authToken, title); } catch (e) { onToast((e as Error).message || 'Could not make the Word file'); } };
          if (!isMobile) return (
            <>
              <button type="button" disabled={!editor} onClick={() => void doPrint()} aria-label="Print" title="Print this document (Ctrl+P)" style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px' }}>🖨 Print</button>
              <button type="button" disabled={!editor} onClick={() => void doPdf()} aria-label="Download as PDF" title="Download as PDF" style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px' }}>⬇ PDF</button>
              <button type="button" disabled={!editor} onClick={() => void doWord()} aria-label="Download as Word" title="Download as a Word (.docx) file you can edit in Word" style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px' }}>⬇ Word</button>
            </>
          );
          return (
            <div style={{ position: 'relative' }}>
              <button type="button" disabled={!editor} onClick={() => setDlOpen(o => !o)} aria-haspopup="menu" aria-expanded={dlOpen} aria-label="Download" title="Download as PDF or Word" style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px' }}>⬇</button>
              {dlOpen && (
                <>
                  <div onClick={() => setDlOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div role="menu" style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 41, minWidth: 190, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.18)', padding: 6 }}>
                    {([['Print', doPrint], ['PDF', doPdf], ['Word (.docx)', doWord]] as Array<[string, () => Promise<void>]>).map(([label, fn]) => (
                      <button key={label} type="button" role="menuitem" onClick={() => { setDlOpen(false); void fn(); }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', minHeight: 46, padding: '0 14px', border: 'none', borderRadius: 8, background: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 600, color: 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }}>⬇ {label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })()}
        {onSign && (
          <button type="button" disabled={!editor} aria-label="Send for signature" title="Turn this document into a PDF and send it for e-signature"
            onClick={async () => { if (!editor) return; try { await flushRef.current(); onSign(doc); } catch (e) { onToast((e as Error).message || 'Could not prepare the document'); } }}
            style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px', color: '#a06a12', background: 'var(--k-fdf6e9)' }}>✍ Sign</button>
        )}
        {onShare && <button type="button" onClick={() => onShare(doc)} style={{ ...btnStyle(isMobile), background: '#c9922c', color: '#fff', border: 'none' }}>Share</button>}
      </header>
      {status === 'denied' && (
        <div style={{ background: 'var(--k-fffbeb)', color: 'var(--k-92400e)', padding: '8px 16px', fontSize: 13, borderBottom: '1px solid var(--k-fde68a)' }}>
          Live editing isn’t available for you on this document. What you type is saved, but others won’t see it until they reload.
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {handle ? (
          <DocSurface handle={handle} authToken={authToken} me={me} userId={user.id} isMobile={isMobile} onEditor={setEditor}
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
        {panel === 'activity' && (
          <ActivityPanel docId={doc.id} authToken={authToken} me={user} people={people} isMobile={isMobile} onToast={onToast} onClose={() => setPanel(null)} />
        )}
        {handle && panel === 'history' && (
          <HistoryPanel docId={doc.id} authToken={authToken} me={user} people={people} isMobile={isMobile} onToast={onToast} onClose={() => setPanel(null)} ydoc={handle.ydoc} flush={() => flushRef.current()} />
        )}
      </div>
    </Frame>
  );
}

function DocSurface({ handle, authToken, me, userId, isMobile, onEditor, onComment, onHighlightClick }: { handle: CollabHandle; authToken?: string; me: Peer; userId: string; isMobile: boolean; onEditor: (e: Editor | null) => void; onComment: () => void; onHighlightClick: () => void }) {
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
    shouldRerenderOnTransaction: true, // the toolbar reads editor.isActive() while rendering (TipTap 3 stopped re-rendering on every transaction by default)
    extensions: [
      ...docExtensions(),
      SuggestTracking, FindReplace,
      Placeholder.configure({ placeholder: 'Start typing — or press “/” … everyone on this doc sees it live.' }),
      Collaboration.configure({ document: handle.ydoc }),
      CollaborationCaret.configure({ provider: { awareness: handle.awareness }, user: me }),
    ],
    editorProps: {
      attributes: { class: 'drive-doc', spellcheck: 'true' },
      handleClick: (_v, _pos, ev) => { if ((ev.target as HTMLElement | null)?.closest?.('.comment-hl')) clickRef.current(); return false; },
    },
  }, [handle.ydoc]);
  useEffect(() => { onEditor(editor); return () => onEditor(null); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  // Suggesting mode is per person (not shared): while on, this editor's typing / deleting / pasting is recorded as suggestions under this name.
  const [suggesting, setSuggesting] = useState(false);
  const [side, setSide] = useState<null | 'outline' | 'suggestions'>(null);
  const [findOpen, setFindOpen] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const sg = (editor.storage as unknown as { suggest: { on: boolean; author: string; authorId: string } }).suggest;
    sg.on = suggesting; sg.author = me.name; sg.authorId = userId;
  }, [editor, suggesting, me.name, userId]);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }} onKeyDownCapture={e => { if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'h')) { e.preventDefault(); setFindOpen(true); } }}>
      <Toolbar editor={editor} isMobile={isMobile} onComment={onComment} letterhead={letterhead} onLetterhead={() => handle.ydoc.getMap<unknown>('meta').set('letterhead', !letterhead)} suggesting={suggesting} onSuggesting={setSuggesting} side={side} onSide={setSide} onFind={() => setFindOpen(o => !o)} />
      {findOpen && editor && <FindBar editor={editor} isMobile={isMobile} onClose={() => { setFind(editor, '', false); setFindOpen(false); }} />}
      {suggesting && <div style={{ background: 'var(--k-f0fdf4)', color: '#15803d', borderBottom: '1px solid #bbf7d0', padding: '5px 14px', fontSize: 12.5, fontWeight: 600 }}>Suggesting — what you type or delete is shown as a suggestion for someone to accept or reject. Formatting changes apply directly.</div>}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
      {editor && side && <SidePanel editor={editor} side={side} onSide={setSide} isMobile={isMobile} />}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--k-f3f4f6)', padding: isMobile ? '0' : '24px 16px 60px' }}>
        <div style={{ maxWidth: 816, margin: '0 auto', minHeight: isMobile ? '100%' : 1056, background: 'var(--k-fff)', boxShadow: isMobile ? 'none' : '0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.05)', borderRadius: isMobile ? 0 : 4, padding: isMobile ? '18px 16px 80px' : '56px 72px 80px' }}>
          {letterhead && <LetterheadHeader />}
          <EditorContent editor={editor} />
          <DocMention editor={editor} authToken={authToken} />
          {letterhead && <LetterheadFooter />}
        </div>
      </div>
      </div>
      {editor && <WordCount editor={editor} />}
      <DocStyles />
    </div>
  );
}

/** Font size: − [size] + with any size typeable and presets in the list. Shows 11 (the document's default) when nothing is set. */
function SizeBox({ pt, isMobile, onSet }: { pt: number | undefined; isMobile: boolean; onSet: (n: number | null) => void }) {
  const shown = pt ?? 11;
  const [txt, setTxt] = useState<string | null>(null);
  const h = isMobile ? 40 : 30;
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? (DOC_SIZES.find(n => n > shown) ?? Math.min(400, Math.floor(shown) + 4)) : ([...DOC_SIZES].reverse().find(n => n < shown) ?? Math.max(1, Math.ceil(shown) - 1));
    onSet(next); setTxt(null);
  };
  const commit = () => { if (txt === null) return; const n = parseFloat(txt); setTxt(null); if (Number.isFinite(n) && n >= 1 && n <= 400) onSet(Math.round(n * 2) / 2); };
  const b = { width: isMobile ? 34 : 26, height: h, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: 0, flexShrink: 0, fontFamily: "'DM Sans',sans-serif" } as const;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      <button type="button" title="Smaller text" aria-label="Decrease font size" onMouseDown={e => e.preventDefault()} onClick={() => step(-1)} style={{ ...b, borderRadius: '6px 0 0 6px' }}>−</button>
      <input aria-label="Font size (points)" title="Font size in points — type any size, or use the list" list="dx-sizes" inputMode="decimal" value={txt ?? String(shown)}
        onFocus={e => e.currentTarget.select()} onChange={e => setTxt(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') setTxt(null); }}
        style={{ width: 42, height: h, boxSizing: 'border-box', textAlign: 'center', border: '1px solid var(--k-e5e7eb)', borderLeft: 'none', borderRight: 'none', background: 'var(--k-fff)', color: pt ? 'var(--k-1a1a1a)' : 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", padding: 0 }} />
      <datalist id="dx-sizes">{DOC_SIZES.map(n => <option key={n} value={n} />)}</datalist>
      <button type="button" title="Bigger text" aria-label="Increase font size" onMouseDown={e => e.preventDefault()} onClick={() => step(1)} style={{ ...b, borderRadius: '0 6px 6px 0' }}>+</button>
    </span>
  );
}

/** Colour picker body: full grid, recently used, and any custom colour. */
function ColorPanel({ heading, current, recent, noneLabel, isMobile, onPick, onNone }: { heading: string; current?: string; recent: string[]; noneLabel: string; isMobile: boolean; onPick: (c: string) => void; onNone: () => void }) {
  const sw = isMobile ? 30 : 24;
  const dot = (col: string, key: string) => (
    <button key={key} type="button" aria-label={`${heading} ${col}`} title={col} onMouseDown={e => e.preventDefault()} onClick={() => onPick(col)}
      style={{ width: sw, height: sw, borderRadius: 5, background: col, border: current?.toLowerCase() === col ? '2px solid var(--k-1a1a1a)' : '1px solid var(--k-d1d5db)', cursor: 'pointer', padding: 0 }} />
  );
  return (
    <div style={{ padding: 10, width: sw * 8 + 7 * 4 + 20 }}>
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={onNone} style={{ ...btnStyle(false), width: '100%', background: 'none', marginBottom: 8 }}>{noneLabel}</button>
      {COLOR_GRID.map((row, i) => <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>{row.map(col => dot(col, col))}</div>)}
      {recent.length > 0 && <>
        <div style={{ fontSize: 10.5, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, margin: '8px 0 4px' }}>Recent</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{recent.map(col => dot(col, `r${col}`))}</div>
      </>}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, fontWeight: 600, color: 'var(--k-374151)', cursor: 'pointer' }}>
        <input type="color" aria-label={`Custom ${heading.toLowerCase()} colour`} defaultValue={/^#[0-9a-f]{6}$/i.test(current ?? '') ? current : '#c9922c'} onChange={e => onPick(e.target.value)} style={{ width: 34, height: 28, padding: 0, border: '1px solid var(--k-d1d5db)', borderRadius: 6, background: 'none', cursor: 'pointer' }} />
        Custom colour…
      </label>
    </div>
  );
}

// ── toolbar ────────────────────────────────────────────────────────────────

function Toolbar({ editor, isMobile, onComment, letterhead, onLetterhead, suggesting, onSuggesting, side, onSide, onFind }: { editor: Editor | null; isMobile: boolean; onComment: () => void; letterhead: boolean; onLetterhead: () => void; suggesting: boolean; onSuggesting: (v: boolean) => void; side: null | 'outline' | 'suggestions'; onSide: (v: null | 'outline' | 'suggestions') => void; onFind: () => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [recent, setRecent] = useState<string[]>(() => { try { const j = JSON.parse(localStorage.getItem('dx-recent-colors') ?? '[]'); return Array.isArray(j) ? j.filter((x: unknown) => typeof x === 'string').slice(0, 8) : []; } catch { return []; } });
  const remember = (col: string) => setRecent(r => { const n = [col, ...r.filter(x => x !== col)].slice(0, 8); try { localStorage.setItem('dx-recent-colors', JSON.stringify(n)); } catch { /* optional */ } return n; });
  const imgInput = useRef<HTMLInputElement>(null);
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
  const block = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';
  const inTable = editor.isActive('table');
  const inList = editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList');
  const lineSp = (editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').lineSpacing as number | null | undefined) ?? null;
  const align = editor.isActive({ textAlign: 'center' }) ? 'center' : editor.isActive({ textAlign: 'right' }) ? 'right' : 'left';
  const T = ({ title, on, onClick, icon, disabled }: { title: string; on?: boolean; onClick: () => void; icon: IcoName; disabled?: boolean }) => <TBtn title={title} on={on} onClick={onClick} disabled={disabled}><Ico n={icon} /></TBtn>;
  const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const ts = editor.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string; color?: string };
  const curFont = fontByCss(ts.fontFamily)?.label ?? 'Default';
  const curPt = sizePt(ts.fontSize);
  const selStyle = { height: 30, border: '1px solid var(--k-e5e7eb)', borderRadius: 6, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 6px', flexShrink: 0, fontFamily: "'DM Sans',sans-serif" } as const;
  return (
    <div className={isMobile ? 'dx-m' : undefined} style={{ background: 'var(--k-fff)', borderBottom: '1px solid var(--k-e5e7eb)', flexShrink: 0 }}>
      <style>{SHEET_CSS}{`.dx-m .sx-btn{height:40px;min-width:38px}.dx-m select{height:40px!important}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', padding: '3px 8px', gap: 6 }}>
        <OverflowRow style={{ flex: 1, minWidth: 0 }}>
          <T title={`Undo (${MOD}Z)`} icon="undo" onClick={() => c().undo().run()} />
          <T title={`Redo (${MOD}${MOD === '⌘' ? '⇧Z' : 'Y'})`} icon="redo" onClick={() => c().redo().run()} />
          <T title={`Find and replace (${MOD}F)`} icon="search" onClick={onFind} />
          <TSep />
          <select aria-label="Text style" value={block} onChange={e => { const v = e.target.value; if (v === 'p') c().setParagraph().run(); else c().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run(); }}
            style={{ height: 30, border: '1px solid var(--k-e5e7eb)', borderRadius: 6, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 6px', flexShrink: 0, fontFamily: "'DM Sans',sans-serif" }}>
            <option value="p">Normal text</option><option value="h1">Title</option><option value="h2">Heading</option><option value="h3">Subheading</option>
          </select>
          <select aria-label="Font" title="Font" value={curFont} style={{ ...selStyle, maxWidth: 120 }}
            onChange={e => { const f = DOC_FONTS.find(x => x.label === e.target.value); if (f?.css) c().setFontFamily(f.css).run(); else c().unsetFontFamily().removeEmptyTextStyle().run(); }}>
            {DOC_FONTS.map(f => <option key={f.label} value={f.label}>{f.label}</option>)}
          </select>
          <SizeBox pt={curPt} isMobile={isMobile} onSet={n => { if (n === null) c().unsetFontSize().removeEmptyTextStyle().run(); else c().setFontSize(`${n}pt`).run(); }} />
          <TSep />
          <T title={`Bold (${MOD}B)`} icon="bold" on={editor.isActive('bold')} onClick={() => c().toggleBold().run()} />
          <T title={`Italic (${MOD}I)`} icon="italic" on={editor.isActive('italic')} onClick={() => c().toggleItalic().run()} />
          <T title={`Underline (${MOD}U)`} icon="underline" on={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()} />
          <T title={`Strikethrough (${MOD}${MOD === '⌘' ? '⇧' : 'Shift+'}S)`} icon="strike" on={editor.isActive('strike')} onClick={() => c().toggleStrike().run()} />
          <Pop className="sx-btn" title="Text color" active={!!ts.color} label={<><span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1, borderBottom: `3px solid ${ts.color ?? 'var(--k-1a1a1a)'}`, padding: '0 1px' }}>A</span><span style={{ fontSize: 9 }}>▾</span></>}>
            {close => <ColorPanel heading="Text color" current={ts.color} recent={recent} noneLabel="Automatic" isMobile={isMobile}
              onPick={col => { c().setColor(col).run(); remember(col); close(); }}
              onNone={() => { c().unsetColor().removeEmptyTextStyle().run(); close(); }} />}
          </Pop>
          <Pop className="sx-btn" title="Highlight color" active={editor.isActive('highlight')} label={<><Ico n="highlight" /><span style={{ fontSize: 9 }}>▾</span></>}>
            {close => <ColorPanel heading="Highlight" current={editor.getAttributes('highlight').color as string | undefined} recent={recent} noneLabel="No highlight" isMobile={isMobile}
              onPick={col => { c().setHighlight({ color: col }).run(); remember(col); close(); }}
              onNone={() => { c().unsetHighlight().run(); close(); }} />}
          </Pop>
          <TBtn title={`Superscript (${MOD}.)`} on={editor.isActive('superscript')} onClick={() => c().toggleMark('superscript').run()}><span style={{ fontSize: 13, fontWeight: 600 }}>x<sup style={{ fontSize: 9 }}>2</sup></span></TBtn>
          <TBtn title={`Subscript (${MOD},)`} on={editor.isActive('subscript')} onClick={() => c().toggleMark('subscript').run()}><span style={{ fontSize: 13, fontWeight: 600 }}>x<sub style={{ fontSize: 9 }}>2</sub></span></TBtn>
          <T title="Clear formatting (bold, color, size, font…)" icon="clear" onClick={() => c().unsetBold().unsetItalic().unsetUnderline().unsetStrike().unsetHighlight().unsetColor().unsetFontFamily().unsetFontSize().unsetMark('subscript').unsetMark('superscript').removeEmptyTextStyle().run()} />
          <TSep />
          <T title="Link" icon="link" on={editor.isActive('link')} onClick={openLink} />
          <T title="Insert a picture" icon="image" onClick={() => imgInput.current?.click()} />
          {editor.isActive('image') && (
            <Pop className="sx-btn" title="Picture size" active label={<><span>Size</span><span style={{ fontSize: 9 }}>▾</span></>}>
              {close => <>
                {([['Small', 200], ['Medium', 400], ['Large', 600], ['Full width', null]] as Array<[string, number | null]>).map(([l, w]) => (
                  <Item key={l} checked={(Number(editor.getAttributes('image').width) || null) === w} onClick={() => { c().updateAttributes('image', { width: w }).run(); close(); }}>{l}</Item>
                ))}
              </>}
            </Pop>
          )}
          <T title="Comment on the selected words" icon="comment" onClick={onComment} />
          <TSep />
          <T title={`Bulleted list (${MOD}${MOD === '⌘' ? '⇧' : 'Shift+'}8)`} icon="bullets" on={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()} />
          <T title={`Numbered list (${MOD}${MOD === '⌘' ? '⇧' : 'Shift+'}7)`} icon="numbered" on={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()} />
          <T title={`Checklist (${MOD}${MOD === '⌘' ? '⇧' : 'Shift+'}9)`} icon="checklist" on={editor.isActive('taskList')} onClick={() => c().toggleTaskList().run()} />
          <T title={`Quote (${MOD}${MOD === '⌘' ? '⇧' : 'Shift+'}B)`} icon="quote" on={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()} />
          <TSep />
          <Pop className="sx-btn" title="Align" label={<><Ico n={align} /><span style={{ fontSize: 9 }}>▾</span></>}>
            {close => <>
              <Item checked={align === 'left'} onClick={() => { c().setTextAlign('left').run(); close(); }}>Left</Item>
              <Item checked={align === 'center'} onClick={() => { c().setTextAlign('center').run(); close(); }}>Center</Item>
              <Item checked={align === 'right'} onClick={() => { c().setTextAlign('right').run(); close(); }}>Right</Item>
            </>}
          </Pop>
          <TBtn title="Decrease indent" onClick={() => { if (inList) c().liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run(); else c().outdentBlock().run(); }}><span style={{ fontSize: 15, lineHeight: 1 }}>⇤</span></TBtn>
          <TBtn title="Increase indent" onClick={() => { if (inList) c().sinkListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run(); else c().indentBlock().run(); }}><span style={{ fontSize: 15, lineHeight: 1 }}>⇥</span></TBtn>
          <Pop className="sx-btn" title="Line spacing" active={!!lineSp} label={<><span style={{ fontSize: 14, lineHeight: 1 }}>↕</span><span style={{ fontSize: 9 }}>▾</span></>}>
            {close => <>
              {[null, ...LINE_SPACINGS].map(v => (
                <Item key={String(v)} checked={(lineSp ?? null) === v} onClick={() => { c().setLineSpacing(v).run(); close(); }}>{v === null ? 'Default' : v === 1 ? 'Single' : v === 2 ? 'Double' : String(v)}</Item>
              ))}
            </>}
          </Pop>
          <Pop className="sx-btn" title="Table" active={inTable} label={<><Ico n="table" /><span style={{ fontSize: 9 }}>▾</span></>}>
            {close => <>
              <Item disabled={inTable} onClick={() => { c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); close(); }}>Insert a 3 × 3 table</Item>
              <Item disabled={!inTable} onClick={() => { c().addRowAfter().run(); close(); }}>Add row below</Item>
              <Item disabled={!inTable} onClick={() => { c().addColumnAfter().run(); close(); }}>Add column right</Item>
              <Item disabled={!inTable} onClick={() => { c().deleteRow().run(); close(); }}>Delete row</Item>
              <Item disabled={!inTable} onClick={() => { c().deleteColumn().run(); close(); }}>Delete column</Item>
              <Item disabled={!inTable} danger onClick={() => { c().deleteTable().run(); close(); }}>Delete table</Item>
            </>}
          </Pop>
          <T title="Divider line" icon="hr" onClick={() => c().setHorizontalRule().run()} />
          <TSep />
          <Pop className="sx-btn" title="View: outline, suggestions, letterhead" active={!!side || letterhead} label={<><Ico n="outline" />{!isMobile && <span>View</span>}<span style={{ fontSize: 9 }}>▾</span></>}>
            {close => <>
              <Item checked={side === 'outline'} onClick={() => { onSide(side === 'outline' ? null : 'outline'); close(); }}>Document outline</Item>
              <Item checked={side === 'suggestions'} onClick={() => { onSide(side === 'suggestions' ? null : 'suggestions'); close(); }}>Review suggestions</Item>
              <Item checked={letterhead} onClick={() => { onLetterhead(); close(); }}>CRECO letterhead</Item>
            </>}
          </Pop>
        </OverflowRow>
        <Pop className="sx-btn" title={suggesting ? 'Suggesting — your changes become suggestions' : 'Editing — your changes apply directly'} active={suggesting}
          style={{ border: '1px solid var(--k-e5e7eb)', padding: '0 10px', flexShrink: 0 }} align="right"
          label={<><Ico n={suggesting ? 'suggest' : 'pen'} /><span>{suggesting ? 'Suggesting' : 'Editing'}</span><span style={{ fontSize: 9 }}>▾</span></>}>
          {close => <>
            <Item checked={!suggesting} onClick={() => { onSuggesting(false); close(); }}>Editing — changes apply directly</Item>
            <Item checked={suggesting} onClick={() => { onSuggesting(true); close(); }}>Suggesting — changes are proposed for review</Item>
          </>}
        </Pop>
      </div>
      <input ref={imgInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={async e => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        try { const p = await shrinkImage(f); editor.chain().focus().insertContent({ type: 'image', attrs: { src: p.src, iw: p.w, ih: p.h, alt: f.name.replace(/\.[a-z0-9]+$/i, '') } }).run(); }
        catch (err) { window.alert((err as Error).message || 'Could not add that picture'); }
      }} />
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



/** A picture, scaled to fit the page (max 1000 px wide) and re-encoded small enough to live inside the document. */
async function shrinkImage(file: File): Promise<{ src: string; w: number; h: number }> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Use a PNG, JPG, WebP or GIF picture');
  if (file.size > 12 * 1024 * 1024) throw new Error('That picture is over 12 MB');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / bmp.width);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * scale)); cv.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = cv.getContext('2d'); if (!ctx) throw new Error('Could not read that picture');
  const keepAlpha = file.type === 'image/png' || file.type === 'image/gif';
  if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  let out = keepAlpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.85);
  for (let q = 0.75; out.length > 700_000 && q > 0.3; q -= 0.15) out = cv.toDataURL('image/jpeg', q);   // too big as PNG: fall back to JPEG
  if (out.length > 900_000) throw new Error('That picture is too detailed to put in a document — try a smaller one');
  if (!safeImageSrc(out)) throw new Error('Could not use that picture');
  return { src: out, w: cv.width, h: cv.height };
}

/** Left column: the headings outline (click to jump) or the pending suggestions (accept / reject). */
function SidePanel({ editor, side, onSide, isMobile }: { editor: Editor; side: 'outline' | 'suggestions'; onSide: (v: null | 'outline' | 'suggestions') => void; isMobile: boolean }) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(n => n + 1); editor.on('transaction', f); return () => { editor.off('transaction', f); }; }, [editor]);
  const heads: Array<{ level: number; text: string; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading' && node.textContent.trim()) heads.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos }); });
  const sugg = listSuggestions(editor);
  const tab = (id: 'outline' | 'suggestions', label: string) => (
    <button type="button" onClick={() => onSide(id)} style={{ flex: 1, minHeight: 36, border: 'none', borderBottom: `2px solid ${side === id ? '#c9922c' : 'transparent'}`, background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: side === id ? 'var(--k-a06a12)' : 'var(--k-6b7280)', fontFamily: "'DM Sans',sans-serif" }}>{label}</button>
  );
  const group = (list: Suggestion[]) => (
    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
      <button type="button" onClick={() => resolveSuggestions(editor, list, true)} style={{ height: 28, padding: '0 10px', border: 'none', borderRadius: 6, background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>✓ Accept</button>
      <button type="button" onClick={() => resolveSuggestions(editor, list, false)} style={{ height: 28, padding: '0 10px', border: '1px solid var(--k-d1d5db)', borderRadius: 6, background: 'var(--k-fff)', color: 'var(--k-374151)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>✕ Reject</button>
    </div>
  );
  return (
    <aside aria-label="Document side panel" style={{ width: isMobile ? 'min(82vw, 300px)' : 260, flexShrink: 0, borderRight: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', display: 'flex', flexDirection: 'column', minHeight: 0, ...(isMobile ? { position: 'absolute', zIndex: 20, top: 0, bottom: 0, left: 0, boxShadow: '4px 0 24px rgba(0,0,0,.18)' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--k-eef0f2)' }}>
        {tab('outline', 'Outline')}{tab('suggestions', `Suggestions${sugg.length ? ` (${sugg.length})` : ''}`)}
        <button type="button" onClick={() => onSide(null)} aria-label="Close side panel" style={{ width: 34, height: 34, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 15 }}>✕</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10 }}>
        {side === 'outline' ? (
          heads.length === 0 ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', lineHeight: 1.5 }}>Headings you add (Title, Heading, Subheading) show up here so you can jump around a long document.</div>
            : heads.map((h, i) => (
              <button key={i} type="button" onClick={() => { editor.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run(); if (isMobile) onSide(null); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: `5px 8px 5px ${8 + (h.level - 1) * 14}px`, border: 'none', borderRadius: 6, background: 'none', cursor: 'pointer', fontSize: h.level === 1 ? 13.5 : 13, fontWeight: h.level === 1 ? 700 : 500, color: 'var(--k-374151)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif" }}>{h.text}</button>
            ))
        ) : sugg.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', lineHeight: 1.5 }}>No suggestions yet. Switch the toolbar from “Editing” to “Suggesting” and your changes show up here for review.</div>
        ) : (
          <>
            <button type="button" onClick={() => resolveSuggestions(editor, sugg, true)} style={{ height: 30, width: '100%', marginBottom: 10, border: '1px solid #bbf7d0', borderRadius: 6, background: '#f0fdf4', color: '#15803d', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Accept all ({sugg.length})</button>
            {sugg.map((g, i) => (
              <div key={i} style={{ border: '1px solid var(--k-e5e7eb)', borderRadius: 8, padding: 9, marginBottom: 8 }}>
                <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{g.author} · {g.type === 'add' ? 'added' : 'deleted'}</div>
                <div style={{ fontSize: 13, marginTop: 3, overflowWrap: 'anywhere', color: g.type === 'add' ? '#15803d' : '#b91c1c', textDecoration: g.type === 'del' ? 'line-through' : 'none' }}>{g.text.length > 140 ? `${g.text.slice(0, 140)}…` : g.text}</div>
                <button type="button" onClick={() => editor.chain().focus().setTextSelection(g.from).scrollIntoView().run()} style={{ border: 'none', background: 'none', color: 'var(--k-6b7280)', fontSize: 12, cursor: 'pointer', padding: '4px 0 0' }}>Show in document</button>
                {group([g])}
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}


/** "1,204 words · 6,310 characters" (or the selection's own count while text is selected). */
function WordCount({ editor }: { editor: Editor }) {
  const { from, to, empty } = editor.state.selection;
  const text = (empty ? editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' ') : editor.state.doc.textBetween(from, to, ' ', ' ')).replace(/\uFFFC/g, ' ');
  const words = (text.match(/\S+/g) ?? []).length;
  return <div aria-live="off" style={{ flexShrink: 0, padding: '3px 14px', borderTop: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', fontSize: 11.5, color: 'var(--k-9ca3af)', display: 'flex', gap: 12 }}>
    <span>{words.toLocaleString()} word{words === 1 ? '' : 's'}</span><span>{text.length.toLocaleString()} characters</span>{!empty && <span>(selection)</span>}
  </div>;
}

/** Find & replace bar under the toolbar. Matches are highlighted in the page; Replace edits the text for everyone live. */
function FindBar({ editor, isMobile, onClose }: { editor: Editor; isMobile: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [rep, setRep] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [, force] = useState(0);
  useEffect(() => { setFind(editor, q, matchCase); force(n => n + 1); }, [q, matchCase, editor]);
  useEffect(() => { const f = () => force(n => n + 1); editor.on('transaction', f); return () => { editor.off('transaction', f); }; }, [editor]);
  const n = q ? countFind(editor) : 0;
  const inp: CSSProperties = { height: isMobile ? 40 : 30, border: '1px solid var(--k-d1d5db)', borderRadius: 6, padding: '0 9px', fontSize: 13.5, background: 'var(--k-fff)', color: 'var(--k-1a1a1a)', minWidth: 0, flex: '1 1 130px', fontFamily: "'DM Sans',sans-serif" };
  const b: CSSProperties = { ...btnStyle(isMobile), height: isMobile ? 40 : 30, padding: '0 10px', fontSize: 13 };
  return (
    <div role="search" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 10px', background: 'var(--k-fff)', borderBottom: '1px solid var(--k-e5e7eb)' }}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find" aria-label="Find" style={inp}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); stepFind(editor, e.shiftKey ? -1 : 1); } if (e.key === 'Escape') onClose(); }} />
      <span style={{ fontSize: 12, color: 'var(--k-6b7280)', minWidth: 62 }}>{q ? (n ? `${Math.min(currentFind(editor) + 1, n)} of ${n}` : 'No matches') : ''}</span>
      <button type="button" style={b} onClick={() => stepFind(editor, -1)} aria-label="Previous match" disabled={!n}>↑</button>
      <button type="button" style={b} onClick={() => stepFind(editor, 1)} aria-label="Next match" disabled={!n}>↓</button>
      <input value={rep} onChange={e => setRep(e.target.value)} placeholder="Replace with" aria-label="Replace with" style={inp} onKeyDown={e => { if (e.key === 'Escape') onClose(); }} />
      <button type="button" style={b} onClick={() => replaceOne(editor, rep)} disabled={!n}>Replace</button>
      <button type="button" style={b} onClick={() => replaceAll(editor, rep)} disabled={!n}>All</button>
      <label style={{ fontSize: 12.5, color: 'var(--k-6b7280)', display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={matchCase} onChange={e => setMatchCase(e.target.checked)} />Aa</label>
      <button type="button" style={{ ...b, background: 'none', border: 'none' }} onClick={onClose} aria-label="Close find">✕</button>
    </div>
  );
}
