/**
 * Signed OAuth `state` for the Gmail / social connect flows.
 *
 * The old flows put `userId` in `state` and "protected" it with a nonce that was also a cookie — but both come from
 * the requester's own browser, so an attacker could forge a callback that bound THEIR Google/Facebook account to
 * ANY CRM user. Now `state` is an HMAC-signed, expiring blob, and every callback additionally requires the logged-in
 * session user to equal the user inside it (see verifyOAuthState + getCrmProfileUser at each callback).
 *
 * The key is OAUTH_STATE_SECRET, falling back to TOKEN_ENCRYPTION_KEY (already required in production). There is no
 * built-in fallback: with neither set, signing throws and the flow fails closed.
 */
import crypto from 'crypto';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function key(): Buffer {
  const k = process.env.OAUTH_STATE_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!k || k.length < 16) throw new Error('OAUTH_STATE_SECRET / TOKEN_ENCRYPTION_KEY is not set');
  return crypto.createHash('sha256').update(`oauth-state:${k}`).digest();
}

export interface OAuthStatePayload { uid: string; nonce: string; [extra: string]: unknown }

/** state = base64url(json).base64url(hmac). `ttlSec` defaults to 10 minutes. */
export function signOAuthState(payload: Omit<OAuthStatePayload, 'nonce'> & { nonce?: string }, ttlSec = 600): { state: string; nonce: string } {
  const nonce = payload.nonce ?? crypto.randomBytes(16).toString('hex');
  const body = b64(JSON.stringify({ ...payload, nonce, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = b64(crypto.createHmac('sha256', key()).update(body).digest());
  return { state: `${body}.${sig}`, nonce };
}

/** Verify signature + expiry. Returns the payload or null. Never throws on bad input. */
export function verifyOAuthState(state: string | null | undefined): (OAuthStatePayload & { exp: number }) | null {
  try {
    const [body, sig] = String(state ?? '').split('.');
    if (!body || !sig) return null;
    const want = crypto.createHmac('sha256', key()).update(body).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload & { exp: number };
    if (typeof p.uid !== 'string' || typeof p.nonce !== 'string' || typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}

/** Constant-time equality for the nonce cookie. */
export function nonceMatches(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = Buffer.from(a ?? ''), y = Buffer.from(b ?? '');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
