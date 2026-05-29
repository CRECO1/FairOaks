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
const CANONICAL = `${BASE_URL}/neighborhoods/sonoma-verde`;

export const metadata: Metadata = {
  title: 'Sonoma Verde Fair Oaks Ranch Homes for Sale | Fair Oaks Realty Group',
  description:
    'Homes for sale in Sonoma Verde, Fair Oaks Ranch TX. Gated community with Mediterranean architecture, rolling Hill Country terrain, community pool, walking trails, and Boerne ISD schools. $500K–$950K.',
  alternates: { canonical: '/neighborhoods/sonoma-verde' },
  openGraph: {
    title: 'Sonoma Verde Fair Oaks Ranch Homes for Sale',
    description:
      'Browse homes in Sonoma Verde — a gated Fair Oaks Ranch community with Mediterranean-inspired architecture, rolling terrain, community pool, and Boerne ISD schools. $500K–$950K.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Sonoma Verde Homes — Fair Oaks Ranch TX' }],
  },
  twitter: { card: 'summary_large_image' },
  keywords: [
    'Sonoma Verde Fair Oaks Ranch homes for sale',
    'Sonoma Verde homes for sale',
    'Sonoma Verde Fair Oaks Ranch TX',
    'Sonoma Verde real estate',
    'gated community Fair Oaks Ranch',
    'Fair Oaks Ranch Hill Country homes',
    'Boerne ISD gated community',
    'Mediterranean homes Fair Oaks Ranch',
  ],
};

const STATS = [
  { icon: DollarSign, value: '$500K – $950K', label: 'Price Range' },
  { icon: Shield, value: 'Gated', label: 'Community Access' },
  { icon: School, value: 'Boerne ISD', label: 'School District' },
  { icon: Clock, value: '~30 min', label: 'To Downtown SA' },
];

const FEATURES = [
  { icon: Shield, title: 'Gated Entrance', desc: 'A controlled-access gated entrance provides privacy and security, setting Sonoma Verde apart from many non-gated Fair Oaks Ranch subdivisions.' },
  { icon: Star, title: 'Community Pool', desc: 'A well-maintained community pool serves as the social hub of Sonoma Verde during the warm Texas months — a feature families consistently rank as a top amenity.' },
  { icon: Trees, title: 'Walking Trails', desc: 'Scenic walking trails wind through the community, connecting residents to the rolling Hill Country terrain and natural surroundings that define this part of Bexar County.' },
  { icon: Home, title: 'Mediterranean Architecture', desc: 'Sonoma Verde homes reflect Mediterranean and Spanish Colonial influences — terracotta and tile accents, arched entries, and warm stucco exteriors that complement the Hill Country palette.' },
];

const SCHOOLS = [
  { level: 'Elementary', name: 'Curington Elementary', rating: 'A-Rated' },
  { level: 'Middle School', name: 'Boerne Middle School', rating: 'A-Rated' },
  { level: 'High School', name: 'Boerne High School', rating: 'A-Rated' },
];

const NEARBY = [
  { name: 'Fair Oaks Ranch Homes', href: '/homes-for-sale/fair-oaks-ranch-tx', desc: 'Browse all homes for sale in Fair Oaks Ranch, TX' },
  { name: 'Stone Creek Ranch', href: '/neighborhoods/stone-creek-ranch', desc: 'Gated master-planned community with resort-style amenities' },
  { name: 'The Preserve at Fair Oaks', href: '/neighborhoods/the-preserve-fair-oaks', desc: 'Custom builds on large greenbelt-backing homesites' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Neighborhoods', item: `${BASE_URL}/neighborhoods` },
        { '@type': 'ListItem', position: 3, name: 'Sonoma Verde', item: CANONICAL },
      ],
    },
    {
      '@type': 'Place',
      name: 'Sonoma Verde',
      description: 'Gated residential community in Fair Oaks Ranch, TX with Mediterranean architecture, rolling terrain, community pool, and Boerne ISD schools.',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Fair Oaks Ranch',
        addressRegion: 'TX',
        addressCountry: 'US',
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: 29.743,
        longitude: -98.638,
      },
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+12103909997',
      areaServed: { '@type': 'Place', name: 'Sonoma Verde, Fair Oaks Ranch, TX' },
    },
  ],
};

