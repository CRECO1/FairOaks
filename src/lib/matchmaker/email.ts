/**
 * The Matchmaker email: a tenant's search and the listings that fit it, on the approved CRECO email shell (black masthead with the
 * logo, gold-kicker hero, 600px card, stacks on phones — see Marketing/_templates/CRECO-campaign-email-STANDARD.html).
 *
 * Two audiences, one layout:
 *  - 'agent'  — the broker's own alert ("4 new spaces for ABC Dental"), sent by the system to the broker.
 *  - 'client' — the same listings written for the tenant, sent from the broker's own Gmail after the broker has looked at it.
 *               The Gmail pipeline adds the broker's signature itself, so this body ends without one.
 *
 * Pure (no network, no environment): the caller passes the CRM link and the broker. Everything that came from a listing or a contact
 * is escaped, and only http(s) links are ever put in an href.
 */
import { describeCriteria, displayName, FIT_LABEL, possessive, possessiveSuffix, propertyLine, propertyTitle, sourceLabel, type Fit, type MatchResult, type NeedCriteria } from './match';

export interface EmailBroker { name: string; email?: string | null; phone?: string | null; title?: string | null }
export interface MatchEmailInput {
  audience: 'agent' | 'client';
  broker: EmailBroker;
  tenant: { name: string; firstName?: string | null; business?: string | null };
  criteria: NeedCriteria;
  results: MatchResult[];
  /** The broker's own words for the top of a client email. */
  note?: string;
  /** Link into the CRM's Matchmaker (agent email). */
  crmUrl?: string;
  /** More matches exist than are shown (agent email). */
  moreCount?: number;
  /** "New since the last alert" wording instead of "found". */
  isNew?: boolean;
}
export interface MatchEmail { subject: string; html: string; text: string; preheader: string }

