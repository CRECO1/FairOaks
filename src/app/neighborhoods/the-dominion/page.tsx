export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, Shield, Star,
  CheckCircle, ArrowRight, Phone, Car, Trophy,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/neighborhoods/the-dominion`;

export const metadata: Metadata = {
  title: 'The Dominion San Antonio TX | Luxury Gated Community Homes for Sale',
  description:
    'Homes for sale in The Dominion, San Antonio TX — San Antonio\'s most prestigious gated community with 24-hour security, golf course, and luxury estates from $800K.',
  alternates: { canonical: '/neighborhoods/the-dominion' },
  openGraph: {
    title: 'The Dominion San Antonio TX | Luxury Gated Community Homes for Sale',
    description:
      'Browse homes for sale in The Dominion, San Antonio\'s most prestigious gated community. Custom estates $800K–$5M+, 24-hour security, private golf club, and elite Hill Country living.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'The Dominion Luxury Homes — San Antonio TX' }],
  },
  twitter: { card: 'summary_large_image' },
  keywords: [
    'the dominion san antonio homes for sale',
    'the dominion gated community',
    'dominion san antonio real estate',
    'luxury homes the dominion',
    'dominion san antonio tx listings',
    'gated community san antonio luxury',
    'the dominion country club homes',
    'dominion estates san antonio',
    'homes the dominion tx',
    'san antonio gated luxury community',
  ],
};

const STATS = [
  { icon: DollarSign, value: '$800K – $5M+', label: 'Home Price Range' },
  { icon: Home, value: '~1.5M', label: 'Avg. Home Price' },
  { icon: Shield, value: '24/7', label: 'Gated Security' },
  { icon: MapPin, value: '~2,500 acres', label: 'Community Size' },
];

const AMENITIES = [
  { icon: Trophy, title: 'Private Golf Club', desc: 'Two championship golf courses within the community — including a private club with member-only access and tournament-quality facilities.' },
  { icon: Star, title: 'Country Club & Dining', desc: 'The Dominion Country Club offers fine dining, banquet facilities, private events, and an active social calendar for residents.' },
  { icon: Shield, title: '24-Hour Guard-Gated', desc: 'Multiple staffed entry points operate around the clock. Every guest, contractor, and resident is screened — delivering unmatched privacy and peace of mind.' },
  { icon: Home, title: 'Tennis & Fitness', desc: 'Resort-quality tennis courts, a full fitness center, and resort-style pool facilities round out the on-site amenity package.' },
];

const WHY_FAIR_OAKS = [
  'Proven track record in $1M+ luxury transactions',
  'Deep relationships with Dominion listing agents',
  'Access to off-market and pre-market estate listings',
  'Discretion and confidentiality for every transaction',
  'Expert luxury negotiation — not just a search portal',
  'Sandra Whitfield: Broker/Owner and luxury specialist',
];

const FAQS = [
  {
    q: 'What is the price range of homes in The Dominion?',
    a: 'Homes in The Dominion range from approximately $800,000 for smaller villa-style properties to $5 million and above for large custom estates. The average sale price typically falls around $1.5 million. Custom estate lots are also available for buyers who want to build from the ground up.',
  },
  {
    q: 'Is The Dominion truly a gated community with 24-hour security?',
    a: 'Yes. The Dominion operates staffed guard gates 24 hours a day, 7 days a week. All entry points are monitored, and access for guests and vendors must be authorized by residents. This level of security is one of the primary reasons buyers choose The Dominion over other San Antonio luxury neighborhoods.',
  },
  {
    q: 'What school district serves The Dominion?',
    a: 'The Dominion is served by Northside ISD, one of the largest school districts in Texas. The area is zoned to highly regarded campuses including Leon Springs Elementary and Clark High School. Several private school options — including BASIS San Antonio and TMI Episcopal — are also within easy driving distance.',
  },
  {
    q: 'How far is The Dominion from downtown San Antonio?',
    a: 'The Dominion is located in northwest San Antonio, approximately 20 minutes from downtown via I-10. The South Texas Medical Center is about 15 minutes away. UTSA and the Rim/La Cantera shopping district are within 10 minutes, making The Dominion exceptionally well-connected despite its secluded feel.',
  },
];

const NEARBY = [
  { name: 'Cordillera Ranch', href: '/neighborhoods/cordillera-ranch', desc: 'Boerne\'s premier 8,700-acre private estate community' },
  { name: 'Fair Oaks Ranch', href: '/neighborhoods/fair-oaks-ranch', desc: 'Master-planned Hill Country living, 20 miles from San Antonio' },
  { name: 'Boerne, TX', href: '/homes-for-sale/boerne-tx', desc: 'Charming Hill Country town with award-winning schools' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Neighborhoods', item: `${BASE_URL}/neighborhoods` },
        { '@type': 'ListItem', position: 3, name: 'The Dominion', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+12103909997',
      description: 'Luxury real estate specialists serving The Dominion, Fair Oaks Ranch, Boerne, and the Texas Hill Country.',
      areaServed: { '@type': 'Place', name: 'The Dominion, San Antonio, TX' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQS.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
};

export default function TheDominionPage() {
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
              <Link href="/neighborhoods" className="hover:text-primary transition-colors">Neighborhoods</Link>
              <span>/</span>
              <span className="text-primary font-medium">The Dominion</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                Northwest San Antonio, TX
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                The Dominion —<br />
                San Antonio&apos;s Premier Gated Luxury Community
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Welcome to The Dominion — San Antonio&apos;s most prestigious guard-gated enclave. Custom estates from
                <strong className="text-white"> $800K to $5M+</strong>, private golf, and 24-hour security within
                20 minutes of downtown and the Medical Center.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?community=the-dominion">Browse Dominion Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact?area=TheDominion">Contact Sandra Whitfield</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Stats Bar */}
        <div className="bg-[#C9A84C] py-6">
          <Container>
            <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
              {STATS.map(({ icon: Icon, value, label }) => (
                <div key={label} className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-primary/60" />
                  <div>
                    <div className="font-heading text-heading font-bold text-primary">{value}</div>
                    <div className="text-caption text-primary/60">{label}</div>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </div>

        {/* Community Overview */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-[#C9A84C]">Community Overview</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  Life Inside The Dominion
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Spanning approximately 2,500 acres in northwest San Antonio, The Dominion stands as the city&apos;s
                    most recognized luxury address. Established in the 1980s and continuously refined since, it
                    offers a lifestyle that blends resort-class amenities with genuine security and seclusion — all
                    within a surprisingly convenient location near major employment corridors and top-tier schools.
                  </p>
                  <p>
                    The community is anchored by two championship golf courses and The Dominion Country Club,
                    which serves as the social heart of the neighborhood. Residents enjoy private dining, tennis,
                    fitness facilities, and a packed events calendar — from charity galas to holiday celebrations.
                    Guard-staffed entry points at every access road ensure that privacy is never compromised,
                    while broad, tree-lined streets and large estate lots create an atmosphere of unhurried elegance.
                  </p>
                  <p>
                    Architecturally, The Dominion spans multiple eras and styles — from Mediterranean and
                    Tuscan-inspired villas to sleek contemporary custom builds. Lot sizes vary from comfortable
                    half-acre homesites to expansive multi-acre estates. New construction opportunities remain
                    available on select custom lots, giving buyers the option to build exactly what they envision
                    in one of San Antonio&apos;s most coveted ZIP codes.
                  </p>
                </div>

                {/* Home Prices */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Home Prices in The Dominion
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {[
                      { tier: 'Entry-Level Villas', range: '$800K – $1.1M', desc: 'Smaller footprint homes and lock-and-leave villas with full community access' },
                      { tier: 'Custom Estate Homes', range: '$1.1M – $2.5M', desc: 'The most active market tier — 4–6 bed custom builds on generous lots' },
                      { tier: 'Ultra-Luxury Estates', range: '$2.5M – $5M+', desc: 'Sprawling custom estates, multiple acres, guest quarters, and resort pools' },
                    ].map(({ tier, range, desc }) => (
                      <div key={tier} className="rounded-xl border border-border bg-background-cream p-5">
                        <div className="font-heading text-body font-bold text-[#C9A84C] mb-1">{range}</div>
                        <div className="font-semibold text-primary text-body-sm mb-2">{tier}</div>
                        <p className="text-caption text-foreground-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-body-sm text-foreground-muted">
                    Custom estate lots are also available for purchase. Contact us for current lot availability and builder referrals.
                  </p>
                </div>

                {/* Amenities */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    What&apos;s Inside The Dominion
                  </h2>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    {AMENITIES.map(({ icon: Icon, title, desc }) => (
                      <div key={title} className="flex items-start gap-4 rounded-xl border border-border bg-white p-5 shadow-sm">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#C9A84C]/10">
                          <Icon className="h-5 w-5 text-[#C9A84C]" />
                        </div>
                        <div>
                          <h3 className="font-heading text-body font-semibold text-primary mb-1">{title}</h3>
                          <p className="text-body-sm text-foreground-muted">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Location */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Location &amp; Commute
                  </h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { icon: Car, dest: 'Medical Center', time: '~15 min' },
                      { icon: Car, dest: 'Downtown SA', time: '~20 min' },
                      { icon: Car, dest: 'UTSA', time: '~10 min' },
                      { icon: Car, dest: 'La Cantera', time: '~8 min' },
                    ].map(({ icon: Icon, dest, time }) => (
                      <div key={dest} className="rounded-lg border border-border bg-background-cream p-4 text-center">
                        <Icon className="mx-auto mb-2 h-5 w-5 text-[#C9A84C]" />
                        <div className="font-heading text-body font-bold text-primary">{time}</div>
                        <div className="text-caption text-foreground-muted">{dest}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Why Fair Oaks Realty */}
                <div className="mt-10 rounded-2xl border border-border bg-background-cream p-7">
                  <p className="overline mb-2 text-[#C9A84C]">Why Fair Oaks Realty Group</p>
                  <h3 className="mb-4 font-heading text-heading font-bold text-primary">
                    Your Dominion Real Estate Specialists
                  </h3>
                  <ul className="space-y-2 mb-6">
                    {WHY_FAIR_OAKS.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-body-sm text-foreground-muted">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A84C]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Button asChild>
                    <Link href="/contact?area=TheDominion">
                      Talk to Sandra Whitfield <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                {/* Nearby Communities */}
                <div className="mt-8">
                  <h3 className="mb-4 font-heading text-heading font-semibold text-primary">Explore Nearby Communities</h3>
                  <div className="space-y-3">
                    {NEARBY.map(({ name, href, desc }) => (
                      <Link
                        key={name}
                        href={href}
                        className="flex items-center justify-between rounded-xl border border-border bg-white p-4 hover:border-[#C9A84C] transition-colors group"
                      >
                        <div>
                          <span className="font-semibold text-primary group-hover:text-[#C9A84C] transition-colors">{name}</span>
                          <p className="text-caption text-foreground-muted">{desc}</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-[#C9A84C] shrink-0" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 space-y-5">
                  <div className="rounded-xl border border-border bg-white p-6 shadow-card">
                    <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                      Ready to buy in The Dominion?
                    </h3>
                    <p className="mb-5 text-body-sm text-foreground-muted">
                      Sandra Whitfield is our Broker/Owner and luxury specialist. She has years of experience
                      in The Dominion and knows the community inside out.
                    </p>
                    <Button size="lg" fullWidth asChild>
                      <Link href="/contact?area=TheDominion">Contact Sandra Whitfield</Link>
                    </Button>
                    <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                      <Link href="/listings?community=the-dominion">View Current Listings</Link>
                    </Button>
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="text-caption text-foreground-muted text-center mb-3">Or call us directly</p>
                      <a
                        href="tel:+12103909997"
                        className="flex items-center justify-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors"
                      >
                        <Phone className="h-4 w-4" /> (210) 390-9997
                      </a>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-background-cream p-6">
                    <p className="text-caption font-semibold uppercase tracking-wider text-[#C9A84C] mb-3">Also Explore</p>
                    <Link href="/luxury-homes" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors mb-2">
                      <ArrowRight className="h-3.5 w-3.5" /> All Luxury Communities
                    </Link>
                    <Link href="/neighborhoods" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors">
                      <ArrowRight className="h-3.5 w-3.5" /> Neighborhood Guide
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* FAQ */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3">Common Questions</p>
              <h2 className="font-heading text-display-sm font-bold text-primary">
                The Dominion FAQ
              </h2>
            </div>
            <div className="mx-auto max-w-3xl space-y-4">
              {FAQS.map(({ q, a }) => (
                <details
                  key={q}
                  className="group rounded-2xl border border-border bg-white shadow-sm overflow-hidden"
                >
                  <summary className="flex cursor-pointer items-start justify-between gap-4 px-6 py-5 font-heading text-heading-sm font-semibold text-primary list-none">
                    <span>{q}</span>
                    <span className="mt-0.5 shrink-0 text-[#C9A84C] group-open:rotate-45 transition-transform duration-200 text-xl leading-none">+</span>
                  </summary>
                  <div className="border-t border-border px-6 pb-6 pt-4">
                    <p className="text-body text-foreground-muted leading-relaxed">{a}</p>
                  </div>
                </details>
              ))}
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-[#C9A84C]">Let&apos;s Get Started</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Find Your Dominion Estate Today
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Whether you&apos;re buying, selling, or exploring a custom build in The Dominion, our luxury specialists
                are ready to guide you. Contact Sandra Whitfield for a private, no-pressure consultation.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=TheDominion">Contact Sandra Whitfield</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?community=the-dominion">
                    Browse Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
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
