export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  Shield, Star, Trees, CheckCircle, ArrowRight, Phone, Car,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/neighborhoods/stone-creek-ranch`;

export const metadata: Metadata = {
  title: 'Stone Creek Ranch Homes for Sale | Fair Oaks Ranch TX | Fair Oaks Realty Group',
  description:
    'Homes for sale in Stone Creek Ranch, Fair Oaks Ranch TX. Gated master-planned community with resort-style amenities, large homesites 0.25–1+ acres, Hill Country views, and top-rated Boerne ISD schools. $550K–$1.2M.',
  alternates: { canonical: '/neighborhoods/stone-creek-ranch' },
  openGraph: {
    title: 'Stone Creek Ranch Homes for Sale | Fair Oaks Ranch TX',
    description:
      'Browse homes for sale in Stone Creek Ranch, a premier gated community in Fair Oaks Ranch TX. Resort amenities, mature oaks, Hill Country views, Boerne ISD. Homes from $550K–$1.2M.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Stone Creek Ranch Homes — Fair Oaks Ranch TX' }],
  },
  twitter: { card: 'summary_large_image' },
  keywords: [
    'Stone Creek Ranch homes for sale',
    'Stone Creek Ranch Fair Oaks Ranch TX',
    'Stone Creek Ranch real estate',
    'gated community Fair Oaks Ranch',
    'Stone Creek Ranch Boerne ISD',
    'Fair Oaks Ranch Hill Country homes',
    'Stone Creek Ranch subdivision',
    'Fair Oaks Ranch gated homes for sale',
  ],
};

const STATS = [
  { icon: DollarSign, value: '$550K – $1.2M', label: 'Price Range' },
  { icon: Home, value: '0.25 – 1+ acres', label: 'Lot Sizes' },
  { icon: School, value: 'Boerne ISD', label: 'School District' },
  { icon: Clock, value: '~30 min', label: 'To Downtown SA' },
];

const FEATURES = [
  { icon: Shield, title: 'Gated Entry', desc: 'Controlled-access gated entry provides an additional layer of privacy and security for residents and their families.' },
  { icon: Star, title: 'Resort-Style Pool & Tennis', desc: 'Community amenities include a resort-style swimming pool, tennis courts, and a well-maintained playground — all managed by an active HOA.' },
  { icon: Trees, title: 'Mature Oaks & Hill Country Views', desc: 'Large live oaks canopy many homesites and Hill Country panoramas are visible from elevated lots throughout the community.' },
  { icon: School, title: 'Boerne ISD Schools', desc: 'Zoned to Curington Elementary, Boerne Middle School, and Boerne High School — consistently among the highest-rated campuses in the region.' },
];

const SCHOOLS = [
  { level: 'Elementary', name: 'Curington Elementary', rating: 'A-Rated' },
  { level: 'Middle School', name: 'Boerne Middle School', rating: 'A-Rated' },
  { level: 'High School', name: 'Boerne High School', rating: 'A-Rated' },
];

const NEARBY = [
  { name: 'Fair Oaks Ranch Homes', href: '/homes-for-sale/fair-oaks-ranch-tx', desc: 'Browse all homes for sale in Fair Oaks Ranch, TX' },
  { name: 'Sonoma Verde', href: '/neighborhoods/sonoma-verde', desc: 'Rolling terrain, community pool, and gated entry in Fair Oaks Ranch' },
  { name: 'The Preserve at Fair Oaks', href: '/neighborhoods/the-preserve-fair-oaks', desc: 'Larger homesites and custom builds in Fair Oaks Ranch' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Neighborhoods', item: `${BASE_URL}/neighborhoods` },
        { '@type': 'ListItem', position: 3, name: 'Stone Creek Ranch', item: CANONICAL },
      ],
    },
    {
      '@type': 'Place',
      name: 'Stone Creek Ranch',
      description: 'Gated master-planned community in Fair Oaks Ranch, TX with resort-style amenities, large homesites, and Boerne ISD schools.',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Fair Oaks Ranch',
        addressRegion: 'TX',
        addressCountry: 'US',
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: 29.745,
        longitude: -98.634,
      },
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+12103909997',
      areaServed: { '@type': 'Place', name: 'Stone Creek Ranch, Fair Oaks Ranch, TX' },
    },
  ],
};

export default function StoneCreekRanchPage() {
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
              <span className="text-primary font-medium">Stone Creek Ranch</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                Fair Oaks Ranch, TX — Boerne ISD
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Stone Creek Ranch Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Stone Creek Ranch is one of Fair Oaks Ranch&apos;s most desirable gated subdivisions — a master-planned
                community with resort-style amenities, mature Hill Country oaks, and large homesites up to an acre and
                beyond. Homes range from <strong className="text-white">$550K to $1.2M</strong>, with Boerne ISD schools
                and an easy 30-minute commute to San Antonio via I-10.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?community=stone-creek-ranch">Browse Stone Creek Ranch Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
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

        {/* Main Content */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-[#C9A84C]">Community Overview</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  Living in Stone Creek Ranch
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Tucked within the rolling terrain of Fair Oaks Ranch, Stone Creek Ranch stands out as one of the
                    area&apos;s premier gated subdivisions. Built primarily between the early 2000s and 2015, the
                    community was designed to preserve the natural character of the Texas Hill Country — with
                    homesites ranging from a quarter-acre to well over an acre, mature live oaks scattered throughout,
                    and Hill Country views from many elevated lots. The result is a neighborhood that feels established,
                    private, and genuinely connected to the landscape.
                  </p>
                  <p>
                    At the heart of Stone Creek Ranch is a resort-style amenity package that sets it apart from
                    many Fair Oaks Ranch subdivisions. The community pool is a natural gathering point during
                    San Antonio&apos;s long summers, while tennis courts and a well-equipped playground support an
                    active outdoor lifestyle for residents of all ages. The HOA maintains common areas to a high
                    standard and organizes community events throughout the year, fostering the kind of tight-knit
                    neighborhood culture that many buyers are specifically seeking when they choose Fair Oaks Ranch
                    over more urban alternatives.
                  </p>
                  <p>
                    Architecturally, Stone Creek Ranch features a mix of custom and semi-custom homes — many with
                    Hill Country-inspired stone and stucco exteriors, covered patios, and outdoor living spaces
                    designed to take advantage of the mild Texas climate. Home sizes typically range from 2,500 to
                    4,500 square feet, with four- and five-bedroom plans common among the more recent builds.
                    The combination of lot size, build quality, and community character makes Stone Creek Ranch
                    a strong long-term value within the Fair Oaks Ranch market.
                  </p>
                  <p>
                    For families, Stone Creek Ranch is zoned to Boerne ISD — one of the top-performing school
                    districts in all of Texas. Students attend Curington Elementary, Boerne Middle School, and
                    Boerne High School, all of which carry strong academic ratings and a wide range of
                    extracurricular programs. The district&apos;s reputation is a significant driver of buyer
                    demand in this corridor and contributes to the long-term appreciation of homes in Stone Creek Ranch.
                  </p>
                  <p>
                    Commuters appreciate the community&apos;s convenient access to I-10, putting downtown San Antonio
                    roughly 30 minutes away under normal traffic conditions. The South Texas Medical Center,
                    USAA headquarters, and the La Cantera and Rim shopping districts are all within a similar
                    or shorter distance, making Stone Creek Ranch genuinely practical as well as beautiful.
                    For those considering the Hill Country lifestyle, this community delivers the full package:
                    privacy, amenities, outstanding schools, and a manageable commute.
                  </p>
                </div>

                {/* Community Features */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Community Highlights
                  </h2>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    {FEATURES.map(({ icon: Icon, title, desc }) => (
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

                {/* Schools */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Boerne ISD Schools
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {SCHOOLS.map(({ level, name, rating }) => (
                      <div key={name} className="rounded-xl border border-border bg-background-cream p-5 text-center">
                        <div className="text-caption font-semibold uppercase tracking-wider text-[#C9A84C] mb-1">{level}</div>
                        <div className="font-heading text-body font-bold text-primary mb-1">{name}</div>
                        <div className="inline-flex items-center gap-1 text-caption text-[#C9A84C] font-semibold">
                          <CheckCircle className="h-3.5 w-3.5" /> {rating}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-body-sm text-foreground-muted">
                    Boerne ISD consistently earns &ldquo;A&rdquo; ratings from the Texas Education Agency. Verify current school
                    assignments with the district before purchasing.
                  </p>
                </div>

                {/* Commute */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Location &amp; Commute
                  </h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { dest: 'Downtown SA', time: '~30 min' },
                      { dest: 'Medical Center', time: '~25 min' },
                      { dest: 'USAA / 1604', time: '~20 min' },
                      { dest: 'SAT Airport', time: '~35 min' },
                    ].map(({ dest, time }) => (
                      <div key={dest} className="rounded-lg border border-border bg-background-cream p-4 text-center">
                        <Car className="mx-auto mb-2 h-5 w-5 text-[#C9A84C]" />
                        <div className="font-heading text-body font-bold text-primary">{time}</div>
                        <div className="text-caption text-foreground-muted">{dest}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* CTA Card */}
                <div className="mt-10 rounded-2xl border border-border bg-background-cream p-7">
                  <p className="overline mb-2 text-[#C9A84C]">Active Listings</p>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">
                    Browse Stone Creek Ranch Homes for Sale
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all current listings in Stone Creek Ranch — updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?community=stone-creek-ranch">
                      View Available Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                {/* Nearby */}
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
                      Interested in Stone Creek Ranch?
                    </h3>
                    <p className="mb-5 text-body-sm text-foreground-muted">
                      Fair Oaks Ranch is our home market. We know every street in Stone Creek Ranch and can
                      help you find the right home at the right price.
                    </p>
                    <Button size="lg" fullWidth asChild>
                      <Link href="/contact?area=StoneCreekRanch">Talk to a Local Expert</Link>
                    </Button>
                    <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                      <Link href="/listings?community=stone-creek-ranch">View Current Listings</Link>
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
                    <Link href="/homes-for-sale/fair-oaks-ranch-tx" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors mb-2">
                      <ArrowRight className="h-3.5 w-3.5" /> All Fair Oaks Ranch Homes
                    </Link>
                    <Link href="/neighborhoods" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors mb-2">
                      <ArrowRight className="h-3.5 w-3.5" /> Neighborhood Guide
                    </Link>
                    <Link href="/schools/boerne-isd" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors">
                      <ArrowRight className="h-3.5 w-3.5" /> Boerne ISD Schools
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-[#C9A84C]">Let&apos;s Get Started</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Find Your Stone Creek Ranch Home Today
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Whether you&apos;re buying your first Hill Country home or upgrading to a larger estate, our
                Fair Oaks Ranch specialists are ready to help. Contact us for a no-pressure consultation.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=StoneCreekRanch">Contact Our Local Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?community=stone-creek-ranch">
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
