'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import DI from './DriveIcons';
import type { DrivePerson } from './DocsDrive';
import { OPEN_LIVE_DOC, LIVE_DOCS_CHANGED } from './card-edit';

const LiveDocEditor = dynamic(() => import('./LiveDocEditor'), { ssr: false });

/**
 * "Live documents" on a deal card or a contact card: My Drive documents linked to this card. They are the documents themselves, not
 * copies — opening one opens the live editor, so the card always shows the current text and an edit made anywhere shows up here.
 * "＋ New document" starts a blank one, or one from a template with the card's details filled in, already linked here.
 * Each document can be sent for signature (the E-Sign flow takes the PDF), downloaded as PDF / Word, opened or removed from the card.
 */

interface Linked { id: string; doc_id: string; title: string; updated_at: string; updated_by: string | null; linked_by: string | null; linked_at: string }
interface Tpl { id: string; title: string }

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function LinkedDocs({ dealId, clientId, authToken, currentUser, profiles, isAdmin, isMobile, onToast, onSignDoc }: {
  dealId?: string; clientId?: string; authToken?: string; currentUser: { id: string; name: string }; profiles: DrivePerson[]; isAdmin: boolean; isMobile: boolean; onToast: (m: string) => void;
  /** Send this document for signature (opens the E-Sign flow with its PDF). Omit to hide the Sign button. */
  onSignDoc?: (docId: string, title: string, dealId?: string) => void;
}) {
  const [items, setItems] = useState<Linked[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [tpls, setTpls] = useState<Tpl[] | null>(null);
  const [creating, setCreating] = useState(false);
  const q = dealId ? `deal_id=${dealId}` : clientId ? `client_id=${clientId}` : '';
  const headers = useCallback((): Record<string, string> => (authToken ? { Authorization: `Bearer ${authToken}` } : {}), [authToken]);

  const load = useCallback(async () => {
    if (!q) return;
    try {
      const r = await fetch(`/api/crm/drive/links?${q}`, { headers: headers() });
      const j = await r.json().catch(() => ({}));
      setItems(r.ok ? ((j as { links?: Linked[] }).links ?? []) : []);
    } catch { setItems([]); }
  }, [q, headers]);
  useEffect(() => { setItems(null); void load(); }, [load]);
  // A Word / text file on this card was just made editable: refresh the list and open it (only the first mounted section takes the event).
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<{ id: string; handled: boolean }>).detail; if (!d || d.handled) return; d.handled = true; setOpenId(d.id); void load(); };
    const changed = () => { void load(); };
    window.addEventListener(OPEN_LIVE_DOC, h);
    window.addEventListener(LIVE_DOCS_CHANGED, changed);
    return () => { window.removeEventListener(OPEN_LIVE_DOC, h); window.removeEventListener(LIVE_DOCS_CHANGED, changed); };
  }, [load]);

  const who = (id: string | null) => (id === currentUser.id ? 'you' : [profiles.find(p => p.id === id)?.first_name, profiles.find(p => p.id === id)?.last_name].filter(Boolean).join(' ') || 'a teammate');

  // ＋ New document: templates load the first time the menu opens.
  const openMenu = async () => {
    setMenu(m => !m);
    if (tpls === null) {
      try {
        const r = await fetch('/api/crm/drive?view=templates', { headers: headers() });
        const j = await r.json().catch(() => ({}));
        setTpls(r.ok ? ((j as { docs?: Tpl[] }).docs ?? []).map(d => ({ id: d.id, title: d.title })) : []);
      } catch { setTpls([]); }
    }
  };
  const createNew = async (templateId?: string) => {
    if (creating) return;
    setMenu(false); setCreating(true);
    try {
      const r = await fetch('/api/crm/drive/card-doc/new', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ source: dealId ? 'deal' : 'client', id: dealId ?? clientId, template_id: templateId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error || 'Could not create the document');
      await load();
      setOpenId((j as { item: { id: string } }).item.id);
    } catch (e) { onToast((e as Error).message); }
    setCreating(false);
  };

  // Download the latest saved text as a PDF or a Word file (loaded on demand; works for anyone who can open the card).
  const download = async (l: Linked, kind: 'pdf' | 'word') => {
    if (busy) return;
    setBusy(`${l.id}:${kind}`);
    try {
      const m = await import('./doc-export');
      if (kind === 'pdf') await m.exportDocPdf(l.doc_id, authToken, l.title); else await m.exportDocDocx(l.doc_id, authToken, l.title);
    } catch (e) { onToast((e as Error).message || `Could not make the ${kind === 'pdf' ? 'PDF' : 'Word file'}`); }
    setBusy(null);
  };
  const unlink = async (l: Linked) => {
    if (!confirm(`Remove “${l.title}” from this card? The document stays in My Drive.`)) return;
    try {
      const r = await fetch(`/api/crm/drive/links?id=${l.id}`, { method: 'DELETE', headers: headers() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error || 'Could not remove it');
      onToast('Removed from this card'); await load();
    } catch (e) { onToast((e as Error).message); }
  };

  const editor = openId ? (
    <LiveDocEditor docId={openId} authToken={authToken} user={currentUser} isMobile={isMobile} people={profiles} isAdmin={isAdmin}
      onClose={() => { setOpenId(null); void load(); }} onToast={onToast}
      onSign={onSignDoc ? (doc => { setOpenId(null); onSignDoc(doc.id, doc.title, dealId); }) : undefined} />
  ) : null;
  if (!q) return editor;

  const smallBtn: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, padding: '5px 10px', flexShrink: 0, minHeight: isMobile ? 36 : undefined };
  const count = items?.length ?? 0;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, position: 'relative' }}>
        <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700 }}>Live documents{count ? ` (${count})` : ''}</div>
        <button type="button" onClick={() => void openMenu()} disabled={creating} aria-haspopup="menu" aria-expanded={menu}
          style={{ background: 'none', border: 'none', cursor: creating ? 'default' : 'pointer', color: '#c9922c', fontSize: 12, fontWeight: 700, padding: isMobile ? '8px 0' : 0 }}>{creating ? 'Creating…' : '＋ New document'}</button>
        {menu && (
          <>
            <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div role="menu" style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 41, minWidth: 240, maxWidth: 'min(340px, 86vw)', maxHeight: 320, overflowY: 'auto', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.14)', padding: 6 }}>
              <button type="button" role="menuitem" onClick={() => void createNew()} style={menuItem(isMobile)}><DI n="doc" size={16} />Blank document</button>
              {tpls === null && <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--k-9ca3af)' }}>Loading templates…</div>}
              {tpls && tpls.length > 0 && <div style={{ padding: '8px 12px 4px', fontSize: 10.5, letterSpacing: .9, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700 }}>From a template — details filled in</div>}
              {(tpls ?? []).map(t => <button key={t.id} type="button" role="menuitem" onClick={() => void createNew(t.id)} style={menuItem(isMobile)}><DI n="template" size={16} /><span style={{ minWidth: 0, overflowWrap: 'anywhere', textAlign: 'left' }}>{t.title}</span></button>)}
            </div>
          </>
        )}
      </div>
      {items !== null && count === 0 && <div style={{ fontSize: 13, color: 'var(--k-9ca3af)' }}>None yet — start one with ＋ New document, or link a My Drive document to this card.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(items ?? []).map(l => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: '9px 12px' }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: '#2563eb1f', color: '#2563eb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><DI n="doc" size={18} /></span>
            <div style={{ flex: isMobile ? '1 1 calc(100% - 48px)' : '1 1 160px', minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-1a1a1a)', overflowWrap: 'anywhere' }}>{l.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>Live from My Drive · edited {ago(l.updated_at)} by {who(l.updated_by)}</div>
            </div>
            {onSignDoc && (
              <button type="button" onClick={() => onSignDoc(l.doc_id, l.title, dealId)} title="Turn the latest version into a PDF and send it for e-signature"
                style={{ ...smallBtn, color: '#a06a12', background: 'var(--k-fdf6e9)', border: '1px solid var(--k-f0e2c4)', cursor: 'pointer' }}>✍ Sign</button>
            )}
            {(['pdf', 'word'] as const).map(k => (
              <button key={k} type="button" onClick={() => void download(l, k)} disabled={!!busy} title={k === 'pdf' ? 'Download the latest version as a PDF' : 'Download the latest version as a Word (.docx) file'}
                style={{ ...smallBtn, cursor: busy ? 'default' : 'pointer', opacity: busy && busy !== `${l.id}:${k}` ? .5 : 1 }}>
                {busy === `${l.id}:${k}` ? '…' : k === 'pdf' ? '⬇ PDF' : '⬇ Word'}
              </button>
            ))}
            <button type="button" onClick={() => setOpenId(l.doc_id)} style={{ ...smallBtn, color: '#fff', background: '#111', border: 'none', padding: '5px 12px', cursor: 'pointer' }}>Open</button>
            {(isAdmin || l.linked_by === currentUser.id) && (
              <button type="button" onClick={() => void unlink(l)} title="Remove from this card" aria-label={`Remove ${l.title} from this card`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 12, textDecoration: 'underline', padding: isMobile ? '8px 6px' : '4px 2px', minHeight: isMobile ? 36 : undefined, flexShrink: 0 }}>Remove</button>
            )}
          </div>
        ))}
      </div>
      {editor}
    </div>
  );
}

const menuItem = (isMobile: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: isMobile ? 46 : 36, padding: '0 12px', border: 'none', borderRadius: 8, background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--k-1a1a1a)', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" });
