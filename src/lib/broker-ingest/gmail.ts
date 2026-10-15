/**
 * Gmail access for the broker-ingest pipeline.
 *
 * Reuses the CRM's existing Gmail integration verbatim: it reads the stored
 * gmail_connections row for zack@crecotx.com, decrypts the access token, refreshes
 * via https://oauth2.googleapis.com/token when near expiry, and PATCHes the new
 * encrypted token back. All Gmail access is raw fetch against the Gmail REST API
 * (there is NO googleapis npm package in this repo — keep it that way).
 *
 * DB access is via the Supabase REST API with the service-role key, because the
 * direct DATABASE_URL host is IPv6-only and does not resolve from cron/CLI here.
 */

// Relative import (not @/lib/...) so this module resolves identically under Next.js
// AND under `tsx` when imported by scripts/broker-backfill.mjs.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { decryptToken, encryptToken } from '../token-crypto';
import type { FetchedEmail, GmailImage } from './types';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();

/**
 * Broker blasts land in zack@crecotx.com's inbox. The connection is looked up by USER, never by
 * row id: disconnecting Gmail deletes the gmail_connections row and reconnecting inserts a new
 * one, so the id this code used to pin (5598535c…) stopped existing when Zack reconnected on
 * 2026-10-08 and the whole ingest has failed ("connection not found") ever since.
 */
export const BROKER_USER_ID = '47668cbf-25c1-480a-baa0-af65fb663dd7';
/** @deprecated stale pinned row id — kept only so older imports keep compiling. Not used for lookup. */
export const BROKER_CONNECTION_ID = '5598535c-c6d0-4638-bf45-45bff13ae4cf';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Media types Claude vision accepts; anything else is skipped. */
const SUPPORTED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
/** Skip likely tracking pixels / spacers and oversized images. */
const MIN_IMAGE_BYTES = 3_000;
const MAX_IMAGE_BYTES = 4_500_000;

function serviceHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

export interface GmailConnectionRow {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email?: string | null;
}

/**
 * The mailbox the crawl reads. The connection is found by this ADDRESS, not by whichever CRM
 * login happened to click Connect: the sidebar shows "Connected" for the logged-in user's own
 * rows, so a reconnect made under a different login looked healthy while the cron (pinned to
 * one user id) found nothing.
 */
export const BROKER_GMAIL_EMAIL = (process.env.BROKER_GMAIL_EMAIL || 'zack@crecotx.com').trim().toLowerCase();

export type BrokerGmailErrorCode = 'no_connection' | 'wrong_mailbox' | 'refresh_failed' | 'gmail_auth' | 'lookup_failed';

/** A crawl-blocking Gmail problem with a code the cron and watchdog can word differently. */
export class BrokerGmailError extends Error {
  constructor(public code: BrokerGmailErrorCode, message: string) { super(message); this.name = 'BrokerGmailError'; }
}

/** Per-connection token health, read by the sidebar and the watchdog (crm_integration_status). */
export const gmailRefreshKey = (connectionId: string) => `gmail_refresh_${connectionId}`;

/** Best-effort status write over service-role REST (this module has no supabase-js on purpose). */
export async function recordIntegrationStatus(id: string, status: 'ok' | 'error'): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_integration_status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates', ...serviceHeaders() },
      body: JSON.stringify({ id, last_status: status, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) console.error(`[broker-gmail] could not record status ${id}=${status}:`, res.status, await res.text().catch(() => ''));
  } catch (e) { console.error('[broker-gmail] status write failed:', e); }
}

export interface BrokerConnectionLookup {
  conn: GmailConnectionRow | null;
  /** How it was found: by the Gmail address (preferred) or the legacy user-id fallback. */
  via: 'email' | 'user' | null;
  /** Gmail addresses connected under BROKER_USER_ID when none of them is the broker mailbox. */
  otherMailboxes: string[];
  /** A REST failure — surfaced instead of being mistaken for "not found". */
  error: string | null;
}

/**
 * THE broker-connection lookup — used by the cron and the integration watchdog so they
 * cannot disagree. Newest `updated_at` wins among rows for the broker address (any user_id).
 * Falls back to BROKER_USER_ID only for a row that carries no address; a row under that user
 * for a DIFFERENT address is reported as `otherMailboxes` (a wrong mailbox is never read).
 */
