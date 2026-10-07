/**
 * First-party visitor tracker (v2) — SELF-CONTAINED, zero imports, identical on all three public sites
 * (fairoaksrealtygroup.com, crecotx.com, elkhornpoint.com). Copy this file verbatim; only the
 * endpoint passed to initTracker() differs (relative on FairOaks, absolute from the other two).
 *
 * What it adds on top of the old per-tab pageview beacon:
 *   • a persistent anonymous VISITOR id (localStorage + 2-year cookie) so repeat visits stitch together
 *   • visit counting + a first-touch snapshot (the very first source/landing/click-id, never overwritten)
 *   • ad click ids (gclid, gbraid, wbraid, msclkid, fbclid, ttclid, li_fat_id, dclid, twclid)
 *   • environment (language, timezone, screen, dpr, connection, colour scheme, touch)
 *   • behaviour events → /api/track/event: phone taps, email taps, outbound clicks, downloads, CTA clicks,
 *     scroll depth (25/50/75/90), engaged seconds per page, load time, JS errors, plus any form event the
 *     site already raises through trackEvent()
 *   • email-click identification: links in our campaign emails carry `ctk` (a signed client token); the
 *     server links this visitor to that contact so their site activity shows on the contact card
 *
 * Privacy: first-party only, no third-party sync, no PII in the browser — identity is only ever learned
 * server-side (a lead form, or a signed ctk from OUR OWN email). Every accessor is try/caught: tracking
 * must never break a render or a form.
 */

const VID_KEY = 'trk_vid';
const FIRST_KEY = 'trk_first';
const VISITS_KEY = 'trk_visits';
const LAST_SEEN_KEY = 'trk_last_seen';
const CLICKS_KEY = 'trk_clicks';
const SID_KEY = 'trk_sid';
const CTK_KEY = 'trk_ctk';
const COOKIE_DAYS = 730;
const VISIT_GAP_MS = 30 * 60 * 1000;

export const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'fbclid', 'ttclid', 'li_fat_id', 'twclid'] as const;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

export interface TrackerEnv { lang?: string; tz?: string; screen?: string; dpr?: number; conn?: string; scheme?: string; touch?: boolean }
export interface FirstTouch {
  t: number; landing_page?: string; referrer?: string;
  utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_term?: string; utm_content?: string;
  click_ids?: Record<string, string>;
}
/** What every lead form should spread into its POST (see trackerPayload). */
export interface TrackerPayload {
  visitor_id?: string; visit_count?: number; first_touch?: FirstTouch; click_ids?: Record<string, string>; env?: TrackerEnv;
}

let endpoint = '/api/track';
let started = false;
let engagedMs = 0;
let lastTick = 0;
let maxScroll = 0;
let scrollSent = new Set<number>();
let currentPath = '';
let queue: EventRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let errorCount = 0;

interface EventRow { type: string; label?: string; value?: number; path: string; meta?: Record<string, unknown>; t: number }

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const devHost = () => /localhost|127\.0\.0\.1|\.local$/.test(window.location.hostname);
const siteHost = () => window.location.hostname.replace(/^www\./, '');

