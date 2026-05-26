export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, Shield, CheckCircle,
  ArrowRight, Phone, Star, Trees,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/homes-for-sale/750k-1m`;

export const metadata: Metadata = {
  title: 'Homes $750K–$1M in Texas Hill Country | Fair Oaks Ranch & Boerne',
  description:
    'Find homes priced $750K–$1M in Fair Oaks Ranch, Boerne, and luxury Hill Country neighborhoods. Spacious estates with premium finishes.',
  alternates: { canonical: '/homes-for-sale/750k-1m' },
  openGraph: {
    title: 'Homes $750K–$1M in Texas Hill Country | Fair Oaks Ranch & Boerne',
    description:
      'Discover luxury homes $750,000–$1,000,000 in Fair Oaks Ranch, Boerne, and the Texas Hill Country. Gated communities, custom builds, and Hill Country estates near San Antonio.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Premium Homes $750K–$1M — Texas Hill Country' }],
  },
  twitter: { card: 'summary_large_image', title: 'Homes $750K–$1M — Texas Hill Country | Fair Oaks Realty Group', description: 'Gated communities, custom builds, and Hill Country estates $750K–$1M near San Antonio.' },
  keywords: [
    'homes 750k to 1 million texas',
    'luxury homes fair oaks ranch 800k',
    'boerne homes 750000 to 1 million',
    'premium homes hill country',
    'gated community homes san antonio',
    'custom homes boerne tx',
    'homes near 1 million fair oaks ranch',
    'hill country estates 800k',
    'luxury family homes texas',
    'homes 750k-1m san antonio',
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
        { '@type': 'ListItem', position: 3, name: 'Homes $750K–$1M', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      description: 'Premium real estate specialists for homes $750K–$1M in Fair Oaks Ranch, Boerne, and the Texas Hill Country.',
      areaServed: [
        { '@type': 'Place', name: 'Fair Oaks Ranch, TX' },
        { '@type': 'Place', name: 'Boerne, TX' },
        { '@type': 'Place', name: 'San Antonio, TX' },
        { '@type': 'Place', name: 'Texas Hill Country' },
      ],
      priceRange: '$$$$',
    },
  ],
};

const WHAT_YOU_GET = [
  {
    icon: Shield,
    title: 'Gated Communities',
    priceRange: '$750K – $850K',
    description:
      'Enter fully gated communities with controlled access, security patrols, and HOA-maintained landscaping. These communities offer resort-style pools, fitness centers, walking trails, and a genuine sense of private neighborhood life.',
    highlights: ['Controlled access gates', 'Neighborhood pools & fitness', 'HOA-maintained common areas', 'Boerne ISD or Northside ISD'],
  },
  {
    icon: Trees,
    title: 'Acreage & Estate Lots',
    priceRange: '$800K – $950K',
    description:
      'Properties on 1–5 acres with room for pools, outdoor living, gardens, and guest quarters. These estate lots are increasingly rare within commuting distance of San Antonio and command a significant premium for buyers who prioritize land and privacy.',
    highlights: ['1–5 acre homesites', 'Room for pools & outdoor kitchens', 'Privacy from neighbors', 'Potential for guest quarters'],
  },
  {
    icon: Star,
    title: 'Custom Finishes & Builds',
    priceRange: '$850K – $1M',
    description:
      'At the upper end of this range, buyers access full custom builds and near-luxury spec homes with professional-grade kitchens, imported stone and tile, vaulted ceilings, resort pools, outdoor fireplace pavilions, and 4-car garages.',
    highlights: ['Professional-grade kitchens', 'Imported tile & stone', 'Resort-style outdoor living', '4-car garages common'],
  },
];

const COMMUNITIES = [
  {
    name: 'Fair Oaks Ranch Gated Estates',
    location: 'Fair Oaks Ranch, TX',
    priceRange: '$800K – $1M',
    school: 'Boerne ISD',
    description:
      'Rolling Hill Country terrain with gated entries, equestrian-friendly lots, and estate-scale homes. The pinnacle of master-planned living northwest of San Antonio — with sweeping views and immediate access to Boerne ISD\'s top-rated schools.',
    highlights: ['Gated entry with security', 'Equestrian-friendly lots', 'Hill Country panoramic views', 'Custom home builders welcome'],
  },
  {
    name: 'Cordillera Ranch (Entry Estates)',
    location: 'Boerne, TX',
    priceRange: '$750K – $1M',
    school: 'Boerne ISD',
    description:
      'The entry tier of one of Texas\'s most acclaimed luxury communities. Cordillera Ranch\'s 8,700-acre private preserve offers Jack Nicklaus golf, river access, and an equestrian center — all within the $750K–$1M range for select estate lots.',
    highlights: ['8,700-acre private community', 'Access to 5 private clubs', 'Guadalupe River frontage available', 'Jack Nicklaus golf community'],
  },
  {
    name: 'Boerne Premium Subdivisions',
    location: 'Boerne, TX',
    priceRange: '$750K – $950K',
    school: 'Boerne ISD',
    description:
      'Award-winning custom and semi-custom homes in established Boerne subdivisions. Walkable to Main Street, close to Cibolo Nature Center, and consistently among the most desirable addresses in the region for families prioritizing both quality of life and schools.',
    highlights: ['Walking distance to Main Street', 'Established neighborhood trees', 'Custom architecture', 'Strong resale history'],
  },
  {
    name: 'Helotes Premium Estates',
    location: 'Helotes, TX',
    priceRange: '$750K – $1M',
    school: 'Northside ISD',
    description:
      'The upper tier of Helotes real estate offers large lot sizes, custom builds, and quick access to both the Hill Country and San Antonio. Top-rated Northside ISD campuses, easy I-10 commutes, and a strong sense of community make this a favorite for relocating executives.',
    highlights: ['Northside ISD top campuses', 'Large lots with Hill Country views', 'Easy I-10 & 1604 access', 'Equestrian options available'],
  },
];

const COMPARISON = [
  { market: 'Texas Hill Country ($750K–$1M)', sqft: '3,200–4,500 sf', lot: '0.5–3 acres', features: 'Gated, acreage, views, custom' },
  { market: 'Austin suburbs ($750K–$1M)', sqft: '2,800–3,800 sf', lot: '0.25–0.5 acres', features: 'New construction, smaller lots' },
  { market: 'Phoenix, AZ ($750K–$1M)', sqft: '2,600–3,400 sf', lot: '0.2–0.4 acres', features: 'Desert views, HOA communities' },
  { market: 'Nashville, TN ($750K–$1M)', sqft: '2,800–3,600 sf', lot: '0.3–0.6 acres', features: 'New builds, higher density' },
];

const STATS = [
  { label: 'Avg. Days on Market', value: '35', sub: '$750K–$1M segment' },
  { label: 'Avg. Home Size', value: '3,400 sf', sub: 'In this price range' },
  { label: 'Lot Size Range', value: '0.5–3 ac', sub: 'Typical estate lots' },
  { label: 'Communities', value: '10+', sub: 'Gated options available' },
];

export default function From750kTo1mPage() {
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
              <span className="text-primary font-medium">Homes $750K–$1M</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">
                <DollarSign className="mr-1 inline h-3 w-3" />
                Premium Hill Country Real Estate
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Premium Homes $750K–$1M in the Texas Hill Country
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                In the $750K–$1M range, buyers gain access to gated communities, estate acreage, custom
                architecture, and resort-style outdoor living — all within the breathtaking landscape of
                the Texas Hill Country near San Antonio.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?minPrice=750000&maxPrice=1000000">Browse $750K–$1M Homes</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Schedule Private Consultation</Link>
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

        {/* What $750K–$1M Gets You */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">Your Investment, Your Lifestyle</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                What $750K–$1M Gets You
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                This price range marks the entry into Hill Country luxury — where gated communities,
                estate acreage, and full custom finishes become readily accessible.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              {WHAT_YOU_GET.map(({ icon: Icon, title, priceRange, description, highlights }) => (
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

        {/* Featured Communities */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">Where Buyers Look</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Featured Communities
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                These are the four communities that consistently attract the most buyers in the $750K–$1M range.
                Each offers a distinct lifestyle and location advantage.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              {COMMUNITIES.map((community) => (
                <div
                  key={community.name}
                  className="rounded-2xl bg-white border border-border shadow-sm p-7 flex flex-col"
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-heading text-heading font-bold text-primary mb-1">{community.name}</h3>
                      <p className="flex items-center gap-1 text-body-sm text-foreground-muted">
                        <MapPin className="h-3.5 w-3.5 shrink-0" /> {community.location}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-heading text-body font-bold text-gold">{community.priceRange}</div>
                      <div className="text-caption text-foreground-muted">{community.school}</div>
                    </div>
                  </div>
                  <p className="mb-5 text-body-sm text-foreground-muted leading-relaxed flex-1">{community.description}</p>
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {community.highlights.map((h) => (
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

        {/* Comparison Table vs Other Markets */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-gold">Why Texas Hill Country?</p>
              <h2 className="font-heading text-display-sm font-bold text-primary">
                How $750K–$1M Compares to Other Markets
              </h2>
              <p className="mt-4 mx-auto max-w-2xl text-body text-foreground-muted">
                Your dollar goes further in the Hill Country than in comparable sun-belt markets.
              </p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
              <table className="min-w-full">
                <thead className="bg-primary text-white">
                  <tr>
                    <th className="px-6 py-4 text-left text-body-sm font-semibold">Market</th>
                    <th className="px-6 py-4 text-left text-body-sm font-semibold">Home Size</th>
                    <th className="px-6 py-4 text-left text-body-sm font-semibold">Lot Size</th>
                    <th className="px-6 py-4 text-left text-body-sm font-semibold">Key Features</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {COMPARISON.map((row, i) => (
                    <tr key={row.market} className={i === 0 ? 'bg-gold/5' : 'bg-white'}>
                      <td className="px-6 py-4 text-body-sm font-semibold text-primary whitespace-nowrap">{row.market}</td>
                      <td className="px-6 py-4 text-body-sm text-foreground-muted whitespace-nowrap">{row.sqft}</td>
                      <td className="px-6 py-4 text-body-sm text-foreground-muted whitespace-nowrap">{row.lot}</td>
                      <td className="px-6 py-4 text-body-sm text-foreground-muted">{row.features}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Container>
        </section>

        {/* Agent Sidebar CTA */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-gold">Expert Guidance</p>
                <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                  Buying in This Range Requires Local Expertise
                </h2>
                <div className="space-y-4 text-body text-foreground-muted leading-relaxed">
                  <p>
                    The $750K–$1M segment in the Hill Country is nuanced. Community HOA rules, utility
                    infrastructure, deed restrictions, well/septic vs. city utilities, and view easements
                    all materially affect value. A buyer who isn&apos;t working with an experienced local agent
                    can easily miss these factors — or overpay for a property that has hidden limitations.
                  </p>
                  <p>
                    Our agents have transacted extensively in every community in this price range. We know
                    which lots have obstructed views, which HOAs are well-funded, and where builder
                    relationships can unlock access to spec homes before they&apos;re listed publicly.
                  </p>
                </div>
                <ul className="mt-6 space-y-3">
                  {[
                    '20+ years of Hill Country market transactions',
                    'Deep knowledge of gated communities and their covenants',
                    'Builder relationships for pre-market access',
                    'Expert negotiation on $750K–$1M offers',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-body-sm text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-8 rounded-2xl border border-border bg-white p-7">
                  <p className="overline mb-2 text-gold">Browse Listings</p>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">
                    View Active $750K–$1M Inventory
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    Browse all homes currently listed between $750,000 and $1,000,000 across our service areas.
                    Updated daily with full MLS data.
                  </p>
                  <Button asChild>
                    <Link href="/listings?minPrice=750000&maxPrice=1000000">
                      View $750K–$1M Listings <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <Home className="mb-3 h-7 w-7 text-gold" />
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Ready to Explore This Range?
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    Our agents specialize in the $750K–$1M Hill Country market. Let us show you
                    what&apos;s available and help you navigate this competitive tier.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact">Schedule a Consultation</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?minPrice=750000&maxPrice=1000000">Browse Listings</Link>
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

        {/* CTA Banner */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Start Your Premium Search</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Find Your Premium Hill Country Home
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse $750K–$1M listings in Fair Oaks Ranch, Boerne, Cordillera Ranch, and beyond.
                Our agents are ready to guide you through the premium tier with local expertise and genuine care.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?minPrice=750000&maxPrice=1000000">Browse Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">
                    Talk to a Specialist <ArrowRight className="ml-2 h-4 w-4" />
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
              <Link href="/homes-for-sale/500k-750k" className="rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-foreground-muted hover:border-gold hover:text-gold transition-colors">$500K – $750K</Link>
              <span className="rounded-full bg-gold/10 border border-gold px-4 py-1.5 text-body-sm font-semibold text-gold">$750K – $1M</span>
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
