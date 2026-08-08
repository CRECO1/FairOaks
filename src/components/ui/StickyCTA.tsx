'use client';

import { useState, useEffect } from 'react';
import { Phone } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { trackPhoneClick } from '@/lib/analytics';

const EXCLUDED = ['/crm', '/manage', '/admin'];

export default function StickyCTA() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (EXCLUDED.some(p => pathname.startsWith(p))) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <div className="bg-primary border-t border-gold/20 shadow-2xl">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-3 px-4 py-3">
          <p className="hidden text-body-sm font-semibold text-white sm:block">
            Ready to find your home in Fair Oaks Ranch?
          </p>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <a
              href="tel:+12103909997"
              onClick={() => trackPhoneClick('sticky_cta')}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/30 px-4 py-2.5 text-body-sm font-semibold text-white transition-colors hover:bg-white/10 sm:flex-none"
            >
              <Phone className="h-4 w-4" />
              <span>210-390-9997</span>
            </a>
            <Link
              href="/contact"
              className="inline-flex flex-1 items-center justify-center rounded-lg bg-gold px-5 py-2.5 text-body-sm font-bold text-primary transition-colors hover:bg-gold/90 sm:flex-none"
            >
              Schedule a Consultation
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
