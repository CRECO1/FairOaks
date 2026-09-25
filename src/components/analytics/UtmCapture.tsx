'use client';

/**
 * Mount-once attribution capture. No UI — an invisible side effect that keeps
 * the first-party attribution cookie current so any form submitted later can
 * say where the visitor actually came from.
 *
 * Mounted from the root layout so it fires on every page load, including deep
 * links straight onto a listing or the valuation page (which is where paid
 * traffic usually lands, not the homepage).
 *
 * Re-runs on pathname/searchParams changes: a visitor who lands on /listings
 * with no utm, then hits /?utm_source=google, gets the campaign captured on
 * that second view.
 *
 * Skipped on /crm and /manage — those are the authenticated app, not the
 * marketing site, and a logged-in agent clicking around should never overwrite
 * a real visitor's stored attribution.
 */

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { captureAttribution } from '@/lib/attribution';

const EXCLUDED_PREFIXES = ['/crm', '/manage'];

export default function UtmCapture() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (EXCLUDED_PREFIXES.some(p => (pathname ?? '').startsWith(p))) return;
    captureAttribution();
  }, [pathname, searchParams]);

  return null;
}
