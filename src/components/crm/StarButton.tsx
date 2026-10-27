'use client';

import React from 'react';

/** ★ / ☆ shortlist toggle. 44px on a phone; never triggers the row/card underneath it. */
export default function StarButton({ on, onToggle, size = 32, floating = false }: { on: boolean; onToggle: () => void; size?: number; floating?: boolean }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onToggle(); }} aria-pressed={on}
      aria-label={on ? 'Remove from shortlist' : 'Add to shortlist'} title={on ? 'On your shortlist — click to remove' : 'Add to your shortlist'}
      style={{
        width: size, height: size, flexShrink: 0, border: floating ? '1px solid rgba(0,0,0,.06)' : 'none', borderRadius: floating ? '50%' : 8,
        background: on ? 'var(--k-fdf0d5)' : floating ? 'rgba(255,255,255,.92)' : 'transparent',
        color: on ? '#c9922c' : floating ? '#6b7280' : '#c4c9d0', fontSize: size >= 40 ? 22 : 18, lineHeight: 1, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      }}>
      {on ? '★' : '☆'}
    </button>
  );
}