const GOLD = '#C9922C';
/** The Gmail send pipeline swaps the marker for the broker's own signature (SIGNATURE_SLOT in lib/agent-signature.ts); with none it is an empty row. */
const SIGNATURE_ROW = '<tr><td style="background:#fff;padding:2px 28px 26px;"><!--agent-signature--></td></tr>';
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u: unknown): string | null => { try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : null; } catch { return null; } };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`;

const FIT_STYLE: Record<Fit, { bg: string; fg: string; bar: string }> = {
  strong: { bg: GOLD, fg: '#1A1A1A', bar: GOLD },
  good: { bg: '#F3E9D2', fg: '#6B4A0E', bar: '#D9BE86' },
  possible: { bg: '#EEEEEF', fg: '#555555', bar: '#D4D4D8' },
};

/** The age caveat repeats on nearly every row (most of the database is a few months old), so it is shown once, not per listing. */
const isAgeCaveat = (c: string) => /^(Added|Last checked) .* ago — confirm/.test(c) || c === 'Availability not confirmed';
/** The caveats are written for the broker; to a client "Couldn’t confirm: medical build-out" reads better as "To confirm: …". */
const clientCaveat = (c: string) => c.replace(/^Couldn’t confirm: /, 'To confirm: ');

function card(r: MatchResult, audience: 'agent' | 'client'): string {
  const p = r.property;
  const fit = FIT_STYLE[r.fit];
  const title = propertyTitle(p);
  const sub = p.address ? displayName(p) : '';
  const listing = safeUrl(p.listing_url);
  const flyer = safeUrl(p.flyer_url) || safeUrl(p.brochure_url);
  const caveats = r.caveats.filter(c => !isAgeCaveat(c)).slice(0, 3).map(c => (audience === 'client' ? clientCaveat(c) : c));
  const why = r.reasons.slice(0, 4);
  const by = [p.listing_company, p.listing_agent_name].filter(Boolean).join(' · ');
  const phone = p.listing_agent_phone ? String(p.listing_agent_phone) : '';
  const btn = (href: string, label: string, primary: boolean) =>
    `<td style="padding:0 8px 8px 0;"><a href="${esc(href)}" style="display:inline-block;padding:9px 16px;border-radius:6px;font-size:14px;font-weight:700;text-decoration:none;${primary ? `background:${GOLD};color:#1A1A1A;` : 'background:#ffffff;color:#1A1A1A;border:1px solid #d4d4d8;'}">${esc(label)}</a></td>`;
  return `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 16px;border:1px solid #ececec;border-left:4px solid ${fit.bar};border-radius:8px;background:#ffffff;">
  <tr><td style="padding:16px 18px 6px;">
    <span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${fit.bg};color:${fit.fg};font-size:11.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;">${esc(FIT_LABEL[r.fit])}</span>
    <span style="display:inline-block;margin-left:6px;padding:3px 9px;border-radius:12px;background:#f4f4f5;color:#777;font-size:11.5px;font-weight:600;">${esc(sourceLabel(p))}</span>
  </td></tr>
  <tr><td style="padding:2px 18px 0;font-size:18px;font-weight:700;color:#1a1a1a;line-height:1.3;">${esc(title)}</td></tr>
  ${sub ? `<tr><td style="padding:1px 18px 0;font-size:14px;color:#888;">${esc(sub)}</td></tr>` : ''}
  <tr><td style="padding:4px 18px 10px;font-size:15px;color:#555;line-height:1.5;">${esc(propertyLine(p))}</td></tr>
  ${why.length ? `<tr><td style="padding:0 18px 8px;font-size:14.5px;color:#333;line-height:1.55;">${why.map(w => `<div style="padding:1px 0 1px 20px;text-indent:-20px;"><span style="color:#2e7d32;font-weight:700;">&#10003;</span>&nbsp; ${esc(w)}</div>`).join('')}</td></tr>` : ''}
  ${caveats.length ? `<tr><td style="padding:0 18px 8px;font-size:13px;color:#9a6a00;line-height:1.5;">${caveats.map(c => `<div style="padding:0 0 0 14px;text-indent:-14px;">&bull;&nbsp; ${esc(c)}</div>`).join('')}</td></tr>` : ''}
  ${listing || flyer ? `<tr><td style="padding:4px 18px 4px;"><table cellpadding="0" cellspacing="0" role="presentation"><tr>${listing ? btn(listing, 'View listing', true) : ''}${flyer ? btn(flyer, 'Flyer / brochure', !listing) : ''}</tr></table></td></tr>` : ''}
  ${by || phone ? `<tr><td style="padding:2px 18px 14px;font-size:13px;color:#888;line-height:1.5;">Listed by ${esc(by || 'the listing broker')}${phone ? ` &middot; <a href="${esc(telHref(phone))}" style="color:#888;text-decoration:underline;">${esc(phone)}</a>` : ''}</td></tr>` : '<tr><td style="padding:0 0 10px;font-size:1px;line-height:1px;">&nbsp;</td></tr>'}
</table>`;
}

const AGE_NOTE = 'Many of these listings were added a few months ago, so each one needs a quick confirmation that it is still available.';

export function buildMatchEmail(i: MatchEmailInput): MatchEmail {
  const n = i.results.length;
  const first = (i.audience === 'agent' ? i.broker.name : i.tenant.firstName || i.tenant.name).split(' ')[0] || 'there';
  const who = i.tenant.business || i.tenant.name;
  const crit = describeCriteria(i.criteria);
  const oldOnes = i.results.filter(r => r.caveats.some(isAgeCaveat)).length;

  const c = i.criteria;
  const short = [c.assetTypes.join('/'), c.sizeMin && c.sizeMax ? `${c.sizeMin.toLocaleString('en-US')}–${c.sizeMax.toLocaleString('en-US')} SF` : '', c.areas[0]].filter(Boolean).join(', ');
  const subject = i.audience === 'agent'
    ? `${plural(n, i.isNew ? 'new space' : 'space')} for ${who} (Matchmaker)`
    : `${plural(n, 'space')} that fit${n === 1 ? 's' : ''} your search${short ? ` — ${short}` : ''}`.slice(0, 150);
  const preheader = i.audience === 'agent'
    ? `${crit || 'Matches from your Property DB'}`
    : `Hand-picked from the listings we track — with why each one fits.`;

  const kicker = i.audience === 'agent' ? 'Matchmaker · Tenant search' : 'Space search · Hand-picked for you';
  const headline = i.audience === 'agent'
    ? `${plural(n, i.isNew ? 'new space' : 'space')} for ${esc(who)}`
    : `${n === 1 ? 'A space' : `${n} spaces`} that fit${n === 1 ? 's' : ''}<br />what you&rsquo;re looking for`;

  const intro = i.audience === 'agent'
    ? `<p style="margin:0 0 14px;font-size:16.9px;color:#555;line-height:1.68;">Hi ${esc(first)}, the Matchmaker ${i.isNew ? 'found new listings' : 'pulled these listings'} that fit <strong style="color:#1a1a1a;">${esc(who)}</strong>${possessiveSuffix(who).replace('’', '&rsquo;')} search.</p>`
    : (i.note?.trim()
      ? i.note.trim().split(/\n{2,}/).map(par => `<p style="margin:0 0 14px;font-size:16.9px;color:#555;line-height:1.68;">${esc(par).replace(/\n/g, '<br />')}</p>`).join('')
      : `<p style="margin:0 0 14px;font-size:16.9px;color:#555;line-height:1.68;">Hi ${esc(first)}, I went through the listings we track and pulled the spaces closest to what you described. For each one I&rsquo;ve noted why it fits and anything we still need to confirm.</p>`);
  const critBox = crit ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 22px;"><tr><td style="background:#f8f6f1;border-left:3px solid ${GOLD};border-radius:4px;padding:11px 14px;font-size:14.5px;color:#555;line-height:1.5;"><strong style="color:#1a1a1a;">Search:</strong> ${esc(crit)}</td></tr></table>` : '';

  const cards = i.results.map(r => card(r, i.audience)).join('');
  const ageNote = oldOnes ? `<p style="margin:0 0 6px;font-size:13.5px;color:#888;line-height:1.6;">${AGE_NOTE}</p>` : '';
  const more = i.audience === 'agent' && i.moreCount && i.moreCount > 0 ? `<p style="margin:6px 0 0;font-size:14.5px;color:#555;">+ ${plural(i.moreCount, 'more match', 'more matches')} in Matchmaker.</p>` : '';

  const crmUrl = safeUrl(i.crmUrl);
  const cta = i.audience === 'agent'
    ? `<table cellpadding="0" cellspacing="0" role="presentation"><tr><td class="btn" style="background:${GOLD};border-radius:6px;padding:14px 26px;"><a href="${esc(crmUrl || 'https://www.fairoaksrealtygroup.com/crm/commercial')}" style="color:#1A1A1A;font-weight:700;text-decoration:none;font-size:16px;">Open Matchmaker</a></td></tr></table>
       <p style="margin:18px 0 0;font-size:14.5px;color:#777;line-height:1.6;">To send these to ${esc(who)}, use <strong>Email to ${esc(i.tenant.firstName || i.tenant.name)}</strong> in Matchmaker &mdash; you&rsquo;ll see the email first and it goes from your own Gmail.</p>`
    : `<p style="margin:0;font-size:16.9px;color:#555;line-height:1.68;">Want to tour any of these? Just reply to this email${i.broker.phone ? ` or call/text me at <a href="${esc(telHref(i.broker.phone))}" style="color:${GOLD};text-decoration:none;font-weight:700;">${esc(i.broker.phone)}</a>` : ''}, and I&rsquo;ll set it up.</p>`;

  const footer = i.audience === 'agent'
    ? `<strong style="color:${GOLD};letter-spacing:.5px;">CRECO &mdash; Matchmaker${i.isNew ? ' alert' : ''}</strong><br/>${i.isNew ? `You&rsquo;re getting this because &ldquo;Email me new matches&rdquo; is on for ${esc(who)}. Turn it off any time in Matchmaker.` : `You asked Matchmaker to email you a copy of these matches for ${esc(who)}. Nothing was sent to them.`}<br/>Listings come from your Property DB (broker emails and marketplace alerts); confirm availability with the listing broker before you promise anything.`
    : `<strong style="color:${GOLD};letter-spacing:.5px;">CRECO &mdash; Commercial Real Estate Company</strong><br/>Availability, pricing and terms come from public listings and broker emails and aren&rsquo;t guaranteed. I&rsquo;ll confirm the details with each listing broker before you tour.`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${esc(subject)}</title><style type="text/css">
    table.card { width: 100% !important; max-width: 600px !important; }
    img { max-width: 100% !important; height: auto !important; }
    @media only screen and (max-width: 600px) {
      .wrap { padding: 12px 0 !important; }
      .card { border-radius: 0 !important; }
      .navbar { padding: 18px 20px !important; }
      .logo { display: block !important; text-align: center !important; }
      .logo img { margin: 0 auto !important; }
      .navlinks { display: block !important; text-align: center !important; padding-top: 14px !important; font-size: 12px !important; white-space: normal !important; }
      .hero { padding: 22px 20px 28px !important; }
      .hero h1 { font-size: 22px !important; line-height: 1.3 !important; }
      .kicker { font-size: 11px !important; letter-spacing: 1.6px !important; }
      .body { padding: 26px 20px 8px !important; }
      .cta { padding: 8px 20px 26px !important; }
      .btn { display: block !important; text-align: center !important; }
      .foot { padding: 18px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'DM Sans',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#f4f4f5;">${esc(preheader)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" class="wrap" role="presentation" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" class="card" role="presentation" style="background:#ffffff;border-radius:10px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td class="navbar" style="background:#111111;padding:20px 28px;border-bottom:2px solid ${GOLD};">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
            <td class="logo" style="vertical-align:middle;"><a href="https://www.crecotx.com"><img src="https://www.crecotx.com/images/creco-logo-email.png" alt="CRECO &mdash; Commercial Real Estate Company" width="172" style="display:block;border:0;width:172px;height:auto;" /></a></td>
            <td class="navlinks" align="right" style="vertical-align:middle;font-family:'DM Sans',Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:0.3px;white-space:nowrap;">
              <a href="https://www.crecotx.com/listings" style="color:#eaeaea;text-decoration:none;">Properties</a><span style="color:#5a5a5a;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span><a href="https://www.crecotx.com/contact" style="color:#eaeaea;text-decoration:none;">Contact</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td class="hero" style="background:#1A1A1A;padding:30px 28px 34px;">
          <p class="kicker" style="margin:0 0 13px;font-size:12px;font-weight:700;letter-spacing:2px;color:${GOLD};text-transform:uppercase;">${esc(kicker)}</p>
          <h1 style="margin:0;font-size:25px;color:#ffffff;font-weight:700;line-height:1.28;">${headline}</h1>
        </td></tr>
        <tr><td class="body" style="background:#fff;padding:34px 28px 10px;">
          ${intro}
          ${critBox}
          ${cards}
          ${ageNote}
          ${more}
        </td></tr>
        <tr><td class="cta" style="background:#fff;padding:20px 28px 30px;">
          ${cta}
        </td></tr>
        ${i.audience === 'client' ? SIGNATURE_ROW : ''}
        <tr><td class="foot" style="background:#f8f9fa;padding:22px 40px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.7;">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const lines: string[] = [];
  lines.push(i.audience === 'agent' ? `Hi ${first}, the Matchmaker ${i.isNew ? 'found new listings' : 'pulled these listings'} that fit ${possessive(who)} search.` : (i.note?.trim() || `Hi ${first}, I pulled the spaces closest to what you described.`));
  if (crit) lines.push('', `Search: ${crit}`);
  for (const r of i.results) {
    const p = r.property;
    lines.push('', `${propertyTitle(p)} (${FIT_LABEL[r.fit]})`, propertyLine(p));
    for (const w of r.reasons.slice(0, 4)) lines.push(`  + ${w}`);
    for (const c of r.caveats.filter(c => !isAgeCaveat(c)).slice(0, 3)) lines.push(`  ? ${i.audience === 'client' ? clientCaveat(c) : c}`);
    const l = safeUrl(p.listing_url); if (l) lines.push(`  ${l}`);
    const by = [p.listing_company, p.listing_agent_name, p.listing_agent_phone].filter(Boolean).join(' · '); if (by) lines.push(`  Listed by ${by}`);
  }
  if (oldOnes) lines.push('', AGE_NOTE);
  if (i.audience === 'agent' && crmUrl) lines.push('', `Open Matchmaker: ${crmUrl}`);
  return { subject, html, text: lines.join('\n'), preheader };
}
