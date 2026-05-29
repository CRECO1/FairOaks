export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, ArrowRight, Home, DollarSign, Phone,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export const metadata: Metadata = {
  title: 'Texas Hill Country Homes for Sale | Browse All Areas | Fair Oaks Realty Group',
  description:
    'Search homes for sale across Fair Oaks Ranch, Boerne, Helotes, Bulverde, and San Antonio. Fair Oaks Realty Group — Hill Country\'s local real estate experts.',
  alternates: { canonical: '/homes-for-sale' },
  openGraph: {
    title: 'Texas Hill Country Homes for Sale | Browse All Areas | Fair Oaks Realty Group',
    description:
      'Browse homes for sale across Boerne, Helotes, San Antonio, Bulverde, New Braunfels, Fair Oaks Ranch, Canyon Lake & Spring Branch TX. Local experts, Hill Country real estate.',
    url: `${BASE_URL}/homes-for-sale`,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Fair Oaks Realty Group — Texas Hill Country Real Estate' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Texas Hill Country Homes for Sale | Fair Oaks Realty Group',
    description: 'Browse homes for sale across the Texas Hill Country. Local experts. Real results.',
  },
  keywords: [
    'Texas Hill Country homes for sale',
    'Boerne TX homes for sale',
    'San Antonio TX real estate',
    'Helotes homes for sale',
    'Bulverde TX real estate',
    'New Braunfels homes for sale',
    'Fair Oaks Ranch real estate',
    'Canyon Lake TX homes',
    'Spring Branch TX real estate',
    'Fair Oaks Realty Group',
  ],
};

const CITIES = [
  {
    name: 'Boerne, TX',
    slug: 'boerne-tx',
    avgPrice: '$575,000',
    tagline: 'Historic Hill Country charm, 30 min from San Antonio',
    highlights: ['Historic Main Street', 'Boerne ISD', 'Cibolo Creek'],
  },
  {
    name: 'Helotes, TX',
    slug: 'helotes-tx',
    avgPrice: '$490,000',
    tagline: 'Small-town feel with easy I-10 & 1604 access',
    highlights: ['Northside ISD', 'Large lots available', 'Cornyval Festival'],
  },
  {
    name: 'San Antonio, TX',
    slug: 'san-antonio-tx',
    avgPrice: '$385,000',
    tagline: 'Military-friendly, diverse neighborhoods, major employers',
    highlights: ['Multiple ISDs', 'VA loan expertise', 'Urban lifestyle'],
  },
  {
    name: 'Bulverde, TX',
    slug: 'bulverde-tx',
    avgPrice: '$520,000',
    tagline: 'Fast-growing Hill Country community, new construction available',
    highlights: ['Comal ISD', 'New construction', 'Acreage lots'],
  },
  {
    name: 'New Braunfels, TX',
    slug: 'new-braunfels-tx',
    avgPrice: '$435,000',
    tagline: 'Guadalupe River, Schlitterbahn & historic Gruene',
    highlights: ['Comal/Seguin ISD', 'Master-planned communities', 'River access'],
  },
  {
    name: 'Fair Oaks Ranch, TX',
    slug: 'fair-oaks-ranch-tx',
    avgPrice: '$680,000',
    tagline: 'Premier master-planned community with Hill Country views',
    highlights: ['Boerne ISD', 'Gated options', 'Equestrian trails'],
  },
  {
    name: 'Canyon Lake, TX',
    slug: 'canyon-lake-tx',
    avgPrice: '$420,000',
    tagline: 'Lakefront living and vacation/investment potential',
    highlights: ['Comal ISD', 'Water views', 'Outdoor recreation'],
  },
  {
    name: 'Spring Branch, TX',
    slug: 'spring-branch-tx',
    avgPrice: '$560,000',
    tagline: 'Secluded Hill Country acreage on the Guadalupe River',
    highlights: ['Comal ISD', 'Custom homes', 'Guadalupe River access'],
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Homes for Sale', item: `${BASE_URL}/homes-for-sale` },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      areaServed: [
        { '@type': 'City', name: 'Boerne', addressRegion: 'TX' },
        { '@type': 'City', name: 'Helotes', addressRegion: 'TX' },
        { '@type': 'City', name: 'San Antonio', addressRegion: 'TX' },
        { '@type': 'City', name: 'Bulverde', addressRegion: 'TX' },
        { '@type': 'City', name: 'New Braunfels', addressRegion: 'TX' },
        { '@type': 'City', name: 'Fair Oaks Ranch', addressRegion: 'TX' },
        { '@type': 'City', name: 'Canyon Lake', addressRegion: 'TX' },
        { '@type': 'City', name: 'Spring Branch', addressRegion: 'TX' },
      ],
    },
  ],
};

