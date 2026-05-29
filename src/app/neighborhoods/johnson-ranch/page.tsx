export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  Star, Trees, CheckCircle, ArrowRight, Phone, Car, Shield,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/neighborhoods/johnson-ranch`;

export const metadata: Metadata = {
  title: 'Johnson Ranch Boerne Homes for Sale | Boerne TX | Fair Oaks Realty Group',
  description:
    'Homes for sale in Johnson Ranch, Boerne TX. Established Hill Country community with large live oaks, community amenities, and top-rated Boerne ISD schools. Close to Boerne city center. $350K–$650K.',
  alternates: { canonical: '/neighborhoods/johnson-ranch' },
  openGraph: {
    title: 'Johnson Ranch Boerne Homes for Sale | Boerne TX',
    description:
      'Browse homes for sale in Johnson Ranch, an established Boerne TX community with Hill Country character, large live oaks, and Boerne ISD schools. $350K–$650K.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Johnson Ranch Homes — Boerne TX' }],
  },
  twitter: { card: 'summary_large_image' },
  keywords: [
    'Johnson Ranch Boerne homes for sale',
    'Johnson Ranch Boerne TX',
    'Johnson Ranch real estate',
    'Johnson Ranch Boerne ISD',
    'established community Boerne TX',
    'Hill Country homes Boerne',
    'live oak community Boerne TX',
    'Boerne neighborhood homes for sale',
  ],
};

const STATS = [
  { icon: DollarSign, value: '$350K – $650K', label: 'Price Range' },
  { icon: Trees, value: 'Established', label: 'Community Character' },
  { icon: School, value: 'Boerne ISD', label: 'School District' },
  { icon: Clock, value: '~35 min', label: 'To Downtown SA' },
];

const FEATURES = [
  { icon: Trees, title: 'Mature Live Oaks', desc: 'Johnson Ranch is distinguished by its canopy of mature live oak trees — a feature that takes decades to grow and significantly enhances the character and privacy of individual homesites.' },
  { icon: Star, title: 'Community Amenities', desc: 'The community offers well-maintained amenities including a pool and recreational areas, maintained by an active HOA that keeps the neighborhood in strong condition year-round.' },
  { icon: Shield, title: 'Established & Well-Maintained', desc: 'As a more established community, Johnson Ranch benefits from mature landscaping, settled infrastructure, and a stable, long-term resident base.' },
  { icon: MapPin, title: 'Close to Boerne City Center', desc: 'Johnson Ranch is one of Boerne\'s best-positioned communities for walkability to downtown — Main Street restaurants, boutiques, the farmers market, and Cibolo Creek park are just minutes away.' },
];

const SCHOOLS = [
  { level: 'Elementary', name: 'Boerne ISD Elementary', rating: 'A-Rated' },
  { level: 'Middle School', name: 'Boerne Middle School', rating: 'A-Rated' },
  { level: 'High School', name: 'Boerne High School', rating: 'A-Rated' },
];

const NEARBY = [
  { name: 'Boerne Homes for Sale', href: '/homes-for-sale/boerne-tx', desc: 'Browse all homes for sale in Boerne, TX' },
  { name: 'Herff Ranch', href: '/neighborhoods/herff-ranch', desc: 'Large master-planned community with newer construction in Boerne' },
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
        { '@type': 'ListItem', position: 3, name: 'Johnson Ranch', item: CANONICAL },
      ],
    },
    {
      '@type': 'Place',
      name: 'Johnson Ranch',
      description: 'Established residential community in Boerne, TX with Hill Country character, mature live oaks, community amenities, and Boerne ISD schools.',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Boerne',
        addressRegion: 'TX',
        addressCountry: 'US',
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: 29.795,
        longitude: -98.732,
      },
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+12103909997',
      areaServed: { '@type': 'Place', name: 'Johnson Ranch, Boerne, TX' },
    },
  ],
};

export default function JohnsonRanchPage() {
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
              <span className="text-primary font-medium">Johnson Ranch</span>
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
                Johnson Ranch Boerne Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Johnson Ranch is one of Boerne&apos;s most beloved established communities — a neighborhood defined
                by its canopy of mature live oaks, Hill Country character, and close proximity to downtown Boerne&apos;s
                Main Street. Homes range from <strong className="text-white">$350K to $650K</strong>, with strong
                demand supported by top-rated Boerne ISD schools and a genuinely tight-knit community feel.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?community=johnson-ranch">Browse Johnson Ranch Listings</Link>
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
                  Living in Johnson Ranch, Boerne TX
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Johnson Ranch holds a special place in the Boerne real estate market — it is the kind of
                    community that buyers who have lived in the area for years consistently point to when asked
                    where they would want to live if they were starting over. The neighborhood has the character
                    that takes time to develop: mature live oaks that canopy the streets, settled landscaping,
                    a diverse mix of residents from young families to long-time Boerne residents, and a genuine
                    sense of belonging that newer master-planned communities work hard to replicate.
                  </p>
                  <p>
                    The live oaks are a defining feature. These are not the small trees planted at construction
                    — they are the real Hill Country oaks that have grown over decades, providing shade,
                    natural sound barriers between lots, and that particular Texas Hill Country atmosphere that
                    draws people to the region in the first place. Many buyers who tour Johnson Ranch comment
                    specifically on the trees as a deciding factor, and it is easy to understand why once you
                    drive the streets.
                  </p>
                  <p>
                    Community amenities include a neighborhood pool and recreational spaces maintained by an
                    active HOA. The HOA keeps common areas and shared spaces in strong condition, and residents
                    describe an engaged, friendly community culture with regular neighborhood events and a high
                    level of neighborly interaction. Johnson Ranch attracts buyers who want community in the
                    fullest sense — not just shared amenities, but actual relationships with the people who
                    live nearby.
                  </p>
                  <p>
                    One of Johnson Ranch&apos;s most practical advantages is its proximity to Boerne city center.
                    Main Street Boerne — with its award-winning restaurants, local boutiques, specialty shops,
                    farmers market, and events calendar — is just minutes from most homes in the community.
                    Cibolo Creek Nature Area, a beloved local green space, is also nearby. For buyers who value
                    walkability and connection to Boerne&apos;s small-town culture, Johnson Ranch&apos;s location is
                    difficult to beat.
                  </p>
                  <p>
                    Schools are a significant draw. Johnson Ranch is zoned to Boerne ISD, which earns
                    consistently high marks from the Texas Education Agency and is regularly recognized as
                    one of the top districts in Texas. The combination of strong academics, active parent
                    community, and competitive extracurricular programs makes Boerne ISD a genuine differentiator
                    for families comparing Johnson Ranch to communities in other districts. For buyers who have
                    done their research on schools, Boerne ISD is often the deciding factor.
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
                      { dest: 'Boerne Main St', time: '~5 min' },
                      { dest: 'Downtown SA', time: '~35 min' },
                      { dest: 'Medical Center', time: '~30 min' },
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
                    Browse Johnson Ranch Homes for Sale
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all current listings in Johnson Ranch — updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?community=johnson-ranch">
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
                      Interested in Johnson Ranch?
                    </h3>
                    <p className="mb-5 text-body-sm text-foreground-muted">
                      Boerne is one of our core markets. Our agents know Johnson Ranch well and can help
                      you find the right home at the right price.
                    </p>
                    <Button size="lg" fullWidth asChild>
                      <Link href="/contact?area=JohnsonRanch">Talk to a Local Expert</Link>
                    </Button>
                    <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                      <Link href="/listings?community=johnson-ranch">View Current Listings</Link>
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
                Find Your Johnson Ranch Home Today
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Mature trees, a real community feel, and Boerne&apos;s best schools — Johnson Ranch delivers the
                Hill Country lifestyle at an accessible price. Let us help you find your home here.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=JohnsonRanch">Contact Our Local Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?community=johnson-ranch">
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
