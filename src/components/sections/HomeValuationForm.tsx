'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Home, ArrowRight } from 'lucide-react';
import { trackLead } from '@/lib/analytics';
import { getRecaptchaToken } from '@/lib/recaptcha-client';
import { Honeypot } from '@/components/Honeypot';

export function HomeValuationForm({ tone = 'dark', surface = 'home' }: { tone?: 'dark' | 'light'; surface?: string }) {
  // One form, two grounds: the homepage band is dark, the landing page is light.
  const field = tone === 'dark'
    ? 'rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-base text-white placeholder-white/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold'
    : 'rounded-lg border border-border bg-white px-4 py-3 text-base text-primary placeholder-foreground-muted/70 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold';
  const foot = tone === 'dark' ? 'text-white/40' : 'text-foreground-muted';
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const website = new FormData(e.currentTarget).get('website');

    if (!form.name.trim() || !form.email.trim() || !form.address.trim() || !form.phone.trim()) {
      setError('Please fill in your name, email, phone, and property address.');
      return;
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
    if (!emailOk) { setError('Please enter a valid email address.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recaptchaToken: await getRecaptchaToken('lead_form'),
          name: form.name,
          email: form.email,
          phone: form.phone,
          message: `Home valuation request for: ${form.address}`,
          source: 'valuation',
          property_interest: form.address,
          valuation_surface: surface,
          business_unit: 'residential',
          website: (website as string) || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      trackLead({ form_type: 'valuation' });
      router.push('/thank-you');
    } catch {
      setError('Something went wrong. Please try again or call us directly.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Honeypot />
      <input
        type="text"
        placeholder="Your name"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        required
        className={field}
      />
      <input
        type="text"
        placeholder="Property address"
        value={form.address}
        onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
        required
        className={field}
      />
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="email"
          placeholder="Email address"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          required
          className={`flex-1 min-w-0 ${field}`}
        />
        <input
          type="tel"
          placeholder="Phone number"
          value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          required
          className={`flex-1 min-w-0 ${field}`}
        />
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-gold px-6 py-3.5 text-sm font-bold text-primary transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {loading ? 'Sending…' : <><Home className="h-4 w-4" /> Request my home valuation <ArrowRight className="h-4 w-4" /></>}
      </button>
      <p className={`text-center text-xs ${foot}`}>No obligation · Prepared by a person, not an algorithm · We never share your details</p>
    </form>
  );
}
