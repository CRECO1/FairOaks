'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { dmRoom } from '@/lib/team-chat';
import Ico from '@/components/crm/Ico';

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
function renderBody(text: string, names: string[], mine: boolean, term = '') {
  const re = new RegExp(`(https?://[^\\s<]+|@(?:${names.map(n => n.replace(/[^A-Za-z]/g, '')).filter(Boolean).join('|') || '$^'})\\b)`, 'gi');
  return text.split(re).map((part, i) => {
    if (/^https?:\/\//i.test(part)) { const t = part.replace(/[.,;:!?)]+$/, ''); return <React.Fragment key={i}><a href={t} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{t}</a>{part.slice(t.length)}</React.Fragment>; }
    if (part.startsWith('@') && part.length > 1) return <b key={i} style={{ background: mine ? 'rgba(0,0,0,.14)' : 'rgba(201,146,44,.28)', borderRadius: 4, padding: '0 3px' }}>{part}</b>;
    if (term) { const t = term.toLowerCase(), lo = part.toLowerCase(); if (lo.includes(t)) { const out: React.ReactNode[] = []; let k = 0, at = lo.indexOf(t); while (at >= 0) { if (at > k) out.push(part.slice(k, at)); out.push(<mark key={at} style={{ background: '#ffe08a', color: '#111', borderRadius: 3, padding: '0 1px' }}>{part.slice(at, at + t.length)}</mark>); k = at + t.length; at = lo.indexOf(t, k); } if (k < part.length) out.push(part.slice(k)); return <React.Fragment key={i}>{out}</React.Fragment>; } }
    return part;
  });
}

const GOLD = '#c9922c';
const BORDER = '1px solid var(--c-line, #e5e5e5)';
const MUTED = 'var(--c-muted, #6b7280)';
const SOFT = 'color-mix(in srgb, var(--c-text, #1a1a1a) 8%, var(--c-surface, #fff))';   // other people's bubbles: visible on light AND dark
const hue = (n: string) => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const fullTime = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const CSS = `
.tc-row .tc-act{opacity:0;transition:opacity .12s}
.tc-row:hover .tc-act,.tc-row.tc-sel .tc-act,.tc-act:focus-visible{opacity:1}
.tc-btn{border:none;background:none;color:inherit;cursor:pointer;font:inherit}
.tc-icon{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;border:none;background:none;color:${MUTED};cursor:pointer}
.tc-icon:hover:not(:disabled){background:color-mix(in srgb,var(--c-text,#1a1a1a) 8%,transparent);color:var(--c-text,#1a1a1a)}
.tc-icon:disabled{opacity:.4;cursor:default}
.tc-item:hover{background:color-mix(in srgb,var(--c-text,#1a1a1a) 5%,transparent)}
.tc-card:hover{filter:brightness(.96)}
.tc-field:focus-within{border-color:${GOLD}!important;box-shadow:0 0 0 3px rgba(201,146,44,.18)}
@keyframes tc-pulse{0%,100%{opacity:.5}50%{opacity:.9}}
.tc-skel{animation:tc-pulse 1.2s ease-in-out infinite;background:${SOFT};border-radius:14px}
`;

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]!.toUpperCase()).join('') || '?';
function Avatar({ name, team, size = 38 }: { name: string; team?: boolean; size?: number }) {
  const h = hue(name);
  return <span aria-hidden style={{ width: size, height: size, borderRadius: team ? 11 : '50%', background: team ? '#111' : `hsl(${h} 42% 52% / .22)`, color: team ? GOLD : 'var(--c-ink, #111)', fontWeight: 700, fontSize: size * 0.38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, letterSpacing: .3 }}>{team ? <Ico n="users" size={size * 0.52} /> : initials(name)}</span>;
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
  const [who, setWho] = useState('');                       // filter the people list
  const [sel, setSel] = useState<string | null>(null);      // tapped message (shows its actions on touch screens)
  const [mi, setMi] = useState(0);                          // highlighted @mention suggestion
  const [away, setAway] = useState(0);                      // new messages that arrived while scrolled up
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);                               // true while the reader is at the bottom of the thread
  const [pendAtt, setPendAtt] = useState<Att[]>([]);
  const [pendLinks, setPendLinks] = useState<Lnk[]>([]);
  const [uploading, setUploading] = useState(0);
  const [picker, setPicker] = useState<null | 'deal' | 'contact' | 'doc'>(null);
  const [pq, setPq] = useState('');
  const [docs, setDocs] = useState<ChatOption[] | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const roomRef = useRef(room); roomRef.current = room;
  const lastAt = useRef<string | null>(null);
  const seen = useRef(0);
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
    setMsgs([]); lastAt.current = null; seen.current = 0; stick.current = true; setAway(0); setSel(null); setErr(''); setLastRead(null); setLoaded(false); setOtherRead(null); setFind(null); setPendAtt([]); setPendLinks([]); setPicker(null); if (room && !isMobile) setTimeout(() => input.current?.focus(), 50);
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
  }, [room, auth, loadRooms, isMobile]);

  useEffect(() => { void loadRooms(); const t = setInterval(() => { if (document.visibilityState === 'visible') void loadRooms(); }, 15000); return () => clearInterval(t); }, [loadRooms]);

  // keep the newest message in view, but never yank a reader who scrolled up to older ones
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    const grew = msgs.length > seen.current;
    if (!grew) { seen.current = msgs.length; return; }
    const first = seen.current === 0;
    seen.current = msgs.length;
    if (first || stick.current || last?.sender_id === meId) { bottom.current?.scrollIntoView({ block: 'end', behavior: first ? 'auto' : 'smooth' }); setAway(0); }
    else setAway(n => n + 1);
  }, [msgs, meId]);
  const onScroll = () => { const el = scroller.current; if (!el) return; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (stick.current) setAway(0); };
  const jump = () => { stick.current = true; setAway(0); bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); };

  // the composer grows with what you type (up to ~6 lines)
  useEffect(() => { const el = input.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; }, [text, room]);

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
      input.current?.focus();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send'); } finally { setSending(false); }
  };

  const uploadFiles = async (files: File[] | FileList | null) => {
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
  const term = find?.trim() ?? '';
  const shown = term ? msgs.filter(m => m.body.toLowerCase().includes(term.toLowerCase())) : msgs;
  const lastMine = [...msgs].reverse().find(m => m.sender_id === meId)?.id;
  const others = people.filter(p => p.id !== meId);
  const atWord = /(?:^|\s)@([A-Za-z]*)$/.exec(text);
  const suggest = atWord ? others.filter(p => p.name.split(' ')[0].toLowerCase().startsWith(atWord[1].toLowerCase())).slice(0, 5) : [];
  const pickMention = (p: ChatPerson) => { setText(t => t.replace(/@[A-Za-z]*$/, `@${p.name.split(' ')[0]} `)); setMi(0); input.current?.focus(); };
  const names = others.map(p => p.name.split(' ')[0]);
  const items = [{ room: 'team', title: 'Team', sub: 'Everyone' }, ...others.map(p => ({ room: dmRoom(meId, p.id), title: p.name, sub: '' }))]
    .map(i => ({ ...i, info: rooms[i.room] }))
    .sort((a, b) => (a.room === 'team' ? -1 : b.room === 'team' ? 1 : (b.info?.last?.created_at ?? '').localeCompare(a.info?.last?.created_at ?? '') || a.title.localeCompare(b.title)));
  const cur = items.find(i => i.room === room);
  const q = who.trim().toLowerCase();
  const listed = q ? items.filter(i => i.title.toLowerCase().includes(q)) : items;
  const canSend = !!(text.trim() || pendAtt.length || pendLinks.length) && !sending && uploading === 0;

  const row = (i: typeof items[number]) => (
    <button key={i.room} className="tc-item" aria-current={i.room === room} onClick={() => { setRoom(i.room); setRooms(r => r[i.room] ? { ...r, [i.room]: { ...r[i.room], unread: 0 } } : r); }}
      style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderLeft: `3px solid ${i.room === room ? GOLD : 'transparent'}`, background: i.room === room ? 'rgba(201,146,44,.14)' : undefined, cursor: 'pointer', color: 'inherit' }}>
      <Avatar name={i.title} team={i.room === 'team'} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: i.info?.unread ? 700 : 600, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
          {i.info?.last && <span style={{ marginLeft: 'auto', fontSize: 11, color: i.info.unread ? GOLD : MUTED, fontWeight: i.info.unread ? 700 : 400, flexShrink: 0 }}>{when(i.info.last.created_at)}</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 12.5, color: i.info?.unread ? 'var(--c-text)' : MUTED, fontWeight: i.info?.unread ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {i.info?.last ? `${i.info.last.sender_id === meId ? 'You: ' : i.room === 'team' ? `${nameOf(i.info.last.sender_id).split(' ')[0]}: ` : ''}${i.info.last.body || 'Attachment'}` : (i.sub || 'No messages yet')}
          </span>
          {!!i.info?.unread && <span style={{ marginLeft: 'auto', background: GOLD, color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 20, textAlign: 'center', padding: '1px 6px', borderRadius: 10, flexShrink: 0 }}>{i.info.unread > 99 ? '99+' : i.info.unread}</span>}
        </span>
      </span>
    </button>
  );
  const label = (t: string) => <div style={{ padding: '12px 15px 4px', fontSize: 11, fontWeight: 700, letterSpacing: .7, textTransform: 'uppercase', color: MUTED }}>{t}</div>;

  const list = (
    <div style={{ width: isMobile ? '100%' : 300, borderRight: isMobile ? 'none' : BORDER, display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0 }}>
      <div style={{ padding: '14px 14px 8px' }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 10 }}>Team Chat</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 36, borderRadius: 10, border: BORDER, background: 'var(--c-surface-2, #fafafa)', color: MUTED }}>
          <Ico n="search" size={15} />
          <input value={who} onChange={e => setWho(e.target.value)} placeholder="Find a teammate" aria-label="Find a teammate" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--c-text)', fontSize: 16, fontFamily: 'inherit' }} />
          {who && <button className="tc-btn" onClick={() => setWho('')} aria-label="Clear" style={{ display: 'inline-flex', color: MUTED }}><Ico n="close" size={14} /></button>}
        </label>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {listed.some(i => i.room === 'team') && <>{label('Channel')}{listed.filter(i => i.room === 'team').map(row)}</>}
        {listed.some(i => i.room !== 'team') && <>{label('Direct messages')}{listed.filter(i => i.room !== 'team').map(row)}</>}
        {!listed.length && <div style={{ padding: 20, textAlign: 'center', color: MUTED, fontSize: 13.5 }}>No teammate matches “{who}”.</div>}
      </div>
    </div>
  );

  const chip = (key: string, children: React.ReactNode, onX: () => void, tint: string) => (
    <span key={key} style={{ background: tint, borderRadius: 16, padding: '4px 4px 4px 11px', fontSize: 12.5, display: 'inline-flex', gap: 6, alignItems: 'center', maxWidth: '100%' }}>{children}
      <button className="tc-btn" onClick={onX} aria-label="Remove" style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }}><Ico n="close" size={12} /></button></span>
  );
  const card = (key: string, icon: React.ReactNode, kind: string | null, title: string, sub: string | null, mine: boolean, top: boolean, onClick: () => void) => (
    <button key={key} className="tc-card" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', marginTop: top ? 7 : 0, padding: '7px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', background: mine ? 'rgba(0,0,0,.12)' : 'color-mix(in srgb, var(--c-text,#1a1a1a) 7%, transparent)', color: 'inherit', fontSize: 13 }}>
      <span style={{ fontSize: 17, display: 'inline-flex' }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        {kind && <span style={{ display: 'block', fontSize: 10.5, opacity: .7, textTransform: 'uppercase', letterSpacing: .5 }}>{kind}</span>}
        <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 11, opacity: .7 }}>{sub}</span>}
      </span>
    </button>
  );

  const thread = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, position: 'relative' }}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }} onDragLeave={e => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDrag(false); void uploadFiles(e.dataTransfer.files); } }}>
      <div style={{ padding: '10px 14px', borderBottom: BORDER, display: 'flex', alignItems: 'center', gap: 10, minHeight: 58 }}>
        {isMobile && <button className="tc-icon" onClick={() => setRoom(null)} aria-label="Back to conversations"><Ico n="back" size={20} /></button>}
        {cur && <Avatar name={cur.title} team={cur.room === 'team'} size={36} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cur?.title ?? ''}</div>
          <div style={{ fontSize: 12, color: MUTED }}>{cur?.room === 'team' ? `Everyone · ${people.length} ${people.length === 1 ? 'person' : 'people'} · @name pings a phone` : 'Direct message · private to the two of you'}</div>
        </div>
        <button className="tc-icon" onClick={() => setFind(f => f === null ? '' : null)} aria-label="Search this conversation" title="Search this conversation" style={find !== null ? { background: 'rgba(201,146,44,.2)', color: GOLD } : undefined}><Ico n="search" size={18} /></button>
      </div>
      {find !== null && <div style={{ padding: '8px 14px', borderBottom: BORDER, display: 'flex', alignItems: 'center', gap: 10 }}>
        <input autoFocus value={find} onChange={e => setFind(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setFind(null); }} placeholder="Search this conversation…" style={{ flex: 1, minWidth: 0, padding: '8px 11px', borderRadius: 9, border: BORDER, fontSize: 16, background: 'var(--c-surface-2, #fafafa)', color: 'inherit', fontFamily: 'inherit' }} />
        {term && <span style={{ fontSize: 12.5, color: MUTED, whiteSpace: 'nowrap' }}>{shown.length} {shown.length === 1 ? 'match' : 'matches'}</span>}
      </div>}
      <div ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {term && !shown.length && <div style={{ color: MUTED, textAlign: 'center', marginTop: 40, fontSize: 14 }}>Nothing matches “{find}”.</div>}
        {!loaded && !err && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }} aria-label="Loading">{[55, 38, 62, 30].map((w, k) => <div key={k} className="tc-skel" style={{ height: 38, width: `${w}%`, alignSelf: k % 2 ? 'flex-end' : 'flex-start' }} />)}</div>}
        {loaded && !msgs.length && !err && <div style={{ textAlign: 'center', margin: 'auto', padding: 20 }}>
          <div style={{ display: 'inline-flex', marginBottom: 10 }}><Avatar name={cur?.title ?? ''} team={cur?.room === 'team'} size={56} /></div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{cur?.room === 'team' ? 'Start the team conversation' : `Say hi to ${cur?.title.split(' ')[0] ?? 'your teammate'}`}</div>
          <div style={{ color: MUTED, fontSize: 13.5, marginTop: 4 }}>Share a deal, contact or file with the 🔗 and 📎 buttons below.</div>
        </div>}
        {err && !msgs.length && <div style={{ color: '#b3261e', textAlign: 'center', margin: 'auto', fontSize: 14 }}>{err}</div>}
        {shown.map((m, i) => {
          const mine = m.sender_id === meId, prev = shown[i - 1];
          const gap = (a: Msg, b: Msg) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() >= 5 * 60_000 || a.sender_id !== b.sender_id || new Date(a.created_at).toDateString() !== new Date(b.created_at).toDateString();
          const tight = !!prev && !gap(prev, m);
          const next = shown[i + 1];
          const lastInRun = !next || gap(m, next);
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const firstNew = !!lastRead && !mine && m.created_at > lastRead && !shown.slice(0, i).some(x => x.sender_id !== meId && x.created_at > lastRead);
          const head = !mine && (!tight || firstNew);
          return (
            <React.Fragment key={m.id}>
              {newDay && <div style={{ textAlign: 'center', margin: '12px 0 6px' }}><span style={{ fontSize: 11.5, fontWeight: 600, color: MUTED, background: SOFT, padding: '3px 11px', borderRadius: 12 }}>{dayLabel(m.created_at)}</span></div>}
              {firstNew && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: GOLD, fontSize: 12, fontWeight: 700, margin: '8px 0' }}><span style={{ flex: 1, height: 1, background: GOLD, opacity: .5 }} />New messages<span style={{ flex: 1, height: 1, background: GOLD, opacity: .5 }} /></div>}
              <div className={`tc-row${sel === m.id ? ' tc-sel' : ''}`} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: tight ? 0 : 8 }}>
                {!mine && <div style={{ width: 30, flexShrink: 0, alignSelf: 'flex-start' }}>{head && <Avatar name={nameOf(m.sender_id)} size={30} />}</div>}
                {mine && <button className="tc-btn tc-act tc-icon" onClick={() => void remove(m.id)} aria-label="Delete this message" title="Delete" style={{ width: 28, height: 28 }}><Ico n="trash" size={15} /></button>}
                <div style={{ maxWidth: isMobile ? '82%' : '70%', minWidth: 0 }}>
                  {head && <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 4px 2px' }}>{nameOf(m.sender_id)}</div>}
                  <div title={fullTime(m.created_at)} onClick={() => { if (isMobile && mine) setSel(s => s === m.id ? null : m.id); }}
                    style={{ background: mine ? GOLD : SOFT, color: mine ? '#1a1206' : 'inherit', padding: '8px 12px', borderRadius: 16, borderBottomRightRadius: mine && lastInRun ? 5 : 16, borderBottomLeftRadius: !mine && lastInRun ? 5 : 16, fontSize: 14.5, lineHeight: 1.42, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {m.body && renderBody(m.body, names, mine, term)}
                    {(m.links ?? []).map(l => card(l.id, ICON[l.kind], KIND[l.kind], l.label, null, mine, !!m.body, () => onOpenLink?.(l)))}
                    {(m.attachments ?? []).map(a => card(a.path, a.type.startsWith('image/') ? '🖼️' : '📎', null, a.name, `${fmtSize(a.size)} · open`, mine, !!m.body || !!m.links?.length, () => void openAtt(a)))}
                  </div>
                  {(lastInRun || (mine && m.id === lastMine)) && <div style={{ fontSize: 11, color: MUTED, margin: '2px 4px 0', textAlign: mine ? 'right' : 'left' }}>{lastInRun && when(m.created_at)}{mine && m.id === lastMine && otherRead && otherRead >= m.created_at && <span style={{ color: GOLD, fontWeight: 600 }}>{lastInRun ? ' · ' : ''}Seen</span>}</div>}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={bottom} />
      </div>
      {away > 0 && <button onClick={jump} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 86, background: GOLD, color: '#1a1206', border: 'none', borderRadius: 18, padding: '7px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,.25)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ico n="arrowdown" size={14} />{away} new {away === 1 ? 'message' : 'messages'}</button>}
      {drag && <div style={{ position: 'absolute', inset: 0, background: 'rgba(201,146,44,.14)', border: `2px dashed ${GOLD}`, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: GOLD, pointerEvents: 'none', zIndex: 5 }}>Drop files to attach</div>}
      {suggest.length > 0 && <div role="listbox" aria-label="Mention a teammate" style={{ margin: '0 14px 6px', border: BORDER, borderRadius: 12, background: 'var(--c-surface, #fff)', boxShadow: '0 6px 20px rgba(0,0,0,.14)', overflow: 'hidden' }}>
        {suggest.map((p, k) => <button key={p.id} role="option" aria-selected={k === mi % suggest.length} onMouseDown={e => { e.preventDefault(); pickMention(p); }} onMouseEnter={() => setMi(k)} className="tc-btn" style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 14, background: k === mi % suggest.length ? 'rgba(201,146,44,.16)' : 'transparent' }}><Avatar name={p.name} size={24} /><b>@{p.name.split(' ')[0]}</b><span style={{ color: MUTED, fontSize: 12.5 }}>{p.name}</span></button>)}
      </div>}
      {err && msgs.length > 0 && <div role="alert" style={{ color: '#b3261e', fontSize: 13, padding: '0 16px 6px' }}>{err}</div>}
      {(pendAtt.length > 0 || pendLinks.length > 0 || uploading > 0) && <div style={{ display: 'flex', gap: 6, padding: '0 14px 8px', flexWrap: 'wrap' }}>
        {pendLinks.map(l => chip(l.id, <>{ICON[l.kind]} <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{l.label}</span></>, () => setPendLinks(x => x.filter(y => y.id !== l.id)), 'rgba(201,146,44,.2)'))}
        {pendAtt.map(a => chip(a.path, <>📎 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{a.name}</span></>, () => setPendAtt(x => x.filter(y => y.path !== a.path)), SOFT))}
        {uploading > 0 && <span style={{ fontSize: 12.5, color: MUTED, padding: '4px 6px' }}>Uploading…</span>}
      </div>}
      {picker && <div style={{ margin: '0 14px 8px', border: BORDER, borderRadius: 12, background: 'var(--c-surface, #fff)', padding: 8, boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>{(['deal', 'contact', 'doc'] as const).map(k => <button key={k} onClick={() => void openPicker(k)} style={{ border: 'none', borderRadius: 14, padding: '5px 12px', fontSize: 13, cursor: 'pointer', background: k === picker ? GOLD : SOFT, color: k === picker ? '#1a1206' : 'inherit', fontWeight: 600 }}>{ICON[k]} {k === 'deal' ? 'Deals' : k === 'contact' ? 'Contacts' : 'Documents'}</button>)}<button className="tc-icon" onClick={() => setPicker(null)} aria-label="Close" style={{ marginLeft: 'auto', width: 28, height: 28 }}><Ico n="close" size={15} /></button></div>
        <input autoFocus value={pq} onChange={e => setPq(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setPicker(null); else if (e.key === 'Enter' && pickShown[0]) addLink(pickShown[0]); }} placeholder={`Search ${picker === 'deal' ? 'deals' : picker === 'contact' ? 'contacts' : 'documents'}…`} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: BORDER, fontSize: 16, background: 'var(--c-surface-2, #fafafa)', color: 'inherit', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        <div style={{ maxHeight: 190, overflowY: 'auto', marginTop: 6 }}>
          {picker === 'doc' && docs === null && <div style={{ padding: 8, color: MUTED, fontSize: 13 }}>Loading…</div>}
          {pickShown.map(o => <button key={o.id} className="tc-item" onClick={() => addLink(o)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</button>)}
          {!pickShown.length && !(picker === 'doc' && docs === null) && <div style={{ padding: 8, color: MUTED, fontSize: 13 }}>Nothing found.</div>}
        </div>
      </div>}
      <input ref={fileInput} type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.gif" onChange={e => void uploadFiles(e.target.files)} />
      <div style={{ padding: 12, paddingRight: isMobile ? 12 : 76, paddingBottom: isMobile ? 'calc(12px + env(safe-area-inset-bottom))' : 12, borderTop: BORDER }}>
        <div className="tc-field" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '4px 5px 4px 4px', borderRadius: 14, border: BORDER, background: 'var(--c-surface-2, #fafafa)', transition: 'border-color .12s, box-shadow .12s' }}>
          <button className="tc-icon" onClick={() => fileInput.current?.click()} disabled={pendAtt.length >= 5} title="Attach a file" aria-label="Attach a file"><Ico n="paperclip" size={19} /></button>
          <button className="tc-icon" onClick={() => { if (picker) setPicker(null); else void openPicker('deal'); }} title="Link a deal, contact or document" aria-label="Link a deal, contact or document" style={picker ? { background: 'rgba(201,146,44,.22)', color: GOLD } : undefined}><Ico n="link" size={19} /></button>
          <textarea ref={input} value={text} onChange={e => { setText(e.target.value); setMi(0); }} rows={1} maxLength={4000} aria-label="Write a message"
            placeholder={cur?.room === 'team' ? 'Message the team — @name pings a phone' : `Message ${cur?.title.split(' ')[0] ?? ''}`}
            onPaste={e => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); void uploadFiles(fs); } }}
            onKeyDown={e => {
              if (suggest.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMi(n => (n + 1) % suggest.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setMi(n => (n + suggest.length - 1) % suggest.length); return; }
                if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pickMention(suggest[mi % suggest.length]); return; }
                if (e.key === 'Escape') { e.preventDefault(); setText(t => t.replace(/@[A-Za-z]*$/, '')); return; }
              }
              if (e.key === 'Enter' && !e.shiftKey && !isMobile) { e.preventDefault(); void send(); }
            }}
            style={{ flex: 1, minWidth: 0, resize: 'none', padding: '8px 6px', border: 'none', outline: 'none', background: 'transparent', fontSize: 16, lineHeight: 1.4, fontFamily: 'inherit', color: 'var(--c-text)', maxHeight: 140 }} />
          <button onClick={() => void send()} disabled={!canSend} aria-label="Send message" title="Send (Enter)"
            style={{ width: 36, height: 36, borderRadius: 11, border: 'none', background: canSend ? GOLD : SOFT, color: canSend ? '#1a1206' : MUTED, cursor: canSend ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .12s' }}><Ico n="send" size={18} /></button>
        </div>
        {!isMobile && <div style={{ fontSize: 11, color: MUTED, margin: '4px 6px 0' }}>Enter to send · Shift+Enter for a new line · drop or paste files to attach</div>}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: isMobile ? 'calc(100dvh - 190px)' : 'calc(100vh - 120px)', minHeight: 360, background: 'var(--c-surface, #fff)', border: BORDER, borderRadius: 14, overflow: 'hidden' }}>
      <style>{CSS}</style>
      {isMobile ? (room ? thread : list) : <>{list}{room ? thread : <div style={{ flex: 1 }} />}</>}
    </div>
  );
}
