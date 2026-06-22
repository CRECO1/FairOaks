'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Home, ArrowRight, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { trackLead } from '@/lib/analytics';

export function HomeValuationForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '' });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

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
          name: form.name,
          email: form.email,
          phone: form.phone,
          message: `Home valuation request for: ${form.address}`,
          source: 'valuation',
          business_unit: 'residential',
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

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gold/20">
          <CheckCircle className="h-8 w-8 text-gold" />
        </div>
        <h3 className="font-heading text-heading-lg font-bold text-white">We're on it!</h3>
        <p className="text-white/70 max-w-sm">
          Expect a call or email from our team within 1 business day with your personalized home valuation.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="text"
        placeholder="Your name"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        required
        className="rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-white/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
      />
      <input
        type="text"
        placeholder="Property address"
        value={form.address}
        onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
        required
        className="rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-white/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
      />
      <div className="flex gap-3">
        <input
          type="email"
          placeholder="Email address"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          required
          className="flex-1 rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-white/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        />
        <input
          type="tel"
          placeholder="Phone number"
          value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          required
          className="flex-1 rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-white/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        />
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-gold px-6 py-3.5 text-sm font-bold text-primary transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {loading ? 'Sending…' : <><Home className="h-4 w-4" /> Get My Free Valuation <ArrowRight className="h-4 w-4" /></>}
      </button>
      <p className="text-center text-xs text-white/40">No obligation · Response within 1 business day · We never share your info</p>
    </form>
  );
}
