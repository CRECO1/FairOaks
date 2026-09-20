import { permanentRedirect } from 'next/navigation';

/**
 * /what-is-my-home-worth → /home-valuation
 *
 * The phrase sellers actually type, as a URL. A redirect rather than a second
 * page: two URLs serving the same content would compete with each other, and
 * /home-valuation is the canonical one.
 */
export default function WhatIsMyHomeWorth(): never {
  permanentRedirect('/home-valuation');
}