export default function HomesForSaleIndexPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Header />
      <main className="min-h-screen pt-20">

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">Texas Hill Country Real Estate</p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Find Your Home in the<br />
                <span className="text-gradient-gold">Texas Hill Country</span>
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Fair Oaks Realty Group serves buyers and sellers across eight premier communities
                northwest of San Antonio — from the banks of Cibolo Creek to the shores of Canyon Lake.
                Whether you&apos;re relocating, upsizing, or investing, our local agents know these markets inside and out.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings">Browse All Active Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />210-390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* City Grid */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">Browse by Area</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Communities We Serve
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                From walkable Hill Country towns to lakefront retreats and master-planned communities,
                we have deep expertise in the markets that matter most to you.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {CITIES.map((city) => (
                <Link
                  key={city.slug}
                  href={`/homes-for-sale/${city.slug}`}
                  className="group rounded-2xl bg-white border border-border p-6 shadow-sm hover:shadow-card hover:border-gold transition-all duration-200 flex flex-col"
                >
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10">
                      <MapPin className="h-5 w-5 text-gold" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-foreground-muted group-hover:text-gold group-hover:translate-x-0.5 transition-all" />
                  </div>

                  <h2 className="mb-1 font-heading text-heading font-bold text-primary group-hover:text-gold transition-colors">
                    {city.name}
                  </h2>
                  <p className="mb-3 text-body-sm text-foreground-muted leading-snug flex-1">
                    {city.tagline}
                  </p>

                  <div className="mb-4 flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-gold shrink-0" />
                    <span className="text-body-sm font-semibold text-primary">Avg. {city.avgPrice}</span>
                  </div>

                  <ul className="space-y-1.5">
                    {city.highlights.map((h) => (
                      <li key={h} className="flex items-center gap-2 text-caption text-foreground-muted">
                        <Home className="h-3 w-3 shrink-0 text-gold/60" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </Link>
              ))}
            </div>
          </Container>
        </section>

        {/* About Section */}
        <section className="section-compact bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">Who We Are</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Local Experts, Genuine Results
                </h2>
                <p className="mb-4 text-body text-foreground-muted leading-relaxed">
                  Fair Oaks Realty Group is an independent boutique brokerage rooted in Fair Oaks Ranch, Texas.
                  We&apos;ve spent over two decades building relationships across the Hill Country — from the established
                  neighborhoods of Boerne and Helotes to the fast-growing communities of Bulverde and New Braunfels.
                </p>
                <p className="mb-8 text-body text-foreground-muted leading-relaxed">
                  Our agents live and work in the same communities we sell. That means you get honest guidance,
                  real market data, and a partner who will still be your neighbor after closing day. Whether you&apos;re
                  a first-time buyer, a military family navigating a PCS move, or a seller ready to maximize your
                  equity — we bring local intelligence and fiduciary care to every transaction.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button size="lg" asChild>
                    <Link href="/contact">Talk to an Agent</Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link href="/listings">View All Listings <ArrowRight className="ml-2 h-4 w-4" /></Link>
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl bg-primary p-8 text-white">
                <p className="overline mb-4 text-gold">By the Numbers</p>
                <div className="grid grid-cols-2 gap-6">
                  {[
                    { stat: '8', label: 'Communities Served' },
                    { stat: '20+', label: 'Years of Experience' },
                    { stat: '$385K–$680K', label: 'Price Range Covered' },
                    { stat: '100%', label: 'Local Expertise' },
                  ].map(({ stat, label }) => (
                    <div key={label}>
                      <div className="font-heading text-display-sm font-bold text-gold">{stat}</div>
                      <div className="text-body-sm text-white/60">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-8 border-t border-white/10 pt-6">
                  <p className="text-body-sm text-white/70">
                    Not sure which community is right for you? Our agents will help you compare neighborhoods
                    based on your commute, school needs, budget, and lifestyle.
                  </p>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Ready to Start?</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Let&apos;s Find Your Next Home Together
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse active listings or connect with one of our local agents today.
                No pressure — just local knowledge and genuine help.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings">Browse All Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Contact an Agent</Link>
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
