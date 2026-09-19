import type { Metadata } from 'next';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';

// Without this page the 404 inherited the root layout's `index, follow` next to
// Next's automatic `noindex` (two conflicting robots tags) and the homepage
// canonical. A missing page should say noindex, and nothing else.
export const metadata: Metadata = {
  title: { absolute: 'Page Not Found | Fair Oaks Realty Group' },
  robots: { index: false, follow: true },
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="min-h-[60vh] pt-20">
        <Container className="py-24 text-center">
          <p className="overline mb-3 text-gold">404</p>
          <h1 className="font-heading text-display-sm font-bold text-primary">Page not found</h1>
          <p className="mx-auto mt-4 max-w-xl text-body text-foreground-muted">
            The page you were looking for isn&apos;t here. Try the homepage or browse homes for sale.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/" className="rounded-lg bg-primary px-6 py-3 font-semibold text-white">Home</Link>
            <Link href="/listings" className="rounded-lg border border-border px-6 py-3 font-semibold text-primary">Browse listings</Link>
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}
