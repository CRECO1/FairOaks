'use client';
// Calling Log — every call the brokerage sees, in one list: Talkroute calls and
// voicemails (pulled from its API + pushed by its webhooks), calls the AI voice
// bot answered on the Twilio line, and calls agents log by hand. The point is the
// follow-up queue: who still needs a call back, and what they wanted.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CallRow {
  id: string; source: string; kind: string; direction: string; result: string | null;
  from_number: string | null; to_number: string | null; caller_name: string | null;
  contact_id: string | null; contact?: { id: string; name: string; business_name?: string | null; type?: string | null } | null;
  deal_id: string | null; started_at: string; duration_sec: number | null; has_recording: boolean;
  transcript: string | null; summary: string | null; intent: string | null; callback_number: string | null;
  needs_follow_up: boolean; handled_at: string | null; handled_by: string | null; handled_by_name?: string | null;
  notes: string | null; ai_meta: Record<string, unknown> | null; created_at: string;
}
interface Stats { today: number; week: number; bot: number; missed: number; voicemail: number; follow_up: number }
interface Settings {
  business_unit: string; enabled: boolean; bot_name: string; company_name: string | null; greeting: string | null; instructions: string | null;
  transfer_number: string | null; notify_emails: string[]; twilio_number: string | null; talkroute_numbers: string[];
}
interface Connection { talkroute: boolean; talkroute_webhook_secret: boolean; twilio: boolean; anthropic: boolean; twilio_voice_url: string; twilio_status_url: string; talkroute_webhook_url: string }
interface Turn { id: string; role: 'bot' | 'caller'; text: string; created_at: string }
interface TextMsg { id: string; conversation_id: string; direction: 'inbound' | 'outbound'; from_number: string | null; to_number: string | null; body: string | null; attachments: Array<{ id: string; fileType?: string; link?: string }> | null; sent_at: string; sent_by: string | null; needs_follow_up: boolean; handled_at: string | null }
interface Thread { conversation_id: string; number: string | null; our_number: string | null; contact_id: string | null; contact?: { id: string; name: string; type?: string | null } | null; last: TextMsg; count: number; unanswered: boolean; inbound_count: number }

interface Props {
  authToken?: string; showToast?: (m: string) => void; isAdmin?: boolean; isSuperAdmin?: boolean; businessUnit: string;
  onOpenContact?: (contactId: string) => void;
}

const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const mini: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '8px 12px', minHeight: 36, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif" };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 4, display: 'block' };

function pretty(n: string | null | undefined): string {
  const d = String(n ?? '').replace(/\D/g, '');
  const t = d.length > 10 ? d.slice(-10) : d;
  return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : (n || 'Unknown');
}
function when(iso: string): string {
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}
const dur = (s: number | null) => s == null ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

function kindIcon(c: CallRow): string {
  if (c.source === 'voicebot') return '🤖';
  if (c.kind === 'voicemail') return '📼';
  return c.direction === 'outbound' ? '📤' : '📞';
}
function resultBadge(c: CallRow): { text: string; bg: string; fg: string } {
  const r = c.result ?? '';
  if (c.source === 'voicebot') return r === 'in_progress' ? { text: 'On the line', bg: '#dbeafe', fg: '#1d4ed8' } : { text: 'Bot answered', bg: '#ede9fe', fg: '#6d28d9' };
  if (c.kind === 'voicemail') return { text: 'Voicemail', bg: '#fef3c7', fg: '#92400e' };
  if (r === 'missed') return { text: 'Missed', bg: '#fee2e2', fg: '#b91c1c' };
  if (r === 'answered') return { text: c.direction === 'outbound' ? 'Outbound' : 'Answered', bg: '#dcfce7', fg: '#15803d' };
  if (r === 'hangup') return c.direction !== 'outbound' && c.duration_sec != null && c.duration_sec < 60 ? { text: 'Gave up waiting', bg: '#ffedd5', fg: '#9a3412' } : { text: 'Hung up', bg: '#f3f4f6', fg: '#6b7280' };
  return { text: r || (c.direction === 'outbound' ? 'Outbound' : 'Call'), bg: '#f3f4f6', fg: '#6b7280' };
}

