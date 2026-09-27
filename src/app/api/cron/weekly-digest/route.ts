/**
 * GET /api/cron/weekly-digest — the Monday morning lead summary.
 *
 * One email that answers "what came in last week, and where from", so the
 * answer does not depend on anyone remembering to open the dashboard.
 *
 * The numbers come from weekly_lead_digest() in Postgres rather than being
 * counted here. Two reasons: PostgREST caps a .select() at 1000 rows whatever
 * .limit() says, so counting in JS silently under-reports as the tables grow
 * (that has already happened once in this codebase), and the RPC reuses the
 * exact same inbound/test filters as the attribution dashboard, so the digest
 * and the dashboard cannot drift apart.
 *
 * GA is optional by design. The Data API tap is still outstanding, so the
 * traffic section is included when GA returns data and replaced with a single
 * line when it does not. A missing integration is a configuration state, not
 * an error, and must never cost Zack the rest of the email.
 *
 * A failed send is recorded through crm_integration_status like the other
 * jobs, so it surfaces on the tracking-health watchdog rather than vanishing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';
import { recordIntegrationFailure, recordIntegrationSuccess } from '@/lib/integration-alert';
import { fetchGaReport } from '@/lib/ga4';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FROM_EMAIL  = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';
const ALERT_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@crecotx.com';
const DIGEST_KEY  = 'weekly_digest';

const INK = '#1A1A1A';
const GOLD = '#C9922C';
const MUTE = '#6b7280';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Row = { label: string; n: number };
type Camp = { name: string; sent: number; opens: number; clicks: number };
type Recent = { name: string; created_at: string; site: string; channel: string; campaign: string; no_attribution: boolean };

interface Digest {
  windowDays: number; since: string;
  total: number; priorTotal: number; noAttribution: number; topSource: string | null;
  bySite: Row[]; byChannel: Row[]; bySource: Row[]; byCampaign: Row[];
  campaigns: Camp[]; recent: Recent[];
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

/** "+5 (↑ 56%)" / "−2 (↓ 13%)" / "no change" against the prior seven days. */
function delta(now: number, prior: number): string {
  const d = now - prior;
  if (d === 0) return 'no change on the week before';
  const dir = d > 0 ? '▲' : '▼';
  const rel = prior > 0 ? ` (${dir} ${Math.abs(Math.round((d / prior) * 100))}%)` : '';
  return `${d > 0 ? '+' : '−'}${Math.abs(d)} on the week before${rel}`;
}

function bars(rows: Row[], total: number): string {
  if (!rows.length) return `<p style="margin:0;color:${MUTE};font-size:13px">Nothing recorded.</p>`;
  return rows.map(r => {
    const w = total > 0 ? Math.max(2, Math.round((r.n / total) * 100)) : 0;
    return `<tr>
      <td style="padding:5px 10px 5px 0;font-size:13px;color:${INK};white-space:nowrap">${esc(r.label)}</td>
      <td style="padding:5px 0;width:100%">
        <div style="background:#eee;border-radius:3px;height:8px"><div style="background:${GOLD};width:${w}%;height:8px;border-radius:3px"></div></div>
      </td>
      <td style="padding:5px 0 5px 10px;font-size:13px;font-weight:700;color:${INK};text-align:right">${r.n}</td>
    </tr>`;
  }).join('');
}

function section(title: string, inner: string): string {
  return `<tr><td style="padding:22px 28px 0">
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTE};font-weight:700;margin-bottom:10px">${esc(title)}</div>
    ${inner}
  </td></tr>`;
}

