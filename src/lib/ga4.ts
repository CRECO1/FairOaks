/**
 * GA4 Data API client.
 *
 * GA4 answers the half of "what's bringing leads" that our own tables can't:
 * how many sessions arrived, from which channel, onto which page — including
 * the traffic that never became a lead, which is exactly what a conversion
 * rate needs as its denominator.
 *
 * Credentials are optional by design. Until Zack provisions a service account
 * the dashboard must still load and show its first-party panels, so every
 * entry point here reports a "not connected" status instead of throwing. That
 * keeps a missing env var a configuration state, not an outage.
 *
 * TWO WAYS TO AUTHENTICATE, tried in this order:
 *
 *   1. USER OAUTH (preferred here). A refresh token for an account that can
 *      read the property, stored encrypted in public.ga4_oauth by the consent
 *      flow at /api/ga4/connect. Chosen because the Google org policy
 *      iam.disableServiceAccountKeyCreation blocks creating a service-account
 *      key at all, and lifting it needs an org admin at a desktop console —
 *      whereas OAuth needs one consent tap from the account that already owns
 *      the property. GA4_OAUTH_REFRESH_TOKEN overrides the stored value if set.
 *
 *   2. SERVICE-ACCOUNT KEY. The original path, kept intact as a fallback for
 *      whenever the org policy is relaxed. If GA4_SERVICE_ACCOUNT_KEY is set it
 *      is used when no OAuth token is available.
 *
 * Either one plus GA4_PROPERTY_ID is enough. With neither, GA reports itself
 * not connected and the rest of the dashboard is unaffected.
 *
 * Required env (property id, plus ONE credential route):
 *   GA4_PROPERTY_ID          numeric GA4 property id, e.g. "312345678"
 *                            (Admin → Property details — NOT the G-XXXX tag)
 *   GA4_SERVICE_ACCOUNT_KEY  the service-account JSON key, either raw JSON or
 *                            base64-encoded (Vercel env values are single-line,
 *                            so base64 is usually easier to paste)
 *
 * Optional:
 *   GA4_PROPERTY_LABEL       which site this property measures, shown on the GA
 *                            panels. Defaults to crecotx.com — the property we
 *                            connect first. This label matters: the GA panels sit
 *                            directly below first-party panels covering all three
 *                            sites, and GA here covers exactly ONE, so an
 *                            unlabelled "Sessions by channel" would read as the
 *                            whole business.
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { OAuth2Client } from 'google-auth-library';
import { adminClient } from '@/lib/supabase-admin';
import { decryptToken } from '@/lib/token-crypto';

export type GaStatus =
  | { connected: true; via: 'oauth' | 'service_account' }
  | { connected: false; reason: 'missing_env' | 'bad_key' | 'api_disabled'; detail: string; actionUrl?: string };

export interface GaRow { label: string; value: number; secondary?: number }

export interface GaReport {
  status: GaStatus;
  /** Which site this GA property measures, for the panel headers. */
  label: string;
  range: { start: string; end: string };
  totals: { sessions: number; users: number; leads: number; conversionRate: number } | null;
  byChannel: GaRow[];
  bySourceMedium: GaRow[];
  landingPages: GaRow[];
  byCountryCity: GaRow[];
  byDevice: GaRow[];
}

/** Parse the key from env. Accepts raw JSON or base64. */
function readCredentials(): { client_email: string; private_key: string } | { error: string } {
  const raw = process.env.GA4_SERVICE_ACCOUNT_KEY;
  if (!raw) return { error: 'GA4_SERVICE_ACCOUNT_KEY is not set' };
  let text = raw.trim();
  if (!text.startsWith('{')) {
    try { text = Buffer.from(text, 'base64').toString('utf8'); }
    catch { return { error: 'GA4_SERVICE_ACCOUNT_KEY is neither JSON nor valid base64' }; }
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed.client_email || !parsed.private_key) {
      return { error: 'Service-account key is missing client_email or private_key' };
    }
    // Vercel stores newlines escaped; the JWT signer needs real ones.
    return { client_email: parsed.client_email, private_key: String(parsed.private_key).replace(/\\n/g, '\n') };
  } catch {
    return { error: 'Service-account key is not valid JSON' };
  }
}

/**
 * The stored OAuth refresh token, or null. Env wins so a token can be pinned
 * without touching the database.
 */
async function readOauthRefreshToken(): Promise<string | null> {
  const fromEnv = process.env.GA4_OAUTH_REFRESH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const { data } = await adminClient()
      .from('ga4_oauth').select('refresh_token_enc').eq('id', 'default').maybeSingle();
    const enc = data?.refresh_token_enc as string | undefined;
    if (!enc) return null;
    return decryptToken(enc);
  } catch (e) {
    console.error('[ga4] could not read stored OAuth token', e);
    return null;
  }
}

/** An OAuth2 client bound to the stored refresh token, ready for the Data API. */
export async function oauthClient(): Promise<OAuth2Client | null> {
  const refresh = await readOauthRefreshToken();
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!refresh || !id || !secret) return null;
  const c = new OAuth2Client({ clientId: id, clientSecret: secret });
  c.setCredentials({ refresh_token: refresh });
  return c;
}

/** Which site the connected property measures. */
export function gaLabel(): string {
  const v = process.env.GA4_PROPERTY_LABEL?.trim();
  return v && v.length ? v.slice(0, 60) : 'crecotx.com';
}

