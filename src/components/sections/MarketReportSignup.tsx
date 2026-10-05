'use client';

// Market-update sign-up on /market-reports. Posts to /api/leads like every other lead
// form (honeypot + fill time via attributionPayload, reCAPTCHA fail-open), with
// source 'market-report', which tags the contact "Market Report" — the tag the CRM's
// "Market Report Subscribers" list filters on.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getRecaptchaToken } from '@/lib/recaptcha-client';
import { Honeypot } from '@/components/Honeypot';
import { attributionPayload, trackEvent, trackFormStart } from '@/lib/attribution';
import { thankYouPath } from '@/lib/thank-you';
import { FORG } from '@/lib/site-identity';
import { Button } from '@/components/ui/Button';

const field = 'w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold';

export function MarketReportSignup() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...attributionPayload('market-report', { email: data.get('email'), name: data.get('name') }),
          recaptchaToken: await getRecaptchaToken('lead_form'),
          name: data.get('name'),
          email: data.get('email'),
          message: 'Signed up for market updates on /market-reports.',
          property_interest: 'Market updates — Fair Oaks Ranch & Hill Country',
          source: 'market-report',
          business_unit: 'residential',
          website: (data.get('website') as string) || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `lead POST ${res.status}`);
      }
      trackEvent('market_report_signup', { form: 'market-report' });
      router.push(thankYouPath('market-report'));
    } catch {
      setError(`Something went wrong. Please try again, or call or text ${FORG.phoneDisplay}.`);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} onFocusCapture={() => trackFormStart('market-report')} className="space-y-3">
      <Honeypot />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="name" required autoComplete="name" placeholder="Your name" aria-label="Your name" className={field} />
        <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" aria-label="Email address" className={field} />
      </div>
      {error && <p role="alert" className="text-body-sm text-red-600">{error}</p>}
      <Button type="submit" size="lg" fullWidth loading={loading}>Send me the market updates</Button>
      <p className="text-caption text-foreground-muted">
        No spam, and unsubscribe any time. We never share your details.
      </p>
    </form>
  );
}
