'use client';

import React, { useState } from 'react';

/**
 * A long, rarely-needed section of a card. On a phone it is a single tappable row ("Email Campaigns · 2 active ▾") until
 * opened; everywhere else it renders its children untouched. Opening shows the section exactly as before plus a "Hide" row.
 */
export default function PhoneFold({ label, hint, isMobile, foldOnDesktop = false, children }: { label: string; hint?: string; isMobile: boolean; /** Fold it on a computer too (a section that is usually not what you came for). */ foldOnDesktop?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!isMobile && !foldOnDesktop) return <>{children}</>;
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: isMobile ? 48 : 40, padding: '0 14px', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, background: 'var(--k-f9fafb)', color: 'var(--k-374151)', fontSize: 14, fontWeight: 600, textAlign: 'left', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false} style={row}>
        <span style={{ flex: 1, minWidth: 0 }}>{label}{hint ? <span style={{ marginLeft: 8, fontWeight: 500, color: 'var(--k-9ca3af)', fontSize: 13 }}>{hint}</span> : null}</span>
        <span aria-hidden style={{ color: 'var(--k-9ca3af)' }}>▾</span>
      </button>
    );
  }
  return (
    <div>
      {children}
      <button type="button" onClick={() => setOpen(false)} aria-expanded style={{ ...row, justifyContent: 'center', marginTop: -8, background: 'var(--k-fff)', fontWeight: 500, fontSize: 13, color: 'var(--k-6b7280)' }}>Hide {label} ▴</button>
    </div>
  );
}
