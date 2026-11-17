'use client';
// One upload queue + tray for every screen: each file shows Uploading (with %) → Saved, or the plain-language reason it failed
// with Retry / Dismiss. Failures stay on screen until dismissed (a toast would vanish). One bad file never stops the others.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { prepareUpload, reportUploadFailure } from '@/lib/upload-client';
import type { UploadProfileKey } from '@/lib/upload-rules';

export type UpState = 'queued' | 'working' | 'done' | 'failed';
export interface UpItem { ctx?: unknown; headline?: string; id: number; name: string; size: number; state: UpState; pct: number; stage?: string; note?: string; error?: string; retryable: boolean }
/** What a screen's own upload step returns. `stage` says where it broke (for the failure log). */
export type UpResult = { ok: true; note?: string; headline?: string } | { ok: false; error: string; stage?: 'start' | 'send' | 'save' };
export type UpRunner = (file: File, h: { setPct: (n: number) => void; ctx?: unknown }) => Promise<UpResult>;

const mb = (n: number) => (n === 0 ? '0 KB' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function useUploadQueue({ profile, target, run, authToken, onAllDone }: {
  profile: UploadProfileKey; target: string; run: UpRunner; authToken?: string; onAllDone?: (savedCount: number) => void;
}) {
  const [items, setItems] = useState<UpItem[]>([]);
  const files = useRef(new Map<number, File>());
  const ctxs = useRef(new Map<number, unknown>());   // what the screen looked like when the file was added (e.g. which folder)
  const nextId = useRef(1);
  const working = useRef(false);
  const saved = useRef(0);
  const runRef = useRef(run); runRef.current = run;
  const doneRef = useRef(onAllDone); doneRef.current = onAllDone;
  const patch = useCallback((id: number, p: Partial<UpItem>) => setItems(a => a.map(i => (i.id === id ? { ...i, ...p } : i))), []);

  const queue = useRef<number[]>([]);   // ids waiting their turn, oldest first
  const pump = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    try {
      while (queue.current.length) {
        const id = queue.current.shift()!;
        const file = files.current.get(id);
        if (!file) continue;   // dismissed while waiting
        patch(id, { state: 'working', pct: 0, error: undefined });
        let res: UpResult;
        try { res = await runRef.current(file, { setPct: n => patch(id, { pct: n }), ctx: ctxs.current.get(id) }); }
        catch { res = { ok: false, error: 'Upload failed — check your connection and try again.', stage: 'send' }; }
        if (res.ok) { saved.current += 1; setItems(a => a.map(i => (i.id === id ? { ...i, state: 'done', pct: 100, headline: res.headline, note: res.note ?? i.note } : i))); files.current.delete(id); }
        else {
          patch(id, { state: 'failed', error: res.error, retryable: true });
          reportUploadFailure({ target, name: file.name, size: file.size, stage: res.stage ?? 'send', message: res.error }, authToken);
        }
      }
    } finally {
      working.current = false;
      if (saved.current) { const n = saved.current; saved.current = 0; doneRef.current?.(n); }
    }
  }, [patch, target, authToken]);

  const add = useCallback(async (list: FileList | File[] | null, ctx?: unknown) => {
    const picked = Array.from(list ?? []).map(original => ({ original, id: nextId.current++ }));
    // Every file gets its row at once (so nothing seems to vanish), then they are checked side by side:
    // a slow HEIC conversion never holds up the PDFs picked with it.
    setItems(a => [...a, ...picked.map(({ original, id }) => ({ id, ctx, name: original.name, size: original.size, state: 'queued' as const, pct: 0, stage: 'checking', retryable: false }))]);
    await Promise.all(picked.map(async ({ original, id }) => {
      const prep = await prepareUpload(original, profile);
      if (prep.error) {
        patch(id, { state: 'failed', error: prep.error, retryable: false, stage: undefined });
        reportUploadFailure({ target, name: original.name, size: original.size, stage: isConvertError(prep.error) ? 'convert' : 'precheck', message: prep.error }, authToken);
        return;
      }
      files.current.set(id, prep.file);
      ctxs.current.set(id, ctx);
      patch(id, { name: prep.file.name, size: prep.file.size, note: prep.converted ? 'converted to JPG' : undefined, stage: undefined });
      queue.current.push(id);
      void pump();
    }));
  }, [profile, target, authToken, patch, pump]);

  const retry = useCallback((id: number) => { if (!files.current.has(id)) return; patch(id, { state: 'queued', error: undefined }); queue.current.push(id); void pump(); }, [patch, pump]);
  const dismiss = useCallback((id: number) => { files.current.delete(id); queue.current = queue.current.filter(x => x !== id); setItems(a => a.filter(i => i.id !== id)); }, []);
  const clearFinished = useCallback(() => setItems(a => a.filter(i => i.state === 'queued' || i.state === 'working')), []);
  // Saved files tidy themselves away after a few seconds; failures never do.
  useEffect(() => {
    const t = items.filter(i => i.state === 'done').map(i => setTimeout(() => setItems(a => a.filter(x => x.id !== i.id)), 6000));
    return () => t.forEach(clearTimeout);
  }, [items]);
  const busy = items.some(i => i.state === 'queued' || i.state === 'working' || i.stage === 'checking');
  return { items, add, retry, dismiss, clearFinished, busy };
}
const isConvertError = (m: string) => /HEIC/.test(m);

export function UploadTray({ items, onRetry, onDismiss }: { items: UpItem[]; onRetry: (id: number) => void; onDismiss: (id: number) => void }) {
  if (!items.length) return null;
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
      {items.map(i => (
        <div key={i.id} style={{ border: `1px solid ${i.state === 'failed' ? '#fca5a5' : i.state === 'done' ? '#bbf7d0' : '#e5e7eb'}`, background: i.state === 'failed' ? '#fef2f2' : i.state === 'done' ? '#f0fdf4' : '#fff', borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden style={{ fontSize: 16 }}>{i.state === 'failed' ? '⚠️' : i.state === 'done' ? '✅' : '📄'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#111', overflowWrap: 'anywhere' }}>{i.name} <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>{mb(i.size)}</span></div>
              <div style={{ fontSize: 12.5, color: i.state === 'failed' ? '#b91c1c' : '#6b7280', overflowWrap: 'anywhere' }}>
                {i.state === 'queued' ? (i.stage === 'checking' ? 'Checking…' : 'Waiting…')
                  : i.state === 'working' ? (i.pct >= 99 ? 'Saving…' : `Uploading… ${i.pct}%`)
                  : i.state === 'done' ? `${i.headline ?? 'Saved'}${i.note ? ` — ${i.note}` : ''}`
                  : i.error}
              </div>
            </div>
            {i.state === 'failed' && i.retryable && <button onClick={() => onRetry(i.id)} style={{ minHeight: 32, padding: '0 12px', border: '1px solid #b91c1c', color: '#b91c1c', background: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Retry</button>}
            {(i.state === 'failed' || i.state === 'done') && <button aria-label={`Dismiss ${i.name}`} onClick={() => onDismiss(i.id)} style={{ minHeight: 32, minWidth: 32, border: 0, background: 'transparent', color: '#6b7280', fontSize: 18, cursor: 'pointer' }}>×</button>}
          </div>
          {i.state === 'working' && (
            <div style={{ height: 4, borderRadius: 2, background: '#e5e7eb', marginTop: 6, overflow: 'hidden' }}>
              <div style={{ width: `${i.pct}%`, height: '100%', background: '#c9922c', transition: 'width .2s' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
