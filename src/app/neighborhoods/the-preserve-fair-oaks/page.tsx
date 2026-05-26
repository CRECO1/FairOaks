export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  Trees, CheckCircle, ArrowRight, Phone, Car, Star,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/neighborhoods/the-preserve-fair-oaks`;

export const metadata: Metadata = {
  title: 'The Preserve at Fair Oaks Homes for Sale | Fair Oaks Ranch TX | Fair Oaks Realty Group',
  description:
    'Homes for sale in The Preserve at Fair Oaks, Fair Oaks Ranch TX. Newer custom and semi-custom builds on 0.5–2+ acre homesites with greenbelt backing, wildlife corridors, and Boerne ISD schools. $650K–$1.8M.',
  alternates: { canonical: '/neighborhoods/the-preserve-fair-oaks' },
  openGraph: {
    title: 'The Preserve at Fair Oaks Homes for Sale | Fair Oaks Ranch TX',
    description:
      'Browse homes in The Preserve at Fair Oaks — newer custom builds on large Hill Country lots with greenbelt backing and Boerne ISD schools. Homes from $650K–$1.8M.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'The Preserve at Fair Oaks Homes — Fair Oaks Ranch TX' }],
  },
  twitter: { card: 'summary_large_image' },
  keywords: [
    'The Preserve at Fair Oaks homes for sale',
    'The Preserve Fair Oaks Ranch TX',
    'The Preserve at Fair Oaks real estate',
    'custom homes Fair Oaks Ranch',
    'large lot homes Fair Oaks Ranch TX',
    'greenbelt homes Fair Oaks Ranch',
    'Boerne ISD new construction homes',
    'Fair Oaks Ranch luxury homes for sale',
  ],
};

const STATS = [
  { icon: DollarSign, value: '$650K – $1.8M', label: 'Price Range' },
  { icon: Home, value: '0.5 – 2+ acres', label: 'Lot Sizes' },
  { icon: School, value: 'Boerne ISD', label: 'School District' },
  { icon: Clock, value: '~30 min', label: 'To Downtown SA' },
];

const FEATURES = [
  { icon: Trees, title: 'Greenbelt & Wildlife Corridors', desc: 'Many homesites back directly to greenbelt areas and protected wildlife corridors — delivering privacy, natural views, and habitat preservation.' },
  { icon: Home, title: 'Custom & Semi-Custom Builds', desc: 'Predominantly custom and semi-custom construction from the 2010s–2020s, with modern finishes, open floor plans, and thoughtful Hill Country architecture.' },
  { icon: Star, title: 'Spacious Homesites', desc: 'Lots ranging from half an acre to more than two acres give residents elbow room — ideal for pools, outdoor kitchens, workshops, and entertaining spaces.' },
  { icon: School, title: 'Top Boerne ISD Schools', desc: 'Zoned to Boerne ISD, one of the highest-rated school districts in Texas, with strong academics and extensive extracurricular programs.' },
];

const SCHOOLS = [
  { level: 'Elementary', name: 'Boerne ISD Elementary', rating: 'A-Rated' },
  { level: 'Middle School', name: 'Boerne Middle School', rating: 'A-Rated' },
  { level: 'High School', name: 'Boerne High School', rating: 'A-Rated' },
];

const NEARBY = [
  { name: 'Fair Oaks Ranch Homes', href: '/homes-for-sale/fair-oaks-ranch-tx', desc: 'Browse all homes for sale in Fair Oaks Ranch, TX' },
  { name: 'Stone Creek Ranch', href: '/neighborhoods/stone-creek-ranch', desc: 'Gated master-planned community with resort-style amenities' },
  { name: 'Sonoma Verde', href: '/neighborhoods/sonoma-verde', desc: 'Rolling terrain, community pool, and gated entry in Fair Oaks Ranch' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Neighborhoods', item: `${BASE_URL}/neighborhoods` },
        { '@type': 'ListItem', position: 3, name: 'The Preserve at Fair Oaks', item: CANONICAL },
      ],
    },
    {
      '@type': 'Place',
      name: 'The Preserve at Fair Oaks',
      description: 'Upscale newer-construction subdivision in Fair Oaks Ranch, TX with large homesites, greenbelt backing, and Boerne ISD schools.',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Fair Oaks Ranch',
        addressRegion: 'TX',
        addressCountry: 'US',
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: 29.748,
        longitude: -98.640,
      },
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+12103909997',
      areaServed: { '@type': 'Place', name: 'The Preserve at Fair Oaks, Fair Oaks Ranch, TX' },
    },
  ],
};

export default function ThePreserveFairOaksPage() {
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
              <span className="text-primary font-medium">The Preserve at Fair Oaks</span>
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
                The Preserve at Fair Oaks Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                The Preserve at Fair Oaks offers some of the most spacious and private homesites in Fair Oaks Ranch —
                newer custom and semi-custom builds on half-acre to two-acre lots, with greenbelt backing, wildlife
                corridors, and top-rated Boerne ISD schools. Homes range from{' '}
                <strong className="text-white">$650K to $1.8M</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?community=the-preserve-fair-oaks">Browse The Preserve Listings</Link>
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
                  Life in The Preserve at Fair Oaks
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    The Preserve at Fair Oaks represents a newer chapter in Fair Oaks Ranch&apos;s story —
                    a community built primarily in the 2010s and 2020s that takes full advantage of the area&apos;s
                    natural topography. Where older Fair Oaks Ranch subdivisions were designed for an earlier era,
                    The Preserve was planned around modern sensibilities: larger lots, thoughtful land preservation,
                    and homes that genuinely integrate with the Hill Country environment rather than simply sitting
                    on top of it.
                  </p>
                  <p>
                    Lot sizes in The Preserve are among the most generous available in Fair Oaks Ranch, with many
                    homesites ranging from half an acre to more than two acres. A significant number of properties
                    back directly to greenbelt areas and protected wildlife corridors, providing a level of natural
                    privacy that is increasingly rare in the San Antonio metro. White-tailed deer, wild turkey, and
                    native Hill Country wildlife are regular sights from back porches and outdoor living spaces —
                    a feature that buyers consistently cite as one of the community&apos;s most compelling attributes.
                  </p>
                  <p>
                    Construction in The Preserve spans custom and semi-custom builds, with architectural styles
                    that reflect the best of contemporary Hill Country design: stone and stucco exteriors, metal
                    rooflines, open-concept interiors with high ceilings, and outdoor living spaces designed for
                    year-round use. Many homes feature pools, outdoor kitchens, fire pits, and multi-car garages
                    — details that reflect the lifestyle priorities of buyers who choose Fair Oaks Ranch over
                    more densely developed suburban alternatives.
                  </p>
                  <p>
                    Families are drawn to The Preserve in part because of its Boerne ISD schools, which serve
                    students from kindergarten through graduation with consistently high academic performance.
                    The district earns top ratings from the Texas Education Agency and ranks among the best in
                    the state for college readiness, AP participation, and overall student outcomes. For buyers
                    who prioritize school quality alongside space and privacy, The Preserve at Fair Oaks is
                    difficult to beat in the current market.
                  </p>
                  <p>
                    Despite its secluded feel, The Preserve is well-connected to the broader San Antonio metro.
                    I-10 provides straightforward access to downtown San Antonio in approximately 30 minutes
                    under normal traffic conditions — close enough for a practical daily commute, yet far enough
                    to genuinely escape the city when you return home each evening. The South Texas Medical
                    Center, USAA, and the Rim and La Cantera retail corridors are all within a comparable or
                    shorter distance, reinforcing the community&apos;s appeal for professionals who want both
                    lifestyle and convenience.
                  </p>
                </div>

                {/* Features */}
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
                    Verify current school zoning assignments with Boerne ISD before purchasing.
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
                    Browse The Preserve at Fair Oaks Homes for Sale
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all current listings in The Preserve — updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?community=the-preserve-fair-oaks">
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
                      Interested in The Preserve?
                    </h3>
                    <p className="mb-5 text-body-sm text-foreground-muted">
                      Fair Oaks Ranch is our home market. Our agents know The Preserve at Fair Oaks inside
                      and out — let us help you find the perfect home.
                    </p>
                    <Button size="lg" fullWidth asChild>
                      <Link href="/contact?area=ThePreserveFairOaks">Talk to a Local Expert</Link>
                    </Button>
                    <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                      <Link href="/listings?community=the-preserve-fair-oaks">View Current Listings</Link>
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
                Find Your Home in The Preserve at Fair Oaks
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Large lots, newer construction, and Hill Country nature — The Preserve at Fair Oaks offers a
                lifestyle that is hard to replicate. Let our local team help you get into the right home.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=ThePreserveFairOaks">Contact Our Local Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?community=the-preserve-fair-oaks">
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
