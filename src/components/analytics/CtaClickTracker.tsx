'use client';

import { useEffect } from 'react';
import { trackCTA, ctaClickWasManual } from '@/lib/analytics';

/**
 * Site-wide tracking for clicks on primary conversion CTAs.
 *
 * Matched by DESTINATION rather than by wiring each button. The public site has
 * ~281 links pointing at the conversion pages and only three of them reported
 * anything; instrumenting them individually would mean editing dozens of files
 * and would silently miss every button added afterwards. Keying on where a link
 * GOES means a new "Talk to an Agent" button is tracked the day it ships, with
 * no extra step for whoever adds it.
 *
 * Only destinations that represent intent are listed. Navigation around the
 * marketing site (/about, /faq, a neighbourhood guide) is a page view, not a
 * conversion, and counting it as a CTA would bury the signal.
 *
 * DOUBLE-COUNTING. The Header already calls trackCTA directly. Those calls
 * stamp a timestamp; this listener runs on the bubble phase, sees the claim and
 * stays quiet, so the same click is never counted twice.
 *
 * PRIVACY. The label is the button's own marketing copy and the destination is
 * an internal path. Nothing typed by the visitor is read, and tel:/mailto:
 * links are skipped here because ContactLinkTracker owns those.
 */
const CTA_DESTINATIONS: { prefix: string; label: string }[] = [
  { prefix: '/home-valuation',        label: 'home-valuation' },
  { prefix: '/what-is-my-home-worth', label: 'home-valuation' },
  { prefix: '/contact',               label: 'contact' },
  { prefix: '/quiz',                  label: 'quiz' },
  { prefix: '/sell',                  label: 'sell' },
  { prefix: '/listings',              label: 'listings' },
  { prefix: '/homes-for-sale',        label: 'homes-for-sale' },
  { prefix: '/team',                  label: 'team' },
  { prefix: '/join',                  label: 'join' },
];

/** Longest prefix wins, so /listings/123 is a listing, not the index. */
function destinationFor(pathname: string): string | null {
  let best: string | null = null;
  let bestLen = 0;
  for (const d of CTA_DESTINATIONS) {
    if ((pathname === d.prefix || pathname.startsWith(d.prefix + '/')) && d.prefix.length > bestLen) {
      best = d.label; bestLen = d.prefix.length;
    }
  }
  return best;
}

export default function CtaClickTracker() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      try {
        const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute('href') ?? '';
        // ContactLinkTracker owns these; in-page anchors are not conversions.
        if (/^(tel:|mailto:|#)/.test(href)) return;
        if (ctaClickWasManual()) return;

        // Resolve relative hrefs, and ignore anything leaving the site.
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return;

        const dest = destinationFor(url.pathname);
        if (!dest) return;

        // The button's own copy, not anything the visitor typed.
        const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || dest;

        trackCTA({ text, location: window.location.pathname, destination: dest });
      } catch {
        // Never interfere with the navigation itself.
      }
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return null;
}
