export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, CheckCircle, ArrowRight, Phone,
  Home, School, Shield, Star, Mountain,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/new-construction/helotes`;

export const metadata: Metadata = {
  title: 'New Construction Homes in Helotes, TX | Fair Oaks Realty Group',
  description:
    'New construction homes in Helotes TX — brand-new builds on large lots with Hill Country character. Easy access to San Antonio and Loop 1604.',
  keywords: [
    'new construction helotes tx',
    'new homes helotes texas',
    'helotes tx new builds',
    'miralomas helotes new homes',
    'helotes new construction northside isd',
    'builder homes helotes tx',
    'new development helotes',
    'move-in ready helotes',
    'new homes near helotes tx',
    'newly built homes helotes',
  ],
  alternates: { canonical: '/new-construction/helotes' },
  openGraph: {
    title: 'New Construction Homes in Helotes, TX | Fair Oaks Realty Group',
    description:
      'New construction homes in Helotes TX — brand-new builds on large lots with Hill Country character. Easy access to San Antonio and Loop 1604.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'New Construction Homes in Helotes, TX' }],
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
        { '@type': 'ListItem', position: 3, name: 'Helotes', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      areaServed: { '@type': 'City', name: 'Helotes', addressRegion: 'TX', addressCountry: 'US' },
    },
  ],
};

const DEVELOPMENTS = [
  {
    name: 'Miralomas',
    priceRange: '$550K – $950K',
    highlights: ['Panoramic San Antonio skyline views', 'Luxury-level standard finishes', 'Hillside elevated homesites', 'Northside ISD'],
    description:
      'Miralomas is Helotes&apos;s signature luxury new construction community, built into the dramatic limestone hillsides above the city. Every homesite is positioned to capture sweeping views of the San Antonio skyline and surrounding Hill Country. Builders here spec homes with stone exteriors, vaulted ceilings, and kitchen packages that are upgrade-level at other communities.',
  },
  {
    name: 'Six Creeks',
    priceRange: '$420K – $700K',
    highlights: ['Nature-integrated design', 'Larger lot sizes', 'Trail access', 'Strong Northside ISD schools'],
    description:
      'Six Creeks offers a nature-focused new construction experience in the Helotes area, with homesites that back to natural areas and a community design that preserves the Hill Country character. Lot sizes here are more generous than standard suburban communities, giving residents the outdoor space that the Hill Country lifestyle demands.',
  },
  {
    name: 'Cross Mountain Area',
    priceRange: '$450K – $800K',
    highlights: ['Gated community entry', 'Hill Country topography', 'Larger lots', 'Privacy and security'],
    description:
      'The Cross Mountain area in the Helotes/Northwest San Antonio corridor delivers gated Hill Country living with lot sizes meaningfully larger than most master-planned communities at comparable price points. The elevated terrain offers dramatic views, and the gated entry gives residents a sense of privacy that open communities cannot match.',
  },
];

const BUILDERS = [
  { name: 'Toll Brothers', note: 'Luxury tier with elevated standard specifications' },
  { name: 'K. Hovnanian', note: 'Strong value at mid-luxury price points' },
  { name: 'Meritage Homes', note: 'Energy-efficient construction and consistent quality' },
];

const BENEFITS = [
  {
    icon: Mountain,
    title: 'Panoramic Hill Country Views',
    desc: 'Helotes sits on elevated limestone terrain with genuine panoramic views — of both the San Antonio skyline to the east and Hill Country wilderness to the west. New construction communities here are designed to capture and preserve those views.',
  },
  {
    icon: School,
    title: 'Northside ISD Schools',
    desc: 'Northside ISD is the largest school district in San Antonio and consistently ranked among the top performers in the metro area. Helotes residents benefit from newer, well-funded schools serving a growing population of families.',
  },
  {
    icon: Home,
    title: 'Small-Town Feel, City Access',
    desc: 'Helotes maintains a genuine small-town character — an old downtown strip, local events, and tight community bonds — while sitting just minutes from Loop 1604 and the full amenities of San Antonio.',
  },
  {
    icon: Star,
    title: 'Larger Lots Than Most SA Suburbs',
    desc: 'New construction in Helotes typically offers more lot space than communities closer to Loop 1604. If you want room for a pool, a garden, or simply the privacy that larger lots provide, Helotes delivers more for your dollar.',
  },
];

export default function HelotesNewConstructionPage() {
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
              <span className="text-primary font-medium">Helotes</span>
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
                New Construction Homes in Helotes, TX
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Explore new builds in Miralomas and other Hill Country communities perched above San Antonio.
                Northside ISD schools, large lots, panoramic views, and small-town charm just minutes from
                Loop 1604 and the city.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Helotes">Browse Helotes Listings</Link>
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
                { label: 'Price Range', value: '$420K – $950K+' },
                { label: 'School District', value: 'Northside ISD' },
                { label: 'To Loop 1604', value: '10 min' },
                { label: 'To Downtown SA', value: '25 min' },
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
              <p className="overline mb-3 text-[#C9A84C]">Why Helotes</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Why Buy New Construction in Helotes?
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
                Active Developments in Helotes
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Helotes new construction tends toward the premium end of the Hill Country market,
                with communities that emphasize views, lot size, and elevated finish standards.
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
                Top Builders in Helotes
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
                  Buying New Construction in Helotes: What to Know
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  Helotes new construction skews toward the premium end of the market. Builders here tend
                  to be more selective about upgrade packages and lot premiums. Having an experienced buyer&apos;s
                  agent who knows each builder&apos;s negotiating style and what incentives are actually available
                  can make a meaningful difference in what you pay and what you get.
                </p>
                <ul className="space-y-3">
                  {[
                    'Lot premiums for view lots can be significant — we help you evaluate whether they\'re worth it',
                    'Luxury-tier builders often negotiate on incentives rather than base price',
                    'Pre-drywall inspections are critical — even premium builders have punch list items',
                    'View corridors can be impacted by future phases — we help you understand plat maps',
                    'HOA covenants in Helotes communities tend to be more restrictive — we review them',
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
                  Local Expertise, No Extra Cost
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  Our agents have toured Miralomas, Six Creeks, Cross Mountain, and every other active
                  community in the Helotes market. We know which lots have the best long-term view protection,
                  which builders respond well to negotiation, and how to structure your offer to maximize value.
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
                Ready to Find Your New Home in Helotes?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse active listings or connect with our Helotes new construction specialists today.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Helotes">
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
                Helotes Homes for Sale
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