function buildHtml(d: Digest, ga: Awaited<ReturnType<typeof fetchGaReport>> | null): string {
  const since = new Date(d.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
  const to = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });

  const campRows = d.campaigns.length
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px">
        <tr style="color:${MUTE};font-size:11px;text-transform:uppercase;letter-spacing:1px">
          <th align="left" style="padding:4px 0">Campaign</th><th align="right">Sent</th>
          <th align="right">Opens</th><th align="right">Open&nbsp;%</th><th align="right">Clicks</th><th align="right">CTR</th>
        </tr>
        ${d.campaigns.map(c => `<tr style="border-top:1px solid #eee">
          <td style="padding:7px 8px 7px 0;color:${INK}">${esc(String(c.name).slice(0, 46))}</td>
          <td align="right" style="color:${INK}">${c.sent}</td>
          <td align="right" style="color:${INK}">${c.opens}</td>
          <td align="right" style="color:${INK};font-weight:700">${pct(c.opens, c.sent)}</td>
          <td align="right" style="color:${INK}">${c.clicks}</td>
          <td align="right" style="color:${INK}">${pct(c.clicks, c.sent)}</td>
        </tr>`).join('')}
      </table>`
    : `<p style="margin:0;color:${MUTE};font-size:13px">No campaigns sent in this window.</p>`;

  // GA is additive. Absent integration → one line, never a broken section.
  const gaBlock = ga && ga.status.connected && ga.totals
    ? section(`Website traffic · ${esc(ga.label)}`, `
        <table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px">
          <tr>
            <td style="padding:6px 0;color:${INK}"><strong>${ga.totals.sessions.toLocaleString()}</strong> sessions</td>
            <td style="padding:6px 0;color:${INK}"><strong>${ga.totals.users.toLocaleString()}</strong> users</td>
            <td style="padding:6px 0;color:${INK}"><strong>${(ga.totals.conversionRate * 100).toFixed(1)}%</strong> conv.</td>
          </tr>
        </table>
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTE};margin:12px 0 6px">Top sources</div>
        <table role="presentation" width="100%" style="border-collapse:collapse">
          ${bars(ga.bySourceMedium.slice(0, 5).map(r => ({ label: r.label, n: r.value })), ga.totals.sessions)}
        </table>
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTE};margin:12px 0 6px">Top pages</div>
        <table role="presentation" width="100%" style="border-collapse:collapse">
          ${bars(ga.landingPages.slice(0, 5).map(r => ({ label: r.label, n: r.value })), ga.totals.sessions)}
        </table>`)
    : section('Website traffic', `<p style="margin:0;color:${MUTE};font-size:13px">
        Google Analytics isn't returning data yet — connect it on the Lead Attribution page and traffic will appear here next week.
      </p>`);

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2">
  <table role="presentation" width="100%" style="background:#f4f4f2;padding:24px 12px">
   <tr><td align="center">
    <table role="presentation" width="640" style="max-width:640px;width:100%;background:#fff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">

      <tr><td style="background:${INK};padding:26px 28px">
        <div style="color:${GOLD};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700">Weekly lead digest</div>
        <div style="color:#fff;font-size:22px;font-weight:700;margin-top:6px">${esc(since)} – ${esc(to)}</div>
      </td></tr>

      <tr><td style="padding:26px 28px 0">
        <div style="font-size:46px;font-weight:700;color:${INK};line-height:1">${d.total}</div>
        <div style="font-size:14px;color:${MUTE};margin-top:4px">
          new inbound lead${d.total === 1 ? '' : 's'} · ${esc(delta(d.total, d.priorTotal))}
        </div>
        ${d.topSource ? `<div style="margin-top:12px;padding:10px 14px;background:#fffbf2;border-left:3px solid ${GOLD};font-size:13px;color:${INK}">
          Top source this week: <strong>${esc(d.topSource)}</strong>
        </div>` : ''}
        ${d.noAttribution > 0 ? `<div style="margin-top:8px;font-size:12.5px;color:${MUTE}">
          ${d.noAttribution} of ${d.total} arrived with no attribution recorded — those can't be traced to a campaign.
        </div>` : ''}
      </td></tr>

      ${section('By site', `<table role="presentation" width="100%" style="border-collapse:collapse">${bars(d.bySite, d.total)}</table>`)}
      ${section('By channel', `<table role="presentation" width="100%" style="border-collapse:collapse">${bars(d.byChannel, d.total)}</table>`)}
      ${section('By source', `<table role="presentation" width="100%" style="border-collapse:collapse">${bars(d.bySource, d.total)}</table>`)}
      ${section('By campaign', `<table role="presentation" width="100%" style="border-collapse:collapse">${bars(d.byCampaign, d.total)}</table>`)}
      ${section('Email campaign performance', campRows)}
      ${gaBlock}

      ${d.recent.length ? section('Most recent leads', `
        <table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px">
          ${d.recent.slice(0, 10).map(r => `<tr style="border-top:1px solid #eee">
            <td style="padding:7px 8px 7px 0;color:${INK}">${esc(r.name)}</td>
            <td style="padding:7px 0;color:${MUTE}">${esc(r.site)}</td>
            <td style="padding:7px 0;color:${MUTE}">${esc(r.campaign)}</td>
            <td align="right" style="padding:7px 0;color:${MUTE};white-space:nowrap">${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })}</td>
          </tr>`).join('')}
        </table>`) : ''}

      <tr><td style="padding:26px 28px 30px">
        <a href="https://www.fairoaksrealtygroup.com/crm#lead-attribution"
           style="display:inline-block;background:${GOLD};color:${INK};padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
           Open the Lead Attribution dashboard
        </a>
        <p style="margin:16px 0 0;color:#9ca3af;font-size:11px">
          Automated Monday digest · last ${d.windowDays} days · counts exclude test rows and imported prospect lists.
        </p>
      </td></tr>

    </table>
   </td></tr>
  </table></body></html>`;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 7), 1), 90);
  const dryRun = req.nextUrl.searchParams.get('dry') === '1';

  try {
    const db = adminClient();
    const { data, error } = await db.rpc('weekly_lead_digest', { days });
    if (error) throw new Error(`digest query failed: ${error.message}`);
    const digest = data as Digest;

    // GA is best-effort: never let it fail the email.
    let ga: Awaited<ReturnType<typeof fetchGaReport>> | null = null;
    try { ga = await fetchGaReport(days); } catch (e) {
      console.error('[weekly-digest] GA fetch failed, omitting that section:', e);
    }

    const html = buildHtml(digest, ga);
    const subject = `📊 Weekly leads: ${digest.total} new${digest.topSource ? ` · top source ${digest.topSource}` : ''}`;

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, subject, digest, gaConnected: !!ga?.status.connected, htmlBytes: html.length });
    }

    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
    const { error: sendErr } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: FROM_EMAIL, to: ALERT_EMAIL, subject, html,
    });
    if (sendErr) throw new Error(`Resend rejected the digest: ${JSON.stringify(sendErr)}`);

    await recordIntegrationSuccess(DIGEST_KEY);
    return NextResponse.json({ ok: true, sent: true, total: digest.total, gaConnected: !!ga?.status.connected });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[weekly-digest]', msg);
    await recordIntegrationFailure(DIGEST_KEY, `The weekly lead digest did not send: ${msg}`, {
      subject: '⚠️ Weekly lead digest failed',
    });
    return NextResponse.json({ ok: false, error: 'digest failed' }, { status: 500 });
  }
}
