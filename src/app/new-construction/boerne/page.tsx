export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, CheckCircle, ArrowRight, Phone,
  Home, School, Shield, Star, Trees,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/new-construction/boerne`;

export const metadata: Metadata = {
  title: 'New Construction Homes in Boerne, TX | Fair Oaks Realty Group',
  description:
    'Browse new construction homes in Boerne, TX. Find new builds in Headwaters at Barton Creek, Esperanza, and other master-planned communities. Top-rated Boerne ISD schools.',
  keywords: [
    'new construction boerne tx',
    'new homes boerne texas',
    'boerne tx new builds',
    'headwaters boerne new homes',
    'new construction boerne isd',
    'esperanza boerne homes',
    'builder homes boerne tx',
    'move-in ready boerne tx',
    'new development boerne texas',
    'newly built homes boerne',
  ],
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'New Construction Homes in Boerne, TX | Fair Oaks Realty Group',
    description:
      'Browse new construction homes in Boerne, TX. Find new builds in Headwaters at Barton Creek, Esperanza, and other master-planned communities. Top-rated Boerne ISD schools.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'New Construction Homes in Boerne, TX' }],
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
        { '@type': 'ListItem', position: 3, name: 'Boerne', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      areaServed: { '@type': 'City', name: 'Boerne', addressRegion: 'TX', addressCountry: 'US' },
    },
  ],
};

const DEVELOPMENTS = [
  {
    name: 'Headwaters at Barton Creek',
    priceRange: '$500K – $900K',
    highlights: ['Preserved nature corridors', 'Premium finish levels', 'Multiple national builders', 'Award-winning design'],
    description:
      'Headwaters is one of the most talked-about master-planned communities in the greater Hill Country market. Built around preserved natural land and Barton Creek headwaters, it offers a living experience that balances luxury construction with genuine natural beauty. Multiple national builders are active here, allowing buyers to select from a range of floor plans at varying price points.',
  },
  {
    name: 'Esperanza',
    priceRange: '$380K – $650K',
    highlights: ['Resort-style amenities', 'Boerne ISD schools', 'Multiple builder options', 'Strong resale history'],
    description:
      'Esperanza is one of Boerne&apos;s largest and most active master-planned communities, offering a wide range of production builders and floor plans. The community&apos;s resort-style amenity center, strong Boerne ISD zoning, and established reputation for quality make it one of the safest new construction purchases in the market.',
  },
  {
    name: 'Boerne Heights',
    priceRange: '$420K – $700K',
    highlights: ['Elevated Hill Country terrain', 'Hill Country views', 'Quick I-10 access', 'Boerne ISD'],
    description:
      'Boerne Heights delivers elevated homesites with genuine Hill Country views and the walkability advantage of a Boerne address. With quick access to I-10, residents enjoy San Antonio commutes without the traffic of closer-in suburbs. Builders here tend to include elevated standard finishes that make for strong resale value.',
  },
  {
    name: 'Cibolo Canyons Area',
    priceRange: '$500K – $850K',
    highlights: ['JW Marriott resort proximity', 'Golf course community', 'Luxury-level finishes', 'Gated sections available'],
    description:
      'The Cibolo Canyons corridor, anchored by the JW Marriott San Antonio Hill Country Resort, encompasses several luxury-tier new construction communities. Buyers here tend to seek elevated finishes, larger lots, and proximity to resort-quality amenities — all within easy reach of San Antonio&apos;s north side employment corridors.',
  },
];

const BUILDERS = [
  { name: 'David Weekley Homes', note: 'Design flexibility and energy-efficient construction' },
  { name: 'Drees Custom Homes', note: 'Semi-custom approach with elevated standard finishes' },
  { name: 'Taylor Morrison', note: 'Wide floor plan library and strong community amenities' },
  { name: 'Pulte Homes', note: 'Consistent quality, strong warranty, broad price range' },
];

const BENEFITS = [
  {
    icon: School,
    title: 'Top-Rated Boerne ISD',
    desc: 'Boerne Independent School District is one of the highest-rated in the San Antonio metro area. Families consistently cite school quality as a primary reason for choosing Boerne over other Hill Country communities.',
  },
  {
    icon: Trees,
    title: 'Hill Country Natural Setting',
    desc: 'Boerne sits along Cibolo Creek with native Hill Country terrain, oak-studded hillsides, and the famous Cibolo Nature Center. New construction here doesn\'t mean sacrificing the natural character that drew you to Texas Hill Country in the first place.',
  },
  {
    icon: Home,
    title: 'Historic Downtown Appeal',
    desc: 'Unlike most master-planned suburbs, Boerne has a genuinely vibrant historic Main Street with locally owned restaurants, boutiques, and wine bars within minutes of new construction neighborhoods — a rare combination.',
  },
  {
    icon: Star,
    title: 'Strong Long-Term Appreciation',
    desc: 'Boerne\'s combination of school quality, limited geography, and ongoing population growth from San Antonio has driven consistent home value appreciation. New construction here tends to hold its value well at resale.',
  },
];

export default function BoerneNewConstructionPage() {
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
              <span className="text-primary font-medium">Boerne</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                Kendall County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                New Construction Homes in Boerne, TX
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Find new builds in Headwaters at Barton Creek, Esperanza, and other master-planned communities
                across one of Texas Hill Country&apos;s most beloved towns. Top-rated Boerne ISD, Hill Country
                lifestyle, and easy San Antonio access.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Boerne">Browse Boerne Listings</Link>
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
                { label: 'Price Range', value: '$380K – $900K+' },
                { label: 'School District', value: 'Boerne ISD' },
                { label: 'To San Antonio', value: '30 min' },
                { label: 'Active Communities', value: '4+' },
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
              <p className="overline mb-3 text-[#C9A84C]">Why Boerne</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Why Buy New Construction in Boerne?
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
                Active Developments in Boerne
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Boerne&apos;s new construction market spans several distinct communities, from
                large-scale master-planned developments to boutique luxury enclaves.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {DEVELOPMENTS.map((dev) => (
                <div key={dev.name} className="rounded-2xl bg-white border border-border shadow-sm p-7 flex flex-col">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-heading text-body font-bold text-primary">{dev.name}</h3>
                    <span className="shrink-0 font-heading text-body-sm font-semibold text-[#C9A84C]">{dev.priceRange}</span>
                  </div>
                  <p className="mb-4 text-body-sm text-foreground-muted leading-relaxed flex-1">{dev.description}</p>
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
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
                Top Builders in Boerne
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
                  Boerne&apos;s builder sales offices are staffed by the builder&apos;s own agents. They are excellent at
                  their jobs — which is to sell homes for the builder&apos;s benefit. Having your own buyer&apos;s agent
                  costs you nothing and ensures someone is looking out for your interests, not the builder&apos;s.
                </p>
                <ul className="space-y-3">
                  {[
                    'Contract review before you sign — builder contracts favor builders',
                    'Negotiate incentives: closing costs, upgrades, rate buydowns',
                    'Third-party pre-drywall and pre-close inspections',
                    'Design center guidance: what adds value vs. what doesn\'t',
                    'Ongoing support from signing through your warranty period',
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
                  Your Local Boerne New Construction Experts
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  Our agents have toured every active new construction community in Boerne, spoken with
                  homeowners in completed phases, and tracked builder quality and warranty responsiveness
                  across years of local market activity. That knowledge is yours — at no cost.
                </p>
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
                Ready to Find Your New Home in Boerne?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse active Boerne listings or connect with our new construction specialists. We know
                every community, every builder, and how to get you the best deal.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Boerne">
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
              <Link href="/homes-for-sale/boerne-tx" className="hover:text-primary transition-colors">
                Boerne Homes for Sale
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