export async function findBrokerConnection(): Promise<BrokerConnectionLookup> {
  const out: BrokerConnectionLookup = { conn: null, via: null, otherMailboxes: [], error: null };
  const get = async (qs: string): Promise<(GmailConnectionRow & { gmail_email?: string | null })[] | null> => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?${qs}`, { headers: serviceHeaders() });
    if (!res.ok) { out.error = `gmail_connections lookup failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 160)}`; return null; }
    return res.json();
  };
  const addr = encodeURIComponent(BROKER_GMAIL_EMAIL);
  const byEmail = await get(`select=*&or=(gmail_email.ilike.${addr},email.ilike.${addr})&order=updated_at.desc&limit=1`);
  if (byEmail?.length) { out.conn = byEmail[0]; out.via = 'email'; return out; }
  const byUser = await get(`select=*&user_id=eq.${BROKER_USER_ID}&order=updated_at.desc`);
  for (const r of byUser ?? []) {
    const a = (r.gmail_email || r.email || '').trim().toLowerCase();
    if (!a) { if (!out.conn) { out.conn = r; out.via = 'user'; } }
    else if (a !== BROKER_GMAIL_EMAIL) out.otherMailboxes.push(a);
  }
  return out;
}

/** Back-compat wrapper for older callers/scripts: the broker row, or null. */
export async function fetchBrokerConnection(): Promise<GmailConnectionRow | null> {
  return (await findBrokerConnection()).conn;
}

export type TokenResult = { token: string } | { error: string; description: string };

/**
 * Returns a valid access token for a GmailConnection row, refreshing + persisting
 * if near expiry. A rejected refresh is reported (and recorded) with Google's reason —
 * `invalid_grant` is what an expired/revoked refresh token looks like.
 */
export async function resolveConnectionDetailed(conn: GmailConnectionRow): Promise<TokenResult> {
  const expiresAt = new Date(conn.expires_at).getTime();
  let accessToken = decryptToken(conn.access_token);

  if (Date.now() >= expiresAt - 120_000) {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: decryptToken(conn.refresh_token),
        grant_type: 'refresh_token',
      }),
    });
    const refreshed = await refreshRes.json().catch(() => ({}));
    if (!refreshRes.ok || !refreshed.access_token) {
      await recordIntegrationStatus(gmailRefreshKey(conn.id), 'error');
      return { error: String(refreshed.error ?? refreshRes.status), description: String(refreshed.error_description ?? '') };
    }
    accessToken = refreshed.access_token;
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?id=eq.${conn.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...serviceHeaders() },
      body: JSON.stringify({
        access_token: encryptToken(accessToken),
        expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      }),
    });
    await recordIntegrationStatus(gmailRefreshKey(conn.id), 'ok');
  }

  return { token: accessToken };
}

/** Token or null (legacy shape). */
export async function resolveConnection(conn: GmailConnectionRow): Promise<string | null> {
  const r = await resolveConnectionDetailed(conn);
  return 'token' in r ? r.token : null;
}

/** Convenience: find + resolve the broker connection, throwing a BrokerGmailError that says WHICH problem. */
export async function getBrokerAccessToken(): Promise<string> {
  const f = await findBrokerConnection();
  if (!f.conn) {
    if (f.error) throw new BrokerGmailError('lookup_failed', f.error);
    if (f.otherMailboxes.length) {
      throw new BrokerGmailError('wrong_mailbox',
        `Gmail is connected for the broker user as ${f.otherMailboxes.join(', ')}, not ${BROKER_GMAIL_EMAIL} — the crawl only reads ${BROKER_GMAIL_EMAIL}. Connect that Google account in the CRM sidebar.`);
    }
    throw new BrokerGmailError('no_connection',
      `No Gmail connection for ${BROKER_GMAIL_EMAIL} exists — connect that Google account in the CRM sidebar (any CRM login works).`);
  }
  const r = await resolveConnectionDetailed(f.conn);
  if (!('token' in r)) {
    throw new BrokerGmailError('refresh_failed',
      `Google rejected the stored refresh token for ${BROKER_GMAIL_EMAIL} (${r.error}${r.description ? `: ${r.description}` : ''}). ` +
      `Reconnect Gmail in the CRM sidebar. If this recurs about every 7 days the Google OAuth app is still in "Testing" — move it to Production/Internal.`);
  }
  return r.token;
}

/** List up to `limit` message ids matching `query`, paging as needed. */
export async function listMessageIds(
  accessToken: string,
  query: string,
  limit: number,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < limit) {
    const url = new URL(`${GMAIL_BASE}/messages`);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(Math.min(500, limit - ids.length)));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      // An auth failure used to read as "0 messages" and a healthy-looking run.
      if (res.status === 401 || res.status === 403) throw new BrokerGmailError('gmail_auth', `Gmail rejected the access token while listing messages (${res.status}) — reconnect ${BROKER_GMAIL_EMAIL}.`);
      if (!ids.length) throw new Error(`Gmail message list failed (${res.status})`);
      break;   // a later page failing keeps what was already listed
    }
    const data = await res.json();
    for (const m of data.messages ?? []) ids.push(m.id as string);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids.slice(0, limit);
}

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

/** Recursively find the first payload part of a given mime type and return its raw base64 data. */
function findPartData(payload: any, mime: string): string | null {
  if (!payload) return null;
  if (payload.mimeType === mime && payload.body?.data) return payload.body.data;
  for (const p of payload.parts ?? []) {
    const found = findPartData(p, mime);
    if (found) return found;
  }
  return null;
}

/** Prefer text/plain anywhere in the tree; fall back to stripped text/html. */
export function extractBody(payload: any): string {
  const plain = findPartData(payload, 'text/plain');
  if (plain) return decodeBase64(plain);
  const html = findPartData(payload, 'text/html');
  if (html) {
    return decodeBase64(html)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

/** Collect every image/* part in the payload tree. */
function collectImageParts(payload: any, out: any[]): void {
  if (!payload) return;
  const mt = (payload.mimeType || '').toLowerCase();
  if (mt.startsWith('image/')) out.push(payload);
  for (const p of payload.parts ?? []) collectImageParts(p, out);
}

/**
 * Extract up to `maxImages` flyer images from a message as standard base64.
 * The street address is frequently ONLY in the flyer image, so vision is essential.
 */
export async function extractImages(
  accessToken: string,
  messageId: string,
  payload: any,
  maxImages: number,
): Promise<GmailImage[]> {
  const parts: any[] = [];
  collectImageParts(payload, parts);
  const images: GmailImage[] = [];

  for (const part of parts) {
    if (images.length >= maxImages) break;
    const mimeType = (part.mimeType || '').toLowerCase();
    if (!SUPPORTED_IMAGE.has(mimeType)) continue;
    const size: number = part.body?.size ?? 0;
    if (size && (size < MIN_IMAGE_BYTES || size > MAX_IMAGE_BYTES)) continue;

    let data: string | undefined = part.body?.data;
    if (!data && part.body?.attachmentId) {
      const aRes = await fetch(
        `${GMAIL_BASE}/messages/${messageId}/attachments/${part.body.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!aRes.ok) continue;
      const aData = await aRes.json();
      data = aData.data;
    }
    if (!data) continue;

    // Gmail returns URL-safe base64; Anthropic requires standard base64.
    const std = data.replace(/-/g, '+').replace(/_/g, '/');
    images.push({ mimeType: mimeType as GmailImage['mimeType'], data: std });
  }

  return images;
}

