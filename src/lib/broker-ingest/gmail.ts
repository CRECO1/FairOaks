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
import { decryptToken, encryptToken } from '../token-crypto';
import type { FetchedEmail, GmailImage } from './types';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();

/** The gmail_connections row where broker blasts land (zack@crecotx.com). */
export const BROKER_CONNECTION_ID = '5598535c-c6d0-4638-bf45-45bff13ae4cf';
export const BROKER_USER_ID = '47668cbf-25c1-480a-baa0-af65fb663dd7';

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

/** Fetch the broker gmail_connections row directly via service-role REST (no user session). */
export async function fetchBrokerConnection(): Promise<GmailConnectionRow | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gmail_connections?id=eq.${BROKER_CONNECTION_ID}&limit=1`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) return null;
  const rows: GmailConnectionRow[] = await res.json();
  return rows?.[0] ?? null;
}

/**
 * Returns a valid access token for a GmailConnection row, refreshing + persisting
 * if near expiry. Copied from src/app/api/gmail/sync/route.ts resolveConnection.
 */
export async function resolveConnection(conn: GmailConnectionRow): Promise<string | null> {
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
    const refreshed = await refreshRes.json();
    if (!refreshRes.ok || !refreshed.access_token) return null;
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
  }

  return accessToken;
}

/** Convenience: fetch + resolve the broker connection in one call. */
export async function getBrokerAccessToken(): Promise<string> {
  const conn = await fetchBrokerConnection();
  if (!conn) throw new Error(`Broker Gmail connection ${BROKER_CONNECTION_ID} not found`);
  const token = await resolveConnection(conn);
  if (!token) throw new Error('Failed to resolve/refresh the broker Gmail access token');
  return token;
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
    if (!res.ok) break;
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

  return {
    id,
    threadId: msg.threadId ?? id,
    subject: get('Subject') || '(no subject)',
    from: get('From'),
    date: get('Date'),
    body,
    images,
  };
}
