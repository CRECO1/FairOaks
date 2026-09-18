/**
 * CRECO Google review request — email template.
 *
 * Branded for CRECO - Commercial Real Estate Company (crecotx.com colours:
 * --primary-dark #1A1A1A, --gold-primary #C9A962, --cream #FAF8F5), and built
 * to the same structure as the CRM's other transactional emails: dark header
 * bar, short body, single gold call-to-action, plain-text fallback link, and a
 * NAP footer.
 *
 * The template is deliberately pure — it renders a string and sends nothing.
 * Callers (the campaign runner, or the per-client review-request route) own the
 * sending.
 */

/** The verified Google Business Profile review link for CRECO. */
export const CRECO_REVIEW_URL = 'https://g.page/r/CcthffUy7ZABEBM/review';

export const CRECO_SENDER = 'CRECO - Commercial Real Estate Company <info@crecotx.com>';
export const CRECO_ADDRESS = '8000 Fair Oaks Pkwy, Suite 100, Fair Oaks Ranch, TX 78015';
export const CRECO_PHONE = '(210) 817-3443';

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ReviewEmailOptions {
  /** Recipient's first name. Falls back to a neutral greeting. */
  firstName?: string | null;
  /**
   * What to reference — the property, suite or deal, e.g.
   * "the lease at 7830 Louis Pasteur". Kept generic when unknown, because a
   * wrong reference is worse than no reference.
   */
  dealReference?: string | null;
  /** Who signs off. Defaults to the broker/owner. */
  signerName?: string;
  /** Override for testing; defaults to the verified GBP link. */
  reviewUrl?: string;
  /** Optional one-click unsubscribe URL, appended to the footer when present. */
  unsubscribeUrl?: string | null;
}

export function reviewEmailSubject(): string {
  return 'A quick favour — 60 seconds for a Google review?';
}

export function renderReviewEmail(opts: ReviewEmailOptions = {}): string {
  const {
    firstName,
    dealReference,
    signerName = 'Zachary Stovall',
    reviewUrl = CRECO_REVIEW_URL,
    unsubscribeUrl = null,
  } = opts;

  const greeting = firstName ? `Hi ${esc(firstName)},` : 'Hello,';
  // No invented specifics: without a known deal we simply say "working with you".
  const workedOn = dealReference
    ? `working with you on ${esc(dealReference)}`
    : 'working with you';

  return `
<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">

  <!-- Header -->
  <div style="background:#1A1A1A;padding:26px 32px">
    <p style="margin:0;font-size:21px;font-weight:700;color:#ffffff;letter-spacing:2px">CRECO</p>
    <p style="margin:4px 0 0;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#C9A962">
      Commercial Real Estate Company
    </p>
  </div>

  <!-- Body -->
  <div style="padding:32px 32px 26px">
    <p style="margin:0 0 18px;font-size:16px;color:#1A1A1A;line-height:1.5">${greeting}</p>

    <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.65">
      It was a pleasure ${workedOn}. If you have 60 seconds, a quick Google review
      would mean a lot — it genuinely helps other businesses in San Antonio find us.
    </p>

    <p style="margin:0 0 26px;font-size:15px;color:#4b5563;line-height:1.65">
      Even a line about the type of deal and the city is a real help to the next
      tenant or owner deciding who to call.
    </p>

    <!-- CTA -->
    <div style="text-align:center;margin:0 0 22px">
      <a href="${esc(reviewUrl)}"
         style="display:inline-block;background:#C9A962;color:#1A1A1A;text-decoration:none;padding:15px 34px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.3px">
        Leave a Google Review
      </a>
    </div>

    <!-- Plain-text fallback for clients that strip buttons -->
    <p style="margin:0 0 26px;font-size:12px;color:#9ca3af;line-height:1.6;text-align:center;word-break:break-all">
      Button not working? Paste this into your browser:<br/>
      <a href="${esc(reviewUrl)}" style="color:#A68B4B">${esc(reviewUrl)}</a>
    </p>

    <p style="margin:0 0 4px;font-size:15px;color:#4b5563;line-height:1.6">Thank you —</p>
    <p style="margin:0;font-size:15px;color:#4b5563;line-height:1.6">
      <strong style="color:#1A1A1A">${esc(signerName)}</strong><br/>
      CRECO - Commercial Real Estate Company<br/>
      <a href="tel:+12108173443" style="color:#A68B4B;text-decoration:none">${CRECO_PHONE}</a>
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#FAF8F5;padding:16px 32px;border-top:1px solid #e5e7eb">
    <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6">
      ${CRECO_ADDRESS} ·
      <a href="https://www.crecotx.com" style="color:#9ca3af">crecotx.com</a>${
        unsubscribeUrl
          ? `<br/><a href="${esc(unsubscribeUrl)}" style="color:#9ca3af">Unsubscribe from CRECO emails</a>`
          : ''
      }
    </p>
  </div>
</div>`.trim();
}
