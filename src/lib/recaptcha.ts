/**
 * reCAPTCHA v3 verification for the public forms.
 *
 * Public endpoints were protected by IP rate limiting alone, which a
 * distributed submitter walks straight past. This adds a score check on top.
 *
 * Both keys are read from the environment and BOTH are currently unset in
 * production, so verification is skipped until they are provisioned:
 *
 *   NEXT_PUBLIC_RECAPTCHA_SITE_KEY  — public, used by the browser widget
 *   RECAPTCHA_SECRET_KEY            — server-only, used here
 *
 * Skipping when unconfigured is deliberate: enforcing without a site key would
 * mean the browser has no way to mint a token and every public form would break.
 * Once the pair is set in Vercel, verification turns on with no code change.
 */

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

// Google's guidance: 1.0 is very likely human, 0.0 very likely a bot. 0.5 is the
// documented starting point and can be tuned per action from the admin console.
const MIN_SCORE = 0.5;

export interface RecaptchaResult {
  ok: boolean;
  /** True when no secret is configured, so the check was not performed. */
  skipped: boolean;
  score?: number;
  reason?: string;
}

export async function verifyRecaptcha(
  token: string | undefined | null,
  expectedAction: string,
  ip?: string | null,
): Promise<RecaptchaResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };

  if (!token) return { ok: false, skipped: false, reason: 'missing_token' };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      // Don't punish real users for a Google outage — log and let them through.
      console.error('[recaptcha] siteverify HTTP', res.status);
      return { ok: true, skipped: true, reason: 'verify_unavailable' };
    }

    const data = (await res.json()) as {
      success?: boolean; score?: number; action?: string; 'error-codes'?: string[];
    };

    if (!data.success) {
      return { ok: false, skipped: false, reason: (data['error-codes'] ?? []).join(',') || 'verify_failed' };
    }
    // A token minted for a different action must not be replayed here.
    if (data.action && data.action !== expectedAction) {
      return { ok: false, skipped: false, score: data.score, reason: 'action_mismatch' };
    }
    if (typeof data.score === 'number' && data.score < MIN_SCORE) {
      return { ok: false, skipped: false, score: data.score, reason: 'low_score' };
    }
    return { ok: true, skipped: false, score: data.score };
  } catch (e) {
    console.error('[recaptcha] verification error', e);
    return { ok: true, skipped: true, reason: 'verify_error' };
  }
}

/** 403 body for a rejected submission — deliberately vague to the client. */
export const RECAPTCHA_REJECTED = { error: 'Could not verify this submission. Please try again.' };
