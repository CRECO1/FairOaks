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
import DocPreviewModal from '../DocPreviewModal';
import type { DriveDoc, DriveFile, DriveFolder, DriveFormItem, DriveListing, DriveTreeFolder } from '@/lib/drive-types';
import { DRIVE_FILE_MAX } from '@/lib/drive-types';

const LiveDocEditor = dynamic(() => import('./LiveDocEditor'), { ssr: false });
const DocQuickView = dynamic(() => import('./DocQuickView'), { ssr: false });
const TransactionDocEditor = dynamic(() => import('../TransactionDocEditor'), { ssr: false });

export interface DrivePerson { id: string; first_name?: string | null; last_name?: string | null; role?: string | null }

/** A deal the signed-in user can see (for "Add to a deal…"). */
export interface DriveDealLite { id: string; client?: string; property?: string; type?: string; stage?: string }

interface Props {
  deals?: DriveDealLite[];
  businessUnit: string;
  authToken?: string;
  currentUser: { id: string; name: string };
  profiles: DrivePerson[];
  isAdmin: boolean;
  isMobile: boolean;
  onToast: (msg: string) => void;
}

type View = 'folder' | 'recent' | 'trash' | 'search' | 'templates';
type Kind = 'folder' | 'doc' | 'file' | 'form';
type Item = DriveFolder | DriveDoc | DriveFile | DriveFormItem;
type Dlg =
  | { t: 'newFolder' }
  | { t: 'menu'; kind: Kind; item: Item }
  | { t: 'rename'; kind: Kind; item: Item }
  | { t: 'move'; kind: Kind; item: Item }
  | { t: 'share'; kind: Kind; item: Item }
  | { t: 'trash'; kind: Kind; item: Item }
  | { t: 'delete'; kind: Kind; item: Item }
  | { t: 'toDeal'; kind: Kind; item: Item }
  | { t: 'form' }
  | { t: 'template' }
  | { t: 'saveTpl'; item: DriveDoc };

const GOLD = '#c9922c';
const nameOf = (kind: Kind, item: Item) => (kind === 'doc' || kind === 'form' ? (item as DriveDoc | DriveFormItem).title : (item as DriveFolder | DriveFile).name);
const fileIcon = (f: DriveFile) => { const n = f.name.toLowerCase(); return f.mime === 'application/pdf' || n.endsWith('.pdf') ? '📕' : f.mime?.startsWith('image/') ? '🖼' : /\.(xlsx?|csv)$/.test(n) ? '📊' : /\.(docx?)$/.test(n) ? '📝' : /\.(pptx?)$/.test(n) ? '📙' : '📎'; };
const fmtSize = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function fmtWhen(iso: string) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

