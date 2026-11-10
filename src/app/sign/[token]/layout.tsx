import type { Metadata } from 'next';

// A signing link is private: the tab names what it is (not the site's marketing title) and nothing about it is indexable.
export const metadata: Metadata = {
  title: { absolute: 'Secure e-signature' },
  robots: { index: false, follow: false },
};

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
