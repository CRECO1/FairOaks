'use client';

/**
 * DocsDrive — the Transaction Docs "Drive": nested folders and live documents, like Google Drive.
 * Folders are Team (everyone in the workspace) or Private (you + the people you pick); a folder linked to a deal follows that
 * deal's own visibility. Documents open in LiveDocEditor, where teammates edit together in real time.
 * Visibility is enforced in the database (supabase/drive-docs-2026-11.sql) — this component only asks and shows.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DI, { toneFor, type DIName } from './DriveIcons';
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
/** A contact the signed-in user can see (for "Add to a contact…"). The CRM's own contact rows fit this. */
export interface DriveContactLite { id: string; first_name?: string | null; last_name?: string | null; business_name?: string | null; email?: string | null; type?: string | null }

interface Props {
  deals?: DriveDealLite[];
  contacts?: DriveContactLite[];
  businessUnit: string;
  authToken?: string;
  currentUser: { id: string; name: string };
  profiles: DrivePerson[];
  isAdmin: boolean;
  isMobile: boolean;
  onToast: (msg: string) => void;
}

type View = 'folder' | 'recent' | 'shared' | 'trash' | 'search' | 'templates';
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
  | { t: 'bulk'; op: 'move' | 'share' | 'trash' | 'delete' }
  | { t: 'toDeal'; kind: Kind; item: Item }
  | { t: 'toContact'; kind: Kind; item: Item }
  | { t: 'form' }
  | { t: 'template' }
  | { t: 'saveTpl'; item: DriveDoc };

