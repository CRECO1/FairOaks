/** Shared helpers for the first-party tracking ingest routes (pageview + event). */
import { stripClickTracking } from '@/lib/strip-click-tracking';

// Cheap UA bot screen — keeps crawlers/monitors/link-unfurlers out of the data.
export const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|pinterest|vkshare|whatsapp|telegram|headless|lighthouse|pagespeed|gtmetrix|uptime|statuscake|pingdom|monitor|python-requests|curl\/|wget|axios|node-fetch|go-http|java\/|okhttp|scrapy|phantomjs|preview|archiver|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|perplexity|ccbot|applebot|yandex|baidu/i;

export function deviceFromUA(ua: string): string {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function browserFromUA(ua: string): string | null {
  const m =
    /(edg|edge)\/(\d+)/i.exec(ua) ? ['Edge', /(?:edg|edge)\/(\d+)/i.exec(ua)![1]] :
    /(opr|opera)\/(\d+)/i.exec(ua) ? ['Opera', /(?:opr|opera)\/(\d+)/i.exec(ua)![1]] :
    /(samsungbrowser)\/(\d+)/i.exec(ua) ? ['Samsung Internet', /samsungbrowser\/(\d+)/i.exec(ua)![1]] :
    /(crios|chrome)\/(\d+)/i.exec(ua) ? ['Chrome', /(?:crios|chrome)\/(\d+)/i.exec(ua)![1]] :
    /(fxios|firefox)\/(\d+)/i.exec(ua) ? ['Firefox', /(?:fxios|firefox)\/(\d+)/i.exec(ua)![1]] :
    /version\/(\d+).*safari/i.exec(ua) ? ['Safari', /version\/(\d+)/i.exec(ua)![1]] : null;
  return m ? `${m[0]} ${m[1]}` : null;
}

export function osFromUA(ua: string): string | null {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return null;
}

export const clip = (v: unknown, n: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = stripClickTracking(v).trim();
  return s ? s.slice(0, n) : null;
};

const ID = /^[A-Za-z0-9_-]{8,64}$/;
export const cleanId = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) ? v : null);

/** Keep only known scalar click-id keys, each clipped. */
export function cleanClickIds(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const k of ['gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'fbclid', 'ttclid', 'li_fat_id', 'twclid']) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === 'string' && x) out[k] = x.slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

/** Whitelist the environment object the browser sends. */
export function cleanEnv(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof e.lang === 'string') out.lang = e.lang.slice(0, 16);
  if (typeof e.tz === 'string') out.tz = e.tz.slice(0, 48);
  if (typeof e.screen === 'string') out.screen = e.screen.slice(0, 16);
  if (typeof e.dpr === 'number') out.dpr = e.dpr;
  if (typeof e.conn === 'string') out.conn = e.conn.slice(0, 8);
  if (typeof e.scheme === 'string') out.scheme = e.scheme.slice(0, 8);
  if (typeof e.touch === 'boolean') out.touch = e.touch;
  if (typeof e.browser === 'string') out.browser = e.browser.slice(0, 40);   // set by a server-side forwarder (crecotx.com) from the visitor's UA
  if (typeof e.os === 'string') out.os = e.os.slice(0, 24);
  return Object.keys(out).length ? out : null;
}

/** First-touch snapshot from the browser (sanitised). */
export function cleanFirstTouch(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const f = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof f.t === 'number') out.t = f.t;
  for (const k of ['landing_page', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const s = clip(f[k], 300); if (s) out[k] = s;
  }
  const ci = cleanClickIds(f.click_ids); if (ci) out.click_ids = ci;
  return Object.keys(out).length ? out : null;
}
