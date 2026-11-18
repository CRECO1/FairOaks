'use client';
// Dashboard card: what is waiting on YOU. The bell only keeps the 30 newest rows, so tags and email replies that came in
// a few days ago were unread and invisible (Nov 2026 usage read: ~85% of alerts unread, 165 unread replies for one person).
// Tags / assignments / shares are listed first (they are requests from a teammate); replies are grouped per contact.
import React, { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface N { id: string; type: string; message: string; entity_type: string | null; entity_id: string | null; created_at: string; sender_id: string | null }
const supabase = createClient();
const ago = (iso: string) => { const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600_000); return h < 1 ? 'just now' : h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`; };
const TAGS = ['mention', 'assignment', 'share'];

export default function NeedsYou({ userId, onOpen, onToast }: { userId?: string; onOpen: (type: string, id: string) => void; onToast: (m: string) => void }) {
  const [rows, setRows] = useState<N[] | null>(null);
  const [showAllReplies, setShowAllReplies] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('crm_notifications').select('id, type, message, entity_type, entity_id, created_at, sender_id')
      .eq('recipient_id', userId).is('read_at', null).in('type', [...TAGS, 'email_reply']).order('created_at', { ascending: false }).limit(500);
    setRows((data ?? []) as N[]);
  }, [userId]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 90_000);
    return () => clearInterval(t);
  }, [load]);

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    await supabase.from('crm_notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
    setRows(prev => (prev ?? []).filter(r => !ids.includes(r.id)));
  };

  if (!rows?.length) return null;
  const tags = rows.filter(r => TAGS.includes(r.type));
  const byContact = new Map<string, N[]>();
  rows.filter(r => r.type === 'email_reply').forEach(r => { const k = r.entity_id || r.id; byContact.set(k, [...(byContact.get(k) ?? []), r]); });
  const groups = [...byContact.values()].sort((a, b) => +new Date(b[0].created_at) - +new Date(a[0].created_at));
  const weekAgo = Date.now() - 7 * 86400_000;
  const old = rows.filter(r => r.type === 'email_reply' && new Date(r.created_at).getTime() < weekAgo).map(r => r.id);
  const shown = showAllReplies ? groups : groups.slice(0, 5);

  const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, padding: '8px 14px', minHeight: 36, borderRadius: 16, border: '1px solid #c9922c', background: '#fff', color: '#92400e', cursor: 'pointer' };
  return (
    <div style={{ background: 'var(--k-fef3c7)', border: '1px solid var(--k-fde68a)', borderRadius: 12, padding: '12px 14px', margin: '0 0 14px' }}>
      {tags.length > 0 && (
        <div style={{ marginBottom: groups.length ? 12 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14, color: 'var(--k-92400e)', flex: 1 }}>🏷 {tags.length} tag{tags.length === 1 ? '' : 's'} &amp; assignment{tags.length === 1 ? '' : 's'} waiting on you</b>
            <button style={btn} onClick={() => markRead(tags.map(t => t.id))}>Mark all read</button>
          </div>
          {tags.slice(0, 8).map(t => (
            <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--k-374151)', padding: '4px 0', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 240px', overflowWrap: 'anywhere' }}>{t.message} <span style={{ color: 'var(--k-6b7280)', fontSize: 12 }}>· {ago(t.created_at)}</span></span>
              {t.entity_type && t.entity_id && <button style={{ ...btn, padding: '5px 12px', minHeight: 32 }} onClick={() => { markRead([t.id]); onOpen(t.entity_type!, t.entity_id!); }}>Open</button>}
            </div>
          ))}
          {tags.length > 8 && <div style={{ fontSize: 12, color: 'var(--k-6b7280)' }}>…and {tags.length - 8} more (bell, top right)</div>}
        </div>
      )}
      {groups.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14, color: 'var(--k-92400e)', flex: 1 }}>✉️ {groups.length} contact{groups.length === 1 ? '' : 's'} replied and {groups.length === 1 ? 'is' : 'are'} waiting for an answer</b>
            {old.length > 0 && <button style={btn} onClick={async () => { await markRead(old); onToast(`Cleared ${old.length} replies older than a week`); }}>Clear older than 7 days</button>}
          </div>
          {shown.map(g => (
            <div key={g[0].id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--k-374151)', padding: '4px 0', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 240px', overflowWrap: 'anywhere' }}>{g[0].message}{g.length > 1 ? ` (+${g.length - 1} more)` : ''} <span style={{ color: 'var(--k-6b7280)', fontSize: 12 }}>· {ago(g[0].created_at)}</span></span>
              {g[0].entity_id && <button style={{ ...btn, padding: '5px 12px', minHeight: 32 }} onClick={() => { markRead(g.map(x => x.id)); onOpen(g[0].entity_type || 'contact', g[0].entity_id!); }}>Open</button>}
            </div>
          ))}
          {groups.length > 5 && <button style={{ ...btn, marginTop: 6, border: 'none', background: 'transparent' }} onClick={() => setShowAllReplies(s => !s)}>{showAllReplies ? 'Show fewer' : `Show all ${groups.length}`}</button>}
        </div>
      )}
    </div>
  );
}
