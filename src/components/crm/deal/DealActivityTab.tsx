'use client';
/**
 * Activity tab: quick-entry dated note, log-a-call + next-step card, and the unified
 * timeline (emails, calls, meetings, stage changes, tags/mentions, notes, tasks),
 * newest first, grouped by day, with filter chips.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import MentionTextarea from '../MentionTextarea';
import { Icon } from './dealUi';

type Kind = 'email' | 'call' | 'meeting' | 'stage' | 'note' | 'tag' | 'task';
interface Item { id: string; kind: Kind; at: string; title: string; detail?: string | null; actor_id?: string | null }

const KINDS: { k: Kind; label: string; icon: string; color: string; bg: string }[] = [
  { k: 'note',    label: 'Notes',    icon: 'note',     color: '#92400e', bg: '#fef3c7' },
  { k: 'call',    label: 'Calls',    icon: 'phone',    color: '#166534', bg: '#dcfce7' },
  { k: 'email',   label: 'Emails',   icon: 'mail',     color: '#1d4ed8', bg: '#dbeafe' },
  { k: 'meeting', label: 'Meetings', icon: 'meeting',  color: '#6d28d9', bg: '#ede9fe' },
  { k: 'stage',   label: 'Stages',   icon: 'stage',    color: '#b45309', bg: '#ffedd5' },
  { k: 'tag',     label: 'Tags',     icon: 'tag',      color: '#be185d', bg: '#fce7f3' },
  { k: 'task',    label: 'Tasks',    icon: 'task',     color: '#0f766e', bg: '#ccfbf1' },
];
const meta = (k: Kind) => KINDS.find(x => x.k === k)!;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export interface DealActivityTabProps {
  deal: { id: string; client: string; client_phone?: string; client_id?: string | null };
  token?: string;
  profiles: { id: string; first_name: string; last_name: string; role: string }[];
  clients: any[];
  composerRef?: React.RefObject<HTMLDivElement | null>;
  createContactFromMention: (name: string) => Promise<any>;
  showToast: (m: string) => void;
  /** Called after anything is logged so the deal's last-touch bumps. */
  onTouched: () => void;
  /** Bump to force a timeline refetch (e.g. after a stage change from the header). */
  refreshKey?: number;
}

