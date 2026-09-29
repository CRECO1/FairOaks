/**
 * Server-side bot screening for the public lead-capture endpoints.
 *
 * reCAPTCHA stays exactly as it is — it deliberately fails OPEN when no token
 * arrives, so a visitor whose ad-blocker strips the script is never turned away.
 * That also means a script posting straight at an endpoint sails through it,
 * which is how a run of scripted submissions landed on 09-23/24 ("VDaQZLEHkjmteyqoa",
 * "Gxzarb Pdbzdt", …). These checks close that hole without touching reCAPTCHA:
 *
 *  - HONEYPOT: the hidden `website` field (components/Honeypot.tsx). Filled = bot.
 *  - FILL TIME: `elapsed_ms` is MANDATORY. A missing or non-numeric value fails
 *    exactly like an impossibly fast one — otherwise omitting the field is a
 *    one-field bypass (the same hole elkhornpoint's /api/inquiry closed). Every
 *    form on this site sends it via attributionPayload()/formElapsedMs().
 *  - GIBBERISH NAME: keyboard-mash / random-character names. Tuned against every
 *    name in the CRM (1,222 real, 9 bots): 9/9 caught, 0 false positives.
 *
 * A blocked submission gets the same success response a real one would, so the
 * bot has no signal to adapt to, and nothing is stored. Every block is logged
 * with the name and email so a false positive can be found in the Vercel logs
 * and recovered by hand.
 *
 * public.lead_name_is_gibberish() in supabase/lead-definition-and-bot-filter.sql
 * mirrors gibberishNameReason() so the dashboards exclude the same rows. Change
 * both together.
 */

/** Below this, the form was not filled in by a person. Matches elkhornpoint. */
export const MIN_FILL_MS = 2500;

// Two-consonant openings that real names start with, across the languages our
// clients' names actually come in. Only consulted when EVERY word of a name opens
// with a consonant pair, so a single unusual surname can never trip it.
const ONSETS = new Set((
  'bl br ch cl cr dr fl fr gl gr kl kn kr ph pl pr sc sh sk sl sm sn sp st sw th tr tw wh wr ' +
  'ts tz zh sz cz dz zb zd zv zw dw gw kw sv vl vr hr bh dh gh jh kh rh sr mc mb nd ng nk ' +
  'dm ps pt pf fj bj tk gn kv hv wl ll sq pn mn ck cw'
).split(' '));
const VOWEL = /[aeiouy]/;

/** Why a name looks machine-generated, or null when it looks like a person's. */
export function gibberishNameReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const tokens = name.split(/[\s\-'’.,]+/).map(t => t.replace(/[^A-Za-z]/g, '')).filter(Boolean);
  if (!tokens.length) return null;

  for (const t of tokens) {
    const lower = t.toLowerCase();
    // "VDaQZLEHkjmteyqoa": capitals scattered through the word. McDonald / DeLaCruz
    // have at most two after the first letter; ALL-CAPS names are left alone.
    if (t.length >= 6 && t !== t.toUpperCase() && (t.slice(1).match(/[A-Z]/g) ?? []).length >= 3) {
      return 'mixed-case';
    }
    // "Pdbzdt": a five-plus letter word with no vowel at all (y counts as one).
    if (t.length >= 5 && !VOWEL.test(lower)) return 'no-vowels';
    // Six consonants in a row. Hirschfeld peaks at five.
    if (/[^aeiouy]{6,}/.test(lower)) return 'consonant-run';
  }

  // "Rzlyuoh Rqmcowk": every word opens on a pair no name starts with.
  if (tokens.length >= 2 && tokens.every(t => {
    if (t.length < 4) return false;
    const p = t.slice(0, 2).toLowerCase();
    return !VOWEL.test(p[0]) && !VOWEL.test(p[1]) && !ONSETS.has(p);
  })) {
    return 'impossible-onsets';
  }
  return null;
}

export interface ScreenOptions {
  /** Log prefix, e.g. 'leads'. */
  route: string;
  /** Browser forms: enforce the honeypot and the mandatory fill time. */
  browserForm: boolean;
  /** Every name-like field on the submission. */
  names: unknown[];
  email?: unknown;
}

/** Returns the block reason, or null when the submission may proceed. Logs every block. */
export function screenSubmission(body: Record<string, unknown>, opts: ScreenOptions): string | null {
  let reason: string | null = null;

  if (opts.browserForm) {
    if (typeof body.website === 'string' && body.website.trim().length > 0) {
      reason = 'honeypot';
    } else {
      const elapsed = Number(body.elapsed_ms);
      if (body.elapsed_ms === undefined || body.elapsed_ms === null || !Number.isFinite(elapsed)) {
        reason = 'fill-time-missing';
      } else if (elapsed < MIN_FILL_MS) {
        reason = `fill-time-${Math.round(elapsed)}ms`;
      }
    }
  }

  if (!reason) {
    for (const n of opts.names) {
      const why = gibberishNameReason(n);
      if (why) { reason = `gibberish-name:${why}`; break; }
    }
  }

  if (reason) {
    const name = opts.names.find(n => typeof n === 'string' && n.trim()) as string | undefined;
    console.warn(`[bot-guard] blocked ${opts.route} submission: ${reason}`,
      JSON.stringify({ name: name?.slice(0, 120) ?? null, email: typeof opts.email === 'string' ? opts.email.slice(0, 200) : null }));
  }
  return reason;
}
