/**
 * The emailed Fair Oaks market report, built from the same live MLS module as
 * /market-reports (lib/market-snapshot.ts) — same figures, same narrative, same
 * "asking prices only / as-of / source" framing.
 *
 * A campaign opts in by putting merge tokens in its stored subject/body:
 *   {{market_report}}        the report itself (narrative, figures, area table, method note)
 *   {{report_month}}         e.g. "October 2026"
 *   {{report_headline}}      the narrative headline, e.g. for the subject line
 * The campaign cron fills them at SEND time from a fresh snapshot, so a report sent
 * next month carries next month's numbers — never a stale copy pasted into the body.
 * If the feed can't be reached, the cron holds the send rather than mailing an empty
 * report.
 *
 * MARKET_REPORT_CAMPAIGN_TEMPLATE is the stored body of the "Fair Oaks Market Report"
 * campaign: greeting, the report, a valuation CTA, Zack's signature, and the CAN-SPAM
 * footer (physical address + {{unsubscribe_url}}), which the cron fills per recipient.
 */
import { getMarketSnapshot, marketStory, MIN_SAMPLE, type MarketSnapshot } from '@/lib/market-snapshot';

const SITE = 'https://www.fairoaksrealtygroup.com';
const INK = '#1A1A1A';
const MUTED = '#5F5F5F';
const GOLD = '#A68B4B';
const RULE = '#E8DCC4';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const usd = (n: number | null) => (n === null ? '&mdash;' : `$${Math.round(n).toLocaleString('en-US')}`);
const pct = (r: number | null) => (r === null ? '&mdash;' : `${Math.round(r * 100)}%`);

const monthLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' });
const dateLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });

export const MARKET_REPORT_TOKENS = ['{{market_report}}', '{{report_month}}', '{{report_headline}}'] as const;

export function usesMarketReport(...templates: (string | null | undefined)[]): boolean {
  return templates.some(t => !!t && MARKET_REPORT_TOKENS.some(tok => t.includes(tok)));
}

/** The {{market_report}} block: email-safe tables with inline styles. */
export function renderMarketReportBlock(s: MarketSnapshot): string {
  const story = marketStory(s);
  const home = s.areas[0];
  const p = (html: string, extra = '') =>
    `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK};${extra}">${html}</p>`;

  const stat = (label: string, value: string) =>
    `<td width="33%" style="padding:12px 8px;text-align:center;border:1px solid ${RULE};font-family:Arial,Helvetica,sans-serif">` +
    `<div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;color:${INK}">${value}</div>` +
    `<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};margin-top:4px">${label}</div></td>`;

  const rows = s.areas.map(a =>
    `<tr>` +
    `<td style="padding:8px;border-top:1px solid ${RULE}"><a href="${SITE}${a.area.href}" style="color:${INK};font-weight:bold;text-decoration:none">${esc(a.area.label)}</a></td>` +
    `<td style="padding:8px;border-top:1px solid ${RULE};text-align:right">${a.forSale.toLocaleString('en-US')}</td>` +
    `<td style="padding:8px;border-top:1px solid ${RULE};text-align:right">${a.underContract.toLocaleString('en-US')} (${pct(a.underContractShare)})</td>` +
    `<td style="padding:8px;border-top:1px solid ${RULE};text-align:right">${usd(a.medianAskingPrice)}</td>` +
    `<td style="padding:8px;border-top:1px solid ${RULE};text-align:right">${a.medianDaysListed === null ? '&mdash;' : a.medianDaysListed}</td>` +
    `<td style="padding:8px;border-top:1px solid ${RULE};text-align:right">${pct(a.priceCutShare)}</td>` +
    `</tr>`).join('');

  return [
    `<h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:${INK}">${esc(story.headline)}</h1>`,
    p(esc(story.dek), `color:${MUTED};font-size:16px`),
    p(esc(story.body)),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 18px">` +
      `<tr>${stat('Homes for sale', home.forSale.toLocaleString('en-US'))}${stat('Under contract', `${home.underContract} (${pct(home.underContractShare)})`)}${stat('Median asking', usd(home.medianAskingPrice))}</tr>` +
      `<tr>${stat('Asking $ / sq ft', usd(home.medianPricePerSqft))}${stat('Median days listed', home.medianDaysListed === null ? '&mdash;' : String(home.medianDaysListed))}${stat('With a price cut', home.priceCutShare === null ? '&mdash;' : `${home.priceCutCount} (${pct(home.priceCutShare)})`)}</tr>` +
    `</table>`,
    `<h2 style="margin:22px 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:${INK}">Across the Hill Country</h2>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK}">` +
      `<tr style="color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.05em">` +
      `<td style="padding:6px 8px">Area</td><td style="padding:6px 8px;text-align:right">For sale</td><td style="padding:6px 8px;text-align:right">Under contract</td>` +
      `<td style="padding:6px 8px;text-align:right">Median asking</td><td style="padding:6px 8px;text-align:right">Days listed</td><td style="padding:6px 8px;text-align:right">Price cut</td></tr>` +
      rows +
    `</table>`,
    `<ul style="margin:18px 0;padding-left:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${INK}">` +
      story.points.map(pt => `<li style="margin-bottom:6px">${esc(pt)}</li>`).join('') +
    `</ul>`,
    p(
      `<strong>About these numbers:</strong> Live from the San Antonio Board of REALTORS&reg; (SABOR) MLS, data as of ${dateLabel(s.asOf)}. ` +
      `Residential listings; all prices are <em>asking</em> prices. Under contract = Active Under Contract or Pending. ` +
      `A price cut is a home now asking less than its original list price. Medians need at least ${MIN_SAMPLE} listings. ` +
      `Sold prices aren&rsquo;t included &mdash; Texas doesn&rsquo;t require them to be disclosed, and the MLS feed available to us covers only homes on the market or under contract. ` +
      `Cordillera Ranch homes are also counted in Boerne. Information deemed reliable but not guaranteed.`,
      `font-size:12px;color:${MUTED};border-top:1px solid ${RULE};padding-top:12px`,
    ),
  ].join('\n');
}

