'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { dmRoom } from '@/lib/team-chat';

// TeamChat: a team room + 1-to-1 messages. Plain polling (3s while a conversation is open, 15s for the list) keeps it simple
// and independent of realtime setup; everything goes through /api/crm/chat, which enforces who may open what.
type Att = { path: string; name: string; size: number; type: string };
type Lnk = { kind: 'deal' | 'contact' | 'doc'; id: string; label: string };
type Msg = { id: string; sender_id: string; body: string; created_at: string; attachments?: Att[]; links?: Lnk[] };
export type ChatOption = { id: string; label: string };
const fmtSize = (n: number) => n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`;
const ICON: Record<Lnk['kind'], string> = { deal: '🏷️', contact: '👤', doc: '📄' };
const KIND: Record<Lnk['kind'], string> = { deal: 'Deal', contact: 'Contact', doc: 'Document' };
type RoomInfo = { room: string; other: string | null; last: { sender_id: string; body: string; created_at: string } | null; unread: number };
export type ChatPerson = { id: string; name: string };

const when = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${t}`;
};

const dayLabel = (iso: string) => {
  const d = new Date(iso), now = new Date(), y = new Date(now.getTime() - 864e5);
  return d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
};
// message text → clickable links + highlighted @names
function renderBody(text: string, names: string[], mine: boolean) {
  const re = new RegExp(`(https?://[^\\s<]+|@(?:${names.map(n => n.replace(/[^A-Za-z]/g, '')).filter(Boolean).join('|') || '$^'})\\b)`, 'gi');
  return text.split(re).map((part, i) => {
    if (/^https?:\/\//i.test(part)) { const t = part.replace(/[.,;:!?)]+$/, ''); return <React.Fragment key={i}><a href={t} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{t}</a>{part.slice(t.length)}</React.Fragment>; }
    if (part.startsWith('@') && part.length > 1) return <b key={i} style={{ background: mine ? 'rgba(255,255,255,.25)' : 'rgba(201,146,44,.25)', borderRadius: 4, padding: '0 3px' }}>{part}</b>;
    return part;
  });
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]!.toUpperCase()).join('') || '?';
function Avatar({ name, team, size = 34 }: { name: string; team?: boolean; size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: team ? '#111' : 'rgba(201,146,44,.22)', color: team ? '#c9922c' : '#8a6317', fontWeight: 700, fontSize: size * 0.38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{team ? '#' : initials(name)}</span>;
}

export default function TeamChat({ token, meId, people, isMobile, onUnread, initialRoom, deals = [], contacts = [], onOpenLink }: { token?: string; meId: string; people: ChatPerson[]; isMobile: boolean; onUnread?: (n: number) => void; initialRoom?: string; deals?: ChatOption[]; contacts?: ChatOption[]; onOpenLink?: (l: Lnk) => void }) {
  const [rooms, setRooms] = useState<Record<string, RoomInfo>>({});
  const [room, setRoom] = useState<string | null>(initialRoom ?? (isMobile ? null : 'team'));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [otherRead, setOtherRead] = useState<string | null>(null);
  const [find, setFind] = useState<string | null>(null);   // null = search closed
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendAtt, setPendAtt] = useState<Att[]>([]);
  const [pendLinks, setPendLinks] = useState<Lnk[]>([]);
  const [uploading, setUploading] = useState(0);
  const [picker, setPicker] = useState<null | 'deal' | 'contact' | 'doc'>(null);
  const [pq, setPq] = useState('');
  const [docs, setDocs] = useState<ChatOption[] | null>(null);
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
    setMsgs([]); lastAt.current = null; setErr(''); setLastRead(null); setLoaded(false); setOtherRead(null); setFind(null); setPendAtt([]); setPendLinks([]); setPicker(null); if (room) setTimeout(() => input.current?.focus(), 50);
    if (!room) return;
    let alive = true;
    let tick = 0;
    const pull = async (first: boolean) => {
      try {
        const q = new URLSearchParams({ room }); if (!first && lastAt.current) q.set('after', lastAt.current);
        const full = first || !lastAt.current;
        const r = await fetch(`/api/crm/chat?${q}`, { headers: auth(), cache: 'no-store' });
        if (!alive || roomRef.current !== room) return;
        if (!r.ok) { if (first) setErr('Could not open this conversation'); return; }
        const { messages, lastRead: lr, otherRead: or } = await r.json() as { messages: Msg[]; lastRead?: string | null; otherRead?: string | null };
        setOtherRead(or ?? null);
        if (first) { setLastRead(lr ?? null); setLoaded(true); }
        if (!messages.length) return;
        lastAt.current = messages[messages.length - 1].created_at;
        if (full) { setMsgs(messages); void loadRooms(); return; }
        setMsgs(prev => { const have = new Set(prev.map(m => m.id)); const add = messages.filter(m => !have.has(m.id)); return add.length ? [...prev, ...add] : prev; });
        void loadRooms();
      } catch { /* try again on the next tick */ }
    };
    void pull(true);
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      // every ~15s reload the whole thread so a message someone deleted disappears here too
      if (++tick % 5 === 0) { lastAt.current = null; void pull(false); } else void pull(false);
    }, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [room, auth, loadRooms]);

  useEffect(() => { void loadRooms(); const t = setInterval(() => { if (document.visibilityState === 'visible') void loadRooms(); }, 15000); return () => clearInterval(t); }, [loadRooms]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, room]);

  const send = async () => {
    const body = text.trim();
    if ((!body && !pendAtt.length && !pendLinks.length) || !room || sending || uploading) return;
    setSending(true); setErr('');
    try {
      const r = await fetch('/api/crm/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ room, body, attachments: pendAtt, links: pendLinks.map(l => ({ kind: l.kind, id: l.id })) }) });
      const j = await r.json().catch(() => ({})) as { message?: Msg; error?: string };
      if (!r.ok || !j.message) throw new Error(j.error || 'Could not send');
      setText(''); setPendAtt([]); setPendLinks([]);
      lastAt.current = j.message.created_at;
      setMsgs(prev => prev.some(m => m.id === j.message!.id) ? prev : [...prev, j.message!]);
      void loadRooms();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send'); } finally { setSending(false); }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || !room) return;
    setErr('');
    for (const f of Array.from(files).slice(0, 5 - pendAtt.length)) {
      setUploading(n => n + 1);
      try {
        const r = await fetch('/api/crm/chat/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ room, filename: f.name, size: f.size }) });
        const j = await r.json().catch(() => ({})) as { uploadUrl?: string; storagePath?: string; contentType?: string; error?: string };
        if (!r.ok || !j.uploadUrl || !j.storagePath) throw new Error(j.error || 'Could not upload that file');
        const put = await fetch(j.uploadUrl, { method: 'PUT', headers: { 'Content-Type': j.contentType || f.type || 'application/octet-stream' }, body: f });
        if (!put.ok) throw new Error('The upload did not go through — try again');
        setPendAtt(a => [...a, { path: j.storagePath!, name: f.name, size: f.size, type: j.contentType || f.type }]);
      } catch (e) { setErr(e instanceof Error ? e.message : 'Could not upload that file'); }
      finally { setUploading(n => n - 1); }
    }
    if (fileInput.current) fileInput.current.value = '';
  };
  const openAtt = async (a: Att, download = false) => {
    if (!room) return;
    const w = window.open('', '_blank');   // opened first so the popup blocker allows it
    try {
      const r = await fetch(`/api/crm/chat/file?${new URLSearchParams({ room, path: a.path, ...(download ? { download: '1' } : {}) })}`, { headers: auth() });
      const j = await r.json().catch(() => ({})) as { url?: string };
      if (!r.ok || !j.url) throw new Error('x');
      if (w) w.location.href = j.url; else window.location.href = j.url;
    } catch { w?.close(); setErr('Could not open that file'); }
  };
  const openPicker = async (k: 'deal' | 'contact' | 'doc') => {
    setPicker(k); setPq('');
    if (k === 'doc' && docs === null) {
      try {
        const r = await fetch('/api/crm/drive?view=recent', { headers: auth() });
        const j = await r.json().catch(() => ({})) as { docs?: Array<{ id: string; title: string }> };
        setDocs((j.docs ?? []).map(d => ({ id: d.id, label: d.title || 'Untitled' })));
      } catch { setDocs([]); }
    }
  };
  const pickList = picker === 'deal' ? deals : picker === 'contact' ? contacts : (docs ?? []);
  const pickShown = (pq.trim() ? pickList.filter(o => o.label.toLowerCase().includes(pq.trim().toLowerCase())) : pickList).slice(0, 8);
  const addLink = (o: ChatOption) => { if (!picker) return; setPendLinks(l => l.some(x => x.id === o.id) || l.length >= 5 ? l : [...l, { kind: picker, id: o.id, label: o.label }]); setPicker(null); input.current?.focus(); };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this message for everyone?')) return;
    setMsgs(prev => prev.filter(m => m.id !== id));
    await fetch(`/api/crm/chat?id=${id}`, { method: 'DELETE', headers: auth() }).catch(() => undefined);
  };
  const shown = find && find.trim() ? msgs.filter(m => m.body.toLowerCase().includes(find.trim().toLowerCase())) : msgs;
  const lastMine = [...msgs].reverse().find(m => m.sender_id === meId)?.id;
  const others = people.filter(p => p.id !== meId);
  const atWord = /(?:^|\s)@([A-Za-z]*)$/.exec(text);
  const suggest = atWord ? others.filter(p => p.name.split(' ')[0].toLowerCase().startsWith(atWord[1].toLowerCase())).slice(0, 5) : [];
  const names = others.map(p => p.name.split(' ')[0]);
  const items = [{ room: 'team', title: 'Team', sub: 'Everyone' }, ...others.map(p => ({ room: dmRoom(meId, p.id), title: p.name, sub: '' }))]
    .map(i => ({ ...i, info: rooms[i.room] }))
    .sort((a, b) => (a.room === 'team' ? -1 : b.room === 'team' ? 1 : (b.info?.last?.created_at ?? '').localeCompare(a.info?.last?.created_at ?? '') || a.title.localeCompare(b.title)));
  const cur = items.find(i => i.room === room);

  const list = (
    <div style={{ width: isMobile ? '100%' : 270, borderRight: isMobile ? 'none' : '1px solid var(--c-border, #e5e5e5)', overflowY: 'auto', flexShrink: 0 }}>
      {items.map(i => (
        <button key={i.room} onClick={() => { setRoom(i.room); setRooms(r => r[i.room] ? { ...r, [i.room]: { ...r[i.room], unread: 0 } } : r); }}
          style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--c-border, #eee)', background: i.room === room ? 'rgba(201,146,44,.14)' : 'transparent', cursor: 'pointer', color: 'inherit' }}>
          <Avatar name={i.title} team={i.room === 'team'} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontWeight: i.info?.unread ? 700 : 600, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
              {i.info?.last && <span style={{ marginLeft: 'auto', fontSize: 11, opacity: .5, flexShrink: 0 }}>{when(i.info.last.created_at)}</span>}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 12.5, opacity: i.info?.unread ? .85 : .6, fontWeight: i.info?.unread ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {i.info?.last ? `${i.info.last.sender_id === meId ? 'You: ' : i.room === 'team' ? `${nameOf(i.info.last.sender_id).split(' ')[0]}: ` : ''}${i.info.last.body}` : (i.sub || 'No messages yet')}
              </span>
              {!!i.info?.unread && <span style={{ marginLeft: 'auto', background: '#c9922c', color: '#fff', fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10, flexShrink: 0 }}>{i.info.unread > 99 ? '99+' : i.info.unread}</span>}
            </span>
          </span>
        </button>
      ))}
    </div>
  );

  const thread = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-border, #e5e5e5)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
        {isMobile && <button onClick={() => setRoom(null)} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: 'inherit' }} aria-label="Back">‹</button>}
        {cur && <Avatar name={cur.title} team={cur.room === 'team'} size={30} />}
        {cur ? (cur.room === 'team' ? 'Team' : cur.title) : ''}
        <button onClick={() => setFind(f => f === null ? '' : null)} aria-label="Search this conversation" title="Search this conversation" style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'inherit', opacity: .7 }}>🔍</button>
        {cur?.room === 'team' && !isMobile && <span style={{ fontWeight: 400, fontSize: 12.5, opacity: .55 }}>Type @name to alert someone’s phone</span>}
      </div>
      {find !== null && <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--c-border, #e5e5e5)' }}><input autoFocus value={find} onChange={e => setFind(e.target.value)} placeholder="Search this conversation…" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--c-border, #ccc)', fontSize: 16, background: 'var(--c-surface, #fff)', color: 'inherit', fontFamily: 'inherit' }} /></div>}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {find && find.trim() && !shown.length && <div style={{ opacity: .55, textAlign: 'center', marginTop: 30, fontSize: 14 }}>Nothing matches “{find}”.</div>}
        {!msgs.length && !err && <div style={{ opacity: .55, textAlign: 'center', marginTop: 30, fontSize: 14 }}>{loaded ? 'No messages yet — say hi.' : 'Loading…'}</div>}
        {shown.map((m, i) => {
          const mine = m.sender_id === meId, prev = shown[i - 1];
          const tight = !!prev && prev.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000 && new Date(prev.created_at).toDateString() === new Date(m.created_at).toDateString();
          const next = shown[i + 1];
          const lastInRun = !next || next.sender_id !== m.sender_id || new Date(next.created_at).getTime() - new Date(m.created_at).getTime() >= 5 * 60_000;
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const firstNew = !!lastRead && !mine && m.created_at > lastRead && !shown.slice(0, i).some(x => x.sender_id !== meId && x.created_at > lastRead);
          const showName = !mine && (!prev || prev.sender_id !== m.sender_id || newDay || firstNew);
          return (
            <React.Fragment key={m.id}>
              {newDay && <div style={{ textAlign: 'center', fontSize: 12, opacity: .55, margin: '8px 0 2px' }}>{dayLabel(m.created_at)}</div>}
              {firstNew && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c9922c', fontSize: 12, fontWeight: 700, margin: '6px 0' }}><span style={{ flex: 1, height: 1, background: '#c9922c', opacity: .5 }} />New<span style={{ flex: 1, height: 1, background: '#c9922c', opacity: .5 }} /></div>}
              <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%', marginTop: tight ? -4 : 0 }}>
                {showName && <div style={{ fontSize: 12, opacity: .65, margin: '0 4px 2px' }}>{nameOf(m.sender_id)}</div>}
                <div style={{ background: mine ? '#c9922c' : 'var(--c-surface-2, #f1f1f1)', color: mine ? '#fff' : 'inherit', padding: '8px 12px', borderRadius: 14, fontSize: 14.5, lineHeight: 1.4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body && renderBody(m.body, names, mine)}
                  {(m.links ?? []).map(l => <button key={l.id} onClick={() => onOpenLink?.(l)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', marginTop: m.body ? 7 : 0, padding: '6px 9px', borderRadius: 8, border: 'none', cursor: 'pointer', background: mine ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.06)', color: 'inherit', fontSize: 13 }}><span>{ICON[l.kind]}</span><span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 10.5, opacity: .7, textTransform: 'uppercase', letterSpacing: .5 }}>{KIND[l.kind]}</span><span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</span></span></button>)}
                  {(m.attachments ?? []).map(a => <button key={a.path} onClick={() => void openAtt(a)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', marginTop: m.body || m.links?.length ? 7 : 0, padding: '6px 9px', borderRadius: 8, border: 'none', cursor: 'pointer', background: mine ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.06)', color: 'inherit', fontSize: 13 }}><span>{a.type.startsWith('image/') ? '🖼️' : '📎'}</span><span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span><span style={{ display: 'block', fontSize: 11, opacity: .7 }}>{fmtSize(a.size)} · tap to open</span></span></button>)}
                </div>
                <div style={{ fontSize: 11, opacity: .5, margin: '2px 4px 0', textAlign: mine ? 'right' : 'left', display: lastInRun || mine ? 'block' : 'none' }}>{lastInRun ? when(m.created_at) : ''}{mine && <>{lastInRun ? ' · ' : ''}<button onClick={() => void remove(m.id)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>Delete</button>{m.id === lastMine && otherRead && otherRead >= m.created_at && ' · Seen'}</>}</div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={bottom} />
      </div>
      {suggest.length > 0 && <div style={{ display: 'flex', gap: 6, padding: '0 12px 6px', flexWrap: 'wrap' }}>{suggest.map(p => <button key={p.id} onClick={() => setText(t => t.replace(/@[A-Za-z]*$/, `@${p.name.split(' ')[0]} `))} style={{ background: 'rgba(201,146,44,.18)', border: 'none', borderRadius: 14, padding: '4px 11px', fontSize: 13, cursor: 'pointer', color: 'inherit' }}>@{p.name.split(' ')[0]}</button>)}</div>}
      {err && <div style={{ color: '#b3261e', fontSize: 13, padding: '0 16px 6px' }}>{err}</div>}
      {(pendAtt.length > 0 || pendLinks.length > 0 || uploading > 0) && <div style={{ display: 'flex', gap: 6, padding: '0 12px 6px', flexWrap: 'wrap' }}>
        {pendLinks.map(l => <span key={l.id} style={{ background: 'rgba(201,146,44,.18)', borderRadius: 14, padding: '4px 6px 4px 10px', fontSize: 12.5, display: 'inline-flex', gap: 6, alignItems: 'center', maxWidth: '100%' }}>{ICON[l.kind]} <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{l.label}</span><button onClick={() => setPendLinks(x => x.filter(y => y.id !== l.id))} aria-label="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1 }}>×</button></span>)}
        {pendAtt.map(a => <span key={a.path} style={{ background: 'rgba(0,0,0,.07)', borderRadius: 14, padding: '4px 6px 4px 10px', fontSize: 12.5, display: 'inline-flex', gap: 6, alignItems: 'center' }}>📎 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{a.name}</span><button onClick={() => setPendAtt(x => x.filter(y => y.path !== a.path))} aria-label="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1 }}>×</button></span>)}
        {uploading > 0 && <span style={{ fontSize: 12.5, opacity: .6, padding: '4px 6px' }}>Uploading…</span>}
      </div>}
      {picker && <div style={{ margin: '0 12px 8px', border: '1px solid var(--c-border, #ddd)', borderRadius: 10, background: 'var(--c-surface, #fff)', padding: 8, boxShadow: '0 4px 14px rgba(0,0,0,.08)' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>{(['deal', 'contact', 'doc'] as const).map(k => <button key={k} onClick={() => void openPicker(k)} style={{ border: 'none', borderRadius: 14, padding: '4px 12px', fontSize: 13, cursor: 'pointer', background: k === picker ? '#c9922c' : 'rgba(0,0,0,.07)', color: k === picker ? '#fff' : 'inherit', fontWeight: 600 }}>{ICON[k]} {k === 'deal' ? 'Deals' : k === 'contact' ? 'Contacts' : 'Documents'}</button>)}<button onClick={() => setPicker(null)} aria-label="Close" style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'inherit' }}>×</button></div>
        <input autoFocus value={pq} onChange={e => setPq(e.target.value)} placeholder={`Search ${picker === 'deal' ? 'deals' : picker === 'contact' ? 'contacts' : 'documents'}…`} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--c-border, #ccc)', fontSize: 16, background: 'var(--c-surface, #fff)', color: 'inherit', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        <div style={{ maxHeight: 190, overflowY: 'auto', marginTop: 6 }}>
          {picker === 'doc' && docs === null && <div style={{ padding: 8, opacity: .55, fontSize: 13 }}>Loading…</div>}
          {pickShown.map(o => <button key={o.id} onClick={() => addLink(o)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</button>)}
          {!pickShown.length && !(picker === 'doc' && docs === null) && <div style={{ padding: 8, opacity: .55, fontSize: 13 }}>Nothing found.</div>}
        </div>
      </div>}
      <input ref={fileInput} type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.gif" onChange={e => void uploadFiles(e.target.files)} />
      <div style={{ display: 'flex', gap: 8, padding: 12, paddingRight: isMobile ? 12 : 76, borderTop: '1px solid var(--c-border, #e5e5e5)', paddingBottom: isMobile ? 'calc(12px + env(safe-area-inset-bottom))' : 12 }}>
        <span style={{ display: 'inline-flex', gap: 2, alignSelf: 'center' }}>
          <button onClick={() => fileInput.current?.click()} disabled={pendAtt.length >= 5} title="Attach a file" aria-label="Attach a file" style={{ border: 'none', background: 'none', fontSize: 19, cursor: 'pointer', padding: '4px 5px', opacity: pendAtt.length >= 5 ? .4 : .8 }}>📎</button>
          <button onClick={() => { if (picker) setPicker(null); else void openPicker('deal'); }} title="Link a deal, contact or document" aria-label="Link a deal, contact or document" style={{ border: 'none', background: picker ? 'rgba(201,146,44,.2)' : 'none', borderRadius: 6, fontSize: 19, cursor: 'pointer', padding: '4px 5px', opacity: .8 }}>🔗</button>
        </span>
        <textarea ref={input} value={text} onChange={e => setText(e.target.value)} rows={1} placeholder="Write a message…" maxLength={4000}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          style={{ flex: 1, resize: 'none', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--c-border, #ccc)', fontSize: 16, fontFamily: 'inherit', background: 'var(--c-surface, #fff)', color: 'inherit', maxHeight: 120 }} />
        <button onClick={() => void send()} disabled={(!text.trim() && !pendAtt.length && !pendLinks.length) || sending || uploading > 0}
          style={{ background: '#c9922c', color: '#fff', border: 'none', borderRadius: 10, padding: '0 18px', fontWeight: 700, cursor: 'pointer', opacity: (!text.trim() && !pendAtt.length && !pendLinks.length) || sending || uploading > 0 ? .5 : 1 }}>Send</button>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: isMobile ? 'calc(100dvh - 190px)' : 'calc(100vh - 120px)', minHeight: 360, background: 'var(--c-surface, #fff)', border: '1px solid var(--c-border, #e5e5e5)', borderRadius: 12, overflow: 'hidden' }}>
      {isMobile ? (room ? thread : list) : <>{list}{room ? thread : <div style={{ flex: 1 }} />}</>}
    </div>
  );
}