const GOLD = '#c9922c';
const nameOf = (kind: Kind, item: Item) => (kind === 'doc' || kind === 'form' ? (item as DriveDoc | DriveFormItem).title : (item as DriveFolder | DriveFile).name);
const GOLD_SOFT = '#c9922c1f';
/** The rounded, tinted tile an item's icon sits in. */
function Tile({ n, color, size = 36 }: { n: DIName; color: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: 10, background: `${color}1f`, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><DI n={n} size={Math.round(size * 0.52)} /></span>;
}
const initials = (name: string) => (name.replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '·').toUpperCase();
/** Files that can become a live document. */
const canEditFile = (name: string) => /\.(docx|txt)$/i.test(name);
const fmtSize = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function fmtWhen(iso: string) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

export default function DocsDrive({ deals = [], contacts = [], businessUnit, authToken, currentUser, profiles, isAdmin, isMobile, onToast }: Props) {
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
  // Bulk actions: the ticked items (keyed kind:id) — a tick-box on every row, a select-all, and an action bar.
  const [sel, setSel] = useState<Map<string, { kind: Kind; item: Item }>>(new Map());
  const [selectMode, setSelectMode] = useState(false);   // phones: tick-boxes only show once you tap Select
  const [bulkBusy, setBulkBusy] = useState(false);
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
  // The Copilot filed something into My Drive: reload what is on screen.
  useEffect(() => { const f = () => { void load(); void loadTree(); }; window.addEventListener('crm:drive-updated', f); return () => window.removeEventListener('crm:drive-updated', f); }, [load, loadTree]);

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

  // ── bulk selection ───────────────────────────────────────────────────────
  const selKey = (kind: Kind, it: Item) => `${kind}:${it.id}`;
  const isSel = (kind: Kind, it: Item) => sel.has(selKey(kind, it));
  const toggleSel = (kind: Kind, it: Item) => setSel(prev => { const n = new Map(prev); const k = selKey(kind, it); if (n.has(k)) n.delete(k); else n.set(k, { kind, item: it }); return n; });
  const clearSel = () => { setSel(new Map()); setSelectMode(false); };
  const selected = [...sel.values()];
  const visibleItems: Array<{ kind: Kind; item: Item }> = [
    ...folders.map(item => ({ kind: 'folder' as Kind, item })), ...docs.map(item => ({ kind: 'doc' as Kind, item })),
    ...forms.map(item => ({ kind: 'form' as Kind, item })), ...files.map(item => ({ kind: 'file' as Kind, item })),
  ];
  const allSelected = visibleItems.length > 0 && visibleItems.every(x => sel.has(selKey(x.kind, x.item)));
  const toggleAll = () => setSel(allSelected ? new Map() : new Map(visibleItems.map(x => [selKey(x.kind, x.item), x])));
  const selecting = sel.size > 0 || selectMode;
  // A selection never survives a change of view / folder, and Escape clears it.
  useEffect(() => { setSel(new Map()); setSelectMode(false); }, [view, folderId]);
  useEffect(() => {
    if (!sel.size && !selectMode) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !dlg) { setSel(new Map()); setSelectMode(false); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [sel.size, selectMode, dlg]);

  /** Runs one change per selected item (4 at a time) and says what happened — items you may not change are skipped with the reason. */
  const runBulk = async (verb: string, fn: (kind: Kind, item: Item) => Promise<unknown>, items: Array<{ kind: Kind; item: Item }> = selected) => {
    setBulkBusy(true);
    let ok = 0; const failed: string[] = [];
    const queue = [...items];
    const worker = async () => { for (let x = queue.shift(); x; x = queue.shift()) { try { await fn(x.kind, x.item); ok++; } catch (e) { failed.push((e as Error).message); } } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    setBulkBusy(false);
    const why = [...new Set(failed)].slice(0, 2).join(' · ');
    onToast(failed.length ? `${verb} ${ok} of ${items.length} — ${failed.length} skipped: ${why}` : `${verb} ${ok} item${ok === 1 ? '' : 's'}`);
    clearSel(); refresh();
  };
  const bulkPatch = (body: Record<string, unknown>) => (kind: Kind, it: Item) => api(`/api/crm/drive/items/${kind}/${it.id}`, { method: 'PATCH', body: JSON.stringify(body) });
  const empty = !loading && data && !folders.length && !docs.length && !files.length && !forms.length;
  // Forms are always shared with the team, so they can only be added somewhere the team can see.
  const canAddForm = view !== 'folder' || !data?.folder || (data.folder.visibility === 'team' && !data.folder.deal_id);
  const [formEditor, setFormEditor] = useState<{ form: { id: string; name: string }; url: string; submissionId: string } | null>(null);
  // Put a COPY of a document or file on a deal card's Docs tab: a live document goes as a PDF snapshot (with its letterhead), an uploaded
  // file as itself. It uses the deal's normal file upload, so the deal's own access rules apply and an identical file is not added twice.
  // The bytes a copy is made of: a live document as a PDF snapshot (with its letterhead), an uploaded file as itself.
  const copyOf = async (kind: Kind, item: Item, where: 'deal' | 'contact'): Promise<{ blob: Blob; name: string }> => {
    let blob: Blob, name: string;
    if (kind === 'doc') {
      const [{ loadDocJson }, { docToPdf, pdfName }] = await Promise.all([import('./doc-export'), import('@/lib/doc-pdf')]);
      const j = await loadDocJson(item.id, authToken);
      name = pdfName(j.title);
      blob = new Blob([(await docToPdf(j.json, j.title, { letterhead: j.letterhead })) as BlobPart], { type: 'application/pdf' });
    } else {
      const f = item as DriveFile;
      if (!/\.(pdf|docx?|jpe?g|png|webp)$/i.test(f.name)) throw new Error(`${where === 'deal' ? 'A deal’s Docs tab' : 'A contact’s Files'} takes PDF, Word, JPG, PNG or WebP files — this one can stay here in My Drive.`);
      const j = await api<{ url: string }>(`/api/crm/drive/file/${f.id}`);
      const r = await fetch(j.url);
      if (!r.ok) throw new Error('Could not read that file');
      blob = await r.blob(); name = f.name;
    }
    if (blob.size > 25 * 1024 * 1024) throw new Error(`A file must be 25 MB or smaller to go on a ${where}`);
    return { blob, name };
  };
  // A live document is LINKED to the card (the document itself shows there, always current) — not copied as a PDF.
  const linkDoc = async (item: Item, target: { deal_id: string } | { client_id: string }, label: string) => {
    onToast(`Linking to ${label}…`);
    try {
      const r = await api<{ already?: boolean }>('/api/crm/drive/links', { method: 'POST', body: JSON.stringify({ doc_id: item.id, ...target }) });
      onToast(r.already ? `Already shown on ${label}` : `Linked — it now shows live on ${label}’s card`);
    } catch (e) { onToast((e as Error).message || 'Could not link it'); }
  };
  const addToContact = async (kind: Kind, item: Item, c: DriveContactLite) => {
    setDlg(null);
    const label = contactLabel(c);
    if (kind === 'doc') { await linkDoc(item, { client_id: c.id }, label); return; }
    onToast(`Adding to ${label}…`);
    try {
      const { blob, name } = await copyOf(kind, item, 'contact');
      const pre = await api<{ uploadUrl: string; storagePath: string; contentType: string }>('/api/crm/client-docs', { method: 'POST', body: JSON.stringify({ action: 'presign', clientId: c.id, filename: name, file_size: blob.size }) });
      const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': pre.contentType }, body: blob });
      if (!put.ok) throw new Error('Could not upload the copy — try again');
      const done = await api<{ duplicate?: boolean }>('/api/crm/client-docs', { method: 'POST', body: JSON.stringify({ action: 'confirm', clientId: c.id, storagePath: pre.storagePath, filename: name }) });
      onToast(done.duplicate ? `That file is already on ${label}` : `Added to ${label} — see the Files section on their card`);
    } catch (e) { onToast((e as Error).message || 'Could not add it to the contact'); }
  };
  const addToDeal = async (kind: Kind, item: Item, deal: DriveDealLite) => {
    setDlg(null);
    const label = [deal.client, deal.property].filter(Boolean).join(' · ') || 'the deal';
    if (kind === 'doc') { await linkDoc(item, { deal_id: deal.id }, label); return; }
    onToast(`Adding to ${label}…`);
    try {
      if (kind === 'form') {
        await api(`/api/crm/drive/forms/${item.id}/to-deal`, { method: 'POST', body: JSON.stringify({ deal_id: deal.id }) });
        onToast(`Added to ${label} — see its Docs tab (it’s a separate copy)`);
        return;
      }
      const { blob, name } = await copyOf(kind, item, 'deal');
      const pre = await api<{ uploadUrl: string; storagePath: string; contentType: string }>('/api/crm/docs', { method: 'POST', body: JSON.stringify({ action: 'presign', dealId: deal.id, filename: name, file_size: blob.size }) });
      const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': pre.contentType }, body: blob });
      if (!put.ok) throw new Error('Could not upload the copy — try again');
      const done = await api<{ duplicate?: boolean }>('/api/crm/docs', { method: 'POST', body: JSON.stringify({ action: 'confirm', dealId: deal.id, storagePath: pre.storagePath, filename: name }) });
      onToast(done.duplicate ? `That file is already on ${label}` : `Added to ${label} — see its Docs tab`);
    } catch (e) { onToast((e as Error).message || 'Could not add it to the deal'); }
  };
  const downloadDocWord = async (d: DriveDoc) => {
    onToast('Preparing the Word file…');
    try { const { exportDocDocx } = await import('./doc-export'); await exportDocDocx(d.id, authToken, d.title); }
    catch (e) { onToast((e as Error).message || 'Could not make the Word file'); }
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
  const openItem = (kind: Kind, item: Item) => { if (inTrash || view === 'templates') { setDlg({ t: 'menu', kind, item }); return; } if (kind === 'folder') go(item.id); else if (kind === 'doc') setOpenDocId(item.id); else if (kind === 'form') void openFormItem(item as DriveFormItem); else if (canEditFile((item as DriveFile).name)) void editFile(item as DriveFile); else void openFile(item as DriveFile); };

  // Word (.docx) and text files can be turned into a live document (made once; opening it again returns the same one).
  const editFile = async (f: DriveFile) => {
    onToast('Opening as an editable document…');
    try {
      const r = await api<{ item: DriveDoc; existing?: boolean }>(`/api/crm/drive/file/${f.id}/convert`, { method: 'POST' });
      setOpenDocId(r.item.id); refresh();
    } catch (e) { onToast((e as Error).message || 'Could not open it for editing'); }
  };

  // Upload: the browser PUTs each file straight to storage (signed URL), then the API records it in the current folder.
  const uploadFiles = async (list: FileList | File[]) => {
    const parent = view === 'folder' ? folderId : null;
    const all = Array.from(list);
    if (!all.length) return;
    setUploading(n => n + all.length);
    let ok = 0, madeEditable = 0;
    for (const file of all) {
      try {
        if (file.size > DRIVE_FILE_MAX) throw new Error(`“${file.name}” is over 50 MB`);
        const pre = await api<{ uploadUrl: string; storagePath: string; contentType: string }>('/api/crm/drive/upload', { method: 'POST', body: JSON.stringify({ action: 'presign', filename: file.name, size: file.size, parent_id: parent }) });
        const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': pre.contentType }, body: file });
        if (!put.ok) throw new Error(`Couldn’t upload “${file.name}” — try again`);
        const saved = await api<{ file?: { id: string } }>('/api/crm/drive/upload', { method: 'POST', body: JSON.stringify({ action: 'confirm', storagePath: pre.storagePath, filename: file.name, parent_id: parent }) });
        ok += 1;
        // A Word / text file is also made editable right away (a live document next to it); a problem here is only mentioned.
        if (canEditFile(file.name) && saved.file?.id) {
          try { await api(`/api/crm/drive/file/${saved.file.id}/convert`, { method: 'POST' }); madeEditable += 1; }
          catch (e) { onToast(`“${file.name}” was uploaded, but ${((e as Error).message || 'it could not be made editable').replace(/^./, c => c.toLowerCase())}`); }
        }
      } catch (e) { onToast((e as Error).message); }
      finally { setUploading(n => n - 1); }
    }
    if (ok) {
      const editable = all.some(f => canEditFile(f.name)), oldWord = all.some(f => /\.(doc|rtf)$/i.test(f.name));
      onToast(madeEditable ? `Uploaded — ${madeEditable === 1 ? 'a live, editable copy was made next to it' : `${madeEditable} live, editable copies were made next to them`}` : editable ? 'Uploaded — click the file (or the pencil) to edit it as a live document' : oldWord ? 'Uploaded. Older Word (.doc) files can’t be edited here — save it as .docx in Word and upload that' : ok === 1 ? 'File uploaded' : `${ok} files uploaded`);
      refresh();
    }
  };

  // ── tree ──────────────────────────────────────────────────────────────────
  // ── drag and drop: drag items (or the whole ticked selection) onto a folder, the sidebar tree, "All files" or a breadcrumb to move them ──
  const DND = 'application/x-drive-items';
  const [dragHover, setDragHover] = useState<string | null>(null);   // 'root' or the folder id being hovered
  const dragPayload = useRef<Array<{ kind: Kind; id: string }> | null>(null);
  const parentOf = useMemo(() => new Map(tree.map(f => [f.id, f.parent_id])), [tree]);
  /** A folder can't be dropped into itself or anything inside it. */
  const canDrop = (target: string | null) => {
    const p = dragPayload.current; if (!p) return false;
    for (const x of p) {
      if (x.kind !== 'folder') continue;
      if (target === x.id) return false;
      for (let a = target, i = 0; a && i < 30; a = parentOf.get(a) ?? null, i++) if (a === x.id) return false;
    }
    return true;
  };
  const dragProps = (kind: Kind, it: Item) => (inTrash || view === 'templates' || isMobile) ? {} : {
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      const items = isSel(kind, it) && sel.size > 1 ? selected.map(x => ({ kind: x.kind, id: x.item.id })) : [{ kind, id: it.id }];
      dragPayload.current = items;
      e.dataTransfer.setData(DND, JSON.stringify(items)); e.dataTransfer.effectAllowed = 'move';
      if (items.length > 1) {   // a small "N items" chip follows the pointer instead of one row
        const chip = document.createElement('div');
        chip.textContent = `${items.length} items`;
        chip.style.cssText = 'position:fixed;top:-100px;left:-100px;padding:6px 12px;border-radius:8px;background:#c9922c;color:#fff;font:700 13px DM Sans,sans-serif';
        document.body.appendChild(chip); e.dataTransfer.setDragImage(chip, 10, 10); setTimeout(() => chip.remove(), 0);
      }
    },
    onDragEnd: () => { dragPayload.current = null; setDragHover(null); },
  };
  const moveDropped = (items: Array<{ kind: Kind; id: string }>, target: string | null) =>
    runBulk('Moved', (k, it) => api(`/api/crm/drive/items/${k}/${it.id}`, { method: 'PATCH', body: JSON.stringify({ move: { parent_id: target } }) }), items.map(i => ({ kind: i.kind, item: { id: i.id } as Item })));
  const dropProps = (target: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (dragPayload.current && canDrop(target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } },
    onDragEnter: () => { if (dragPayload.current && canDrop(target)) setDragHover(target ?? 'root'); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragHover(h => (h === (target ?? 'root') ? null : h)); },
    onDrop: (e: React.DragEvent) => {
      const items = dragPayload.current; if (!items) return;
      e.preventDefault(); e.stopPropagation();
      const ok = canDrop(target);
      dragPayload.current = null; setDragHover(null);
      if (ok) void moveDropped(items, target);
    },
  });
  const dropGlow = (target: string | null): React.CSSProperties => (dragHover === (target ?? 'root') ? { outline: `2px solid ${GOLD}`, outlineOffset: -2, background: 'var(--k-fdf6e9)' } : {});

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
          <div onClick={() => go(f.id)} {...dropProps(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: `5px 8px 5px ${8 + depth * 14}px`, borderRadius: 7, cursor: 'pointer', background: here ? 'var(--k-fdf6e9)' : 'transparent', color: here ? 'var(--k-a06a12)' : 'var(--k-374151)', fontSize: 13.5, fontWeight: here ? 700 : 500, ...dropGlow(f.id) }}>
            <span role="button" aria-label={expanded.has(f.id) ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); if (has) setExpanded(prev => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; }); }}
              style={{ width: 16, textAlign: 'center', fontSize: 10, color: 'var(--k-9ca3af)', visibility: has ? 'visible' : 'hidden' }}>{expanded.has(f.id) ? '▾' : '▸'}</span>
            <span style={{ color: toneFor('folder', f).color, display: 'inline-flex' }}><DI n={toneFor('folder', f).icon} size={16} /></span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          </div>
          {has && expanded.has(f.id) && renderTree(f.id, depth + 1)}
        </div>
      );
    });

  const navBtn = (label: string, on: boolean, onClick: () => void, icon: DIName, root = false) => (
    <button type="button" onClick={onClick} {...(root ? dropProps(null) : {})}
      style={{ ...(root ? dropGlow(null) : {}), display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', borderRadius: 7, cursor: 'pointer', background: on ? 'var(--k-fdf6e9)' : 'transparent', color: on ? 'var(--k-a06a12)' : 'var(--k-374151)', fontSize: 14, fontWeight: on ? 700 : 600, fontFamily: "'DM Sans',sans-serif" }}>
      <DI n={icon} size={17} />{label}
    </button>
  );

  // ── pieces ────────────────────────────────────────────────────────────────
  const accessLabel = (it: Item) => it.deal_id ? 'Deal team' : it.visibility === 'private' ? (it.shared_with.length ? `Shared · ${it.shared_with.length + 1}` : 'Only you') : 'Team';
  // A small pill: who can open it.
  const accessPill = (it: Item) => {
    const deal = !!it.deal_id, priv = it.visibility === 'private';
    const color = deal ? '#2563eb' : priv ? (it.shared_with.length ? '#c9922c' : '#6b7280') : '#16a34a';
    return (
      <span title={deal ? 'Only people on the linked deal' : priv ? (it.shared_with.length ? 'Shared with specific people' : 'Only you can open this') : 'Everyone on the team can open this'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 9px', borderRadius: 11, background: `${color}1a`, color, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
        <DI n={deal ? 'briefcase' : priv ? 'lock' : 'users'} size={12} />{accessLabel(it)}
      </span>
    );
  };
  // Trash keeps things for 30 days (a daily job then removes them for good).
  const daysLeft = (it: Item) => Math.max(0, 30 - Math.floor((Date.now() - new Date(it.trashed_at ?? it.updated_at).getTime()) / 86_400_000));
  const rowSub = (kind: Kind, it: Item) => `${who(it.created_by)} · ${kind === 'file' && (it as DriveFile).size ? `${fmtSize((it as DriveFile).size)} · ` : ''}${kind === 'form' ? `${(it as DriveFormItem).form_code ? `${(it as DriveFormItem).form_code} · ` : ''}${(it as DriveFormItem).has_pdf ? 'saved' : 'in progress'} · ` : ''}${accessLabel(it)} · ${fmtWhen(inTrash ? (it.trashed_at ?? it.updated_at) : it.updated_at)}${inTrash ? ` · ${daysLeft(it)} d left` : ''}`;
  const tone = (kind: Kind, it: Item) => toneFor(kind, kind === 'file' ? { name: (it as DriveFile).name, mime: (it as DriveFile).mime } : { visibility: it.visibility, deal_id: it.deal_id });
  const ownerChip = (id: string | null) => {
    const n = who(id);
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      <span style={{ width: 24, height: 24, borderRadius: 12, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(n)}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
    </span>;
  };
  const dotsBtn = (kind: Kind, it: Item, title: string) => (
    <button type="button" className="dd-dots" aria-label={`Actions for ${title}`} onClick={() => setDlg({ t: 'menu', kind, item: it })}
      style={{ width: isMobile ? 44 : 32, height: isMobile ? 44 : 32, flexShrink: 0, border: 'none', borderRadius: 8, background: 'none', color: 'var(--k-6b7280)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><DI n="dots" size={18} /></button>
  );
  const row = (kind: Kind, it: Item) => {
    const title = nameOf(kind, it);
    const snippet = (it as DriveDoc).snippet;
    const t = tone(kind, it);
    return (
      <div key={`${kind}${it.id}`} className="dd-row" {...dragProps(kind, it)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '6px 4px 6px 12px' : '5px 10px 5px 14px', borderBottom: '1px solid var(--k-f0f0f0)', minHeight: isMobile ? 60 : 54, ...(isSel(kind, it) ? { background: 'var(--k-fdf6e9)' } : {}) }}>
        {chk(kind, it)}
        <button type="button" onClick={() => openItem(kind, it)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          <Tile n={t.icon} color={t.color} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            {(isMobile || snippet) && <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet ?? rowSub(kind, it)}</span>}
          </span>
        </button>
        {!isMobile && <>
          <span style={{ width: 120, fontSize: 12.5, color: 'var(--k-6b7280)', minWidth: 0 }}>{ownerChip(it.created_by)}</span>
          <span style={{ width: 118 }}>{accessPill(it)}</span>
          <span style={{ width: 84, fontSize: 12.5, color: 'var(--k-6b7280)', whiteSpace: 'nowrap' }}>{fmtWhen(inTrash ? (it.trashed_at ?? it.updated_at) : it.updated_at)}{inTrash && <span style={{ display: 'block', fontSize: 10.5, color: daysLeft(it) <= 3 ? 'var(--k-dc2626)' : 'var(--k-9ca3af)' }}>{daysLeft(it)} d left</span>}</span>
        </>}
        {kind === 'doc' && !isMobile && !inTrash && (
          <button type="button" className="dd-dots" aria-label={`Quick look at ${title}`} title="Quick look — preview without opening" onClick={() => setQuickDocId(it.id)}
            style={{ width: 32, height: 32, flexShrink: 0, border: 'none', borderRadius: 8, background: 'none', color: 'var(--k-9ca3af)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><DI n="eye" size={17} /></button>
        )}
        {kind === 'file' && !inTrash && canEditFile((it as DriveFile).name) && (
          <button type="button" className="dd-dots" aria-label={`Edit ${title} as a live document`} title="Edit as a live document" onClick={() => void editFile(it as DriveFile)}
            style={{ width: isMobile ? 44 : 32, height: isMobile ? 44 : 32, flexShrink: 0, border: 'none', borderRadius: 8, background: 'none', color: GOLD, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><DI n="pen" size={17} /></button>
        )}
        {!(kind === 'doc' && !isMobile && !inTrash) && !isMobile && !inTrash && !(kind === 'file' && canEditFile((it as DriveFile).name)) && <span style={{ width: 32, flexShrink: 0 }} />}
        {dotsBtn(kind, it, title)}
      </div>
    );
  };
  // Folders in a folder view are cards on top (like a drive), not rows.
  const folderCard = (f: DriveFolder) => {
    const t = tone('folder', f);
    return (
      <div key={`folder${f.id}`} className="dd-card" {...dragProps('folder', f)} {...dropProps(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 6px 10px 12px', border: `1px solid ${isSel('folder', f) || dragHover === f.id ? GOLD : 'var(--k-eef0f2)'}`, borderRadius: 12, background: isSel('folder', f) || dragHover === f.id ? 'var(--k-fdf6e9)' : 'var(--k-fff)', minHeight: 62, ...(dragHover === f.id ? { boxShadow: `0 0 0 2px ${GOLD}55` } : {}) }}>
        {chk('folder', f)}
        <button type="button" onClick={() => openItem('folder', f)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          <Tile n={t.icon} color={t.color} size={38} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 1 }}>{accessLabel(f)}</span>
          </span>
        </button>
        {dotsBtn('folder', f, f.name)}
      </div>
    );
  };
  const chk = (kind: Kind, it: Item) => (isMobile && !selecting) ? null : (
    <label className="dd-chk" onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: isMobile ? 32 : 22, height: isMobile ? 44 : 22, flexShrink: 0, cursor: 'pointer' }}>
      <input type="checkbox" checked={isSel(kind, it)} onChange={() => toggleSel(kind, it)} aria-label={`Select ${nameOf(kind, it)}`} style={{ width: 18, height: 18, margin: 0, accentColor: GOLD, cursor: 'pointer' }} />
    </label>
  );
  const sectionLabel = (t: string) => <div style={{ fontSize: 10.5, letterSpacing: .9, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, margin: '2px 2px 8px' }}>{t}</div>;
  const cardsView = view === 'folder';

  const heading = view === 'recent' ? 'Recent' : view === 'shared' ? 'Shared with me' : view === 'trash' ? 'Trash' : view === 'templates' ? 'Templates' : view === 'search' ? 'Search results' : null;

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Sidebar (desktop) / quick switch (phone) */}
      {isMobile ? (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', width: '100%', paddingBottom: 2 }}>
          {([['Files', view === 'folder', () => go(null)], ['Recent', view === 'recent', () => { setQ(''); setView('recent'); }], ['Shared', view === 'shared', () => { setQ(''); setView('shared'); }], ['Templates', view === 'templates', () => { setQ(''); setView('templates'); }], ['Trash', view === 'trash', () => { setQ(''); setView('trash'); }]] as Array<[string, boolean, () => void]>).map(([l, on, fn]) => (
            <button key={l} type="button" onClick={fn} style={{ minHeight: 40, padding: '0 16px', borderRadius: 20, border: `1px solid ${on ? GOLD : 'var(--k-e5e7eb)'}`, background: on ? 'var(--k-fdf6e9)' : 'var(--k-fff)', color: on ? 'var(--k-a06a12)' : 'var(--k-374151)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', flexShrink: 0, fontFamily: "'DM Sans',sans-serif" }}>{l}</button>
          ))}
        </div>
      ) : (
        <nav aria-label="Folders" style={{ width: 230, flexShrink: 0, background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 12, padding: 8, maxHeight: '72vh', overflowY: 'auto' }}>
          {navBtn('All files', view === 'folder' && folderId === null, () => go(null), 'grid', true)}
          {navBtn('Recent', view === 'recent', () => { setQ(''); setView('recent'); }, 'clock')}
          {navBtn('Shared with me', view === 'shared', () => { setQ(''); setView('shared'); }, 'users')}
          {navBtn('Templates', view === 'templates', () => { setQ(''); setView('templates'); }, 'template')}
          {navBtn('Trash', view === 'trash', () => { setQ(''); setView('trash'); }, 'trash')}
          <div style={{ fontSize: 10.5, letterSpacing: .9, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, padding: '14px 10px 6px' }}>Folders</div>
          {tree.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--k-9ca3af)', padding: '4px 10px' }}>No folders yet</div> : renderTree(null, 0)}
        </nav>
      )}

      <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
        {/* Header: breadcrumb + search + New */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, fontSize: isMobile ? 16 : 17, fontWeight: 700, color: 'var(--k-1a1a1a)' }}>
            {heading ? <span style={{ padding: '6px 4px' }}>{heading}</span> : (
              <>
                <button type="button" onClick={() => go(null)} {...dropProps(null)} style={{ ...crumb(folderId === null), ...dropGlow(null) }}>All files</button>
                {(data?.path ?? []).map((p, i, arr) => (
                  <React.Fragment key={p.id}>
                    <span style={{ color: 'var(--k-9ca3af)', display: 'inline-flex' }}><DI n="chevron" size={14} /></span>
                    <button type="button" onClick={() => go(p.id)} {...dropProps(p.id)} style={{ ...crumb(i === arr.length - 1), ...dropGlow(p.id) }}>{p.name}</button>
                  </React.Fragment>
                ))}
              </>
            )}
          </div>
          <div style={{ position: 'relative', flex: isMobile ? '1 1 140px' : '0 0 250px', minWidth: 0 }}>
            <span style={{ position: 'absolute', left: 11, top: 0, bottom: 0, display: 'flex', alignItems: 'center', color: 'var(--k-9ca3af)', pointerEvents: 'none' }}><DI n="search" size={16} /></span>
            <input value={q} onChange={e => { setQ(e.target.value); setView(e.target.value.trim().length >= 2 ? 'search' : view === 'search' ? 'folder' : view); }} placeholder="Search documents" aria-label="Search documents"
              style={{ width: '100%', boxSizing: 'border-box', height: isMobile ? 44 : 38, border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: '0 12px 0 34px', fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)' }} />
          </div>
          {!inTrash && view !== 'templates' && view !== 'shared' && (
            <div style={{ position: 'relative' }}>
              <button type="button" onClick={() => setNewOpen(o => !o)} aria-haspopup="menu" aria-expanded={newOpen}
                style={{ height: isMobile ? 44 : 38, padding: '0 16px 0 13px', border: 'none', borderRadius: 10, background: GOLD, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 7, boxShadow: '0 1px 2px rgba(0,0,0,.12)' }}><DI n="plus" size={16} />New</button>
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
          {isMobile && view !== 'templates' && (data?.folders.length || data?.docs.length || data?.files?.length || data?.forms?.length) ? (
            <button type="button" onClick={() => (selectMode || sel.size ? clearSel() : setSelectMode(true))} aria-pressed={selecting} style={{ height: 44, padding: '0 14px', border: `1px solid ${selecting ? GOLD : 'var(--k-e5e7eb)'}`, borderRadius: 10, background: selecting ? 'var(--k-fdf6e9)' : 'var(--k-fff)', color: selecting ? 'var(--k-a06a12)' : 'var(--k-374151)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>{selecting ? 'Done' : 'Select'}</button>
          ) : null}
          {inTrash && <span style={{ fontSize: 12.5, color: 'var(--k-9ca3af)' }}>Items you delete stay here for 30 days, then are removed for good.</span>}
          {view === 'templates' && <span style={{ fontSize: 12.5, color: 'var(--k-9ca3af)' }}>Click a template to use it. To add one: open any document, then ⋯ → Save as template.</span>}
        </div>

        {/* List */}
        <div className={`dd-scope${selecting ? ' dd-selecting' : ''}`} onDragOver={e => { if (!inTrash && view === 'folder' && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }} onDragLeave={() => setDragOver(false)}
          onDrop={e => { setDragOver(false); if (!inTrash && view === 'folder' && e.dataTransfer.files.length) { e.preventDefault(); void uploadFiles(e.dataTransfer.files); } }}
          style={{ borderRadius: 14, outline: dragOver ? `2px dashed ${GOLD}` : 'none', outlineOffset: 4, background: dragOver ? `${GOLD}0d` : 'transparent' }}>
          <style>{`.dd-row{transition:background .12s}.dd-row:hover{background:var(--k-fbf8f1)}.dd-card{transition:border-color .12s,box-shadow .12s}.dd-card:hover{border-color:${GOLD};box-shadow:0 2px 10px rgba(201,146,44,.14)}.dd-dots:hover{background:var(--k-f3f4f6)!important}.dd-row:last-child{border-bottom:none}.dd-chk{opacity:0;transition:opacity .1s}.dd-row:hover .dd-chk,.dd-card:hover .dd-chk,.dd-selecting .dd-chk,.dd-chk:focus-within{opacity:1}`}</style>
          {sel.size > 0 && (
            <div role="toolbar" aria-label="Actions for the selected items" style={{ position: 'sticky', top: 8, zIndex: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: isMobile ? '8px 10px' : '8px 12px', marginBottom: 12, borderRadius: 12, background: 'var(--k-fdf6e9)', border: `1px solid ${GOLD}`, boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
              <button type="button" onClick={clearSel} aria-label="Clear the selection" title="Clear the selection (Esc)" style={{ width: isMobile ? 44 : 32, height: isMobile ? 44 : 32, border: 'none', borderRadius: 8, background: 'none', color: 'var(--k-6b7280)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><DI n="close" size={16} /></button>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-1a1a1a)', flex: '1 1 90px' }}>{sel.size} selected</span>
              {(() => {
                const b: React.CSSProperties = { height: isMobile ? 44 : 34, padding: '0 14px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13.5, fontWeight: 700, cursor: bulkBusy ? 'default' : 'pointer', opacity: bulkBusy ? .6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'DM Sans',sans-serif" };
                const danger: React.CSSProperties = { ...b, color: 'var(--k-dc2626)' };
                return inTrash ? (
                  <>
                    <button type="button" disabled={bulkBusy} style={b} onClick={() => void runBulk('Restored', bulkPatch({ trash: false }))}><DI n="restore" size={15} />Restore</button>
                    <button type="button" disabled={bulkBusy} style={danger} onClick={() => setDlg({ t: 'bulk', op: 'delete' })}><DI n="trash" size={15} />Delete forever</button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={bulkBusy} style={b} onClick={() => setDlg({ t: 'bulk', op: 'move' })}><DI n="move" size={15} />Move…</button>
                    {selected.some(x => x.kind !== 'form') && <button type="button" disabled={bulkBusy} style={b} onClick={() => setDlg({ t: 'bulk', op: 'share' })}><DI n="users" size={15} />Share…</button>}
                    <button type="button" disabled={bulkBusy} style={danger} onClick={() => setDlg({ t: 'bulk', op: 'trash' })}><DI n="trash" size={15} />Trash</button>
                  </>
                );
              })()}
            </div>
          )}
          {uploading > 0 && <div style={{ padding: '10px 16px', marginBottom: 10, borderRadius: 10, fontSize: 13, color: 'var(--k-a06a12)', background: 'var(--k-fdf6e9)', border: '1px solid var(--k-f0e2c4)', display: 'flex', alignItems: 'center', gap: 8 }}><DI n="upload" size={15} />Uploading {uploading} file{uploading === 1 ? '' : 's'}…</div>}
          {loading && !data && <div style={{ padding: 28, color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading…</div>}
          {cardsView && folders.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              {sectionLabel('Folders')}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>{folders.map(folderCard)}</div>
            </div>
          )}
          {(docs.length > 0 || forms.length > 0 || files.length > 0 || (!cardsView && folders.length > 0)) && (
            <>
              {cardsView && folders.length > 0 && sectionLabel('Files')}
              <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 12, overflow: 'hidden' }}>
                {!isMobile && (
                  <div style={{ display: 'flex', gap: 10, padding: '9px 10px 9px 14px', borderBottom: '1px solid var(--k-eef0f2)', background: 'var(--k-fafafa)', fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700 }}>
                    <span style={{ width: 22, flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select everything in this list" style={{ width: 16, height: 16, margin: 0, accentColor: GOLD, cursor: 'pointer' }} /></span>
                    <span style={{ flex: 1, paddingLeft: 48 }}>Name</span><span style={{ width: 120 }}>Owner</span><span style={{ width: 118 }}>Access</span><span style={{ width: 84 }}>{inTrash ? 'Deleted' : 'Modified'}</span><span style={{ width: 32 + (inTrash ? 0 : 32) }} />
                  </div>
                )}
                {!cardsView && folders.map(f => row('folder', f))}
                {docs.map(d => row('doc', d))}
                {forms.map(f => row('form', f))}
                {files.map(f => row('file', f))}
              </div>
            </>
          )}
          {empty && (
            <div style={{ padding: '54px 20px', textAlign: 'center', background: 'var(--k-fff)', border: '1px dashed var(--k-e5e7eb)', borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <Tile n={view === 'trash' ? 'trash' : view === 'shared' ? 'users' : view === 'templates' ? 'template' : view === 'search' ? 'search' : view === 'recent' ? 'clock' : 'folder'} color={GOLD} size={52} />
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--k-1a1a1a)', marginTop: 8 }}>
                {view === 'trash' ? 'The trash is empty' : view === 'shared' ? 'Nothing is shared with you yet' : view === 'templates' ? 'No templates yet' : view === 'search' ? 'Nothing matches that search' : view === 'recent' ? 'No documents yet' : 'This folder is empty'}
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--k-6b7280)', maxWidth: 360, lineHeight: 1.55 }}>
                {view === 'trash' ? 'Items you delete wait here until you remove them for good.' : view === 'shared' ? 'When a teammate shares a private document, folder or file with you, it shows up here — and you get a notification.' : view === 'templates' ? 'Open any document, then ⋯ → Save as template.' : view === 'search' ? 'Try a different word, or check the spelling.' : view === 'recent' ? 'Documents you open or edit show up here.' : `Add a document, a folder or a form${isMobile ? '' : ' — or drop files right here'}.`}
              </div>
              {view === 'folder' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button type="button" onClick={() => void createDoc()} style={{ height: isMobile ? 44 : 36, padding: '0 16px', border: 'none', borderRadius: 10, background: GOLD, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: "'DM Sans',sans-serif" }}><DI n="doc" size={16} />New document</button>
                  <button type="button" onClick={() => fileInput.current?.click()} style={{ height: isMobile ? 44 : 36, padding: '0 16px', border: '1px solid var(--k-d1d5db)', borderRadius: 10, background: 'var(--k-fff)', color: 'var(--k-374151)', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: "'DM Sans',sans-serif" }}><DI n="upload" size={16} />Upload files</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <input ref={fileInput} type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.txt" onChange={e => { if (e.target.files?.length) void uploadFiles(e.target.files); e.target.value = ''; }} />

      {/* Dialogs */}
      {dlg?.t === 'form' && <FormPicker api={api} businessUnit={businessUnit} isMobile={isMobile} onClose={() => setDlg(null)} onPick={id => void createForm(id)} />}
      {dlg?.t === 'toContact' && <ContactPicker contacts={contacts} liveDoc={dlg.kind === 'doc'} isMobile={isMobile} title={nameOf(dlg.kind, dlg.item)} onClose={() => setDlg(null)} onPick={c => void addToContact(dlg.kind, dlg.item, c)} />}
      {dlg?.t === 'toDeal' && <DealPicker deals={deals} liveDoc={dlg.kind === 'doc'} isMobile={isMobile} title={nameOf(dlg.kind, dlg.item)} onClose={() => setDlg(null)} onPick={d => void addToDeal(dlg.kind, dlg.item, d)} />}
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
              {(dlg.kind === 'file' || dlg.kind === 'form' || (dlg.kind === 'doc' && !(dlg.item as DriveDoc).is_template)) && deals.length > 0 && <MenuBtn icon="💼" label={dlg.kind === 'doc' ? 'Link to a deal…' : 'Add to a deal…'} isMobile={isMobile} onClick={() => setDlg({ t: 'toDeal', kind: dlg.kind, item: dlg.item })} />}
              {(dlg.kind === 'file' || (dlg.kind === 'doc' && !(dlg.item as DriveDoc).is_template)) && contacts.length > 0 && <MenuBtn icon="👤" label={dlg.kind === 'doc' ? 'Link to a contact…' : 'Add to a contact…'} isMobile={isMobile} onClick={() => setDlg({ t: 'toContact', kind: dlg.kind, item: dlg.item })} />}
              {dlg.kind === 'doc' && <MenuBtn icon="⬇" label="Download as PDF" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); void downloadDocPdf(d.item as DriveDoc); }} />}
              {dlg.kind === 'doc' && <MenuBtn icon="⬇" label="Download as Word (.docx)" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); void downloadDocWord(d.item as DriveDoc); }} />}
              {dlg.kind === 'file' && canEditFile((dlg.item as DriveFile).name) && <MenuBtn icon="✎" label="Edit as a live document" isMobile={isMobile} onClick={() => { const d = dlg; setDlg(null); void editFile(d.item as DriveFile); }} />}
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

      {dlg?.t === 'bulk' && selected.length > 0 && dlg.op === 'move' && (
        <MoveDialog kind={selected[0].kind} item={selected[0].item} bulk={selected} tree={tree} kids={kids} isMobile={isMobile} onClose={() => setDlg(null)}
          onPick={dest => { setDlg(null); void runBulk('Moved', bulkPatch({ move: { parent_id: dest } })); }} />
      )}
      {dlg?.t === 'bulk' && dlg.op === 'share' && (() => {
        const shareable = selected.filter(x => x.kind !== 'form');
        if (!shareable.length) return null;
        return <ShareDialog kind={shareable[0].kind} item={shareable[0].item} bulk={shareable} people={profiles.filter(p => p.id !== currentUser.id)} can isMobile={isMobile} who={who} onClose={() => setDlg(null)}
          onSave={(visibility, shared_with) => { setDlg(null); void runBulk('Updated sharing on', bulkPatch({ share: { visibility, shared_with } }), shareable); }} />;
      })()}
      {dlg?.t === 'bulk' && selected.length > 0 && dlg.op === 'trash' && (
        <Modal title={`Move ${selected.length} item${selected.length === 1 ? '' : 's'} to trash?`} isMobile={isMobile} onClose={() => setDlg(null)}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--k-4b5563)', lineHeight: 1.55 }}>
            {selected.length} item{selected.length === 1 ? '' : 's'}{selected.some(x => x.kind === 'folder') ? ' (and everything inside the folders)' : ''} will go to the trash. You can restore {selected.length === 1 ? 'it' : 'them'} from there for 30 days.
          </p>
          <DialogButtons isMobile={isMobile} onCancel={() => setDlg(null)} cta="Move to trash" danger onSubmit={() => { setDlg(null); void runBulk('Moved to trash:', bulkPatch({ trash: true })); }} />
        </Modal>
      )}
      {dlg?.t === 'bulk' && selected.length > 0 && dlg.op === 'delete' && (
        <Modal title={`Delete ${selected.length} item${selected.length === 1 ? '' : 's'} forever?`} isMobile={isMobile} onClose={() => setDlg(null)}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--k-4b5563)', lineHeight: 1.55 }}>
            {selected.length} item{selected.length === 1 ? '' : 's'}{selected.some(x => x.kind === 'folder') ? ' (and everything inside the folders)' : ''} will be permanently deleted. This can’t be undone.{selected.some(x => x.kind === 'form') ? ' Forms are only removed from My Drive — the saved form itself is kept.' : ''}
          </p>
          <DialogButtons isMobile={isMobile} onCancel={() => setDlg(null)} cta="Delete forever" danger onSubmit={() => { setDlg(null); void runBulk('Deleted', (k, it) => api(`/api/crm/drive/items/${k}/${it.id}`, { method: 'DELETE' })); }} />
        </Modal>
      )}

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

const MENU_ICON: Record<string, DIName> = { '📄': 'doc', '📋': 'template', '📁': 'folder', '📝': 'form', '⬆': 'upload', '↩': 'restore', '🗑': 'trash', '↗': 'open', '👁': 'eye', '⬇': 'download', '↓': 'download', '💼': 'briefcase', '👤': 'user', '✎': 'pen', '👥': 'users' };
function MenuBtn({ icon, label, onClick, danger, isMobile }: { icon: string; label: string; onClick: () => void; danger?: boolean; isMobile: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', minHeight: isMobile ? 48 : 38, padding: '0 12px', border: 'none', borderRadius: 8, background: 'none', cursor: 'pointer', fontSize: 14.5, fontWeight: 600, color: danger ? 'var(--k-dc2626)' : 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--k-fbf8f1)')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
      <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center', color: danger ? 'var(--k-dc2626)' : 'var(--k-6b7280)' }}>{MENU_ICON[icon] ? <DI n={MENU_ICON[icon]} size={17} /> : icon}</span>{label}
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

function MoveDialog({ kind, item, bulk, tree, kids, isMobile, onClose, onPick }: { kind: Kind; item: Item; bulk?: Array<{ kind: Kind; item: Item }>; tree: DriveTreeFolder[]; kids: Map<string | null, DriveTreeFolder[]>; isMobile: boolean; onClose: () => void; onPick: (dest: string | null) => void }) {
  // A folder can't go inside itself or anything under it.
  const blocked = useMemo(() => {
    const s = new Set<string>();
    const walk = (id: string) => { s.add(id); (kids.get(id) ?? []).forEach(k => walk(k.id)); };
    for (const x of bulk ?? [{ kind, item }]) if (x.kind === 'folder') walk(x.item.id);
    return s;
  }, [kind, item, bulk, kids]);
  const current = bulk ? undefined : kind === 'folder' ? (item as DriveFolder).parent_id : (item as DriveDoc).folder_id;
  const [sel, setSel] = useState<string | null | undefined>(undefined);
  const dest = sel === undefined ? undefined : tree.find(f => f.id === sel);
  const render = (parent: string | null, depth: number): React.ReactNode => (kids.get(parent) ?? []).map(f => (
    <div key={f.id}>
      <button type="button" disabled={blocked.has(f.id)} onClick={() => setSel(f.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', minHeight: isMobile ? 46 : 34, padding: `0 10px 0 ${10 + depth * 18}px`, border: 'none', borderRadius: 8, background: sel === f.id ? 'var(--k-fdf6e9)' : 'none', color: blocked.has(f.id) ? 'var(--k-d1d5db)' : 'var(--k-1a1a1a)', fontSize: 14, fontWeight: sel === f.id ? 700 : 500, cursor: blocked.has(f.id) ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
        <span style={{ color: toneFor('folder', f).color, display: 'inline-flex' }}><DI n={toneFor('folder', f).icon} size={16} /></span><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
      </button>
      {render(f.id, depth + 1)}
    </div>
  ));
  return (
    <Modal title={bulk ? `Move ${bulk.length} items` : `Move “${nameOf(kind, item)}”`} isMobile={isMobile} onClose={onClose}>
      <button type="button" onClick={() => setSel(null)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', minHeight: isMobile ? 46 : 34, padding: '0 10px', border: 'none', borderRadius: 8, background: sel === null ? 'var(--k-fdf6e9)' : 'none', fontSize: 14, fontWeight: sel === null ? 700 : 600, cursor: 'pointer', color: 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }}>🗂 All files (top level)</button>
      {render(null, 0)}
      {dest && (bulk ?? [{ kind, item }]).some(x => dest.visibility !== x.item.visibility || dest.deal_id !== x.item.deal_id) && (
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

function ShareDialog({ kind, item, bulk, people, can, isMobile, who, onClose, onSave }: { kind: Kind; item: Item; bulk?: Array<{ kind: Kind; item: Item }>; people: DrivePerson[]; can: boolean; isMobile: boolean; who: (id: string | null) => string; onClose: () => void; onSave: (v: 'team' | 'private', shared: string[]) => void }) {
  const [vis, setVis] = useState<'team' | 'private'>(item.visibility);
  const [picked, setPicked] = useState<Set<string>>(new Set(bulk ? [] : item.shared_with));
  const radio = (v: 'team' | 'private', label: string, sub: string) => (
    <label key={v} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: `1px solid ${vis === v ? GOLD : 'var(--k-e5e7eb)'}`, borderRadius: 10, background: vis === v ? 'var(--k-fdf6e9)' : 'var(--k-fff)', cursor: can ? 'pointer' : 'default', minHeight: isMobile ? 56 : undefined }}>
      <input type="radio" name="vis" checked={vis === v} disabled={!can} onChange={() => setVis(v)} style={{ marginTop: 3, accentColor: GOLD, width: 18, height: 18 }} />
      <span><span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--k-1a1a1a)' }}>{label}</span><span style={{ display: 'block', fontSize: 12.5, color: 'var(--k-6b7280)', marginTop: 1 }}>{sub}</span></span>
    </label>
  );
  return (
    <Modal title={bulk ? `Share ${bulk.length} items` : `Share “${nameOf(kind, item)}”`} isMobile={isMobile} onClose={onClose}>
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
      {bulk && <p style={{ fontSize: 12.5, color: 'var(--k-6b7280)', margin: '10px 0 0', lineHeight: 1.5 }}>This replaces who each of the {bulk.length} items is shared with. Items you don’t own are skipped.</p>}
      {item.deal_id && !bulk && <p style={{ fontSize: 12.5, color: 'var(--k-6b7280)', margin: '10px 0 0', lineHeight: 1.5 }}>💼 This is linked to a deal, so only people on that deal can open it, whichever you choose.</p>}
      {(bulk ? bulk.some(x => x.kind === 'folder') : kind === 'folder') && can && <p style={{ fontSize: 12.5, color: 'var(--k-6b7280)', margin: '10px 0 0', lineHeight: 1.5 }}>This applies to everything inside the folder too.</p>}
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

const contactLabel = (c: DriveContactLite) => [[c.first_name, c.last_name].filter(Boolean).join(' '), c.business_name].filter(Boolean).join(' · ') || c.email || 'the contact';

function ContactPicker({ contacts, liveDoc, isMobile, title, onClose, onPick }: { contacts: DriveContactLite[]; liveDoc?: boolean; isMobile: boolean; title: string; onClose: () => void; onPick: (c: DriveContactLite) => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return contacts.filter(c => `${c.first_name ?? ''} ${c.last_name ?? ''} ${c.business_name ?? ''} ${c.email ?? ''}`.toLowerCase().includes(t)).slice(0, 40);
  }, [contacts, q]);
  return (
    <Modal title={liveDoc ? 'Link to a contact' : 'Add to a contact'} isMobile={isMobile} onClose={onClose}>
      <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--k-6b7280)', lineHeight: 1.5 }}>{liveDoc ? <>“{title}” shows on the contact’s card as a <b>live document</b> — edits made here appear there right away. Anyone who can open that contact can open and edit it.</> : <>A copy of “{title}” goes in the Files section on the contact’s card. Later changes here won’t change the copy.</>}</p>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="🔍  Search contacts by name, company or email" style={{ width: '100%', boxSizing: 'border-box', height: isMobile ? 46 : 36, border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '0 12px', fontSize: 14, marginBottom: 8, fontFamily: "'DM Sans',sans-serif" }} />
      <div style={{ maxHeight: isMobile ? '50dvh' : 320, overflowY: 'auto' }}>
        {q.trim().length < 2 && <div style={{ padding: 12, color: 'var(--k-9ca3af)', fontSize: 14 }}>Type at least 2 letters to search.</div>}
        {q.trim().length >= 2 && list.length === 0 && <div style={{ padding: 12, color: 'var(--k-9ca3af)', fontSize: 14 }}>No contacts match.</div>}
        {list.map(c => (
          <button key={c.id} type="button" onClick={() => onPick(c)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', minHeight: isMobile ? 54 : 44, padding: '6px 10px', border: 'none', borderBottom: '1px solid var(--k-f0f0f0)', background: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            <span style={{ fontSize: 20 }}>👤</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.business_name || c.email}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--k-6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[c.business_name, c.email].filter(Boolean).join(' · ')}</span>
            </span>
            {c.type && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--k-1d4ed8)', background: 'var(--k-dbeafe)', padding: '2px 8px', borderRadius: 20 }}>{c.type}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function DealPicker({ deals, liveDoc, isMobile, title, onClose, onPick }: { deals: DriveDealLite[]; liveDoc?: boolean; isMobile: boolean; title: string; onClose: () => void; onPick: (d: DriveDealLite) => void }) {
  const [q, setQ] = useState('');
  const live = ['Active', 'LOI', 'In Contract', 'Prospect'];
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return deals
      .filter(d => !t || `${d.client ?? ''} ${d.property ?? ''} ${d.type ?? ''}`.toLowerCase().includes(t))
      .sort((a, b) => (live.indexOf(a.stage ?? '') === -1 ? 9 : live.indexOf(a.stage ?? '')) - (live.indexOf(b.stage ?? '') === -1 ? 9 : live.indexOf(b.stage ?? '')) || (a.client ?? '').localeCompare(b.client ?? ''));
  }, [deals, q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={liveDoc ? 'Link to a deal' : 'Add to a deal'} isMobile={isMobile} onClose={onClose}>
      <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--k-6b7280)', lineHeight: 1.5 }}>{liveDoc ? <>“{title}” shows on the deal’s Docs tab as a <b>live document</b> — edits made here appear there right away. Only people on that deal can open it from there.</> : <>A copy of “{title}” goes on the deal’s Docs tab. Later changes here won’t change the copy.</>}</p>
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
