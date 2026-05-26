export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, Clock, CheckCircle,
  ArrowRight, Phone, TrendingUp, Users, Star,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/homes-for-sale/under-500k`;

export const metadata: Metadata = {
  title: 'Homes Under $500K in Fair Oaks Ranch & Texas Hill Country | Fair Oaks Realty Group',
  description:
    'Search homes for sale under $500,000 in Fair Oaks Ranch, Boerne, Helotes, and San Antonio. Affordable Hill Country and NW San Antonio homes updated daily.',
  alternates: { canonical: '/homes-for-sale/under-500k' },
  openGraph: {
    title: 'Homes Under $500K in Fair Oaks Ranch & Texas Hill Country | Fair Oaks Realty Group',
    description:
      'Browse homes under $500,000 in Fair Oaks Ranch, Boerne, Helotes, and San Antonio. Starter homes, updated ranches, and great-value Hill Country properties.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Affordable Homes Under $500K — Texas Hill Country' }],
  },
  twitter: { card: 'summary_large_image', title: 'Homes Under $500K — Texas Hill Country | Fair Oaks Realty Group', description: 'Starter homes and affordable properties in the Texas Hill Country under $500,000.' },
  keywords: [
    'homes under 500k san antonio',
    'affordable homes fair oaks ranch',
    'homes under 500000 texas',
    'starter homes boerne tx',
    'budget homes texas hill country',
    'homes for sale under 500k',
    'san antonio homes 400k',
    'affordable hill country homes',
    'first home fair oaks ranch',
    'homes 300k-500k texas',
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
        { '@type': 'ListItem', position: 3, name: 'Homes Under $500K', item: CANONICAL },
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What kind of homes can I find under $500K in the Texas Hill Country?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Under $500K in the Texas Hill Country you can find starter homes in established neighborhoods, updated ranch-style homes on larger lots, townhomes and patio homes near major corridors, and entry-level properties in communities like Helotes, San Antonio\'s northwest side, and parts of Boerne.',
          },
        },
        {
          '@type': 'Question',
          name: 'Are there homes under $500K in Fair Oaks Ranch?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Homes under $500K in Fair Oaks Ranch itself are rare but do come to market periodically — typically smaller square footage or townhome-style properties. More frequently, buyers in this budget find excellent value in neighboring Helotes, northwest San Antonio, and entry-level Boerne communities.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is $500K enough to buy a home in Boerne, TX?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes — homes under $500K exist in Boerne, particularly older builds closer to downtown or in smaller subdivisions. The Boerne market averages around $575K, so buyers under $500K will find more limited inventory but can still access top-rated Boerne ISD schools.',
          },
        },
        {
          '@type': 'Question',
          name: 'What neighborhoods have the most homes under $500K near San Antonio?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Helotes, northwest San Antonio (near Loop 1604 and Culebra), Converse, Schertz, and Cibolo consistently offer solid inventory under $500K. These areas provide good school districts, reasonable commutes, and well-maintained subdivisions.',
          },
        },
        {
          '@type': 'Question',
          name: 'How fast do homes under $500K sell in this area?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Entry-level inventory under $500K typically moves faster than the overall market — well-priced homes in desirable school districts often go under contract within 2–3 weeks. Working with a local agent to get pre-approved and set up on instant MLS alerts is strongly recommended.',
          },
        },
      ],
    },
  ],
};

const PROPERTY_TYPES = [
  {
    icon: Home,
    title: 'Starter Homes & Ranches',
    priceRange: '$300K – $420K',
    description:
      'Three-bedroom ranches and traditional starter homes in established neighborhoods. Expect 1,400–1,800 sq ft, mature trees, and larger lots than newer builds. Ideal for first-time buyers or those downsizing.',
    highlights: ['1,400–1,800 sq ft', 'Established neighborhoods', 'Larger lot sizes', 'Northside or Judson ISD'],
  },
  {
    icon: TrendingUp,
    title: 'Updated Homes & Move-In Ready',
    priceRange: '$420K – $480K',
    description:
      'Remodeled kitchens, new flooring, fresh paint, and modern fixtures at a fraction of new construction cost. These homes combine value-price points with turnkey convenience in sought-after school zones.',
    highlights: ['Updated kitchens & baths', 'Move-in ready', 'Boerne or Northside ISD zones', '1,800–2,200 sq ft'],
  },
  {
    icon: Users,
    title: 'New Construction Value Buys',
    priceRange: '$450K – $499K',
    description:
      'Builder spec homes and entry-level new construction in growing communities like Helotes, Bulverde fringe, and northwest San Antonio corridors. Brand new everything with builder warranties.',
    highlights: ['Builder warranty included', 'Energy-efficient builds', 'Growing communities', 'Modern open floor plans'],
  },
];

const NEIGHBORHOODS = [
  { name: 'Helotes, TX', slug: 'helotes-tx', avgPrice: '$490K', note: 'Best under-$500K access near Hill Country' },
  { name: 'San Antonio, TX', slug: 'san-antonio-tx', avgPrice: '$385K', note: 'Widest selection of affordable homes' },
  { name: 'Boerne, TX', slug: 'boerne-tx', avgPrice: '$575K', note: 'Limited under $500K — move fast when they appear' },
  { name: 'New Braunfels, TX', slug: 'new-braunfels-tx', avgPrice: '$435K', note: 'Growing market with good entry-level inventory' },
];

const STATS = [
  { label: 'Avg. Days on Market', value: '21', sub: 'For under-$500K homes' },
  { label: 'List-to-Sale Ratio', value: '103%', sub: 'Competitive segment' },
  { label: 'Starting Price', value: '$280K', sub: 'Entry point in region' },
  { label: 'School Districts', value: '4+', sub: 'Quality ISDs available' },
];

export default function Under500kPage() {
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
              <span className="text-primary font-medium">Homes Under $500K</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">
                <DollarSign className="mr-1 inline h-3 w-3" />
                Affordable Texas Hill Country Real Estate
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Affordable Homes Under $500K in the Texas Hill Country
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                You don&apos;t have to break the bank to live in one of Texas&apos;s most sought-after regions.
                Browse starter homes, updated ranches, and great-value properties in Fair Oaks Ranch,
                Boerne, Helotes, and San Antonio — all under $500,000.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?maxPrice=500000">Browse Homes Under $500K</Link>
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

        {/* What $500K Buys */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">Your Budget, Your Options</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                What $500K Buys in the Hill Country
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                The under-$500K market in the Texas Hill Country offers genuine value. Here are the three
                main property types you&apos;ll find in this price range.
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

        {/* Best Neighborhoods */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-gold">Where to Search</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  Best Neighborhoods Under $500K
                </h2>
                <p className="mb-8 text-body text-foreground-muted leading-relaxed">
                  Not every Hill Country community has inventory under $500K — but these areas consistently
                  offer strong options for buyers in this budget. Each offers a distinct lifestyle, school
                  district, and commute profile.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {NEIGHBORHOODS.map(({ name, slug, avgPrice, note }) => (
                    <Link
                      key={slug}
                      href={`/homes-for-sale/${slug}`}
                      className="group flex items-start gap-4 rounded-xl border border-border bg-white p-5 shadow-sm hover:shadow-card hover:border-gold transition-all"
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
                <div className="mt-8 rounded-2xl border border-border bg-white p-7">
                  <p className="overline mb-2 text-gold">Ready to Search?</p>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">
                    Browse Active Listings Under $500K
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all homes currently priced under $500,000 across our service areas. Updated daily from the MLS.
                    Use the max price filter to narrow your search.
                  </p>
                  <Button asChild>
                    <Link href="/listings?maxPrice=500000">
                      View Under-$500K Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <Star className="mb-3 h-7 w-7 text-gold" />
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    First-Time Buyer?
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    Navigating the market under $500K requires speed and local knowledge. Our agents know
                    exactly where value is hiding — and how to win in a competitive offer situation.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact">Talk to a Buyer&apos;s Agent</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?maxPrice=500000">See Available Homes</Link>
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

        {/* Why Act Fast */}
        <section className="section-compact bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">Market Insight</p>
                <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                  The Under-$500K Market Moves Fast
                </h2>
                <div className="space-y-4 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Entry-level inventory in the Texas Hill Country is highly competitive. Well-priced
                    homes under $500K in quality school districts frequently receive multiple offers within
                    the first weekend on market — and often sell above list price.
                  </p>
                  <p>
                    To compete effectively in this segment, buyers need a local agent with strong
                    relationships, an MLS alert system that notifies you the moment a home hits the market,
                    and a pre-approval letter ready to go. Our agents specialize in helping buyers
                    move quickly without making costly mistakes.
                  </p>
                </div>
                <ul className="mt-6 space-y-3">
                  {[
                    'Avg. 21 days on market — move fast or miss out',
                    '103% list-to-sale ratio in competitive segments',
                    'Pre-approval letter dramatically improves offer acceptance',
                    'Instant MLS alerts for new under-$500K listings',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-body-sm text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl bg-primary p-8 text-white">
                <p className="overline mb-4 text-gold">By the Numbers</p>
                <div className="grid grid-cols-2 gap-6">
                  {[
                    { stat: '21', label: 'Avg. Days on Market' },
                    { stat: '103%', label: 'List-to-Sale Ratio' },
                    { stat: '$280K', label: 'Entry Price Point' },
                    { stat: '4+', label: 'Quality ISDs Covered' },
                  ].map(({ stat, label }) => (
                    <div key={label}>
                      <div className="font-heading text-display-sm font-bold text-gold">{stat}</div>
                      <div className="text-body-sm text-white/60">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-8 border-t border-white/10 pt-6">
                  <p className="text-body-sm text-white/70">
                    These stats reflect the competitive nature of affordable Hill Country inventory. Work
                    with a local agent to stay ahead.
                  </p>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* FAQ */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="mx-auto max-w-3xl">
              <div className="mb-10 text-center">
                <p className="overline mb-3 text-gold">Common Questions</p>
                <h2 className="font-heading text-display-sm font-bold text-primary">
                  Homes Under $500K — FAQ
                </h2>
              </div>
              <div className="space-y-6">
                {[
                  {
                    q: 'What kind of homes can I find under $500K in the Texas Hill Country?',
                    a: 'Under $500K in the Texas Hill Country you can find starter homes in established neighborhoods, updated ranch-style homes on larger lots, townhomes and patio homes near major corridors, and entry-level properties in communities like Helotes, San Antonio\'s northwest side, and parts of Boerne.',
                  },
                  {
                    q: 'Are there homes under $500K in Fair Oaks Ranch?',
                    a: 'Homes under $500K in Fair Oaks Ranch itself are rare but do come to market periodically — typically smaller square footage or townhome-style properties. More frequently, buyers in this budget find excellent value in neighboring Helotes, northwest San Antonio, and entry-level Boerne communities.',
                  },
                  {
                    q: 'Is $500K enough to buy a home in Boerne, TX?',
                    a: 'Yes — homes under $500K exist in Boerne, particularly older builds closer to downtown or in smaller subdivisions. The Boerne market averages around $575K, so buyers under $500K will find more limited inventory but can still access top-rated Boerne ISD schools.',
                  },
                  {
                    q: 'What neighborhoods have the most homes under $500K near San Antonio?',
                    a: 'Helotes, northwest San Antonio (near Loop 1604 and Culebra), Converse, Schertz, and Cibolo consistently offer solid inventory under $500K. These areas provide good school districts, reasonable commutes, and well-maintained subdivisions.',
                  },
                  {
                    q: 'How fast do homes under $500K sell in this area?',
                    a: 'Entry-level inventory under $500K typically moves faster than the overall market — well-priced homes in desirable school districts often go under contract within 2–3 weeks. Working with a local agent to get pre-approved and set up on instant MLS alerts is strongly recommended.',
                  },
                ].map(({ q, a }) => (
                  <div key={q} className="rounded-xl border border-border bg-white p-6">
                    <h3 className="mb-3 font-heading text-body font-bold text-primary">{q}</h3>
                    <p className="text-body-sm text-foreground-muted leading-relaxed">{a}</p>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Let&apos;s Find Your Home</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Ready to Buy Under $500K?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Our local agents know where the best value is hiding in the Hill Country. Contact us today
                for a no-pressure consultation — or browse active listings right now.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?maxPrice=500000">Browse Under-$500K Homes</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">
                    Talk to an Agent <ArrowRight className="ml-2 h-4 w-4" />
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
              <span className="rounded-full bg-gold/10 border border-gold px-4 py-1.5 text-body-sm font-semibold text-gold">Under $500K</span>
              <Link href="/homes-for-sale/500k-750k" className="rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-foreground-muted hover:border-gold hover:text-gold transition-colors">$500K – $750K</Link>
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
