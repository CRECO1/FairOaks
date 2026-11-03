'use client';

/**
 * DocsDrive — the Transaction Docs "Drive": nested folders and live documents, like Google Drive.
 * Folders are Team (everyone in the workspace) or Private (you + the people you pick); a folder linked to a deal follows that
 * deal's own visibility. Documents open in LiveDocEditor, where teammates edit together in real time.
 * Visibility is enforced in the database (supabase/drive-docs-2026-11.sql) — this component only asks and shows.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { recallView, rememberView, useRememberedSelection } from '@/lib/view-memory';
import { useBackToClose } from '@/lib/use-back-to-close';
import type { DriveDoc, DriveFolder, DriveListing, DriveTreeFolder } from '@/lib/drive-types';

const LiveDocEditor = dynamic(() => import('./LiveDocEditor'), { ssr: false });

export interface DrivePerson { id: string; first_name?: string | null; last_name?: string | null; role?: string | null }

interface Props {
  businessUnit: string;
  authToken?: string;
  currentUser: { id: string; name: string };
  profiles: DrivePerson[];
  isAdmin: boolean;
  isMobile: boolean;
  onToast: (msg: string) => void;
}

type View = 'folder' | 'recent' | 'trash' | 'search';
type Kind = 'folder' | 'doc';
type Item = DriveFolder | DriveDoc;
type Dlg =
  | { t: 'newFolder' }
  | { t: 'menu'; kind: Kind; item: Item }
  | { t: 'rename'; kind: Kind; item: Item }
  | { t: 'move'; kind: Kind; item: Item }
  | { t: 'share'; kind: Kind; item: Item }
  | { t: 'trash'; kind: Kind; item: Item }
  | { t: 'delete'; kind: Kind; item: Item };

const GOLD = '#c9922c';
const nameOf = (kind: Kind, item: Item) => (kind === 'folder' ? (item as DriveFolder).name : (item as DriveDoc).title);

function fmtWhen(iso: string) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

export default function DocsDrive({ businessUnit, authToken, currentUser, profiles, isAdmin, isMobile, onToast }: Props) {
  const [view, setView] = useState<View>('folder');
  const [folderId, setFolderId] = useState<string | null>(() => (typeof window === 'undefined' ? null : recallView(`${businessUnit}:drive-folder`)));
  const [q, setQ] = useState('');
  const [data, setData] = useState<DriveListing | null>(null);
  const [tree, setTree] = useState<DriveTreeFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [openDocId, setOpenDocId] = useState<string | null>(null);

  const headers = useMemo<Record<string, string>>(() => { const h: Record<string, string> = {}; if (authToken) h.Authorization = `Bearer ${authToken}`; return h; }, [authToken]);
  const toastRef = useRef(onToast); toastRef.current = onToast;
  const people = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles]);
  const who = (id: string | null) => { const p = id ? people.get(id) : null; return p ? `${p.first_name ?? ''} ${(p.last_name ?? '').slice(0, 1)}${p.last_name ? '.' : ''}`.trim() : '—'; };

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...headers, ...(init?.headers ?? {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error || 'Something went wrong');
    return j as T;
  }, [headers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = view === 'folder' ? `view=folder&folder=${folderId ?? 'root'}` : view === 'search' ? `view=search&q=${encodeURIComponent(q)}` : `view=${view}`;
      setData(await api<DriveListing>(`/api/crm/drive?${qs}`));
    } catch (e) {
      const msg = (e as Error).message;
      if (view === 'folder' && folderId && /not available/i.test(msg)) { setFolderId(null); rememberView(`${businessUnit}:drive-folder`, null); }
      else toastRef.current(msg || 'Could not load Docs');
      setData({ path: [], folder: null, folders: [], docs: [] });
    }
    setLoading(false);
  }, [api, view, folderId, q, businessUnit]);

  const loadTree = useCallback(async () => {
    try { setTree((await api<{ folders: DriveTreeFolder[] }>('/api/crm/drive?view=tree')).folders); } catch { /* the tree is a convenience */ }
  }, [api]);

  useEffect(() => {
    if (view === 'search') { const t = setTimeout(() => void load(), 300); return () => clearTimeout(t); }
    void load();
  }, [load, view]);
  useEffect(() => { void loadTree(); }, [loadTree]);
  useEffect(() => { if (view === 'folder') rememberView(`${businessUnit}:drive-folder`, folderId); }, [folderId, view, businessUnit]);
  useEffect(() => { // keep the folders on the current path open in the sidebar tree
    if (data?.path.length) setExpanded(prev => { const n = new Set(prev); data.path.forEach(p => n.add(p.id)); return n; });
  }, [data?.path]);

  useRememberedSelection(`${businessUnit}:drive-doc`, openDocId, true, id => setOpenDocId(id));
  useBackToClose(!!openDocId, () => setOpenDocId(null), 'crmDriveDoc', isMobile);

  const go = (id: string | null) => { setQ(''); setView('folder'); setFolderId(id); setDlg(null); };
  const refresh = () => { void load(); void loadTree(); };

  // ── actions ───────────────────────────────────────────────────────────────
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) onToast(ok); refresh(); return true; } catch (e) { onToast((e as Error).message); return false; }
  };
  const createFolder = (name: string) => act(async () => {
    await api('/api/crm/drive', { method: 'POST', body: JSON.stringify({ type: 'folder', name, parent_id: view === 'folder' ? folderId : null }) });
  }, 'Folder created').then(ok => { if (ok) setDlg(null); });
  const createDoc = async () => {
    setNewOpen(false);
    try {
      const j = await api<{ item: DriveDoc }>('/api/crm/drive', { method: 'POST', body: JSON.stringify({ type: 'doc', parent_id: view === 'folder' ? folderId : null }) });
      refresh(); setOpenDocId(j.item.id);
    } catch (e) { onToast((e as Error).message); }
  };
  const patch = (kind: Kind, item: Item, body: Record<string, unknown>, ok?: string) =>
    act(() => api(`/api/crm/drive/items/${kind}/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) }), ok);

  const canManage = (item: Item) => isAdmin || item.created_by === currentUser.id;
  const inTrash = view === 'trash';
  const folders = data?.folders ?? [];
  const docs = data?.docs ?? [];
  const empty = !loading && data && !folders.length && !docs.length;
  const openItem = (kind: Kind, item: Item) => { if (inTrash) { setDlg({ t: 'menu', kind, item }); return; } if (kind === 'folder') go(item.id); else setOpenDocId(item.id); };

  // ── tree ──────────────────────────────────────────────────────────────────
  const kids = useMemo(() => {
    const ids = new Set(tree.map(f => f.id));
    const m = new Map<string | null, DriveTreeFolder[]>();
    for (const f of tree) { const k = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null; m.set(k, [...(m.get(k) ?? []), f]); }
    return m;
  }, [tree]);

  const renderTree = (parent: string | null, depth: number): React.ReactNode =>
    (kids.get(parent) ?? []).map(f => {
      const has = (kids.get(f.id) ?? []).length > 0;
      const here = view === 'folder' && folderId === f.id;
      return (
        <div key={f.id}>
          <div onClick={() => go(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: `5px 8px 5px ${8 + depth * 14}px`, borderRadius: 7, cursor: 'pointer', background: here ? 'var(--k-fdf6e9)' : 'transparent', color: here ? 'var(--k-a06a12)' : 'var(--k-374151)', fontSize: 13.5, fontWeight: here ? 700 : 500 }}>
            <span role="button" aria-label={expanded.has(f.id) ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); if (has) setExpanded(prev => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; }); }}
              style={{ width: 16, textAlign: 'center', fontSize: 10, color: 'var(--k-9ca3af)', visibility: has ? 'visible' : 'hidden' }}>{expanded.has(f.id) ? '▾' : '▸'}</span>
            <span>{f.visibility === 'private' ? '🔒' : f.deal_id ? '💼' : '📁'}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          </div>
          {has && expanded.has(f.id) && renderTree(f.id, depth + 1)}
        </div>
      );
    });

  const navBtn = (label: string, on: boolean, onClick: () => void, icon: string) => (
    <button type="button" onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', borderRadius: 7, cursor: 'pointer', background: on ? 'var(--k-fdf6e9)' : 'transparent', color: on ? 'var(--k-a06a12)' : 'var(--k-374151)', fontSize: 14, fontWeight: on ? 700 : 600, fontFamily: "'DM Sans',sans-serif" }}>
      <span>{icon}</span>{label}
    </button>
  );

  // ── pieces ────────────────────────────────────────────────────────────────
  const accessLabel = (it: Item) => it.deal_id ? '💼 Deal team' : it.visibility === 'private' ? (it.shared_with.length ? `🔒 Shared · ${it.shared_with.length + 1}` : '🔒 Only you') : '👥 Team';
  const row = (kind: Kind, it: Item) => {
    const title = nameOf(kind, it);
    const snippet = (it as DriveDoc).snippet;
    return (
      <div key={`${kind}${it.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '6px 4px 6px 12px' : '4px 8px 4px 14px', borderBottom: '1px solid var(--k-f0f0f0)', minHeight: isMobile ? 56 : 46 }}>
        <button type="button" onClick={() => openItem(kind, it)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>{kind === 'folder' ? (it.visibility === 'private' ? '🔒' : it.deal_id ? '💼' : '📁') : '📄'}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            {(isMobile || snippet) && <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet ?? `${who(it.created_by)} · ${accessLabel(it)} · ${fmtWhen(inTrash ? (it.trashed_at ?? it.updated_at) : it.updated_at)}`}</span>}
          </span>
        </button>
        {!isMobile && <>
          <span style={{ width: 90, fontSize: 12.5, color: 'var(--k-6b7280)' }}>{who(it.created_by)}</span>
          <span style={{ width: 120, fontSize: 12.5, color: 'var(--k-6b7280)', whiteSpace: 'nowrap' }}>{accessLabel(it)}</span>
          <span style={{ width: 88, fontSize: 12.5, color: 'var(--k-6b7280)', whiteSpace: 'nowrap' }}>{fmtWhen(inTrash ? (it.trashed_at ?? it.updated_at) : it.updated_at)}</span>
        </>}
        <button type="button" aria-label={`Actions for ${title}`} onClick={() => setDlg({ t: 'menu', kind, item: it })}
          style={{ width: isMobile ? 44 : 34, height: isMobile ? 44 : 34, flexShrink: 0, border: 'none', borderRadius: 8, background: 'none', color: 'var(--k-6b7280)', fontSize: 20, cursor: 'pointer' }}>⋯</button>
      </div>
    );
  };

  const heading = view === 'recent' ? 'Recent' : view === 'trash' ? 'Trash' : view === 'search' ? 'Search results' : null;

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Sidebar (desktop) / quick switch (phone) */}
      {isMobile ? (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', width: '100%', paddingBottom: 2 }}>
          {([['Files', view === 'folder', () => go(null)], ['Recent', view === 'recent', () => { setQ(''); setView('recent'); }], ['Trash', view === 'trash', () => { setQ(''); setView('trash'); }]] as Array<[string, boolean, () => void]>).map(([l, on, fn]) => (
            <button key={l} type="button" onClick={fn} style={{ minHeight: 40, padding: '0 16px', borderRadius: 20, border: `1px solid ${on ? GOLD : 'var(--k-e5e7eb)'}`, background: on ? 'var(--k-fdf6e9)' : 'var(--k-fff)', color: on ? 'var(--k-a06a12)' : 'var(--k-374151)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', flexShrink: 0, fontFamily: "'DM Sans',sans-serif" }}>{l}</button>
          ))}
        </div>
      ) : (
        <nav aria-label="Folders" style={{ width: 230, flexShrink: 0, background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 12, padding: 8, maxHeight: '72vh', overflowY: 'auto' }}>
          {navBtn('All files', view === 'folder' && folderId === null, () => go(null), '🗂')}
          {navBtn('Recent', view === 'recent', () => { setQ(''); setView('recent'); }, '🕘')}
          {navBtn('Trash', view === 'trash', () => { setQ(''); setView('trash'); }, '🗑')}
          <div style={{ height: 1, background: 'var(--k-f0f0f0)', margin: '8px 4px' }} />
          {tree.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--k-9ca3af)', padding: '4px 10px' }}>No folders yet</div> : renderTree(null, 0)}
        </nav>
      )}

      <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
        {/* Header: breadcrumb + search + New */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, fontSize: isMobile ? 16 : 17, fontWeight: 700, color: 'var(--k-1a1a1a)' }}>
            {heading ? <span style={{ padding: '6px 4px' }}>{heading}</span> : (
              <>
                <button type="button" onClick={() => go(null)} style={crumb(folderId === null)}>All files</button>
                {(data?.path ?? []).map((p, i, arr) => (
                  <React.Fragment key={p.id}>
                    <span style={{ color: 'var(--k-9ca3af)' }}>›</span>
                    <button type="button" onClick={() => go(p.id)} style={crumb(i === arr.length - 1)}>{p.name}</button>
                  </React.Fragment>
                ))}
              </>
            )}
          </div>
          <input value={q} onChange={e => { setQ(e.target.value); setView(e.target.value.trim().length >= 2 ? 'search' : view === 'search' ? 'folder' : view); }} placeholder="🔍  Search docs" aria-label="Search documents"
            style={{ flex: isMobile ? '1 1 140px' : '0 0 220px', minWidth: 0, height: isMobile ? 44 : 36, border: '1px solid var(--k-e5e7eb)', borderRadius: 8, padding: '0 12px', fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)' }} />
          {!inTrash && (
            <div style={{ position: 'relative' }}>
              <button type="button" onClick={() => setNewOpen(o => !o)} aria-haspopup="menu" aria-expanded={newOpen}
                style={{ height: isMobile ? 44 : 36, padding: '0 18px', border: 'none', borderRadius: 8, background: GOLD, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋ New</button>
              {newOpen && (
                <>
                  <div onClick={() => setNewOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 41, minWidth: 190, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.14)', padding: 6 }}>
                    <MenuBtn onClick={() => void createDoc()} icon="📄" label="Document" isMobile={isMobile} />
                    <MenuBtn onClick={() => { setNewOpen(false); setDlg({ t: 'newFolder' }); }} icon="📁" label="Folder" isMobile={isMobile} />
                  </div>
                </>
              )}
            </div>
          )}
          {inTrash && <span style={{ fontSize: 12.5, color: 'var(--k-9ca3af)' }}>Items you delete stay here until you remove them for good.</span>}
        </div>

        {/* List */}
        <div style={{ background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 12, overflow: 'hidden' }}>
          {!isMobile && (folders.length > 0 || docs.length > 0) && (
            <div style={{ display: 'flex', gap: 10, padding: '8px 8px 8px 14px', borderBottom: '1px solid var(--k-eef0f2)', fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700 }}>
              <span style={{ flex: 1, paddingLeft: 34 }}>Name</span><span style={{ width: 90 }}>Owner</span><span style={{ width: 120 }}>Access</span><span style={{ width: 88 }}>{inTrash ? 'Deleted' : 'Modified'}</span><span style={{ width: 34 }} />
            </div>
          )}
          {loading && !data && <div style={{ padding: 28, color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading…</div>}
          {folders.map(f => row('folder', f))}
          {docs.map(d => row('doc', d))}
          {empty && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--k-9ca3af)', fontSize: 14, lineHeight: 1.6 }}>
              {view === 'trash' ? 'The trash is empty.' : view === 'search' ? 'Nothing matches that search.' : view === 'recent' ? 'No documents yet.' : (
                <>This folder is empty.<br />Use <b>＋ New</b> to add a document or a folder.</>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      {dlg?.t === 'newFolder' && <NameDialog title="New folder" cta="Create" initial="" isMobile={isMobile} onClose={() => setDlg(null)} onSubmit={name => void createFolder(name)} />}
      {dlg?.t === 'rename' && <NameDialog title="Rename" cta="Save" initial={nameOf(dlg.kind, dlg.item)} isMobile={isMobile} onClose={() => setDlg(null)}
        onSubmit={name => void patch(dlg.kind, dlg.item, dlg.kind === 'folder' ? { name } : { title: name }, 'Renamed').then(ok => { if (ok) setDlg(null); })} />}
      {dlg?.t === 'menu' && (
        <Modal title={nameOf(dlg.kind, dlg.item)} isMobile={isMobile} onClose={() => setDlg(null)}>
          {inTrash ? (
            <>
              <MenuBtn icon="↩" label="Restore" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); void patch(d.kind, d.item, { trash: false }, 'Restored'); }} />
              {canManage(dlg.item) && <MenuBtn icon="🗑" label="Delete forever" danger isMobile={isMobile} onClick={() => setDlg({ t: 'delete', kind: dlg.kind, item: dlg.item })} />}
            </>
          ) : (
            <>
              <MenuBtn icon="↗" label="Open" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); openItem(d.kind, d.item); }} />
              <MenuBtn icon="✎" label="Rename" isMobile={isMobile} onClick={() => setDlg({ t: 'rename', kind: dlg.kind, item: dlg.item })} />
              <MenuBtn icon="📁" label="Move to…" isMobile={isMobile} onClick={() => setDlg({ t: 'move', kind: dlg.kind, item: dlg.item })} />
              <MenuBtn icon="👥" label="Share…" isMobile={isMobile} onClick={() => setDlg({ t: 'share', kind: dlg.kind, item: dlg.item })} />
              <MenuBtn icon="🗑" label="Move to trash" danger isMobile={isMobile} onClick={() => setDlg({ t: 'trash', kind: dlg.kind, item: dlg.item })} />
            </>
          )}
        </Modal>
      )}
      {dlg?.t === 'trash' && (
        <Modal title="Move to trash?" isMobile={isMobile} onClose={() => setDlg(null)}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--k-4b5563)', lineHeight: 1.55 }}>
            “{nameOf(dlg.kind, dlg.item)}”{dlg.kind === 'folder' ? ' and everything inside it' : ''} will go to the trash. You can restore {dlg.kind === 'folder' ? 'it' : 'it'} from there.
          </p>
          <DialogButtons isMobile={isMobile} onCancel={() => setDlg(null)} cta="Move to trash" danger onSubmit={() => { const d = dlg; setDlg(null); void patch(d.kind, d.item, { trash: true }, 'Moved to trash'); }} />
        </Modal>
      )}
      {dlg?.t === 'delete' && (
        <Modal title="Delete forever?" isMobile={isMobile} onClose={() => setDlg(null)}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--k-4b5563)', lineHeight: 1.55 }}>“{nameOf(dlg.kind, dlg.item)}”{dlg.kind === 'folder' ? ' and everything inside it' : ''} will be permanently deleted. This can’t be undone.</p>
          <DialogButtons isMobile={isMobile} onCancel={() => setDlg(null)} cta="Delete forever" danger
            onSubmit={() => { const d = dlg; setDlg(null); void act(() => api(`/api/crm/drive/items/${d.kind}/${d.item.id}`, { method: 'DELETE' }), 'Deleted'); }} />
        </Modal>
      )}
      {dlg?.t === 'move' && <MoveDialog kind={dlg.kind} item={dlg.item} tree={tree} kids={kids} isMobile={isMobile} onClose={() => setDlg(null)}
        onPick={dest => void patch(dlg.kind, dlg.item, { move: { parent_id: dest } }, 'Moved').then(ok => { if (ok) setDlg(null); })} />}
      {dlg?.t === 'share' && <ShareDialog kind={dlg.kind} item={dlg.item} people={profiles.filter(p => p.id !== currentUser.id)} can={canManage(dlg.item)} isMobile={isMobile} who={who} onClose={() => setDlg(null)}
        onSave={(visibility, shared_with) => void patch(dlg.kind, dlg.item, { share: { visibility, shared_with } }, 'Sharing updated').then(ok => { if (ok) setDlg(null); })} />}

      {openDocId && (
        <LiveDocEditor docId={openDocId} authToken={authToken} user={currentUser} isMobile={isMobile}
          onClose={() => { setOpenDocId(null); refresh(); }}
          onShare={doc => { if (canManage(doc)) setDlg({ t: 'share', kind: 'doc', item: doc }); else onToast('Only the owner or an admin can change who this is shared with'); }}
          onToast={onToast}
          onTitle={(id, title) => setData(prev => prev ? { ...prev, docs: prev.docs.map(d => d.id === id ? { ...d, title } : d) } : prev)} />
      )}
    </div>
  );
}

