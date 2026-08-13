'use client';

import { useState, useEffect, useCallback } from 'react';

// ── Constants ────────────────────────────────────────────────────────────────

const TARGETS = {
  calls_block_days:   5,
  prospecting_calls:  125,
  conversations:      25,
  door_touches:       20,
  tours_meetings:     3,
  new_records:        25,
  opportunities_created: 2,
  pitch_appointments: 2,
  listings_won:       1,
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Types ────────────────────────────────────────────────────────────────────

interface DayLog {
  id?: string;
  log_date: string;
  calls_block_protected: boolean;
  prospecting_calls: number;
  conversations: number;
  door_touches: number;
  tours_meetings: number;
  notes: string;
  opportunities_created: number | null;
  pitch_appointments: number | null;
  listings_won: number | null;
  deals_closed: number | null;
}

interface AutoStat {
  new_records: number;
  tasks_done: number;
  tasks_overdue: number;
}

interface LaggingState {
  opportunities_created: string;
  pitch_appointments: string;
  listings_won: string;
  deals_closed: string;
}

interface Props {
  businessUnit: string;
  profileId: string;
  isAdmin: boolean;
  authHeaders: Record<string, string>;
  showToast: (msg: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

function getWeekDates(mondayStr: string): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmtWeekRange(mondayStr: string): string {
  const dates = getWeekDates(mondayStr);
  const start = new Date(dates[0] + 'T12:00:00Z');
  const end   = new Date(dates[6] + 'T12:00:00Z');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
}

function statusPill(actual: number, target: number) {
  const pct = target === 0 ? 100 : Math.round((actual / target) * 100);
  const bg   = pct >= 90 ? '#d1fae5' : pct >= 60 ? '#fef3c7' : '#fee2e2';
  const col  = pct >= 90 ? '#065f46' : pct >= 60 ? '#92400e' : '#991b1b';
  const label = pct >= 90 ? '✓ On Track' : pct >= 60 ? '⚠ Needs Work' : '✗ Off Track';
  return (
    <span style={{ display: 'inline-block', background: bg, color: col, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
      {label} ({pct}%)
    </span>
  );
}


function blankDay(date: string): DayLog {
  return {
    log_date: date,
    calls_block_protected: false,
    prospecting_calls: 0,
    conversations: 0,
    door_touches: 0,
    tours_meetings: 0,
    notes: '',
    opportunities_created: null,
    pitch_appointments: null,
    listings_won: null,
    deals_closed: null,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ActivitySection({ businessUnit, authHeaders, showToast }: Props) {
  const now = new Date();
  const todayStr   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [tab, setTab]         = useState<'log' | 'scorecard' | 'ratios'>('log');
  const [weekStart, setWeekStart] = useState(() => getMondayOf(todayStr));
  const [logs, setLogs]       = useState<Record<string, DayLog>>({});
  const [autoStats, setAutoStats] = useState<Record<string, AutoStat>>({});
  const [allLogs, setAllLogs] = useState<DayLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState<string | null>(null);   // date being saved
  const [editing, setEditing] = useState<string | null>(null);   // date row open for edit
  const [editForm, setEditForm] = useState<DayLog | null>(null);
  const [lagging, setLagging] = useState<LaggingState>({
    opportunities_created: '',
    pitch_appointments: '',
    listings_won: '',
    deals_closed: '',
  });
  const [laggingSaving, setLaggingSaving] = useState(false);

  const unit = businessUnit === 'residential' ? 'residential' : 'commercial';

  // ── Load week ──────────────────────────────────────────────────────────────
  const loadWeek = useCallback(async (ws: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/activity?unit=${unit}&week_start=${ws}`, { headers: authHeaders });
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, DayLog> = {};
      (data.logs ?? []).forEach((l: DayLog) => { map[l.log_date] = l; });
      setLogs(map);
      setAutoStats(data.auto_stats ?? {});
    } finally {
      setLoading(false);
    }
  }, [unit, authHeaders]);

  // ── Load all-time for ratios ───────────────────────────────────────────────
  const loadAllTime = useCallback(async () => {
    const res = await fetch(`/api/crm/activity?unit=${unit}&all=true`, { headers: authHeaders });
    if (!res.ok) return;
    const data = await res.json();
    setAllLogs(data.logs ?? []);
  }, [unit, authHeaders]);

  useEffect(() => { loadWeek(weekStart); }, [weekStart, loadWeek]);
  useEffect(() => { if (tab === 'ratios') loadAllTime(); }, [tab, loadAllTime]);

  // ── Week navigation ────────────────────────────────────────────────────────
  function shiftWeek(delta: number) {
    const d = new Date(weekStart + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + delta * 7);
    setWeekStart(d.toISOString().split('T')[0]);
    setEditing(null);
  }

  // ── Open edit row ──────────────────────────────────────────────────────────
  function openEdit(date: string) {
    setEditing(date);
    setEditForm({ ...(logs[date] ?? blankDay(date)) });
  }

  // ── Save one day ───────────────────────────────────────────────────────────
  async function saveDay(form: DayLog) {
    setSaving(form.log_date);
    try {
      const res = await fetch('/api/crm/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...form, business_unit: unit }),
      });
      if (!res.ok) { showToast('❌ Save failed'); return; }
      const { log } = await res.json();
      setLogs(prev => ({ ...prev, [log.log_date]: log }));
      setEditing(null);
      showToast('✅ Day logged');
    } finally {
      setSaving(null);
    }
  }

  // ── Save lagging indicator for a specific date ─────────────────────────────
  async function saveLagging(date: string) {
    setLaggingSaving(true);
    const existing = logs[date] ?? blankDay(date);
    const payload: DayLog = {
      ...existing,
      opportunities_created: lagging.opportunities_created !== '' ? Number(lagging.opportunities_created) : existing.opportunities_created,
      pitch_appointments:    lagging.pitch_appointments    !== '' ? Number(lagging.pitch_appointments)    : existing.pitch_appointments,
      listings_won:          lagging.listings_won          !== '' ? Number(lagging.listings_won)          : existing.listings_won,
      deals_closed:          lagging.deals_closed          !== '' ? Number(lagging.deals_closed)          : existing.deals_closed,
    };
    try {
      const res = await fetch('/api/crm/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...payload, business_unit: unit }),
      });
      if (!res.ok) { showToast('❌ Save failed'); return; }
      const { log } = await res.json();
      setLogs(prev => ({ ...prev, [log.log_date]: log }));
      showToast('✅ Lagging indicators saved');
      setLagging({ opportunities_created: '', pitch_appointments: '', listings_won: '', deals_closed: '' });
    } finally {
      setLaggingSaving(false);
    }
  }

  const weekDates = getWeekDates(weekStart);

  // ── Weekly totals ──────────────────────────────────────────────────────────
  const totals = weekDates.reduce((acc, d) => {
    const l = logs[d];
    const a = autoStats[d];
    return {
      calls_block_protected:  acc.calls_block_protected  + (l?.calls_block_protected ? 1 : 0),
      prospecting_calls:      acc.prospecting_calls      + (l?.prospecting_calls ?? 0),
      conversations:          acc.conversations          + (l?.conversations ?? 0),
      door_touches:           acc.door_touches           + (l?.door_touches ?? 0),
      tours_meetings:         acc.tours_meetings         + (l?.tours_meetings ?? 0),
      new_records:            acc.new_records            + (a?.new_records ?? 0),
      tasks_done:             acc.tasks_done             + (a?.tasks_done ?? 0),
      opportunities_created:  acc.opportunities_created  + (l?.opportunities_created ?? 0),
      pitch_appointments:     acc.pitch_appointments     + (l?.pitch_appointments ?? 0),
      listings_won:           acc.listings_won           + (l?.listings_won ?? 0),
      deals_closed:           acc.deals_closed           + (l?.deals_closed ?? 0),
    };
  }, {
    calls_block_protected: 0, prospecting_calls: 0, conversations: 0,
    door_touches: 0, tours_meetings: 0, new_records: 0, tasks_done: 0,
    opportunities_created: 0, pitch_appointments: 0, listings_won: 0, deals_closed: 0,
  });

  // ── All-time cumulative totals ─────────────────────────────────────────────
  const cumulative = allLogs.reduce((acc, l) => ({
    prospecting_calls:     acc.prospecting_calls     + (l.prospecting_calls ?? 0),
    conversations:         acc.conversations         + (l.conversations ?? 0),
    door_touches:          acc.door_touches          + (l.door_touches ?? 0),
    tours_meetings:        acc.tours_meetings        + (l.tours_meetings ?? 0),
    opportunities_created: acc.opportunities_created + (l.opportunities_created ?? 0),
    pitch_appointments:    acc.pitch_appointments    + (l.pitch_appointments ?? 0),
    listings_won:          acc.listings_won          + (l.listings_won ?? 0),
    deals_closed:          acc.deals_closed          + (l.deals_closed ?? 0),
  }), {
    prospecting_calls: 0, conversations: 0, door_touches: 0, tours_meetings: 0,
    opportunities_created: 0, pitch_appointments: 0, listings_won: 0, deals_closed: 0,
  });

  // ── Styles ────────────────────────────────────────────────────────────────
  const thStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', borderBottom: '2px solid #e2e8f0' };
  const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#1e293b', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };
  const tdRight: React.CSSProperties = { ...tdStyle, textAlign: 'right' };
  const inputStyle: React.CSSProperties = { width: 60, padding: '4px 6px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, textAlign: 'center' };
  const noteInput: React.CSSProperties = { width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 6 };
  const tabBase: React.CSSProperties = { padding: '8px 18px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, borderRadius: '8px 8px 0 0', transition: 'all .15s' };
  const tabActive: React.CSSProperties = { ...tabBase, background: '#fff', color: '#1e293b', borderBottom: '2px solid #c9922c' };
  const tabInactive: React.CSSProperties = { ...tabBase, background: 'transparent', color: '#94a3b8' };

  const isThisWeek = weekStart === getMondayOf(todayStr);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 0 40px', fontFamily: "'DM Sans', sans-serif", maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1e293b' }}>📊 Activity Log</h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>Track your weekly prospecting activity and performance metrics</p>
        </div>
        {/* Week navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => shiftWeek(-1)} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 15, color: '#475569' }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155', minWidth: 160, textAlign: 'center' }}>
            {isThisWeek ? '📅 This Week' : fmtWeekRange(weekStart)}
          </span>
          <button onClick={() => shiftWeek(1)} disabled={isThisWeek} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', cursor: isThisWeek ? 'not-allowed' : 'pointer', fontSize: 15, color: isThisWeek ? '#cbd5e1' : '#475569' }}>›</button>
          {!isThisWeek && (
            <button onClick={() => { setWeekStart(getMondayOf(todayStr)); setEditing(null); }} style={{ background: '#c9922c', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff' }}>Today</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e2e8f0', marginBottom: 0, display: 'flex', gap: 2 }}>
        <button style={tab === 'log' ? tabActive : tabInactive} onClick={() => setTab('log')}>📋 Daily Log</button>
        <button style={tab === 'scorecard' ? tabActive : tabInactive} onClick={() => setTab('scorecard')}>📊 Scorecard</button>
        <button style={tab === 'ratios' ? tabActive : tabInactive} onClick={() => { setTab('ratios'); loadAllTime(); }}>📐 Conversion Ratios</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>

        {/* ── TAB: Daily Log ── */}
        {tab === 'log' && (
          <div style={{ overflowX: 'auto' }}>
            {loading && <div style={{ padding: 20, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>Loading…</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={thStyle}>Day</th>
                  <th style={thStyle}>Date</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>📞 Block</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Calls</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Convos</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Doors</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Tours</th>
                  <th style={{ ...thStyle, textAlign: 'right', color: '#3b82f6' }}>Records*</th>
                  <th style={{ ...thStyle, textAlign: 'right', color: '#10b981' }}>Done*</th>
                  <th style={{ ...thStyle, textAlign: 'right', color: '#ef4444' }}>Overdue*</th>
                  <th style={thStyle}>Notes</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {weekDates.map((date, i) => {
                  const log  = logs[date];
                  const auto = autoStats[date] ?? { new_records: 0, tasks_done: 0, tasks_overdue: 0 };
                  const isToday  = date === todayStr;
                  const isEdit   = editing === date;
                  const rowBg    = isToday ? '#fffbeb' : i % 2 === 0 ? '#fff' : '#fafafa';
                  const isSaving = saving === date;

                  return (
                    <tr key={date} style={{ background: rowBg }}>
                      <td style={{ ...tdStyle, fontWeight: isToday ? 700 : 400, color: isToday ? '#c9922c' : '#64748b' }}>{DAYS[i]}</td>
                      <td style={{ ...tdStyle, fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                        {fmtDate(date)}{isToday && <span style={{ marginLeft: 4, fontSize: 10, background: '#c9922c', color: '#fff', borderRadius: 8, padding: '1px 5px', fontWeight: 700 }}>today</span>}
                      </td>

                      {isEdit && editForm ? (
                        <>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <input type="checkbox" checked={editForm.calls_block_protected} onChange={e => setEditForm(f => f ? { ...f, calls_block_protected: e.target.checked } : f)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                          </td>
                          {(['prospecting_calls','conversations','door_touches','tours_meetings'] as const).map(k => (
                            <td key={k} style={tdRight}>
                              <input type="number" min={0} value={editForm[k] ?? 0} onChange={e => setEditForm(f => f ? { ...f, [k]: Number(e.target.value) } : f)} style={inputStyle} />
                            </td>
                          ))}
                          <td style={{ ...tdRight, color: '#3b82f6' }}>{auto.new_records}</td>
                          <td style={{ ...tdRight, color: '#10b981' }}>{auto.tasks_done}</td>
                          <td style={{ ...tdRight, color: auto.tasks_overdue > 0 ? '#ef4444' : '#94a3b8' }}>{auto.tasks_overdue}</td>
                          <td style={tdStyle}>
                            <input type="text" value={editForm.notes} onChange={e => setEditForm(f => f ? { ...f, notes: e.target.value } : f)} style={{ ...noteInput, minWidth: 140 }} placeholder="Notes…" />
                          </td>
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                            <button onClick={() => saveDay(editForm)} disabled={isSaving} style={{ background: '#10b981', border: 'none', borderRadius: 6, padding: '5px 12px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 4 }}>
                              {isSaving ? '…' : 'Save'}
                            </button>
                            <button onClick={() => setEditing(null)} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: 12, cursor: 'pointer', color: '#64748b' }}>✕</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {log?.calls_block_protected ? <span title="Calls block protected">🟢</span> : <span style={{ color: '#e2e8f0' }}>○</span>}
                          </td>
                          <td style={tdRight}>{log?.prospecting_calls ?? <span style={{ color: '#e2e8f0' }}>—</span>}</td>
                          <td style={tdRight}>{log?.conversations ?? <span style={{ color: '#e2e8f0' }}>—</span>}</td>
                          <td style={tdRight}>{log?.door_touches ?? <span style={{ color: '#e2e8f0' }}>—</span>}</td>
                          <td style={tdRight}>{log?.tours_meetings ?? <span style={{ color: '#e2e8f0' }}>—</span>}</td>
                          <td style={{ ...tdRight, color: '#3b82f6', fontWeight: 600 }}>{auto.new_records > 0 ? auto.new_records : <span style={{ color: '#e2e8f0' }}>—</span>}</td>
                          <td style={{ ...tdRight, color: '#10b981', fontWeight: 600 }}>{auto.tasks_done > 0 ? auto.tasks_done : <span style={{ color: '#e2e8f0' }}>—</span>}</td>
                          <td style={{ ...tdRight, color: auto.tasks_overdue > 0 ? '#ef4444' : '#94a3b8', fontWeight: auto.tasks_overdue > 0 ? 700 : 400 }}>{auto.tasks_overdue > 0 ? auto.tasks_overdue : <span style={{ color: '#e2e8f0' }}>—</span>}</td>
                          <td style={{ ...tdStyle, fontSize: 12, color: '#64748b', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log?.notes || ''}</td>
                          <td style={tdStyle}>
                            <button onClick={() => openEdit(date)} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', color: '#475569' }}>Log</button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                  <td colSpan={2} style={{ ...tdStyle, fontWeight: 700, color: '#334155' }}>Weekly Total</td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{totals.calls_block_protected}<span style={{ fontSize: 11, color: '#94a3b8' }}>/7</span></td>
                  <td style={{ ...tdRight, fontWeight: 700 }}>{totals.prospecting_calls}</td>
                  <td style={{ ...tdRight, fontWeight: 700 }}>{totals.conversations}</td>
                  <td style={{ ...tdRight, fontWeight: 700 }}>{totals.door_touches}</td>
                  <td style={{ ...tdRight, fontWeight: 700 }}>{totals.tours_meetings}</td>
                  <td style={{ ...tdRight, fontWeight: 700, color: '#3b82f6' }}>{totals.new_records}</td>
                  <td style={{ ...tdRight, fontWeight: 700, color: '#10b981' }}>{totals.tasks_done}</td>
                  <td style={{ ...tdRight, fontWeight: 700, color: totals.tasks_done > 0 ? '#ef4444' : '#94a3b8' }}></td>
                  <td colSpan={2} style={tdStyle}></td>
                </tr>
              </tfoot>
            </table>
            <div style={{ padding: '8px 12px', fontSize: 11, color: '#94a3b8' }}>
              * Records, Done, Overdue are auto-pulled from the CRM and are read-only.
            </div>
          </div>
        )}

        {/* ── TAB: Scorecard ── */}
        {tab === 'scorecard' && (
          <div style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
              Week of {fmtWeekRange(weekStart)}
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 12, color: '#94a3b8' }}>Weekly targets vs. actual activity</p>

            {/* Leading indicators */}
            <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Leading Indicators</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 28 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={thStyle}>Metric</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Target</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actual</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>%</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: 'calls_block_days',  label: '📞 Call Block Days',     actual: totals.calls_block_protected },
                  { key: 'prospecting_calls', label: '📲 Prospecting Calls',   actual: totals.prospecting_calls },
                  { key: 'conversations',     label: '💬 Conversations',       actual: totals.conversations },
                  { key: 'door_touches',      label: '🚪 Door Touches',        actual: totals.door_touches },
                  { key: 'tours_meetings',    label: '🤝 Tours / Meetings',    actual: totals.tours_meetings },
                  { key: 'new_records',       label: '👤 New Records Added',   actual: totals.new_records },
                ].map(row => {
                  const target = TARGETS[row.key as keyof typeof TARGETS];
                  const pct = target === 0 ? 100 : Math.min(100, Math.round((row.actual / target) * 100));
                  return (
                    <tr key={row.key}>
                      <td style={tdStyle}>{row.label}</td>
                      <td style={tdRight}>{target}</td>
                      <td style={{ ...tdRight, fontWeight: 700 }}>{row.actual}</td>
                      <td style={tdRight}>{pct}%</td>
                      <td style={tdStyle}>{statusPill(row.actual, target)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Lagging indicators */}
            <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Lagging Indicators (Results)</h4>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8' }}>Enter weekly results — saves to today&apos;s log entry</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={thStyle}>Metric</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Target / Wk</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Logged This Wk</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Enter New</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: 'opportunities_created' as const, label: '🎯 Opportunities', target: TARGETS.opportunities_created, logged: totals.opportunities_created },
                  { key: 'pitch_appointments'    as const, label: '📅 Pitch Appts',   target: TARGETS.pitch_appointments,    logged: totals.pitch_appointments },
                  { key: 'listings_won'          as const, label: '🏆 Listings Won',  target: TARGETS.listings_won,          logged: totals.listings_won },
                  { key: 'deals_closed'          as const, label: '🤝 Deals Closed',  target: 1,                             logged: totals.deals_closed },
                ].map(row => (
                  <tr key={row.key}>
                    <td style={tdStyle}>{row.label}</td>
                    <td style={tdRight}>{row.target}</td>
                    <td style={{ ...tdRight, fontWeight: 700 }}>{row.logged}</td>
                    <td style={tdRight}>
                      <input
                        type="number" min={0}
                        value={lagging[row.key]}
                        onChange={e => setLagging(prev => ({ ...prev, [row.key]: e.target.value }))}
                        placeholder="—"
                        style={{ ...inputStyle, width: 60 }}
                      />
                    </td>
                    <td style={tdStyle}>{statusPill(row.logged, row.target)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={() => saveLagging(todayStr)}
              disabled={laggingSaving}
              style={{ background: '#c9922c', border: 'none', borderRadius: 8, padding: '8px 20px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              {laggingSaving ? 'Saving…' : '💾 Save Results'}
            </button>
          </div>
        )}

        {/* ── TAB: Conversion Ratios ── */}
        {tab === 'ratios' && (
          <div style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#1e293b' }}>Personal Conversion Physics</h3>
            <p style={{ margin: '0 0 20px', fontSize: 12, color: '#94a3b8' }}>All-time cumulative ratios — your personal prospecting "physics"</p>

            {allLogs.length === 0 && !loading && (
              <p style={{ color: '#94a3b8', fontSize: 13 }}>No data yet. Start logging daily activity to see your conversion ratios.</p>
            )}

            {/* Cumulative totals summary */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
              {[
                { label: 'Total Calls',    value: cumulative.prospecting_calls },
                { label: 'Conversations',  value: cumulative.conversations },
                { label: 'Door Touches',   value: cumulative.door_touches },
                { label: 'Tours',          value: cumulative.tours_meetings },
                { label: 'Opportunities',  value: cumulative.opportunities_created },
                { label: 'Pitch Appts',    value: cumulative.pitch_appointments },
                { label: 'Listings Won',   value: cumulative.listings_won },
                { label: 'Deals Closed',   value: cumulative.deals_closed },
              ].map(c => (
                <div key={c.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 16px', minWidth: 100, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b' }}>{c.value}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginTop: 2 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* Ratio table */}
            <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Conversion Funnel</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: 640 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={thStyle}>Stage</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>From</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>To</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Conversion %</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Calls → Conversations',    from: cumulative.prospecting_calls,     to: cumulative.conversations,         fromL: 'Calls',        toL: 'Convos'     },
                  { label: 'Calls → Door Touches',     from: cumulative.prospecting_calls,     to: cumulative.door_touches,          fromL: 'Calls',        toL: 'Doors'      },
                  { label: 'Convos → Opportunities',   from: cumulative.conversations,         to: cumulative.opportunities_created, fromL: 'Convos',       toL: 'Opps'       },
                  { label: 'Convos → Pitch Appts',     from: cumulative.conversations,         to: cumulative.pitch_appointments,    fromL: 'Convos',       toL: 'Pitches'    },
                  { label: 'Pitch Appts → Listings',   from: cumulative.pitch_appointments,    to: cumulative.listings_won,          fromL: 'Pitches',      toL: 'Listings'   },
                  { label: 'Tours → Deals Closed',     from: cumulative.tours_meetings,        to: cumulative.deals_closed,          fromL: 'Tours',        toL: 'Deals'      },
                  { label: 'Listings Won → Deals',     from: cumulative.listings_won,          to: cumulative.deals_closed,          fromL: 'Listings',     toL: 'Deals'      },
                  { label: 'Calls → Listings Won',     from: cumulative.prospecting_calls,     to: cumulative.listings_won,          fromL: 'Calls',        toL: 'Listings'   },
                ].map(row => {
                  const pct = row.from === 0 ? null : (row.to / row.from * 100).toFixed(1);
                  const bgColor = pct === null ? 'transparent' : Number(pct) >= 20 ? '#d1fae5' : Number(pct) >= 8 ? '#fef3c7' : '#fee2e2';
                  const textCol = pct === null ? '#94a3b8' : Number(pct) >= 20 ? '#065f46' : Number(pct) >= 8 ? '#92400e' : '#991b1b';
                  return (
                    <tr key={row.label}>
                      <td style={tdStyle}>{row.label}</td>
                      <td style={tdRight}>{row.from.toLocaleString()} {row.fromL}</td>
                      <td style={tdRight}>{row.to.toLocaleString()} {row.toL}</td>
                      <td style={{ ...tdRight, fontWeight: 700 }}>
                        {pct === null
                          ? <span style={{ color: '#94a3b8' }}>—</span>
                          : <span style={{ display: 'inline-block', background: bgColor, color: textCol, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{pct}%</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ marginTop: 24, padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, fontSize: 12, color: '#92400e' }}>
              <strong>How to read this:</strong> These are your personal conversion ratios built from all logged activity. Use them to back-calculate how many calls you need to hit your listing or deal goal. Example: if calls → listings = 2%, you need 50 calls per listing.
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