export default function DocsDrive({ deals = [], businessUnit, authToken, currentUser, profiles, isAdmin, isMobile, onToast }: Props) {
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
  const [quickDocId, setQuickDocId] = useState<string | null>(null);   // the quick-look side panel
  const [preview, setPreview] = useState<{ url: string; name: string; type?: string | null } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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
  // A copy of a template, in the folder you are looking at (or at the top level when you aren't in a folder), opened straight away.
  const startFromTemplate = async (templateId: string) => {
    setDlg(null); setNewOpen(false);
    try {
      const j = await api<{ item: DriveDoc }>('/api/crm/drive', { method: 'POST', body: JSON.stringify({ type: 'doc', template_id: templateId, parent_id: view === 'folder' ? folderId : null }) });
      refresh(); setOpenDocId(j.item.id);
    } catch (e) { onToast((e as Error).message); }
  };
  const saveAsTemplate = (doc: DriveDoc, title: string) => act(async () => {
    await api('/api/crm/drive', { method: 'POST', body: JSON.stringify({ type: 'doc', from_doc_id: doc.id, as_template: true, title }) });
  }, 'Saved as a template — find it under Templates').then(ok => { if (ok) setDlg(null); });
  const patch = (kind: Kind, item: Item, body: Record<string, unknown>, ok?: string) =>
    act(() => api(`/api/crm/drive/items/${kind}/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) }), ok);

  const canManage = (item: Item) => isAdmin || item.created_by === currentUser.id;
  const inTrash = view === 'trash';
  const folders = data?.folders ?? [];
  const docs = data?.docs ?? [];
  const files = data?.files ?? [];
  const forms = data?.forms ?? [];
  const empty = !loading && data && !folders.length && !docs.length && !files.length && !forms.length;
  // Forms are always shared with the team, so they can only be added somewhere the team can see.
  const canAddForm = view !== 'folder' || !data?.folder || (data.folder.visibility === 'team' && !data.folder.deal_id);
  const [formEditor, setFormEditor] = useState<{ form: { id: string; name: string }; url: string; submissionId: string } | null>(null);
  // Put a COPY of a document or file on a deal card's Docs tab: a live document goes as a PDF snapshot (with its letterhead), an uploaded
  // file as itself. It uses the deal's normal file upload, so the deal's own access rules apply and an identical file is not added twice.
  const addToDeal = async (kind: Kind, item: Item, deal: DriveDealLite) => {
    setDlg(null);
    const label = [deal.client, deal.property].filter(Boolean).join(' · ') || 'the deal';
    onToast(`Adding to ${label}…`);
    try {
      if (kind === 'form') {
        await api(`/api/crm/drive/forms/${item.id}/to-deal`, { method: 'POST', body: JSON.stringify({ deal_id: deal.id }) });
        onToast(`Added to ${label} — see its Docs tab (it’s a separate copy)`);
        return;
      }
      let blob: Blob, name: string;
      if (kind === 'doc') {
        const [{ loadDocJson }, { docToPdf, pdfName }] = await Promise.all([import('./doc-export'), import('@/lib/doc-pdf')]);
        const j = await loadDocJson(item.id, authToken);
        name = pdfName(j.title);
        blob = new Blob([(await docToPdf(j.json, j.title, { letterhead: j.letterhead })) as BlobPart], { type: 'application/pdf' });
      } else {
        const f = item as DriveFile;
        if (!/\.(pdf|docx?|jpe?g|png|webp)$/i.test(f.name)) throw new Error('A deal’s Docs tab takes PDF, Word, JPG, PNG or WebP files — this one can stay here in My Drive.');
        const j = await api<{ url: string }>(`/api/crm/drive/file/${f.id}`);
        const r = await fetch(j.url);
        if (!r.ok) throw new Error('Could not read that file');
        blob = await r.blob(); name = f.name;
      }
      if (blob.size > 25 * 1024 * 1024) throw new Error('A file must be 25 MB or smaller to go on a deal');
      const pre = await api<{ uploadUrl: string; storagePath: string; contentType: string }>('/api/crm/docs', { method: 'POST', body: JSON.stringify({ action: 'presign', dealId: deal.id, filename: name, file_size: blob.size }) });
      const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': pre.contentType }, body: blob });
      if (!put.ok) throw new Error('Could not upload the copy — try again');
      const done = await api<{ duplicate?: boolean }>('/api/crm/docs', { method: 'POST', body: JSON.stringify({ action: 'confirm', dealId: deal.id, storagePath: pre.storagePath, filename: name }) });
      onToast(done.duplicate ? `That file is already on ${label}` : `Added to ${label} — see its Docs tab`);
    } catch (e) { onToast((e as Error).message || 'Could not add it to the deal'); }
  };
  const downloadDocPdf = async (d: DriveDoc) => {
    onToast('Preparing the PDF…');
    try { const { exportDocPdf } = await import('./doc-export'); await exportDocPdf(d.id, authToken, d.title); }
    catch (e) { onToast((e as Error).message || 'Could not make the PDF'); }
  };
  const openFile = async (f: DriveFile) => {
    try { const j = await api<{ url: string; name: string; type?: string | null }>(`/api/crm/drive/file/${f.id}`); setPreview({ url: j.url, name: f.name, type: j.type ?? f.mime }); }
    catch (e) { onToast((e as Error).message); }
  };
  const downloadFile = async (f: DriveFile) => {
    try { const j = await api<{ url: string }>(`/api/crm/drive/file/${f.id}?download=1`); window.location.href = j.url; }
    catch (e) { onToast((e as Error).message); }
  };
  const openFormItem = async (f: DriveFormItem) => {
    if (!f.form_id) { onToast('This form has no blank to open'); return; }
    try {
      const j = await api<{ url: string }>(`/api/crm/forms/${f.form_id}/url`);
      setFormEditor({ form: { id: f.form_id, name: f.form_name || f.title }, url: j.url, submissionId: f.submission_id });
    } catch (e) { onToast((e as Error).message || 'Could not open the form'); }
  };
  const quickLookForm = async (f: DriveFormItem) => {
    try {
      const j = await api<{ url: string | null }>(`/api/crm/drive/forms/${f.id}`);
      if (j.url) setPreview({ url: j.url, name: `${f.title}.pdf`, type: 'application/pdf' });
      else onToast('That form hasn’t been saved as a PDF yet — open it and fill it in first');
    } catch (e) { onToast((e as Error).message); }
  };
  const downloadFormPdf = async (f: DriveFormItem) => {
    try {
      const j = await api<{ url: string | null }>(`/api/crm/drive/forms/${f.id}?download=1`);
      if (j.url) window.location.href = j.url; else onToast('That form hasn’t been saved as a PDF yet — open it, fill it in and Save first');
    } catch (e) { onToast((e as Error).message); }
  };
  const createForm = async (formId: string) => {
    setDlg(null);
    try {
      const j = await api<{ item: DriveFormItem }>('/api/crm/drive/forms', { method: 'POST', body: JSON.stringify({ form_id: formId, parent_id: view === 'folder' ? folderId : null }) });
      refresh(); await openFormItem(j.item);
    } catch (e) { onToast((e as Error).message); }
  };
  const openItem = (kind: Kind, item: Item) => { if (inTrash || view === 'templates') { setDlg({ t: 'menu', kind, item }); return; } if (kind === 'folder') go(item.id); else if (kind === 'doc') setOpenDocId(item.id); else if (kind === 'form') void openFormItem(item as DriveFormItem); else void openFile(item as DriveFile); };

  // Upload: the browser PUTs each file straight to storage (signed URL), then the API records it in the current folder.
  const uploadFiles = async (list: FileList | File[]) => {
    const parent = view === 'folder' ? folderId : null;
    const all = Array.from(list);
    if (!all.length) return;
    setUploading(n => n + all.length);
    let ok = 0;
    for (const file of all) {
      try {
        if (file.size > DRIVE_FILE_MAX) throw new Error(`“${file.name}” is over 50 MB`);
        const pre = await api<{ uploadUrl: string; storagePath: string; contentType: string }>('/api/crm/drive/upload', { method: 'POST', body: JSON.stringify({ action: 'presign', filename: file.name, size: file.size, parent_id: parent }) });
        const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': pre.contentType }, body: file });
        if (!put.ok) throw new Error(`Couldn’t upload “${file.name}” — try again`);
        await api('/api/crm/drive/upload', { method: 'POST', body: JSON.stringify({ action: 'confirm', storagePath: pre.storagePath, filename: file.name, parent_id: parent }) });
        ok += 1;
      } catch (e) { onToast((e as Error).message); }
      finally { setUploading(n => n - 1); }
    }
    if (ok) { onToast(ok === 1 ? 'File uploaded' : `${ok} files uploaded`); refresh(); }
  };

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
          <span style={{ fontSize: 22, flexShrink: 0 }}>{kind === 'folder' ? (it.visibility === 'private' ? '🔒' : it.deal_id ? '💼' : '📁') : kind === 'file' ? fileIcon(it as DriveFile) : kind === 'form' ? '📝' : '📄'}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            {(isMobile || snippet) && <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet ?? `${who(it.created_by)} · ${kind === 'file' && (it as DriveFile).size ? `${fmtSize((it as DriveFile).size)} · ` : ''}${kind === 'form' ? `${(it as DriveFormItem).form_code ? `${(it as DriveFormItem).form_code} · ` : ''}${(it as DriveFormItem).has_pdf ? 'saved' : 'in progress'} · ` : ''}${accessLabel(it)} · ${fmtWhen(inTrash ? (it.trashed_at ?? it.updated_at) : it.updated_at)}`}</span>}
          </span>
        </button>
        {!isMobile && <>
          <span style={{ width: 90, fontSize: 12.5, color: 'var(--k-6b7280)' }}>{who(it.created_by)}</span>
          <span style={{ width: 120, fontSize: 12.5, color: 'var(--k-6b7280)', whiteSpace: 'nowrap' }}>{accessLabel(it)}</span>
          <span style={{ width: 88, fontSize: 12.5, color: 'var(--k-6b7280)', whiteSpace: 'nowrap' }}>{fmtWhen(inTrash ? (it.trashed_at ?? it.updated_at) : it.updated_at)}</span>
        </>}
        {kind === 'doc' && !isMobile && !inTrash && (
          <button type="button" aria-label={`Quick look at ${title}`} title="Quick look — preview without opening" onClick={() => setQuickDocId(it.id)}
            style={{ width: 34, height: 34, flexShrink: 0, border: 'none', borderRadius: 8, background: 'none', color: 'var(--k-9ca3af)', fontSize: 16, cursor: 'pointer' }}>👁</button>
        )}
        <button type="button" aria-label={`Actions for ${title}`} onClick={() => setDlg({ t: 'menu', kind, item: it })}
          style={{ width: isMobile ? 44 : 34, height: isMobile ? 44 : 34, flexShrink: 0, border: 'none', borderRadius: 8, background: 'none', color: 'var(--k-6b7280)', fontSize: 20, cursor: 'pointer' }}>⋯</button>
      </div>
    );
  };

  const heading = view === 'recent' ? 'Recent' : view === 'trash' ? 'Trash' : view === 'templates' ? 'Templates' : view === 'search' ? 'Search results' : null;

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Sidebar (desktop) / quick switch (phone) */}
      {isMobile ? (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', width: '100%', paddingBottom: 2 }}>
          {([['Files', view === 'folder', () => go(null)], ['Recent', view === 'recent', () => { setQ(''); setView('recent'); }], ['Templates', view === 'templates', () => { setQ(''); setView('templates'); }], ['Trash', view === 'trash', () => { setQ(''); setView('trash'); }]] as Array<[string, boolean, () => void]>).map(([l, on, fn]) => (
            <button key={l} type="button" onClick={fn} style={{ minHeight: 40, padding: '0 16px', borderRadius: 20, border: `1px solid ${on ? GOLD : 'var(--k-e5e7eb)'}`, background: on ? 'var(--k-fdf6e9)' : 'var(--k-fff)', color: on ? 'var(--k-a06a12)' : 'var(--k-374151)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', flexShrink: 0, fontFamily: "'DM Sans',sans-serif" }}>{l}</button>
          ))}
        </div>
      ) : (
        <nav aria-label="Folders" style={{ width: 230, flexShrink: 0, background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 12, padding: 8, maxHeight: '72vh', overflowY: 'auto' }}>
          {navBtn('All files', view === 'folder' && folderId === null, () => go(null), '🗂')}
          {navBtn('Recent', view === 'recent', () => { setQ(''); setView('recent'); }, '🕘')}
          {navBtn('Templates', view === 'templates', () => { setQ(''); setView('templates'); }, '📋')}
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
          {!inTrash && view !== 'templates' && (
            <div style={{ position: 'relative' }}>
              <button type="button" onClick={() => setNewOpen(o => !o)} aria-haspopup="menu" aria-expanded={newOpen}
                style={{ height: isMobile ? 44 : 36, padding: '0 18px', border: 'none', borderRadius: 8, background: GOLD, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋ New</button>
              {newOpen && (
                <>
                  <div onClick={() => setNewOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 41, minWidth: 190, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.14)', padding: 6 }}>
                    <MenuBtn onClick={() => void createDoc()} icon="📄" label="Document" isMobile={isMobile} />
                    <MenuBtn onClick={() => { setNewOpen(false); setDlg({ t: 'template' }); }} icon="📋" label="From template…" isMobile={isMobile} />
                    <MenuBtn onClick={() => { setNewOpen(false); setDlg({ t: 'newFolder' }); }} icon="📁" label="Folder" isMobile={isMobile} />
                    <MenuBtn onClick={() => { setNewOpen(false); if (!canAddForm) { onToast('Forms can only be added to team folders (not private ones)'); return; } setDlg({ t: 'form' }); }} icon="📝" label="Form…" isMobile={isMobile} />
                    <MenuBtn onClick={() => { setNewOpen(false); fileInput.current?.click(); }} icon="⬆" label="Upload files" isMobile={isMobile} />
                  </div>
                </>
              )}
            </div>
          )}
          {inTrash && <span style={{ fontSize: 12.5, color: 'var(--k-9ca3af)' }}>Items you delete stay here until you remove them for good.</span>}
          {view === 'templates' && <span style={{ fontSize: 12.5, color: 'var(--k-9ca3af)' }}>Click a template to use it. To add one: open any document, then ⋯ → Save as template.</span>}
        </div>

        {/* List */}
        <div onDragOver={e => { if (!inTrash && view === 'folder' && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }} onDragLeave={() => setDragOver(false)}
          onDrop={e => { setDragOver(false); if (!inTrash && view === 'folder' && e.dataTransfer.files.length) { e.preventDefault(); void uploadFiles(e.dataTransfer.files); } }}
          style={{ background: 'var(--k-fff)', border: `1px ${dragOver ? 'dashed' : 'solid'} ${dragOver ? GOLD : '#eef0f2'}`, outline: dragOver ? `3px solid ${GOLD}33` : 'none', borderRadius: 12, overflow: 'hidden' }}>
          {!isMobile && (folders.length > 0 || docs.length > 0 || files.length > 0 || forms.length > 0) && (
            <div style={{ display: 'flex', gap: 10, padding: '8px 8px 8px 14px', borderBottom: '1px solid var(--k-eef0f2)', fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700 }}>
              <span style={{ flex: 1, paddingLeft: 34 }}>Name</span><span style={{ width: 90 }}>Owner</span><span style={{ width: 120 }}>Access</span><span style={{ width: 88 }}>{inTrash ? 'Deleted' : 'Modified'}</span><span style={{ width: 34 }} />
            </div>
          )}
          {loading && !data && <div style={{ padding: 28, color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading…</div>}
          {uploading > 0 && <div style={{ padding: '10px 16px', fontSize: 13, color: 'var(--k-a06a12)', background: 'var(--k-fdf6e9)', borderBottom: '1px solid var(--k-f0e2c4)' }}>⬆ Uploading {uploading} file{uploading === 1 ? '' : 's'}…</div>}
          {folders.map(f => row('folder', f))}
          {docs.map(d => row('doc', d))}
          {forms.map(f => row('form', f))}
          {files.map(f => row('file', f))}
          {empty && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--k-9ca3af)', fontSize: 14, lineHeight: 1.6 }}>
              {view === 'trash' ? 'The trash is empty.' : view === 'templates' ? 'No templates yet.' : view === 'search' ? 'Nothing matches that search.' : view === 'recent' ? 'No documents yet.' : (
                <>This folder is empty.<br />Use <b>＋ New</b> to add a document, a folder or a file{isMobile ? '' : ' — or drop files here'}.</>
              )}
            </div>
          )}
        </div>
      </div>

      <input ref={fileInput} type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.txt" onChange={e => { if (e.target.files?.length) void uploadFiles(e.target.files); e.target.value = ''; }} />

      {/* Dialogs */}
      {dlg?.t === 'form' && <FormPicker api={api} businessUnit={businessUnit} isMobile={isMobile} onClose={() => setDlg(null)} onPick={id => void createForm(id)} />}
      {dlg?.t === 'toDeal' && <DealPicker deals={deals} isMobile={isMobile} title={nameOf(dlg.kind, dlg.item)} onClose={() => setDlg(null)} onPick={d => void addToDeal(dlg.kind, dlg.item, d)} />}
      {dlg?.t === 'template' && <TemplatePicker api={api} isMobile={isMobile} onClose={() => setDlg(null)} onPick={id => void startFromTemplate(id)} />}
      {dlg?.t === 'saveTpl' && <NameDialog title="Save as template" cta="Save template" initial={dlg.item.title} isMobile={isMobile} onClose={() => setDlg(null)} onSubmit={name => void saveAsTemplate(dlg.item, name)} />}
      {dlg?.t === 'newFolder' && <NameDialog title="New folder" cta="Create" initial="" isMobile={isMobile} onClose={() => setDlg(null)} onSubmit={name => void createFolder(name)} />}
      {dlg?.t === 'rename' && <NameDialog title="Rename" cta="Save" initial={nameOf(dlg.kind, dlg.item)} isMobile={isMobile} onClose={() => setDlg(null)}
        onSubmit={name => void patch(dlg.kind, dlg.item, dlg.kind === 'doc' ? { title: name } : { name }, 'Renamed').then(ok => { if (ok) setDlg(null); })} />}
      {dlg?.t === 'menu' && (
        <Modal title={nameOf(dlg.kind, dlg.item)} isMobile={isMobile} onClose={() => setDlg(null)}>
          {inTrash ? (
            <>
              <MenuBtn icon="↩" label="Restore" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); void patch(d.kind, d.item, { trash: false }, 'Restored'); }} />
              {canManage(dlg.item) && <MenuBtn icon="🗑" label={dlg.kind === 'form' ? 'Remove from My Drive' : 'Delete forever'} danger isMobile={isMobile} onClick={() => setDlg({ t: 'delete', kind: dlg.kind, item: dlg.item })} />}
            </>
          ) : (
            <>
              {dlg.kind === 'doc' && (dlg.item as DriveDoc).is_template && <MenuBtn icon="📋" label="Use this template" isMobile={isMobile} onClick={() => void startFromTemplate(dlg.item.id)} />}
              <MenuBtn icon="↗" label={dlg.kind === 'doc' && (dlg.item as DriveDoc).is_template ? 'Edit the template' : 'Open'} isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); if (d.kind === 'doc') setOpenDocId(d.item.id); else openItem(d.kind, d.item); }} />
              {dlg.kind === 'doc' && <MenuBtn icon="👁" label="Quick look" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); setQuickDocId(d.item.id); }} />}
              {dlg.kind === 'form' && <MenuBtn icon="👁" label="Quick look" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); void quickLookForm(d.item as DriveFormItem); }} />}
              {dlg.kind === 'form' && <MenuBtn icon="⬇" label="Download as PDF" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); void downloadFormPdf(d.item as DriveFormItem); }} />}
              {(dlg.kind === 'file' || dlg.kind === 'form' || (dlg.kind === 'doc' && !(dlg.item as DriveDoc).is_template)) && deals.length > 0 && <MenuBtn icon="💼" label="Add to a deal…" isMobile={isMobile} onClick={() => setDlg({ t: 'toDeal', kind: dlg.kind, item: dlg.item })} />}
              {dlg.kind === 'doc' && <MenuBtn icon="⬇" label="Download as PDF" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); void downloadDocPdf(d.item as DriveDoc); }} />}
              {dlg.kind === 'file' && <MenuBtn icon="↓" label="Download" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); void downloadFile(d.item as DriveFile); }} />}
              <MenuBtn icon="✎" label="Rename" isMobile={isMobile} onClick={() => setDlg({ t: 'rename', kind: dlg.kind, item: dlg.item })} />
              {!(dlg.kind === 'doc' && (dlg.item as DriveDoc).is_template) && <>
                <MenuBtn icon="📁" label="Move to…" isMobile={isMobile} onClick={() => setDlg({ t: 'move', kind: dlg.kind, item: dlg.item })} />
                {dlg.kind !== 'form' && <MenuBtn icon="👥" label="Share…" isMobile={isMobile} onClick={() => setDlg({ t: 'share', kind: dlg.kind, item: dlg.item })} />}
              </>}
              {dlg.kind === 'doc' && !(dlg.item as DriveDoc).is_template && !dlg.item.deal_id && <MenuBtn icon="📋" label="Save as template…" isMobile={isMobile} onClick={() => setDlg({ t: 'saveTpl', item: dlg.item as DriveDoc })} />}
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
        <Modal title={dlg.kind === 'form' ? 'Remove from My Drive?' : 'Delete forever?'} isMobile={isMobile} onClose={() => setDlg(null)}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--k-4b5563)', lineHeight: 1.55 }}>“{nameOf(dlg.kind, dlg.item)}”{dlg.kind === 'folder' ? ' and everything inside it' : ''} {dlg.kind === 'form' ? 'will be removed from My Drive. The saved form itself is kept — a form is never deleted from here.' : 'will be permanently deleted. This can’t be undone.'}</p>
          <DialogButtons isMobile={isMobile} onCancel={() => setDlg(null)} cta={dlg.kind === 'form' ? 'Remove' : 'Delete forever'} danger
            onSubmit={() => { const d = dlg; setDlg(null); void act(() => api(`/api/crm/drive/items/${d.kind}/${d.item.id}`, { method: 'DELETE' }), d.kind === 'form' ? 'Removed from My Drive' : 'Deleted'); }} />
        </Modal>
      )}
      {dlg?.t === 'move' && <MoveDialog kind={dlg.kind} item={dlg.item} tree={tree} kids={kids} isMobile={isMobile} onClose={() => setDlg(null)}
        onPick={dest => void patch(dlg.kind, dlg.item, { move: { parent_id: dest } }, 'Moved').then(ok => { if (ok) setDlg(null); })} />}
      {dlg?.t === 'share' && <ShareDialog kind={dlg.kind} item={dlg.item} people={profiles.filter(p => p.id !== currentUser.id)} can={canManage(dlg.item)} isMobile={isMobile} who={who} onClose={() => setDlg(null)}
        onSave={(visibility, shared_with) => void patch(dlg.kind, dlg.item, { share: { visibility, shared_with } }, 'Sharing updated').then(ok => { if (ok) setDlg(null); })} />}

      {preview && <DocPreviewModal file={preview} onClose={() => setPreview(null)} />}
      {formEditor && (
        <TransactionDocEditor form={formEditor.form} url={formEditor.url} authToken={authToken} isAdmin={isAdmin} businessUnit={businessUnit} submissionId={formEditor.submissionId} isMobile={isMobile}
          onToast={onToast} onClose={() => { setFormEditor(null); refresh(); }} onSaved={refresh} />
      )}
      {quickDocId && <DocQuickView docId={quickDocId} authToken={authToken} isMobile={isMobile} onToast={onToast} onClose={() => setQuickDocId(null)} onOpen={id => { setQuickDocId(null); setOpenDocId(id); }} />}

      {openDocId && (
        <LiveDocEditor docId={openDocId} authToken={authToken} user={currentUser} isMobile={isMobile} people={profiles} isAdmin={isAdmin}
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

function TemplatePicker({ api, isMobile, onClose, onPick }: { api: <T>(path: string, init?: RequestInit) => Promise<T>; isMobile: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const [list, setList] = useState<DriveDoc[] | null>(null);
  useEffect(() => { api<DriveListing>('/api/crm/drive?view=templates').then(j => setList(j.docs)).catch(() => setList([])); }, [api]);
  return (
    <Modal title="Start from a template" isMobile={isMobile} onClose={onClose}>
      {list === null && <div style={{ padding: 10, color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading…</div>}
      {list?.length === 0 && <div style={{ padding: 10, color: 'var(--k-9ca3af)', fontSize: 14, lineHeight: 1.5 }}>No templates yet. Open any document, then ⋯ → Save as template.</div>}
      {list?.map(t => (
        <button key={t.id} type="button" onClick={() => onPick(t.id)}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', textAlign: 'left', padding: '10px 12px', minHeight: isMobile ? 56 : 48, border: 'none', borderBottom: '1px solid var(--k-f0f0f0)', background: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          <span style={{ fontSize: 22 }}>📋</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--k-1a1a1a)' }}>{t.title}</span>
            {t.snippet && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--k-6b7280)', marginTop: 2, lineHeight: 1.4 }}>{t.snippet}…</span>}
          </span>
        </button>
      ))}
    </Modal>
  );
}

function DealPicker({ deals, isMobile, title, onClose, onPick }: { deals: DriveDealLite[]; isMobile: boolean; title: string; onClose: () => void; onPick: (d: DriveDealLite) => void }) {
  const [q, setQ] = useState('');
  const live = ['Active', 'LOI', 'In Contract', 'Prospect'];
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return deals
      .filter(d => !t || `${d.client ?? ''} ${d.property ?? ''} ${d.type ?? ''}`.toLowerCase().includes(t))
      .sort((a, b) => (live.indexOf(a.stage ?? '') === -1 ? 9 : live.indexOf(a.stage ?? '')) - (live.indexOf(b.stage ?? '') === -1 ? 9 : live.indexOf(b.stage ?? '')) || (a.client ?? '').localeCompare(b.client ?? ''));
  }, [deals, q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Add to a deal" isMobile={isMobile} onClose={onClose}>
      <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--k-6b7280)', lineHeight: 1.5 }}>A copy of “{title}” goes on the deal’s Docs tab. Later changes here won’t change the copy.</p>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="🔍  Search deals" style={{ width: '100%', boxSizing: 'border-box', height: isMobile ? 46 : 36, border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '0 12px', fontSize: 14, marginBottom: 8, background: 'var(--k-fff)', color: 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }} />
      <div style={{ maxHeight: isMobile ? '50dvh' : 320, overflowY: 'auto' }}>
        {list.length === 0 && <div style={{ padding: 12, color: 'var(--k-9ca3af)', fontSize: 14 }}>No deals match.</div>}
        {list.map(d => (
          <button key={d.id} type="button" onClick={() => onPick(d)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', minHeight: isMobile ? 54 : 44, padding: '6px 10px', border: 'none', borderBottom: '1px solid var(--k-f0f0f0)', background: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            <span style={{ fontSize: 20 }}>💼</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.client || 'Deal'}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--k-6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[d.property, d.type].filter(Boolean).join(' · ')}</span>
            </span>
            {d.stage && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--k-1d4ed8)', background: 'var(--k-dbeafe)', padding: '2px 8px', borderRadius: 20 }}>{d.stage}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

interface LibForm { id: string; name: string; form_code?: string | null; category?: string | null; pinned?: boolean | null }
/** The whole form library — commercial and TREC residential — grouped by folder, searchable. */
function FormPicker({ api, businessUnit, isMobile, onClose, onPick }: { api: <T>(path: string, init?: RequestInit) => Promise<T>; businessUnit: string; isMobile: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const [forms, setForms] = useState<LibForm[] | null>(null);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'commercial' | 'trec'>('all');
  useEffect(() => { api<{ forms: LibForm[] }>(`/api/crm/forms?business_unit=${businessUnit}`).then(j => setForms(j.forms ?? [])).catch(() => setForms([])); }, [api, businessUnit]);
  const isTrec = (f: LibForm) => /^residential/i.test(f.category ?? '');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (forms ?? []).filter(f => (scope === 'all' || (scope === 'trec') === isTrec(f)) && (!t || `${f.name} ${f.form_code ?? ''} ${f.category ?? ''}`.toLowerCase().includes(t)));
  }, [forms, q, scope]);
  const cats = useMemo(() => [...new Set(shown.map(f => f.category || 'Other'))], [shown]);
  const chip = (id: 'all' | 'commercial' | 'trec', label: string, n: number) => (
    <button key={id} type="button" onClick={() => setScope(id)} style={{ minHeight: isMobile ? 38 : 30, padding: '0 12px', borderRadius: 16, border: `1px solid ${scope === id ? GOLD : 'var(--k-e5e7eb)'}`, background: scope === id ? 'var(--k-fdf6e9)' : 'var(--k-fff)', color: scope === id ? 'var(--k-a06a12)' : 'var(--k-374151)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>{label} <span style={{ opacity: .6 }}>{n}</span></button>
  );
  const n = (f: (x: LibForm) => boolean) => (forms ?? []).filter(f).length;
  return (
    <Modal title="Add a form" isMobile={isMobile} onClose={onClose}>
      <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--k-6b7280)', lineHeight: 1.5 }}>Pick any form in the library. A blank copy is filed here and opens so you and your team can fill it in together.</p>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="🔍  Search all forms (name or form number)" style={{ width: '100%', boxSizing: 'border-box', height: isMobile ? 46 : 36, border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '0 12px', fontSize: 14, marginBottom: 8, background: 'var(--k-fff)', color: 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>{chip('all', 'All', forms?.length ?? 0)}{chip('commercial', 'Commercial', n(f => !isTrec(f)))}{chip('trec', 'TREC (residential)', n(isTrec))}</div>
      <div style={{ maxHeight: isMobile ? '52dvh' : 380, overflowY: 'auto' }}>
        {forms === null && <div style={{ padding: 12, color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading the library…</div>}
        {forms && shown.length === 0 && <div style={{ padding: 12, color: 'var(--k-9ca3af)', fontSize: 14 }}>No forms match.</div>}
        {cats.map(cat => (
          <div key={cat}>
            <div style={{ fontSize: 10.5, letterSpacing: .7, textTransform: 'uppercase', color: GOLD, fontWeight: 700, padding: '10px 8px 4px' }}>{cat}</div>
            {shown.filter(f => (f.category || 'Other') === cat).map(f => (
              <button key={f.id} type="button" onClick={() => onPick(f.id)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', minHeight: isMobile ? 50 : 40, padding: '7px 8px', border: 'none', borderBottom: '1px solid var(--k-f0f0f0)', background: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>📝</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--k-1a1a1a)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{f.name}</span>
                  {f.form_code && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 1 }}>Form {f.form_code}</span>}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
