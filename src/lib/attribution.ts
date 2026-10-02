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
  'home_inline_submitted',
  'listing_alert_submitted',
]);

/** Set once any lead event fires in this browser (read by ListingSignupPrompt). */
export const LEAD_SEEN_KEY = 'forg_lead_seen';

/**
 * The page trail for THIS visit — sessionStorage, per tab. On a lead it answers
 * "what did they look at, and how long were they here before submitting". Kept
 * out of the attribution cookie on purpose: a cookie rides on every request and
 * is size-capped, whereas a visit journey belongs in sessionStorage and only
 * ever gets spread into a form POST. Every accessor is wrapped — analytics must
 * never break a render.
 */
export interface JourneyStep { p: string; t: number }

const JOURNEY_KEY = 'forg_journey';
const JOURNEY_T0_KEY = 'forg_journey_t0';
const JOURNEY_MAX_STEPS = 30;

/** First-view timestamp for this visit, created once and reused. */
function journeyStart(): number {
  try {
    const raw = sessionStorage.getItem(JOURNEY_T0_KEY);
    const prev = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(prev)) return prev;
    const now = Date.now();
    sessionStorage.setItem(JOURNEY_T0_KEY, String(now));
    return now;
  } catch { return Date.now(); }
}

function readJourney(): JourneyStep[] {
  try {
    const raw = sessionStorage.getItem(JOURNEY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is JourneyStep => !!s && typeof s.p === 'string' && typeof s.t === 'number')
      : [];
  } catch { return []; }
}

/**
 * Append the current path to the visit journey. Idempotent per page: a refresh
 * or a re-render of the same path is not a new step, so the trail reads as the
 * pages they actually moved through.
 */
function recordJourneyStep(): void {
  if (typeof window === 'undefined') return;
  try {
    const t0 = journeyStart();
    const steps = readJourney();
    const p = window.location.pathname.slice(0, MAX_FIELD);
    if (steps.length && steps[steps.length - 1].p === p) return;
    steps.push({ p, t: Math.max(0, Date.now() - t0) });
    sessionStorage.setItem(JOURNEY_KEY, JSON.stringify(steps.slice(-JOURNEY_MAX_STEPS)));
  } catch {
    // never break a render
  }
}

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
  // Log the page into this visit's trail on every navigation, independent of
  // whether there is any utm to store.
  recordJourneyStep();
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
  // Remember that this browser already belongs to a lead, so the listing
  // sign-up prompt never asks someone who has just written to us.
  if (LEAD_EVENTS.has(name)) {
    try { localStorage.setItem(LEAD_SEEN_KEY, '1'); } catch { /* private mode */ }
  }
  const w = window as unknown as { gtag?: (...a: unknown[]) => void; dataLayer?: unknown[] };
  try {
    if (typeof w.gtag === 'function') {
      w.gtag('event', name, params);
      if (LEAD_EVENTS.has(name)) w.gtag('event', 'generate_lead', { lead_source: name, value: 1, currency: 'USD', ...params });
    } else if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push({ event: name, ...params });
      if (LEAD_EVENTS.has(name)) w.dataLayer.push({ event: 'generate_lead', lead_source: name, value: 1, currency: 'USD', ...params });
    }
  } catch {
    // Analytics must never break the form.
  }

  // Mirror into Clarity so session replays can be filtered by the same event
  // names GA charts. Clarity takes a bare string rather than a params object,
  // so the detail stays in GA and Clarity gets just the name — enough to
  // segment recordings. Separate try: a Clarity failure must not swallow a GA
  // event that already succeeded.
  try {
    const c = (window as unknown as { clarity?: (cmd: string, ...a: unknown[]) => void }).clarity;
    if (typeof c === 'function') c('event', name);
  } catch {
    // Same contract — never break the page.
  }
}

/**
 * Fire a "began filling this form" event exactly once per form, per page view.
 *
 * Started-vs-submitted is the only way to see abandonment, and abandonment is
 * the number worth acting on: lots of starts with few submits means the form
 * has a problem. Guarded by a module-level set because the natural trigger is
 * focus, and focus fires again every time someone tabs back into a field —
 * without the guard one hesitant visitor looks like ten.
 *
 * The set lives for the life of the JS module, so a client-side route change
 * keeps the guard. That is deliberate: re-focusing the same form after
 * navigating away and back is the same attempt, not a new one.
 */
const startedForms = new Set<string>();

export function trackFormStart(surface: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  if (startedForms.has(surface)) return;
  startedForms.add(surface);
  trackEvent('lead_form_started', { surface, page_path: window.location.pathname, ...params });
}

/**
 * Milliseconds this browser has had the site open — the fill-time signal the
 * lead endpoints REQUIRE (lib/bot-guard.ts rejects a missing value). Measured
 * from the document's time origin, so it only grows across client-side
 * navigation; a script posting straight at the API never has one.
 */
export function formElapsedMs(): number {
  return typeof performance === 'undefined' ? 0 : Math.round(performance.now());
}

/**
 * Everything a form should send so the lead is attributable: the stored
 * utm/referrer payload plus the page it was submitted from and the viewport
 * (the server turns the viewport + user-agent into a device label). Also
 * carries elapsed_ms, which every lead endpoint requires.
 */
export function attributionPayload(
  surface?: string,
  identity?: { email?: unknown; name?: unknown },
): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  // Make sure the submit page itself is the last step even if a form renders
  // without a route change (e.g. a modal on the landing page).
  recordJourneyStep();
  // If the caller knows who this is, tie the live Clarity session to them now —
  // this runs as the form POSTs, the exact moment identity is known and the
  // recording is still open. Forms that build their body without an email in
  // hand (the shared submit hook) call identifyLead() themselves instead.
  if (identity && typeof identity.email === 'string' && identity.email) {
    identifyLead(identity.email, typeof identity.name === 'string' ? identity.name : null, surface);
  }
  const steps = readJourney();
  const t0 = journeyStart();
  return {
    ...readAttribution(),
    page_path: window.location.pathname.slice(0, MAX_FIELD),
    page_url: window.location.href.slice(0, 500),
    page_title: (typeof document !== 'undefined' ? document.title : '').slice(0, 200),
    viewport_width: window.innerWidth,
    elapsed_ms: formElapsedMs(),
    // The visit trail + how long they were here before submitting.
    journey: steps,
    page_views: steps.length,
    time_on_site_sec: Math.round(Math.max(0, Date.now() - t0) / 1000),
    ...(surface ? { surface } : {}),
  };
}

/**
 * Tie the live Microsoft Clarity session to this lead, so a named person's
 * recording — every page, scroll and hesitation — becomes findable in Clarity
 * by their email or name. We already forward event names to Clarity in
 * trackEvent; this adds identity at the one moment we learn it, the submit.
 * Clarity hashes the id it stores, so no raw email is exposed in the dashboard.
 * Never throws — a Clarity hiccup must not break a submit.
 */
export function identifyLead(email?: string | null, name?: string | null, source?: string | null): void {
  if (typeof window === 'undefined' || !email) return;
  try {
    const c = (window as unknown as { clarity?: (cmd: string, ...a: unknown[]) => void }).clarity;
    if (typeof c !== 'function') return;
    c('identify', email);
    if (name) c('set', 'lead_name', name);
    if (source) c('set', 'lead_source', source);
  } catch {
    // Clarity must never break a submit.
  }
}