const crumb = (current: boolean): React.CSSProperties => ({ background: 'none', border: 'none', padding: '6px 6px', borderRadius: 6, cursor: current ? 'default' : 'pointer', fontSize: 'inherit', fontWeight: current ? 700 : 600, color: current ? 'var(--k-1a1a1a)' : 'var(--k-6b7280)', fontFamily: "'DM Sans',sans-serif", maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

function MenuBtn({ icon, label, onClick, danger, isMobile }: { icon: string; label: string; onClick: () => void; danger?: boolean; isMobile: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', minHeight: isMobile ? 48 : 38, padding: '0 12px', border: 'none', borderRadius: 8, background: 'none', cursor: 'pointer', fontSize: 14.5, fontWeight: 600, color: danger ? 'var(--k-dc2626)' : 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--k-fbf8f1)')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
      <span style={{ width: 22, textAlign: 'center' }}>{icon}</span>{label}
    </button>
  );
}

/** Centred dialog on desktop, bottom sheet on phones. */
function Modal({ title, isMobile, onClose, children }: { title: string; isMobile: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.5)', zIndex: 1200, display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 20 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={title}
        style={{ background: 'var(--k-fff)', width: '100%', maxWidth: isMobile ? '100%' : 460, maxHeight: isMobile ? '88dvh' : '82vh', display: 'flex', flexDirection: 'column', borderRadius: isMobile ? '18px 18px 0 0' : 14, boxShadow: '0 20px 60px rgba(0,0,0,.25)', paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--k-eef0f2)', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: isMobile ? 40 : 30, height: isMobile ? 40 : 30, border: 'none', borderRadius: 8, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 14, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>
      </div>
    </div>
  );
}

function DialogButtons({ isMobile, onCancel, onSubmit, cta, danger, disabled }: { isMobile: boolean; onCancel: () => void; onSubmit: () => void; cta: string; danger?: boolean; disabled?: boolean }) {
  const h = isMobile ? 46 : 36;
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
      <button type="button" onClick={onCancel} style={{ height: h, padding: '0 16px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
      <button type="button" onClick={onSubmit} disabled={disabled} style={{ height: h, padding: '0 18px', border: 'none', borderRadius: 8, background: danger ? '#dc2626' : GOLD, color: '#fff', fontWeight: 700, fontSize: 14, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .5 : 1 }}>{cta}</button>
    </div>
  );
}

function NameDialog({ title, cta, initial, isMobile, onClose, onSubmit }: { title: string; cta: string; initial: string; isMobile: boolean; onClose: () => void; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Modal title={title} isMobile={isMobile} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); if (v.trim()) onSubmit(v.trim()); }}>
        <input autoFocus value={v} onChange={e => setV(e.target.value)} maxLength={200} placeholder="Name" onFocus={e => e.currentTarget.select()}
          style={{ width: '100%', boxSizing: 'border-box', height: isMobile ? 48 : 38, border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '0 12px', fontSize: 15, marginBottom: 14, background: 'var(--k-fff)', color: 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }} />
        <DialogButtons isMobile={isMobile} onCancel={onClose} cta={cta} disabled={!v.trim()} onSubmit={() => { if (v.trim()) onSubmit(v.trim()); }} />
      </form>
    </Modal>
  );
}

