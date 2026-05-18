export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, CheckCircle, ArrowRight, Phone,
  Home, School, Shield, Star, DollarSign,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/new-construction/san-antonio`;

export const metadata: Metadata = {
  title: 'New Construction Homes in San Antonio, TX | Fair Oaks Realty Group',
  description:
    'Search new construction homes in San Antonio, TX. New builds across all price ranges — from affordable starter homes to luxury estates. Military-friendly builders, VA loan accepted, all school districts.',
  keywords: [
    'new construction san antonio tx',
    'new homes san antonio texas',
    'san antonio new builds 2025',
    'new construction near san antonio',
    'builder homes san antonio tx',
    'move-in ready san antonio',
    'new homes military san antonio',
    'VA loan new construction san antonio',
    'san antonio new development',
    'newly built homes san antonio',
  ],
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'New Construction Homes in San Antonio, TX | Fair Oaks Realty Group',
    description:
      'Search new construction homes in San Antonio, TX. New builds across all price ranges — from affordable starter homes to luxury estates. Military-friendly builders, VA loan accepted, all school districts.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'New Construction Homes in San Antonio, TX' }],
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
        { '@type': 'ListItem', position: 3, name: 'San Antonio', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      areaServed: { '@type': 'City', name: 'San Antonio', addressRegion: 'TX', addressCountry: 'US' },
    },
  ],
};

const AREAS = [
  {
    name: 'Northwest San Antonio / Far Northwest',
    priceRange: '$320K – $600K',
    highlights: ['Alamo Ranch, Kinder Ranch, Culebra corridor', 'Northside ISD zoning', 'Near Loop 1604 & US-151', 'Strong resale market'],
    description:
      'San Antonio&apos;s far northwest side along Loop 1604 is one of the most active new construction corridors in the city. Large master-planned communities like Alamo Ranch offer dozens of builder choices across a wide price range. Northside ISD schools, easy access to Medical Center employment, and UTSA make this corridor especially popular with families and professionals.',
  },
  {
    name: 'North San Antonio / Stone Oak Area',
    priceRange: '$380K – $750K',
    highlights: ['North East ISD / Judson ISD', 'Established infrastructure', 'Strong medical & tech employment nearby', 'Numerous school options'],
    description:
      'The Stone Oak and North San Antonio corridor blends established neighborhoods with newer construction phases. Buyers here benefit from proximity to the city&apos;s major employment base — hospitals, tech employers, and financial services firms — while still having access to newer construction at reasonable prices. Multiple school district options give families flexibility.',
  },
  {
    name: 'South / Southeast San Antonio',
    priceRange: '$280K – $480K',
    highlights: ['Most affordable new construction in SA metro', 'Military-friendly (JBSA proximity)', 'VA loan widely accepted', 'LGI Homes, D.R. Horton active'],
    description:
      'South and Southeast San Antonio offer some of the most affordable new construction in the entire metro area, starting as low as the high $200Ks. This corridor is especially popular with active-duty military and veterans given proximity to Joint Base San Antonio (JBSA), and builders here have streamlined VA loan processes. If maximum value per dollar is the priority, this is the market.',
  },
  {
    name: 'Northeast / Converse / Schertz Area',
    priceRange: '$290K – $520K',
    highlights: ['Growing northeast corridor', 'JBSA-Fort Sam proximity', 'Schertz-Cibolo ISD option', 'Rapid infrastructure expansion'],
    description:
      'The northeast growth corridor from Converse to Schertz has seen significant new construction activity. Builders here offer strong value at prices that are difficult to find closer to the city center. The area benefits from ongoing infrastructure investment and multiple school district options, making it a practical choice for buyers prioritizing budget without sacrificing quality.',
  },
];

const BUILDERS = [
  { name: 'D.R. Horton', note: 'Nation\'s largest builder — broad price range, fast builds' },
  { name: 'LGI Homes', note: 'Entry-level specialist, strong VA/FHA experience' },
  { name: 'KB Home', note: 'Build-to-order approach with customization options' },
  { name: 'Perry Homes', note: 'Texas-based, strong quality and design reputation' },
  { name: 'Meritage Homes', note: 'Energy-efficiency focus, mid-market positioning' },
];

const BENEFITS = [
  {
    icon: DollarSign,
    title: 'Widest Price Range in the Metro',
    desc: 'San Antonio offers new construction from the high $200Ks to $700K+ within city limits. Whether you\'re a first-time buyer using FHA, a veteran using VA, or a move-up buyer seeking luxury, there is a new build in this market priced for your budget.',
  },
  {
    icon: Shield,
    title: 'Military-Friendly & VA Loan Ready',
    desc: 'San Antonio is one of the most military-friendly real estate markets in the country. Multiple active-duty installations mean builders here have extensive experience with VA loans, including zero-down financing and reduced builder fees for veterans.',
  },
  {
    icon: School,
    title: 'Multiple School District Options',
    desc: 'Unlike Hill Country communities where one ISD dominates, San Antonio new construction communities span Northside ISD, North East ISD, Judson ISD, and others — allowing buyers to prioritize specific schools or districts.',
  },
  {
    icon: Star,
    title: 'Major Employment Base',
    desc: 'As one of the largest cities in Texas, San Antonio offers new construction buyers proximity to major healthcare systems, military installations, tech campuses, and financial services employers — reducing commute time compared to outlying Hill Country communities.',
  },
];

export default function SanAntonioNewConstructionPage() {
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
              <span className="text-primary font-medium">San Antonio</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                Bexar County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                New Construction Homes in San Antonio, TX
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Browse new builds across all price ranges — from affordable starter homes in the $280Ks to
                luxury estates over $700K. Military-friendly, VA loan accepted, all school districts. The
                largest new construction market in Texas Hill Country.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=San+Antonio">Browse San Antonio Listings</Link>
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
                { label: 'Starting Price', value: 'Mid $280Ks' },
                { label: 'School Districts', value: '5+' },
                { label: 'Active Builders', value: '20+' },
                { label: 'VA Loan Accepted', value: 'Yes' },
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
              <p className="overline mb-3 text-[#C9A84C]">Why San Antonio</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Why Buy New Construction in San Antonio?
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

        {/* Active Areas */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3">Where to Build</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                New Construction Areas in San Antonio
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                San Antonio&apos;s new construction market spans the entire metro. Here are the most
                active corridors and what makes each one distinctive.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {AREAS.map((area) => (
                <div key={area.name} className="rounded-2xl bg-white border border-border shadow-sm p-7 flex flex-col">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-heading text-body font-bold text-primary">{area.name}</h3>
                    <span className="shrink-0 font-heading text-body-sm font-semibold text-[#C9A84C]">{area.priceRange}</span>
                  </div>
                  <p className="mb-4 text-body-sm text-foreground-muted leading-relaxed flex-1">{area.description}</p>
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {area.highlights.map((h) => (
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
                Top Builders in San Antonio
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  Navigating San Antonio&apos;s Large New Construction Market
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  San Antonio has more active new construction communities than any other Texas Hill Country
                  market. That choice is an advantage — but it also means more complexity. An experienced
                  buyer&apos;s agent helps you cut through the noise, compare true total costs across builders,
                  and identify which communities have the strongest long-term fundamentals.
                </p>
                <ul className="space-y-3">
                  {[
                    'Compare true total costs — base price, lot premiums, upgrades, and HOA fees',
                    'Identify which builders have the strongest warranty track records in SA',
                    'Navigate VA loan processes with builders who have limited experience with veterans',
                    'Understand school district boundaries and how they affect resale value',
                    'Spot move-in ready spec homes that builders are motivated to discount',
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
                  Your San Antonio New Construction Specialists
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  Fair Oaks Realty Group serves buyers across the entire San Antonio metro, from affordable
                  south-side communities to luxury northwest neighborhoods. We know the market, the builders,
                  and how to negotiate effectively — at no cost to you.
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
                Ready to Find Your New Home in San Antonio?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse active listings or connect with our San Antonio new construction specialists today.
                No pressure, no obligation — just expert guidance to help you find the right home.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?city=San+Antonio">
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
                San Antonio Homes for Sale
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
