'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { DriveDoc } from '@/lib/drive-types';
import { ShareDialog } from './DocsDrive';
import { leaveDrivePage } from './open-tab';
import { useCrmSession } from './useCrmSession';
import { StandaloneShell, PageMessage, Toast, useToast, useIsMobile } from './StandalonePage';

const LiveDocEditor = dynamic(() => import('./LiveDocEditor'), { ssr: false });

/**
 * A My Drive document or sheet in its own browser tab (/crm/doc/<id>) — the same live editor as in the CRM, full window, with a link of its own.
 * Not signed in → through the CRM sign-in and straight back here (the CRM's /crm/<bu>?doc=<id> link brings people to this page).
 */
export default function DriveDocPage({ docId }: { docId: string }) {
  const bu: 'commercial' | 'residential' = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('bu') === 'residential' ? 'residential' : 'commercial';
  const { state, token, me, people, isAdmin } = useCrmSession(bu);
  const [msg, toast] = useToast();
  const isMobile = useIsMobile();
  const [share, setShare] = useState<DriveDoc | null>(null);
  const valid = /^[0-9a-f-]{36}$/i.test(docId);

  useEffect(() => { document.title = 'My Drive'; }, []);
  useEffect(() => { if (state === 'out' && valid) window.location.replace(`/crm/${bu}?doc=${docId}`); }, [state, valid, bu, docId]);

  if (!valid) return <StandaloneShell><PageMessage action={{ label: 'Go to My Drive', onClick: () => leaveDrivePage(bu) }}>That is not a document link.</PageMessage></StandaloneShell>;
  if (state !== 'ready' || !me) return <StandaloneShell><PageMessage>{state === 'out' ? 'Signing you in…' : 'Opening…'}</PageMessage></StandaloneShell>;

  const name = `${me.first_name ?? ''} ${me.last_name ?? ''}`.trim();
  const who = (id: string | null) => { const p = id ? people.find(x => x.id === id) : null; return p ? `${p.first_name ?? ''} ${(p.last_name ?? '').slice(0, 1)}${p.last_name ? '.' : ''}`.trim() : '—'; };
  const saveShare = async (doc: DriveDoc, visibility: 'team' | 'private', shared_with: string[]) => {
    try {
      const r = await fetch(`/api/crm/drive/items/doc/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ share: { visibility, shared_with } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error || 'Could not change sharing');
      toast('Sharing updated'); setShare(null);
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <StandaloneShell>
      <LiveDocEditor docId={docId} authToken={token} user={{ id: me.id, name }} isMobile={isMobile} people={people} isAdmin={isAdmin}
        onClose={() => leaveDrivePage(bu)}
        onToast={toast}
        onLoaded={doc => { document.title = `${doc.title || 'Untitled'} — My Drive`; }}
        onTitle={(_id, title) => { document.title = `${title || 'Untitled'} — My Drive`; }}
        onShare={doc => { if (isAdmin || doc.created_by === me.id) setShare(doc); else toast('Only the owner or an admin can change who this is shared with'); }}
        onSign={doc => { const u = `/crm/${bu}?signdoc=${doc.id}&title=${encodeURIComponent(doc.title || '')}`; if (!window.open(u, '_blank')) window.location.href = u; }} />
      {share && <ShareDialog kind="doc" item={share} people={people.filter(p => p.id !== me.id)} can isMobile={isMobile} who={who} onClose={() => setShare(null)} onSave={(v, s) => void saveShare(share, v, s)} />}
      <Toast msg={msg} />
    </StandaloneShell>
  );
}