/**
 * URL fragments that mark an <img> as email chrome (logo, headshot, social icon,
 * tracking pixel, store badge) rather than a property flyer/photo.
 */
const IMG_URL_JUNK =
  /pixel|tracking|track\.|\/track|beacon|open\.aspx|spacer|1x1|transparent|\blogo\b|icon|favicon|headshot|avatar|signature|social|facebook|twitter|linkedin|instagram|youtube|tiktok|\.svg|emoji|sprite|badge|app-?store|google-?play|placeholder|\bfooter\b|\bheader\b/i;

/** Pull candidate hosted image URLs out of raw HTML (https only, junk + SSRF filtered). */
function hostedImageUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    const u = m[1].trim();
    if (!/^https:\/\//i.test(u) || IMG_URL_JUNK.test(u)) continue;
    let host = '';
    try { host = new URL(u).hostname; } catch { continue; }
    // Block private/loopback/link-local hosts (basic SSRF guard).
    if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) continue;
    urls.add(u);
    if (urls.size >= 16) break;
  }
  return [...urls];
}

/** Is this resolved IP in a private / loopback / link-local / reserved range? */
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;                 // this-network, private, loopback
    if (a === 169 && b === 254) return true;                           // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;                  // private
    if (a === 192 && b === 168) return true;                           // private
    if (a === 100 && b >= 64 && b <= 127) return true;                 // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true;              // benchmark
    if (a >= 224) return true;                                        // multicast + reserved
    return false;
  }
  if (v === 6) {
    const low = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (low === '::1' || low === '::') return true;                    // loopback / unspecified
    if (/^(fc|fd|fe|ff)/.test(low)) return true;                       // ULA / link-local / multicast
    const m = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);               // IPv4-mapped
    if (m) return isBlockedIp(m[1]);
    return false;
  }
  return true; // not a valid IP literal → refuse
}

