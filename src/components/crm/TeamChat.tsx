'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { dmRoom } from '@/lib/team-chat';

// TeamChat: a team room + 1-to-1 messages. Plain polling (3s while a conversation is open, 15s for the list) keeps it simple
// and independent of realtime setup; everything goes through /api/crm/chat, which enforces who may open what.
type Msg = { id: string; sender_id: string; body: string; created_at: string };
type RoomInfo = { room: string; other: string | null; last: { sender_id: string; body: string; created_at: string } | null; unread: number };
export type ChatPerson = { id: string; name: string };

const when = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${t}`;
};

export default function TeamChat({ token, meId, people, isMobile, onUnread, initialRoom }: { token?: string; meId: string; people: ChatPerson[]; isMobile: boolean; onUnread?: (n: number) => void; initialRoom?: string }) {
  const [rooms, setRooms] = useState<Record<string, RoomInfo>>({});
  const [room, setRoom] = useState<string | null>(isMobile ? null : (initialRoom ?? 'team'));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const roomRef = useRef(room); roomRef.current = room;
  const lastAt = useRef<string | null>(null);
  const auth = useCallback((): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const nameOf = useCallback((id: string) => id === meId ? 'You' : (people.find(p => p.id === id)?.name ?? 'Teammate'), [people, meId]);

  const loadRooms = useCallback(async () => {
    try {
      const r = await fetch('/api/crm/chat/summary', { headers: auth(), cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json() as { rooms: RoomInfo[]; unread: number };
      setRooms(Object.fromEntries(j.rooms.map(x => [x.room, x])));
      onUnread?.(j.unread);
    } catch { /* offline: keep what we have */ }
  }, [auth, onUnread]);

  // open a conversation: load its history, then poll for anything newer
  useEffect(() => {
    setMsgs([]); lastAt.current = null; setErr('');
    if (!room) return;
    let alive = true;
    const pull = async (first: boolean) => {
      try {
        const q = new URLSearchParams({ room }); if (!first && lastAt.current) q.set('after', lastAt.current);
        const r = await fetch(`/api/crm/chat?${q}`, { headers: auth(), cache: 'no-store' });
        if (!alive || roomRef.current !== room) return;
        if (!r.ok) { if (first) setErr('Could not open this conversation'); return; }
        const { messages } = await r.json() as { messages: Msg[] };
        if (!messages.length) return;
        lastAt.current = messages[messages.length - 1].created_at;
        setMsgs(prev => { const have = new Set(prev.map(m => m.id)); const add = messages.filter(m => !have.has(m.id)); return add.length ? [...prev, ...add] : prev; });
        void loadRooms();
      } catch { /* try again on the next tick */ }
    };
    void pull(true);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void pull(false); }, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [room, auth, loadRooms]);

  useEffect(() => { void loadRooms(); const t = setInterval(() => { if (document.visibilityState === 'visible') void loadRooms(); }, 15000); return () => clearInterval(t); }, [loadRooms]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, room]);

  const send = async () => {
    const body = text.trim();
    if (!body || !room || sending) return;
    setSending(true); setErr('');
    try {
      const r = await fetch('/api/crm/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ room, body }) });
      const j = await r.json().catch(() => ({})) as { message?: Msg; error?: string };
      if (!r.ok || !j.message) throw new Error(j.error || 'Could not send');
      setText('');
      lastAt.current = j.message.created_at;
      setMsgs(prev => prev.some(m => m.id === j.message!.id) ? prev : [...prev, j.message!]);
      void loadRooms();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send'); } finally { setSending(false); }
  };

  const others = people.filter(p => p.id !== meId);
  const items = [{ room: 'team', title: 'Team', sub: 'Everyone' }, ...others.map(p => ({ room: dmRoom(meId, p.id), title: p.name, sub: '' }))]
    .map(i => ({ ...i, info: rooms[i.room] }))
    .sort((a, b) => (a.room === 'team' ? -1 : b.room === 'team' ? 1 : (b.info?.last?.created_at ?? '').localeCompare(a.info?.last?.created_at ?? '') || a.title.localeCompare(b.title)));
  const cur = items.find(i => i.room === room);

  const list = (
    <div style={{ width: isMobile ? '100%' : 270, borderRight: isMobile ? 'none' : '1px solid var(--c-border, #e5e5e5)', overflowY: 'auto', flexShrink: 0 }}>
      {items.map(i => (
        <button key={i.room} onClick={() => { setRoom(i.room); setRooms(r => r[i.room] ? { ...r, [i.room]: { ...r[i.room], unread: 0 } } : r); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--c-border, #eee)', background: i.room === room ? 'rgba(201,146,44,.14)' : 'transparent', cursor: 'pointer', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: i.info?.unread ? 700 : 600, fontSize: 14.5 }}>{i.room === 'team' ? '# ' : ''}{i.title}</span>
            {!!i.info?.unread && <span style={{ marginLeft: 'auto', background: '#c9922c', color: '#fff', fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10 }}>{i.info.unread > 99 ? '99+' : i.info.unread}</span>}
          </div>
          <div style={{ fontSize: 12.5, opacity: .65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
            {i.info?.last ? `${i.info.last.sender_id === meId ? 'You: ' : i.room === 'team' ? `${nameOf(i.info.last.sender_id).split(' ')[0]}: ` : ''}${i.info.last.body}` : (i.sub || 'No messages yet')}
          </div>
        </button>
      ))}
    </div>
  );

  const thread = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-border, #e5e5e5)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
        {isMobile && <button onClick={() => setRoom(null)} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: 'inherit' }} aria-label="Back">‹</button>}
        {cur ? (cur.room === 'team' ? '# Team' : cur.title) : ''}
        {cur?.room === 'team' && <span style={{ fontWeight: 400, fontSize: 12.5, opacity: .6 }}>@FirstName to alert someone’s phone</span>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!msgs.length && !err && <div style={{ opacity: .55, textAlign: 'center', marginTop: 30, fontSize: 14 }}>No messages yet — say hi.</div>}
        {msgs.map((m, i) => {
          const mine = m.sender_id === meId, prev = msgs[i - 1];
          const showName = !mine && (!prev || prev.sender_id !== m.sender_id);
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
              {showName && <div style={{ fontSize: 12, opacity: .65, margin: '0 4px 2px' }}>{nameOf(m.sender_id)}</div>}
              <div style={{ background: mine ? '#c9922c' : 'var(--c-surface-2, #f1f1f1)', color: mine ? '#fff' : 'inherit', padding: '8px 12px', borderRadius: 14, fontSize: 14.5, lineHeight: 1.4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
              <div style={{ fontSize: 11, opacity: .5, margin: '2px 4px 0', textAlign: mine ? 'right' : 'left' }}>{when(m.created_at)}</div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {err && <div style={{ color: '#b3261e', fontSize: 13, padding: '0 16px 6px' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--c-border, #e5e5e5)', paddingBottom: isMobile ? 'calc(12px + env(safe-area-inset-bottom))' : 12 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder="Write a message…" maxLength={4000}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          style={{ flex: 1, resize: 'none', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--c-border, #ccc)', fontSize: 16, fontFamily: 'inherit', background: 'var(--c-surface, #fff)', color: 'inherit', maxHeight: 120 }} />
        <button onClick={() => void send()} disabled={!text.trim() || sending}
          style={{ background: '#c9922c', color: '#fff', border: 'none', borderRadius: 10, padding: '0 18px', fontWeight: 700, cursor: 'pointer', opacity: !text.trim() || sending ? .5 : 1 }}>Send</button>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: isMobile ? 'calc(100dvh - 190px)' : 'calc(100vh - 120px)', minHeight: 360, background: 'var(--c-surface, #fff)', border: '1px solid var(--c-border, #e5e5e5)', borderRadius: 12, overflow: 'hidden' }}>
      {isMobile ? (room ? thread : list) : <>{list}{room ? thread : <div style={{ flex: 1 }} />}</>}
    </div>
  );
}
