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
 * Renders nothing when nothing is linked, so cards without any stay exactly as they were.
 */

interface Linked { id: string; doc_id: string; title: string; updated_at: string; updated_by: string | null; linked_by: string | null; linked_at: string }

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function LinkedDocs({ dealId, clientId, authToken, currentUser, profiles, isAdmin, isMobile, onToast }: {
  dealId?: string; clientId?: string; authToken?: string; currentUser: { id: string; name: string }; profiles: DrivePerson[]; isAdmin: boolean; isMobile: boolean; onToast: (m: string) => void;
}) {
  const [items, setItems] = useState<Linked[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
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
      onClose={() => { setOpenId(null); void load(); }} onToast={onToast} />
  ) : null;
  if (!items || items.length === 0) return editor;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 8 }}>Live documents ({items.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(l => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: '9px 12px' }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: '#2563eb1f', color: '#2563eb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><DI n="doc" size={18} /></span>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-1a1a1a)', overflowWrap: 'anywhere' }}>{l.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>Live from My Drive · edited {ago(l.updated_at)} by {who(l.updated_by)}</div>
            </div>
            <button type="button" onClick={() => setOpenId(l.doc_id)} style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: '#111', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', flexShrink: 0, minHeight: isMobile ? 36 : undefined }}>Open</button>
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
