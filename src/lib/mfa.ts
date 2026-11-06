// Two-step verification (TOTP authenticator app) helpers shared by the server and the browser.
//
// Supabase stamps every access token with an assurance level: `aal1` = password only, `aal2` = password + a verified second factor.
// A user who has enrolled a factor must present an aal2 token; a password alone is not enough to read CRM data.

type FactorLike = { status?: string | null; factor_type?: string | null };

/** The assurance level claimed by an access token ("aal1" / "aal2"), or null if it can't be read. Never trusted on its own:
 *  the server only calls this after Supabase has validated the token. */
export function jwtAal(token?: string | null): 'aal1' | 'aal2' | null {
  try {
    const part = (token ?? '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const aal = (JSON.parse(json) as { aal?: string }).aal;
    return aal === 'aal2' ? 'aal2' : aal === 'aal1' ? 'aal1' : null;
  } catch { return null; }
}

export function hasVerifiedFactor(user?: { factors?: FactorLike[] | null } | null): boolean {
  return !!user?.factors?.some(f => f.status === 'verified' && (!f.factor_type || f.factor_type === 'totp'));
}

/** True when this login has a second factor set up but the token was issued without using it. */
export function needsSecondFactor(user: { factors?: FactorLike[] | null } | null | undefined, token?: string | null): boolean {
  return hasVerifiedFactor(user) && jwtAal(token) !== 'aal2';
}
