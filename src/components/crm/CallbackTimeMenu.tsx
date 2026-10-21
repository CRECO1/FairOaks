'use client';
// "When should this call-back remind you?" — the popover on the Calling Log's 🔔 button.
// Four quick picks, a Custom date + time, or flag it with no time (the team's 30-minute /
// 2-hour reminders then apply). Times are Central.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { callbackPresets, customToIso, formatCentral, TIME_SLOTS, tomorrowCentral, MAX_DAYS_AHEAD } from '@/lib/callback-time';
import { chicagoToday } from '@/lib/chicago-time';

interface Props {
  onPick: (iso: string | null) => void;   // null = flag without a time
  onClose: () => void;
  busy?: boolean;
}

const item: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 7, padding: '8px 10px', fontSize: 13, fontWeight: 600, color: '#111', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
const field: React.CSSProperties = { boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans',sans-serif", minHeight: 32 };

export default function CallbackTimeMenu({ onPick, onClose, busy }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState(() => tomorrowCentral());
  const [time, setTime] = useState('09:00');
  const presets = useMemo(() => callbackPresets(), []);
  const today = chicagoToday();
  const maxDate = useMemo(() => new Date(Date.now() + MAX_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10), []);

  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [onClose]);

  const customIso = customToIso(date, time);
  const customOk = !!customIso && new Date(customIso).getTime() > Date.now() + 60_000;

  return (
    <div ref={ref} role="menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 40, width: 270, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.14)', padding: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#c9922c', padding: '6px 10px 4px' }}>Remind me to call back</div>
      {presets.map(p => (
        <button key={p.key} role="menuitem" disabled={busy} onClick={() => onPick(p.iso)} style={item} onMouseEnter={e => (e.currentTarget.style.background = '#fffdf6')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
          <span>{p.label}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>{formatCentral(p.iso).replace(' CT', '')}</span>
        </button>
      ))}
      <button role="menuitem" onClick={() => setCustom(v => !v)} style={{ ...item, color: '#a06a12' }} onMouseEnter={e => (e.currentTarget.style.background = '#fffdf6')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
        <span>📅 Custom…</span><span style={{ fontSize: 11 }}>{custom ? '▴' : '▾'}</span>
      </button>
      {custom && (
        <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="date" value={date} min={today} max={maxDate} onChange={e => setDate(e.target.value)} style={{ ...field, flex: '1 1 0', minWidth: 0 }} aria-label="Call-back date" />
            <select value={time} onChange={e => setTime(e.target.value)} style={{ ...field, flex: '0 0 auto' }} aria-label="Call-back time">
              {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11.5, color: customOk ? '#6b7280' : '#b91c1c' }}>{customIso ? (customOk ? formatCentral(customIso) : 'Pick a time in the future') : 'Pick a date'}</div>
          <button disabled={busy || !customOk} onClick={() => customIso && onPick(customIso)} style={{ background: customOk ? '#c9922c' : '#e5e7eb', color: customOk ? '#fff' : '#9ca3af', border: 'none', borderRadius: 7, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: customOk ? 'pointer' : 'default', fontFamily: "'DM Sans',sans-serif" }}>Set call-back</button>
        </div>
      )}
      <div style={{ borderTop: '1px solid #f1f1f1', margin: '4px 0' }} />
      <button role="menuitem" disabled={busy} onClick={() => onPick(null)} style={{ ...item, fontWeight: 500, color: '#6b7280' }} title="No chosen time — the team's 30-minute and 2-hour reminders apply" onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
        <span>Flag without a time</span>
      </button>
    </div>
  );
}
