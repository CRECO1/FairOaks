import { randomUUID } from 'crypto';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

// The unsubscribe link, kept on-brand per business unit: CRECO commercial emails point
// at crecotx.com/unsubscribe (a CRECO-branded page on the CRECO site), residential at the
// Fair Oaks handler. Both write to the same CRM database.
export function unsubscribeUrlFor(businessUnit: string | undefined, token: string): string {
  return businessUnit === 'commercial'
    ? `https://www.crecotx.com/unsubscribe?token=${token || ''}`
    : `https://www.fairoaksrealtygroup.com/api/campaigns/unsubscribe?token=${token || ''}`;
}

export function newTrackingId(): string {
  return randomUUID();
}

// Insert a 1×1 open-tracking pixel into an email's HTML (before </body>, else appended).
// When the recipient opens the email the pixel loads /api/track/open?type=action_plan,
// which stamps opened_at / open_count on the matching crm_action_plan_sends row.
export function withOpenPixel(html: string, trackingId: string): string {
  const px = `<img src="${BASE_URL}/api/track/open?type=action_plan&id=${trackingId}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;overflow:hidden" />`;
  return html.includes('</body>') ? html.replace('</body>', px + '</body>') : html + px;
}
