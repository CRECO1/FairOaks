'use client';
import { trackPhoneClick } from '@/lib/analytics';

export function PhoneLink({ children, location }: { children: React.ReactNode; location: string }) {
  return (
    <a href="tel:+12103909997" onClick={() => trackPhoneClick(location)}>
      {children}
    </a>
  );
}
