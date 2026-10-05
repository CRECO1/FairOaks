/**
 * Every lead form's success state is /thank-you, so a conversion is one page view
 * on one URL in GA4 and the ad platforms, whatever form produced it. ?form= tailors
 * the copy; ?from= lets a listing inquiry link back to the home it was about.
 *
 * The form's own trackEvent (and its generate_lead mirror) still fires before the
 * redirect, so nothing double-counts and no event is lost.
 */

export const THANK_YOU_FORMS = ['contact', 'valuation', 'listing', 'showing', 'quiz'] as const;
export type ThankYouForm = (typeof THANK_YOU_FORMS)[number];

/** Only a listing detail path is accepted as ?from= — never an arbitrary URL. */
export function safeListingPath(path: string | null | undefined): string | null {
  return path && /^\/listings\/[A-Za-z0-9-]{1,200}$/.test(path) ? path : null;
}

export function thankYouPath(form: ThankYouForm, from?: string): string {
  const q = new URLSearchParams({ form });
  const back = safeListingPath(from);
  if (back) q.set('from', back);
  return `/thank-you?${q.toString()}`;
}
