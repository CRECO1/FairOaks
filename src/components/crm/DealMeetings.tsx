'use client';
// Logged meetings on a deal, each tagging the CONTACTS who attended (from the CRM
// contact list). Internal record-keeping only — contacts are never notified. In deal
// mode it's an editable log; in contact mode (clientId) it's a read-only reverse list
// of meetings that contact was part of.
import React, { useCallback, useEffect, useState } from 'react';
import { createClient as createBrowserClient } from '@/lib/supabase/client';

interface PickContact { id: string; first_name?: string; last_name?: string; business_name?: string; type?: string }
interface Attendee { id: string; name: string }
interface Meeting {
  id: string; deal_id: string; meeting_date: string; title: string | null; note: string | null;
  attendee_ids: string[]; attendees: Attendee[]; created_at: string;
  deal?: { id: string; property?: string; client?: string } | null;
}
interface Props {
  dealId?: string;
  clientId?: string;
  clients?: PickContact[];
  authToken?: string;
  businessUnit?: string;
  showToast?: (m: string) => void;
}

const GOLD = '#c9922c';
const contactName = (c: PickContact) => c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact';
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fffdf6', border: '1px solid #f0e2c4', color: '#7a5410', borderRadius: 20, padding: '3px 9px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' };

export default function DealMeetings({ dealId, clientId, clients = [], authToken, businessUnit, showToast }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [busy, setBusy] = useState(false);
  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  // form state
  const [date, setDate] = useState(todayISO());
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const q = dealId ? `deal_id=${dealId}` : `client_id=${clientId}`;
    try {
      const r = await fetch(`/api/crm/deal-meetings?${q}`, { headers: authHeaders });
      const j = await r.json();
      setMeetings(Array.isArray(j.meetings) ? j.meetings : []);
    } catch { setMeetings([]); }
    finally { setLoading(false); }
  }, [dealId, clientId]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  function resetForm() { setDate(todayISO()); setTitle(''); setNote(''); setAttendees([]); setSearch(''); }
  function startNew() { resetForm(); setEditing('new'); }
  function startEdit(m: Meeting) {
    setDate(m.meeting_date); setTitle(m.title || ''); setNote(m.note || '');
    setAttendees(m.attendees || []); setSearch(''); setEditing(m.id);
  }

  async function save() {
    if (!title.trim() && !note.trim() && attendees.length === 0) { showToast?.('Write a note or tag someone first'); return; }
    setBusy(true);
    try {
      const body = { deal_id: dealId, meeting_date: date, title: title.trim() || null, note: note.trim() || null, attendee_ids: attendees.map(a => a.id) };
      const isNew = editing === 'new';
      const r = await fetch(`/api/crm/deal-meetings${isNew ? '' : `?id=${editing}`}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) { showToast?.(j.error || 'Could not save'); return; }
      setEditing(null); resetForm(); load();
      showToast?.(isNew ? 'Note saved ✓' : 'Note updated ✓');
    } catch { showToast?.('Could not save'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this note?')) return;
    const r = await fetch(`/api/crm/deal-meetings?id=${id}`, { method: 'DELETE', headers: authHeaders });
    if (r.ok) { setMeetings(ms => ms.filter(m => m.id !== id)); showToast?.('Note deleted'); }
    else showToast?.('Could not delete');
  }

  const selectedIds = new Set(attendees.map(a => a.id));
  const [remote, setRemote] = useState<PickContact[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setRemote([]); setSearching(false); return; }
    setSearching(true);
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const sb = createBrowserClient();
        const like = `%${q.replace(/[%,]/g, '')}%`;
        const { data } = await sb.from('crm_clients')
          .select('id, first_name, last_name, business_name, type')
          .eq('business_unit', businessUnit)
          .or(`first_name.ilike.${like},last_name.ilike.${like},business_name.ilike.${like}`)
          .limit(10);
        if (alive) setRemote((data ?? []) as PickContact[]);
      } catch { if (alive) setRemote([]); }
      finally { if (alive) setSearching(false); }
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [search, businessUnit]);

  const matches = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const local = clients.filter(c => contactName(c).toLowerCase().includes(q));
    const byId = new Map<string, PickContact>();
    for (const c of [...local, ...remote]) if (!selectedIds.has(c.id)) byId.set(c.id, c);
    return Array.from(byId.values()).slice(0, 8);
  })();

  const readOnly = !dealId; // contact mode

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>📝 Internal Notes</div>
            <div style={{ fontSize: 11.5, color: '#9ca3af' }}>Tag the contacts involved so the team can see who&rsquo;s in this deal. Tagging never notifies anyone.</div>
          </div>
          {editing === null && (
            <button onClick={startNew} style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: GOLD, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>＋ Add note</button>
          )}
        </div>
      )}

      {/* ── Log / edit form ── */}
      {!readOnly && editing !== null && (
        <div style={{ border: '1px solid #eef0f2', borderRadius: 12, padding: 14, marginBottom: 14, background: '#fcfcfb' }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>Note</label>
          <textarea className="crm-input" autoFocus style={{ marginTop: 3, width: '100%', minHeight: 78, resize: 'vertical' }} value={note} onChange={e => setNote(e.target.value)} placeholder="What happened, what was decided, next steps…" />

          <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginTop: 10 }}>Tag contacts in this deal</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '5px 0' }}>
            {attendees.map(a => (
              <span key={a.id} style={chip}>{a.name}<button onClick={() => setAttendees(list => list.filter(x => x.id !== a.id))} style={{ border: 'none', background: 'none', color: '#b0873a', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button></span>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <input className="crm-input" style={{ width: '100%' }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a contact's name to tag them…" />
            {search.trim().length > 0 && matches.length === 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginTop: 2, boxShadow: '0 6px 20px rgba(0,0,0,0.10)', padding: '9px 12px', fontSize: 12.5, color: '#9ca3af' }}>
                {searching || search.trim().length < 2 ? 'Searching…' : `No contact matches "${search.trim()}"`}
              </div>
            )}
            {matches.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginTop: 2, boxShadow: '0 6px 20px rgba(0,0,0,0.10)', maxHeight: 220, overflowY: 'auto' }}>
                {matches.map(c => (
                  <button key={c.id} onClick={() => { setAttendees(list => [...list, { id: c.id, name: contactName(c) }]); setSearch(''); }}
                    style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 8, alignItems: 'center', padding: '8px 12px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#faf7ef')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                    <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{contactName(c)}</span>
                    {c.type && <span style={{ fontSize: 11, color: '#9ca3af' }}>{c.type}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Internal only — tagged contacts are never emailed or notified. They&rsquo;ll see this deal listed on their contact record.</div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 150px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4 }}>Date</label>
              <input type="date" className="crm-input" style={{ marginTop: 3, width: '100%' }} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4 }}>Title <span style={{ textTransform: 'none', fontWeight: 500 }}>(optional)</span></label>
              <input className="crm-input" style={{ marginTop: 3, width: '100%' }} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Site walk, call with lender" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={save} disabled={busy} style={{ padding: '7px 16px', fontSize: 13, fontWeight: 700, background: GOLD, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : (editing === 'new' ? 'Save note' : 'Save')}</button>
            <button onClick={() => { setEditing(null); resetForm(); }} style={{ padding: '7px 14px', fontSize: 13, fontWeight: 700, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Meeting list ── */}
      {loading ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>
        : meetings.length === 0 ? <div style={{ fontSize: 13, color: '#9ca3af', padding: '6px 0' }}>{readOnly ? 'Not tagged in any deal notes yet.' : 'No notes yet — add one and tag who\u2019s involved.'}</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {meetings.map(m => (
              <div key={m.id} style={{ border: '1px solid #eef0f2', borderRadius: 12, padding: '11px 14px', background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: m.note || m.attendees.length ? 6 : 0 }}>
                  <span style={{ fontSize: 15 }}>📝</span>
                  {readOnly && m.deal && <span style={{ fontSize: 12.5, fontWeight: 800, color: '#a06a12', background: '#fdf6e9', border: '1px solid #f0e2c4', borderRadius: 6, padding: '2px 8px' }}>{m.deal.property || m.deal.client}</span>}
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#6b7280' }}>{fmtDate(m.meeting_date)}</span>
                  {m.title && <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a1a' }}>· {m.title}</span>}
                  <span style={{ flex: 1 }} />
                  {!readOnly && (
                    <>
                      <button onClick={() => startEdit(m)} title="Edit" style={{ fontSize: 12, fontWeight: 700, color: '#a06a12', background: '#fff', border: '1px solid #f0e2c4', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Edit</button>
                      <button onClick={() => remove(m.id)} title="Delete" style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', background: '#fff', border: '1px solid #fecaca', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>✕</button>
                    </>
                  )}
                </div>
                {m.note && <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap', marginBottom: m.attendees.length ? 8 : 0 }}>{m.note}</div>}
                {m.attendees.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600 }}>👥</span>
                    {m.attendees.map(a => <span key={a.id} style={chip}>{a.name}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
