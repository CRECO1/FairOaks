'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { X, Home, ArrowRight } from 'lucide-react';
import { trackLead } from '@/lib/analytics';

const EXCLUDED = ['/crm', '/manage', '/admin', '/thank-you'];
const SESSION_KEY = 'exit_modal_shown';
// Only show after user has been on page at least 20 seconds
const MIN_TIME_MS = 20_000;

export default function ExitIntentModal() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const readyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (EXCLUDED.some(p => pathname.startsWith(p))) return;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) return;

    // Mark as ready after min time
    timerRef.current = setTimeout(() => { readyRef.current = true; }, MIN_TIME_MS);

    function handleMouseLeave(e: MouseEvent) {
      if (!readyRef.current) return;
      if (e.clientY > 20) return; // Only trigger when mouse goes above viewport
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) return;
      sessionStorage.setItem(SESSION_KEY, '1');
      setOpen(true);
    }

    document.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      document.removeEventListener('mouseleave', handleMouseLeave);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pathname]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setLoading(true);
    try {
      await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          message: 'Exit-intent modal — free home value request',
          source: 'valuation',
          business_unit: 'residential',
        }),
      });
      trackLead({ form_type: 'valuation' });
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        router.push('/thank-you');
      }, 1500);
    } catch {
      // Silent — don't block close
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Gold accent bar */}
        <div className="h-1.5 w-full bg-gold" />

        <button
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 text-foreground-muted hover:text-primary transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="px-8 py-8">
          {done ? (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gold/20">
                <Home className="h-7 w-7 text-gold-dark" />
              </div>
              <h3 className="font-heading text-heading-lg font-bold text-primary">You&apos;re all set!</h3>
              <p className="mt-2 text-body-sm text-foreground-muted">We&apos;ll be in touch shortly.</p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10">
                <Home className="h-6 w-6 text-gold-dark" />
              </div>
              <h2 className="font-heading text-heading-xl font-bold text-primary mb-2">
                Before you go — what&apos;s your home worth?
              </h2>
              <p className="text-body-sm text-foreground-muted mb-6 leading-relaxed">
                Get a free, no-obligation home valuation from a Fair Oaks Ranch local expert.
                Takes 30 seconds — we&apos;ll do the rest.
              </p>
              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                />
                <input
                  type="tel"
                  placeholder="Phone number"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3.5 text-body-sm font-bold text-white hover:bg-primary/90 disabled:opacity-60 transition-colors"
                >
                  {loading ? 'Sending…' : <>Get My Free Home Value <ArrowRight className="h-4 w-4" /></>}
                </button>
              </form>
              <p className="mt-3 text-center text-caption text-foreground-muted">
                No obligation · We never share your info
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
