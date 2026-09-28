'use client';

import { useEffect } from 'react';
import { trackEvent } from '@/lib/attribution';
import { contactClickWasManual } from '@/lib/analytics';

/**
 * Site-wide tracking for phone and email link clicks.
 *
 * A tap on a `tel:` link is often the highest-intent action on a property site
 * — it just never shows up as a conversion, because it leaves no form and no
 * page view. These are the clicks that make the funnel look worse than it is.
 *
 * One delegated listener on the document rather than a handler on every link.
 * Phone and email links are scattered across the header, footer, sticky bar,
 * listing pages and every form's fallback line; instrumenting them one by one
 * would mean touching a dozen components and would silently miss the next one
 * somebody adds.
 *
 * PRIVACY. The destination recorded is the brokerage's own published phone
 * number or inbox — business contact details that are already on the page.
 * Nothing about the visitor is captured: no input values, no identifiers, and
 * no `mailto:` subject or body, which can carry free text.
 *
 * DOUBLE-COUNTING. About 11 of the site's ~92 phone/email links already report
 * themselves through analytics.ts (header, sticky bar, contact page, listing
 * pages). Those set a timestamp when they fire; this listener runs on the
 * bubble phase, sees the claim, and stays quiet. It therefore covers only the
 * ~80 links that had no tracking at all — which is the whole point of it.
 */
export default function ContactLinkTracker() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      try {
        const el = (e.target as HTMLElement | null)?.closest?.('a[href^="tel:"], a[href^="mailto:"]');
        if (!el) return;
        // A component already reported this click — don't count it twice.
        if (contactClickWasManual()) return;
        const href = el.getAttribute('href') ?? '';
        const isTel = href.startsWith('tel:');
        // Strip any ?subject=/&body= — that can contain free text.
        const destination = href.replace(/^(tel:|mailto:)/, '').split('?')[0];
        trackEvent(isTel ? 'phone_call' : 'email_click', {
          link_type: isTel ? 'tel' : 'mailto',
          destination,
          page_path: window.location.pathname,
        });
      } catch {
        // Never interfere with the click itself.
      }
    }
    // Bubble, not capture: the element's own onClick must run first so its
    // claim is visible here.
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return null;
}
