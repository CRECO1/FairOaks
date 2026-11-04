'use client';

import type { ReactNode } from 'react';

/** Shared full-screen frame + button styles for the live editors (documents and spreadsheets). */

const COLORS = ['#c9922c', '#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#4f46e5'];
export const colorFor = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; };

export function Frame({ isMobile, children }: { isMobile: boolean; children: ReactNode }) {
  return (
    <div role="dialog" aria-label="Document" style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', background: 'var(--k-f3f4f6)', paddingTop: isMobile ? 'env(safe-area-inset-top, 0px)' : 0 }}>
      {children}
    </div>
  );
}

export const btnStyle = (isMobile: boolean): React.CSSProperties => ({ height: isMobile ? 40 : 32, padding: isMobile ? '0 10px' : '0 14px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", flexShrink: 0 });
export const iconBtn = (isMobile: boolean): React.CSSProperties => ({ width: isMobile ? 40 : 34, height: isMobile ? 40 : 34, border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--k-374151)', cursor: 'pointer', flexShrink: 0 });
