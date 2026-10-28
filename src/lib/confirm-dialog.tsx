'use client';

import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

// An in-page replacement for window.confirm(): same one-line call, but it looks like the rest of the CRM, works as a
// sheet on a phone, and never freezes the page (a native confirm blocks every script — and any automation — until it
// is clicked). Usage:  if (!(await confirmDialog('Discard this draft?', { confirmLabel: 'Discard', danger: true }))) return;

type Opts = { confirmLabel?: string; cancelLabel?: string; danger?: boolean };

function Dialog({ message, opts, done }: { message: string; opts: Opts; done: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done]);
  const mobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const btn: React.CSSProperties = { minHeight: mobile ? 46 : 38, padding: '0 18px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", border: 'none' };
  return (
    <div role="alertdialog" aria-modal="true" aria-label={message} onClick={() => done(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: mobile ? 'flex-end' : 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', color: '#111', width: '100%', maxWidth: 400, borderRadius: mobile ? '16px 16px 0 0' : 14, padding: '20px 20px calc(18px + env(safe-area-inset-bottom))', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.45, marginBottom: 18, fontFamily: "'DM Sans',sans-serif" }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button ref={cancelRef} type="button" onClick={() => done(false)} style={{ ...btn, background: '#f3f4f6', color: '#374151' }}>{opts.cancelLabel ?? 'Cancel'}</button>
          <button type="button" onClick={() => done(true)} style={{ ...btn, background: opts.danger ? '#dc2626' : '#c9922c', color: '#fff' }}>{opts.confirmLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

export function confirmDialog(message: string, opts: Opts = {}): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const done = (ok: boolean) => { if (settled) return; settled = true; root.unmount(); host.remove(); resolve(ok); };
    root.render(<Dialog message={message} opts={opts} done={done} />);
  });
}
