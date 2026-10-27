'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The agent's own shortlist (starred Property DB properties), shared by the Property DB and Matchmaker tabs.
 *
 * Saved on the server per agent (crm_property_shortlist, via /api/crm/property-shortlist) so it follows them
 * between desktop and phone. If that table does not exist yet the API answers `setup_needed` and the list is
 * kept in localStorage on this device instead, so starring always works.
 *
 * A star toggles instantly; if the server refuses, it flips back and says so.
 */
const LOCAL_KEY = 'crm:propdb:shortlist:v1';

export function usePropertyShortlist(authToken: string | undefined, onToast: (msg: string) => void) {
  const [shortlist, setShortlist] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<'loading' | 'server' | 'local'>('loading');
  const headersRef = useRef<Record<string, string>>({});
  const h: Record<string, string> = {};
  if (authToken) h.Authorization = `Bearer ${authToken}`;
  headersRef.current = h;
  const toastRef = useRef(onToast); toastRef.current = onToast;

  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/crm/property-shortlist', { headers: headersRef.current });
        const j = await r.json();
        if (cancelled) return;
        if (r.ok && !j.setup_needed) { setShortlist(new Set<string>(j.ids ?? [])); setMode('server'); return; }
      } catch { /* fall through to this device's list */ }
      if (cancelled) return;
      try { setShortlist(new Set<string>(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'))); } catch { /* none yet */ }
      setMode('local');
    })();
    return () => { cancelled = true; };
  }, [authToken]);

  useEffect(() => {
    if (mode !== 'local') return;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify([...shortlist])); } catch { /* storage blocked */ }
  }, [shortlist, mode]);

  const setStars = useCallback(async (ids: string[], on: boolean) => {
    const before = shortlist;
    setShortlist(prev => { const n = new Set(prev); ids.forEach(i => (on ? n.add(i) : n.delete(i))); return n; });
    if (mode !== 'server') return;
    try {
      const r = await fetch('/api/crm/property-shortlist', { method: 'POST', headers: { ...headersRef.current, 'Content-Type': 'application/json' }, body: JSON.stringify({ property_ids: ids, on }) });
      if (!r.ok) throw new Error();
    } catch {
      setShortlist(before);
      toastRef.current('Could not update your shortlist — try again.');
    }
  }, [shortlist, mode]);

  const toggleStar = useCallback((id: string) => { void setStars([id], !shortlist.has(id)); }, [setStars, shortlist]);

  return { shortlist, setStars, toggleStar, mode };
}