export async function gaStatus(): Promise<GaStatus> {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) return { connected: false, reason: 'missing_env', detail: 'GA4_PROPERTY_ID is not set' };
  if (!/^\d+$/.test(propertyId.trim())) {
    return { connected: false, reason: 'bad_key', detail: 'GA4_PROPERTY_ID must be the numeric property id, not the G-XXXXXXX measurement id' };
  }
  if (await readOauthRefreshToken()) return { connected: true, via: 'oauth' };
  const creds = readCredentials();
  if ('error' in creds) {
    return { connected: false, reason: 'missing_env',
      detail: `No GA credential available. ${creds.error}. Connect Google Analytics with one tap at /api/ga4/connect, or set GA4_SERVICE_ACCOUNT_KEY.` };
  }
  return { connected: true, via: 'service_account' };
}

function emptyReport(status: GaStatus, start: string, end: string): GaReport {
  return { status, label: gaLabel(), range: { start, end }, totals: null, byChannel: [], bySourceMedium: [], landingPages: [], byCountryCity: [], byDevice: [] };
}

/**
 * Pull the acquisition picture for the last `days` days. Never throws — a GA
 * outage or a revoked key degrades to the not-connected state so the rest of
 * the dashboard keeps working.
 */
export async function fetchGaReport(days = 30): Promise<GaReport> {
  const start = `${days}daysAgo`;
  const end = 'today';
  const status = await gaStatus();
  if (!status.connected) return emptyReport(status, start, end);

  const propertyId = (process.env.GA4_PROPERTY_ID ?? '').trim();
  const property = `properties/${propertyId}`;

  try {
    // OAuth first; the service-account key stays as the fallback so relaxing
    // the org policy later needs no code change, just the env var.
    let client: BetaAnalyticsDataClient;
    if (status.via === 'oauth') {
      const auth = await oauthClient();
      if (!auth) return emptyReport({ connected: false, reason: 'missing_env', detail: 'OAuth token present but GOOGLE_CLIENT_ID/SECRET are not set' }, start, end);
      client = new BetaAnalyticsDataClient({ authClient: auth });
    } else {
      const creds = readCredentials();
      if ('error' in creds) return emptyReport({ connected: false, reason: 'bad_key', detail: creds.error }, start, end);
      client = new BetaAnalyticsDataClient({ credentials: creds });
    }
    const dateRanges = [{ startDate: start, endDate: end }];

    const dim = (name: string, metric = 'sessions', limit = 10) =>
      client.runReport({
        property, dateRanges,
        dimensions: [{ name }],
        metrics: [{ name: metric }],
        orderBys: [{ metric: { metricName: metric }, desc: true }],
        limit,
      });

    const [
      [totalsRes],
      [channelRes],
      [sourceMediumRes],
      [landingRes],
      [cityRes],
      [deviceRes],
    ] = await Promise.all([
      client.runReport({
        property, dateRanges,
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'keyEvents' }],
      }),
      dim('sessionDefaultChannelGroup'),
      dim('sessionSourceMedium'),
      dim('landingPagePlusQueryString', 'sessions', 12),
      dim('city'),
      dim('deviceCategory', 'sessions', 6),
    ]);

    const rows = (res: typeof channelRes): GaRow[] =>
      (res.rows ?? []).map(r => ({
        label: r.dimensionValues?.[0]?.value || '(not set)',
        value: Number(r.metricValues?.[0]?.value ?? 0),
      }));

    const t = totalsRes.rows?.[0]?.metricValues ?? [];
    const sessions = Number(t[0]?.value ?? 0);
    const users = Number(t[1]?.value ?? 0);
    // keyEvents counts every event marked as a key event in GA4. If
    // generate_lead is the only one marked, this is the lead count; if others
    // are marked too it over-counts, so the label in the UI says "key events".
    const leads = Number(t[2]?.value ?? 0);

    return {
      status: { connected: true, via: status.via },
      label: gaLabel(),
      range: { start, end },
      totals: { sessions, users, leads, conversionRate: sessions > 0 ? leads / sessions : 0 },
      byChannel: rows(channelRes),
      bySourceMedium: rows(sourceMediumRes),
      landingPages: rows(landingRes),
      byCountryCity: rows(cityRes),
      byDevice: rows(deviceRes),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The common real-world failure is the service account not being added as
    // a Viewer on the property — surface that plainly instead of a stack trace.
    console.error('[ga4]', msg);

    // The Data API not being switched on in the Cloud project is the one step
    // this setup cannot do for itself. Google puts the exact activation URL in
    // the error, so surface it rather than a stack trace — it turns the fix
    // into a single tap instead of a console hunt.
    if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(msg)) {
      const found = msg.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/analyticsdata\.googleapis\.com\/overview\?project=\d+/)
        ?? msg.match(/https:\/\/console\.cloud\.google\.com\/apis\/\S+/);
      const project = msg.match(/project[ =](\d{6,})/)?.[1];
      return emptyReport({
        connected: false, reason: 'api_disabled',
        detail: 'The Google Analytics Data API is not enabled in the Cloud project that owns the OAuth client. Enable it once, then reload — no re-authorization needed.',
        actionUrl: found?.[0] ?? `https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview${project ? `?project=${project}` : ''}`,
      }, start, end);
    }

    const detail = /PERMISSION_DENIED|403/i.test(msg)
      ? 'The connected Google account cannot read this property. Either authorize with an account that has access, or add it as a Viewer in GA4 → Admin → Property access management.'
      : /invalid_grant/i.test(msg)
      ? 'The Google authorization was revoked or expired. Reconnect at /api/ga4/connect.'
      : /NOT_FOUND|404/i.test(msg)
      ? 'GA4 property not found — check GA4_PROPERTY_ID is the numeric id.'
      : msg.slice(0, 200);
    return emptyReport({ connected: false, reason: 'bad_key', detail }, start, end);
  }
}