function MoveDialog({ kind, item, tree, kids, isMobile, onClose, onPick }: { kind: Kind; item: Item; tree: DriveTreeFolder[]; kids: Map<string | null, DriveTreeFolder[]>; isMobile: boolean; onClose: () => void; onPick: (dest: string | null) => void }) {
  // A folder can't go inside itself or anything under it.
  const blocked = useMemo(() => {
    const s = new Set<string>();
    if (kind === 'folder') { const walk = (id: string) => { s.add(id); (kids.get(id) ?? []).forEach(k => walk(k.id)); }; walk(item.id); }
    return s;
  }, [kind, item.id, kids]);
  const current = kind === 'folder' ? (item as DriveFolder).parent_id : (item as DriveDoc).folder_id;
  const [sel, setSel] = useState<string | null | undefined>(undefined);
  const dest = sel === undefined ? undefined : tree.find(f => f.id === sel);
  const render = (parent: string | null, depth: number): React.ReactNode => (kids.get(parent) ?? []).map(f => (
    <div key={f.id}>
      <button type="button" disabled={blocked.has(f.id)} onClick={() => setSel(f.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', minHeight: isMobile ? 46 : 34, padding: `0 10px 0 ${10 + depth * 18}px`, border: 'none', borderRadius: 8, background: sel === f.id ? 'var(--k-fdf6e9)' : 'none', color: blocked.has(f.id) ? 'var(--k-d1d5db)' : 'var(--k-1a1a1a)', fontSize: 14, fontWeight: sel === f.id ? 700 : 500, cursor: blocked.has(f.id) ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
        <span>{f.visibility === 'private' ? '🔒' : f.deal_id ? '💼' : '📁'}</span><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
      </button>
      {render(f.id, depth + 1)}
    </div>
  ));
  return (
    <Modal title={`Move “${nameOf(kind, item)}”`} isMobile={isMobile} onClose={onClose}>
      <button type="button" onClick={() => setSel(null)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', minHeight: isMobile ? 46 : 34, padding: '0 10px', border: 'none', borderRadius: 8, background: sel === null ? 'var(--k-fdf6e9)' : 'none', fontSize: 14, fontWeight: sel === null ? 700 : 600, cursor: 'pointer', color: 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }}>🗂 All files (top level)</button>
      {render(null, 0)}
      {dest && (dest.visibility !== item.visibility || dest.deal_id !== item.deal_id) && (
        <p style={{ fontSize: 12.5, color: 'var(--k-92400e)', background: 'var(--k-fffbeb)', border: '1px solid var(--k-fde68a)', borderRadius: 8, padding: '8px 10px', margin: '10px 0 0', lineHeight: 1.5 }}>
          It will take on that folder’s sharing{dest.visibility === 'private' ? ' (private)' : dest.deal_id ? ' (only people on that deal)' : ' (everyone on the team)'}.
        </p>
      )}
      <div style={{ marginTop: 14 }}>
        <DialogButtons isMobile={isMobile} onCancel={onClose} cta="Move here" disabled={sel === undefined || sel === current} onSubmit={() => sel !== undefined && onPick(sel)} />
      </div>
    </Modal>
  );
}

function ShareDialog({ kind, item, people, can, isMobile, who, onClose, onSave }: { kind: Kind; item: Item; people: DrivePerson[]; can: boolean; isMobile: boolean; who: (id: string | null) => string; onClose: () => void; onSave: (v: 'team' | 'private', shared: string[]) => void }) {
  const [vis, setVis] = useState<'team' | 'private'>(item.visibility);
  const [picked, setPicked] = useState<Set<string>>(new Set(item.shared_with));
  const radio = (v: 'team' | 'private', label: string, sub: string) => (
    <label key={v} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: `1px solid ${vis === v ? GOLD : 'var(--k-e5e7eb)'}`, borderRadius: 10, background: vis === v ? 'var(--k-fdf6e9)' : 'var(--k-fff)', cursor: can ? 'pointer' : 'default', minHeight: isMobile ? 56 : undefined }}>
      <input type="radio" name="vis" checked={vis === v} disabled={!can} onChange={() => setVis(v)} style={{ marginTop: 3, accentColor: GOLD, width: 18, height: 18 }} />
      <span><span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--k-1a1a1a)' }}>{label}</span><span style={{ display: 'block', fontSize: 12.5, color: 'var(--k-6b7280)', marginTop: 1 }}>{sub}</span></span>
    </label>
  );
  return (
    <Modal title={`Share “${nameOf(kind, item)}”`} isMobile={isMobile} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {radio('team', 'Everyone on the team', 'Anyone in the workspace can open and edit it.')}
        {radio('private', 'Only people I choose', `You${' '}and the people you pick below. The account owner can always open it.`)}
      </div>
      {vis === 'private' && (
        <div style={{ marginTop: 12, border: '1px solid var(--k-e5e7eb)', borderRadius: 10, overflow: 'hidden' }}>
          {people.length === 0 && <div style={{ padding: 12, fontSize: 13, color: 'var(--k-9ca3af)' }}>No other teammates.</div>}
          {people.map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', minHeight: isMobile ? 48 : 38, borderBottom: '1px solid var(--k-f0f0f0)', cursor: can ? 'pointer' : 'default', fontSize: 14, color: 'var(--k-1a1a1a)' }}>
              <input type="checkbox" disabled={!can} checked={picked.has(p.id)} onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} style={{ accentColor: GOLD, width: 18, height: 18 }} />
              <span style={{ flex: 1 }}>{`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || who(p.id)}</span>
              {p.role && <span style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{p.role === 'super_admin' ? 'owner' : p.role}</span>}
            </label>
          ))}
        </div>
      )}
      {item.deal_id && <p style={{ fontSize: 12.5, color: 'var(--k-6b7280)', margin: '10px 0 0', lineHeight: 1.5 }}>💼 This is linked to a deal, so only people on that deal can open it, whichever you choose.</p>}
      {kind === 'folder' && can && <p style={{ fontSize: 12.5, color: 'var(--k-6b7280)', margin: '10px 0 0', lineHeight: 1.5 }}>This applies to everything inside the folder too.</p>}
      <div style={{ marginTop: 14 }}>
        {can
          ? <DialogButtons isMobile={isMobile} onCancel={onClose} cta="Save" onSubmit={() => onSave(vis, vis === 'private' ? [...picked] : [])} />
          : <p style={{ fontSize: 13, color: 'var(--k-6b7280)', margin: 0 }}>Only the owner ({who(item.created_by)}) or an admin can change this.</p>}
      </div>
    </Modal>
  );
}
