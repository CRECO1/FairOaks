'use client';

import { useState } from 'react';
import { Bell, X, CheckCircle } from 'lucide-react';

interface Props {
  cities: string[];
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
}

export function SaveSearchButton({ cities, minPrice, maxPrice, minBeds }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  // Build a human-readable summary of the current filters
  const filterSummary = [
    cities.length > 0 && cities[0] !== 'All Areas' ? cities.join(', ') : 'All Areas',
    minPrice ? `$${(minPrice / 1000).toFixed(0)}k+` : null,
    maxPrice ? `up to $${(maxPrice / 1000).toFixed(0)}k` : null,
    minBeds ? `${minBeds}+ beds` : null,
  ].filter(Boolean).join(' · ');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !email.trim()) { setError('Name and email are required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Please enter a valid email.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/listing-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, cities, min_price: minPrice, max_price: maxPrice, min_beds: minBeds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-gold/60 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition-all hover:bg-gold hover:text-primary"
      >
        <Bell className="h-4 w-4" />
        Get Alerts
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => { if (!submitted) setOpen(false); }}
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 rounded-full p-1 text-foreground-muted hover:text-primary transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            {submitted ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="font-heading text-heading-lg font-bold text-primary">You're all set!</h3>
                <p className="text-body-sm text-foreground-muted">
                  We'll email you as soon as a new listing matches your search. Check your inbox for a confirmation.
                </p>
                <button
                  onClick={() => setOpen(false)}
                  className="mt-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/15 mb-4">
                    <Bell className="h-6 w-6 text-gold" />
                  </div>
                  <h2 className="font-heading text-heading-lg font-bold text-primary">Save This Search</h2>
                  <p className="mt-1 text-body-sm text-foreground-muted">
                    Get emailed instantly when a new listing matches:
                  </p>
                  <div className="mt-2 rounded-lg bg-background-cream px-3 py-2 text-body-sm font-medium text-primary">
                    {filterSummary}
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                  <input
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    className="rounded-lg border border-border px-4 py-3 text-sm text-primary placeholder-foreground-muted focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
                  />
                  <input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="rounded-lg border border-border px-4 py-3 text-sm text-primary placeholder-foreground-muted focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
                  />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-1 rounded-lg bg-primary px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {loading ? 'Saving…' : '🔔 Notify Me of New Listings'}
                  </button>
                  <p className="text-center text-xs text-foreground-subtle">
                    Unsubscribe anytime · No spam, ever
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
