'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ListingContactForm({ listingTitle }: { listingTitle: string }) {
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const form = e.currentTarget;
    const data = new FormData(form);

    const name    = (data.get('name')    as string ?? '').trim();
    const email   = (data.get('email')   as string ?? '').trim();
    const phone   = (data.get('phone')   as string ?? '').trim();
    const message = (data.get('message') as string ?? '').trim();

    if (!name || name.length < 2)                         { setError('Please enter your full name.'); return; }
    if (!EMAIL_RE.test(email))                            { setError('Please enter a valid email address.'); return; }
    if (phone && phone.replace(/\D/g, '').length < 7)    { setError('Please enter a valid phone number.'); return; }
    if (message.length > 2000)                            { setError('Message must be under 2,000 characters.'); return; }

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email,
          phone: phone || undefined,
          message: message || `I'm interested in ${listingTitle}`,
          property_interest: listingTitle,
          source: 'listing',
          business_unit: 'residential',
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
      form.reset();
    } catch {
      setError('Network error — please try again.');
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 p-6 text-center">
        <div className="text-2xl mb-2">✅</div>
        <p className="font-semibold text-green-800">Request received!</p>
        <p className="text-sm text-green-700 mt-1">We&apos;ll be in touch within 1 business day.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <input
        name="name"
        required
        placeholder="Your Name"
        className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
      />
      <input
        name="email"
        type="email"
        required
        placeholder="Email Address"
        className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
      />
      <input
        name="phone"
        type="tel"
        placeholder="Phone (optional)"
        className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
      />
      <textarea
        name="message"
        rows={3}
        placeholder={`I'd like to schedule a showing for ${listingTitle}`}
        className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold resize-none"
      />
      <Button type="submit" size="lg" fullWidth>
        Request a Showing
      </Button>
    </form>
  );
}
