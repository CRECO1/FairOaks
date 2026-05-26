export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, CheckCircle, ArrowRight, Phone,
  Home, School, Shield, Star, Waves,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/new-construction/new-braunfels`;

export const metadata: Metadata = {
  title: 'New Construction Homes in New Braunfels, TX | Fair Oaks Realty Group',
  description:
    'Browse new construction in New Braunfels TX — rapidly growing Hill Country city with Comal ISD schools and easy access to Austin and San Antonio.',
  keywords: [
    'new construction new braunfels tx',
    'new homes new braunfels texas',
    'veramendi new braunfels homes',
    'vintage oaks new braunfels',
    'new development new braunfels tx',
    'comal isd new construction',
    'builder homes new braunfels',
    'move-in ready new braunfels',
    'new homes near new braunfels',
    'newly built homes new braunfels',
  ],
  alternates: { canonical: '/new-construction/new-braunfels' },
  openGraph: {
    title: 'New Construction Homes in New Braunfels, TX | Fair Oaks Realty Group',
    description:
      'Browse new construction in New Braunfels TX — rapidly growing Hill Country city with Comal ISD schools and easy access to Austin and San Antonio.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'New Construction Homes in New Braunfels, TX' }],
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
        { '@type': 'ListItem', position: 3, name: 'New Braunfels', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      areaServed: { '@type': 'City', name: 'New Braunfels', addressRegion: 'TX', addressCountry: 'US' },
    },
  ],
};

const DEVELOPMENTS = [
  {
    name: 'Veramendi',
    priceRange: '$350K – $700K',
    acres: '6,000 acres',
    highlights: ['6,000-acre master-planned community', 'Multiple national builders on-site', 'Resort-style amenity center', 'Comal ISD zoning'],
    description:
      'Veramendi is one of the most ambitious master-planned communities in Texas, spread across 6,000 acres with a long-term vision for thousands of homes. Multiple national and regional builders are active across several phases, offering buyers an extraordinary range of floor plans and price points. The community features resort-style amenities, hike-and-bike trails, and a vibrant future commercial district.',
  },
  {
    name: 'Vintage Oaks',
    priceRange: '$500K – $1M+',
    acres: '3,900 acres',
    highlights: ['Estate lots 1–14 acres', 'Custom and semi-custom builds', 'Full resort clubhouse', 'Canyon Lake proximity'],
    description:
      'Vintage Oaks spans nearly 3,900 acres of pristine Hill Country terrain between New Braunfels and Wimberley. The community specializes in larger homesites where buyers can choose from curated semi-custom builders or bring their own custom builder. A full resort amenity center, multiple pool areas, and a sports complex give it an estate lifestyle at surprisingly attainable pricing.',
  },
  {
    name: 'Solms Landing',
    priceRange: '$320K – $520K',
    highlights: ['Entry-to-mid price point', 'Established neighborhood character', 'Quick IH-35 access', 'Comal ISD'],
    description:
      'Solms Landing offers new construction at some of the most accessible price points in the New Braunfels market without sacrificing location quality. With quick access to IH-35 and proximity to New Braunfels&apos;s established commercial corridors, it appeals to buyers who want a brand-new home in a genuine city — not a distant rural development.',
  },
  {
    name: 'Gruene Area / Custom Lots',
    priceRange: '$450K – $900K',
    highlights: ['Historic Gruene proximity', 'Comal River access', 'Custom build opportunities', 'Premium Hill Country character'],
    description:
      'The area around historic Gruene — New Braunfels&apos;s beloved 19th-century district — offers custom and semi-custom new construction opportunities on premium lots. Buyers here are drawn by proximity to the Comal River, the Guadalupe River tubing corridor, and the authentic Hill Country character of Gruene&apos;s shops and music venues.',
  },
];

const BUILDERS = [
  { name: 'Scott Felder Homes', note: 'Texas regional builder with strong Hill Country presence' },
  { name: 'David Weekley Homes', note: 'Design flexibility and energy-efficient builds' },
  { name: 'Drees Custom Homes', note: 'Semi-custom approach with elevated standard finishes' },
  { name: 'Century Communities', note: 'Value-focused production builder with quick delivery' },
];

const BENEFITS = [
  {
    icon: Waves,
    title: 'Guadalupe River Access',
    desc: 'New Braunfels sits at the confluence of the Guadalupe and Comal rivers. Tubing, kayaking, fishing, and swimming are available to residents year-round. For buyers who want a lifestyle centered on water recreation, New Braunfels is unmatched in the Texas Hill Country.',
  },
  {
    icon: School,
    title: 'Top-Rated Comal ISD',
    desc: 'Comal Independent School District is one of the highest-rated and fastest-growing school districts in Texas. New construction buyers in New Braunfels benefit from newer, well-funded school facilities and consistently strong academic outcomes.',
  },
  {
    icon: MapPin,
    title: 'Between San Antonio and Austin',
    desc: 'New Braunfels sits directly between San Antonio and Austin on IH-35, making it the ideal location for dual-city commuters or buyers who want access to both metro areas without living in either. Commute times to both cities are comparable.',
  },
  {
    icon: Star,
    title: 'Hill Country Charm & Growing Amenities',
    desc: 'New Braunfels has the feel of a genuine Hill Country town — Gruene Hall, the Schlitterbahn waterpark, a vibrant downtown, and a strong German heritage — paired with the infrastructure and commercial development of one of Texas&apos;s fastest-growing cities.',
  },
];

export default function NewBraunfelsNewConstructionPage() {
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
              <span className="text-primary font-medium">New Braunfels</span>
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
                New Construction Homes in New Braunfels, TX
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Find new homes in Veramendi, Vintage Oaks, Solms Landing, and other fast-growing communities
                across one of Texas&apos;s most beloved Hill Country cities. Comal ISD schools, Guadalupe River
                access, and a prime location between San Antonio and Austin.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=New+Braunfels">Browse New Braunfels Listings</Link>
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
                { label: 'Price Range', value: '$320K – $1M+' },
                { label: 'School District', value: 'Comal ISD' },
                { label: 'To San Antonio', value: '35 min' },
                { label: 'To Austin', value: '45 min' },
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
              <p className="overline mb-3 text-[#C9A84C]">Why New Braunfels</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Why Buy New Construction in New Braunfels?
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
                Active Developments in New Braunfels
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                New Braunfels offers some of the most diverse new construction options in the Hill Country —
                from large-scale master-planned communities to estate-sized custom lots.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {DEVELOPMENTS.map((dev) => (
                <div key={dev.name} className="rounded-2xl bg-white border border-border shadow-sm p-7 flex flex-col">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="font-heading text-body font-bold text-primary">{dev.name}</h3>
                      {'acres' in dev && (
                        <p className="text-caption text-foreground-muted mt-0.5">{dev.acres}</p>
                      )}
                    </div>
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
                Top Builders in New Braunfels
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

        {/* Buyer Tips */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-[#C9A84C]">Your Best Advantage</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Navigating New Braunfels&apos;s Diverse New Construction Market
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  With communities ranging from a 6,000-acre master plan to boutique custom lots near Gruene,
                  New Braunfels requires a knowledgeable guide. We help you evaluate which communities have
                  the infrastructure, school district assignments, and long-term trajectory that match your priorities.
                </p>
                <ul className="space-y-3">
                  {[
                    'Veramendi phase selection — early phases vs. newer phases have different trade-offs',
                    'Vintage Oaks lot evaluation — view corridors, terrain, and access all matter',
                    'Understand IH-35 growth patterns and how they affect specific community values',
                    'Builder selection in a multi-builder community like Veramendi',
                    'Negotiate closing cost contributions, lot premiums, and design center allowances',
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
                  Your New Braunfels New Construction Specialists
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  We have toured every active development in New Braunfels and know the Hill Country market
                  between San Antonio and Austin as well as anyone. Let us put that knowledge to work for you
                  — at no cost to you as a buyer.
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
                Ready to Find Your New Home in New Braunfels?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse active listings or connect with our New Braunfels new construction specialists today.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?city=New+Braunfels">
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
                New Braunfels Homes for Sale
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
