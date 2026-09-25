/**
 * Lead attribution for the fairoaksrealtygroup.com marketing site.
 *
 * Why this exists: every FORG lead landed in the CRM with no idea what brought
 * it — 0 of 28 leads carried a utm, referrer or landing page. GA4 is on the
 * site (AnalyticsScripts), but GA can only tell us "sessions by channel"; it
 * cannot tell us that *this named person* came from *that campaign*. For
 * per-lead attribution the signal has to ride along with the form POST and be
 * stored next to the lead.
 *
 * Three pieces, mirroring the mechanism already proven on crecotx.com:
 *
 *   1. captureAttribution()  — call on every navigation. Reads utm_* from the
 *      URL plus the referrer, merges with whatever is already stored and
 *      persists to a first-party cookie for 30 days. Last-touch on referrer,
 *      first-touch preserved on utm_* (a utm only gets overwritten by a newer
 *      utm, never cleared by a plain internal navigation).
 *
 *   2. readAttribution()     — call from a form handler before POSTing. Returns
 *      the stored payload so the caller can spread it into the request body.
 *
 *   3. trackEvent()          — fires a GA4 event, and mirrors lead submits to
 *      GA4's standard `generate_lead` so the "Generate leads" reports populate.
 *      Those reports key off that exact event name; our descriptive names
 *      (contact_form_submitted, …) would otherwise never count as leads.
 *
 * Privacy: no PII in the cookie — utm_* + referrer + landing_page only, first
 * party, 30-day TTL, no cross-site sync.
 */

const COOKIE_NAME = 'forg_attr';
const COOKIE_TTL_DAYS = 30;
const MAX_FIELD = 200;

export interface LeadAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landing_page?: string;
}

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/**
 * Form submits that represent a lead. Each also emits GA4 `generate_lead`.
 * Keep in sync with the `source` values the forms post.
 */
const LEAD_EVENTS = new Set<string>([
  'contact_form_submitted',
  'valuation_form_submitted',
  'listing_inquiry_submitted',
  'showing_request_submitted',
]);

/** Read the stored attribution payload. Safe in SSR and against junk cookies. */
export function readAttribution(): LeadAttribution {
  if (typeof document === 'undefined') return {};
  try {
    const match = document.cookie.split('; ').find(c => c.startsWith(`${COOKIE_NAME}=`));
    if (!match) return {};
    const raw = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LeadAttribution) : {};
  } catch {
    return {};
  }
}

/**
 * Capture utm_* + referrer + landing_page into the cookie. Idempotent and
 * cheap — safe to call on every route change.
 */
export function captureAttribution(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const incoming: LeadAttribution = {};
    let hasAnyUtm = false;

    for (const k of UTM_KEYS) {
      const v = params.get(k);
      if (v) { incoming[k] = v.slice(0, MAX_FIELD); hasAnyUtm = true; }
    }

    // Referrer only when it's genuinely off-site: an internal hop would
    // otherwise overwrite the real acquisition source with our own domain.
    if (document.referrer && !document.referrer.includes(window.location.host)) {
      incoming.referrer = document.referrer.slice(0, MAX_FIELD);
    }
    incoming.landing_page = window.location.pathname.slice(0, MAX_FIELD);

    const existing = readAttribution();
    const merged: LeadAttribution = { ...existing, ...incoming };

    // No new utm on this view? Keep the landing page from the original
    // campaign visit so the journey's entry point isn't lost to a later
    // internal navigation.
    if (!hasAnyUtm && existing.landing_page) merged.landing_page = existing.landing_page;

    const value = encodeURIComponent(JSON.stringify(merged));
    const maxAge = COOKIE_TTL_DAYS * 24 * 60 * 60;
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    // Attribution must never break a page render.
  }
}

/** Fire a GA4 event; mirrors lead submits to `generate_lead`. Never throws. */
export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { gtag?: (...a: unknown[]) => void; dataLayer?: unknown[] };
  try {
    if (typeof w.gtag === 'function') {
      w.gtag('event', name, params);
      if (LEAD_EVENTS.has(name)) w.gtag('event', 'generate_lead', { lead_source: name, ...params });
    } else if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push({ event: name, ...params });
      if (LEAD_EVENTS.has(name)) w.dataLayer.push({ event: 'generate_lead', lead_source: name, ...params });
    }
  } catch {
    // Analytics must never break the form.
  }
}

/**
 * Everything a form should send so the lead is attributable: the stored
 * utm/referrer payload plus the page it was submitted from and the viewport
 * (the server turns the viewport + user-agent into a device label).
 */
export function attributionPayload(surface?: string): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  return {
    ...readAttribution(),
    page_path: window.location.pathname.slice(0, MAX_FIELD),
    page_url: window.location.href.slice(0, 500),
    page_title: (typeof document !== 'undefined' ? document.title : '').slice(0, 200),
    viewport_width: window.innerWidth,
    ...(surface ? { surface } : {}),
  };
}
