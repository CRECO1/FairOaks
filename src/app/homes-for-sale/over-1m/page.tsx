export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, Shield, CheckCircle,
  ArrowRight, Phone, Star, Eye, Key,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/homes-for-sale/over-1m`;

export const metadata: Metadata = {
  title: 'Luxury Homes Over $1 Million in Texas Hill Country | Fair Oaks Realty Group',
  description:
    'Browse luxury homes over $1 million in Fair Oaks Ranch, Boerne, Cordillera Ranch, The Dominion, and the Texas Hill Country. Hill Country estates, waterfront properties, and custom builds.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'Luxury Homes Over $1 Million in Texas Hill Country | Fair Oaks Realty Group',
    description:
      'Browse luxury homes over $1 million in Fair Oaks Ranch, Boerne, Cordillera Ranch, The Dominion, and the Texas Hill Country. Hill Country estates, waterfront properties, and custom builds.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Luxury Estates Over $1M — Texas Hill Country' }],
  },
  twitter: { card: 'summary_large_image', title: 'Luxury Homes Over $1M — Texas Hill Country | Fair Oaks Realty Group', description: 'Hill Country estates, Cordillera Ranch, and The Dominion luxury homes over $1 million.' },
  keywords: [
    'luxury homes over 1 million texas',
    'homes over 1m san antonio',
    'cordillera ranch homes for sale',
    'the dominion san antonio homes',
    'hill country estates 1 million',
    'luxury real estate fair oaks ranch',
    'million dollar homes boerne tx',
    'custom luxury homes hill country',
    'waterfront estates texas',
    'gated luxury communities san antonio',
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
        { '@type': 'ListItem', position: 3, name: 'Luxury Homes Over $1M', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      description: 'Luxury real estate specialists for homes over $1 million in Fair Oaks Ranch, Boerne, Cordillera Ranch, The Dominion, and the Texas Hill Country.',
      areaServed: [
        { '@type': 'Place', name: 'Fair Oaks Ranch, TX' },
        { '@type': 'Place', name: 'Boerne, TX' },
        { '@type': 'Place', name: 'Cordillera Ranch, TX' },
        { '@type': 'Place', name: 'The Dominion, San Antonio, TX' },
        { '@type': 'Place', name: 'Texas Hill Country' },
      ],
      priceRange: '$$$$',
    },
  ],
};

const COMMUNITIES = [
  {
    name: 'Cordillera Ranch',
    location: 'Boerne, TX',
    priceRange: '$1M – $3M',
    school: 'Boerne ISD',
    description:
      'One of Texas\'s most acclaimed luxury communities — 8,700 acres of private Hill Country ranch land with a Jack Nicklaus Signature golf course, an equestrian center, Guadalupe River access, and five private clubs. Cordillera Ranch defines what Hill Country luxury living looks like at its finest.',
    highlights: ['Jack Nicklaus Signature golf', '8,700-acre private preserve', 'Equestrian center & stables', 'Guadalupe River frontage available'],
  },
  {
    name: 'The Dominion',
    location: 'San Antonio, TX',
    priceRange: '$1M – $5M+',
    school: 'Northside ISD',
    description:
      'San Antonio\'s most prestigious guard-gated community with a world-class private golf course, resort-style clubhouse, and an active social scene. Properties range from elegant villa estates to sprawling custom homes commanding some of the highest prices in the metro area.',
    highlights: ['24-hour guard-gated security', 'Private championship golf club', 'Resort clubhouse & tennis', 'San Antonio\'s most prestigious address'],
  },
  {
    name: 'Fair Oaks Ranch Gated Estates',
    location: 'Fair Oaks Ranch, TX',
    priceRange: '$1M – $2.5M',
    school: 'Boerne ISD',
    description:
      'The pinnacle of Fair Oaks Ranch living — gated estate enclaves with panoramic Hill Country views, equestrian-friendly homesites, and custom homes by the region\'s top builders. Privacy, scale, and Hill Country beauty in perfect balance, with Boerne ISD schools at your doorstep.',
    highlights: ['Gated entry with 24-hr security', 'Equestrian trails on-site', 'Custom estate home sites', 'Panoramic Hill Country views'],
  },
  {
    name: 'Custom Hill Country Estates',
    location: 'Boerne & Fair Oaks Ranch, TX',
    priceRange: '$1M – $4M+',
    school: 'Boerne ISD',
    description:
      'Private custom-built estates on 5–100+ acres throughout the Hill Country. Limestone and cedar architecture, resort-style pools, outdoor pavilions, working ranches, and private ponds — crafted by the region\'s finest builders for buyers who want a truly one-of-a-kind property.',
    highlights: ['5–100+ acre homesites', 'Custom architect-designed homes', 'Resort pools & outdoor pavilions', 'Private ponds & ranch features'],
  },
];

const LUXURY_SERVICES = [
  {
    icon: Eye,
    title: 'Off-Market & Private Listings',
    description:
      'Many $1M+ properties in the Hill Country never appear on public portals. Our network of top producers, builder relationships, and seller connections gives you access before the market does.',
  },
  {
    icon: Shield,
    title: 'Discretion & Confidentiality',
    description:
      'High-net-worth transactions require privacy. We protect your identity, timeline, and financial details throughout every step of the buying or selling process.',
  },
  {
    icon: Key,
    title: 'Private Estate Showings',
    description:
      'We coordinate private, appointment-only showings on estates across Cordillera Ranch, The Dominion, and Fair Oaks Ranch — on your schedule, without public open house exposure.',
  },
  {
    icon: Star,
    title: 'Luxury Market Expertise',
    description:
      'Negotiating a $2M+ estate requires a different skill set. We bring deep knowledge of luxury comps, sophisticated contract strategy, and the credibility with listing agents that gets your offers taken seriously.',
  },
];

const AGENT_PROFILE = {
  name: 'Sandra Whitfield',
  title: 'Luxury Property Specialist',
  bio: 'Sandra has been representing buyers and sellers in the Hill Country\'s luxury tier for over 15 years. With deep roots in the Cordillera Ranch, The Dominion, and Fair Oaks Ranch gated communities, she has closed over $200M in luxury real estate and is consistently recognized as one of the region\'s top producers. Sandra brings discretion, deep market knowledge, and genuine commitment to every $1M+ client she serves.',
  credentials: [
    'CLHMS (Certified Luxury Home Marketing Specialist)',
    '$200M+ in luxury transaction volume',
    '15+ years in Hill Country luxury market',
    'Deep relationships in Cordillera Ranch & The Dominion',
  ],
};

const STATS = [
  { label: 'Avg. Days on Market', value: '45', sub: 'Luxury $1M+ segment' },
  { label: 'Starting Price', value: '$1M', sub: 'Entry to luxury tier' },
  { label: 'Avg. Lot Size', value: '2–10 ac', sub: 'Estate properties' },
  { label: 'Communities', value: '6+', sub: 'Gated luxury options' },
];

export default function Over1mPage() {
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
              <span className="text-primary font-medium">Luxury Over $1M</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">
                <DollarSign className="mr-1 inline h-3 w-3" />
                Exceptional Luxury Real Estate
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Luxury Estates Over $1 Million in the Texas Hill Country
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Discover the finest estates in Fair Oaks Ranch, Cordillera Ranch, The Dominion,
                Boerne, and the Texas Hill Country. Private acreage, gated communities, custom
                architecture, and waterfront properties — represented with the discretion your
                investment deserves.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?minPrice=1000000">Browse Luxury Listings</Link>
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

        {/* The Finest Communities */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">Where the Finest Estates Live</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                The Finest Communities Over $1M
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                These are the premier communities for buyers seeking Hill Country luxury over $1 million.
                Each offers a distinct lifestyle — from private golf estates to working ranch land.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              {COMMUNITIES.map((community) => (
                <div
                  key={community.name}
                  className="rounded-2xl bg-background-cream border border-border shadow-sm p-7 sm:p-8 flex flex-col"
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
            <div className="mt-8 text-center">
              <Button size="lg" asChild>
                <Link href="/luxury-homes">
                  View Full Luxury Communities Guide <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </Container>
        </section>

        {/* Luxury Services */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">White-Glove Service</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Luxury Buying & Selling Services
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Buying or selling a $1M+ estate in the Hill Country requires a level of service,
                discretion, and expertise that goes far beyond a standard transaction.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {LUXURY_SERVICES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-2xl bg-white border border-border shadow-sm p-7 flex flex-col"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10 mb-4">
                    <Icon className="h-6 w-6 text-gold" />
                  </div>
                  <h3 className="mb-3 font-heading text-body font-bold text-primary">{title}</h3>
                  <p className="text-body-sm text-foreground-muted leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Agent Profile */}
        <section className="section-compact bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">Your Luxury Specialist</p>
                <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                  {AGENT_PROFILE.name}
                </h2>
                <p className="mb-2 text-body-sm font-semibold text-gold">{AGENT_PROFILE.title}</p>
                <p className="mb-6 text-body text-foreground-muted leading-relaxed">{AGENT_PROFILE.bio}</p>
                <ul className="space-y-3">
                  {AGENT_PROFILE.credentials.map((c) => (
                    <li key={c} className="flex items-start gap-3 text-body-sm text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      {c}
                    </li>
                  ))}
                </ul>
                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                  <Button size="lg" asChild>
                    <Link href="/contact">Request a Private Consultation</Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <a href="tel:+12103909997">
                      <Phone className="mr-2 h-4 w-4" /> (210) 390-9997
                    </a>
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-background-cream p-8">
                <Star className="mb-4 h-9 w-9 text-gold" />
                <h3 className="mb-3 font-heading text-heading-xl font-bold text-primary">
                  What Defines Hill Country Luxury Over $1M
                </h3>
                <div className="space-y-4 text-body-sm text-foreground-muted leading-relaxed">
                  <p>
                    At this level, properties are not simply large homes — they are lifestyle investments.
                    Expect resort-style pools, outdoor kitchen pavilions, smart home automation,
                    wine cellars, guest quarters, and professional-grade everything as baseline features.
                  </p>
                  <p>
                    At the ultra-luxury level ($2M+), working horse facilities, private ponds, full
                    guest ranches, helicopter pads, and vineyard-scale acreage are not uncommon.
                    The Hill Country&apos;s terrain and land availability make this possible at price points
                    that would be impossible in comparable coastal markets.
                  </p>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-4">
                  {[
                    { icon: Home, label: 'Custom Architecture' },
                    { icon: Shield, label: '24-Hr Gated Security' },
                    { icon: Star, label: 'Resort-Style Pools' },
                    { icon: MapPin, label: 'Hill Country Acreage' },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-2 text-body-sm text-foreground-muted">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/10">
                        <Icon className="h-4 w-4 text-gold" />
                      </div>
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* What to Expect at $1M+ */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="mx-auto max-w-4xl">
              <div className="mb-10 text-center">
                <p className="overline mb-3 text-gold">A Different Market</p>
                <h2 className="font-heading text-display-sm font-bold text-primary">
                  The $1M+ Market: What Buyers Should Know
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
                {[
                  {
                    stat: '45',
                    label: 'Avg. Days on Market',
                    desc: 'Luxury homes take longer to sell — patience and correct pricing are essential.',
                  },
                  {
                    stat: '97%',
                    label: 'List-to-Sale Ratio',
                    desc: 'Well-positioned luxury listings typically close near list price in this market.',
                  },
                  {
                    stat: '$1M–$5M+',
                    label: 'Active Price Range',
                    desc: 'Our agents transact across the full spectrum of Hill Country luxury.',
                  },
                ].map(({ stat, label, desc }) => (
                  <div key={label} className="rounded-2xl bg-white border border-border p-6 text-center">
                    <div className="font-heading text-display-sm font-bold text-gold mb-1">{stat}</div>
                    <div className="font-heading text-body font-semibold text-primary mb-2">{label}</div>
                    <p className="text-body-sm text-foreground-muted">{desc}</p>
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
              <p className="overline mb-3 text-gold">Begin Your Estate Search</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Ready to Explore Hill Country Luxury?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse active luxury listings over $1 million — or connect with our luxury specialist
                for a private consultation. No obligation, full discretion.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?minPrice=1000000">Browse Luxury Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">
                    Request Private Consultation <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <div className="mt-6">
                <Link
                  href="/luxury-homes"
                  className="inline-flex items-center gap-1 text-body-sm text-white/60 hover:text-white transition-colors"
                >
                  View our full Luxury Homes guide <ArrowRight className="h-3.5 w-3.5" />
                </Link>
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
              <Link href="/homes-for-sale/750k-1m" className="rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-foreground-muted hover:border-gold hover:text-gold transition-colors">$750K – $1M</Link>
              <span className="rounded-full bg-gold/10 border border-gold px-4 py-1.5 text-body-sm font-semibold text-gold">Over $1M</span>
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
