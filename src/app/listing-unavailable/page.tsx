import type { Metadata } from 'next';

/**
 * Body for the 410 Gone that middleware returns on /listings/<slug> when the
 * listing has left the MLS feed. Middleware fetches this page and re-serves its
 * HTML under the dead URL with status 410, so visitors still get the "no longer
 * on the market" page with active alternatives and the get-matched form.
 * Not linked anywhere and never indexed.
 */
export const revalidate = 1800;

export const metadata: Metadata = {
  title: 'Listing No Longer Available',
  robots: { index: false, follow: true },
};

export { default } from '../listings/[slug]/not-found';
