'use client';

import { useState, useEffect } from 'react';
import { Phone, MessageSquare, X } from 'lucide-react';
import { trackLead, trackPhoneClick } from '@/lib/analytics';

interface Props {
  listingTitle: string;
  price?: string;
}

export function StickyContactBar({ listingTitle, price }: Props) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Show bar after scrolling 400px, hide once user reaches the bottom
  useEffect(() => {
    function onScroll() {
      if (dismissed) return;
      const scrollY = window.scrollY;
      const maxScroll = document.body.scrollHeight - window.innerHeight - 100;
      setVisible(scrollY > 400 && scrollY < maxScroll);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [dismissed]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSending(true);
    const fd = new FormData(e.currentTarget);
    const name  = (fd.get('name')  as string).trim();
    const phone = (fd.get('phone') as string).trim();
    const email = (fd.get('email') as string).trim();
    if (!name || !phone) { setError('Name and phone are required.'); setSending(false); return; }
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, phone, email: email || undefined,
          message: `Requesting a showing for: ${listingTitle}`,
          property_interest: listingTitle,
          source: 'listing',
          business_unit: 'residential',
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Something went wrong.'); return; }
      setSubmitted(true);
      trackLead({ form_type: 'showing_request' });
    } catch { setError('Network error — please try again.'); }
    finally { setSending(false); }
  }

  if (!visible || dismissed) return null;

  return (
    /* Only show on mobile/tablet — on lg+ the sidebar handles this */
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 shadow-2xl">
      {/* Quick-form drawer */}
      {showForm && (
        <div className="bg-white border-t border-border px-4 pt-4 pb-2">
          {submitted ? (
            <div className="py-4 text-center">
              <div className="text-2xl mb-1">✅</div>
              <p className="font-semibold text-green-800 text-sm">Got it! We&apos;ll call you shortly.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-2">
              {error && <p className="text-xs text-red-600 rounded bg-red-50 px-3 py-2">{error}</p>}
              <div className="grid grid-cols-2 gap-2">
                <input name="name" required placeholder="Your Name"
                  className="col-span-2 rounded-lg border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold" />
                <input name="phone" type="tel" required placeholder="Phone Number"
                  className="rounded-lg border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold" />
                <input name="email" type="email" placeholder="Email (optional)"
                  className="rounded-lg border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold" />
              </div>
              <button type="submit" disabled={sending}
                className="w-full rounded-lg bg-primary py-3 text-sm font-bold text-white disabled:opacity-60 transition-opacity">
                {sending ? 'Sending…' : 'Request a Showing →'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Main bar */}
      <div className="flex items-center gap-2 bg-primary px-4 py-3">
        <div className="flex-1 min-w-0">
          {price && <p className="text-gold font-bold font-heading text-base leading-none">{price}</p>}
          <p className="text-white/70 text-xs truncate mt-0.5">{listingTitle}</p>
        </div>
        <a href="tel:+12103909997" onClick={() => trackPhoneClick('sticky_bar')}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white text-xs font-semibold shrink-0">
          <Phone className="h-3.5 w-3.5" /> Call
        </a>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-2 text-primary text-xs font-bold shrink-0">
          <MessageSquare className="h-3.5 w-3.5" />
          {showForm ? 'Hide' : 'Request Showing'}
        </button>
        <button onClick={() => { setDismissed(true); setVisible(false); }} aria-label="Dismiss"
          className="text-white/40 hover:text-white transition-colors shrink-0 pl-1">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
