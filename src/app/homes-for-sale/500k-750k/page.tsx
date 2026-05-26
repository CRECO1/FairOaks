export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  CheckCircle, ArrowRight, Phone, Star, Users,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/homes-for-sale/500k-750k`;

export const metadata: Metadata = {
  title: 'Homes $500K–$750K in Fair Oaks Ranch, Boerne & Texas Hill Country',
  description:
    'Browse homes priced $500K–$750K in the Texas Hill Country — Fair Oaks Ranch, Boerne, and Helotes. Move-up homes with space, views, and top schools.',
  alternates: { canonical: '/homes-for-sale/500k-750k' },
  openGraph: {
    title: 'Homes $500K–$750K in Fair Oaks Ranch, Boerne & Texas Hill Country',
    description:
      'Browse homes $500,000–$750,000 in Fair Oaks Ranch, Boerne, Helotes, and surrounding Hill Country communities. Spacious family homes, premium finishes, top school districts.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Move-Up Homes $500K–$750K — Texas Hill Country' }],
  },
  twitter: { card: 'summary_large_image', title: 'Homes $500K–$750K — Texas Hill Country | Fair Oaks Realty Group', description: 'Spacious family homes $500K–$750K in Fair Oaks Ranch, Boerne, and the Texas Hill Country.' },
  keywords: [
    'homes 500k to 750k texas',
    'fair oaks ranch homes 600k',
    'boerne homes 500000 to 750000',
    'hill country homes mid-range',
    'homes 500k san antonio',
    '5 bedroom homes fair oaks ranch',
    'boerne isd homes for sale',
    'helotes homes 600k',
    'family homes texas hill country',
    'homes 500-750k san antonio',
  ],
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Homes for Sale', item: `${BASE_URL}/homes-for-sale` },
        { '@type': 'ListItem', position: 3, name: 'Homes $500K–$750K', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      description: 'Local experts for move-up homes $500K–$750K in Fair Oaks Ranch, Boerne, and the Texas Hill Country.',
      areaServed: [
        { '@type': 'Place', name: 'Fair Oaks Ranch, TX' },
        { '@type': 'Place', name: 'Boerne, TX' },
        { '@type': 'Place', name: 'Helotes, TX' },
        { '@type': 'Place', name: 'Texas Hill Country' },
      ],
      priceRange: '$$$',
    },
  ],
};

const PROPERTY_TYPES = [
  {
    icon: Home,
    title: '4-Bedroom Family Homes',
    priceRange: '$500K – $620K',
    description:
      'Spacious 4-bedroom, 2–3 bathroom family homes with formal dining, open-concept kitchens, and dedicated home office space. These homes typically run 2,400–3,000 sq ft in established subdivisions near top schools.',
    highlights: ['2,400–3,000 sq ft', 'Formal + casual living areas', 'Home office space', 'Top school districts'],
  },
  {
    icon: Star,
    title: 'Newer Builds & Modern Designs',
    priceRange: '$550K – $700K',
    description:
      'Built within the last 10 years, these homes feature modern open floor plans, quartz counters, stainless appliances, large primary suites, and covered patios designed for the Texas lifestyle. Often include 3-car garages.',
    highlights: ['Built 2015–present', 'Quartz & stainless finishes', 'Large primary suites', '3-car garages common'],
  },
  {
    icon: Users,
    title: 'Gated Community Access',
    priceRange: '$620K – $750K',
    description:
      'Enter gated communities with neighborhood amenities — pools, parks, fitness centers, and walking trails — at the upper end of this price range. Fair Oaks Ranch and select Boerne communities offer gated options at $650K–$750K.',
    highlights: ['Gated entry', 'Community pools & parks', 'HOA-maintained common areas', 'Hill Country views'],
  },
];

const SCHOOL_DISTRICTS = [
  {
    name: 'Boerne ISD',
    rating: 'A-Rated',
    highlights: ['Consistently high TEA ratings', 'Award-winning athletics and fine arts', 'Dedicated STEAM programs', 'Multiple campuses with strong parent communities'],
    cities: 'Boerne, Fair Oaks Ranch (portions)',
  },
  {
    name: 'Northside ISD',
    rating: 'A-Rated',
    highlights: ['Second-largest ISD in Texas', 'Extensive AP and dual-credit offerings', 'Strong career & technical education', 'Highly rated campuses in Helotes corridor'],
    cities: 'Helotes, NW San Antonio',
  },
];

const NEIGHBORHOODS = [
  { name: 'Fair Oaks Ranch, TX', slug: 'fair-oaks-ranch-tx', avgPrice: '$680K', note: 'Master-planned with Hill Country views and Boerne ISD' },
  { name: 'Boerne, TX', slug: 'boerne-tx', avgPrice: '$575K', note: 'Historic Hill Country charm, award-winning schools' },
  { name: 'Helotes, TX', slug: 'helotes-tx', avgPrice: '$490K', note: 'Excellent value and easy access to I-10 and 1604' },
  { name: 'Bulverde, TX', slug: 'bulverde-tx', avgPrice: '$520K', note: 'Fast-growing community with new construction options' },
];

const STATS = [
  { label: 'Avg. Days on Market', value: '28', sub: '$500K–$750K segment' },
  { label: 'List-to-Sale Ratio', value: '99%', sub: 'Consistent pricing' },
  { label: 'Avg. Home Size', value: '2,600 sf', sub: 'In this price range' },
  { label: 'School Options', value: 'Boerne + Northside ISD', sub: 'Top-rated districts' },
];

export default function From500kTo750kPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Header />
      <main className="min-h-screen pt-20">

        {/* Breadcrumb */}
        <div className="border-b border-border bg-background-cream py-3">
          <Container>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-caption text-foreground-muted">
              <Link href="/" className="hover:text-primary transition-colors">Home</Link>
              <span>/</span>
              <Link href="/homes-for-sale" className="hover:text-primary transition-colors">Homes for Sale</Link>
              <span>/</span>
              <span className="text-primary font-medium">Homes $500K–$750K</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">
                <DollarSign className="mr-1 inline h-3 w-3" />
                Move-Up Homes in the Texas Hill Country
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Move-Up Homes $500K–$750K in the Texas Hill Country
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                The sweet spot of the Hill Country market. At $500K–$750K, buyers get spacious family
                homes, newer builds with premium finishes, and access to gated communities — all in
                top-rated school districts near Boerne, Fair Oaks Ranch, and Helotes.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?minPrice=500000&maxPrice=750000">Browse $500K–$750K Homes</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Stats Bar */}
        <div className="bg-gold py-6">
          <Container>
            <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
              {STATS.map(({ label, value, sub }) => (
                <div key={label} className="text-center sm:text-left">
                  <div className="font-heading text-heading font-bold text-primary">{value}</div>
                  <div className="text-caption text-primary/80 font-medium">{label}</div>
                  <div className="text-caption text-primary/50">{sub}</div>
                </div>
              ))}
            </div>
          </Container>
        </div>

        {/* What $500K–$750K Buys */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">Your Budget, Your Options</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                What $500K–$750K Buys in the Hill Country
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                This price range is the most active segment of the Hill Country market — offering the best
                balance of space, quality, community amenities, and school district access.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              {PROPERTY_TYPES.map(({ icon: Icon, title, priceRange, description, highlights }) => (
                <div key={title} className="rounded-2xl bg-background-cream border border-border p-7 flex flex-col">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10 mb-4">
                    <Icon className="h-6 w-6 text-gold" />
                  </div>
                  <div className="mb-1 text-body-sm font-semibold text-gold">{priceRange}</div>
                  <h3 className="mb-3 font-heading text-heading font-bold text-primary">{title}</h3>
                  <p className="mb-5 text-body-sm text-foreground-muted leading-relaxed flex-1">{description}</p>
                  <ul className="space-y-2">
                    {highlights.map((h) => (
                      <li key={h} className="flex items-center gap-2 text-body-sm text-foreground-muted">
                        <CheckCircle className="h-4 w-4 shrink-0 text-gold" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* School District Spotlight */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-gold">For Families</p>
              <h2 className="font-heading text-display-sm font-bold text-primary">
                School District Spotlight
              </h2>
              <p className="mt-4 mx-auto max-w-2xl text-body text-foreground-muted">
                The $500K–$750K range puts you squarely in some of the best school districts in Texas.
                Here are the two districts that cover most of the inventory in this price range.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              {SCHOOL_DISTRICTS.map(({ name, rating, highlights, cities }) => (
                <div key={name} className="rounded-2xl bg-white border border-border p-7 shadow-sm">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10">
                      <School className="h-6 w-6 text-gold" />
                    </div>
                    <span className="rounded-full bg-gold/10 px-3 py-1 text-caption font-semibold text-gold">{rating}</span>
                  </div>
                  <h3 className="mb-1 font-heading text-heading font-bold text-primary">{name}</h3>
                  <p className="mb-4 text-body-sm text-foreground-muted flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 shrink-0" /> Serves: {cities}
                  </p>
                  <ul className="space-y-2">
                    {highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-body-sm text-foreground-muted">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Neighborhoods + Sidebar */}
        <section className="section-compact bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-gold">Where to Search</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  Top Neighborhoods in This Price Range
                </h2>
                <p className="mb-8 text-body text-foreground-muted leading-relaxed">
                  These communities consistently deliver the best selection of homes in the $500K–$750K range.
                  Each has its own character, school zone, and lifestyle advantages.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {NEIGHBORHOODS.map(({ name, slug, avgPrice, note }) => (
                    <Link
                      key={slug}
                      href={`/homes-for-sale/${slug}`}
                      className="group flex items-start gap-4 rounded-xl border border-border bg-background-cream p-5 shadow-sm hover:shadow-card hover:border-gold transition-all"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold/10">
                        <MapPin className="h-4 w-4 text-gold" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-heading text-body font-bold text-primary group-hover:text-gold transition-colors">{name}</div>
                        <div className="text-body-sm font-semibold text-gold">{avgPrice} avg.</div>
                        <div className="text-caption text-foreground-muted mt-1">{note}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-foreground-muted group-hover:text-gold group-hover:translate-x-0.5 transition-all mt-1" />
                    </Link>
                  ))}
                </div>
                <div className="mt-8 rounded-2xl border border-border bg-background-cream p-7">
                  <p className="overline mb-2 text-gold">Current Inventory</p>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">
                    Browse Active $500K–$750K Listings
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all homes currently priced between $500,000 and $750,000 across our service areas.
                    Updated daily from the MLS — filter by city, school district, and features.
                  </p>
                  <Button asChild>
                    <Link href="/listings?minPrice=500000&maxPrice=750000">
                      View $500K–$750K Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold/10 mb-3">
                    <Clock className="h-5 w-5 text-gold" />
                  </div>
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    The Move-Up Market Moves Quickly
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    Homes in the $500K–$750K range sell in an average of 28 days. Our agents keep you
                    ahead of the market with instant alerts and early access to listings.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact">Talk to a Buyer&apos;s Agent</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?minPrice=500000&maxPrice=750000">See Available Homes</Link>
                  </Button>
                  <div className="mt-6 border-t border-border pt-5">
                    <p className="text-caption text-foreground-muted text-center mb-3">Call us directly</p>
                    <a
                      href="tel:+12103909997"
                      className="flex items-center justify-center gap-2 text-body-sm font-semibold text-primary hover:text-gold transition-colors"
                    >
                      <Phone className="h-4 w-4" /> (210) 390-9997
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* Why Hill Country $500K–$750K */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div className="rounded-2xl bg-primary p-8 text-white order-2 lg:order-1">
                <p className="overline mb-4 text-gold">Market Insight</p>
                <div className="grid grid-cols-2 gap-6">
                  {[
                    { stat: '28', label: 'Avg. Days on Market' },
                    { stat: '99%', label: 'List-to-Sale Ratio' },
                    { stat: '2,600 sf', label: 'Avg. Home Size' },
                    { stat: '$650K', label: 'Median in Fair Oaks Ranch' },
                  ].map(({ stat, label }) => (
                    <div key={label}>
                      <div className="font-heading text-display-sm font-bold text-gold">{stat}</div>
                      <div className="text-body-sm text-white/60">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-8 border-t border-white/10 pt-6">
                  <p className="text-body-sm text-white/70">
                    This is the most active segment of the Hill Country market — offering the best
                    combination of value, space, and quality. It&apos;s where serious family buyers compete.
                  </p>
                </div>
              </div>
              <div className="order-1 lg:order-2">
                <p className="overline mb-3 text-gold">Why This Range?</p>
                <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                  The Sweet Spot of the Hill Country Market
                </h2>
                <div className="space-y-4 text-body text-foreground-muted leading-relaxed">
                  <p>
                    The $500K–$750K range is where most growing families end up in the Hill Country —
                    and for good reason. It unlocks access to the best school districts, meaningful
                    acreage options, newer construction with premium finishes, and community amenities
                    that make daily life genuinely enjoyable.
                  </p>
                  <p>
                    You&apos;re also in a range where the inventory is relatively broad — more choices than
                    the luxury tier, better quality than the entry tier. Our agents work this segment
                    daily and know which neighborhoods, subdivisions, and floor plans hold their value.
                  </p>
                </div>
                <ul className="mt-6 space-y-3">
                  {[
                    'Most active and liquid segment of the Hill Country market',
                    'Access to Boerne ISD and Northside ISD top campuses',
                    'New construction and resale options available',
                    'Gated community access within budget at upper end',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-body-sm text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Start Your Search</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Find Your Move-Up Home Today
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse the latest $500K–$750K listings in Fair Oaks Ranch, Boerne, Helotes, and beyond.
                Our local agents are ready to help you find the right home in the right school district.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?minPrice=500000&maxPrice=750000">Browse $500K–$750K Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">
                    Contact an Agent <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Cross-links */}
        <div className="py-8 bg-background-cream border-t border-border">
          <Container>
            <p className="mb-4 text-body-sm font-semibold text-primary text-center">Browse by Price Range</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/homes-for-sale/under-500k" className="rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-foreground-muted hover:border-gold hover:text-gold transition-colors">Under $500K</Link>
              <span className="rounded-full bg-gold/10 border border-gold px-4 py-1.5 text-body-sm font-semibold text-gold">$500K – $750K</span>
              <Link href="/homes-for-sale/750k-1m" className="rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-foreground-muted hover:border-gold hover:text-gold transition-colors">$750K – $1M</Link>
              <Link href="/homes-for-sale/over-1m" className="rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-foreground-muted hover:border-gold hover:text-gold transition-colors">Over $1M</Link>
              <Link href="/luxury-homes" className="rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-foreground-muted hover:border-gold hover:text-gold transition-colors">Luxury Homes</Link>
            </div>
            <div className="mt-4 text-center">
              <Link
                href="/homes-for-sale"
                className="inline-flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors"
              >
                <ArrowRight className="h-4 w-4 rotate-180" /> Browse all Hill Country cities
              </Link>
            </div>
          </Container>
        </div>

      </main>
      <Footer />
    </>
  );
}
