export const revalidate = 21600;

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Recently Sold Homes in Fair Oaks Ranch TX | Our Track Record',
  description:
    'See homes recently sold by Fair Oaks Realty Group in Fair Oaks Ranch, Boerne & Helotes TX.',
  keywords: [
    'recently sold homes Fair Oaks Ranch TX',
    'Fair Oaks Ranch sold properties',
    'homes sold Fair Oaks Ranch Texas',
    'Fair Oaks Ranch real estate sold listings',
    'Boerne TX recently sold homes',
    'Texas Hill Country homes sold',
    'Fair Oaks Realty Group sold homes',
    'Fair Oaks Ranch real estate track record',
    'sold homes near San Antonio TX',
  ],
  openGraph: {
    images: [{ url: '/images/og-home.jpg', width: 1200, height: 630, alt: 'Fair Oaks Realty Group' }],
    title: 'Recently Sold Homes in Fair Oaks Ranch TX | Fair Oaks Realty Group',
    description:
      'Browse homes we\'ve sold in Fair Oaks Ranch, Boerne & Helotes TX.',
    url: 'https://www.fairoaksrealtygroup.com/sold',
    type: 'website',
  },
  alternates: {
    canonical: 'https://www.fairoaksrealtygroup.com/sold',
  },
};

import Image from 'next/image';
import { CheckCircle, Home, TrendingUp, Clock } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { RevealOnScroll } from '@/hooks/useScrollReveal';
import { getSoldProperties } from '@/lib/supabase';
import { formatPrice } from '@/lib/utils';
import Link from 'next/link';

export default async function SoldPage() {
  const sold = await getSoldProperties(12).catch(() => []);
  // No demo fallback: never present fabricated sale prices as our track record.
  const properties = sold;

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">
        {/* Hero */}
        <div className="bg-primary py-10 sm:py-16 text-white">
          <Container>
            <p className="overline mb-2 text-gold">Our Track Record</p>
            <h1 className="font-heading text-display-sm font-bold">Recently Sold</h1>
            <p className="mt-3 max-w-xl text-body text-white/60">
              A look at homes we&apos;ve successfully sold for our clients in Fair Oaks Ranch and the surrounding Texas Hill Country.
            </p>
          </Container>
        </div>

        {/* Grid */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <RevealOnScroll>
              <h2 className="mb-12 font-heading text-display font-bold text-primary text-center gold-line gold-line-center pb-4">
                Sold Properties
              </h2>
            </RevealOnScroll>

            {properties.length === 0 && (
              <p className="text-center text-body text-foreground-muted">
                Recent sales aren&apos;t available right now. Please{' '}
                <a href="/contact" className="text-gold underline">contact us</a> for our current track record.
              </p>
            )}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {properties.map((p, i) => (
                <RevealOnScroll key={p.id} delay={i * 80}>
                  <div className="card-luxury overflow-hidden">
                    <div className="relative aspect-property bg-background-warm">
                      {p.image_url ? (
                        <Image src={p.image_url} alt={p.address} fill className="object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-foreground-subtle">
                          <Home className="h-10 w-10" />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="rounded-full bg-primary/80 px-6 py-2 text-body-sm font-bold uppercase tracking-widest text-gold backdrop-blur-sm">
                          SOLD
                        </span>
                      </div>
                    </div>
                    <div className="p-5">
                      <p className="text-caption text-foreground-muted">{p.city}, TX</p>
                      <h3 className="mt-1 font-heading text-heading-sm font-semibold text-primary">{p.address}</h3>
                      <p className="mt-2 font-heading text-heading font-bold text-gold">{formatPrice(p.sale_price)}</p>
                      <div className="mt-3 flex items-center gap-4 text-caption text-foreground-muted border-t border-border pt-3">
                        {p.bedrooms && <span>{p.bedrooms} bd</span>}
                        {p.bathrooms && <span>{p.bathrooms} ba</span>}
                        {p.sqft && <span>{p.sqft.toLocaleString()} sf</span>}
                        {p.days_on_market && <span className="ml-auto text-gold-dark font-medium">{p.days_on_market}d DOM</span>}
                      </div>
                    </div>
                  </div>
                </RevealOnScroll>
              ))}
            </div>
          </Container>
        </section>

        {/* Sell CTA */}
        <section className="section-compact bg-primary text-white">
          <Container>
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="font-heading text-display-sm font-bold text-white mb-4">
                Ready to See What Your Home Is Worth?
              </h2>
              <p className="text-body text-white/60 mb-8">
                Get a free, no-obligation home valuation from our expert team. We know this market inside and out.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" asChild>
                  <Link href="/sell">Get My Home Value</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Talk to an Agent</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
