export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, CheckCircle, ArrowRight, Phone,
  Home, School, Shield, Star, Hammer, DollarSign,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/new-construction/fair-oaks-ranch`;

export const metadata: Metadata = {
  title: 'New Construction Homes in Fair Oaks Ranch, TX | Fair Oaks Realty Group',
  description:
    'New construction homes in Fair Oaks Ranch TX — master-planned communities with gated entries, resort amenities, and Hill Country views. Move-in ready homes available.',
  keywords: [
    'new construction fair oaks ranch tx',
    'new homes fair oaks ranch',
    'new builds fair oaks ranch',
    'newly built homes fair oaks ranch',
    'fair oaks ranch new development',
    'new homes boerne isd',
    'builder homes fair oaks ranch',
    'move-in ready fair oaks ranch',
    'custom homes fair oaks ranch tx',
    'new construction hill country',
  ],
  alternates: { canonical: '/new-construction/fair-oaks-ranch' },
  openGraph: {
    title: 'New Construction Homes in Fair Oaks Ranch, TX | Fair Oaks Realty Group',
    description:
      'New construction homes in Fair Oaks Ranch TX — master-planned communities with gated entries, resort amenities, and Hill Country views. Move-in ready homes available.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'New Construction Homes in Fair Oaks Ranch, TX' }],
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'New Construction', item: `${BASE_URL}/new-construction` },
        { '@type': 'ListItem', position: 3, name: 'Fair Oaks Ranch', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      areaServed: { '@type': 'City', name: 'Fair Oaks Ranch', addressRegion: 'TX', addressCountry: 'US' },
    },
  ],
};

const DEVELOPMENTS = [
  {
    name: 'Fair Oaks Ranch Community Phases',
    priceRange: '$500K – $900K',
    highlights: ['Gated and non-gated sections', 'Mature Hill Country terrain', 'Multiple active phases', 'Large estate-style lots'],
    description:
      'The city of Fair Oaks Ranch itself encompasses several distinct residential phases, ranging from established neighborhoods with mature live oaks to newer phases with custom and semi-custom construction. Buyers who want more square footage and land for the dollar compared to Boerne or The Dominion will find Fair Oaks Ranch phases compelling.',
  },
  {
    name: 'Kinder Ranch Area',
    priceRange: '$400K – $650K',
    highlights: ['Established tree canopy', 'Northside ISD option', 'Near Loop 1604', 'Active HOA amenities'],
    description:
      'Bordering Fair Oaks Ranch to the south, the Kinder Ranch corridor offers newer builds with the feel of an established neighborhood. The combination of Hill Country topography, mature oaks, and proximity to Loop 1604 makes it a perennial favorite for buyers relocating from the medical center or UTSA corridor.',
  },
  {
    name: 'Gated Custom Lot Communities',
    priceRange: '$600K – $1.2M+',
    highlights: ['Custom builder flexibility', 'Privacy-gated entries', 'Larger acreage lots', 'Premium Hill Country views'],
    description:
      'Fair Oaks Ranch hosts several smaller gated enclaves where buyers can purchase a lot and work with an approved custom builder to create a truly personalized home. These communities attract buyers who want something beyond a production floor plan and are willing to invest the time in a custom build process.',
  },
];

const BUILDERS = [
  { name: 'Highland Homes', note: 'Excellent production value, strong warranty program' },
  { name: 'Perry Homes', note: 'Wide floor plan selection, competitive pricing' },
  { name: 'David Weekley Homes', note: 'Design flexibility, energy-efficient builds' },
  { name: 'Chesmar Homes', note: 'Boutique builder with elevated standard finishes' },
];

const BENEFITS = [
  {
    icon: School,
    title: 'Boerne ISD Schools',
    desc: 'Fair Oaks Ranch feeds primarily into Boerne ISD, one of the top-rated school districts in the greater San Antonio area. Strong academics, excellent extracurriculars, and a tight-knit community culture.',
  },
  {
    icon: MapPin,
    title: '20 Minutes from San Antonio',
    desc: 'With quick access to US-281 and Loop 1604, Fair Oaks Ranch residents enjoy a genuine Hill Country setting without sacrificing commute time to the city\'s major employment and medical corridors.',
  },
  {
    icon: Home,
    title: 'Larger Lots & More Land',
    desc: 'Compared to infill suburban communities closer to Loop 1604, Fair Oaks Ranch offers meaningfully larger lot sizes — giving you room for a pool, gardens, and the space that Hill Country living demands.',
  },
  {
    icon: Star,
    title: 'Established Community Character',
    desc: 'Unlike many brand-new master-planned communities, Fair Oaks Ranch benefits from decades of tree canopy growth, established trails, parks, and the civic identity of an incorporated city.',
  },
];

export default function FairOaksRanchNewConstructionPage() {
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
              <Link href="/new-construction" className="hover:text-primary transition-colors">New Construction</Link>
              <span>/</span>
              <span className="text-primary font-medium">Fair Oaks Ranch</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">
                <MapPin className="mr-1 inline h-3 w-3" />
                Bexar County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                New Construction Homes in Fair Oaks Ranch, TX
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Discover new builds in one of Texas Hill Country&apos;s most desirable incorporated cities.
                Master-planned communities, gated neighborhoods, and custom lot opportunities — all served
                by top-rated Boerne ISD and just 20 minutes from San Antonio.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Fair+Oaks+Ranch">Browse Fair Oaks Ranch Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Talk to a Builder Specialist</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Stats Bar */}
        <div className="bg-[#C9A84C] py-6">
          <Container>
            <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
              {[
                { label: 'Price Range', value: '$450K – $900K+' },
                { label: 'School District', value: 'Boerne ISD' },
                { label: 'To San Antonio', value: '20 min' },
                { label: 'Avg. Lot Size', value: '0.3 – 1+ acres' },
              ].map(({ label, value }) => (
                <div key={label} className="text-center sm:text-left">
                  <div className="font-heading text-heading font-bold text-primary">{value}</div>
                  <div className="text-caption text-primary/60">{label}</div>
                </div>
              ))}
            </div>
          </Container>
        </div>

        {/* Why Buy New Construction Here */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Why Fair Oaks Ranch</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Why Buy New Construction in Fair Oaks Ranch?
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {BENEFITS.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-4 rounded-xl border border-border bg-background-cream p-6">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#C9A84C]/10">
                    <Icon className="h-5 w-5 text-[#C9A84C]" />
                  </div>
                  <div>
                    <h3 className="mb-1 font-heading text-body font-semibold text-primary">{title}</h3>
                    <p className="text-body-sm text-foreground-muted leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Active Developments */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3">Where to Build</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Active Developments &amp; Communities
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Fair Oaks Ranch offers a range of new construction settings — from production builder phases
                to custom gated enclaves on large acreage lots.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {DEVELOPMENTS.map((dev) => (
                <div key={dev.name} className="rounded-2xl bg-white border border-border shadow-sm p-7 flex flex-col">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-heading text-body font-bold text-primary">{dev.name}</h3>
                    <span className="shrink-0 font-heading text-body-sm font-semibold text-[#C9A84C]">{dev.priceRange}</span>
                  </div>
                  <p className="mb-4 text-body-sm text-foreground-muted leading-relaxed flex-1">{dev.description}</p>
                  <ul className="space-y-1.5">
                    {dev.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-body-sm text-foreground-muted">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A84C]" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Top Builders */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Who&apos;s Building</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Top Builders in Fair Oaks Ranch
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {BUILDERS.map(({ name, note }) => (
                <div key={name} className="rounded-xl border border-border bg-background-cream p-5">
                  <h3 className="font-heading text-body font-semibold text-primary mb-2">{name}</h3>
                  <p className="text-body-sm text-foreground-muted">{note}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Buyer Tips / Agent Value Prop */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-[#C9A84C]">Your Best Advantage</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Why You Need Your Own Agent for New Construction
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  Builder sales offices employ agents who work exclusively for the builder. Their job is to
                  close the sale on the best terms for their employer. Having your own buyer&apos;s agent costs
                  you nothing — the builder pays the commission — but gives you a fiduciary who works only for you.
                </p>
                <ul className="space-y-3">
                  {[
                    'Review and negotiate builder contracts before you sign',
                    'Push for closing cost contributions, upgrade allowances, and rate buydowns',
                    'Coordinate independent third-party phase inspections',
                    'Help you avoid over-upgrading in the design center',
                    'Stay in your corner from contract signing to closing day',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-body-sm text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A84C]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl bg-primary p-8 text-white">
                <Shield className="mb-4 h-8 w-8 text-[#C9A84C]" />
                <h3 className="mb-3 font-heading text-heading-xl font-bold text-white">
                  Fair Oaks Realty Group — Your Local Experts
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  We are based in Fair Oaks Ranch. We know every builder, every community phase, and every
                  subdivision in this market. When you work with us on your new construction purchase, you
                  get local expertise that no out-of-town agent can match.
                </p>
                <div className="space-y-3 mb-6">
                  {[
                    'No cost to you — builder pays our commission',
                    'Local agents who live and work here',
                    'Deep builder relationships built over years',
                    'Honest guidance on which phases and plans hold value',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-2 text-body-sm text-white/70">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A84C]" />
                      {item}
                    </div>
                  ))}
                </div>
                <Button asChild>
                  <Link href="/contact">Get Builder Representation</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-[#C9A84C]">Start Your Search</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Ready to Find Your New Home in Fair Oaks Ranch?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse active listings or connect with our Fair Oaks Ranch new construction specialists today.
                We will help you navigate builders, incentives, and contracts — at no cost to you.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Fair+Oaks+Ranch">
                    Browse Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Talk to a Builder Specialist</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />210-390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Footer nav */}
        <div className="py-6 bg-background-cream border-t border-border">
          <Container>
            <div className="flex flex-wrap items-center gap-4 text-body-sm text-foreground-muted">
              <Link href="/new-construction" className="inline-flex items-center gap-1 hover:text-primary transition-colors">
                <ArrowRight className="h-4 w-4 rotate-180" /> All New Construction
              </Link>
              <span>·</span>
              <Link href="/homes-for-sale/boerne-tx" className="hover:text-primary transition-colors">
                Fair Oaks Ranch Homes for Sale
              </Link>
              <span>·</span>
              <Link href="/contact" className="hover:text-primary transition-colors">Contact Us</Link>
            </div>
          </Container>
        </div>

      </main>
      <Footer />
    </>
  );
}
