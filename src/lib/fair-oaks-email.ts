/**
 * The Fair Oaks Realty Group email shell — one place for the residential brand,
 * so every client-facing email looks like the site: the tree logo, gold #C9A962
 * on near-black, serif headings, and a signature block with the residential
 * business line and Suite 102.
 *
 * Residential only. CRECO email keeps its own shell (crecotx.com logo, its gold,
 * Suite 100, 210-817-3443) — the two brands must never mix in one message.
 */
const GOLD = '#C9A962';
const INK = '#1A1A1A';
const CREAM = '#F5F0E6';
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Arial,Helvetica,sans-serif';

export const FAIR_OAKS_BRAND = {
  name: 'Fair Oaks Realty Group',
  phone: '210-390-9997',
  phoneHref: 'tel:+12103909997',
  email: 'info@fairoaksrealtygroup.com',
  address: '8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015',
  site: 'https://www.fairoaksrealtygroup.com',
  logo: 'https://www.fairoaksrealtygroup.com/images/logo.png',
  broker: { name: 'Zachary A. Stovall', title: 'Broker' },
} as const;

export interface FairOaksEmailOptions {
  /** Inbox preview line. */
  preheader: string;
  /** Serif headline at the top of the card. */
  heading: string;
  /** Body paragraphs as HTML strings (already escaped). */
  paragraphs: string[];
  cta?: { label: string; href: string };
  /** Footer line explaining why they got it (CAN-SPAM). */
  reason: string;
  /** Include an unsubscribe link ({{unsubscribe_url}} is filled at send time). */
  unsubscribe?: boolean;
}

export function fairOaksEmail(o: FairOaksEmailOptions): string {
  const B = FAIR_OAKS_BRAND;
  const body = o.paragraphs
    .map(p => `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.65;color:#4B5563;">${p}</p>`)
    .join('\n        ');
  const cta = o.cta
    ? `<div style="margin:26px 0 8px;"><a href="${o.cta.href}" style="display:inline-block;background:${GOLD};color:${INK};text-decoration:none;padding:14px 30px;border-radius:8px;font-family:${SANS};font-size:15px;font-weight:bold;">${o.cta.label}</a></div>`
    : '';
  return `<div style="display:none;font-size:1px;color:#FFFFFF;max-height:0;overflow:hidden;">${o.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E8E2D6;">
      <tr><td align="center" style="background:#FFFFFF;padding:26px 32px 8px;">
        <img src="${B.logo}" alt="${B.name}" width="88" style="display:block;width:88px;height:auto;border:0;" />
      </td></tr>
      <tr><td style="padding:8px 32px 0;">
        <h1 style="margin:0 0 16px;font-family:${SERIF};font-size:23px;line-height:1.3;color:${INK};font-weight:bold;">${o.heading}</h1>
        ${body}
        ${cta}
      </td></tr>
      <tr><td style="padding:22px 32px 0;">
        <div style="border-top:2px solid ${GOLD};padding-top:16px;font-family:${SANS};font-size:14px;line-height:1.6;color:#4B5563;">
          <strong style="color:${INK};">${B.broker.name}</strong><br />
          ${B.broker.title} · ${B.name}<br />
          <a href="${B.phoneHref}" style="color:#A68B4B;text-decoration:none;">${B.phone}</a> ·
          <a href="mailto:${B.email}" style="color:#A68B4B;text-decoration:none;">${B.email}</a>
        </div>
      </td></tr>
      <tr><td style="padding:20px 32px 26px;">
        <div style="font-family:${SANS};font-size:11px;line-height:1.6;color:#9CA3AF;">
          ${B.name} · ${B.address}<br />
          ${o.reason}${o.unsubscribe ? `<br /><a href="{{unsubscribe_url}}" style="color:#9CA3AF;text-decoration:underline;">Unsubscribe</a>` : ''}
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
