/**
 * Signed contact token for links in OUR campaign emails (`?ctk=<client uuid>.<10-hex mac>`).
 * When a recipient lands on one of our sites from that link, the tracker sends the token and the server
 * links the visitor's anonymous id to the contact — so their website activity shows on the contact card.
 * The MAC means nobody can forge a token to attach a visitor to an arbitrary contact.
 */
import crypto from 'crypto';

function secret(): string {
  const s = process.env.TRACK_LINK_SECRET || process.env.COPILOT_CONFIRM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('track-link: no signing secret available');
  return s;
}

const mac = (clientId: string) => crypto.createHmac('sha256', secret()).update(`ctk:${clientId}`).digest('hex').slice(0, 10);

export function signClientToken(clientId: string): string { return `${clientId}.${mac(clientId)}`; }

/** Returns the client id if the token is genuine, else null. */
export function verifyClientToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{10})$/i.exec(token);
  if (!m) return null;
  const expected = Buffer.from(mac(m[1].toLowerCase()));
  const given = Buffer.from(m[2].toLowerCase());
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return m[1].toLowerCase();
}