export interface MarketReportMerge {
  html: string;
  month: string;
  headline: string;
}

/** A fresh snapshot rendered for the merge tokens; null if the feed can't be reached. */
export async function getMarketReportMerge(): Promise<MarketReportMerge | null> {
  // No revalidate: a send must use the numbers as of the send, not a cached render.
  const snapshot = await getMarketSnapshot(0);
  if (!snapshot) return null;
  return { html: renderMarketReportBlock(snapshot), month: monthLabel(snapshot.asOf), headline: marketStory(snapshot).headline };
}

export function applyMarketReport(template: string, m: MarketReportMerge): string {
  return template
    .replaceAll('{{market_report}}', m.html)
    .replaceAll('{{report_month}}', esc(m.month))
    .replaceAll('{{report_headline}}', esc(m.headline));
}

export const MARKET_REPORT_CAMPAIGN_SUBJECT = '{{report_headline}} — {{report_month}} market report';

export const MARKET_REPORT_CAMPAIGN_TEMPLATE = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F7F5F2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5F2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-top:4px solid ${GOLD}">
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif">
  <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${GOLD};font-weight:bold">Fair Oaks Realty Group &middot; Market Report &middot; {{report_month}}</div>
</td></tr>
<tr><td style="padding:12px 28px 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK}">
  <p style="margin:0 0 16px">Hi {{first_name}},</p>
  <p style="margin:0 0 20px">Here&rsquo;s this month&rsquo;s look at the Fair Oaks Ranch and Hill Country housing market, straight from the MLS.</p>
</td></tr>
<tr><td style="padding:0 28px">
{{market_report}}
</td></tr>
<tr><td style="padding:8px 28px 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK}">
  <p style="margin:0 0 16px">Asking prices tell half the story &mdash; what a home actually sells for depends on the house. If you&rsquo;re curious what yours would bring in today&rsquo;s market, I&rsquo;ll put together a free valuation from recent nearby sales.</p>
  <p style="margin:0 0 22px"><a href="${SITE}/home-valuation?from=market-report-email" style="display:inline-block;background:${GOLD};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px">What&rsquo;s my home worth?</a>
  &nbsp; <a href="${SITE}/market-reports" style="color:${GOLD};font-weight:bold">See the live report</a></p>
  <p style="margin:0">Zachary A. Stovall<br><span style="color:${MUTED}">Broker / Owner &middot; Fair Oaks Realty Group<br>210-390-9997 &middot; info@fairoaksrealtygroup.com</span></p>
</td></tr>
<tr><td style="padding:24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:${MUTED};border-top:1px solid ${RULE}">
  You&rsquo;re receiving this because you signed up for the Fair Oaks Realty Group market report.<br>
  Fair Oaks Realty Group &middot; 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015 &middot; TREC #9014367<br>
  <a href="{{unsubscribe_url}}" style="color:${MUTED}">Unsubscribe</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
