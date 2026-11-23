'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// An in-app replacement for window.confirm. The browser's own dialog freezes the page — an automated browser (or a person with the tab in
// the background) can't see or answer it, and it can't say what will actually happen. This one is awaited like confirm() but is part of the page.
//
//   const { ask, dialog } = useConfirm();
//   if (!(await ask({ title: 'Delete this draft?', body: '…', ok: 'Delete', danger: true }))) return;
//   …render {dialog} once in the component's tree…
export interface ConfirmOptions { title: string; body?: React.ReactNode; ok?: string; cancel?: string; danger?: boolean }

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current?.(false);          // a second question replaces the first rather than leaving it hanging
    resolver.current = resolve; setOpts(o);
  }), []);
  const finish = useCallback((v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null); }, []);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!opts) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [opts, finish]);
  useEffect(() => () => { resolver.current?.(false); }, []);

  // Drop-in for window.confirm(message): the first paragraph is the title, anything after a blank line is the explanation. Destructive wording
  // ("delete", "permanently", "cannot be undone") makes the button red without every caller having to say so.
  const confirm = useCallback((message: string, o: { ok?: string; danger?: boolean } = {}) => {
    const [title, ...rest] = message.split('\n\n');
    return ask({ title, body: rest.length ? <>{rest.join('\n\n').split('\n').map((l, i) => <div key={i}>{l}</div>)}</> : undefined,
      ok: o.ok, danger: o.danger ?? /delet|permanent|destroy|cannot be undone|remove/i.test(message) });
  }, [ask]);

  const dialog = opts ? (
    <div role="alertdialog" aria-modal="true" aria-label={opts.title} onClick={e => { if (e.target === e.currentTarget) finish(false); }}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(17,24,39,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, padding: '20px 22px', boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#111', marginBottom: opts.body ? 8 : 16 }}>{opts.title}</div>
        {opts.body && <div style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.55, marginBottom: 18 }}>{opts.body}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button ref={cancelRef} onClick={() => finish(false)}
            style={{ minHeight: 44, padding: '0 18px', fontSize: 14, fontWeight: 700, borderRadius: 9, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', cursor: 'pointer' }}>{opts.cancel ?? 'Cancel'}</button>
          <button onClick={() => finish(true)}
            style={{ minHeight: 44, padding: '0 18px', fontSize: 14, fontWeight: 800, borderRadius: 9, border: 'none', background: opts.danger ? '#dc2626' : '#c9922c', color: '#fff', cursor: 'pointer' }}>{opts.ok ?? 'OK'}</button>
        </div>
      </div>
    </div>
  ) : null;
  return { ask, confirm, dialog };
}
