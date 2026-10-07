'use client';
/**
 * Remember what's open inside a CRM page so a refresh puts you back on it.
 *
 * The URL hash already restores the page (#calls, #properties…), but everything
 * opened inside a page — a property workspace, a contact card, a campaign — lived
 * only in React state, so a refresh dropped you back on the page's list. These
 * helpers keep that in sessionStorage: per browser tab, survives a refresh, gone
 * when the tab closes (so a new tab starts clean).
 */
import { useEffect, useRef, useState } from 'react';

const PREFIX = 'crm:view:';

export function recallView(key: string): string | null {
  try { return sessionStorage.getItem(PREFIX + key); } catch { return null; }
}

export function rememberView(key: string, value: string | null | undefined): void {
  try {
    if (value) sessionStorage.setItem(PREFIX + key, value);
    else sessionStorage.removeItem(PREFIX + key);
  } catch { /* private mode / storage blocked: refresh just won't restore */ }
}

/** useState for a small enum (a tab, a filter) that survives a refresh. */
export function useRememberedState<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    const saved = recallView(key) as T | null;
    return saved && allowed.includes(saved) ? saved : initial;
  });
  useEffect(() => { rememberView(key, value); }, [key, value]);
  return [value, setValue] as const;
}

/**
 * Remember which item is open (by id) and reopen it after a refresh.
 *
 *   currentId — the id of what's open now (null when nothing is)
 *   ready     — true once the list the item lives in has loaded
 *   restore   — reopen the item by id (find it in the list, call the page's own open function)
 *
 * Nothing is written until the restore has had its chance, so the empty first
 * render can't wipe the saved id before the list arrives.
 */
export function useRememberedSelection(key: string, currentId: string | null | undefined, ready: boolean, restore: (id: string) => void): void {
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !ready) return;
    restored.current = true;
    const id = recallView(key);
    if (id && !currentId) restore(id);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (restored.current) rememberView(key, currentId ?? null);
  }, [key, currentId]);
}
