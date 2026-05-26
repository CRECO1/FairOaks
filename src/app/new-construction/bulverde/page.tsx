export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, CheckCircle, ArrowRight, Phone,
  Home, School, Shield, Star, TrendingUp,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/new-construction/bulverde`;

export const metadata: Metadata = {
  title: 'New Construction Homes in Bulverde, TX | Fair Oaks Realty Group',
  description:
    'New construction homes in Bulverde TX — growing Hill Country community with Comal ISD schools, large lots, and new master-planned developments.',
  keywords: [
    'new construction bulverde tx',
    'new homes bulverde texas',
    'bulverde tx new builds',
    'johnson ranch bulverde homes',
    'new development bulverde comal isd',
    'builder homes bulverde tx',
    'move-in ready bulverde',
    'new homes near bulverde tx',
    'bulverde new construction 2025',
    'newly built homes bulverde',
  ],
  alternates: { canonical: '/new-construction/bulverde' },
  openGraph: {
    title: 'New Construction Homes in Bulverde, TX | Fair Oaks Realty Group',
    description:
      'New construction homes in Bulverde TX — growing Hill Country community with Comal ISD schools, large lots, and new master-planned developments.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'New Construction Homes in Bulverde, TX' }],
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
        { '@type': 'ListItem', position: 3, name: 'Bulverde', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      areaServed: { '@type': 'City', name: 'Bulverde', addressRegion: 'TX', addressCountry: 'US' },
    },
  ],
};

const DEVELOPMENTS = [
  {
    name: 'Johnson Ranch',
    priceRange: '$400K – $650K',
    highlights: ['Resort pool & splash pad', 'Sports courts & playgrounds', 'Easy US-281 North access', 'Comal ISD schools'],
    description:
      'Johnson Ranch is one of Bulverde&apos;s flagship master-planned communities, delivering resort-style amenities at prices that are hard to find closer to San Antonio. The community&apos;s amenity package — featuring pools, sports courts, and extensive green space — rivals developments at twice the cost. Comal ISD zoning and quick US-281 North access make it a consistently in-demand address.',
  },
  {
    name: 'Copper Canyon',
    priceRange: '$370K – $580K',
    highlights: ['Competitive entry pricing', 'Hill Country terrain', 'Established builder roster', 'Growing community infrastructure'],
    description:
      'Copper Canyon offers Bulverde new construction at some of the most competitive price points in the Hill Country market. With established national and regional builders active on-site and a community designed to take advantage of the natural Hill Country terrain, it represents strong value for buyers who want a new home without the premium attached to communities further south.',
  },
  {
    name: 'Ventana',
    priceRange: '$430K – $700K',
    highlights: ['Elevated homesites', 'Hill Country views', 'Multiple builder options', 'Comal ISD'],
    description:
      'Ventana is positioned on elevated Bulverde terrain, offering Hill Country views and a premium feel at mid-range pricing. The community has attracted multiple reputable builders, giving buyers a range of floor plans and finish levels. Its location — far enough from San Antonio to feel rural, close enough for a reasonable commute — is a key selling point.',
  },
];

const BUILDERS = [
  { name: 'Perry Homes', note: 'Texas-based, wide floor plan library and strong reputation' },
  { name: 'Pulte Homes', note: 'Consistent quality across all price points' },
  { name: 'Lennar', note: 'Everything&apos;s Included® model reduces design center complexity' },
];

const BENEFITS = [
  {
    icon: TrendingUp,
    title: 'One of Texas\'s Fastest-Growing Communities',
    desc: 'Bulverde has been among the fastest-growing communities in the greater San Antonio metro for years. Population growth drives infrastructure investment, retail expansion, and long-term home value appreciation — all benefits for new construction buyers.',
  },
  {
    icon: School,
    title: 'Comal ISD — Consistently Top-Rated',
    desc: 'Comal Independent School District is one of the most highly regarded school districts in central Texas. Families purchasing new construction in Bulverde benefit from newer school facilities, strong academic outcomes, and a growing district with expanding programs.',
  },
  {
    icon: MapPin,
    title: 'Hill Country Character at Accessible Prices',
    desc: 'Bulverde offers genuine Hill Country terrain — rolling topography, live oaks, open skies — at price points noticeably lower than communities like Boerne or Fair Oaks Ranch. For buyers who want the Hill Country experience without the full Hill Country premium, Bulverde is the market.',
  },
  {
    icon: Home,
    title: 'Easy San Antonio Access via US-281',
    desc: 'US-281 North provides a direct, relatively uncongested commute route into San Antonio&apos;s major employment centers. Residents enjoy the distance from the city without the frustrating commute that affects some other Hill Country markets.',
  },
];

export default function BulverdeNewConstructionPage() {
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
              <span className="text-primary font-medium">Bulverde</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                Comal County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                New Construction Homes in Bulverde, TX
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                One of the fastest-growing communities in the Texas Hill Country. Find new builds in
                Johnson Ranch, Copper Canyon, Ventana, and other master-planned developments.
                Comal ISD schools and easy US-281 access to San Antonio.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Bulverde">Browse Bulverde Listings</Link>
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
                { label: 'Price Range', value: '$370K – $700K+' },
                { label: 'School District', value: 'Comal ISD' },
                { label: 'To San Antonio', value: '35 min' },
                { label: 'Growth Rate', value: 'Top 5 in TX' },
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
              <p className="overline mb-3 text-[#C9A84C]">Why Bulverde</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Why Buy New Construction in Bulverde?
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
                Active Developments in Bulverde
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Bulverde&apos;s rapid growth has produced several significant master-planned communities,
                each with its own character and price point.
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
                Top Builders in Bulverde
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {BUILDERS.map(({ name, note }) => (
                <div key={name} className="rounded-xl border border-border bg-background-cream p-5">
                  <h3 className="font-heading text-body font-semibold text-primary mb-2">{name}</h3>
                  <p className="text-body-sm text-foreground-muted">{note}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Buyer Tips */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-[#C9A84C]">Your Best Advantage</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Buying New Construction in a Fast-Growing Market
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  Rapid growth markets like Bulverde create opportunity — but also risk. New communities
                  open constantly, builders introduce new phases, and infrastructure sometimes lags population
                  growth. An experienced buyer&apos;s agent helps you identify the communities with the best
                  long-term fundamentals and avoid the pitfalls common in fast-growth markets.
                </p>
                <ul className="space-y-3">
                  {[
                    'Evaluate community infrastructure maturity and future development plans',
                    'Compare amenity packages across communities — not all pools and trails are equal',
                    'Understand HOA fee structures and long-term assessment risk',
                    'Identify spec homes builders are motivated to move quickly',
                    'Negotiate rate buydowns and closing cost contributions',
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
                  Your Bulverde New Construction Experts
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  We have been active in the Bulverde market throughout its growth phase. We know which
                  communities have delivered on their promises and which have fallen short — and that
                  knowledge directly benefits you when you are choosing where to build.
                </p>
                <Button asChild>
                  <Link href="/contact">Connect With Our Team</Link>
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
                Ready to Find Your New Home in Bulverde?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse active Bulverde listings or connect with our Hill Country new construction team today.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Bulverde">
                    Browse Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Talk to a Builder Specialist</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
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
              <Link href="/homes-for-sale" className="hover:text-primary transition-colors">
                Bulverde Homes for Sale
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
