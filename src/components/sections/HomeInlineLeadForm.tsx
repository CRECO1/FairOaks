'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Honeypot } from '@/components/Honeypot';
import { getRecaptchaToken } from '@/lib/recaptcha-client';
import { attributionPayload, trackEvent, trackFormStart } from '@/lib/attribution';
import { thankYouPath } from '@/lib/thank-you';

/**
 * Inline lead capture for the home page.
 *
 * The busiest page on the site had no quick capture — only links out to
 * /contact and /home-valuation. Anyone not ready to commit to a whole page
 * left without a way to raise a hand.
 *
 * Deliberately four fields. Name, one contact method and a single intent
 * question is enough to route and follow up; asking for more on a page someone
 * has been reading for thirty seconds costs more submissions than the extra
 * detail is worth.
 *
 * Posts to /api/leads like every other form here, so it inherits the whole
 * contract for free: attribution (utm/referrer/landing page/geo/device),
 * lead_site=fairoaksrealtygroup.com, the CRM contact, the Prospects row and
 * the owner notification. `surface: 'home-inline'` is what distinguishes it in
 * the Lead Attribution dashboard.
 *
 * Self-contained by design — one section element, one import in page.tsx.
 * Removing or relocating it is deleting or moving that single line.
 */
const INTENTS = [
  'Buying a home',
  'Selling a home',
  'Buying and selling',
  'Just browsing for now',
] as const;

const inputClass =
  'w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary ' +
  'focus:outline-none focus:ring-2 focus:ring-gold';

export default function HomeInlineLeadForm() {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'sending') return;
    const data = new FormData(e.currentTarget);
    setStatus('sending'); setError(null);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...attributionPayload('home-inline', { email: data.get('email'), name: data.get('name') }),
          recaptchaToken: await getRecaptchaToken('lead_form'),
          name: data.get('name'),
          email: data.get('email'),
          phone: data.get('phone'),
          message: `Looking to: ${data.get('intent') || 'Not specified'}`,
          source: 'contact',
          website: data.get('website'),      // honeypot
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      trackEvent('home_inline_submitted', { surface: 'home-inline' });
      router.push(thankYouPath('contact'));
    } catch {
      setStatus('error');
      setError('Something went wrong. Please call 210-390-9997 or try again.');
    }
  }

  return (
    <section className="section-luxury bg-background-cream" id="get-started">
      <Container>
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <h2 className="text-h2 font-display text-primary">Talk to a local agent</h2>
            <p className="mt-3 text-body text-foreground-light">
              Tell us what you&apos;re looking for and we&apos;ll get back to you — usually the same day.
              No obligation, and we never share your details.
            </p>
          </div>

          <div className="mt-8 rounded-2xl bg-white p-5 shadow-card sm:p-8">
            <form
              onSubmit={onSubmit}
              className="space-y-4"
              // One capture-phase handler covers every field; trackFormStart
              // de-duplicates, so tabbing between inputs still counts once.
              onFocusCapture={() => trackFormStart('home-inline')}
            >
              <Honeypot />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="hif-name" className="label-readable">Full Name *</label>
                  <input id="hif-name" name="name" required autoComplete="name"
                         placeholder="Jane Smith" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="hif-phone" className="label-readable">Phone *</label>
                  <input id="hif-phone" name="phone" type="tel" required autoComplete="tel"
                         placeholder="210-555-0000" className={inputClass} />
                </div>
              </div>
              <div>
                <label htmlFor="hif-email" className="label-readable">Email Address</label>
                <input id="hif-email" name="email" type="email" autoComplete="email"
                       placeholder="you@example.com" className={inputClass} />
              </div>
              <div>
                <label htmlFor="hif-intent" className="label-readable">What are you looking to do?</label>
                <select id="hif-intent" name="intent" defaultValue={INTENTS[0]} className={inputClass}>
                  {INTENTS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>

              {error && <p className="text-body-sm text-red-600" role="alert">{error}</p>}

              <button type="submit" disabled={status === 'sending'}
                      // White on #C9A962 is 2.25:1 — below the 4.5:1 AA floor. Dark ink on the
                      // same gold is 7.74:1 and matches the sticky CTA bar already on the page.
                      className="w-full rounded-lg bg-gold px-6 py-3.5 text-body-sm font-semibold text-primary transition hover:bg-gold-dark hover:text-white disabled:opacity-60 sm:w-auto sm:px-10">
                {status === 'sending' ? 'Sending…' : 'Get in touch'}
              </button>
              <p className="text-caption text-foreground-light">
                Prefer to talk now? Call{' '}
                <a href="tel:+12103909997" className="font-semibold text-gold underline">210-390-9997</a>.
              </p>
            </form>
          </div>
        </div>
      </Container>
    </section>
  );
}
