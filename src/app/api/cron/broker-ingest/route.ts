/**
 * GET /api/cron/broker-ingest
 *
 * Weekly Vercel cron: reads recent commercial-real-estate broker "available space"
 * emails from the connected Gmail account (zack@crecotx.com), extracts listings with
 * Claude vision, and inserts new buildings into crm_prospective_properties.
 *
 * Idempotent via normalized-address dedup, so it is safe to run repeatedly.
 * Secured with CRON_SECRET (same pattern as every other cron route).
 *
 * Optional query params (for manual runs):
 *   ?window=newer_than:8d   Gmail recency filter (default newer_than:8d)
 *   ?query=...              override the base Gmail query
 *   ?limit=40               max messages to scan
 */

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { runPipeline } from '@/lib/broker-ingest';
import { geocodeMissing } from '@/lib/broker-ingest/geocode';
import { enrichMissing } from '@/lib/broker-ingest/enrich';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';
// Recipient for broker-ingest failure alerts. Defaults to the owner; override
// per-environment with BROKER_INGEST_ALERT_EMAIL.
const ALERT_EMAIL = process.env.BROKER_INGEST_ALERT_EMAIL ?? 'zack@crecotx.com';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Best-effort failure alert: emails the owner when the crawl fails, so a broken
 * run surfaces immediately instead of only appearing as a failed Vercel cron.
 * Never throws — an email problem must not mask the underlying failure.
 */
async function sendFailureAlert(summary: string, details: string[]): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const items = details.map((d) => `<li style="margin:4px 0;color:#333">${escHtml(d)}</li>`).join('');
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: ALERT_EMAIL,
      subject: '⚠️ Property DB auto-crawl is failing (broker-ingest)',
      html: `
        <div style="font-family:sans-serif;max-width:600px">
          <h2 style="color:#b00020;margin-bottom:4px">Property DB auto-crawl failed</h2>
          <p style="color:#333">${escHtml(summary)}</p>
          <p style="color:#333;margin-bottom:4px"><strong>New broker listings are not being added</strong> until this is resolved.</p>
          <ul style="padding-left:18px">${items}</ul>
          <p style="color:#555">Most common cause: the Anthropic API account is out of credits — check
            <a href="https://console.anthropic.com/settings/billing">Anthropic Plans &amp; Billing</a>.</p>
          <p style="color:#999;font-size:12px">Fair Oaks CRM · GET /api/cron/broker-ingest · runs 4×/day Central</p>
        </div>
      `,
    });
    if (error) console.error('broker-ingest: Resend rejected the alert email:', error);
  } catch (mailErr) {
    console.error('broker-ingest: alert email failed to send:', mailErr);
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  // Default routine: ingest everything the user files into the "Property DB"
  // Gmail folder. The folder is curated + small, so we scan the whole label
  // each run (no recency window); dedup keeps re-scans idempotent. Overridable
  // via ?query / ?window / BROKER_INGEST_QUERY for ad-hoc or broad sweeps.
  const baseQuery = sp.get('query') ?? process.env.BROKER_INGEST_QUERY ?? 'label:"Property DB"';
  const window = sp.get('window') ?? '';
  const query = `${baseQuery} ${window}`.trim();
  const limit = Number(sp.get('limit') ?? 60);

  try {
    const r = await runPipeline({ query, limit, commit: true });

    // Guard: if we scanned emails but extraction failed on (nearly) all of them
    // and nothing was inserted, the pipeline is systemically broken — Anthropic
    // credits exhausted, bad API key, retired model, or API outage — not merely
    // "no new listings". Fail loud (500 + console.error) so the cron registers as
    // failed instead of silently returning 200 with a frozen count, which once
    // hid a multi-day outage (2026-08-14: Anthropic credits ran out).
    const failureRate = r.scanned > 0 ? r.extractErrors / r.scanned : 0;
    if (r.scanned >= 3 && failureRate >= 0.5 && r.inserted === 0) {
      const detail = r.errorSample.length ? ` Sample: ${r.errorSample.join(' | ')}` : '';
      console.error(
        `broker-ingest ALERT: extraction failing — ${r.extractErrors}/${r.scanned} emails errored, 0 inserted.${detail}`,
      );
      await sendFailureAlert(
        `The crawl scanned ${r.scanned} email(s) but extraction failed on ${r.extractErrors} of them and inserted 0 new listings.`,
        r.errorSample.length ? r.errorSample : ['No error detail was captured.'],
      );
      return NextResponse.json(
        {
          error:
            'broker-ingest extraction is failing on nearly every email (0 inserted) — likely Anthropic credits/API key/model. Check Anthropic billing.',
          scanned: r.scanned,
          listings: r.listings,
          nonListings: r.nonListings,
          extractErrors: r.extractErrors,
          inserted: r.inserted,
          dupSkipped: r.dupSkipped,
          errorSample: r.errorSample,
          model: r.model,
        },
        { status: 500 },
      );
    }

    // Geocode + enrich are non-critical polish (map pins, County/Submarket).
    // Never fail or alert the ingest over them — log and continue.
    let geocoded = 0;
    let enriched = 0;
    try {
      geocoded = (await geocodeMissing(25)).geocoded;
      enriched = (await enrichMissing()).enriched;
    } catch (secErr) {
      console.error('broker-ingest: geocode/enrich failed (non-fatal):', secErr);
    }
    return NextResponse.json({
      scanned: r.scanned,
      listings: r.listings,
      nonListings: r.nonListings,
      extractErrors: r.extractErrors,
      inserted: r.inserted,
      dupSkipped: r.dupSkipped,
      photosAdded: r.photosAdded,
      geocoded,
      enriched,
      model: r.model,
    });
  } catch (err) {
    console.error('broker-ingest cron error:', err);
    await sendFailureAlert('The broker-ingest pipeline threw an error before completing.', [
      (err as Error).message ?? 'Unknown error',
    ]);
    return NextResponse.json({ error: (err as Error).message ?? 'ingest failed' }, { status: 500 });
  }
}
