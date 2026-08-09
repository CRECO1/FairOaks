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

type StatusKey   = keyof typeof STATUS_CFG;
type PriorityKey = keyof typeof PRIORITY_CFG;
type ViewMode    = 'table' | 'board';

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
  const [view, setView] = useState<ViewMode>('table');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true });
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

  const todayStr = today();

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

  async function handleQuickAdd(status: StatusKey) {
    if (!quickAddTitle.trim()) { setQuickAddGroup(null); return; }
    const task = await apiCreateTask({ title: quickAddTitle.trim(), status, priority: 'normal' });
    if (task) {
      onTasksChange([task, ...tasks]);
      showToast('Task created ✓');
    }
    setQuickAddTitle('');
    setQuickAddGroup(null);
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
  const filtered = tasks.filter(t => {
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (assigneeFilter && t.assigned_to !== assigneeFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const profileById = Object.fromEntries(profiles.map(p => [p.id, p]));
  const overdueCt = tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < todayStr).length;

  // ── Table Row ────────────────────────────────────────────────────────────
  function TableRow({ task: t }: { task: Task }) {
    const isOverdue = t.status !== 'done' && t.due_date && t.due_date < todayStr;
    const assignee = t.assignee ?? profileById[t.assigned_to ?? ''];
    const contact = t.client ?? clients.find(c => c.id === t.client_id);
    return (
      <div onClick={() => setDetailTask(t)}
        style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr auto auto' : '1fr 120px 120px 100px 130px', gap: 0, alignItems: 'center', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', transition: 'background .12s' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        {/* Task name */}
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <button title="Mark done" onClick={e => { e.stopPropagation(); handleUpdateTask(t.id, { status: t.status === 'done' ? 'open' : 'done' }); }}
            style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 4, border: `2px solid ${t.status === 'done' ? '#22c55e' : '#d1d5db'}`, background: t.status === 'done' ? '#22c55e' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {t.status === 'done' && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
          </button>
          <span style={{ fontSize: 13, fontWeight: 500, color: t.status === 'done' ? '#9ca3af' : '#111', textDecoration: t.status === 'done' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.title}
          </span>
          {isOverdue && !isMobile && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '1px 6px', borderRadius: 6 }}>OVERDUE</span>}
        </div>
        {/* Assignee */}
        {!isMobile && (
          <div style={{ padding: '10px 12px' }}>
            <Avatar profile={assignee} />
          </div>
        )}
        {/* Status */}
        <div style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
          <StatusPill value={t.status} onChange={v => handleUpdateTask(t.id, { status: v })} />
        </div>
        {/* Priority */}
        {!isMobile && (
          <div style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
            <PriorityPill value={t.priority} onChange={v => handleUpdateTask(t.id, { priority: v })} />
          </div>
        )}
        {/* Due date + contact */}
        {!isMobile && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: isOverdue ? '#dc2626' : '#6b7280', fontWeight: isOverdue ? 700 : 400 }}>
            {contact ? (
              <button onClick={e => { e.stopPropagation(); const full = clients.find(c => c.id === t.client_id); setContactPopup(full ?? null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f1f5f9', border: 'none', borderRadius: 6, padding: '2px 7px', marginBottom: 4, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", maxWidth: '100%' }}>
                <span style={{ fontSize: 11 }}>👤</span>
                <span style={{ fontSize: 11, color: '#374151', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.first_name} {contact.last_name}</span>
              </button>
            ) : null}
            {t.due_date ? <span>📅 {fmtDate(t.due_date)}</span> : <span style={{ color: '#d1d5db' }}>No date</span>}
          </div>
        )}
      </div>
    );
  }

  // ── Quick-add row ─────────────────────────────────────────────────────────
  function QuickAddRow({ status }: { status: StatusKey }) {
    return quickAddGroup === status ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid #f3f4f6', background: '#fafbff' }}>
        <div style={{ width: 16, height: 16, borderRadius: 4, border: '2px solid #d1d5db', flexShrink: 0 }} />
        <input ref={quickAddRef} autoFocus value={quickAddTitle}
          onChange={e => setQuickAddTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(status); if (e.key === 'Escape') setQuickAddGroup(null); }}
          onBlur={() => { if (!quickAddTitle.trim()) setQuickAddGroup(null); }}
          placeholder="Task name…"
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: '#111', background: 'transparent', fontFamily: "'DM Sans',sans-serif" }} />
        <button onClick={() => handleQuickAdd(status)}
          style={{ padding: '3px 12px', borderRadius: 6, background: '#c9922c', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          Add
        </button>
        <button onClick={() => setQuickAddGroup(null)}
          style={{ padding: '3px 8px', borderRadius: 6, background: '#f3f4f6', color: '#6b7280', border: 'none', fontSize: 12, cursor: 'pointer' }}>
          ✕
        </button>
      </div>
    ) : (
      <button onClick={() => { setQuickAddGroup(status); setQuickAddTitle(''); }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 12, fontFamily: "'DM Sans',sans-serif', textAlign: 'left'" }}
        onMouseEnter={e => { e.currentTarget.style.background = '#f9fafb'; e.currentTarget.style.color = '#6b7280'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}>
        <span style={{ fontSize: 14 }}>+</span> Add task
      </button>
    );
  }

  // ── TABLE VIEW ───────────────────────────────────────────────────────────
  function TableView() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {GROUP_CFG.map(grp => {
          const groupTasks = filtered.filter(t => t.status === grp.key);
          const isCollapsed = collapsed[grp.key] ?? grp.defaultOpen === false;
          return (
            <div key={grp.key} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
              {/* Group header */}
              <div onClick={() => setCollapsed(c => ({ ...c, [grp.key]: !isCollapsed }))}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: '#fafafa', borderBottom: isCollapsed ? 'none' : '1px solid #f0f0f0', userSelect: 'none' }}>
                <div style={{ width: 4, height: 22, borderRadius: 3, background: grp.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111', fontFamily: "'DM Sans',sans-serif" }}>{grp.label}</span>
                <span style={{ fontSize: 12, color: '#9ca3af', background: '#f3f4f6', borderRadius: 10, padding: '1px 8px', fontWeight: 600 }}>{groupTasks.length}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>{isCollapsed ? '▶' : '▼'}</span>
              </div>

              {!isCollapsed && (
                <>
                  {/* Column headers */}
                  {!isMobile && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 100px 130px', borderBottom: '1px solid #f3f4f6', background: '#fafafa' }}>
                      {['Task', 'Assignee', 'Status', 'Priority', 'Due / Contact'].map(h => (
                        <div key={h} style={{ padding: '6px 14px', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700 }}>{h}</div>
                      ))}
                    </div>
                  )}

                  {groupTasks.length === 0 && quickAddGroup !== grp.key && (
                    <div style={{ padding: '18px 14px', color: '#d1d5db', fontSize: 13, fontStyle: 'italic' }}>
                      No {grp.label.toLowerCase()} tasks
                    </div>
                  )}

                  {groupTasks.map(t => <TableRow key={t.id} task={t} />)}
                  <QuickAddRow status={grp.key as StatusKey} />
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── BOARD VIEW ────────────────────────────────────────────────────────────
  function BoardView() {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 14, alignItems: 'start' }}>
        {GROUP_CFG.map(grp => {
          const groupTasks = filtered.filter(t => t.status === grp.key);
          return (
            <div key={grp.key} style={{ background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              {/* Column header */}
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '3px solid ' + grp.color }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: grp.color, display: 'inline-block' }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#111', fontFamily: "'DM Sans',sans-serif" }}>{grp.label}</span>
                <span style={{ fontSize: 11, color: '#9ca3af', background: '#fff', borderRadius: 10, padding: '1px 7px', fontWeight: 600, marginLeft: 'auto' }}>{groupTasks.length}</span>
              </div>

              {/* Cards */}
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {groupTasks.map(t => {
                  const isOverdue = t.status !== 'done' && t.due_date && t.due_date < todayStr;
                  const assignee = t.assignee ?? profileById[t.assigned_to ?? ''];
                  const pc = PRIORITY_CFG[t.priority];
                  return (
                    <div key={t.id} onClick={() => setDetailTask(t)}
                      style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', border: `1px solid ${isOverdue ? '#fecaca' : '#e5e7eb'}`, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.04)', transition: 'box-shadow .15s, transform .1s' }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,.1)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.04)'; e.currentTarget.style.transform = 'none'; }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.status === 'done' ? '#9ca3af' : '#111', textDecoration: t.status === 'done' ? 'line-through' : 'none', marginBottom: 8, lineHeight: 1.4 }}>
                        {t.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                        <span style={{ ...pc, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" } as React.CSSProperties}>
                          {pc.label}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t.due_date && <span style={{ fontSize: 11, color: isOverdue ? '#dc2626' : '#9ca3af', fontWeight: isOverdue ? 700 : 400 }}>📅 {fmtDate(t.due_date)}</span>}
                          <Avatar profile={assignee} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Board quick-add */}
                {quickAddGroup === grp.key ? (
                  <div style={{ background: '#fff', borderRadius: 10, padding: '10px 12px', border: '2px solid #c9922c' }}>
                    <input ref={quickAddRef} autoFocus value={quickAddTitle}
                      onChange={e => setQuickAddTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(grp.key as StatusKey); if (e.key === 'Escape') setQuickAddGroup(null); }}
                      placeholder="Task name… (Enter to add)"
                      style={{ width: '100%', border: 'none', outline: 'none', fontSize: 13, color: '#111', fontFamily: "'DM Sans',sans-serif", background: 'transparent' }} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => handleQuickAdd(grp.key as StatusKey)}
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
                )}
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

  // ── Render ────────────────────────────────────────────────────────────────
  const openCt   = tasks.filter(t => t.status === 'open').length;
  const inProgCt = tasks.filter(t => t.status === 'in_progress').length;
  const doneCt   = tasks.filter(t => t.status === 'done').length;

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {/* View toggle */}
        <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
          {(['table', 'board'] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '5px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'all .15s',
                background: view === v ? '#fff' : 'transparent',
                color: view === v ? '#111' : '#6b7280',
                boxShadow: view === v ? '0 1px 4px rgba(0,0,0,.1)' : 'none' }}>
              {v === 'table' ? '☰ Table' : '⊞ Board'}
            </button>
          ))}
        </div>

        {/* Search */}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search tasks…"
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

        <button onClick={() => setShowNewModal(true)}
          style={{ marginLeft: 'auto', padding: '8px 18px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
          + New Task
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Open',        val: openCt,        color: '#3b82f6' },
          { label: 'In Progress', val: inProgCt,       color: '#f59e0b' },
          { label: 'Overdue',     val: overdueCt,      color: '#ef4444' },
          { label: 'Done',        val: doneCt,         color: '#22c55e' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', border: '1px solid #e5e7eb', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 3, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', lineHeight: 1 }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Main view */}
      {tasksLoading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
          Loading tasks…
        </div>
      ) : view === 'table' ? <TableView /> : <BoardView />}

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
