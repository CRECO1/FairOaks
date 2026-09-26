/**
 * One-tap Google Analytics connection by user OAuth.
 *
 * WHY NOT A SERVICE ACCOUNT. The org policy iam.disableServiceAccountKeyCreation
 * blocks creating the JSON key the original integration wanted, and lifting it
 * needs an org admin at a desktop console. A user OAuth refresh token reaches
 * the same read-only Data API with one consent tap from the account that
 * already owns the property.
 *
 * WHY IT REUSES THE GMAIL REDIRECT URI. A Google OAuth client only accepts
 * redirect URIs registered against it in the Cloud console, and registering a
 * new one is exactly the kind of desktop console work this is trying to avoid.
 * /api/gmail/callback is already registered on this client and already works,
 * so the consent flow borrows it and the callback branches on a `ga4:` state
 * prefix. Verified against Google's authorization endpoint: this client +
 * analytics.readonly + the gmail redirect URI reaches the consent screen, while
 * an unregistered /api/ga4/callback returns redirect_uri_mismatch. Net Cloud
 * console changes required: none.
 *
 * CSRF. The Gmail flow binds its round-trip with an HttpOnly cookie, which is
 * not available here: the link is opened on a phone that has never loaded this
 * app. The nonce lives in public.ga4_oauth instead — single-use, time-limited,
 * and cleared the moment it is redeemed.
 */
import { randomBytes } from 'crypto';
import { adminClient } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/token-crypto';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.fairoaksrealtygroup.com').replace(/[\r\n\s]+$/, '');
/** Registered on the OAuth client already — see the note above. */
export const GA4_REDIRECT_URI = `${BASE_URL}/api/gmail/callback`;
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const NONCE_TTL_MIN = 60 * 24 * 14; // the link should still work days later

/** Create a single-use nonce and return the Google consent URL to tap. */
export async function mintConsentUrl(): Promise<{ url: string; nonce: string; expiresAt: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set');

  const nonce = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + NONCE_TTL_MIN * 60_000).toISOString();
  const { error } = await adminClient().from('ga4_oauth').upsert({
    id: 'default', pending_nonce: nonce, pending_expires_at: expiresAt, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`could not store consent nonce: ${error.message}`);

  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', GA4_REDIRECT_URI);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GA4_SCOPE);
  // offline + consent is what makes Google return a refresh_token rather than
  // only a one-hour access token; without both this connects once and dies.
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'false');
  u.searchParams.set('state', `ga4:${nonce}`);
  return { url: u.toString(), nonce, expiresAt };
}

/**
 * Redeem the authorization code. Verifies the nonce, exchanges the code, checks
 * the granted token can actually read the configured property, and only then
 * stores it — so authorizing with the wrong Google account fails loudly here
 * instead of leaving the dashboard quietly broken.
 */
export async function redeemGa4Code(code: string, state: string): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const nonce = state.startsWith('ga4:') ? state.slice(4) : '';
  if (!nonce) return { ok: false, reason: 'missing nonce' };

  const db = adminClient();
  const { data: row } = await db.from('ga4_oauth')
    .select('pending_nonce, pending_expires_at').eq('id', 'default').maybeSingle();
  if (!row?.pending_nonce || row.pending_nonce !== nonce) return { ok: false, reason: 'unrecognised or already-used link' };
  if (row.pending_expires_at && new Date(row.pending_expires_at as string).getTime() < Date.now()) {
    return { ok: false, reason: 'this authorization link has expired' };
  }

  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: GA4_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const tok = await res.json().catch(() => null) as { refresh_token?: string; access_token?: string; error?: string; error_description?: string } | null;
  if (!res.ok || !tok?.refresh_token) {
    const why = tok?.error_description ?? tok?.error ?? `HTTP ${res.status}`;
    // No refresh_token usually means Google reused a prior grant; prompt=consent
    // above is what prevents that, so surface it rather than storing nothing.
    return { ok: false, reason: `Google did not return a refresh token (${why})` };
  }

  // Who authorized, for the record. Best-effort: never fail the connection on it.
  let email = 'unknown';
  try {
    const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    email = ((await who.json()) as { email?: string })?.email ?? 'unknown';
  } catch { /* non-fatal */ }

  // Prove the grant actually reads the property before we call it connected.
  const propertyId = (process.env.GA4_PROPERTY_ID ?? '').trim();
  if (propertyId) {
    const check = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'sessions' }] }),
    });
    if (!check.ok) {
      const txt = (await check.text()).slice(0, 400);
      await db.from('ga4_oauth').update({ last_error: txt, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(txt)) {
        // Still store it: the grant is good, only the API switch is off.
        await db.from('ga4_oauth').update({
          refresh_token_enc: encryptToken(tok.refresh_token), account_email: email, property_id: propertyId,
          connected_at: new Date().toISOString(), pending_nonce: null, pending_expires_at: null,
          updated_at: new Date().toISOString(),
        }).eq('id', 'default');
        return { ok: false, reason: 'api_disabled' };
      }
      return { ok: false, reason: `that account cannot read GA4 property ${propertyId}` };
    }
  }

  const { error } = await db.from('ga4_oauth').update({
    refresh_token_enc: encryptToken(tok.refresh_token),
    account_email: email,
    property_id: propertyId || null,
    connected_at: new Date().toISOString(),
    last_error: null,
    pending_nonce: null,        // single use
    pending_expires_at: null,
    updated_at: new Date().toISOString(),
  }).eq('id', 'default');
  if (error) return { ok: false, reason: `could not store the token: ${error.message}` };

  return { ok: true, email };
}
