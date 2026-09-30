/**
 * Append UTM params to on-domain links in a campaign email body at SEND time, so
 * GA4 attributes a click to the Email channel and the specific campaign instead of
 * lumping it into "direct". Done at send (not in the composer) so it applies to
 * every campaign uniformly and the stored email_body stays clean/editable.
 *
 * Only absolute links to the domains WE own are rewritten. Deliberately skipped:
 *  - the unsubscribe link (must never carry marketing UTM),
 *  - /api/ endpoints (the open pixel and any click-tracking redirect),
 *  - external links (not ours to attribute),
 *  - links a composer already UTM-tagged by hand (respect the author's intent).
 *
 * The original URL string is preserved exactly (UTM is appended, the URL is not
 * re-parsed/re-encoded), so an existing query string or #fragment is untouched.
 */

const OWNED_HOST = /^(?:www\.)?(?:crecotx\.com|fairoaksrealtygroup\.com|elkhornpoint\.com)$/i;

/** "Quarterly Market Report" -> "quarterly-market-report" — the utm_campaign value. */
export function campaignSlug(name?: string | null, id?: string | null): string {
  const s = (name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || (id ? `id-${String(id).slice(0, 8)}` : 'campaign');
}

export function tagCampaignLinks(html: string, utmCampaign: string): string {
  if (!html) return html;
  const campaign = encodeURIComponent(utmCampaign || 'campaign');
  return html.replace(/href=(["'])(https?:\/\/[^"'\s>]+)\1/gi, (match, quote: string, url: string) => {
    let host: string, path: string;
    try {
      const u = new URL(url);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return match; // unparseable — leave it alone
    }
    if (!OWNED_HOST.test(host)) return match;                    // only domains we own
    if (/(^|\/)unsubscribe(\/|$)/i.test(path)) return match;     // never tag unsubscribe
    if (path.startsWith('/api/')) return match;                  // skip pixel / click-tracking
    if (/[?&]utm_[a-z]+=/i.test(url)) return match;              // respect a hand-tagged link

    const hashIdx = url.indexOf('#');
    const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const frag = hashIdx >= 0 ? url.slice(hashIdx) : '';
    const sep = base.includes('?') ? '&' : '?';
    return `href=${quote}${base}${sep}utm_source=email&utm_medium=email&utm_campaign=${campaign}${frag}${quote}`;
  });
}