/** Resolve a hostname and return a public IP, or null if it's an IP literal / DNS that lands on a blocked range. */
async function resolvePublicIp(hostname: string): Promise<string | null> {
  if (isIP(hostname)) return isBlockedIp(hostname) ? null : hostname;
  try {
    const addrs = await lookup(hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) return null;
    return addrs[0].address;
  } catch { return null; }
}

/**
 * SSRF-safe image GET: http/https only, every hop's host DNS-resolved and checked
 * against private/reserved ranges, and redirects followed MANUALLY so a public URL
 * can't 30x-redirect to an internal target (the decisive bypass of a hostname-only
 * guard). (Residual: a sub-request DNS-rebind between check and connect — acceptable
 * for this low-value, external-email image path.)
 */
async function safeFetchImage(startUrl: string): Promise<Response | null> {
  let current = startUrl;
  for (let hop = 0; hop <= 4; hop++) {
    let u: URL;
    try { u = new URL(current); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!(await resolvePublicIp(u.hostname))) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6_000);
    let r: Response;
    try { r = await fetch(current, { redirect: 'manual', signal: ctrl.signal }); }
    catch { clearTimeout(timer); return null; }
    clearTimeout(timer);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return null;
      try { current = new URL(loc, current).href; } catch { return null; }
      continue; // re-validate the redirect target on the next hop
    }
    return r;
  }
  return null; // too many redirects
}

/**
 * Broker emails almost always link their property photos remotely (`<img src=…>`)
 * instead of attaching them, so the attachment scan finds nothing. Download the
 * candidate hosted images (parallel, guarded by type/size/timeout + SSRF) and return
 * the largest `maxKeep` — biggest first, since the hero photo is reliably the biggest
 * content image and the smaller ones round out a gallery.
 */
export async function fetchHostedImages(
  html: string | undefined,
  maxKeep = 3,
): Promise<GmailImage[]> {
  if (!html || maxKeep <= 0) return [];
  const urls = hostedImageUrls(html);
  if (!urls.length) return [];
  const one = async (u: string): Promise<{ img: GmailImage; size: number } | null> => {
    try {
      const r = await safeFetchImage(u);
      if (!r || !r.ok) return null;
      const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!SUPPORTED_IMAGE.has(ct)) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < MIN_IMAGE_BYTES || buf.length > MAX_IMAGE_BYTES) return null;
      return { img: { mimeType: ct as GmailImage['mimeType'], data: buf.toString('base64') }, size: buf.length };
    } catch { return null; }
  };
  const got = await Promise.all(urls.slice(0, 10).map(one));
  return got
    .filter((x): x is { img: GmailImage; size: number } => !!x)
    .sort((a, b) => b.size - a.size)
    .slice(0, maxKeep)
    .map((x) => x.img);
}

/** Fetch a full message and reduce it to a FetchedEmail (headers + body + images). */
export async function fetchEmail(
  accessToken: string,
  id: string,
  maxImages = 6,
): Promise<FetchedEmail | null> {
  const res = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const msg = await res.json();

  const headers: any[] = msg.payload?.headers ?? [];
  const get = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  const body = extractBody(msg.payload);
  const images = await extractImages(accessToken, id, msg.payload, maxImages);
  const rawHtml = findPartData(msg.payload, 'text/html');

  return {
    id,
    threadId: msg.threadId ?? id,
    subject: get('Subject') || '(no subject)',
    from: get('From'),
    date: get('Date'),
    body,
    images,
    html: rawHtml ? decodeBase64(rawHtml) : undefined,
  };
}
