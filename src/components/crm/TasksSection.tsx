'use client';

import React, { useState, useRef, useEffect } from 'react';

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
    padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8,
    fontSize: 13, color: '#374151', fontFamily: "'DM Sans',sans-serif",
    width: '100%', boxSizing: 'border-box', background: '#fafafa',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button type="button" onClick={() => { setOpen(o => !o); setQ(''); }} style={PILL}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left', color: selected ? '#111' : '#9ca3af' }}>
          {selected ? `${selected.first_name} ${selected.last_name}${selected.business_name ? ` — ${selected.business_name}` : ''}` : 'None'}
        </span>
        {selected && (
          <span onClick={e => { e.stopPropagation(); onChange(''); }} title="Clear"
            style={{ flexShrink: 0, color: '#9ca3af', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>✕</span>
        )}
        <span style={{ flexShrink: 0, color: '#9ca3af', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ position: 'absolute', top: '105%', left: 0, right: 0, zIndex: 400,
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,.14)', overflow: 'hidden' }}>
          {/* Search input */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search contacts…"
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px',
                fontSize: 13, fontFamily: "'DM Sans',sans-serif", color: '#111', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {/* Results */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {/* None option */}
            <button type="button" onClick={() => { onChange(''); setOpen(false); setQ(''); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none',
                background: !value ? '#fef9ee' : 'transparent', color: !value ? '#c9922c' : '#6b7280',
                fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontStyle: 'italic' }}>
              None
            </button>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>No contacts found</div>
            ) : filtered.map(c => (
              <button type="button" key={c.id} onClick={() => { onChange(c.id); setOpen(false); setQ(''); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none',
                  background: c.id === value ? '#fef9ee' : 'transparent',
                  cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
                onMouseEnter={e => { if (c.id !== value) e.currentTarget.style.background = '#f9fafb'; }}
                onMouseLeave={e => { if (c.id !== value) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: c.id === value ? '#c9922c' : '#111' }}>
                  {c.first_name} {c.last_name}
                </div>
                {(c.business_name || c.email) && (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
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
  assigned_to?: string; client_id?: string; deal_id?: string;
  type?: string;
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
  onTasksChange: (tasks: Task[]) => void;
  showToast: (msg: string) => void;
  onRefresh: () => void;
  currentUserId?: string;
  onTaskComplete?: (task: Task) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────
const STATUS_CFG = {
  open:        { label: 'Open',        bg: '#dbeafe', color: '#1d4ed8', dot: '#3b82f6' },
  in_progress: { label: 'In Progress', bg: '#fef3c7', color: '#b45309', dot: '#f59e0b' },
  done:        { label: 'Done',        bg: '#dcfce7', color: '#15803d', dot: '#22c55e' },
} as const;

const PRIORITY_CFG = {
  urgent: { label: 'Urgent', bg: '#fee2e2', color: '#dc2626' },
  high:   { label: 'High',   bg: '#fed7aa', color: '#c2410c' },
  normal: { label: 'Normal', bg: '#dbeafe', color: '#1d4ed8' },
  low:    { label: 'Low',    bg: '#f1f5f9', color: '#64748b' },
} as const;

const GROUP_CFG = [
  { key: 'open',        label: 'Open',        color: '#3b82f6', defaultOpen: true  },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b', defaultOpen: true  },
  { key: 'done',        label: 'Done',        color: '#22c55e', defaultOpen: false },
] as const;

// Time-based buckets — the default "what do I do now" grouping for the board.
const URGENCY_CFG = [
  { key: 'overdue', label: 'Overdue',   color: '#ef4444', defaultOpen: true  },
  { key: 'today',   label: 'Today',     color: '#c9922c', defaultOpen: true  },
  { key: 'week',    label: 'This Week', color: '#3b82f6', defaultOpen: true  },
  { key: 'later',   label: 'Later',     color: '#8b5cf6', defaultOpen: true  },
  { key: 'nodate',  label: 'No Date',   color: '#9ca3af', defaultOpen: false },
  { key: 'done',    label: 'Done',      color: '#22c55e', defaultOpen: false },
] as const;

type StatusKey   = keyof typeof STATUS_CFG;
type PriorityKey = keyof typeof PRIORITY_CFG;
type GroupMode   = 'urgency' | 'status';

// today + n days as a YYYY-MM-DD string (matches how task.due_date is stored/compared).
function addDaysStr(n: number) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

// Visual marker for typed tasks (calls/follow-ups/emails) in the list views.
const TYPE_META: Record<string, { icon: string; label: string }> = {
  call:      { icon: '📞', label: 'Call' },
  follow_up: { icon: '🔄', label: 'Follow-up' },
  email:     { icon: '✉️', label: 'Email' },
};

function today() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d?: string) {
  if (!d) return '—';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function initials(first: string, last: string) { return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase(); }
function avatarColor(id: string) {
  const COLORS = ['#6366f1','#ec4899','#14b8a6','#f59e0b','#8b5cf6','#ef4444','#10b981'];
  let n = 0; for (const c of id) n = (n * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return COLORS[n % COLORS.length];
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
        <div style={{ position: 'absolute', top: '110%', left: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 6, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 130 }}>
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
        <div style={{ position: 'absolute', top: '110%', left: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 6, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 120 }}>
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

// ── Avatar ───────────────────────────────────────────────────────────────────
// Inline due-date pill with one-tap reschedule — the table row's power move.
// Menu uses fixed positioning so it escapes the group card's overflow:hidden clip.
function DuePill({ value, overdue, isToday, onChange }: { value?: string; overdue?: boolean; isToday?: boolean; onChange: (v: string | null) => void }) {
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
    setPos({ top: r.bottom + 4, left: Math.max(8, r.left) });
  };
  const quick = [{ label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 }, { label: 'In 3 days', days: 3 }, { label: 'Next week', days: 7 }];
  const pick = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); onChange(d.toISOString().slice(0, 10)); setPos(null); };
  const color = overdue ? '#dc2626' : isToday ? '#a8741a' : value ? '#6b7280' : '#c7ccd1';
  const bg = overdue ? '#fef2f2' : isToday ? '#fdf6e8' : 'transparent';
  return (
    <div ref={ref} style={{ display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button onClick={toggle} title="Reschedule"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, border: '1px solid transparent', background: bg, color, fontSize: 12, fontWeight: overdue ? 700 : 500, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = '#e5e7eb')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}>
        📅 {value ? fmtDate(value) : 'No date'}
      </button>
      {pos && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.18)', padding: 6, zIndex: 1000, minWidth: 156 }}>
          {quick.map(q => (
            <button key={q.label} onClick={() => pick(q.days)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: '#374151', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {q.label}
            </button>
          ))}
          <div style={{ borderTop: '1px solid #f3f4f6', margin: '4px 0' }} />
          <input type="date" value={value ?? ''} onChange={e => { onChange(e.target.value || null); setPos(null); }}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, fontFamily: "'DM Sans',sans-serif", boxSizing: 'border-box' }} />
          {value && (
            <button onClick={() => { onChange(null); setPos(null); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', marginTop: 4, borderRadius: 6, border: 'none', background: 'transparent', color: '#dc2626', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
              Clear date
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ profile }: { profile?: Profile }) {
  if (!profile) return <span style={{ fontSize: 12, color: '#9ca3af' }}>—</span>;
  const color = avatarColor(profile.id);
  return (
    <span title={`${profile.first_name} ${profile.last_name}`}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: color, color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0, fontFamily: "'DM Sans',sans-serif" }}>
      {initials(profile.first_name, profile.last_name)}
    </span>
  );
}

// ── Client Contact Card ───────────────────────────────────────────────────────
function ClientContactCard({ client }: { client: Client }) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(val: string, label: string) {
    navigator.clipboard.writeText(val).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }
  const typeColors: Record<string, { bg: string; color: string }> = {
    Buyer: { bg: '#dbeafe', color: '#1d4ed8' },
    Seller: { bg: '#dcfce7', color: '#15803d' },
    Tenant: { bg: '#fef3c7', color: '#b45309' },
    'Landlord/Investor': { bg: '#f3e8ff', color: '#7e22ce' },
    Agent: { bg: '#f1f5f9', color: '#475569' },
    Broker: { bg: '#f1f5f9', color: '#475569' },
  };
  const tc = client.type ? (typeColors[client.type] ?? { bg: '#f1f5f9', color: '#475569' }) : null;
  return (
    <div style={{ marginTop: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#c9922c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          {(client.first_name[0] ?? '').toUpperCase()}{(client.last_name[0] ?? '').toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {client.first_name} {client.last_name}
          </div>
          {client.business_name && (
            <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.business_name}</div>
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
            <a href={`mailto:${client.email}`} style={{ fontSize: 12, color: '#2563eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>
              {client.email}
            </a>
            <button onClick={() => copy(client.email!, 'email')} title="Copy email"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: copied === 'email' ? '#16a34a' : '#9ca3af', flexShrink: 0, fontFamily: "'DM Sans',sans-serif", padding: '2px 4px' }}>
              {copied === 'email' ? '✓ Copied' : '📋'}
            </button>
          </div>
        )}
        {(client.phone || client.cell_phone) && (
          <>
            {client.phone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>📞</span>
                <a href={`tel:${client.phone}`} style={{ fontSize: 12, color: '#111', flex: 1, textDecoration: 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#c9922c')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#111')}>
                  {client.phone}
                </a>
                <button onClick={() => copy(client.phone!, 'phone')} title="Copy phone"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: copied === 'phone' ? '#16a34a' : '#9ca3af', flexShrink: 0, fontFamily: "'DM Sans',sans-serif", padding: '2px 4px' }}>
                  {copied === 'phone' ? '✓ Copied' : '📋'}
                </button>
              </div>
            )}
            {client.cell_phone && client.cell_phone !== client.phone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>📱</span>
                <a href={`tel:${client.cell_phone}`} style={{ fontSize: 12, color: '#111', flex: 1, textDecoration: 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#c9922c')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#111')}>
                  {client.cell_phone}
                </a>
                <button onClick={() => copy(client.cell_phone!, 'cell')} title="Copy cell"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: copied === 'cell' ? '#16a34a' : '#9ca3af', flexShrink: 0, fontFamily: "'DM Sans',sans-serif", padding: '2px 4px' }}>
                  {copied === 'cell' ? '✓ Copied' : '📋'}
                </button>
              </div>
            )}
          </>
        )}
        {!client.email && !client.phone && !client.cell_phone && (
          <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No contact info on file</div>
        )}
      </div>
    </div>
  );
}

// ── Task Detail Panel ────────────────────────────────────────────────────────
function TaskDetailPanel({
  task, profiles, clients, isAdmin, onClose, onSave, onDelete,
}: {
  task: Task; profiles: Profile[]; clients: Client[]; isAdmin: boolean;
  onClose: () => void; onSave: (updates: Partial<Task>) => void; onDelete: () => void;
}) {
  const [form, setForm] = useState<Partial<Task>>({
    title: task.title, description: task.description ?? '', due_date: task.due_date ?? '',
    assigned_to: task.assigned_to ?? '', client_id: task.client_id ?? '',
    status: task.status, priority: task.priority,
  });
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ flex: 1 }} onClick={onClose} />
      <div style={{ width: Math.min(480, window.innerWidth), background: '#fff', boxShadow: '-4px 0 32px rgba(0,0,0,.14)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', borderBottom: '1px solid #f3f4f6', paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Task Detail</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 18, lineHeight: 1 }}>✕</button>
          </div>
          <input value={form.title ?? ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            style={{ width: '100%', border: 'none', outline: 'none', fontSize: 20, fontWeight: 700, color: '#111', fontFamily: "'DM Sans',sans-serif", background: 'transparent', padding: 0, boxSizing: 'border-box' }} />
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Status + Priority row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 6 }}>Status</div>
              <StatusPill value={form.status ?? 'open'} onChange={v => setForm(f => ({ ...f, status: v }))} />
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 6 }}>Priority</div>
              <PriorityPill value={form.priority ?? 'normal'} onChange={v => setForm(f => ({ ...f, priority: v }))} />
            </div>
          </div>

          {/* Due date */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 6 }}>Due Date</div>
            <input type="date" value={form.due_date ?? ''}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
              style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#374151', fontFamily: "'DM Sans',sans-serif", width: '100%', boxSizing: 'border-box', background: '#fafafa' }} />
          </div>

          {/* Assignee */}
          {isAdmin && (
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 6 }}>Assignee</div>
              <select value={form.assigned_to ?? ''} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#374151', fontFamily: "'DM Sans',sans-serif", width: '100%', background: '#fafafa' }}>
                <option value="">Unassigned</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
              </select>
            </div>
          )}

          {/* Linked contact */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 6 }}>Linked Contact</div>
            <ContactSearch clients={clients} value={form.client_id ?? ''} onChange={id => setForm(f => ({ ...f, client_id: id }))} />
            {(() => {
              const linked = clients.find(c => c.id === (form.client_id ?? ''));
              return linked ? <ClientContactCard client={linked} /> : null;
            })()}
          </div>

          {/* Notes */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 6 }}>Notes</div>
            <textarea value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Add notes…"
              style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#374151', fontFamily: "'DM Sans',sans-serif", width: '100%', minHeight: 120, resize: 'vertical', background: '#fafafa', boxSizing: 'border-box', lineHeight: 1.6 }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #f3f4f6', display: 'flex', gap: 10 }}>
          <button onClick={() => { if (confirm('Delete this task?')) onDelete(); }}
            style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            Delete
          </button>
          <button onClick={onClose}
            style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            Cancel
          </button>
          <button onClick={() => onSave(form)}
            style={{ flex: 1, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function TasksSection({
  tasks, tasksLoading, profiles, clients, isAdmin, isMobile,
  businessUnit, authHeaders, onTasksChange, showToast, onRefresh, currentUserId, onTaskComplete,
}: Props) {
  const [groupMode, setGroupMode] = useState<GroupMode>('urgency');
  const [quickFilter, setQuickFilter] = useState<'' | 'overdue' | 'today' | 'week' | 'later' | 'nodate' | 'done'>('');
  const [mineOnly, setMineOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMenu, setBulkMenu] = useState<'reschedule' | 'reassign' | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [quickAddGroup, setQuickAddGroup] = useState<string | null>(null);
  const [contactPopup, setContactPopup] = useState<Client | null>(null);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newForm, setNewForm] = useState({ title: '', description: '', due_date: '', assigned_to: currentUserId ?? '', client_id: '', priority: 'normal' as PriorityKey, status: 'open' as StatusKey, type: '' as '' | 'call' | 'follow_up' | 'email' });
  const quickAddRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const todayStr = today();
  const weekStr = addDaysStr(7);

  // Which time-bucket a task falls in (drives the default grouping, stats, and quick filters).
  function urgencyOf(t: Task): string {
    if (t.status === 'done') return 'done';
    if (!t.due_date) return 'nodate';
    if (t.due_date < todayStr) return 'overdue';
    if (t.due_date === todayStr) return 'today';
    if (t.due_date <= weekStr) return 'week';
    return 'later';
  }

  // ── API helpers ──────────────────────────────────────────────────────────
  async function apiCreateTask(data: Partial<Task> & { title: string }): Promise<Task | null> {
    const res = await fetch('/api/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ ...data, business_unit: businessUnit }),
    });
    if (!res.ok) { showToast('Error creating task'); return null; }
    const { task } = await res.json();
    return task;
  }

  async function apiUpdateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const res = await fetch(`/api/crm/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(updates),
    });
    if (!res.ok) { showToast('Error updating task'); return null; }
    const { task } = await res.json();
    return task;
  }

  async function apiDeleteTask(id: string) {
    await fetch(`/api/crm/tasks/${id}`, { method: 'DELETE', headers: authHeaders });
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleUpdateTask(id: string, updates: Partial<Task>) {
    const updated = await apiUpdateTask(id, updates);
    if (updated) {
      onTasksChange(tasks.map(t => t.id === id ? updated : t));
      showToast('Saved ✓');
      // Log a touch on the linked contact when a task is marked done
      if (updates.status === 'done' && updated.client_id && onTaskComplete) {
        onTaskComplete(updated);
      }
    }
  }

  async function handleDeleteTask(id: string) {
    await apiDeleteTask(id);
    onTasksChange(tasks.filter(t => t.id !== id));
    setDetailTask(null);
    showToast('Task deleted');
  }

  // Quick-add fields depend on the active grouping: in status mode the group IS the
  // status; in urgency mode the group implies a due date instead.
  function quickAddFieldsFor(grpKey: string): Partial<Task> {
    if (groupMode === 'status') return { status: grpKey as StatusKey };
    switch (grpKey) {
      case 'today':   return { status: 'open', due_date: todayStr };
      case 'week':    return { status: 'open', due_date: addDaysStr(3) };
      case 'later':   return { status: 'open', due_date: addDaysStr(14) };
      case 'overdue': return { status: 'open', due_date: todayStr };
      case 'done':    return { status: 'done' };
      default:        return { status: 'open' }; // nodate
    }
  }

  async function handleQuickAdd(fields: Partial<Task>) {
    if (!quickAddTitle.trim()) { setQuickAddGroup(null); return; }
    const task = await apiCreateTask({ title: quickAddTitle.trim(), priority: 'normal', ...fields });
    if (task) {
      onTasksChange([task, ...tasks]);
      showToast('Task created ✓');
    }
    setQuickAddTitle('');
    setQuickAddGroup(null);
  }

  // ── Bulk selection actions ─────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function bulkApply(updates: Partial<Task>) {
    const ids = [...selected];
    if (ids.length === 0) return;
    await Promise.all(ids.map(id => apiUpdateTask(id, updates)));
    if (updates.status === 'done' && onTaskComplete) tasks.filter(t => selected.has(t.id) && t.client_id).forEach(t => onTaskComplete({ ...t, ...updates }));
    onTasksChange(tasks.map(t => {
      if (!selected.has(t.id)) return t;
      const next = { ...t, ...updates };
      if (updates.assigned_to !== undefined) next.assignee = profiles.find(p => p.id === updates.assigned_to);
      return next;
    }));
    setSelected(new Set()); setBulkMenu(null);
    showToast(`${ids.length} task${ids.length === 1 ? '' : 's'} updated ✓`);
  }
  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    await Promise.all(ids.map(id => apiDeleteTask(id)));
    onTasksChange(tasks.filter(t => !selected.has(t.id)));
    setSelected(new Set()); setBulkMenu(null);
    showToast(`${ids.length} task${ids.length === 1 ? '' : 's'} deleted`);
  }

  // ── Drag-to-reschedule / restatus (board) ──────────────────────────────────
  function bucketDropFields(key: string, task: Task): Partial<Task> {
    if (groupMode === 'status') return { status: key as StatusKey };
    const reopen: Partial<Task> = task.status === 'done' ? { status: 'open' } : {};
    switch (key) {
      case 'overdue': return { due_date: addDaysStr(-1), ...reopen };
      case 'today':   return { due_date: todayStr, ...reopen };
      case 'week':    return { due_date: addDaysStr(3), ...reopen };
      case 'later':   return { due_date: addDaysStr(14), ...reopen };
      case 'nodate':  return { due_date: '', ...reopen };
      case 'done':    return { status: 'done' };
      default:        return {};
    }
  }
  async function handleColumnDrop(colKey: string, taskId: string) {
    setDragOverCol(null);
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const alreadyThere = groupMode === 'status' ? task.status === colKey : urgencyOf(task) === colKey;
    if (alreadyThere) return;
    const updates = bucketDropFields(colKey, task);
    if (Object.keys(updates).length === 0) return;
    await handleUpdateTask(taskId, updates);
  }

  async function handleNewTask() {
    if (!newForm.title.trim()) return;
    // Call/Follow-up tasks live in the Call Queue, which shows items due today or
    // earlier — so an empty due date defaults to today for those types.
    const d = new Date();
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const isCallish = newForm.type === 'call' || newForm.type === 'follow_up';
    const payload = isCallish && !newForm.due_date ? { ...newForm, due_date: localToday } : newForm;
    const task = await apiCreateTask(payload);
    if (task) {
      onTasksChange([task, ...tasks]);
      showToast(newForm.type === 'call' ? '📞 Call added to the queue ✓' : 'Task created ✓');
    }
    setShowNewModal(false);
    setNewForm({ title: '', description: '', due_date: '', assigned_to: currentUserId ?? '', client_id: '', priority: 'normal', status: 'open', type: '' });
  }

  // ── Filtering ────────────────────────────────────────────────────────────
  const scoped = mineOnly && currentUserId ? tasks.filter(t => t.assigned_to === currentUserId) : tasks;
  const filtered = scoped.filter(t => {
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (assigneeFilter && t.assigned_to !== assigneeFilter) return false;
    if (quickFilter && urgencyOf(t) !== quickFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const profileById = Object.fromEntries(profiles.map(p => [p.id, p]));
  const overdueCt = scoped.filter(t => urgencyOf(t) === 'overdue').length;
  const todayCt   = scoped.filter(t => urgencyOf(t) === 'today').length;
  const weekCt    = scoped.filter(t => urgencyOf(t) === 'week').length;

  // Keyboard: N = new task, / = focus search (ignored while typing or when a modal is open).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (showNewModal || detailTask || contactPopup) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); setShowNewModal(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNewModal, detailTask, contactPopup]);

  // Close the bulk-action menu on an outside click.
  useEffect(() => {
    if (!bulkMenu) return;
    const h = () => setBulkMenu(null);
    const t = window.setTimeout(() => document.addEventListener('click', h), 0);
    return () => { window.clearTimeout(t); document.removeEventListener('click', h); };
  }, [bulkMenu]);

  // ── BOARD VIEW ────────────────────────────────────────────────────────────
  function BoardView() {
    const groups: readonly { key: string; label: string; color: string; defaultOpen: boolean }[] =
      groupMode === 'urgency' ? URGENCY_CFG : GROUP_CFG;
    const bucketOf = (t: Task) => (groupMode === 'urgency' ? urgencyOf(t) : t.status);
    const canAdd = (k: string) => groupMode === 'status' || (k !== 'overdue' && k !== 'done');
    return (
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${groups.length}, minmax(240px, 1fr))`, gap: 14, alignItems: 'start', overflowX: 'auto', paddingBottom: 6 }}>
        {groups.map(grp => {
          const groupTasks = filtered.filter(t => bucketOf(t) === grp.key);
          const isDropTarget = dragOverCol === grp.key;
          return (
            <div key={grp.key}
              onDragOver={e => { e.preventDefault(); if (dragOverCol !== grp.key) setDragOverCol(grp.key); }}
              onDragLeave={e => { if (e.currentTarget === e.target) setDragOverCol(c => (c === grp.key ? null : c)); }}
              onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) handleColumnDrop(grp.key, id); }}
              style={{ background: isDropTarget ? '#fdf6e8' : '#f8fafc', borderRadius: 12, border: `1px solid ${isDropTarget ? '#c9922c' : '#e5e7eb'}`, overflow: 'hidden', transition: 'background .12s, border-color .12s', minWidth: 0 }}>
              {/* Column header */}
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '3px solid ' + grp.color }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: grp.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#111', fontFamily: "'DM Sans',sans-serif" }}>{grp.label}</span>
                <span style={{ fontSize: 11, color: '#9ca3af', background: '#fff', borderRadius: 10, padding: '1px 7px', fontWeight: 600, marginLeft: 'auto' }}>{groupTasks.length}</span>
              </div>

              {/* Cards */}
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 44 }}>
                {groupTasks.length === 0 && (
                  <div style={{ padding: '14px 8px', color: isDropTarget ? '#c9922c' : '#cbd5e1', fontSize: 12, fontStyle: 'italic', textAlign: 'center' }}>
                    {isDropTarget ? 'Drop to move here' : 'Nothing here'}
                  </div>
                )}
                {groupTasks.map(t => {
                  const isOverdue = t.status !== 'done' && t.due_date && t.due_date < todayStr;
                  const assignee = t.assignee ?? profileById[t.assigned_to ?? ''];
                  const pc = PRIORITY_CFG[t.priority];
                  const isSelected = selected.has(t.id);
                  const contact = t.client ?? clients.find(c => c.id === t.client_id);
                  return (
                    <div key={t.id} draggable
                      onDragStart={e => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onClick={() => setDetailTask(t)}
                      style={{ background: '#fff', borderRadius: 10, padding: '10px 12px', border: `1px solid ${isSelected ? '#c9922c' : isOverdue ? '#fecaca' : '#e5e7eb'}`, boxShadow: isSelected ? '0 0 0 2px #fdf6e8' : '0 1px 3px rgba(0,0,0,.04)', cursor: 'grab', transition: 'box-shadow .15s' }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,.12)'; }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = isSelected ? '0 0 0 2px #fdf6e8' : '0 1px 3px rgba(0,0,0,.04)'; }}>
                      {/* Select + title */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <input type="checkbox" checked={isSelected} onClick={e => e.stopPropagation()} onChange={() => toggleSelect(t.id)}
                          title="Select" style={{ marginTop: 2, flexShrink: 0, width: 14, height: 14, cursor: 'pointer', accentColor: '#c9922c' }} />
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: t.status === 'done' ? '#9ca3af' : '#111', textDecoration: t.status === 'done' ? 'line-through' : 'none', lineHeight: 1.4 }}>
                          {t.type && TYPE_META[t.type] && <span title={TYPE_META[t.type].label} style={{ marginRight: 6 }}>{TYPE_META[t.type].icon}</span>}
                          {t.title}
                        </div>
                      </div>
                      {/* Contact */}
                      {contact && (
                        <button onClick={e => { e.stopPropagation(); const full = clients.find(c => c.id === t.client_id); setContactPopup(full ?? null); }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f1f5f9', border: 'none', borderRadius: 6, padding: '2px 7px', margin: '8px 0 0 22px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", maxWidth: 'calc(100% - 22px)' }}>
                          <span style={{ fontSize: 10 }}>👤</span>
                          <span style={{ fontSize: 11, color: '#374151', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.first_name} {contact.last_name}</span>
                        </button>
                      )}
                      {/* Footer: priority · reschedule · assignee */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginTop: 8, paddingLeft: 22 }}>
                        <span style={{ ...pc, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" } as React.CSSProperties}>{pc.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <DuePill value={t.due_date} overdue={!!isOverdue} isToday={t.due_date === todayStr && t.status !== 'done'}
                            onChange={v => handleUpdateTask(t.id, { due_date: v ?? '' })} />
                          <Avatar profile={assignee} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Board quick-add */}
                {canAdd(grp.key) && (quickAddGroup === grp.key ? (
                  <div style={{ background: '#fff', borderRadius: 10, padding: '10px 12px', border: '2px solid #c9922c' }}>
                    <input ref={quickAddRef} autoFocus value={quickAddTitle}
                      onChange={e => setQuickAddTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(quickAddFieldsFor(grp.key)); if (e.key === 'Escape') setQuickAddGroup(null); }}
                      placeholder="Task name… (Enter)"
                      style={{ width: '100%', border: 'none', outline: 'none', fontSize: 13, color: '#111', fontFamily: "'DM Sans',sans-serif", background: 'transparent' }} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => handleQuickAdd(quickAddFieldsFor(grp.key))}
                        style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: '#c9922c', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Add</button>
                      <button onClick={() => setQuickAddGroup(null)}
                        style={{ padding: '5px 10px', borderRadius: 6, background: '#f3f4f6', color: '#6b7280', border: 'none', fontSize: 12, cursor: 'pointer' }}>✕</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setQuickAddGroup(grp.key); setQuickAddTitle(''); }}
                    style={{ padding: '8px 12px', background: 'transparent', border: '1px dashed #d1d5db', borderRadius: 8, color: '#9ca3af', fontSize: 12, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: "'DM Sans',sans-serif" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#c9922c'; e.currentTarget.style.color = '#c9922c'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#9ca3af'; }}>
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

  // ── New Task Modal ────────────────────────────────────────────────────────
  const LABEL = (s: string) => (
    <label style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7280', fontWeight: 700, display: 'block', marginBottom: 5, fontFamily: "'DM Sans',sans-serif" }}>{s}</label>
  );
  const INPUT_STYLE: React.CSSProperties = { padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#374151', fontFamily: "'DM Sans',sans-serif", width: '100%', boxSizing: 'border-box', background: '#fafafa' };
  const BULK_BTN: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,.10)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' };
  const BULK_MENU: React.CSSProperties = { position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#fff', color: '#111', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.2)', padding: 6, minWidth: 152, zIndex: 460 };
  const BULK_MENU_ITEM: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: '#374151', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };

  // ── Render ────────────────────────────────────────────────────────────────
  const doneCt = scoped.filter(t => t.status === 'done').length;

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {/* Grouping toggle — how the board columns are organized */}
        <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
          {([['urgency', '⏱ Urgency'], ['status', '◪ Status']] as [GroupMode, string][]).map(([g, lbl]) => (
            <button key={g} onClick={() => setGroupMode(g)}
              style={{ padding: '5px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'all .15s',
                background: groupMode === g ? '#fff' : 'transparent', color: groupMode === g ? '#111' : '#6b7280', boxShadow: groupMode === g ? '0 1px 4px rgba(0,0,0,.1)' : 'none' }}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Search */}
        <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search tasks…  ( / )"
          style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#374151', background: '#fff', fontFamily: "'DM Sans',sans-serif", width: isMobile ? '100%' : 200 }} />

        {/* Priority filter */}
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, color: priorityFilter ? '#111' : '#9ca3af', background: '#fff', fontFamily: "'DM Sans',sans-serif", cursor: 'pointer' }}>
          <option value="">All Priorities</option>
          {(Object.keys(PRIORITY_CFG) as PriorityKey[]).map(k => <option key={k} value={k}>{PRIORITY_CFG[k].label}</option>)}
        </select>

        {/* Assignee filter (admin only) */}
        {isAdmin && (
          <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, color: assigneeFilter ? '#111' : '#9ca3af', background: '#fff', fontFamily: "'DM Sans',sans-serif", cursor: 'pointer' }}>
            <option value="">All Assignees</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
          </select>
        )}

        {currentUserId && (
          <button onClick={() => setMineOnly(m => !m)} title="Show only tasks assigned to me"
            style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${mineOnly ? '#c9922c' : '#e5e7eb'}`, background: mineOnly ? '#fdf6e8' : '#fff', color: mineOnly ? '#a8741a' : '#6b7280', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
            {mineOnly ? '👤 Mine' : '👥 Everyone'}
          </button>
        )}

        <button onClick={() => setShowNewModal(true)}
          style={{ marginLeft: 'auto', padding: '8px 18px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
          + New Task <span style={{ opacity: 0.7, fontWeight: 600 }}>N</span>
        </button>
      </div>

      {/* Stats strip — tap a card to filter the list to that bucket */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {([
          { key: 'overdue', label: 'Overdue',   val: overdueCt, color: '#ef4444' },
          { key: 'today',   label: 'Due Today', val: todayCt,   color: '#c9922c' },
          { key: 'week',    label: 'This Week', val: weekCt,    color: '#3b82f6' },
          { key: 'done',    label: 'Done',      val: doneCt,    color: '#22c55e' },
        ] as { key: 'overdue' | 'today' | 'week' | 'done'; label: string; val: number; color: string }[]).map(s => {
          const active = quickFilter === s.key;
          return (
            <button key={s.label} onClick={() => setQuickFilter(active ? '' : s.key)}
              style={{ textAlign: 'left', background: '#fff', borderRadius: 10, padding: '12px 16px', border: `1px solid ${active ? s.color : '#e5e7eb'}`, borderLeft: `4px solid ${s.color}`, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", boxShadow: active ? `0 2px 12px ${s.color}22` : 'none', transition: 'all .12s' }}>
              <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: active ? s.color : '#9ca3af', marginBottom: 3, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                {s.label}{active && <span>✓</span>}
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', lineHeight: 1 }}>{s.val}</div>
            </button>
          );
        })}
      </div>

      {/* Main view */}
      {tasksLoading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
          Loading tasks…
        </div>
      ) : <BoardView />}

      {/* Bulk action bar — appears when cards are selected */}
      {selected.size > 0 && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 450, display: 'flex', alignItems: 'center', gap: 8, background: '#111827', color: '#fff', borderRadius: 14, padding: '10px 12px 10px 16px', boxShadow: '0 12px 40px rgba(0,0,0,.35)', flexWrap: 'wrap', maxWidth: 'calc(100vw - 24px)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{selected.size} selected</span>
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,.18)' }} />
          <button onClick={() => bulkApply({ status: 'done' })} style={BULK_BTN}>✓ Complete</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setBulkMenu(m => (m === 'reschedule' ? null : 'reschedule'))} style={BULK_BTN}>📅 Reschedule ▾</button>
            {bulkMenu === 'reschedule' && (
              <div style={BULK_MENU}>
                {([['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]] as [string, number][]).map(([lbl, n]) => (
                  <button key={lbl} onClick={() => bulkApply({ due_date: addDaysStr(n) })} style={BULK_MENU_ITEM}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{lbl}</button>
                ))}
                <div style={{ borderTop: '1px solid #f3f4f6', margin: '4px 0' }} />
                <button onClick={() => bulkApply({ due_date: '' })} style={{ ...BULK_MENU_ITEM, color: '#dc2626' }}>Clear date</button>
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
                      onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{p.first_name} {p.last_name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={bulkDelete} style={{ ...BULK_BTN, color: '#fca5a5' }}>🗑 Delete</button>
          <button onClick={() => { setSelected(new Set()); setBulkMenu(null); }} style={{ ...BULK_BTN, background: 'transparent' }}>Clear</button>
        </div>
      )}

      {/* Contact quick-view popup */}
      {contactPopup && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setContactPopup(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Contact Info</span>
              <button onClick={() => setContactPopup(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 18, lineHeight: 1 }}>✕</button>
            </div>
            <ClientContactCard client={contactPopup} />
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
          onSave={async updates => { await handleUpdateTask(detailTask.id, updates); setDetailTask(null); }}
          onDelete={() => handleDeleteTask(detailTask.id)}
        />
      )}

      {/* New Task Modal */}
      {showNewModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewModal(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, marginBottom: 20, color: '#111' }}>New Task</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>{LABEL('Title *')}<input autoFocus value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleNewTask()} placeholder="Task name…" style={INPUT_STYLE} /></div>
              <div>{LABEL('Notes')}<textarea value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional details…" style={{ ...INPUT_STYLE, minHeight: 60, resize: 'none' }} /></div>
              <div>{LABEL('Type')}
                <select value={newForm.type} onChange={e => setNewForm(f => ({ ...f, type: e.target.value as typeof f.type }))} style={INPUT_STYLE}>
                  <option value="">✓ To-Do</option>
                  <option value="call">📞 Call</option>
                  <option value="follow_up">🔄 Follow-up</option>
                  <option value="email">✉️ Email</option>
                </select>
                {(newForm.type === 'call' || newForm.type === 'follow_up') && (
                  <div style={{ fontSize: 11.5, color: '#a06a12', marginTop: 4 }}>📞 Shows in the Call Queue (due today unless you set a later date).</div>
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
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
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
