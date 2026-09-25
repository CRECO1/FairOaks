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
 * Required env (both, or GA is treated as not connected):
 *   GA4_PROPERTY_ID          numeric GA4 property id, e.g. "312345678"
 *                            (Admin → Property details — NOT the G-XXXX tag)
 *   GA4_SERVICE_ACCOUNT_KEY  the service-account JSON key, either raw JSON or
 *                            base64-encoded (Vercel env values are single-line,
 *                            so base64 is usually easier to paste)
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';

export type GaStatus =
  | { connected: true }
  | { connected: false; reason: 'missing_env' | 'bad_key'; detail: string };

export interface GaRow { label: string; value: number; secondary?: number }

export interface GaReport {
  status: GaStatus;
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

export function gaStatus(): GaStatus {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) return { connected: false, reason: 'missing_env', detail: 'GA4_PROPERTY_ID is not set' };
  if (!/^\d+$/.test(propertyId.trim())) {
    return { connected: false, reason: 'bad_key', detail: 'GA4_PROPERTY_ID must be the numeric property id, not the G-XXXXXXX measurement id' };
  }
  const creds = readCredentials();
  if ('error' in creds) return { connected: false, reason: 'missing_env', detail: creds.error };
  return { connected: true };
}

function emptyReport(status: GaStatus, start: string, end: string): GaReport {
  return { status, range: { start, end }, totals: null, byChannel: [], bySourceMedium: [], landingPages: [], byCountryCity: [], byDevice: [] };
}

/**
 * Pull the acquisition picture for the last `days` days. Never throws — a GA
 * outage or a revoked key degrades to the not-connected state so the rest of
 * the dashboard keeps working.
 */
export async function fetchGaReport(days = 30): Promise<GaReport> {
  const start = `${days}daysAgo`;
  const end = 'today';
  const status = gaStatus();
  if (!status.connected) return emptyReport(status, start, end);

  const creds = readCredentials();
  if ('error' in creds) return emptyReport({ connected: false, reason: 'bad_key', detail: creds.error }, start, end);

  const propertyId = (process.env.GA4_PROPERTY_ID ?? '').trim();
  const property = `properties/${propertyId}`;

  try {
    const client = new BetaAnalyticsDataClient({ credentials: creds });
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
      status: { connected: true },
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
    const detail = /PERMISSION_DENIED|403/i.test(msg)
      ? 'The service account cannot read this property. Add its email as a Viewer in GA4 → Admin → Property access management.'
      : /NOT_FOUND|404/i.test(msg)
      ? 'GA4 property not found — check GA4_PROPERTY_ID is the numeric id.'
      : msg.slice(0, 200);
    console.error('[ga4]', msg);
    return emptyReport({ connected: false, reason: 'bad_key', detail }, start, end);
  }
}
