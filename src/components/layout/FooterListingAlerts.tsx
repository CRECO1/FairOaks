'use client';

import { useState } from 'react';
import { getRecaptchaToken } from '@/lib/recaptcha-client';

/**
 * Compact listing-alert signup for the footer, so every page has one way to
 * leave an email — most pages had no capture at all, only "call us" links.
 *
 * Same offer and endpoint as the Save Search button on /listings; one field,
 * because an alert only needs an email address.
 */
export function FooterListingAlerts() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState('sending');
    try {
      const res = await fetch('/api/listing-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), recaptchaToken: await getRecaptchaToken('listing_alerts') }),
      });
      setState(res.ok ? 'done' : 'error');
      if (res.ok) setEmail('');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p className="text-body-sm text-gold" role="status">
        You&rsquo;re on the list — we&rsquo;ll email you when a matching home hits the market.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-2">
      <label htmlFor="footer-alert-email" className="block text-body-sm text-white/60 mb-2">
        Get emailed the moment a home hits the market.
      </label>
      <div className="flex gap-2">
        <input
          id="footer-alert-email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Email address"
          autoComplete="email"
          className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/5 px-3 py-2.5 text-body-sm text-white placeholder:text-white/40 focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="shrink-0 rounded-lg bg-gold px-4 py-2.5 text-body-sm font-semibold text-primary transition-colors hover:bg-gold/90 disabled:opacity-60"
        >
          {state === 'sending' ? '…' : 'Notify me'}
        </button>
      </div>
      {state === 'error' && (
        <p className="mt-2 text-caption text-red-300" role="alert">That didn&rsquo;t go through. Please try again or call us.</p>
      )}
    </form>
  );
}
