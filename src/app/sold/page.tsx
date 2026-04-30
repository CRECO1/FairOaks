export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Recently Sold Homes in Fair Oaks Ranch TX | Our Track Record',
  description:
    'See homes recently sold by Fair Oaks Realty Group in Fair Oaks Ranch, Boerne & Helotes TX. We consistently sell above asking price with an average of 21 days on market.',
  keywords: [
    'recently sold homes Fair Oaks Ranch TX',
    'Fair Oaks Ranch sold properties',
    'homes sold Fair Oaks Ranch Texas',
    'Fair Oaks Ranch real estate sold listings',
    'Boerne TX recently sold homes',
    'Texas Hill Country homes sold',
    'Fair Oaks Realty Group sold homes',
    'Fair Oaks Ranch sold above asking price',
    'Fair Oaks Ranch real estate track record',
    'sold homes near San Antonio TX',
  ],
  openGraph: {
    title: 'Recently Sold Homes in Fair Oaks Ranch TX | Fair Oaks Realty Group',
    description:
      'Browse homes we\'ve sold in Fair Oaks Ranch, Boerne & Helotes TX. Proven results with a 103% list-to-sale price ratio.',
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

const DEMO_SOLD = [
  { id: '1', address: '215 Oak Crest Blvd', city: 'Fair Oaks Ranch', sale_price: 698000, sale_date: '2026-03-01', bedrooms: 4, bathrooms: 3, sqft: 2750, image_url: null, days_on_market: 12, created_at: '' },
  { id: '2', address: '8811 Canyon Ridge', city: 'Boerne', sale_price: 540000, sale_date: '2026-02-14', bedrooms: 3, bathrooms: 2.5, sqft: 2100, image_url: null, days_on_market: 8, created_at: '' },
  { id: '3', address: '4421 Laurel Creek', city: 'Fair Oaks Ranch', sale_price: 875000, sale_date: '2026-01-29', bedrooms: 5, bathrooms: 4, sqft: 3600, image_url: null, days_on_market: 21, created_at: '' },
  { id: '4', address: '1702 Timber Ridge Rd', city: 'Helotes', sale_price: 395000, sale_date: '2026-01-10', bedrooms: 3, bathrooms: 2, sqft: 1780, image_url: null, days_on_market: 5, created_at: '' },
  { id: '5', address: '9203 Copper Canyon', city: 'Boerne', sale_price: 1100000, sale_date: '2025-12-20', bedrooms: 5, bathrooms: 5, sqft: 4800, image_url: null, days_on_market: 18, created_at: '' },
  { id: '6', address: '317 Saddleback Trail', city: 'Fair Oaks Ranch', sale_price: 620000, sale_date: '2025-12-01', bedrooms: 4, bathrooms: 3, sqft: 2650, image_url: null, days_on_market: 14, created_at: '' },
];

const STATS = [
  { icon: Home, value: '500+', label: 'Homes Sold' },
  { icon: TrendingUp, value: '103%', label: 'Avg. List-to-Sale Ratio' },
  { icon: Clock, value: '21', label: 'Avg. Days on Market' },
  { icon: CheckCircle, value: '98%', label: 'Client Satisfaction' },
];

export default async function SoldPage() {
  const sold = await getSoldProperties(12).catch(() => []);
  const properties = sold.length > 0 ? sold : DEMO_SOLD;

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">
        {/* Hero */}
        <div className="bg-primary py-16 text-white">
          <Container>
            <p className="overline mb-2 text-gold">Our Track Record</p>
            <h1 className="font-heading text-display-sm font-bold">Recently Sold</h1>
            <p className="mt-3 max-w-xl text-body text-white/60">
              A look at homes we&apos;ve successfully sold for our clients in Fair Oaks Ranch and the surrounding Texas Hill Country.
            </p>
          </Container>
        </div>

        {/* Stats */}
        <div className="bg-gold py-10">
          <Container>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              {STATS.map(({ icon: Icon, value, label }) => (
                <div key={label} className="text-center">
                  <Icon className="mx-auto mb-2 h-6 w-6 text-primary/60" />
                  <div className="font-heading text-display-sm font-bold text-primary">{value}</div>
                  <div className="text-caption uppercase tracking-wider text-primary/60">{label}</div>
                </div>
              ))}
            </div>
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