export default function DealActivityTab(p: DealActivityTabProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Set<Kind>>(new Set());
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [panel, setPanel] = useState<'call' | 'next' | null>(null);

  const auth = useMemo(() => ({ 'Content-Type': 'application/json', ...(p.token ? { Authorization: `Bearer ${p.token}` } : {}) }), [p.token]);

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await fetch(`/api/crm/deal-timeline?deal_id=${p.deal.id}`, { headers: auth });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setItems(j.items ?? []); setNames(j.names ?? {});
    } catch { setErr('Could not load activity.'); }
    setLoading(false);
  }, [p.deal.id, auth]);
  useEffect(() => { setLoading(true); setItems([]); load(); }, [load, p.refreshKey]);

  async function postNote() {
    const body = note.trim();
    if (!body || posting) return;
    setPosting(true);
    const r = await fetch('/api/crm/deal-notes', { method: 'POST', headers: auth, body: JSON.stringify({ deal_id: p.deal.id, body }) }).catch(() => null);
    setPosting(false);
    if (!r?.ok) { p.showToast('Could not save note'); return; }
    const j = await r.json().catch(() => ({}));
    setNote('');
    p.showToast(j.notified ? `Note added · ${j.notified} teammate${j.notified > 1 ? 's' : ''} notified` : 'Note added');
    p.onTouched(); load();
  }

  const shown = items.filter(i => filter.size === 0 || filter.has(i.kind));
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of shown) { const k = dayLabel(i.at); (m.get(k) ?? m.set(k, []).get(k)!).push(i); }
    return Array.from(m.entries());
  }, [shown]);
  const counts = useMemo(() => { const c: Partial<Record<Kind, number>> = {}; for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1; return c; }, [items]);

  return (
    <div>
      {/* Quick-entry dated note */}
      <div className="dc-card" ref={p.composerRef} style={{ marginBottom: 14 }}>
        <MentionTextarea
          className="crm-input" style={{ minHeight: 70, resize: 'vertical', width: '100%' }}
          placeholder="Add a note… (type @ to tag a teammate — they’ll be emailed — or a contact)"
          profiles={p.profiles} contacts={p.clients} onCreateContact={p.createContactFromMention}
          value={note} onChange={setNote}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="crm-btn crm-btn-gold crm-btn-sm" disabled={!note.trim() || posting} onClick={postNote}>{posting ? 'Saving…' : 'Add note'}</button>
          <span style={{ flex: 1 }} />
          <button className={`dc-chip${panel === 'call' ? ' on' : ''}`} onClick={() => setPanel(panel === 'call' ? null : 'call')}><Icon name="phone" size={14} />Log a call</button>
          <button className={`dc-chip${panel === 'next' ? ' on' : ''}`} onClick={() => setPanel(panel === 'next' ? null : 'next')}><Icon name="task" size={14} />Next step</button>
        </div>
      </div>

      {panel === 'call' && <LogCall {...p} auth={auth} onDone={() => { setPanel(null); p.onTouched(); load(); }} />}
      {panel === 'next' && <NextStep {...p} auth={auth} onDone={() => { setPanel(null); p.onTouched(); load(); }} />}

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 8px' }}>
        <button className={`dc-chip${filter.size === 0 ? ' on' : ''}`} onClick={() => setFilter(new Set())}>All · {items.length}</button>
        {KINDS.filter(k => counts[k.k]).map(k => (
          <button key={k.k} className={`dc-chip${filter.has(k.k) ? ' on' : ''}`}
            onClick={() => setFilter(prev => { const n = new Set(prev); n.has(k.k) ? n.delete(k.k) : n.add(k.k); return n; })}>
            <Icon name={k.icon} size={13} />{k.label} · {counts[k.k]}
          </button>
        ))}
      </div>

      {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-faint,#9ca3af)', fontSize: 14 }}>Loading activity…</div>}
      {err && <div style={{ padding: 16, color: '#b91c1c', fontSize: 14 }}>{err} <button onClick={load} style={{ background: 'none', border: 'none', color: '#c9922c', cursor: 'pointer', fontWeight: 700 }}>Retry</button></div>}
      {!loading && !err && shown.length === 0 && (
        <div style={{ padding: '28px 12px', textAlign: 'center', color: 'var(--c-faint,#9ca3af)', fontSize: 14 }}>Nothing here yet — add a note, log a call, or move the stage and it will show up.</div>
      )}

      {groups.map(([day, list]) => (
        <section key={day} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, color: 'var(--c-faint,#9ca3af)', padding: '6px 0', borderBottom: '1px solid var(--c-line-2,#f0ebe0)' }}>{day}</div>
          {list.map((i, idx) => {
            const m = meta(i.kind);
            return (
              <div key={i.id} className="dc-tl-item" style={{ animationDelay: `${Math.min(idx, 8) * 25}ms` }}>
                <span className="dc-tl-dot" style={{ background: m.bg, color: m.color }}><Icon name={m.icon} size={15} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink,#111)' }}>{i.title}</span>
                    <span style={{ fontSize: 12, color: 'var(--c-faint,#9ca3af)' }}>{timeLabel(i.at)}{i.actor_id && names[i.actor_id] ? ` · ${names[i.actor_id]}` : ''}</span>
                  </div>
                  {i.detail && <div style={{ fontSize: 13.5, color: 'var(--c-ink-2,#4b5563)', marginTop: 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{i.detail}</div>}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/* ── Log a call → crm_call_log via /api/crm/calls ──────────────────────────── */
function LogCall({ deal, auth, showToast, onDone }: DealActivityTabProps & { auth: Record<string, string>; onDone: () => void }) {
  const [result, setResult] = useState('answered');
  const [direction, setDirection] = useState('outbound');
  const [mins, setMins] = useState('');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await fetch('/api/crm/calls', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        direction, result, number: deal.client_phone || undefined, caller_name: deal.client,
        contact_id: deal.client_id || undefined, deal_id: deal.id, duration_sec: mins ? Math.round(Number(mins) * 60) : undefined,
        summary: notes || undefined, needs_follow_up: followUp,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { showToast('Could not log call'); return; }
    showToast('Call logged ✓'); onDone();
  }
  return (
    <div className="dc-card" style={{ marginBottom: 14, background: 'var(--c-surface-2,#fbfaf6)' }}>
      <div style={{ fontWeight: 700, marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="phone" />Log a call</div>
      <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <select className="crm-input" value={direction} onChange={e => setDirection(e.target.value)} aria-label="Direction"><option value="outbound">I called them</option><option value="inbound">They called me</option></select>
        <select className="crm-input" value={result} onChange={e => setResult(e.target.value)} aria-label="Outcome">
          <option value="answered">Spoke with them</option><option value="voicemail">Left voicemail</option><option value="missed">No answer</option>
        </select>
        <input className="crm-input" type="number" min="0" placeholder="Minutes (optional)" value={mins} onChange={e => setMins(e.target.value)} />
      </div>
      <textarea className="crm-input" style={{ marginTop: 10, width: '100%', minHeight: 60 }} placeholder="What was discussed?" value={notes} onChange={e => setNotes(e.target.value)} />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 8, color: 'var(--c-ink-2,#4b5563)' }}>
        <input type="checkbox" checked={followUp} onChange={e => setFollowUp(e.target.checked)} />Needs a follow-up call
      </label>
      <button className="crm-btn crm-btn-gold crm-btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save call'}</button>
    </div>
  );
}

/* ── Next step → crm_tasks via /api/crm/tasks ──────────────────────────────── */
function NextStep({ deal, auth, showToast, onDone }: DealActivityTabProps & { auth: Record<string, string>; onDone: () => void }) {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(tomorrow);
  const [type, setType] = useState('follow_up');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    const r = await fetch('/api/crm/tasks', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: title.trim(), due_date: due || null, type, deal_id: deal.id, client_id: deal.client_id || null }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { showToast('Could not add next step'); return; }
    showToast('Next step added ✓'); onDone();
  }
  return (
    <div className="dc-card" style={{ marginBottom: 14, background: 'var(--c-surface-2,#fbfaf6)' }}>
      <div style={{ fontWeight: 700, marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="task" />Next step</div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }} className="form-grid-2">
        <input className="crm-input" placeholder="e.g. Send LOI draft" value={title} onChange={e => setTitle(e.target.value)} />
        <input className="crm-input" type="date" value={due} onChange={e => setDue(e.target.value)} />
        <select className="crm-input" value={type} onChange={e => setType(e.target.value)}><option value="follow_up">Follow-up</option><option value="call">Call</option><option value="email">Email</option></select>
      </div>
      <button className="crm-btn crm-btn-gold crm-btn-sm" style={{ marginTop: 10 }} disabled={busy || !title.trim()} onClick={save}>{busy ? 'Saving…' : 'Add to my tasks'}</button>
    </div>
  );
}
