'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle, X } from 'lucide-react';
import { useCaptureSubmit } from '@/lib/use-capture-submit';
import { trackEvent, LEAD_SEEN_KEY } from '@/lib/attribution';
import { Honeypot } from '@/components/Honeypot';
import { formatPrice } from '@/lib/utils';

/**
 * The soft sign-up ask on listing pages.
 *
 * Browsing homes was the site's biggest audience and its quietest one: people
 * paged through listings and left without a trace, because nothing asked who
 * they were until they were ready to book a showing. This asks once they have
 * shown real interest — their third distinct listing — and offers the one thing
 * a browser actually wants: new homes like the ones they are looking at.
 *
 * It is a soft gate. "Maybe later" always works, it asks at most twice (3rd
 * listing, then 7th), and never again once they sign up. The signup is an
 * ordinary listing alert, so /api/listing-alerts does the rest: alert row, CRM
 * contact, follow-up task, and the daily new-listing email.
 */

const VIEWS_KEY = 'forg_listing_views';
const STATE_KEY = 'forg_signup_prompt';
const FIRST_ASK_AT = 3;
const SECOND_ASK_AT = 7;
const SHOW_DELAY_MS = 6000;

type PromptState = { registered?: boolean; dismissals?: number };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode — just don't remember */ }
}

/** Round to a friendly figure so the saved search reads like one a person would set. */
function roundPrice(n: number): number {
  const step = n >= 1_000_000 ? 50_000 : 10_000;
  return Math.round(n / step) * step;
}

interface Props {
  listingId: string;
  city: string;
  price?: number;
  beds?: number;
}

export function ListingSignupPrompt({ listingId, city, price, beds }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

  // Similar homes: same city, ±20% on price, one bedroom of slack.
  const minPrice = price ? roundPrice(price * 0.8) : undefined;
  const maxPrice = price ? roundPrice(price * 1.2) : undefined;
  const minBeds = beds && beds > 1 ? beds - 1 : undefined;

  const { submitting, submitted, error: submitError, submit, onFormFocus } = useCaptureSubmit({
    endpoint: '/api/listing-alerts',
    surface: 'listing-signup-prompt',
    recaptchaAction: 'listing_alerts',
    buildPayload: ({ recaptchaToken }) => ({
      recaptchaToken,
      name: name.trim(),
      email: email.trim(),
      cities: [city],
      min_price: minPrice,
      max_price: maxPrice,
      min_beds: minBeds,
    }),
    onSuccess: () => writeJson(STATE_KEY, { registered: true }),
  });
  const error = validationError || submitError;

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;

    const views = readJson<string[]>(VIEWS_KEY, []);
    if (!views.includes(listingId)) {
      views.push(listingId);
      writeJson(VIEWS_KEY, views.slice(-50));
    }

    const state = readJson<PromptState>(STATE_KEY, {});
    if (state.registered || readJson<string | null>(LEAD_SEEN_KEY, null)) return;
    const dismissals = state.dismissals ?? 0;
    const due =
      (dismissals === 0 && views.length >= FIRST_ASK_AT) ||
      (dismissals === 1 && views.length >= SECOND_ASK_AT);
    if (!due) return;

    // Let them look at the home first; asking on arrival reads as a wall.
    const t = setTimeout(() => {
      setOpen(true);
      trackEvent('listing_signup_prompt_shown', { listing_views: views.length, ask: dismissals + 1 });
    }, SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [listingId]);

  useEffect(() => {
    if (!open) return;
    emailRef.current?.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') dismiss(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // dismiss only reads state at call time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    setOpen(false);
    if (submitted) return;
    const state = readJson<PromptState>(STATE_KEY, {});
    writeJson(STATE_KEY, { dismissals: (state.dismissals ?? 0) + 1 });
    trackEvent('listing_signup_prompt_dismissed', { ask: (state.dismissals ?? 0) + 1 });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setValidationError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setValidationError('Please enter a valid email.'); return; }
    await submit(e);
  }

  if (!open) return null;

  const criteria = [
    city,
    minPrice && maxPrice ? `${formatPrice(minPrice)}–${formatPrice(maxPrice)}` : null,
    minBeds ? `${minBeds}+ beds` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:px-4"
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-prompt-title"
        className="relative w-full max-w-md rounded-t-2xl bg-white p-6 pb-8 shadow-2xl sm:rounded-2xl sm:p-8"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1 text-foreground-muted transition-colors hover:text-primary"
        >
          <X className="h-5 w-5" />
        </button>

        {submitted ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 id="signup-prompt-title" className="font-heading text-heading-lg font-bold text-primary">You&apos;re on the list</h2>
            <p className="text-body-sm text-foreground-muted">
              We&apos;ll email you new homes like this the day they hit the market.
            </p>
            <button
              onClick={() => setOpen(false)}
              className="mt-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Keep browsing
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5 pr-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/15">
                <Bell className="h-6 w-6 text-gold" />
              </div>
              <h2 id="signup-prompt-title" className="font-heading text-heading-lg font-bold text-primary">
                Get first look at homes like this
              </h2>
              <p className="mt-1 text-body-sm text-foreground-muted">
                New listings matching what you&apos;re viewing, emailed the day they hit the market:
              </p>
              <div className="mt-2 rounded-lg bg-background-cream px-3 py-2 text-body-sm font-medium text-primary">
                {criteria}
              </div>
            </div>

            <form onSubmit={handleSubmit} onFocusCapture={onFormFocus} className="flex flex-col gap-3">
              <Honeypot />
              <input
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="rounded-lg border border-border px-4 py-3 text-base text-primary placeholder-foreground-muted focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
              <input
                type="text"
                autoComplete="name"
                placeholder="First name (optional)"
                value={name}
                onChange={e => setName(e.target.value)}
                className="rounded-lg border border-border px-4 py-3 text-base text-primary placeholder-foreground-muted focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="mt-1 rounded-lg bg-primary px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? 'Saving…' : 'Send me new listings'}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="text-sm text-foreground-muted underline-offset-2 hover:text-primary hover:underline"
              >
                Maybe later
              </button>
              <p className="text-center text-xs text-foreground-subtle">Unsubscribe anytime · No spam, ever</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
