'use client';

/** Charts for spreadsheets: a small SVG renderer (bar / line / pie) and the dialog that sets one up. */

import { useState } from 'react';
import type { ChartDef } from '@/lib/drive-sheet';
import { Modal } from './SheetParts';

export const SERIES_COLORS = ['#c9922c', '#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#4f46e5'];

export interface ChartData { labels: string[]; series: Array<{ name: string; values: number[] }> }

const niceMax = (v: number) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const fmtNum = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100));

export function ChartSvg({ type, data, w, h }: { type: ChartDef['type']; data: ChartData; w: number; h: number }) {
  const { labels, series } = data;
  if (!labels.length || !series.length) return <div style={{ padding: 16, fontSize: 13, color: 'var(--k-9ca3af)' }}>Nothing to chart in that range — pick cells with numbers.</div>;
  const legendH = series.length > 1 && type !== 'pie' ? 22 : 0;
  if (type === 'pie') {
    const vals = series[0].values.map(v => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = w * 0.35, cy = h / 2, r = Math.min(w * 0.3, h / 2 - 12);
    let a0 = -Math.PI / 2;
    return (
      <svg width={w} height={h} role="img" aria-label="Pie chart">
        {vals.map((v, i) => {
          const a1 = a0 + (v / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
          const d = v / total >= 0.9999 ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z` : `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
          a0 = a1;
          return <path key={i} d={d} fill={SERIES_COLORS[i % SERIES_COLORS.length]} stroke="#fff" strokeWidth={1}><title>{`${labels[i]}: ${fmtNum(v)} (${Math.round((v / total) * 100)}%)`}</title></path>;
        })}
        {labels.slice(0, 10).map((l, i) => (
          <g key={i} transform={`translate(${w * 0.68}, ${18 + i * 18})`}>
            <rect width={10} height={10} rx={2} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
            <text x={15} y={9} fontSize={11} fill="#374151">{short(l, 18)} · {Math.round((vals[i] / total) * 100)}%</text>
          </g>
        ))}
      </svg>
    );
  }
  const padL = 46, padR = 12, padT = 10 + legendH, padB = 34;
  const pw = Math.max(10, w - padL - padR), ph = Math.max(10, h - padT - padB);
  const all = series.flatMap(s => s.values);
  const lo = Math.min(0, ...all), hi = niceMax(Math.max(...all, 0)), span = hi - lo || 1;
  const y = (v: number) => padT + ph - ((v - lo) / span) * ph;
  const n = labels.length, step = pw / n;
  const ticks = [0, 1, 2, 3, 4].map(i => lo + (span * i) / 4);
  const every = Math.ceil(n / Math.max(1, Math.floor(pw / 56)));
  return (
    <svg width={w} height={h} role="img" aria-label={type === 'bar' ? 'Bar chart' : 'Line chart'}>
      {series.length > 1 && series.map((s, i) => (
        <g key={i} transform={`translate(${padL + i * 110}, 4)`}><rect width={10} height={10} rx={2} fill={SERIES_COLORS[i % SERIES_COLORS.length]} /><text x={15} y={9} fontSize={11} fill="#374151">{short(s.name, 14)}</text></g>
      ))}
      {ticks.map((t, i) => <g key={i}><line x1={padL} x2={padL + pw} y1={y(t)} y2={y(t)} stroke="#e5e7eb" /><text x={padL - 6} y={y(t) + 4} fontSize={10.5} textAnchor="end" fill="#6b7280">{fmtNum(t)}</text></g>)}
      {labels.map((l, i) => (i % every === 0 ? <text key={i} x={padL + step * i + step / 2} y={h - 12} fontSize={10.5} textAnchor="middle" fill="#6b7280">{short(l, Math.max(4, Math.floor((step * every) / 6.5)))}</text> : null))}
      {type === 'bar' && series.map((s, si) => s.values.map((v, i) => {
        const bw = Math.max(2, (step * 0.7) / series.length), x = padL + step * i + step * 0.15 + si * bw;
        return <rect key={`${si}-${i}`} x={x} y={Math.min(y(v), y(0))} width={bw} height={Math.abs(y(v) - y(0))} fill={SERIES_COLORS[si % SERIES_COLORS.length]} rx={2}><title>{`${labels[i]} · ${s.name}: ${fmtNum(v)}`}</title></rect>;
      }))}
      {type === 'line' && series.map((s, si) => (
        <g key={si}>
          <polyline fill="none" stroke={SERIES_COLORS[si % SERIES_COLORS.length]} strokeWidth={2} points={s.values.map((v, i) => `${padL + step * i + step / 2},${y(v)}`).join(' ')} />
          {s.values.map((v, i) => <circle key={i} cx={padL + step * i + step / 2} cy={y(v)} r={3} fill={SERIES_COLORS[si % SERIES_COLORS.length]}><title>{`${labels[i]} · ${s.name}: ${fmtNum(v)}`}</title></circle>)}
        </g>
      ))}
      <line x1={padL} x2={padL} y1={padT} y2={padT + ph} stroke="#d1d5db" />
    </svg>
  );
}

const field = { height: 34, border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '0 10px', fontSize: 13.5, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)', boxSizing: 'border-box' as const };
const lab = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--k-6b7280)', margin: '10px 0 4px' };

export function ChartDialog({ initial, rangeText, onSave, onClose }: { initial?: ChartDef; rangeText: string; onSave: (v: { type: ChartDef['type']; title: string; range: string; hdr: boolean }) => string | null; onClose: () => void }) {
  const [type, setType] = useState<ChartDef['type']>(initial?.type ?? 'bar');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [range, setRange] = useState(rangeText);
  const [hdr, setHdr] = useState(initial?.hdr ?? true);
  const [err, setErr] = useState('');
  return (
    <Modal title={initial ? 'Edit chart' : 'Insert chart'} onClose={onClose}>
      <label style={lab}>Chart type</label>
      <select value={type} onChange={e => setType(e.target.value as ChartDef['type'])} style={{ ...field, width: '100%' }}><option value="bar">Column chart</option><option value="line">Line chart</option><option value="pie">Pie chart</option></select>
      <label style={lab}>Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Optional" style={{ ...field, width: '100%' }} />
      <label style={lab}>Data range (first column = labels, other columns = values)</label>
      <input value={range} onChange={e => setRange(e.target.value)} placeholder="A1:C10" style={{ ...field, width: '100%' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, marginTop: 10 }}><input type="checkbox" checked={hdr} onChange={e => setHdr(e.target.checked)} /> First row is a header</label>
      {err && <div style={{ color: 'var(--k-dc2626)', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" onClick={onClose} style={{ height: 34, padding: '0 14px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', cursor: 'pointer', fontWeight: 600, fontSize: 13.5 }}>Cancel</button>
        <button type="button" onClick={() => { const e = onSave({ type, title, range, hdr }); if (e) setErr(e); else onClose(); }} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: '#c9922c', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>{initial ? 'Save' : 'Insert'}</button>
      </div>
    </Modal>
  );
}