export default function CallingLog({ authToken, showToast, isAdmin, isSuperAdmin, businessUnit, onOpenContact }: Props) {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'follow_up' | 'voicemail' | 'bot' | 'missed' | 'texts'>('all');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [textsNeedReply, setTextsNeedReply] = useState(false);   // within the Texts view: only unanswered
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [thread, setThread] = useState<Record<string, TextMsg[]>>({});
  const [reply, setReply] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [turns, setTurns] = useState<Record<string, Turn[]>>({});
  const [audio, setAudio] = useState<Record<string, string>>({});      // call id → object URL
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [showSetup, setShowSetup] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [conn, setConn] = useState<Connection | null>(null);
  const [knowledge, setKnowledge] = useState<{ configured: boolean; count: number; titles: string[] } | null>(null);
  const [draft, setDraft] = useState<Partial<Settings> & { notify_emails_text?: string; talkroute_numbers_text?: string }>({});
  const [manual, setManual] = useState({ number: '', caller_name: '', direction: 'inbound', summary: '', needs_follow_up: false });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [qLive, setQLive] = useState('');

  const loadThreads = useCallback(async () => {
    try {
      const params = new URLSearchParams({ days: String(days), business_unit: businessUnit });
      if (q) params.set('q', q);
      const j = await fetch(`/api/crm/texts?${params}`, { headers: auth(authToken) }).then(r => r.json());
      setThreads(Array.isArray(j.threads) ? j.threads : []);
    } catch { setThreads([]); }
  }, [authToken, days, q, businessUnit]);
  useEffect(() => { loadThreads(); }, [loadThreads]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ filter: filter === 'texts' ? 'all' : filter, days: String(days), business_unit: businessUnit });
      if (q) params.set('q', q);
      const j = await fetch(`/api/crm/calls?${params}`, { headers: auth(authToken) }).then(r => r.json());
      setCalls(Array.isArray(j.calls) ? j.calls : []);
    } catch { setCalls([]); }
    finally { setLoading(false); }
    try {
      const sj = await fetch(`/api/crm/calls?stats=1&business_unit=${businessUnit}`, { headers: auth(authToken) }).then(r => r.json());
      setStats(sj.stats ?? null);
    } catch { /* list is the point */ }
  }, [authToken, filter, days, q, businessUnit]);
  useEffect(() => { load(); }, [load]);

  const loadSettings = useCallback(async () => {
    try {
      const j = await fetch(`/api/crm/calls/settings?business_unit=${businessUnit}`, { headers: auth(authToken) }).then(r => r.json());
      if (j.settings) { setSettings(j.settings); setDraft({ ...j.settings, notify_emails_text: (j.settings.notify_emails || []).join(', '), talkroute_numbers_text: (j.settings.talkroute_numbers || []).join(', ') }); }
      if (j.connection) setConn(j.connection);
      if (j.listings) setKnowledge(j.listings);
    } catch { /* setup panel just shows unknown */ }
  }, [authToken, businessUnit]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Debounced search so typing a name doesn't hammer the API.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setQ(qLive.trim()), 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [qLive]);

  const nothingConnected = conn && !conn.talkroute && !conn.twilio;

  async function patch(c: CallRow, body: Record<string, unknown>, okMsg?: string) {
    setBusy(c.id);
    try {
      const r = await fetch(`/api/crm/calls?id=${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not update'); return; }
      setCalls(cs => cs.map(x => x.id === c.id ? { ...x, ...j.call, contact: x.contact } : x));
      if (okMsg) showToast?.(okMsg);
      // Counts moved.
      fetch(`/api/crm/calls?stats=1&business_unit=${businessUnit}`, { headers: auth(authToken) }).then(r => r.json()).then(sj => sj.stats && setStats(sj.stats)).catch(() => {});
    } finally { setBusy(null); }
  }

  async function toggleOpen(c: CallRow) {
    if (open === c.id) { setOpen(null); return; }
    setOpen(c.id);
    if (c.source === 'voicebot' && !turns[c.id]) {
      try {
        const j = await fetch(`/api/crm/calls?turns=${c.id}`, { headers: auth(authToken) }).then(r => r.json());
        setTurns(t => ({ ...t, [c.id]: j.turns ?? [] }));
      } catch { /* transcript text still shows */ }
    }
  }

  // The audio route needs the Bearer token, which an <audio src> can't send — so fetch it and play a blob.
  async function play(c: CallRow) {
    if (audio[c.id]) return;
    setBusy(c.id);
    try {
      const r = await fetch(`/api/crm/calls/audio?id=${c.id}`, { headers: auth(authToken) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); showToast?.(j.error || 'Recording unavailable'); return; }
      const blob = await r.blob();
      setAudio(a => ({ ...a, [c.id]: URL.createObjectURL(blob) }));
    } catch { showToast?.('Could not load the recording'); }
    finally { setBusy(null); }
  }

  async function addContact(c: CallRow) {
    const name = window.prompt('Name for the new contact:', c.caller_name || '');
    if (name == null) return;
    const parts = name.trim().split(/\s+/);
    setBusy(c.id);
    try {
      const r = await fetch('/api/crm/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) },
        body: JSON.stringify({ first_name: parts[0] || 'Caller', last_name: parts.slice(1).join(' '), cell_phone: c.callback_number || c.from_number || '', type: 'Buyer', lead_source: c.source === 'voicebot' ? 'Phone (voice bot)' : 'Phone' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.contact) { showToast?.(j.error || 'Could not add the contact'); return; }
      await patch(c, { contact_id: j.contact.id });
      setCalls(cs => cs.map(x => x.id === c.id ? { ...x, contact: { id: j.contact.id, name: name.trim() } } : x));
      showToast?.(`Added ${name.trim()} to contacts ✓`);
    } finally { setBusy(null); }
  }

  async function remove(c: CallRow) {
    if (!window.confirm('Permanently delete this call record? This cannot be undone.')) return;
    setBusy(c.id);
    try {
      const r = await fetch(`/api/crm/calls?id=${c.id}`, { method: 'DELETE', headers: auth(authToken) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); showToast?.(j.error || 'Could not delete'); return; }
      setCalls(cs => cs.filter(x => x.id !== c.id));
    } finally { setBusy(null); }
  }

  async function syncNow() {
    setBusy('sync');
    try {
      const r = await fetch('/api/crm/calls/sync?days=14', { method: 'POST', headers: auth(authToken) });
      const j = await r.json().catch(() => ({}));
      showToast?.(r.ok ? `Synced with Talkroute — ${j.inserted ?? 0} new, ${j.updated ?? 0} updated${j.callHistoryBlocked ? ' · call history is not included in your Talkroute plan (voicemails + webhooks only)' : ''}` : (j.error || 'Sync failed'));
    } finally { setBusy(null); load(); loadThreads(); }
  }

  async function openTextThread(t: Thread) {
    if (openThread === t.conversation_id) { setOpenThread(null); return; }
    setOpenThread(t.conversation_id);
    try {
      const j = await fetch(`/api/crm/texts?conversation=${encodeURIComponent(t.conversation_id)}&business_unit=${businessUnit}`, { headers: auth(authToken) }).then(r => r.json());
      setThread(th => ({ ...th, [t.conversation_id]: j.messages ?? [] }));
    } catch { /* the preview still shows */ }
  }

  async function sendReply(t: Thread) {
    const body = (reply[t.conversation_id] || '').trim();
    if (!body) return;
    setBusy(t.conversation_id);
    try {
      const r = await fetch('/api/crm/texts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ conversation_id: t.conversation_id, body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not send'); return; }
      setReply(rp => ({ ...rp, [t.conversation_id]: '' }));
      setThread(th => ({ ...th, [t.conversation_id]: [...(th[t.conversation_id] ?? []), j.message] }));
      showToast?.('Text sent ✓');
      loadThreads();
    } finally { setBusy(null); }
  }

  async function handleThread(t: Thread, handled: boolean) {
    setBusy(t.conversation_id);
    try {
      const r = await fetch(`/api/crm/texts?conversation=${encodeURIComponent(t.conversation_id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ handled }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); showToast?.(j.error || 'Could not update'); return; }
      loadThreads();
    } finally { setBusy(null); }
  }

  async function saveSettings() {
    setBusy('settings');
    try {
      const body = { ...draft, notify_emails: draft.notify_emails_text ?? '', talkroute_numbers: draft.talkroute_numbers_text ?? '' };
      const r = await fetch(`/api/crm/calls/settings?business_unit=${businessUnit}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not save'); return; }
      setSettings(j.settings); showToast?.('Voice bot settings saved ✓');
    } finally { setBusy(null); }
  }

  async function settingsAction(action: 'test_talkroute' | 'register_webhooks') {
    setBusy(action);
    try {
      const r = await fetch('/api/crm/calls/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ action }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Talkroute request failed'); return; }
      if (action === 'test_talkroute') showToast?.(`Talkroute connected ✓${j.account?.name ? ` — ${j.account.name}` : ''}`);
      else showToast?.(`Webhooks ready ✓ ${j.created?.length ? `(added ${j.created.join(', ')})` : '(already registered)'}`);
    } finally { setBusy(null); }
  }

  async function logManual() {
    if (!manual.number.trim() && !manual.caller_name.trim()) { showToast?.('Enter a number or a name'); return; }
    setBusy('manual');
    try {
      const r = await fetch('/api/crm/calls', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ ...manual, business_unit: businessUnit }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not log the call'); return; }
      setManual({ number: '', caller_name: '', direction: 'inbound', summary: '', needs_follow_up: false }); setShowLog(false);
      showToast?.('Call logged ✓'); load();
    } finally { setBusy(null); }
  }

  const list = useMemo(() => calls, [calls]);
  const light = (ok: boolean) => <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: ok ? '#22c55e' : '#ef4444', marginRight: 6, verticalAlign: 'middle' }} />;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap', rowGap: 8 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, fontWeight: 700, margin: 0, color: '#111', whiteSpace: 'nowrap' }}>📞 Calling Log</h2>
        <span style={{ fontSize: 13, color: '#9ca3af' }}>{loading ? '' : `${list.length} ${filter === 'follow_up' ? 'waiting on a call back' : filter === 'all' ? `calls · last ${days} days` : 'calls'}`}</span>
        <span style={{ flex: '1 1 auto', minWidth: 0 }} />
        {conn?.talkroute && <button onClick={syncNow} disabled={busy === 'sync'} style={{ ...mini, color: '#9ca3af' }}>{busy === 'sync' ? '⏳ Syncing…' : '⟳ Sync Talkroute'}</button>}
        <button onClick={() => setShowLog(v => !v)} style={mini}>＋ Log a call</button>
        {isAdmin && <button onClick={() => setShowSetup(v => !v)} style={{ ...mini, background: showSetup ? '#111' : '#fff', color: showSetup ? '#fff' : '#374151' }}>⚙ Setup &amp; voice bot</button>}
      </div>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0, marginBottom: 14 }}>
        Calls and voicemails from Talkroute, plus every call the AI receptionist answers on the bot line — with what the caller wanted and who still needs a call back.
      </p>

      {stats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
          {[
            { label: 'Needs call back', value: stats.follow_up, sub: 'open follow-ups', tone: stats.follow_up ? '#b91c1c' : '#15803d', pick: 'follow_up' as const },
            { label: 'Today', value: stats.today, sub: 'calls', pick: 'all' as const },
            { label: 'This week', value: stats.week, sub: 'calls', pick: 'all' as const },
            { label: 'Bot answered', value: stats.bot, sub: 'last 7 days', tone: '#6d28d9', pick: 'bot' as const },
            { label: 'Missed', value: stats.missed, sub: 'last 7 days', tone: stats.missed ? '#92400e' : undefined, pick: 'missed' as const },
            { label: 'Voicemails', value: stats.voicemail, sub: 'last 7 days', pick: 'voicemail' as const },
            { label: 'Texts to answer', value: threads.filter(t => t.unanswered).length, sub: `${threads.length} thread${threads.length === 1 ? '' : 's'}`, tone: threads.some(t => t.unanswered) ? '#b91c1c' : undefined, pick: 'texts' as const },
          ].map(c => (
            <button key={c.label} onClick={() => { setFilter(c.pick); if (c.pick === 'texts') setTextsNeedReply(c.label === 'Texts to answer' && threads.some(t => t.unanswered)); }} style={{ flex: '1 1 120px', minWidth: 112, background: '#fff', border: `1px solid ${filter === c.pick && c.pick !== 'all' ? '#c9922c' : '#eef0f3'}`, borderRadius: 10, padding: '10px 13px', textAlign: 'left', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', fontWeight: 700 }}>{c.label}</div>
              <div style={{ fontSize: 21, fontWeight: 700, marginTop: 3, color: c.tone || '#111827' }}>{c.value}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{c.sub}</div>
            </button>
          ))}
        </div>
      )}

      {/* ── Setup & voice bot (admins) ── */}
      {isAdmin && showSetup && (
        <div style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 16, marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 10 }}>Connections</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: 13, marginBottom: 12 }}>
            <div>{light(!!conn?.talkroute)} Talkroute API key {conn?.talkroute ? '' : <span style={{ color: '#9ca3af' }}>— add TALKROUTE_API_KEY in Vercel</span>}</div>
            <div>{light(!!conn?.talkroute_webhook_secret)} Talkroute webhook secret {conn?.talkroute_webhook_secret ? '' : <span style={{ color: '#9ca3af' }}>— add TALKROUTE_WEBHOOK_SECRET</span>}</div>
            <div>{light(!!conn?.twilio)} Twilio (bot line) {conn?.twilio ? '' : <span style={{ color: '#9ca3af' }}>— add TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN</span>}</div>
            <div>{light(!!conn?.anthropic)} Claude (the bot&apos;s brain)</div>
            <div title={knowledge?.titles?.join('\n')}>{light(!!knowledge?.configured && (knowledge?.count ?? 0) > 0)} Website listings {knowledge?.configured ? <span style={{ color: '#6b7280' }}>— the bot knows {knowledge.count} live listing{knowledge.count === 1 ? '' : 's'} from {businessUnit === 'residential' ? 'the website' : 'crecotx.com'}, refreshed every 5 min</span> : <span style={{ color: '#9ca3af' }}>— not connected for this workspace</span>}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <button onClick={() => settingsAction('test_talkroute')} disabled={!conn?.talkroute || busy === 'test_talkroute'} style={{ ...mini, opacity: conn?.talkroute ? 1 : .5 }}>Test Talkroute connection</button>
            <button onClick={() => settingsAction('register_webhooks')} disabled={!conn?.talkroute || !conn?.talkroute_webhook_secret || busy === 'register_webhooks'} style={{ ...mini, opacity: conn?.talkroute && conn?.talkroute_webhook_secret ? 1 : .5 }} title="Tells Talkroute to push new calls and voicemails here the moment they happen">Register Talkroute webhooks</button>
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>How the bot answers</div>
          <ol style={{ fontSize: 13, color: '#374151', margin: '0 0 14px', paddingLeft: 20, lineHeight: 1.6 }}>
            <li>Buy a local voice number in Twilio and paste it below as the bot line.</li>
            <li>In the Twilio console, on that number: <em>A call comes in</em> → Webhook <code style={{ fontSize: 12, background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>{conn?.twilio_voice_url}</code> (POST), and <em>Call status changes</em> → <code style={{ fontSize: 12, background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>{conn?.twilio_status_url}</code>.</li>
            <li>In Talkroute, add the bot line as a <em>Forwarding Number</em>. Then send calls to it wherever you want the bot to pick up: as the after-hours destination (Settings → Hours), as the “if no one answers” fallback on your ring group, or as a menu option (“press 2 to leave details with our assistant”).</li>
            <li>Talkroute webhook URL (already used by the button above): <code style={{ fontSize: 12, background: '#f3f4f6', padding: '1px 5px', borderRadius: 4, wordBreak: 'break-all' }}>{conn?.talkroute_webhook_url}</code></li>
          </ol>

          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Voice bot settings · {businessUnit}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <span style={label}>Bot</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '8px 0' }}>
                <input type="checkbox" checked={draft.enabled !== false} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} /> {draft.enabled !== false ? 'Answering calls' : 'Off — callers get a plain voicemail prompt'}
              </label>
            </div>
            <div><span style={label}>Bot name</span><input style={input} value={draft.bot_name ?? ''} onChange={e => setDraft(d => ({ ...d, bot_name: e.target.value }))} placeholder="Ava" /></div>
            <div><span style={label}>Company name (as spoken)</span><input style={input} value={draft.company_name ?? ''} onChange={e => setDraft(d => ({ ...d, company_name: e.target.value }))} placeholder={businessUnit === 'residential' ? 'Fair Oaks Realty Group' : 'CRECO'} /></div>
            <div><span style={label}>Bot line (Twilio number)</span><input style={input} value={draft.twilio_number ?? ''} onChange={e => setDraft(d => ({ ...d, twilio_number: e.target.value }))} placeholder="+1 210 555 0100" /></div>
            <div><span style={label}>Transfer to a person (optional)</span><input style={input} value={draft.transfer_number ?? ''} onChange={e => setDraft(d => ({ ...d, transfer_number: e.target.value }))} placeholder="Your cell, for emergencies" /></div>
            <div><span style={label}>Email the summary to</span><input style={input} value={draft.notify_emails_text ?? ''} onChange={e => setDraft(d => ({ ...d, notify_emails_text: e.target.value }))} placeholder="zack@crecotx.com, agent@…" /></div>
            <div><span style={label}>Your Talkroute numbers for this workspace</span><input style={input} value={draft.talkroute_numbers_text ?? ''} onChange={e => setDraft(d => ({ ...d, talkroute_numbers_text: e.target.value }))} placeholder="+1 210 555 0123, …" /></div>
          </div>
          <div style={{ marginTop: 12 }}><span style={label}>Greeting (leave blank for the default)</span><textarea style={{ ...input, minHeight: 56 }} value={draft.greeting ?? ''} onChange={e => setDraft(d => ({ ...d, greeting: e.target.value }))} placeholder={`Thanks for calling ${draft.company_name || 'CRECO'}, this is ${draft.bot_name || 'Ava'}. Our agents are with other clients right now, but I can take the details and have someone call you back. May I have your name?`} /></div>
          <div style={{ marginTop: 12 }}><span style={label}>Instructions for the bot</span><textarea style={{ ...input, minHeight: 90 }} value={draft.instructions ?? ''} onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))} placeholder={"Office hours are Mon–Fri 9–5 Central. For 8000 Fair Oaks Parkway tenant issues, ask for the suite number. Never quote lease rates."} /></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button onClick={saveSettings} disabled={busy === 'settings'} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }}>{busy === 'settings' ? 'Saving…' : 'Save settings'}</button>
            {settings && <span style={{ fontSize: 12, color: '#9ca3af' }}>Bot is {settings.enabled ? 'on' : 'off'}{settings.twilio_number ? ` · line ${pretty(settings.twilio_number)}` : ' · no bot line set yet'}</span>}
          </div>
        </div>
      )}

      {/* ── Log a call by hand ── */}
      {showLog && (
        <div style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 14, marginBottom: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div><span style={label}>Number</span><input style={input} value={manual.number} onChange={e => setManual(m => ({ ...m, number: e.target.value }))} placeholder="(210) 555-0123" /></div>
          <div><span style={label}>Name</span><input style={input} value={manual.caller_name} onChange={e => setManual(m => ({ ...m, caller_name: e.target.value }))} /></div>
          <div><span style={label}>Direction</span><select style={input} value={manual.direction} onChange={e => setManual(m => ({ ...m, direction: e.target.value }))}><option value="inbound">They called us</option><option value="outbound">We called them</option></select></div>
          <div style={{ gridColumn: '1 / -1' }}><span style={label}>What was it about</span><input style={input} value={manual.summary} onChange={e => setManual(m => ({ ...m, summary: e.target.value }))} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={manual.needs_follow_up} onChange={e => setManual(m => ({ ...m, needs_follow_up: e.target.checked }))} /> Needs a call back</label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowLog(false)} style={mini}>Cancel</button>
            <button onClick={logManual} disabled={busy === 'manual'} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }}>Save call</button>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {([['all', 'All'], ['follow_up', '🔔 Needs call back'], ['bot', '🤖 Bot'], ['voicemail', '📼 Voicemail'], ['missed', 'Missed'], ['texts', '💬 Texts']] as const).map(([k, t]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ ...mini, minHeight: 32, padding: '6px 11px', background: filter === k ? '#111' : '#fff', color: filter === k ? '#fff' : '#374151', borderColor: filter === k ? '#111' : '#e5e7eb' }}>{t}</button>
        ))}
        <input value={qLive} onChange={e => setQLive(e.target.value)} placeholder="Search name, number, what they wanted…" style={{ ...input, flex: '1 1 200px', width: 'auto', minHeight: 32, padding: '6px 10px' }} />
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ ...input, width: 'auto', minHeight: 32, padding: '6px 8px', fontSize: 12.5 }}>
          {[7, 30, 90, 365].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>

      {filter === 'texts' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#6b7280', cursor: 'pointer' }}>
              <input type="checkbox" checked={textsNeedReply} onChange={e => setTextsNeedReply(e.target.checked)} /> Only threads waiting on a reply
            </label>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>· replies go out from your Talkroute number</span>
          </div>
          {threads.filter(t => !textsNeedReply || t.unanswered).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ca3af' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>💬</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>{textsNeedReply ? 'Every text has been answered.' : 'No text threads in this window.'}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {threads.filter(t => !textsNeedReply || t.unanswered).map(t => {
                const openNow = openThread === t.conversation_id;
                const who = t.contact?.name || pretty(t.number);
                const msgs = thread[t.conversation_id];
                return (
                  <div key={t.conversation_id} style={{ background: '#fff', border: `1px solid ${t.unanswered ? '#f3e4c4' : '#eef0f2'}`, borderLeft: `4px solid ${t.unanswered ? '#c9922c' : '#e5e7eb'}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 6 }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>💬</span>
                      <div style={{ flex: '1 1 220px', minWidth: 0, cursor: 'pointer' }} onClick={() => openTextThread(t)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14.5, fontWeight: 700, color: '#111' }}>{who}</span>
                          {t.contact && onOpenContact && <button onClick={e => { e.stopPropagation(); onOpenContact(t.contact!.id); }} style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', border: 'none', borderRadius: 6, padding: '2px 7px', cursor: 'pointer' }}>👤 Contact{t.contact.type ? ` · ${t.contact.type}` : ''}</button>}
                          {t.unanswered && <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '2px 7px' }}>Needs reply</span>}
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>{t.count} message{t.count === 1 ? '' : 's'}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2 }}>{when(t.last.sent_at)}{t.contact ? ` · ${pretty(t.number)}` : ''}{t.our_number ? ` · to ${pretty(t.our_number)}` : ''}</div>
                        {!openNow && <div style={{ fontSize: 13, color: '#374151', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.last.direction === 'outbound' ? '↩ You: ' : ''}{t.last.body || (t.last.attachments?.length ? '📎 Attachment' : '')}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                        {t.number && <a href={`tel:${t.number}`} style={{ ...mini, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} title="Call them">📞</a>}
                        <button onClick={() => openTextThread(t)} style={mini}>{openNow ? '▾ Close' : '▸ Open thread'}</button>
                        {t.unanswered
                          ? <button onClick={() => handleThread(t, true)} disabled={busy === t.conversation_id} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }} title="No reply needed">✓ Handled</button>
                          : <button onClick={() => handleThread(t, false)} disabled={busy === t.conversation_id} style={{ ...mini, color: '#9ca3af' }} title="Flag for a reply">🔔</button>}
                      </div>
                    </div>
                    {openNow && (
                      <div style={{ marginTop: 10, borderTop: '1px solid #f1f2f4', paddingTop: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
                          {!msgs && <div style={{ color: '#9ca3af' }}>Loading…</div>}
                          {(msgs ?? []).map(m => (
                            <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'outbound' ? 'flex-end' : 'flex-start' }}>
                              <div style={{ maxWidth: '78%', background: m.direction === 'outbound' ? '#fdf6e9' : '#f3f4f6', color: '#111', borderRadius: 10, padding: '6px 10px' }}>
                                {m.body && <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}
                                {(m.attachments ?? []).map(a => a.link ? <a key={a.id} href={a.link} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: 12, color: '#1d4ed8' }}>📎 {a.fileType || (a as { file_type?: string }).file_type || 'attachment'}</a> : null)}
                                <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>{when(m.sent_at)}{m.direction === 'outbound' && m.sent_by ? ` · ${m.sent_by}` : ''}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
                          <textarea value={reply[t.conversation_id] ?? ''} onChange={e => setReply(rp => ({ ...rp, [t.conversation_id]: e.target.value }))} placeholder={`Reply to ${who}…`} style={{ ...input, minHeight: 44, flex: 1 }}
                            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendReply(t); }} />
                          <button onClick={() => sendReply(t)} disabled={busy === t.conversation_id || !(reply[t.conversation_id] || '').trim()} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }}>{busy === t.conversation_id ? 'Sending…' : 'Send'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : nothingConnected && !loading && list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: '#9ca3af', background: '#fffdf6', border: '2px dashed #e6d3a2', borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📞</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>Nothing is plugged in yet.</div>
          <div style={{ fontSize: 13, maxWidth: 520, margin: '6px auto 0' }}>
            Add the Talkroute API key to pull your call history and voicemails here, and a Twilio number for the AI receptionist. {isAdmin ? 'Open “Setup & voice bot” above for the exact steps.' : 'Ask an admin to finish the setup.'}
          </div>
        </div>
      ) : loading ? <div style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</div>
        : list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ca3af' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>{filter === 'follow_up' ? 'Nobody is waiting on a call back.' : 'No calls match.'}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(c => {
              const badge = resultBadge(c);
              const openNow = open === c.id;
              const who = c.contact?.name || c.caller_name || pretty(c.from_number || c.to_number);
              const num = c.direction === 'outbound' ? c.to_number : c.from_number;
              const pending = c.needs_follow_up && !c.handled_at;
              const urgent = (c.ai_meta?.urgency as string) === 'high';
              return (
                <div key={c.id} style={{ background: '#fff', border: `1px solid ${pending ? (urgent ? '#fca5a5' : '#f3e4c4') : '#eef0f2'}`, borderLeft: `4px solid ${pending ? (urgent ? '#ef4444' : '#c9922c') : '#e5e7eb'}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 6 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }} title={c.source}>{kindIcon(c)}</span>
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: '#111' }}>{who}</span>
                        {c.contact && onOpenContact && <button onClick={() => onOpenContact(c.contact!.id)} style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', border: 'none', borderRadius: 6, padding: '2px 7px', cursor: 'pointer' }}>👤 Contact{c.contact.type ? ` · ${c.contact.type}` : ''}</button>}
                        <span style={{ fontSize: 11, fontWeight: 700, color: badge.fg, background: badge.bg, borderRadius: 6, padding: '2px 7px' }}>{badge.text}</span>
                        {urgent && <span style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fee2e2', borderRadius: 6, padding: '2px 7px' }}>🚨 Urgent</span>}
                        {c.handled_at && <span style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>✓ Handled{c.handled_by_name ? ` by ${c.handled_by_name}` : ''}</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2 }}>
                        {when(c.started_at)}{c.duration_sec ? ` · ${dur(c.duration_sec)}` : ''}{num && (c.contact || c.caller_name) ? ` · ${pretty(num)}` : ''}{c.callback_number && c.callback_number !== num ? ` · call back ${pretty(c.callback_number)}` : ''}
                        {c.ai_meta?.property ? <span style={{ color: '#374151', fontWeight: 600 }}> · 🏢 {String(c.ai_meta.property)}</span> : ''}
                        {c.intent ? <span style={{ color: '#a06a12', fontWeight: 600 }}> · {c.intent}</span> : ''}
                      </div>
                      {(c.summary || c.transcript) && !openNow && <div style={{ fontSize: 13, color: '#374151', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.summary || c.transcript}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                      {num && <a href={`tel:${num}`} style={{ ...mini, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} title="Call back">📞</a>}
                      {c.has_recording && <button onClick={() => play(c)} disabled={busy === c.id} style={mini} title="Play recording">{audio[c.id] ? '🔊' : '▶'}</button>}
                      {(c.summary || c.transcript || c.source === 'voicebot' || c.notes) && <button onClick={() => toggleOpen(c)} style={mini}>{openNow ? '▾ Less' : '▸ Details'}</button>}
                      {pending
                        ? <button onClick={() => patch(c, { handled: true }, 'Marked as handled ✓')} disabled={busy === c.id} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }}>✓ Handled</button>
                        : c.handled_at ? <button onClick={() => patch(c, { handled: false, needs_follow_up: true })} disabled={busy === c.id} style={{ ...mini, color: '#9ca3af' }} title="Put it back in the queue">↩</button>
                        : <button onClick={() => patch(c, { needs_follow_up: true })} disabled={busy === c.id} style={{ ...mini, color: '#9ca3af' }} title="Flag for a call back">🔔</button>}
                      {!c.contact && (c.from_number || c.callback_number) && <button onClick={() => addContact(c)} disabled={busy === c.id} style={mini} title="Create a CRM contact from this caller">＋ Contact</button>}
                      {isSuperAdmin && <button onClick={() => remove(c)} disabled={busy === c.id} style={{ ...mini, color: '#e5b4b4', borderColor: '#f3e4e4' }} title="Delete this record">✕</button>}
                    </div>
                  </div>
                  {audio[c.id] && <audio controls autoPlay src={audio[c.id]} style={{ width: '100%', marginTop: 10, height: 36 }} />}
                  {openNow && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #f1f2f4', paddingTop: 10 }}>
                      {c.summary && <div style={{ fontSize: 13.5, color: '#111', background: '#faf7ef', borderLeft: '3px solid #c9922c', padding: '8px 10px', borderRadius: 4, marginBottom: 10 }}>{c.summary}</div>}
                      {c.source === 'voicebot' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
                          {(turns[c.id] ?? []).length === 0 && c.transcript && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, color: '#374151' }}>{c.transcript}</pre>}
                          {(turns[c.id] ?? []).map(t => (
                            <div key={t.id} style={{ display: 'flex', gap: 8, justifyContent: t.role === 'bot' ? 'flex-start' : 'flex-end' }}>
                              <div style={{ maxWidth: '78%', background: t.role === 'bot' ? '#f3f4f6' : '#fdf6e9', color: '#111', borderRadius: 10, padding: '6px 10px' }}>
                                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: .4, display: 'block' }}>{t.role === 'bot' ? (settings?.bot_name || 'Bot') : 'Caller'}</span>{t.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : c.transcript ? <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, fontSize: 13, color: '#374151' }}>{c.transcript}</pre> : null}
                      <div style={{ marginTop: 10 }}>
                        <span style={label}>Your notes</span>
                        <textarea value={noteDraft[c.id] ?? c.notes ?? ''} onChange={e => setNoteDraft(n => ({ ...n, [c.id]: e.target.value }))} style={{ ...input, minHeight: 52 }} placeholder="What you did about it…" />
                        {(noteDraft[c.id] ?? c.notes ?? '') !== (c.notes ?? '') && <button onClick={() => patch(c, { notes: noteDraft[c.id] ?? '' }, 'Note saved ✓')} disabled={busy === c.id} style={{ ...mini, marginTop: 6 }}>Save note</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
