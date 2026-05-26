export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, ArrowRight, Phone, School, DollarSign,
  Trees, Briefcase, Clock, Shield, CheckCircle, Home,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/relocation`;

export const metadata: Metadata = {
  title: 'Relocating to San Antonio & Texas Hill Country | Fair Oaks Realty Group',
  description:
    'Relocating to San Antonio or the Texas Hill Country? Our complete relocation guide covers neighborhoods, schools, commute times, and the local real estate market.',
  alternates: { canonical: '/relocation' },
  openGraph: {
    title: 'Relocating to San Antonio & Texas Hill Country | Fair Oaks Realty Group',
    description:
      'Moving to San Antonio or the Texas Hill Country? Get a complete relocation guide — neighborhoods, schools, cost of living, commute times, and expert local real estate agents.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Relocating to San Antonio & Texas Hill Country — Fair Oaks Realty Group' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Relocating to San Antonio & Texas Hill Country | Fair Oaks Realty Group',
    description: 'Moving to San Antonio or the Texas Hill Country? Complete relocation guide from local experts.',
  },
  keywords: [
    'relocating to san antonio texas',
    'moving to texas hill country',
    'san antonio relocation guide',
    'pcs to san antonio military',
    'moving to fair oaks ranch',
    'relocating to boerne tx',
    'cost of living san antonio',
    'best neighborhoods san antonio relocation',
    'texas hill country relocation',
    'moving from out of state texas',
  ],
};

const WHY_HILL_COUNTRY = [
  {
    icon: School,
    title: 'Top-Rated Schools',
    description: 'Boerne ISD, Northside ISD, and Comal ISD consistently rank among Texas\'s highest-rated districts. Families choose the Hill Country specifically for the schools.',
  },
  {
    icon: DollarSign,
    title: 'No State Income Tax',
    description: 'Texas has zero state income tax. Combined with competitive home prices relative to other major metros, your dollar goes significantly further here.',
  },
  {
    icon: Trees,
    title: 'Outdoor Lifestyle',
    description: 'Hill Country rivers, state parks, hiking trails, and a year-round mild climate make outdoor living part of daily life — not just a weekend activity.',
  },
  {
    icon: Briefcase,
    title: 'Strong Job Market',
    description: 'San Antonio is home to major military installations, USAA, Valero, Rackspace, Toyota, and a booming healthcare sector. Remote workers love the lifestyle and affordability.',
  },
];

const NEIGHBORHOODS = [
  {
    name: 'Fair Oaks Ranch',
    slug: '/homes-for-sale/fair-oaks-ranch-tx',
    description: 'The premier Hill Country address — master-planned, safe, and served by top-rated Boerne ISD. A top pick for families and professionals.',
    priceRange: '$450K – $1.2M+',
    school: 'Boerne ISD',
  },
  {
    name: 'Boerne',
    slug: '/homes-for-sale/boerne-tx',
    description: 'Walkable historic Main Street, wine bars, boutiques, and outstanding schools. Boerne is Hill Country living at its most charming.',
    priceRange: '$350K – $900K',
    school: 'Boerne ISD',
  },
  {
    name: 'Helotes',
    slug: '/homes-for-sale/helotes-tx',
    description: 'A tight-knit community northwest of San Antonio with Hill Country character, strong schools, and easy access to the city.',
    priceRange: '$350K – $750K',
    school: 'Northside ISD',
  },
  {
    name: 'New Braunfels',
    slug: '/homes-for-sale/new-braunfels-tx',
    description: 'One of the fastest-growing cities in the US. German heritage, Comal River tubing, Schlitterbahn, and top Comal ISD schools.',
    priceRange: '$320K – $700K',
    school: 'Comal ISD',
  },
  {
    name: 'Bulverde',
    slug: '/homes-for-sale/bulverde-tx',
    description: 'Master-planned communities, new construction, and a family atmosphere north of San Antonio with Hill Country views.',
    priceRange: '$380K – $800K',
    school: 'Comal ISD',
  },
  {
    name: 'Canyon Lake',
    slug: '/homes-for-sale/canyon-lake-tx',
    description: 'Waterfront living in the Texas Hill Country. Vacation homes, permanent residences, and stunning lake views — all within Comal ISD.',
    priceRange: '$350K – $1.5M+',
    school: 'Comal ISD',
  },
];

const COST_OF_LIVING_ROWS = [
  { category: 'State Income Tax', texas: 'None', national: '~4–5% avg' },
  { category: 'Median Home Price (Metro)', texas: '~$320K', national: '~$410K' },
  { category: 'Property Tax Rate', texas: '~1.8–2.5%', national: '~1.1%' },
  { category: 'Overall Cost of Living Index', texas: '~92–96', national: '100 (baseline)' },
  { category: 'Avg. Monthly Utilities', texas: '~$180–$220', national: '~$170–$200' },
  { category: 'Grocery Index', texas: '~94', national: '100 (baseline)' },
  { category: 'Healthcare Index', texas: '~97', national: '100 (baseline)' },
];

const COMMUTE_TIMES = [
  { destination: 'BAMC / Fort Sam Houston', time: '~25 min', route: 'I-10 E from Fair Oaks Ranch' },
  { destination: 'Randolph AFB', time: '~35 min', route: 'Loop 1604 E from Helotes' },
  { destination: 'Lackland AFB / Kelly Field', time: '~40 min', route: 'I-10 E + 90 W from Boerne' },
  { destination: 'Downtown San Antonio', time: '~20 min', route: 'I-10 E from Leon Springs' },
  { destination: 'South Texas Medical Center', time: '~20 min', route: 'I-10 E from Fair Oaks Ranch' },
  { destination: 'USAA Headquarters', time: '~15 min', route: 'Loop 1604 from Fair Oaks Ranch' },
  { destination: 'Toyota Manufacturing', time: '~45 min', route: 'I-35 S from New Braunfels' },
  { destination: 'San Antonio Airport (SAT)', time: '~35 min', route: 'I-10 E + 281 N from Boerne' },
];

const FAQS = [
  {
    q: 'What are the best neighborhoods in San Antonio for families relocating from out of state?',
    a: 'For families prioritizing top schools and safety, Fair Oaks Ranch, Boerne, and Helotes are the most sought-after Hill Country options. They combine outstanding school districts (Boerne ISD and Northside ISD), low crime, and a strong community feel. For more urban convenience with still-strong schools, established northwest San Antonio neighborhoods within Northside ISD are excellent. New Braunfels and Bulverde (Comal ISD) are popular with families who want newer construction at competitive prices.',
  },
  {
    q: 'What is the cost of living in San Antonio compared to other major cities?',
    a: 'San Antonio\'s overall cost of living index is approximately 92–96, meaning it costs roughly 4–8% less than the national average. The biggest advantage is Texas\'s zero state income tax, which immediately increases your take-home pay compared to states like California, New York, or Illinois. Housing is significantly more affordable than comparable metros — and while property taxes are higher than the national average, the income tax savings typically more than offset them for most buyers.',
  },
  {
    q: 'How do schools in the Texas Hill Country compare to the national average?',
    a: 'The Texas Hill Country school districts are among the strongest in the state and compare very favorably to national averages. Boerne ISD and Comal ISD consistently earn "A" ratings from the Texas Education Agency and 8–9/10 ratings on GreatSchools. Both outperform most comparable suburban districts nationally for graduation rates, AP participation, and college readiness. Northside ISD, one of the largest districts in Texas, also earns strong ratings and offers extensive specialized programs.',
  },
  {
    q: 'How long does it take to buy a home when relocating?',
    a: 'For an out-of-state buyer who is pre-approved and working with a knowledgeable local agent, the timeline from first home tour to closing is typically 30–60 days. We work with many relocating buyers who start the process remotely — virtual tours, video walkthroughs, and digital document signing make it possible to go under contract before you\'ve moved. We recommend starting the process at least 60–90 days before your intended move date.',
  },
  {
    q: 'Can I buy a home remotely before relocating?',
    a: 'Yes — and we do this regularly, especially with military PCS buyers and corporate relocators. We offer detailed video walkthroughs, neighborhood orientation tours via video call, and can handle digital document signing throughout the process. Our agents are experienced at representing out-of-state buyers from offer through closing. We\'ll be your eyes on the ground and make sure you feel confident every step of the way.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Relocation Guide', item: CANONICAL },
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQS.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
    {
      '@type': 'LocalBusiness',
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+12103909997',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Fair Oaks Ranch',
        addressRegion: 'TX',
        addressCountry: 'US',
      },
      description:
        'Relocation specialists serving San Antonio, the Texas Hill Country, and surrounding communities. Expert local agents helping out-of-state buyers find the right home.',
    },
  ],
};

export default function RelocationPage() {
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
              <span className="text-primary font-medium">Relocation Guide</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                San Antonio &amp; Texas Hill Country
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Welcome to the Texas Hill Country —<br />Your New Home Awaits
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Relocating to San Antonio or the Texas Hill Country? You&apos;re making one of the best moves of your
                life. This guide covers everything you need to know — neighborhoods, schools, cost of living,
                commute times, and how to buy a home before you arrive.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/contact?service=relocation">Schedule a Relocation Consultation</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Why Hill Country */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-[#C9A84C]">The Case for Moving Here</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Why Families Choose the Hill Country
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body-lg text-foreground-muted">
                Every year, thousands of families relocate to San Antonio and the Texas Hill Country — and
                most say they wish they&apos;d done it sooner.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {WHY_HILL_COUNTRY.map(({ icon: Icon, title, description }) => (
                <div key={title} className="rounded-2xl border border-border bg-white p-6 shadow-sm">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#C9A84C]/10">
                    <Icon className="h-6 w-6 text-[#C9A84C]" />
                  </div>
                  <h3 className="mb-2 font-heading text-heading-sm font-bold text-primary">{title}</h3>
                  <p className="text-body-sm text-foreground-muted leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Top Neighborhoods */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Find Your Fit</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Top Neighborhoods for Relocators
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body-lg text-foreground-muted">
                Each community has its own character. Here&apos;s a quick overview — click any city to dig deeper.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {NEIGHBORHOODS.map((n) => (
                <div key={n.name} className="rounded-2xl border border-border bg-background-cream p-6 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4 text-[#C9A84C] shrink-0" />
                    <h3 className="font-heading text-heading-sm font-bold text-primary">{n.name}</h3>
                  </div>
                  <p className="mb-4 text-body-sm text-foreground-muted leading-relaxed flex-1">{n.description}</p>
                  <div className="flex items-center justify-between mt-auto">
                    <div>
                      <div className="text-caption font-semibold text-[#C9A84C]">{n.priceRange}</div>
                      <div className="text-caption text-foreground-muted flex items-center gap-1">
                        <School className="h-3 w-3" /> {n.school}
                      </div>
                    </div>
                    <Link
                      href={n.slug}
                      className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors"
                    >
                      Explore <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Cost of Living */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Know Before You Move</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Cost of Living Comparison
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body-lg text-foreground-muted">
                Texas compares favorably to most states on overall cost of living — especially for buyers
                moving from high-tax states.
              </p>
            </div>
            <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-border shadow-sm">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="px-5 py-3 text-left font-semibold">Category</th>
                    <th className="px-5 py-3 text-left font-semibold text-[#C9A84C]">Texas / Hill Country</th>
                    <th className="px-5 py-3 text-left font-semibold">National Average</th>
                  </tr>
                </thead>
                <tbody>
                  {COST_OF_LIVING_ROWS.map((row, i) => (
                    <tr key={row.category} className={i % 2 === 0 ? 'bg-white' : 'bg-background-cream/60'}>
                      <td className="px-5 py-3 font-medium text-primary">{row.category}</td>
                      <td className="px-5 py-3 font-semibold text-[#C9A84C]">{row.texas}</td>
                      <td className="px-5 py-3 text-foreground-muted">{row.national}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-caption text-foreground-muted bg-background-cream border-t border-border">
                Data is approximate and based on publicly available cost-of-living indices. Consult a financial advisor for personalized analysis.
              </p>
            </div>
          </Container>
        </section>

        {/* Commute Times */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Getting Around</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Commute Times from Major Employers
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body-lg text-foreground-muted">
                Hill Country living doesn&apos;t mean a long commute. Most major employers in San Antonio are
                25–40 minutes from Fair Oaks Ranch and Boerne via I-10 or Loop 1604.
              </p>
            </div>
            <div className="mx-auto max-w-3xl grid grid-cols-1 gap-4 sm:grid-cols-2">
              {COMMUTE_TIMES.map(({ destination, time, route }) => (
                <div key={destination} className="flex items-start gap-4 rounded-xl border border-border bg-background-cream p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#C9A84C]/10">
                    <Clock className="h-5 w-5 text-[#C9A84C]" />
                  </div>
                  <div>
                    <div className="font-heading text-heading-sm font-bold text-primary">{destination}</div>
                    <div className="text-body font-semibold text-[#C9A84C]">{time}</div>
                    <div className="text-caption text-foreground-muted">{route}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-caption text-foreground-muted">
              Times are estimates under typical traffic conditions. Peak-hour commutes may vary.
            </p>
          </Container>
        </section>

        {/* Military PCS Section */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="rounded-2xl bg-blue-900 px-8 py-12 text-white">
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-center">
                <div>
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-yellow-400/10 px-4 py-1.5 border border-yellow-400/30">
                    <Shield className="h-4 w-4 text-yellow-400" />
                    <span className="text-caption font-semibold uppercase tracking-wider text-yellow-400">Military Families</span>
                  </div>
                  <h2 className="mb-4 font-heading text-heading-xl font-bold text-white">
                    PCS to San Antonio?
                  </h2>
                  <p className="mb-6 text-body text-white/70 leading-relaxed">
                    San Antonio is one of the most military-friendly cities in America, home to Joint Base
                    San Antonio — the largest joint base in the Department of Defense. We specialize in VA
                    loans, PCS timelines, and remote buying for deployed service members. Our lead agent is
                    a retired Army veteran who has been through the PCS process himself.
                  </p>
                  <ul className="mb-7 space-y-2">
                    {[
                      'VA loan specialists — zero down payment guidance',
                      'PCS timeline expertise — 30 to 90-day closings',
                      'Virtual tours and remote closings available',
                      'BAH optimization strategies',
                    ].map(item => (
                      <li key={item} className="flex items-center gap-2.5 text-body-sm text-white/70">
                        <CheckCircle className="h-4 w-4 shrink-0 text-yellow-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Button asChild>
                    <Link href="/military-homebuying">
                      Military & VA Home Buying Guide <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { value: '4', label: 'Major Installations' },
                    { value: '80,000+', label: 'Active-Duty Personnel' },
                    { value: '0%', label: 'VA Down Payment' },
                    { value: 'No PMI', label: 'VA Loan Advantage' },
                  ].map(({ value, label }) => (
                    <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-5 text-center">
                      <div className="font-heading text-display-sm font-bold text-yellow-400">{value}</div>
                      <div className="mt-1 text-caption text-white/60">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* Neighborhood Comparison Table */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Side-by-Side Comparison</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Compare Communities at a Glance
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body-lg text-foreground-muted">
                Every community in the greater San Antonio Hill Country corridor has its own personality, price
                point, and tradeoffs. Use this table to quickly identify which areas match your priorities.
              </p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
              <table className="w-full text-body-sm min-w-[700px]">
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="px-4 py-3 text-left font-semibold">Community</th>
                    <th className="px-4 py-3 text-left font-semibold">City</th>
                    <th className="px-4 py-3 text-left font-semibold text-[#C9A84C]">Price Range</th>
                    <th className="px-4 py-3 text-left font-semibold">School District</th>
                    <th className="px-4 py-3 text-left font-semibold">Drive to Downtown SA</th>
                    <th className="px-4 py-3 text-left font-semibold">Drive to Airport</th>
                    <th className="px-4 py-3 text-left font-semibold">Best For</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { community: 'Fair Oaks Ranch', city: 'Fair Oaks Ranch', price: '$450K–$2M+', school: 'Boerne ISD', downtown: '30 min', airport: '30 min', bestFor: 'Families, horse properties' },
                    { community: 'Boerne', city: 'Boerne', price: '$300K–$1.5M', school: 'Boerne ISD', downtown: '35 min', airport: '35 min', bestFor: 'Historic charm, retirees' },
                    { community: 'Helotes', city: 'Helotes', price: '$350K–$1M', school: 'Northside ISD', downtown: '20 min', airport: '25 min', bestFor: 'Near city, large lots' },
                    { community: 'Bulverde', city: 'Bulverde', price: '$350K–$1.1M', school: 'Comal ISD', downtown: '35 min', airport: '40 min', bestFor: 'Rural feel, newer builds' },
                    { community: 'Stone Oak (SA)', city: 'San Antonio', price: '$300K–$900K', school: 'NEISD', downtown: '25 min', airport: '20 min', bestFor: 'Walkable, city amenities' },
                    { community: 'New Braunfels', city: 'New Braunfels', price: '$280K–$800K', school: 'Comal ISD', downtown: '45 min', airport: '45 min', bestFor: 'Outdoor lifestyle, growth' },
                  ].map((row, i) => (
                    <tr key={row.community} className={i % 2 === 0 ? 'bg-white' : 'bg-background-cream/60'}>
                      <td className="px-4 py-3 font-semibold text-primary">{row.community}</td>
                      <td className="px-4 py-3 text-foreground-muted">{row.city}</td>
                      <td className="px-4 py-3 font-semibold text-[#C9A84C]">{row.price}</td>
                      <td className="px-4 py-3 text-foreground-muted">{row.school}</td>
                      <td className="px-4 py-3 text-foreground-muted">{row.downtown}</td>
                      <td className="px-4 py-3 text-foreground-muted">{row.airport}</td>
                      <td className="px-4 py-3 text-foreground-muted">{row.bestFor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-caption text-foreground-muted bg-background-cream border-t border-border">
                Drive times are estimates under typical daytime traffic conditions from each community to downtown San Antonio and San Antonio International Airport (SAT).
              </p>
            </div>
          </Container>
        </section>

        {/* Military Relocation */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">
              <div>
                <p className="overline mb-3 text-[#C9A84C]">Active-Duty &amp; Veterans</p>
                <h2 className="mb-6 font-heading text-display font-bold text-primary gold-line inline-block pb-4">
                  Military Relocation to San Antonio
                </h2>
                <div className="space-y-4 text-body text-foreground-muted leading-relaxed">
                  <p>
                    San Antonio is one of the most military-connected cities in the United States — and the
                    surrounding Hill Country is among the most popular destinations for service members and
                    their families choosing to put down permanent roots. Lackland AFB (JBSA-Lackland) is
                    approximately 15 minutes from Helotes, making communities like Helotes, Fair Oaks Ranch,
                    and Boerne particularly well-positioned for personnel stationed at that installation.
                    JBSA-Randolph, located east of the city, is most accessible from northeast San Antonio,
                    though many Randolph personnel choose the Hill Country for its schools and quality of life
                    and accept a somewhat longer commute.
                  </p>
                  <p>
                    Fair Oaks Realty Group includes VA loan specialists who have helped dozens of active-duty
                    buyers and veterans purchase homes using their VA loan benefit — with zero down payment,
                    no PMI, and competitive rates. We understand PCS timelines, can work with buyers who are
                    still deployed or stationed elsewhere, and have extensive experience with remote closings
                    and digital document workflows. Current BAH rates for the San Antonio area (E-7 with
                    dependents) typically support home purchases in the $350K–$500K range, covering a wide
                    selection of inventory in Helotes, Boerne, and Bulverde.
                  </p>
                </div>
                <div className="mt-6">
                  <Button asChild>
                    <Link href="/military-homebuying">
                      Military &amp; VA Home Buying Guide <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'JBSA-Lackland', detail: '~15 min from Helotes' },
                  { label: 'JBSA-Randolph', detail: '~35 min from Fair Oaks Ranch' },
                  { label: 'VA Loan Benefit', detail: '0% down, no PMI' },
                  { label: 'BAH Coverage', detail: 'Covers $350K–$500K range' },
                ].map(({ label, detail }) => (
                  <div key={label} className="rounded-xl border border-border bg-white p-5 text-center shadow-sm">
                    <div className="font-heading text-body font-bold text-primary mb-1">{label}</div>
                    <div className="text-body-sm text-[#C9A84C] font-semibold">{detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* Cost of Living Comparison (expanded) */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Texas vs. Other Major Metros</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Cost of Living: Texas in Context
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <div className="space-y-4 text-body text-foreground-muted leading-relaxed">
                <p>
                  Texas has no state income tax — a fact that immediately improves take-home pay for anyone
                  relocating from California, Illinois, New York, or other high-tax states. For a household
                  earning $150,000, the difference can exceed $10,000 annually. That savings, compounded over
                  a decade, represents meaningful wealth accumulation that cost-of-living comparisons often
                  understate.
                </p>
                <p>
                  Property taxes in Texas are higher than the national average — effective rates in Kendall
                  and Bexar counties typically run between 1.6% and 2.2% of assessed value. On a $600,000
                  home, that translates to approximately $9,600–$13,200 per year. For buyers coming from low
                  property-tax states, this can be a surprise — but the income tax savings typically more
                  than offset it for most earning profiles.
                </p>
                <p>
                  Compared to other major Texas metros, San Antonio and the Hill Country offer favorable
                  home prices. Austin median home prices remain substantially higher — often $100,000–$200,000
                  more for comparable properties and school districts. Dallas and Houston are more comparable
                  in price, but San Antonio&apos;s Hill Country lifestyle is broadly considered a differentiator.
                  For buyers who can work remotely or who are relocating for employment in San Antonio,
                  the value proposition is strong.
                </p>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'State Income Tax', sa: 'None', austin: 'None', dallas: 'None', california: '~9.3%' },
                  { label: 'Effective Property Tax Rate', sa: '1.6–2.2%', austin: '1.8–2.4%', dallas: '1.9–2.3%', california: '~0.7%' },
                  { label: 'Median Home Price', sa: '~$320K', austin: '~$500K', dallas: '~$390K', california: '~$700K+' },
                ].map(({ label, sa, austin, dallas, california }) => (
                  <div key={label} className="rounded-xl border border-border bg-background-cream p-5">
                    <div className="font-heading text-body-sm font-bold text-primary mb-3">{label}</div>
                    <div className="grid grid-cols-4 gap-2 text-caption">
                      <div className="text-center">
                        <div className="font-semibold text-[#C9A84C]">{sa}</div>
                        <div className="text-foreground-muted">San Antonio</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-foreground-muted">{austin}</div>
                        <div className="text-foreground-muted">Austin</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-foreground-muted">{dallas}</div>
                        <div className="text-foreground-muted">Dallas</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-foreground-muted">{california}</div>
                        <div className="text-foreground-muted">California</div>
                      </div>
                    </div>
                  </div>
                ))}
                <p className="text-caption text-foreground-muted">Data is approximate. Consult a financial advisor for personalized analysis.</p>
              </div>
            </div>
          </Container>
        </section>

        {/* Climate & Lifestyle */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-[#C9A84C]">Year-Round Living</p>
                <h2 className="mb-6 font-heading text-display font-bold text-primary gold-line inline-block pb-4">
                  Climate &amp; Lifestyle
                </h2>
                <div className="space-y-4 text-body text-foreground-muted leading-relaxed">
                  <p>
                    The Texas Hill Country enjoys a semi-arid subtropical climate — long, warm summers with
                    stretches of sunshine, mild winters that rarely see extended freezes, and spectacular spring
                    and fall seasons that locals describe as the best weather in the country. Summer temperatures
                    average in the low-to-mid 90s, with evening breezes off the hills offering relief. Winters
                    are mild, with average lows in the 40s and only occasional cold snaps. The region averages
                    roughly 220 sunny days per year — significantly more than the national average.
                  </p>
                  <p>
                    Outdoor recreation is a daily reality, not a weekend luxury. The Guadalupe River — just 30
                    to 45 minutes from Fair Oaks Ranch — is one of the premier tubing and kayaking rivers in
                    Texas, particularly popular from spring through fall. Enchanted Rock State Natural Area and
                    Pedernales Falls State Park offer world-class hiking within 90 minutes. Closer to home,
                    Cibolo Nature Center in Boerne, Government Canyon State Natural Area, and the Hill Country
                    State Natural Area provide accessible outdoor escapes year-round.
                  </p>
                  <p>
                    San Antonio&apos;s cultural amenities complement the Hill Country lifestyle seamlessly. The
                    famed River Walk, The Pearl District, world-class museums including the San Antonio Museum
                    of Art and the McNay, live music venues, and a thriving restaurant scene are all within
                    20–35 minutes of most Hill Country communities. Professional sports — the San Antonio Spurs
                    (NBA) and the San Antonio FC (soccer) — add another dimension to the city&apos;s lifestyle
                    appeal. For buyers who want the quiet of the Hill Country without giving up city-level
                    culture and entertainment, the San Antonio metro delivers both.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { title: 'Guadalupe River', detail: '30–45 min · Tubing & kayaking' },
                  { title: 'Enchanted Rock', detail: '~90 min · Rock climbing & hiking' },
                  { title: 'San Antonio Riverwalk', detail: '~30 min · Dining & culture' },
                  { title: 'Cibolo Nature Center', detail: '~5 min from Boerne · Hiking' },
                  { title: 'San Antonio Spurs', detail: '~30 min · NBA basketball' },
                  { title: 'The Pearl District', detail: '~25 min · Food & nightlife' },
                ].map(({ title, detail }) => (
                  <div key={title} className="rounded-xl border border-border bg-white p-4 shadow-sm">
                    <div className="font-heading text-body-sm font-bold text-primary mb-1">{title}</div>
                    <div className="text-caption text-[#C9A84C]">{detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* FAQ */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">For Relocating Buyers</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Relocation FAQs
              </h2>
            </div>
            <div className="mx-auto max-w-3xl space-y-4">
              {FAQS.map(({ q, a }) => (
                <details key={q} className="group rounded-2xl border border-border bg-background-cream shadow-sm overflow-hidden">
                  <summary className="flex cursor-pointer items-start justify-between gap-4 px-6 py-5 font-heading text-heading-sm font-semibold text-primary list-none">
                    <span>{q}</span>
                    <span className="mt-0.5 shrink-0 text-[#C9A84C] group-open:rotate-45 transition-transform duration-200 text-xl leading-none">+</span>
                  </summary>
                  <div className="border-t border-border px-6 pb-6 pt-4 bg-white">
                    <p className="text-body text-foreground-muted leading-relaxed">{a}</p>
                  </div>
                </details>
              ))}
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-[#C9A84C]">Free. No Obligation.</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Schedule Your Relocation Consultation
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Moving to the Texas Hill Country is a big decision. A 30-minute call with one of our local
                experts will save you weeks of research. We&apos;ll cover neighborhoods, schools, commutes,
                budget, and timeline — completely free.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?service=relocation">Book a Free Consultation</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings">
                    Browse All Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-6 text-body-sm text-white/50">
                <a href="tel:+12103909997" className="flex items-center gap-2 hover:text-white transition-colors">
                  <Phone className="h-4 w-4" /> (210) 390-9997
                </a>
                <span className="hidden sm:block">|</span>
                <Link href="/schools" className="flex items-center gap-2 hover:text-white transition-colors">
                  <School className="h-4 w-4" /> School District Guide
                </Link>
                <span className="hidden sm:block">|</span>
                <Link href="/military-homebuying" className="flex items-center gap-2 hover:text-white transition-colors">
                  <Shield className="h-4 w-4" /> Military VA Guide
                </Link>
              </div>
            </div>
          </Container>
        </section>

      </main>
      <Footer />
    </>
  );
}
