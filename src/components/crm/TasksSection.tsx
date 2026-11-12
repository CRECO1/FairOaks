'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import MentionTextarea, { parseMentionIds } from '@/components/crm/MentionTextarea';
import Skeleton from './Skeleton';
import {
  addDaysYmd, BUCKETS, bucketOf, compareFor, doneWithinDays, dueText, isDone, listName, matchesQuery, ownerId,
  shortDate, taskHaystack, todayYmd, typeKey, TYPE_FILTERS, type Bucket, type DueTone,
} from '@/lib/tasks-view';

// ── Searchable contact picker ────────────────────────────────────────────────
function ContactSearch({
  clients, value, onChange,
}: {
  clients: { id: string; first_name: string; last_name: string; business_name?: string; email?: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = clients.find(c => c.id === value);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setQ('');
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Focus input when dropdown opens
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  const filtered = q.trim()
    ? clients.filter(c => {
        const s = `${c.first_name} ${c.last_name} ${c.business_name ?? ''} ${c.email ?? ''}`.toLowerCase();
        return s.includes(q.toLowerCase());
      })
    : clients.slice(0, 40); // show first 40 when no query

  const PILL: React.CSSProperties = {
    padding: '8px 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8,
    fontSize: 13, color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif",
    width: '100%', boxSizing: 'border-box', background: 'var(--k-fafafa)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button type="button" onClick={() => { setOpen(o => !o); setQ(''); }} style={PILL}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left', color: selected ? 'var(--k-111)' : 'var(--k-9ca3af)' }}>
          {selected ? `${selected.first_name} ${selected.last_name}${selected.business_name ? ` — ${selected.business_name}` : ''}` : 'None'}
        </span>
        {selected && (
          <span onClick={e => { e.stopPropagation(); onChange(''); }} title="Clear"
            style={{ flexShrink: 0, color: 'var(--k-9ca3af)', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>✕</span>
        )}
        <span style={{ flexShrink: 0, color: 'var(--k-9ca3af)', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ position: 'absolute', top: '105%', left: 0, right: 0, zIndex: 400,
          background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,.14)', overflow: 'hidden' }}>
          {/* Search input */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--k-f3f4f6)' }}>
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search contacts…"
              style={{ width: '100%', border: '1px solid var(--k-e5e7eb)', borderRadius: 6, padding: '6px 10px',
                fontSize: 13, fontFamily: "'DM Sans',sans-serif", color: 'var(--k-111)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {/* Results */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {/* None option */}
            <button type="button" onClick={() => { onChange(''); setOpen(false); setQ(''); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none',
                background: !value ? 'var(--k-fef9ee)' : 'transparent', color: !value ? '#c9922c' : '#6b7280',
                fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontStyle: 'italic' }}>
              None
            </button>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--k-9ca3af)', textAlign: 'center' }}>No contacts found</div>
            ) : filtered.map(c => (
              <button type="button" key={c.id} onClick={() => { onChange(c.id); setOpen(false); setQ(''); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none',
                  background: c.id === value ? 'var(--k-fef9ee)' : 'transparent',
                  cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
                onMouseEnter={e => { if (c.id !== value) e.currentTarget.style.background = 'var(--k-f9fafb)'; }}
                onMouseLeave={e => { if (c.id !== value) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: c.id === value ? '#c9922c' : 'var(--k-111)' }}>
                  {c.first_name} {c.last_name}
                </div>
                {(c.business_name || c.email) && (
                  <div style={{ fontSize: 11, color: 'var(--k-9ca3af)', marginTop: 1 }}>
                    {c.business_name ?? c.email}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────
interface Task {
  id: string; title: string; description?: string; due_date?: string;
  assigned_to?: string; agent_id?: string; client_id?: string; deal_id?: string;
  type?: string; notes?: string; completed_at?: string | null;
  status: 'open' | 'in_progress' | 'done';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  created_by?: string; business_unit: string; created_at: string; updated_at?: string;
  client?: { id: string; first_name: string; last_name: string; email: string };
  assignee?: { id: string; first_name: string; last_name: string };
}
interface Profile { id: string; first_name: string; last_name: string; role?: string; }
interface Client { id: string; first_name: string; last_name: string; business_name?: string; email?: string; phone?: string; cell_phone?: string; type?: string; }
interface Props {
  tasks: Task[];
  tasksLoading: boolean;
  profiles: Profile[];
  clients: Client[];
  isAdmin: boolean;
  isMobile: boolean;
  businessUnit: string;
  authHeaders: Record<string, string>;
  /** Accepts an updater too, so overlapping edits (two quick taps) never overwrite each other with a stale list. */
  onTasksChange: React.Dispatch<React.SetStateAction<Task[]>>;
  showToast: (msg: string) => void;
  onRefresh: () => void;
  currentUserId?: string;
  onTaskComplete?: (task: Task) => void;
  /** Teammates newly @tagged in a task's notes — parent creates the bell notification. */
  onMention?: (ids: string[], message: string, taskId: string) => void;
  /** Jump to the full contact card. */
  onOpenContact?: (clientId: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────
const STATUS_CFG = {
  open:        { label: 'Open',        bg: 'var(--k-dbeafe)', color: 'var(--k-1d4ed8)', dot: '#3b82f6' },
  in_progress: { label: 'In Progress', bg: 'var(--k-fef3c7)', color: 'var(--k-b45309)', dot: '#f59e0b' },
  done:        { label: 'Done',        bg: 'var(--k-dcfce7)', color: 'var(--k-15803d)', dot: '#22c55e' },
} as const;

const PRIORITY_CFG = {
  urgent: { label: 'Urgent', bg: 'var(--k-fee2e2)', color: 'var(--k-dc2626)' },
  high:   { label: 'High',   bg: 'var(--k-fed7aa)', color: 'var(--k-c2410c)' },
  normal: { label: 'Normal', bg: 'var(--k-dbeafe)', color: 'var(--k-1d4ed8)' },
  low:    { label: 'Low',    bg: 'var(--k-f1f5f9)', color: 'var(--k-64748b)' },
} as const;

const GROUP_CFG = [
  { key: 'open',        label: 'Open',        color: '#3b82f6' },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { key: 'done',        label: 'Done',        color: '#22c55e' },
] as const;

// Time-based sections — the default "what do I do now" grouping for both the list and the board.
const SECTION_CFG: readonly { key: Bucket; label: string; color: string; open: boolean }[] = [
  { key: 'overdue',  label: 'Overdue',   color: '#ef4444',         open: true  },
  { key: 'today',    label: 'Today',     color: '#c9922c',         open: true  },
  { key: 'week',     label: 'This week', color: '#3b82f6',         open: true  },
  { key: 'later',    label: 'Later',     color: 'var(--k-8b5cf6)', open: true  },
  { key: 'nodate',   label: 'No date',   color: 'var(--k-9ca3af)', open: true  },
  { key: 'calllist', label: 'Call list', color: '#0d9488',         open: false },
  { key: 'done',     label: 'Done',      color: '#22c55e',         open: false },
];

const DUE_TONE: Record<DueTone, { color: string; bg: string; weight: number }> = {
  late:  { color: 'var(--k-dc2626)', bg: 'var(--k-fef2f2)', weight: 700 },
  today: { color: 'var(--k-a8741a)', bg: 'var(--k-fdf6e8)', weight: 700 },
  soon:  { color: 'var(--k-475569)', bg: 'transparent',     weight: 600 },
  later: { color: 'var(--k-6b7280)', bg: 'transparent',     weight: 500 },
  none:  { color: 'var(--k-9ca3af)', bg: 'transparent',     weight: 500 },
  done:  { color: 'var(--k-9ca3af)', bg: 'transparent',     weight: 500 },
};

type StatusKey   = keyof typeof STATUS_CFG;
type PriorityKey = keyof typeof PRIORITY_CFG;
type GroupMode   = 'urgency' | 'status';

const UNDO_MS = 6000;       // how long "Undo" stays on screen after a one-tap complete
const DONE_PAGE = 15;       // how many finished tasks show before "Show more"

// Visual marker for typed tasks (calls/follow-ups/emails) in the list views.
const TYPE_META: Record<string, { icon: string; label: string }> = {
  call:      { icon: '📞', label: 'Call' },
  follow_up: { icon: '🔄', label: 'Follow-up' },
  email:     { icon: '✉️', label: 'Email' },
};

function initials(first: string, last: string) { return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase(); }
function avatarColor(id: string) {
  const COLORS = ['#6366f1','#ec4899','#14b8a6','#f59e0b','#8b5cf6','#ef4444','#10b981'];
  let n = 0; for (const c of id) n = (n * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return COLORS[n % COLORS.length];
}
function readPref(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return null; } }
function writePref(key: string, v: string) { try { window.localStorage.setItem(key, v); } catch { /* private mode — it just won't be remembered */ } }

/** The contact a task is about: the full contact list first (it has the company), else the little join that came with the task. */
function contactInfo(t: Task, clientById: Map<string, Client>): { id: string; name: string; business: string } | null {
  const c = clientById.get(t.client_id ?? '');
  const j = t.client;
  const id = c?.id ?? j?.id ?? t.client_id ?? '';
  const business = c?.business_name ?? '';
  const name = `${c?.first_name ?? j?.first_name ?? ''} ${c?.last_name ?? j?.last_name ?? ''}`.trim() || business;
  return id && name ? { id, name, business } : null;
}

// ── Pill components ──────────────────────────────────────────────────────────
function StatusPill({ value, onChange }: { value: StatusKey; onChange: (v: StatusKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const cfg = STATUS_CFG[value];
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ background: cfg.bg, color: cfg.color, border: 'none', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.3 }}>
        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: cfg.dot, marginRight: 5, verticalAlign: 'middle' }} />
        {cfg.label}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: 6, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 130 }}>
          {(Object.keys(STATUS_CFG) as StatusKey[]).map(k => {
            const c = STATUS_CFG[k];
            return (
              <button key={k} onClick={e => { e.stopPropagation(); onChange(k); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: k === value ? c.bg : 'transparent', color: c.color, border: 'none', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textAlign: 'left' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PriorityPill({ value, onChange }: { value: PriorityKey; onChange: (v: PriorityKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const cfg = PRIORITY_CFG[value];
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ background: cfg.bg, color: cfg.color, border: 'none', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif" }}>
        {cfg.label}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: 6, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 120 }}>
          {(Object.keys(PRIORITY_CFG) as PriorityKey[]).map(k => {
            const c = PRIORITY_CFG[k];
            return (
              <button key={k} onClick={e => { e.stopPropagation(); onChange(k); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: k === value ? c.bg : 'transparent', color: c.color, border: 'none', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textAlign: 'left' }}>
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Inline due-date pill with one-tap reschedule — the row's power move ──────
// Menu uses fixed positioning so it escapes the card's overflow:hidden clip.
function DuePill({ value, text, tone, disabled, onChange }: { value?: string; text: string; tone: DueTone; disabled?: boolean; onChange: (v: string | null) => void }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setPos(null); };
    document.addEventListener('mousedown', h);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('scroll', close, true); };
  }, [pos]);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 172)) });
  };
  const quick = [{ label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 }, { label: 'In 3 days', days: 3 }, { label: 'Next week', days: 7 }];
  const pick = (n: number) => { onChange(addDaysYmd(n)); setPos(null); };
  const tc = DUE_TONE[tone];
  const label = <>📅 {text}</>;
  const base: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, border: '1px solid transparent', background: tc.bg, color: tc.color, fontSize: 12, fontWeight: tc.weight, fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' };
  if (disabled) return <span style={base}>{label}</span>;
  return (
    <div ref={ref} style={{ display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button onClick={toggle} title="Reschedule" style={{ ...base, cursor: 'pointer' }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--k-e5e7eb)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}>
        {label}
      </button>
      {pos && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.18)', padding: 6, zIndex: 1000, minWidth: 156 }}>
          {quick.map(q => (
            <button key={q.label} onClick={() => pick(q.days)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--k-374151)', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--k-f9fafb)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {q.label}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--k-f3f4f6)', margin: '4px 0' }} />
          <input type="date" value={value ?? ''} onChange={e => { onChange(e.target.value || null); setPos(null); }}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--k-e5e7eb)', borderRadius: 6, fontSize: 12, fontFamily: "'DM Sans',sans-serif", boxSizing: 'border-box' }} />
          {value && (
            <button onClick={() => { onChange(null); setPos(null); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginTop: 4, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--k-dc2626)', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
              Clear date
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ profile }: { profile?: Profile }) {
  if (!profile) return <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>—</span>;
  const color = avatarColor(profile.id);
  return (
    <span title={`${profile.first_name} ${profile.last_name}`}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: color, color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0, fontFamily: "'DM Sans',sans-serif" }}>
      {initials(profile.first_name, profile.last_name)}
    </span>
  );
}

function PriorityTag({ p }: { p: PriorityKey }) {
  const pc = PRIORITY_CFG[p];
  return <span style={{ background: pc.bg, color: pc.color, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>{pc.label}</span>;
}

// ── Client Contact Card ───────────────────────────────────────────────────────
function ClientContactCard({ client, onOpen }: { client: Client; onOpen?: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(val: string, label: string) {
    navigator.clipboard.writeText(val).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }
  const typeColors: Record<string, { bg: string; color: string }> = {
    Buyer: { bg: 'var(--k-dbeafe)', color: 'var(--k-1d4ed8)' },
    Seller: { bg: 'var(--k-dcfce7)', color: 'var(--k-15803d)' },
    Tenant: { bg: 'var(--k-fef3c7)', color: 'var(--k-b45309)' },
    'Landlord/Investor': { bg: '#f3e8ff', color: '#7e22ce' },
    Agent: { bg: 'var(--k-f1f5f9)', color: 'var(--k-475569)' },
    Broker: { bg: 'var(--k-f1f5f9)', color: 'var(--k-475569)' },
  };
  const tc = client.type ? (typeColors[client.type] ?? { bg: 'var(--k-f1f5f9)', color: 'var(--k-475569)' }) : null;
  // Company-only contacts have no first/last name: lead with the company so the card is not blank.
  const fullName = `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim();
  const title = fullName || client.business_name || 'Contact';
  const initialsOf = title.split(/\s+/).filter(Boolean).slice(0, 2).map(w => (w[0] ?? '').toUpperCase()).join('');
  return (
    <div style={{ marginTop: 8, background: 'var(--k-f8fafc)', border: '1px solid var(--k-e2e8f0)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#c9922c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          {initialsOf}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          {fullName && client.business_name && (
            <div style={{ fontSize: 11, color: 'var(--k-6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.business_name}</div>
          )}
        </div>
        {tc && client.type && (
          <span style={{ ...tc, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, flexShrink: 0, fontFamily: "'DM Sans',sans-serif" } as React.CSSProperties}>
            {client.type}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {client.email && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13 }}>✉️</span>
            <a href={`mailto:${client.email}`} style={{ fontSize: 12, color: 'var(--k-2563eb)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>
              {client.email}
            </a>
            <button onClick={() => copy(client.email!, 'email')} title="Copy email"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: copied === 'email' ? 'var(--k-16a34a)' : 'var(--k-9ca3af)', flexShrink: 0, fontFamily: "'DM Sans',sans-serif", padding: '2px 4px' }}>
              {copied === 'email' ? '✓ Copied' : '📋'}
            </button>
          </div>
        )}
        {(client.phone || client.cell_phone) && (
          <>
            {client.phone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>📞</span>
                <a href={`tel:${client.phone}`} style={{ fontSize: 12, color: 'var(--k-111)', flex: 1, textDecoration: 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#c9922c')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--k-111)')}>
                  {client.phone}
                </a>
                <button onClick={() => copy(client.phone!, 'phone')} title="Copy phone"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: copied === 'phone' ? 'var(--k-16a34a)' : 'var(--k-9ca3af)', flexShrink: 0, fontFamily: "'DM Sans',sans-serif", padding: '2px 4px' }}>
                  {copied === 'phone' ? '✓ Copied' : '📋'}
                </button>
              </div>
            )}
            {client.cell_phone && client.cell_phone !== client.phone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>📱</span>
                <a href={`tel:${client.cell_phone}`} style={{ fontSize: 12, color: 'var(--k-111)', flex: 1, textDecoration: 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#c9922c')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--k-111)')}>
                  {client.cell_phone}
                </a>
                <button onClick={() => copy(client.cell_phone!, 'cell')} title="Copy cell"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: copied === 'cell' ? 'var(--k-16a34a)' : 'var(--k-9ca3af)', flexShrink: 0, fontFamily: "'DM Sans',sans-serif", padding: '2px 4px' }}>
                  {copied === 'cell' ? '✓ Copied' : '📋'}
                </button>
              </div>
            )}
          </>
        )}
        {!client.email && !client.phone && !client.cell_phone && (
          <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', fontStyle: 'italic' }}>No contact info on file</div>
        )}
      </div>
      {onOpen && (
        <button onClick={onOpen}
          style={{ marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-a8741a)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          Open contact card →
        </button>
      )}
    </div>
  );
}

// ── Task Detail Panel ────────────────────────────────────────────────────────
function TaskDetailPanel({
  task, profiles, clients, isAdmin, onClose, onSave, onDelete, onToggleDone, onOpenContact,
}: {
  task: Task; profiles: Profile[]; clients: Client[]; isAdmin: boolean;
  onClose: () => void; onSave: (updates: Partial<Task>) => void; onDelete: () => void; onToggleDone: () => void;
  onOpenContact?: (clientId: string) => void;
}) {
  const done = isDone(task);
  const [form, setForm] = useState<Partial<Task>>({
    title: task.title, description: task.description ?? '', due_date: task.due_date ?? '',
    // The owner the list shows (assignee, else the agent it is filed under) — so saving never silently "unassigns" a task.
    assigned_to: ownerId(task) ?? '', client_id: task.client_id ?? '',
    status: done ? 'done' : task.status, priority: task.priority,
  });
  const creator = profiles.find(p => p.id === task.created_by);
  const when = (iso?: string | null) => (iso ? shortDate(iso.slice(0, 10)) : '');
  const meta = [
    task.created_at ? `Created ${when(task.created_at)}${creator ? ` by ${creator.first_name}` : ''}` : '',
    done && (task.completed_at || task.updated_at) ? `Done ${when(task.completed_at ?? task.updated_at)}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ flex: 1 }} onClick={onClose} />
      <div style={{ width: Math.min(480, window.innerWidth), background: 'var(--k-fff)', boxShadow: '-4px 0 32px rgba(0,0,0,.14)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', borderBottom: '1px solid var(--k-f3f4f6)', paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600 }}>Task Detail</span>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 18, lineHeight: 1, minWidth: 36, minHeight: 36 }}>✕</button>
          </div>
          <input value={form.title ?? ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            style={{ width: '100%', border: 'none', outline: 'none', fontSize: 20, fontWeight: 700, color: 'var(--k-111)', fontFamily: "'DM Sans',sans-serif", background: 'transparent', padding: 0, boxSizing: 'border-box' }} />
          {meta && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{meta}</div>}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Status + Priority row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600, marginBottom: 6 }}>Status</div>
              <StatusPill value={form.status ?? 'open'} onChange={v => setForm(f => ({ ...f, status: v }))} />
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600, marginBottom: 6 }}>Priority</div>
              <PriorityPill value={form.priority ?? 'normal'} onChange={v => setForm(f => ({ ...f, priority: v }))} />
            </div>
          </div>

          {/* Due date */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600, marginBottom: 6 }}>Due Date</div>
            <input type="date" value={form.due_date ?? ''}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
              style={{ padding: '7px 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 13, color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif", width: '100%', boxSizing: 'border-box', background: 'var(--k-fafafa)' }} />
          </div>

          {/* Assignee */}
          {isAdmin && (
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600, marginBottom: 6 }}>Assignee</div>
              <select value={form.assigned_to ?? ''} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                style={{ padding: '7px 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 13, color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif", width: '100%', background: 'var(--k-fafafa)' }}>
                <option value="">Unassigned</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
              </select>
            </div>
          )}

          {/* Linked contact */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600, marginBottom: 6 }}>Linked Contact</div>
            <ContactSearch clients={clients} value={form.client_id ?? ''} onChange={id => setForm(f => ({ ...f, client_id: id }))} />
            {(() => {
              const linked = clients.find(c => c.id === (form.client_id ?? ''));
              return linked ? <ClientContactCard client={linked} onOpen={onOpenContact ? () => onOpenContact(linked.id) : undefined} /> : null;
            })()}
          </div>

          {/* Notes */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600, marginBottom: 6 }}>Notes</div>
            <MentionTextarea value={form.description ?? ''} onChange={v => setForm(f => ({ ...f, description: v }))}
              profiles={profiles}
              placeholder="Add notes… (@ to tag a teammate)"
              style={{ padding: '10px 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 13, color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif", width: '100%', minHeight: 120, resize: 'vertical', background: 'var(--k-fafafa)', boxSizing: 'border-box', lineHeight: 1.6 }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--k-f3f4f6)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => { if (confirm('Delete this task?')) onDelete(); }}
            style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--k-fecaca)', background: 'var(--k-fff)', color: 'var(--k-dc2626)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            Delete
          </button>
          <button onClick={onToggleDone}
            style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: done ? 'var(--k-374151)' : 'var(--k-15803d)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            {done ? '↺ Reopen' : '✓ Mark done'}
          </button>
          <button onClick={onClose}
            style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            Cancel
          </button>
          <button onClick={() => onSave(form)}
            style={{ flex: 1, minWidth: 130, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── The round tick that finishes a task (or, in select mode, a square checkbox) ──
function CompleteCircle({ done, selectMode, selected, big, onComplete, onSelect }: {
  done: boolean; selectMode: boolean; selected: boolean; big: boolean; onComplete: () => void; onSelect: () => void;
}) {
  const box = big ? 44 : 30;
  if (selectMode) {
    return (
      <label onClick={e => e.stopPropagation()} title="Select" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: box, height: box, flexShrink: 0, cursor: 'pointer' }}>
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label="Select task" style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#c9922c' }} />
      </label>
    );
  }
  const label = done ? 'Reopen task' : 'Mark done';
  return (
    <button type="button" className="tk-circle" aria-label={label} title={label} onClick={e => { e.stopPropagation(); onComplete(); }}
      style={{ width: box, height: box, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
      <span className="tk-dot" style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${done ? '#22c55e' : 'var(--k-d1d5db)'}`, background: done ? '#22c55e' : 'transparent', color: '#fff', fontSize: 12, fontWeight: 800, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', transition: 'border-color .12s' }}>
        {done ? '✓' : ''}
      </span>
    </button>
  );
}

// ── One task in the list ─────────────────────────────────────────────────────
interface RowProps {
  t: Task; isMobile: boolean; selectMode: boolean; isSelected: boolean; showOwner: boolean;
  owner?: Profile; contact: { id: string; name: string } | null; listTag: string | null;
  onOpen: () => void; onComplete: () => void; onSelect: () => void; onContact: () => void; onReschedule: (v: string | null) => void;
}
function TaskRow({ t, isMobile, selectMode, isSelected, showOwner, owner, contact, listTag, onOpen, onComplete, onSelect, onContact, onReschedule }: RowProps) {
  const done = isDone(t);
  const due = dueText(t);
  const icon = t.type && TYPE_META[t.type] ? TYPE_META[t.type] : null;
  const inProgress = !done && t.status === 'in_progress';
  const TAG: React.CSSProperties = { flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 8, background: 'var(--k-f1f5f9)', color: 'var(--k-64748b)', whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' };
  const contactBtn = contact && (
    <button onClick={e => { e.stopPropagation(); onContact(); }} title={`${contact.name} — contact details`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--k-f1f5f9)', border: 'none', borderRadius: 6, padding: isMobile ? '5px 9px' : '3px 8px', minWidth: 0, maxWidth: '100%', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
      <span style={{ fontSize: 10, flexShrink: 0 }}>👤</span>
      <span style={{ fontSize: isMobile ? 12 : 11.5, color: 'var(--k-374151)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.name}</span>
    </button>
  );
  const titleStyle: React.CSSProperties = { fontSize: isMobile ? 14 : 13.5, fontWeight: 600, color: done ? 'var(--k-9ca3af)' : 'var(--k-111)', textDecoration: done ? 'line-through' : 'none', lineHeight: 1.35 };
  const duePill = <DuePill value={t.due_date} text={due.text} tone={due.tone} disabled={done} onChange={onReschedule} />;

  if (isMobile) {
    return (
      <div className="tk-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 2, padding: '4px 12px 10px 2px', borderTop: '1px solid var(--k-f3f4f6)', cursor: 'pointer', background: isSelected ? 'var(--k-fdf6e8)' : undefined }}>
        <CompleteCircle done={done} selectMode={selectMode} selected={isSelected} big onComplete={onComplete} onSelect={onSelect} />
        <div style={{ flex: 1, minWidth: 0, paddingTop: 11 }}>
          <div title={t.title} style={{ ...titleStyle, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
            {icon && <span title={icon.label} style={{ marginRight: 5 }}>{icon.icon}</span>}{t.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
            {contactBtn}
            {listTag && <span style={TAG} title={listTag}>{listTag}</span>}
            {inProgress && <span style={{ ...TAG, background: 'var(--k-fef3c7)', color: 'var(--k-b45309)' }}>In progress</span>}
            {t.priority !== 'normal' && !done && <PriorityTag p={t.priority} />}
            {duePill}
            {showOwner && <span style={{ marginLeft: 'auto' }}><Avatar profile={owner} /></span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tk-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      style={{ display: 'grid', gridTemplateColumns: `32px minmax(0,1fr) minmax(0,190px) 64px 132px${showOwner ? ' 30px' : ''}`, alignItems: 'center', gap: 10, padding: '5px 14px 5px 8px', borderTop: '1px solid var(--k-f3f4f6)', cursor: 'pointer', background: isSelected ? 'var(--k-fdf6e8)' : undefined }}>
      <CompleteCircle done={done} selectMode={selectMode} selected={isSelected} big={false} onComplete={onComplete} onSelect={onSelect} />
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
        {icon && <span title={icon.label} style={{ flexShrink: 0, fontSize: 13 }}>{icon.icon}</span>}
        <span title={t.title} style={{ ...titleStyle, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
        {listTag && <span style={TAG} title={listTag}>{listTag}</span>}
        {inProgress && <span style={{ ...TAG, background: 'var(--k-fef3c7)', color: 'var(--k-b45309)' }}>In progress</span>}
      </div>
      <div style={{ minWidth: 0 }}>{contactBtn}</div>
      <div>{t.priority !== 'normal' && !done ? <PriorityTag p={t.priority} /> : null}</div>
      <div>{duePill}</div>
      {showOwner && <div style={{ justifySelf: 'end' }}><Avatar profile={owner} /></div>}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function TasksSection({
  tasks, tasksLoading, profiles, clients, isAdmin, isMobile,
  businessUnit, authHeaders, onTasksChange, showToast, onRefresh, currentUserId, onTaskComplete, onMention, onOpenContact,
}: Props) {
  const meId = currentUserId ?? '';
  const [view, setView] = useState<'list' | 'board'>(() => (readPref('crm:tasks:view') === 'board' ? 'board' : 'list'));
  const [who, setWho] = useState<string>('me');             // 'me' | 'all' | 'none' | a profile id — whose tasks to show
  const [groupMode, setGroupMode] = useState<GroupMode>('urgency');   // board only
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState<Bucket | ''>('');
  const [selectMode, setSelectMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);   // phones: type / priority / select / view live under the ⚙ button
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMenu, setBulkMenu] = useState<'reschedule' | 'reassign' | null>(null);
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({});
  const [doneShown, setDoneShown] = useState(DONE_PAGE);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [quickAddGroup, setQuickAddGroup] = useState<string | null>(null);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [topTitle, setTopTitle] = useState('');
  const [topWhen, setTopWhen] = useState<'today' | 'tomorrow' | 'week' | 'none'>('today');
  const [contactPopup, setContactPopup] = useState<Client | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newForm, setNewForm] = useState({ title: '', description: '', due_date: '', assigned_to: currentUserId ?? '', client_id: '', priority: 'normal' as PriorityKey, status: 'open' as StatusKey, type: '' as '' | 'call' | 'follow_up' | 'email' });
  const [undo, setUndo] = useState<{ id: string; title: string; prevStatus: Task['status'] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const undoTimer = useRef<number | null>(null);
  const pendingLog = useRef(new Map<string, { timer: number; task: Task }>());   // "Task completed" notes waiting for the undo window to close
  const onTaskCompleteRef = useRef(onTaskComplete);
  onTaskCompleteRef.current = onTaskComplete;

  const todayStr = todayYmd();

  // Remember the view, and who you were looking at (per person), between visits.
  useEffect(() => { writePref('crm:tasks:view', view); }, [view]);
  useEffect(() => {
    if (!meId) return;
    const saved = readPref(`crm:tasks:who:${meId}`);
    if (saved) setWho(saved);
  }, [meId]);
  const pickWho = (v: string) => { setWho(v); setFocus(''); if (meId) writePref(`crm:tasks:who:${meId}`, v); };

  const profileById = useMemo(() => Object.fromEntries(profiles.map(p => [p.id, p])) as Record<string, Profile>, [profiles]);
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c] as const)), [clients]);
  // An agent only ever has their own tasks (the server sends nothing else), so there is nobody else to look at — whatever view was saved from before.
  const whoEff = !isAdmin ? (meId ? 'me' : 'all') : who === 'all' || who === 'none' ? who : who === 'me' ? (meId ? 'me' : 'all') : (profileById[who] ? who : (meId ? 'me' : 'all'));
  const showOwner = whoEff === 'all';   // the owner's initials only tell you something when several people's tasks are mixed together

  // Finished tasks leave the page's flow: a stray "Task completed" note must still reach the contact if you navigate away inside the undo window.
  useEffect(() => {
    const pending = pendingLog.current;
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      pending.forEach(({ timer, task }) => { window.clearTimeout(timer); onTaskCompleteRef.current?.(task); });
      pending.clear();
    };
  }, []);

  // ── Filtering → sections ─────────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim();
    return tasks.filter(t => {
      if (whoEff === 'none') { if (ownerId(t)) return false; }
      else if (whoEff !== 'all' && ownerId(t) !== (whoEff === 'me' ? meId : whoEff)) return false;
      if (typeFilter && typeKey(t) !== typeFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (q) { const c = contactInfo(t, clientById); if (!matchesQuery(taskHaystack(t, c?.name, c?.business), q)) return false; }
      return true;
    });
  }, [tasks, whoEff, meId, typeFilter, priorityFilter, search, clientById]);

  const byBucket = useMemo(() => {
    const m: Record<Bucket, Task[]> = { overdue: [], today: [], week: [], later: [], nodate: [], calllist: [], done: [] };
    const now = new Date();
    for (const t of visible) m[bucketOf(t, now)].push(t);
    for (const b of BUCKETS) m[b].sort(compareFor(b));
    return m;
  // todayStr: sections re-sort when the day rolls over
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, todayStr]);

  const doneRecent = useMemo(() => byBucket.done.filter(t => doneWithinDays(t, 7)).length, [byBucket]);
  const openTotal = useMemo(() => tasks.filter(t => !isDone(t)).length, [tasks]);
  const openByOwner = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (!isDone(t)) { const o = ownerId(t); if (o) m.set(o, (m.get(o) ?? 0) + 1); }
    return m;
  }, [tasks]);
  const unassignedCt = useMemo(() => tasks.filter(t => !isDone(t) && !ownerId(t)).length, [tasks]);
  const people = isAdmin
    ? profiles.filter(p => p.id !== meId && (openByOwner.get(p.id) ?? 0) > 0).sort((a, b) => (openByOwner.get(b.id) ?? 0) - (openByOwner.get(a.id) ?? 0))
    : [];
  const viewedName = whoEff !== 'me' && whoEff !== 'all' && whoEff !== 'none' ? profileById[whoEff]?.first_name : undefined;
  const filtersOn = !!(typeFilter || priorityFilter || search.trim() || focus);

  const visibleIds = useMemo(() => new Set(visible.map(t => t.id)), [visible]);
  const selIds = useMemo(() => [...selected].filter(id => visibleIds.has(id)), [selected, visibleIds]);

  // ── API helpers ──────────────────────────────────────────────────────────
  async function apiCreateTask(data: Partial<Task> & { title: string }): Promise<Task | null> {
    try {
      const res = await fetch('/api/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...data, business_unit: businessUnit }),
      });
      if (!res.ok) { showToast('Error creating task'); return null; }
      const { task } = await res.json();
      return task;
    } catch { showToast('Error creating task'); return null; }
  }

  async function apiUpdateTask(id: string, updates: Partial<Task>, quiet = false): Promise<Task | null> {
    try {
      const res = await fetch(`/api/crm/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(updates),
      });
      if (!res.ok) { if (!quiet) showToast('Error updating task'); return null; }
      const { task } = await res.json();
      return task;
    } catch { if (!quiet) showToast('Error updating task'); return null; }
  }

  async function apiDeleteTask(id: string): Promise<boolean> {
    try { return (await fetch(`/api/crm/tasks/${id}`, { method: 'DELETE', headers: authHeaders })).ok; } catch { return false; }
  }

  // The server's row replaces ours, but keeps the joined contact/assignee that the PATCH response does not carry.
  function applyServerRow(row: Task) {
    onTasksChange(prev => prev.map(x => {
      if (x.id !== row.id) return x;
      const next: Task = { ...x, ...row };
      next.assignee = row.assigned_to ? (profileById[row.assigned_to] ?? x.assignee) : undefined;
      if (row.client_id !== x.client_id) next.client = undefined;
      return next;
    }));
  }
  const patchLocal = (id: string, patch: Partial<Task>) => onTasksChange(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)));

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleUpdateTask(id: string, updates: Partial<Task>): Promise<boolean> {
    const updated = await apiUpdateTask(id, updates);
    if (!updated) { onRefresh(); return false; }
    applyServerRow(updated);
    showToast('Saved ✓');
    // Log a touch on the linked contact when a task is marked done
    if (updates.status === 'done' && updated.client_id) onTaskCompleteRef.current?.(updated);
    return true;
  }

  async function handleDeleteTask(id: string) {
    if (!(await apiDeleteTask(id))) { showToast('Could not delete that task'); return; }
    onTasksChange(prev => prev.filter(t => t.id !== id));
    setDetailTask(null);
    showToast('Task deleted');
  }

  // One tap on the circle: finish it now, offer Undo for a few seconds, and only then write "Task completed" onto the contact.
  async function completeOne(t: Task) {
    patchLocal(t.id, { status: 'done', completed_at: new Date().toISOString() });
    const updated = await apiUpdateTask(t.id, { status: 'done' });
    if (!updated) { patchLocal(t.id, { status: t.status, completed_at: t.completed_at ?? null }); onRefresh(); return; }
    applyServerRow(updated);
    if (updated.client_id && onTaskCompleteRef.current) {
      const timer = window.setTimeout(() => { pendingLog.current.delete(t.id); onTaskCompleteRef.current?.(updated); }, UNDO_MS);
      pendingLog.current.set(t.id, { timer, task: updated });
    }
    setUndo({ id: t.id, title: t.title, prevStatus: t.status === 'in_progress' ? 'in_progress' : 'open' });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
  }

  async function undoComplete() {
    if (!undo) return;
    const { id, prevStatus } = undo;
    const pend = pendingLog.current.get(id);
    if (pend) { window.clearTimeout(pend.timer); pendingLog.current.delete(id); }
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndo(null);
    patchLocal(id, { status: prevStatus, completed_at: null });
    const updated = await apiUpdateTask(id, { status: prevStatus });
    if (updated) applyServerRow(updated); else onRefresh();
  }

  async function reopenOne(t: Task) {
    patchLocal(t.id, { status: 'open', completed_at: null });
    const updated = await apiUpdateTask(t.id, { status: 'open' });
    if (updated) { applyServerRow(updated); showToast('Reopened'); }
    else { patchLocal(t.id, { status: t.status, completed_at: t.completed_at ?? null }); onRefresh(); }
  }

  async function toggleDoneFromPanel(t: Task) {
    setDetailTask(null);
    if (isDone(t)) await reopenOne(t);
    else await handleUpdateTask(t.id, { status: 'done' });
  }

  // Top quick-add (list view): for yourself, or for the teammate whose list you are looking at.
  async function submitTop() {
    const title = topTitle.trim();
    if (!title) return;
    const due = topWhen === 'today' ? todayStr : topWhen === 'tomorrow' ? addDaysYmd(1) : topWhen === 'week' ? addDaysYmd(7) : '';
    const forId = whoEff !== 'me' && whoEff !== 'all' && whoEff !== 'none' ? whoEff : meId;
    setTopTitle('');
    const task = await apiCreateTask({ title, priority: 'normal', status: 'open', due_date: due || undefined, assigned_to: forId || undefined });
    if (task) { onTasksChange(prev => [task, ...prev]); showToast(viewedName ? `Added for ${viewedName} ✓` : 'Task added ✓'); }
    else setTopTitle(title);
  }

  // Board quick-add fields depend on the active grouping: in status mode the group IS the
  // status; in urgency mode the group implies a due date instead.
  function quickAddFieldsFor(grpKey: string): Partial<Task> {
    if (groupMode === 'status') return { status: grpKey as StatusKey };
    switch (grpKey) {
      case 'today':   return { status: 'open', due_date: todayStr };
      case 'week':    return { status: 'open', due_date: addDaysYmd(3) };
      case 'later':   return { status: 'open', due_date: addDaysYmd(14) };
      case 'overdue': return { status: 'open', due_date: todayStr };
      case 'done':    return { status: 'done' };
      default:        return { status: 'open' }; // nodate
    }
  }

  async function handleQuickAdd(fields: Partial<Task>) {
    if (!quickAddTitle.trim()) { setQuickAddGroup(null); return; }
    const task = await apiCreateTask({ title: quickAddTitle.trim(), priority: 'normal', assigned_to: meId || undefined, ...fields });
    if (task) {
      onTasksChange(prev => [task, ...prev]);
      showToast('Task created ✓');
    }
    setQuickAddTitle('');
    setQuickAddGroup(null);
  }

  // ── Bulk selection actions ─────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function clearSelection() { setSelected(new Set()); setBulkMenu(null); setSelectMode(false); }
  async function bulkApply(updates: Partial<Task>) {
    const ids = selIds;
    if (ids.length === 0) return;
    const results = await Promise.all(ids.map(async id => [id, await apiUpdateTask(id, updates, true)] as const));
    const ok = results.filter((r): r is readonly [string, Task] => !!r[1]);
    for (const [, row] of ok) {
      applyServerRow(row);
      if (updates.status === 'done' && row.client_id) onTaskCompleteRef.current?.(row);
    }
    const failed = results.length - ok.length;
    clearSelection();
    showToast(failed ? `${ok.length} updated · ${failed} could not be saved` : `${ok.length} task${ok.length === 1 ? '' : 's'} updated ✓`);
    if (failed) onRefresh();
  }
  async function bulkDelete() {
    const ids = selIds;
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} task${ids.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    const results = await Promise.all(ids.map(async id => [id, await apiDeleteTask(id)] as const));
    const gone = new Set(results.filter(([, ok]) => ok).map(([id]) => id));
    onTasksChange(prev => prev.filter(t => !gone.has(t.id)));
    clearSelection();
    showToast(gone.size === ids.length ? `${gone.size} task${gone.size === 1 ? '' : 's'} deleted` : `${gone.size} deleted · ${ids.length - gone.size} could not be deleted`);
  }

  // ── Drag-to-reschedule / restatus (board) ──────────────────────────────────
  const statusOf = (t: Task): StatusKey => (isDone(t) ? 'done' : t.status === 'in_progress' ? 'in_progress' : 'open');
  function bucketDropFields(key: string, task: Task): Partial<Task> {
    if (groupMode === 'status') return { status: key as StatusKey };
    const reopen: Partial<Task> = isDone(task) ? { status: 'open' } : {};
    switch (key) {
      case 'overdue': return { due_date: addDaysYmd(-1), ...reopen };
      case 'today':   return { due_date: todayStr, ...reopen };
      case 'week':    return { due_date: addDaysYmd(3), ...reopen };
      case 'later':   return { due_date: addDaysYmd(14), ...reopen };
      case 'nodate':  return { due_date: '', ...reopen };
      case 'done':    return { status: 'done' };
      default:        return {};
    }
  }
  async function handleColumnDrop(colKey: string, taskId: string) {
    setDragOverCol(null);
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const alreadyThere = groupMode === 'status' ? statusOf(task) === colKey : bucketOf(task) === colKey;
    if (alreadyThere) return;
    const updates = bucketDropFields(colKey, task);
    if (Object.keys(updates).length === 0) return;
    await handleUpdateTask(taskId, updates);
  }

  async function handleNewTask() {
    if (!newForm.title.trim()) return;
    // Call/Follow-up tasks live in the Call Queue, which shows items due today or
    // earlier — so an empty due date defaults to today for those types.
    const isCallish = newForm.type === 'call' || newForm.type === 'follow_up';
    const payload = isCallish && !newForm.due_date ? { ...newForm, due_date: todayStr } : newForm;
    const task = await apiCreateTask(payload);
    if (task) {
      onTasksChange(prev => [task, ...prev]);
      const who2 = parseMentionIds(newForm.description, profiles);
      if (onMention && who2.length) onMention(who2, `tagged you on a ${newForm.type === 'call' ? 'call task' : 'task'}: ${newForm.title.trim()}`, task.id);
      showToast(newForm.type === 'call' ? '📞 Call added to the queue ✓' : 'Task created ✓');
    }
    setShowNewModal(false);
    setNewForm({ title: '', description: '', due_date: '', assigned_to: currentUserId ?? '', client_id: '', priority: 'normal', status: 'open', type: '' });
  }

  // Keyboard: N = new task, / = focus search, Esc = leave select mode (ignored while typing or when a modal is open).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (showNewModal || detailTask || contactPopup) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); setShowNewModal(true); }
      else if (e.key === 'Escape' && selectMode) clearSelection();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewModal, detailTask, contactPopup, selectMode]);

  // Close the bulk-action menu on an outside click.
  useEffect(() => {
    if (!bulkMenu) return;
    const h = () => setBulkMenu(null);
    const t = window.setTimeout(() => document.addEventListener('click', h), 0);
    return () => { window.clearTimeout(t); document.removeEventListener('click', h); };
  }, [bulkMenu]);

  // ── Shared bits of UI ─────────────────────────────────────────────────────
  const LABEL = (s: string) => (
    <label style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--k-6b7280)', fontWeight: 700, display: 'block', marginBottom: 5, fontFamily: "'DM Sans',sans-serif" }}>{s}</label>
  );
  const INPUT_STYLE: React.CSSProperties = { padding: '9px 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 13, color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif", width: '100%', boxSizing: 'border-box', background: 'var(--k-fafafa)' };
  const BULK_BTN: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,.10)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap', minHeight: isMobile ? 40 : undefined };
  const BULK_MENU: React.CSSProperties = { position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: 'var(--k-fff)', color: 'var(--k-111)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.2)', padding: 6, minWidth: 152, zIndex: 460 };
  const BULK_MENU_ITEM: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--k-374151)', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
  const chip = (active: boolean): React.CSSProperties => ({
    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: isMobile ? '0 14px' : '0 12px', minHeight: isMobile ? 40 : 32, borderRadius: 20,
    border: `1px solid ${active ? '#c9922c' : 'var(--k-e5e7eb)'}`, background: active ? 'var(--k-fdf6e8)' : 'var(--k-fff)', color: active ? 'var(--k-a8741a)' : 'var(--k-374151)',
    fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  });
  const count = (n: number, active: boolean) => <span style={{ fontSize: 11, fontWeight: 700, color: active ? 'var(--k-a8741a)' : 'var(--k-9ca3af)' }}>{n}</span>;
  const FIELD: React.CSSProperties = { padding: '0 10px', minHeight: isMobile ? 40 : 34, border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 12.5, background: 'var(--k-fff)', fontFamily: "'DM Sans',sans-serif", cursor: 'pointer' };
  // Floating bars: full width on phones (a box pinned at left:50% can only grow to half the screen and squeezes into a tall stack), centred on a desktop.
  const dock: React.CSSProperties = isMobile ? { left: 12, right: 12 } : { left: '50%', transform: 'translateX(-50%)', width: 'max-content', maxWidth: 'calc(100vw - 48px)' };
  const openTask = (t: Task) => setDetailTask(t);
  const openContactPopup = (id?: string) => { const c = clients.find(x => x.id === id); if (c) setContactPopup(c); else if (id && onOpenContact) onOpenContact(id); };

  // ── LIST VIEW ─────────────────────────────────────────────────────────────
  function renderList() {
    const forceOpen = !!focus || !!search.trim();
    const sections = SECTION_CFG.filter(s => (focus ? s.key === focus : byBucket[s.key].length > 0));
    const shownCount = SECTION_CFG.reduce((n, s) => n + (s.key === 'done' ? 0 : byBucket[s.key].length), 0);

    const renderRow = (t: Task) => {
      const c = contactInfo(t, clientById);
      const o = ownerId(t);
      const done = isDone(t);
      return (
        <TaskRow key={t.id} t={t} isMobile={isMobile} selectMode={selectMode} isSelected={selected.has(t.id)} showOwner={showOwner}
          owner={o ? profileById[o] : undefined} contact={c} listTag={bucketOf(t) === 'calllist' ? listName(t) : null}
          onOpen={() => openTask(t)} onSelect={() => toggleSelect(t.id)}
          onComplete={() => (done ? reopenOne(t) : completeOne(t))}
          onContact={() => openContactPopup(c?.id)}
          onReschedule={v => handleUpdateTask(t.id, { due_date: v ?? '' })} />
      );
    };

    return (
      <div>
        {sections.length === 0 && (
          <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, padding: isMobile ? '28px 18px' : '36px 24px', textAlign: 'center', color: 'var(--k-6b7280)' }}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>{filtersOn ? '🔍' : '✅'}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', marginBottom: 4 }}>{filtersOn ? 'No tasks match' : (whoEff === 'me' ? 'You are all caught up' : 'Nothing here')}</div>
            <div style={{ fontSize: 12.5 }}>{filtersOn ? 'Try clearing a filter.' : 'Add a task above, or press N.'}</div>
            {isAdmin && search.trim() && whoEff !== 'all' && (
              <button onClick={() => { setWho('all'); setFocus(''); }}
                style={{ marginTop: 12, marginRight: 8, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-a8741a)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Search everyone&rsquo;s tasks</button>
            )}
            {filtersOn && (
              <button onClick={() => { setTypeFilter(''); setPriorityFilter(''); setSearch(''); setFocus(''); }}
                style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-a8741a)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Clear filters</button>
            )}
          </div>
        )}
        {sections.map(sec => {
          const items = byBucket[sec.key];
          const open = forceOpen || (sec.key in sectionOpen ? sectionOpen[sec.key] : sec.open);
          const isDoneSec = sec.key === 'done';
          const shown = isDoneSec ? items.slice(0, doneShown) : items;
          const allSel = items.length > 0 && items.every(t => selected.has(t.id));
          return (
            <div key={sec.key} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderLeft: `3px solid ${sec.color}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
              <div role="button" tabIndex={0} aria-expanded={open}
                onClick={() => { if (!forceOpen) setSectionOpen(s => ({ ...s, [sec.key]: !open })); }}
                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !forceOpen) { e.preventDefault(); setSectionOpen(s => ({ ...s, [sec.key]: !open })); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMobile ? '12px 12px' : '10px 14px', cursor: forceOpen ? 'default' : 'pointer', minHeight: isMobile ? 44 : undefined, userSelect: 'none' }}>
                <span style={{ width: 10, fontSize: 10, color: 'var(--k-9ca3af)', visibility: forceOpen ? 'hidden' : 'visible' }}>{open ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--k-111)' }}>{sec.label}</span>
                <span style={{ fontSize: 11, color: 'var(--k-6b7280)', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: '1px 8px', fontWeight: 700 }}>{items.length}</span>
                {isDoneSec && items.length > 0 && <span style={{ fontSize: 11, color: 'var(--k-9ca3af)' }}>{doneRecent} in the last 7 days</span>}
                {sec.key === 'calllist' && <span style={{ fontSize: 11, color: 'var(--k-9ca3af)' }}>carried over — work them in the Call Queue</span>}
                {selectMode && items.length > 1 && (
                  <button onClick={e => { e.stopPropagation(); setSelected(prev => { const next = new Set(prev); items.forEach(t => (allSel ? next.delete(t.id) : next.add(t.id))); return next; }); }}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#c9922c', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 6px', fontFamily: "'DM Sans',sans-serif" }}>
                    {allSel ? 'Clear' : 'Select all'}
                  </button>
                )}
              </div>
              {open && (items.length === 0
                ? <div style={{ padding: '14px 16px', borderTop: '1px solid var(--k-f3f4f6)', fontSize: 12.5, color: 'var(--k-9ca3af)', fontStyle: 'italic' }}>Nothing here</div>
                : shown.map(renderRow))}
              {open && isDoneSec && items.length > shown.length && (
                <button onClick={() => setDoneShown(n => n + 25)}
                  style={{ display: 'block', width: '100%', padding: isMobile ? '14px 0' : '10px 0', border: 'none', borderTop: '1px solid var(--k-f3f4f6)', background: 'var(--k-f9fafb)', color: 'var(--k-a8741a)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Show {Math.min(25, items.length - shown.length)} more · {items.length - shown.length} older
                </button>
              )}
            </div>
          );
        })}
        {sections.length > 0 && shownCount === 0 && !focus && (
          <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--k-9ca3af)', padding: '2px 0 10px' }}>Nothing open — everything here is done.</div>
        )}
      </div>
    );
  }

  // ── BOARD VIEW ────────────────────────────────────────────────────────────
  function renderBoard() {
    const isStatus = groupMode === 'status';
    const cols: readonly { key: string; label: string; color: string }[] = isStatus
      ? GROUP_CFG
      : SECTION_CFG.filter(s => s.key !== 'calllist' || byBucket.calllist.length > 0);
    const itemsOf = (key: string): Task[] => (isStatus
      ? visible.filter(t => statusOf(t) === key).sort(compareFor(key === 'done' ? 'done' : 'overdue'))
      : byBucket[key as Bucket]);
    const canAdd = (k: string) => isStatus || (k !== 'overdue' && k !== 'done' && k !== 'calllist');
    return (
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${cols.length}, minmax(240px, 1fr))`, gap: 14, alignItems: 'start', overflowX: 'auto', paddingBottom: 6 }}>
        {cols.map(grp => {
          const all = itemsOf(grp.key);
          const groupTasks = grp.key === 'done' ? all.slice(0, doneShown) : all;
          const isDropTarget = dragOverCol === grp.key;
          return (
            <div key={grp.key}
              onDragOver={e => { e.preventDefault(); if (dragOverCol !== grp.key) setDragOverCol(grp.key); }}
              onDragLeave={e => { if (e.currentTarget === e.target) setDragOverCol(c => (c === grp.key ? null : c)); }}
              onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) handleColumnDrop(grp.key, id); }}
              style={{ background: isDropTarget ? 'var(--k-fdf6e8)' : 'var(--k-f8fafc)', borderRadius: 12, border: `1px solid ${isDropTarget ? '#c9922c' : 'var(--k-e5e7eb)'}`, overflow: 'hidden', transition: 'background .12s, border-color .12s', minWidth: 0 }}>
              {/* Column header */}
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '3px solid ' + grp.color }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: grp.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--k-111)', fontFamily: "'DM Sans',sans-serif" }}>{grp.label}</span>
                {all.length > 1 && (() => {
                  const allSel = all.every(t => selected.has(t.id));
                  return (
                    <button onClick={() => setSelected(prev => { const next = new Set(prev); all.forEach(t => (allSel ? next.delete(t.id) : next.add(t.id))); return next; })}
                      aria-label={allSel ? `Deselect all ${grp.label} tasks` : `Select all ${all.length} ${grp.label} tasks`}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#c9922c', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '0 6px', fontFamily: "'DM Sans',sans-serif" }}>
                      {allSel ? 'Clear' : 'Select all'}
                    </button>
                  );
                })()}
                <span style={{ fontSize: 11, color: 'var(--k-9ca3af)', background: 'var(--k-fff)', borderRadius: 10, padding: '1px 7px', fontWeight: 600, marginLeft: all.length > 1 ? 0 : 'auto' }}>{all.length}</span>
              </div>

              {/* Cards */}
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 44 }}>
                {groupTasks.length === 0 && (
                  <div style={{ padding: '14px 8px', color: isDropTarget ? '#c9922c' : 'var(--k-9ca3af)', fontSize: 12, fontStyle: 'italic', textAlign: 'center' }}>
                    {isDropTarget ? 'Drop to move here' : 'Nothing here'}
                  </div>
                )}
                {groupTasks.map(t => {
                  const done = isDone(t);
                  const due = dueText(t, new Date(), true);   // short ("9d late") — the card is narrow
                  const isOverdue = due.tone === 'late';
                  const o = ownerId(t);
                  const owner = o ? profileById[o] : undefined;
                  const isSelected = selected.has(t.id);
                  const contact = contactInfo(t, clientById);
                  const icon = t.type && TYPE_META[t.type] ? TYPE_META[t.type] : null;
                  const contactChip = contact && (
                    <button onClick={e => { e.stopPropagation(); openContactPopup(contact.id); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--k-f1f5f9)', border: 'none', borderRadius: 6, padding: '2px 7px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", maxWidth: '100%' }}>
                      <span style={{ fontSize: 10 }}>👤</span>
                      <span style={{ fontSize: 11, color: 'var(--k-374151)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.name}</span>
                    </button>
                  );
                  return (
                    <div key={t.id} draggable
                      onDragStart={e => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onClick={() => openTask(t)}
                      style={{ background: 'var(--k-fff)', borderRadius: 10, padding: '10px 12px', border: `1px solid ${isSelected ? '#c9922c' : isOverdue ? 'var(--k-fecaca)' : 'var(--k-e5e7eb)'}`, boxShadow: isSelected ? '0 0 0 2px var(--k-fdf6e8)' : '0 1px 3px rgba(0,0,0,.04)', cursor: 'grab', transition: 'box-shadow .15s' }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,.12)'; }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = isSelected ? '0 0 0 2px var(--k-fdf6e8)' : '0 1px 3px rgba(0,0,0,.04)'; }}>
                      {/* Select + title */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <label onClick={e => e.stopPropagation()} title="Select" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, margin: '-13px 0 -13px -14px', flexShrink: 0, cursor: 'pointer' }}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(t.id)} aria-label="Select task"
                            style={{ flexShrink: 0, width: 14, height: 14, cursor: 'pointer', accentColor: '#c9922c' }} />
                        </label>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: done ? 'var(--k-9ca3af)' : 'var(--k-111)', textDecoration: done ? 'line-through' : 'none', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                          {icon && <span title={icon.label} style={{ marginRight: 6 }}>{icon.icon}</span>}
                          {t.title}
                        </div>
                      </div>
                      {contact && !isMobile && <div style={{ margin: '8px 0 0 22px' }}>{contactChip}</div>}
                      {/* Footer: priority · reschedule · owner */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginTop: 8, paddingLeft: isMobile ? 0 : 22 }}>
                        {isMobile && contact && <div style={{ flex: '1 1 0', minWidth: 0 }}>{contactChip}</div>}
                        {t.priority !== 'normal' ? <PriorityTag p={t.priority} /> : <span />}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <DuePill value={t.due_date} text={due.text} tone={due.tone} disabled={done} onChange={v => handleUpdateTask(t.id, { due_date: v ?? '' })} />
                          {showOwner && <Avatar profile={owner} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {grp.key === 'done' && all.length > groupTasks.length && (
                  <button onClick={() => setDoneShown(n => n + 25)}
                    style={{ padding: '9px 12px', background: 'transparent', border: '1px dashed var(--k-d1d5db)', borderRadius: 8, color: 'var(--k-a8741a)', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%', fontFamily: "'DM Sans',sans-serif" }}>
                    Show {Math.min(25, all.length - groupTasks.length)} more · {all.length - groupTasks.length} older
                  </button>
                )}

                {/* Board quick-add */}
                {canAdd(grp.key) && (quickAddGroup === grp.key ? (
                  <div style={{ background: 'var(--k-fff)', borderRadius: 10, padding: '10px 12px', border: '2px solid #c9922c' }}>
                    <input autoFocus value={quickAddTitle}
                      onChange={e => setQuickAddTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(quickAddFieldsFor(grp.key)); if (e.key === 'Escape') setQuickAddGroup(null); }}
                      placeholder="Task name… (Enter)"
                      style={{ width: '100%', border: 'none', outline: 'none', fontSize: 13, color: 'var(--k-111)', fontFamily: "'DM Sans',sans-serif", background: 'transparent' }} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => handleQuickAdd(quickAddFieldsFor(grp.key))}
                        style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: '#c9922c', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Add</button>
                      <button onClick={() => setQuickAddGroup(null)} aria-label="Cancel"
                        style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', border: 'none', fontSize: 12, cursor: 'pointer' }}>✕</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setQuickAddGroup(grp.key); setQuickAddTitle(''); }}
                    style={{ padding: '8px 12px', background: 'transparent', border: '1px dashed var(--k-d1d5db)', borderRadius: 8, color: 'var(--k-9ca3af)', fontSize: 12, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: "'DM Sans',sans-serif" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#c9922c'; e.currentTarget.style.color = '#c9922c'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--k-d1d5db)'; e.currentTarget.style.color = 'var(--k-9ca3af)'; }}>
                    + Add task
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const viewToggle = (
    <div style={{ display: 'flex', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: 3, gap: 2, flexShrink: 0 }}>
      {([['list', '☰ List'], ['board', '▦ Board']] as const).map(([v, lbl]) => (
        <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
          style={{ padding: isMobile ? '0 12px' : '0 12px', minHeight: isMobile ? 34 : 28, borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
            background: view === v ? 'var(--k-fff)' : 'transparent', color: view === v ? 'var(--k-111)' : 'var(--k-6b7280)', boxShadow: view === v ? '0 1px 4px rgba(0,0,0,.1)' : 'none' }}>
          {lbl}
        </button>
      ))}
    </div>
  );
  const newButton = (
    <button onClick={() => setShowNewModal(true)}
      style={{ flexShrink: 0, padding: '0 16px', minHeight: isMobile ? 40 : 34, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
      + New Task {!isMobile && (
        <span title="Keyboard shortcut" style={{ marginLeft: 2, fontSize: 10.5, fontWeight: 700, lineHeight: 1, padding: '2px 5px', borderRadius: 4, background: 'rgba(255,255,255,.22)', border: '1px solid rgba(255,255,255,.35)' }}>N</span>
      )}
    </button>
  );
  const bucketChips = SECTION_CFG.filter(s => byBucket[s.key].length > 0 || focus === s.key);

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <style>{`
        .tk-row:hover{background:var(--k-f9fafb);}
        .tk-circle:hover .tk-dot{border-color:#22c55e;}
        .tk-scroll{scrollbar-width:none;-webkit-overflow-scrolling:touch;}
        .tk-scroll::-webkit-scrollbar{display:none;}
      `}</style>

      {/* Whose tasks — Mine by default, a chip per teammate with how many they have open */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div className="tk-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: 1, minWidth: 0, padding: '1px 1px 3px' }}>
          {meId && <button onClick={() => pickWho('me')} aria-pressed={whoEff === 'me'} style={chip(whoEff === 'me')}>Mine {count(openByOwner.get(meId) ?? 0, whoEff === 'me')}</button>}
          {people.map(p => (
            <button key={p.id} onClick={() => pickWho(p.id)} aria-pressed={whoEff === p.id} style={chip(whoEff === p.id)}>{p.first_name} {count(openByOwner.get(p.id) ?? 0, whoEff === p.id)}</button>
          ))}
          {isAdmin && unassignedCt > 0 && <button onClick={() => pickWho('none')} aria-pressed={whoEff === 'none'} style={chip(whoEff === 'none')}>Unassigned {count(unassignedCt, whoEff === 'none')}</button>}
          {isAdmin && <button onClick={() => pickWho('all')} aria-pressed={whoEff === 'all'} style={chip(whoEff === 'all')}>Everyone {count(openTotal, whoEff === 'all')}</button>}
        </div>
        {!isMobile && viewToggle}
        {!isMobile && newButton}
      </div>

      {/* Search + filters (phones: search, ⚙ and + share one line; the rest opens under ⚙) */}
      {(() => {
        const searchBox = (
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder={isMobile ? '🔍  Search tasks…' : '🔍  Search title, contact or notes…  ( / )'} aria-label="Search tasks"
            style={{ ...FIELD, cursor: 'text', flex: isMobile ? '1 1 0' : '1 1 240px', minWidth: 0, maxWidth: isMobile ? undefined : 380, color: 'var(--k-374151)' }} />
        );
        const typeSelect = (
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Filter by type" style={{ ...FIELD, color: typeFilter ? 'var(--k-111)' : 'var(--k-6b7280)', flex: isMobile ? '1 1 0' : undefined }}>
            <option value="">All types</option>
            {TYPE_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        );
        const prioritySelect = (
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} aria-label="Filter by priority" style={{ ...FIELD, color: priorityFilter ? 'var(--k-111)' : 'var(--k-6b7280)', flex: isMobile ? '1 1 0' : undefined }}>
            <option value="">All priorities</option>
            {(Object.keys(PRIORITY_CFG) as PriorityKey[]).map(k => <option key={k} value={k}>{PRIORITY_CFG[k].label}</option>)}
          </select>
        );
        const groupToggle = view === 'board' && (
          <div style={{ display: 'flex', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: 3, gap: 2 }}>
            {([['urgency', '⏱ Urgency'], ['status', '◪ Status']] as [GroupMode, string][]).map(([g, lbl]) => (
              <button key={g} onClick={() => setGroupMode(g)}
                style={{ padding: '0 12px', minHeight: isMobile ? 34 : 28, borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
                  background: groupMode === g ? 'var(--k-fff)' : 'transparent', color: groupMode === g ? 'var(--k-111)' : 'var(--k-6b7280)', boxShadow: groupMode === g ? '0 1px 4px rgba(0,0,0,.1)' : 'none' }}>
                {lbl}
              </button>
            ))}
          </div>
        );
        const selectBtn = view === 'list' && (
          <button onClick={() => { if (selectMode) clearSelection(); else setSelectMode(true); }} aria-pressed={selectMode} title="Pick several tasks to finish, move or reassign together"
            style={{ ...FIELD, color: selectMode ? 'var(--k-a8741a)' : 'var(--k-6b7280)', borderColor: selectMode ? '#c9922c' : 'var(--k-e5e7eb)', background: selectMode ? 'var(--k-fdf6e8)' : 'var(--k-fff)', fontWeight: 600 }}>
            {selectMode ? '✕ Done selecting' : '☑ Select'}
          </button>
        );
        if (!isMobile) {
          return <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>{searchBox}{typeSelect}{prioritySelect}{groupToggle}{selectBtn}</div>;
        }
        const filtersActive = !!(typeFilter || priorityFilter);
        return (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {searchBox}
              <button onClick={() => setFiltersOpen(o => !o)} aria-pressed={filtersOpen} aria-label="Filters"
                style={{ ...FIELD, position: 'relative', flexShrink: 0, minWidth: 44, padding: 0, fontSize: 16, color: filtersOpen ? 'var(--k-a8741a)' : 'var(--k-6b7280)', borderColor: filtersOpen ? '#c9922c' : 'var(--k-e5e7eb)', background: filtersOpen ? 'var(--k-fdf6e8)' : 'var(--k-fff)' }}>
                ⚙{filtersActive && <span style={{ position: 'absolute', top: 6, right: 8, width: 8, height: 8, borderRadius: '50%', background: '#c9922c' }} />}
              </button>
              <button onClick={() => setShowNewModal(true)} aria-label="New task"
                style={{ flexShrink: 0, width: 44, minHeight: 40, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 22, lineHeight: 1, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋</button>
            </div>
            {filtersOpen && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                {typeSelect}{prioritySelect}{selectBtn}{viewToggle}{groupToggle}
              </div>
            )}
          </div>
        );
      })()}

      {/* Sections at a glance — tap one to look at just that */}
      {view === 'list' && !tasksLoading && bucketChips.length > 0 && (
        <div className="tk-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, padding: '1px 1px 3px' }}>
          <button onClick={() => setFocus('')} aria-pressed={!focus} style={chip(!focus)}>All</button>
          {bucketChips.map(s => {
            const active = focus === s.key;
            const n = s.key === 'done' ? doneRecent : byBucket[s.key].length;
            return (
              <button key={s.key} onClick={() => setFocus(active ? '' : s.key)} aria-pressed={active} style={chip(active)}
                title={s.key === 'done' ? 'Finished in the last 7 days' : undefined}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                {s.key === 'done' ? 'Done · 7 days' : s.label} {count(n, active)}
              </button>
            );
          })}
        </div>
      )}

      {/* Quick add */}
      {view === 'list' && !tasksLoading && (
        <form onSubmit={e => { e.preventDefault(); submitTop(); }} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input value={topTitle} onChange={e => setTopTitle(e.target.value)} aria-label="New task title"
            placeholder={isMobile ? (viewedName ? `＋ Add for ${viewedName}…` : '＋ Add a task…') : (viewedName ? `＋ Add a task for ${viewedName} — press Enter` : '＋ Add a task for yourself — press Enter')}
            style={{ flex: '1 1 0', minWidth: 0, padding: '0 14px', minHeight: isMobile ? 46 : 40, border: '1px dashed var(--k-d1d5db)', borderRadius: 10, background: 'var(--k-fff)', fontSize: 13.5, color: 'var(--k-111)', fontFamily: "'DM Sans',sans-serif", outline: 'none' }} />
          <select value={topWhen} onChange={e => setTopWhen(e.target.value as typeof topWhen)} aria-label="Due"
            style={{ ...FIELD, minHeight: isMobile ? 46 : 40, color: 'var(--k-374151)', flex: '0 0 auto' }}>
            <option value="today">{isMobile ? 'Today' : 'Due today'}</option>
            <option value="tomorrow">{isMobile ? 'Tomorrow' : 'Due tomorrow'}</option>
            <option value="week">{isMobile ? 'Next week' : 'Due next week'}</option>
            <option value="none">No date</option>
          </select>
          <button type="submit" disabled={!topTitle.trim()}
            style={{ padding: '0 18px', minHeight: isMobile ? 46 : 40, borderRadius: 10, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: topTitle.trim() ? 'pointer' : 'default', opacity: topTitle.trim() ? 1 : 0.45, fontFamily: "'DM Sans',sans-serif", flex: '0 0 auto' }}>
            Add
          </button>
        </form>
      )}

      {/* Main view */}
      {tasksLoading && tasks.length === 0 ? <Skeleton rows={7} pad={8} label="Loading tasks" /> : view === 'list' ? renderList() : renderBoard()}

      {/* Bulk action bar — appears when cards are selected */}
      {selIds.length > 0 && (
        <div style={{ position: 'fixed', bottom: isMobile ? 76 : 20, ...dock, zIndex: 450, display: 'flex', alignItems: 'center', gap: 8, background: '#111827', color: '#fff', borderRadius: 14, padding: '10px 12px 10px 16px', boxShadow: '0 12px 40px rgba(0,0,0,.35)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{selIds.length} selected</span>
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,.18)' }} />
          <button onClick={() => bulkApply({ status: 'done' })} style={BULK_BTN}>✓ Complete</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setBulkMenu(m => (m === 'reschedule' ? null : 'reschedule'))} style={BULK_BTN}>📅 Reschedule ▾</button>
            {bulkMenu === 'reschedule' && (
              <div style={BULK_MENU}>
                {([['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]] as [string, number][]).map(([lbl, n]) => (
                  <button key={lbl} onClick={() => bulkApply({ due_date: addDaysYmd(n) })} style={BULK_MENU_ITEM}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--k-f9fafb)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{lbl}</button>
                ))}
                <div style={{ borderTop: '1px solid var(--k-f3f4f6)', margin: '4px 0' }} />
                <button onClick={() => bulkApply({ due_date: '' })} style={{ ...BULK_MENU_ITEM, color: 'var(--k-dc2626)' }}>Clear date</button>
              </div>
            )}
          </div>
          {isAdmin && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => setBulkMenu(m => (m === 'reassign' ? null : 'reassign'))} style={BULK_BTN}>👤 Reassign ▾</button>
              {bulkMenu === 'reassign' && (
                <div style={{ ...BULK_MENU, maxHeight: 240, overflowY: 'auto' }}>
                  {profiles.map(p => (
                    <button key={p.id} onClick={() => bulkApply({ assigned_to: p.id })} style={BULK_MENU_ITEM}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--k-f9fafb)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{p.first_name} {p.last_name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={bulkDelete} style={{ ...BULK_BTN, color: '#fca5a5' }}>🗑 Delete</button>
          <button onClick={clearSelection} style={{ ...BULK_BTN, background: 'transparent' }}>Clear</button>
        </div>
      )}

      {/* Undo after a one-tap complete */}
      {undo && (
        <div role="status" style={{ position: 'fixed', bottom: (isMobile ? 84 : 24) + (selIds.length > 0 ? (isMobile ? 120 : 64) : 0), ...dock, zIndex: 470, display: 'flex', alignItems: 'center', gap: 12, background: '#111827', color: '#fff', borderRadius: 12, padding: '10px 10px 10px 16px', boxShadow: '0 12px 40px rgba(0,0,0,.35)', fontSize: 13 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>✓ Done · {undo.title}</span>
          <button onClick={undoComplete}
            style={{ flexShrink: 0, padding: '7px 14px', minHeight: isMobile ? 40 : undefined, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,.14)', color: '#fcd34d', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Undo</button>
        </div>
      )}

      {/* Contact quick-view popup */}
      {contactPopup && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,.35)' }}
          onClick={() => setContactPopup(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--k-fff)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600 }}>Contact Info</span>
              <button onClick={() => setContactPopup(null)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 18, lineHeight: 1, minWidth: 36, minHeight: 36 }}>✕</button>
            </div>
            <ClientContactCard client={contactPopup} onOpen={onOpenContact ? () => { const id = contactPopup.id; setContactPopup(null); onOpenContact(id); } : undefined} />
          </div>
        </div>
      )}

      {/* Task Detail Panel */}
      {detailTask && (
        <TaskDetailPanel
          task={detailTask}
          profiles={profiles}
          clients={clients}
          isAdmin={isAdmin}
          onClose={() => setDetailTask(null)}
          onToggleDone={() => toggleDoneFromPanel(detailTask)}
          onOpenContact={onOpenContact ? id => { setDetailTask(null); onOpenContact(id); } : undefined}
          onSave={async updates => {
            const ok = await handleUpdateTask(detailTask.id, updates);
            if (ok && onMention && typeof updates.description === 'string') {
              const had = new Set(parseMentionIds(detailTask.description ?? '', profiles));
              const fresh = parseMentionIds(updates.description, profiles).filter(id => !had.has(id));
              if (fresh.length) onMention(fresh, `tagged you on a task: ${detailTask.title}`, detailTask.id);
            }
            if (ok) setDetailTask(null);
          }}
          onDelete={() => handleDeleteTask(detailTask.id)}
        />
      )}

      {/* New Task Modal */}
      {showNewModal && (
        <div className="crm-sheet" style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewModal(false); }}>
          <div className="crm-sheet-panel" style={{ background: 'var(--k-fff)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, marginBottom: 20, color: 'var(--k-111)' }}>New Task</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>{LABEL('Title *')}<input autoFocus value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleNewTask()} placeholder="Task name…" style={INPUT_STYLE} /></div>
              <div>{LABEL('Notes')}<MentionTextarea value={newForm.description} onChange={v => setNewForm(f => ({ ...f, description: v }))} profiles={profiles} placeholder="Optional details… (@ to tag a teammate)" style={{ ...INPUT_STYLE, minHeight: 60, resize: 'none' }} /></div>
              <div>{LABEL('Type')}
                <select value={newForm.type} onChange={e => setNewForm(f => ({ ...f, type: e.target.value as typeof f.type }))} style={INPUT_STYLE}>
                  <option value="">✓ To-Do</option>
                  <option value="call">📞 Call</option>
                  <option value="follow_up">🔄 Follow-up</option>
                  <option value="email">✉️ Email</option>
                </select>
                {(newForm.type === 'call' || newForm.type === 'follow_up') && (
                  <div style={{ fontSize: 11.5, color: 'var(--k-a06a12)', marginTop: 4 }}>📞 Shows in the Call Queue (due today unless you set a later date).</div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>{LABEL('Status')}
                  <select value={newForm.status} onChange={e => setNewForm(f => ({ ...f, status: e.target.value as StatusKey }))} style={INPUT_STYLE}>
                    {(Object.keys(STATUS_CFG) as StatusKey[]).map(k => <option key={k} value={k}>{STATUS_CFG[k].label}</option>)}
                  </select>
                </div>
                <div>{LABEL('Priority')}
                  <select value={newForm.priority} onChange={e => setNewForm(f => ({ ...f, priority: e.target.value as PriorityKey }))} style={INPUT_STYLE}>
                    {(Object.keys(PRIORITY_CFG) as PriorityKey[]).map(k => <option key={k} value={k}>{PRIORITY_CFG[k].label}</option>)}
                  </select>
                </div>
              </div>
              <div>{LABEL('Due Date')}<input type="date" value={newForm.due_date} onChange={e => setNewForm(f => ({ ...f, due_date: e.target.value }))} style={INPUT_STYLE} /></div>
              {isAdmin && <div>{LABEL('Assign To')}
                <select value={newForm.assigned_to} onChange={e => setNewForm(f => ({ ...f, assigned_to: e.target.value }))} style={INPUT_STYLE}>
                  <option value="">Unassigned</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                </select>
              </div>}
              <div>{LABEL('Linked Contact')}
                <ContactSearch clients={clients} value={newForm.client_id} onChange={id => setNewForm(f => ({ ...f, client_id: id }))} />
              </div>
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button onClick={() => setShowNewModal(false)}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
                <button onClick={handleNewTask} disabled={!newForm.title.trim()}
                  style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", opacity: newForm.title.trim() ? 1 : 0.5 }}>
                  Create Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
