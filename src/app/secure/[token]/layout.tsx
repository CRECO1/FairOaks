import type { Metadata } from 'next';

// A secure-upload link is private: the tab names what it is, nothing about it is indexable, and the token never leaves in a Referer.
export const metadata: Metadata = {
  title: { absolute: 'Secure document upload' },
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SecureLayout({ children }: { children: React.ReactNode }) {
  return children;
}
