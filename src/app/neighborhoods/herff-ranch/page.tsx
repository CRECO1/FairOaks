export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  Star, Trees, CheckCircle, ArrowRight, Phone, Car, Layers,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/neighborhoods/herff-ranch`;

export const metadata: Metadata = {
  title: 'Herff Ranch Boerne Homes for Sale | Boerne TX | Fair Oaks Realty Group',
  description:
    'Homes for sale in Herff Ranch, Boerne TX. Large master-planned community with newer builds from Highland Homes, Drees, and Perry Homes. Community pools, parks, trails, and top-rated Boerne ISD schools. $380K–$750K.',
  alternates: { canonical: '/neighborhoods/herff-ranch' },
  openGraph: {
    title: 'Herff Ranch Boerne Homes for Sale | Boerne TX',
    description:
      'Browse homes for sale in Herff Ranch, Boerne TX. Newer construction from Highland, Drees, and Perry Homes. Boerne ISD schools, community amenities. $380K–$750K.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Herff Ranch Homes — Boerne TX' }],
  },
  twitter: { card: 'summary_large_image' },
  keywords: [
    'Herff Ranch Boerne homes for sale',
    'Herff Ranch Boerne TX',
    'Herff Ranch real estate',
    'Herff Ranch new construction',
    'Herff Ranch Boerne ISD',
    'Highland Homes Boerne TX',
    'new homes Boerne TX',
    'master-planned community Boerne',
  ],
};

const STATS = [
  { icon: DollarSign, value: '$380K – $750K', label: 'Price Range' },
  { icon: Home, value: '2015 – Present', label: 'Built' },
  { icon: School, value: 'Boerne ISD', label: 'School District' },
  { icon: Clock, value: '~35 min', label: 'To Downtown SA' },
];

const FEATURES = [
  { icon: Star, title: 'Community Pools & Parks', desc: 'Multiple community pools, parks, and pocket green spaces distributed throughout Herff Ranch provide residents with amenities within walking distance.' },
  { icon: Trees, title: 'Trails & Open Space', desc: 'An extensive trail network connects sections of the community, making Herff Ranch particularly popular with walkers, joggers, and families with young children.' },
  { icon: Layers, title: 'Multiple Builders', desc: 'Highland Homes, Drees Custom Homes, Perry Homes, and other regional builders have all built in Herff Ranch — giving buyers a range of styles, sizes, and price points.' },
  { icon: School, title: 'Top Boerne ISD Schools', desc: 'Zoned to top-rated Boerne ISD campuses, the district earns consistent "A" ratings from the Texas Education Agency and is a primary draw for families relocating to the area.' },
];

const BUILDERS = [
  { name: 'Highland Homes', note: 'Energy-efficient builds, strong resale value' },
  { name: 'Drees Custom Homes', note: 'Semi-custom options, flexible floor plans' },
  { name: 'Perry Homes', note: 'Value-driven builds with extensive standard features' },
];

const SCHOOLS = [
  { level: 'Elementary', name: 'Boerne ISD Elementary', rating: 'A-Rated' },
  { level: 'Middle School', name: 'Boerne Middle School', rating: 'A-Rated' },
  { level: 'High School', name: 'Boerne High School', rating: 'A-Rated' },
];

const NEARBY = [
  { name: 'Boerne Homes for Sale', href: '/homes-for-sale/boerne-tx', desc: 'Browse all homes for sale in Boerne, TX' },
  { name: 'Johnson Ranch', href: '/neighborhoods/johnson-ranch', desc: 'Established Boerne community with Hill Country character and live oaks' },
  { name: 'Fair Oaks Ranch Homes', href: '/homes-for-sale/fair-oaks-ranch-tx', desc: 'Browse homes in neighboring Fair Oaks Ranch, TX' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Neighborhoods', item: `${BASE_URL}/neighborhoods` },
        { '@type': 'ListItem', position: 3, name: 'Herff Ranch', item: CANONICAL },
      ],
    },
    {
      '@type': 'Place',
      name: 'Herff Ranch',
      description: 'Large master-planned community in Boerne, TX with newer construction from multiple builders, community amenities, and Boerne ISD schools.',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Boerne',
        addressRegion: 'TX',
        addressCountry: 'US',
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: 29.785,
        longitude: -98.713,
      },
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+12103909997',
      areaServed: { '@type': 'Place', name: 'Herff Ranch, Boerne, TX' },
    },
  ],
};

export default function HerffRanchPage() {
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
              <span className="text-primary font-medium">Herff Ranch</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                Boerne, TX — Boerne ISD
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Herff Ranch Boerne Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Herff Ranch is one of the Boerne area&apos;s most active master-planned communities — a large,
                well-amenitized neighborhood with newer construction from some of Texas&apos;s most reputable builders.
                With community pools, parks, trails, and top Boerne ISD schools, homes range from{' '}
                <strong className="text-white">$380K to $750K</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?community=herff-ranch">Browse Herff Ranch Listings</Link>
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
                  Living in Herff Ranch, Boerne TX
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Herff Ranch has become one of the most sought-after master-planned communities in the greater
                    Boerne area, drawing buyers who want newer construction, strong schools, and a full suite of
                    community amenities at a price point that remains accessible relative to neighboring Fair Oaks
                    Ranch. The community has grown significantly since 2015 and continues to attract new residents
                    from across the San Antonio metro and from out-of-state relocators who prioritize Boerne ISD.
                  </p>
                  <p>
                    The scale of Herff Ranch is one of its defining characteristics. The community is large enough
                    to support multiple pools, parks, and an extensive network of walking and jogging trails —
                    amenities that smaller subdivisions simply cannot offer. Families with young children in
                    particular find the park and trail system invaluable, with green space accessible from virtually
                    every section of the community. Weekend mornings bring out walkers, cyclists, and families
                    with strollers in a way that reflects the genuinely active lifestyle of the people who call
                    Herff Ranch home.
                  </p>
                  <p>
                    Construction quality varies by builder and section of the community, which is typical of
                    large master-planned developments. Highland Homes brings energy efficiency and a reputation
                    for strong resale values. Drees Custom Homes offers more flexibility in floor plans and
                    finishes for buyers who want a semi-custom experience at a manageable price. Perry Homes
                    delivers excellent value-to-square-footage ratios with extensive standard features. Working
                    with a knowledgeable local agent who understands the differences between sections and builders
                    is essential to making the best purchase decision in Herff Ranch.
                  </p>
                  <p>
                    School access is a central reason buyers choose Herff Ranch over comparable communities in
                    adjacent school districts. Boerne ISD earns consistent &ldquo;A&rdquo; ratings from the Texas Education
                    Agency and is regularly cited among the best school districts in the state. The combination
                    of strong academics, competitive athletics, and a close-knit community culture within the
                    district makes it a significant factor in home values throughout Herff Ranch.
                  </p>
                  <p>
                    Commute access is practical rather than exceptional — Herff Ranch sits comfortably west of
                    San Antonio, with I-10 providing a direct route to downtown San Antonio in approximately
                    35 minutes. The Medical Center corridor and USAA headquarters are slightly closer. Boerne
                    city center — with its Main Street restaurants, boutiques, and farmers market — is just
                    minutes away, making Herff Ranch one of the best-positioned communities for buyers who want
                    to walk to local shops and dining on weekends.
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

                {/* Builders */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Builders in Herff Ranch
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {BUILDERS.map(({ name, note }) => (
                      <div key={name} className="rounded-xl border border-border bg-background-cream p-5">
                        <div className="font-heading text-body font-bold text-primary mb-1">{name}</div>
                        <p className="text-body-sm text-foreground-muted">{note}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-body-sm text-foreground-muted">
                    Builder availability changes as sections sell out. Contact us for current inventory and new phase information.
                  </p>
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
                    Verify current school zoning with Boerne ISD before purchasing.
                  </p>
                </div>

                {/* Commute */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Location &amp; Commute
                  </h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { dest: 'Downtown SA', time: '~35 min' },
                      { dest: 'Medical Center', time: '~30 min' },
                      { dest: 'Boerne City', time: '~5 min' },
                      { dest: 'SAT Airport', time: '~40 min' },
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
                    Browse Herff Ranch Homes for Sale
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all current listings in Herff Ranch — updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?community=herff-ranch">
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
                      Interested in Herff Ranch?
                    </h3>
                    <p className="mb-5 text-body-sm text-foreground-muted">
                      Boerne is one of our core markets. We know Herff Ranch&apos;s sections, builders, and
                      resale inventory — let us help you find the right home.
                    </p>
                    <Button size="lg" fullWidth asChild>
                      <Link href="/contact?area=HerffRanch">Talk to a Local Expert</Link>
                    </Button>
                    <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                      <Link href="/listings?community=herff-ranch">View Current Listings</Link>
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
                    <Link href="/homes-for-sale/boerne-tx" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors mb-2">
                      <ArrowRight className="h-3.5 w-3.5" /> All Boerne TX Homes
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
                Find Your Herff Ranch Home Today
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                New construction, top schools, and a thriving community — Herff Ranch is one of Boerne&apos;s
                most in-demand addresses. Contact our local team to get started.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=HerffRanch">Contact Our Local Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?community=herff-ranch">
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
