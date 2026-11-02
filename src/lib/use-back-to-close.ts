'use client';

import { useEffect, useRef } from 'react';

// Which cards currently hold a history entry (so a card closing can tell whether another one was opened in the same breath).
const live = new Set<string>();

/**
 * Phones: make the back swipe / back button close an open card (or sheet) instead of leaving the CRM.
 * While `isOpen`, one history entry is pushed that carries `key`; popping it calls `onClose`. Closing the card some other
 * way (its ✕) pops that entry again so the history doesn't pile up — unless another card was opened at the same moment
 * (contact → deal), in which case the entry is left alone: a queued back step would otherwise land on the NEW card's entry
 * and close it. The entry keeps Next.js's own history state, which Next needs to recognise the step (it reloads the page on a
 * back step it doesn't recognise). Only the card whose marker disappeared reacts, so a card opened over another closes alone.
 */
export function useBackToClose(isOpen: boolean, onClose: () => void, key: string, enabled: boolean) {
  const pushed = useRef(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const on = enabled && isOpen;
  useEffect(() => {
    if (on && !pushed.current) { pushed.current = true; live.add(key); window.history.pushState({ ...(window.history.state ?? {}), [key]: 1 }, ''); }
    else if (!on && pushed.current) {
      pushed.current = false; live.delete(key);
      setTimeout(() => {
        const st = window.history.state;
        if (st?.[key] && ![...live].some(k => st?.[k])) window.history.back();
      }, 0);
    }
  }, [on, key]);
  useEffect(() => {
    if (!enabled) return;
    const onPop = () => { if (pushed.current && !window.history.state?.[key]) { pushed.current = false; live.delete(key); closeRef.current(); } };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [enabled, key]);
}
