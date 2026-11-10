'use client';

import React, { useState } from 'react';

// "Call" on a contact card or a deal card. One tap dials the default number; the ▾ lists every number we have for the person
// (cell, business line…) with a phone and a text button on each. Phone links are plain tel: links, so the CRM's
// "How did the call go?" prompt appears after a call exactly as it does for any other call button.

export interface CallNumber { label: string; num: string }

const digits = (v: string) => v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
export function phoneShow(v?: string | null): string {
  const s = (v ?? '').trim();
  const d = digits(s);
  return d.length === 10 && !/ext|x\d/i.test(s) ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s;
}

export default function CallSplit({ numbers, isMobile, variant, mainStyle, caretStyle, onText }: {
  /** In display order. A row with an empty number shows as "Not on file". Duplicates (same digits) are shown once. */
  numbers: CallNumber[];
  isMobile: boolean;
  /** 'tile' = the gold block in a card's action row; 'pill' = the outlined pill in a dark header. */
  variant: 'tile' | 'pill';
  mainStyle: React.CSSProperties;
  caretStyle?: React.CSSProperties;
  /** Called with the number the person chose to text; the caller opens its text box. */
  onText?: (num: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const seen = new Set<string>();
  const rows = numbers.filter(n => { const d = digits(n.num); if (!d) return true; if (seen.has(d)) return false; seen.add(d); return true; });
  const have = rows.filter(n => n.num.trim());
  const def = have[0]?.num.trim() ?? '';
  const size = isMobile ? 44 : 36;
  const gold = '#c9922c';
  const solid = variant === 'tile';
  const row = (n: CallNumber, i: number) => (
    <div key={n.label + i} role="menuitem" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i > 0 ? '1px solid var(--k-f0f0f0)' : undefined, opacity: n.num.trim() ? 1 : 0.5 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', color: 'var(--k-9ca3af)' }}>{n.label}{n.num.trim() && n.num.trim() === def && have.length > 1 ? <span style={{ marginLeft: 6, color: gold }}>· default</span> : null}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: n.num.trim() ? 'var(--k-111)' : 'var(--k-9ca3af)', marginTop: 1 }}>{n.num.trim() ? phoneShow(n.num) : 'Not on file'}</div>
      </div>
      {n.num.trim() && (
        <>
          <a href={`tel:${n.num.trim()}`} onClick={() => setOpen(false)} aria-label={`Call ${n.label} ${phoneShow(n.num)}`}
            style={{ width: size, height: size, borderRadius: size / 2, background: gold, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', fontSize: 16 }}>📞</a>
          {onText && (
            <button type="button" onClick={() => { setOpen(false); onText(n.num.trim()); }} aria-label={`Text ${n.label} ${phoneShow(n.num)}`} title="Text from the office line"
              style={{ width: size, height: size, borderRadius: size / 2, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', cursor: 'pointer', fontSize: 15, padding: 0 }}>💬</button>
          )}
        </>
      )}
    </div>
  );
  const off: React.CSSProperties = { opacity: 0.38, pointerEvents: 'none' };
  return (
    <div style={{ display: 'inline-flex', position: 'relative', flex: solid ? 1 : undefined, minWidth: 0 }}>
      <a href={def ? `tel:${def}` : undefined} aria-label={def ? `Call ${phoneShow(def)}` : 'No phone on file'}
        style={{ ...mainStyle, ...(solid ? { flex: 1 } : {}), borderRadius: solid ? '10px 0 0 10px' : '17px 0 0 17px', ...(def ? {} : off) }}>📞 Call</a>
      <button type="button" onClick={() => setOpen(v => !v)} aria-haspopup="menu" aria-expanded={open} aria-label="Choose which number to call or text" title="Cell and business line"
        style={{ width: solid ? (isMobile ? 44 : 34) : 30, flexShrink: 0, border: solid ? `1px solid ${gold}` : '1px solid rgba(255,255,255,.55)', borderLeft: solid ? '1px solid rgba(255,255,255,.45)' : '1px solid rgba(255,255,255,.3)', borderRadius: solid ? '0 10px 10px 0' : '0 17px 17px 0',
          background: solid ? gold : 'transparent', color: '#fff', fontSize: 11, cursor: 'pointer', ...caretStyle, ...(def ? {} : off) }}>▾</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div role="menu" style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 41, width: isMobile ? 'min(300px, calc(100vw - 28px))' : 290, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,.2)', overflow: 'hidden', color: 'var(--k-111)', textAlign: 'left' }}>
            {rows.map(row)}
          </div>
        </>
      )}
    </div>
  );
}