export default function SonomaVerdePage() {
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
              <span className="text-primary font-medium">Sonoma Verde</span>
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
                Sonoma Verde Homes for Sale —<br />Fair Oaks Ranch, TX
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Sonoma Verde brings a distinctive Mediterranean character to the Texas Hill Country — a gated
                community built on rolling terrain with community amenities, walking trails, and Boerne ISD schools
                at its core. Homes range from <strong className="text-white">$500K to $950K</strong>, offering
                excellent value within one of Fair Oaks Ranch&apos;s most recognized enclaves.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?community=sonoma-verde">Browse Sonoma Verde Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />210-390-9997</a>
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
                  Living in Sonoma Verde
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Sonoma Verde occupies some of the most visually striking terrain in Fair Oaks Ranch — rolling
                    hills, natural topography, and sweeping views that evoke the wine country its name references.
                    The community was designed to complement the landscape rather than override it, with roads that
                    follow the contours of the terrain and homesites positioned to maximize views and natural light.
                    The result is a neighborhood that feels both curated and organic — a balance that is genuinely
                    difficult to achieve in new residential development.
                  </p>
                  <p>
                    The architectural palette throughout Sonoma Verde leans toward Mediterranean and Spanish Colonial
                    influences — terracotta tile roofs, warm stucco exteriors, arched entryways, and interior
                    courtyards are common throughout the community. These design choices age gracefully in the
                    Texas climate and connect the neighborhood to a broader regional tradition of architecture
                    suited to the South Texas landscape. Homes typically range from 2,200 to 3,800 square feet,
                    with three- to five-bedroom configurations and generous outdoor living spaces.
                  </p>
                  <p>
                    Sonoma Verde&apos;s gated entrance provides a meaningful layer of privacy and security, while the
                    community pool, walking trails, and maintained common areas offer the kind of active, social
                    lifestyle that attracts families and active professionals to this part of Fair Oaks Ranch.
                    The community HOA maintains a strong commitment to aesthetics and upkeep, which contributes
                    directly to property values and the overall character of the neighborhood. Residents regularly
                    note the strong sense of community — neighbors who know each other, a pool deck that comes
                    alive on weekends, and trails that see regular foot traffic year-round.
                  </p>
                  <p>
                    Families with school-age children will find Sonoma Verde particularly well-positioned. The
                    community is zoned to Boerne ISD — one of the top-rated school districts in Texas — including
                    Curington Elementary, Boerne Middle School, and Boerne High School. The district&apos;s academic
                    record and extracurricular programs are a primary reason why buyers specifically seek out
                    Fair Oaks Ranch communities, and Sonoma Verde sits squarely within that zone.
                  </p>
                  <p>
                    Access to San Antonio is straightforward via I-10, with downtown approximately 30 minutes away
                    under typical traffic conditions. The South Texas Medical Center, USAA headquarters, and major
                    shopping and dining destinations at La Cantera and the Rim are all within 25 to 35 minutes —
                    making Sonoma Verde a genuinely practical choice for professionals who want the Hill Country
                    lifestyle without sacrificing connectivity to the metro area.
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
                    Browse Sonoma Verde Homes for Sale
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all current listings in Sonoma Verde — updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?community=sonoma-verde">
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
                      Interested in Sonoma Verde?
                    </h3>
                    <p className="mb-5 text-body-sm text-foreground-muted">
                      Fair Oaks Ranch is our home market. We know Sonoma Verde well and can help you navigate
                      the buying process from first showing to closing.
                    </p>
                    <Button size="lg" fullWidth asChild>
                      <Link href="/contact?area=SonomaVerde">Talk to a Local Expert</Link>
                    </Button>
                    <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                      <Link href="/listings?community=sonoma-verde">View Current Listings</Link>
                    </Button>
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="text-caption text-foreground-muted text-center mb-3">Or call us directly</p>
                      <a
                        href="tel:+12103909997"
                        className="flex items-center justify-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors"
                      >
                        <Phone className="h-4 w-4" /> 210-390-9997
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
                Find Your Sonoma Verde Home Today
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Gated, walkable, and beautifully designed — Sonoma Verde is one of Fair Oaks Ranch&apos;s most
                distinctive communities. Let our local agents help you find the right home.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=SonomaVerde">Contact Our Local Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?community=sonoma-verde">
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