function uuid(): string {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function getCookie(name: string): string | null {
  try {
    const m = document.cookie.split('; ').find(c => c.startsWith(`${name}=`));
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
  } catch { return null; }
}
function setCookie(name: string, value: string, days: number) {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${days * 86400}; SameSite=Lax${secure}`;
  } catch { /* ignore */ }
}
function ls(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

/** Persistent anonymous visitor id — localStorage first, cookie as the survivor if storage is cleared. */
export function visitorId(): string {
  if (!isBrowser()) return '';
  let id = ls(VID_KEY) || getCookie(VID_KEY);
  if (!id) id = uuid();
  lsSet(VID_KEY, id);
  setCookie(VID_KEY, id, COOKIE_DAYS);
  return id;
}

/** Per-tab session id (kept compatible with the original pageview beacon). */
export function sessionId(): string {
  try {
    let id = sessionStorage.getItem('forg_sid') || sessionStorage.getItem(SID_KEY);
    if (!id) { id = uuid(); sessionStorage.setItem(SID_KEY, id); }
    return id;
  } catch { return `s_${Math.random().toString(36).slice(2, 12)}`; }
}

function readJson<T>(key: string): T | null { try { const r = ls(key); return r ? JSON.parse(r) as T : null; } catch { return null; } }

/** Click ids on THIS landing url (latest wins); merged into the stored set. */
function captureClickIds(): Record<string, string> {
  const stored = readJson<Record<string, string>>(CLICKS_KEY) ?? {};
  try {
    const p = new URLSearchParams(window.location.search);
    let changed = false;
    for (const k of CLICK_ID_KEYS) {
      const v = p.get(k);
      if (v) { stored[k] = v.slice(0, 200); changed = true; }
    }
    if (changed) lsSet(CLICKS_KEY, JSON.stringify(stored));
  } catch { /* ignore */ }
  return stored;
}

function offSiteReferrer(): string | undefined {
  try {
    if (document.referrer && !document.referrer.includes(window.location.host)) return document.referrer.slice(0, 300);
  } catch { /* ignore */ }
  return undefined;
}

/** Counts a new visit (30 min of inactivity = a new visit) and snapshots the first-ever touch once. */
function recordVisit(clicks: Record<string, string>) {
  const now = Date.now();
  const last = parseInt(ls(LAST_SEEN_KEY) || '0', 10);
  let visits = parseInt(ls(VISITS_KEY) || '0', 10) || 0;
  if (!last || now - last > VISIT_GAP_MS) { visits += 1; lsSet(VISITS_KEY, String(visits)); }
  lsSet(LAST_SEEN_KEY, String(now));

  if (!ls(FIRST_KEY)) {
    const p = new URLSearchParams(window.location.search);
    const ft: FirstTouch = { t: now, landing_page: window.location.pathname.slice(0, 200), referrer: offSiteReferrer() };
    for (const k of UTM_KEYS) { const v = p.get(k); if (v) ft[k] = v.slice(0, 120); }
    if (Object.keys(clicks).length) ft.click_ids = clicks;
    lsSet(FIRST_KEY, JSON.stringify(ft));
  }
}

export function environment(): TrackerEnv {
  const env: TrackerEnv = {};
  try {
    env.lang = (navigator.language || '').slice(0, 16);
    env.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    env.screen = `${window.screen.width}x${window.screen.height}`;
    env.dpr = Math.round((window.devicePixelRatio || 1) * 10) / 10;
    const c = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
    if (c?.effectiveType) env.conn = c.effectiveType;
    env.scheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    env.touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  } catch { /* ignore */ }
  return env;
}

/** Spread this into any lead form POST so the lead carries the whole visitor story. */
export function trackerPayload(): TrackerPayload {
  if (!isBrowser()) return {};
  try {
    return {
      visitor_id: visitorId(),
      visit_count: parseInt(ls(VISITS_KEY) || '1', 10) || 1,
      first_touch: readJson<FirstTouch>(FIRST_KEY) ?? undefined,
      click_ids: readJson<Record<string, string>>(CLICKS_KEY) ?? undefined,
      env: environment(),
    };
  } catch { return {}; }
}

// ── transport ───────────────────────────────────────────────────────────────────────────────────
function send(path: string, body: unknown) {
  try {
    if (typeof navigator.sendBeacon !== 'function') return;
    navigator.sendBeacon(`${endpoint}${path}`, new Blob([JSON.stringify(body)], { type: 'text/plain' }));
  } catch { /* never break a render */ }
}

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!queue.length || !isBrowser() || devHost()) { queue = []; return; }
  const events = queue.splice(0, 20);
  send('/event', { site: siteHost(), visitor_id: visitorId(), session_id: sessionId(), events });
  if (queue.length) flush();
}

/** Record a behaviour event (batched, fire-and-forget). */
export function trackBehavior(type: string, label?: string, value?: number, meta?: Record<string, unknown>) {
  if (!isBrowser() || devHost()) return;
  queue.push({
    type: type.slice(0, 40),
    label: label ? label.slice(0, 160) : undefined,
    value: typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined,
    path: window.location.pathname.slice(0, 300),
    meta, t: Date.now(),
  });
  if (queue.length >= 12) flush();
  else if (!flushTimer) flushTimer = setTimeout(flush, 3000);
}

// ── pageview ────────────────────────────────────────────────────────────────────────────────────
export function trackPageview(attr: { utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_term?: string; utm_content?: string } = {}) {
  if (!isBrowser() || typeof navigator.sendBeacon !== 'function' || devHost()) return;
  try {
    const clicks = captureClickIds();
    recordVisit(clicks);
    flushPageEngagement();            // close out the previous SPA page
    currentPath = window.location.pathname;
    scrollSent = new Set(); maxScroll = 0; engagedMs = 0; lastTick = document.visibilityState === 'visible' ? Date.now() : 0;

    const ctk = pickCtk();
    send('/pageview', {
      site: siteHost(), session_id: sessionId(), visitor_id: visitorId(),
      visit_n: parseInt(ls(VISITS_KEY) || '1', 10) || 1,
      path: window.location.pathname.slice(0, 512),
      title: (document.title || '').slice(0, 300),
      referrer: offSiteReferrer()?.slice(0, 512) ?? '',
      ...attr, click_ids: clicks, env: environment(), ctk,
    });

    // Navigation timing once per hard load.
    if (!(window as unknown as { __trkLoad?: boolean }).__trkLoad) {
      (window as unknown as { __trkLoad?: boolean }).__trkLoad = true;
      const nav = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined;
      if (nav && nav.loadEventEnd > 0) trackBehavior('page_load', undefined, nav.loadEventEnd);
      else window.addEventListener('load', () => {
        const n = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined;
        if (n) trackBehavior('page_load', undefined, n.loadEventEnd || n.duration);
      }, { once: true });
    }
  } catch { /* ignore */ }
}

/** The signed contact token from a campaign-email link, sent once per browser until the server accepts it. */
function pickCtk(): string | undefined {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('ctk');
    if (fromUrl && /^[0-9a-f-]{36}\.[0-9a-f]{10}$/i.test(fromUrl)) { lsSet(CTK_KEY, fromUrl); return fromUrl; }
    return undefined;     // only ever sent on the landing view that carried it
  } catch { return undefined; }
}

function flushPageEngagement() {
  if (!currentPath) return;
  if (lastTick) { engagedMs += Date.now() - lastTick; lastTick = 0; }
  const secs = Math.round(engagedMs / 1000);
  if (secs >= 1 || maxScroll > 0) {
    queue.push({ type: 'page_exit', value: secs, path: currentPath.slice(0, 300), meta: { max_scroll: maxScroll }, t: Date.now() });
  }
  engagedMs = 0; maxScroll = 0;
  if (queue.length && !flushTimer) flushTimer = setTimeout(flush, 3000);
}

// ── auto behaviour listeners ────────────────────────────────────────────────────────────────────
const CTA_TEXT = /\b(schedule|tour|request|contact|call|text|get|download|sign|apply|book|reserve|submit|send|inquire|learn|view|see|list|sell|lease|buy|valuation|estimate|subscribe|register|talk|speak)\b/i;
const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|zip|pptx?)(\?|#|$)/i;

function onClick(e: MouseEvent) {
  try {
    const el = (e.target as Element | null)?.closest?.('a, button, [data-track]') as HTMLElement | null;
    if (!el) return;
    const dt = el.getAttribute('data-track') || el.closest('[data-track]')?.getAttribute('data-track');
    const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const a = el.closest('a') as HTMLAnchorElement | null;
    const href = a?.getAttribute('href') || '';

    if (href.startsWith('tel:')) return trackBehavior('phone_tap', href.slice(4), undefined, { text });
    if (href.startsWith('mailto:')) return trackBehavior('email_tap', href.slice(7).split('?')[0], undefined, { text });
    if (href.startsWith('sms:')) return trackBehavior('text_tap', href.slice(4), undefined, { text });
    if (a && FILE_EXT.test(href)) return trackBehavior('download', href.slice(0, 160), undefined, { text });
    if (a && /^https?:\/\//i.test(href)) {
      const u = new URL(href);
      if (u.hostname.replace(/^www\./, '') !== siteHost() && !/\.?(crecotx|fairoaksrealtygroup|elkhornpoint)\.com$/i.test(u.hostname)) {
        return trackBehavior('outbound_click', u.hostname + u.pathname, undefined, { text });
      }
    }
    if (dt) return trackBehavior('cta_click', dt, undefined, { text });
    if ((el.tagName === 'BUTTON' || a?.matches('[class*="btn"], [class*="button"], [role="button"]')) && CTA_TEXT.test(text)) {
      trackBehavior('cta_click', text, undefined, a ? { href: href.slice(0, 120) } : undefined);
    }
  } catch { /* ignore */ }
}

function onScroll() {
  try {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    const pct = Math.min(100, Math.round((window.scrollY / max) * 100));
    if (pct > maxScroll) maxScroll = pct;
    for (const m of [25, 50, 75, 90]) {
      if (pct >= m && !scrollSent.has(m)) { scrollSent.add(m); trackBehavior('scroll', String(m), m); }
    }
  } catch { /* ignore */ }
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    if (lastTick) { engagedMs += Date.now() - lastTick; lastTick = 0; }
    flushPageEngagement(); flush();
    // keep the page's running totals sane if the user comes back to the same page
    currentPath = window.location.pathname;
  } else if (!lastTick) lastTick = Date.now();
}

function onError(ev: ErrorEvent) {
  if (errorCount >= 5) return;
  errorCount += 1;
  trackBehavior('js_error', String(ev.message || 'error').slice(0, 140), undefined, { src: (ev.filename || '').split('/').pop()?.slice(0, 60), line: ev.lineno });
}

/**
 * Start the tracker once per page load. `ep` is the base of the ingest routes: '' (same origin, FairOaks)
 * or 'https://www.fairoaksrealtygroup.com' (the other two sites, cross-origin via text/plain beacons).
 */
export function initTracker(ep = '') {
  if (!isBrowser() || started) return;
  started = true;
  endpoint = `${ep.replace(/\/$/, '')}/api/track`;
  try {
    visitorId();
    document.addEventListener('click', onClick, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', () => { onVisibility(); });
    window.addEventListener('error', onError);
    lastTick = document.visibilityState === 'visible' ? Date.now() : 0;
  } catch { /* ignore */ }
}
