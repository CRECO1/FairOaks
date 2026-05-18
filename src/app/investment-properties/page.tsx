export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, TrendingUp, CheckCircle,
  ArrowRight, Phone, Star, BarChart2, Users,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/investment-properties`;

export const metadata: Metadata = {
  title: 'Investment Properties in San Antonio & Texas Hill Country | Fair Oaks Realty Group',
  description:
    'Find investment properties in San Antonio, Fair Oaks Ranch, Boerne, and the Texas Hill Country. Rental homes, fix-and-flip opportunities, and long-term real estate investment strategies. Expert local guidance.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'Investment Properties in San Antonio & Texas Hill Country | Fair Oaks Realty Group',
    description:
      'Find investment properties in San Antonio, Fair Oaks Ranch, Boerne, and the Texas Hill Country. Rental homes, fix-and-flip opportunities, and long-term real estate investment strategies.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Investment Properties — San Antonio & Texas Hill Country' }],
  },
  twitter: { card: 'summary_large_image' },
  keywords: [
    'investment properties san antonio',
    'rental homes san antonio tx',
    'real estate investment texas hill country',
    'buy rental property san antonio',
    'investment homes fair oaks ranch',
    'real estate roi san antonio',
    'fix and flip san antonio',
    'rental property boerne tx',
    'cash flow real estate texas',
    'real estate investor san antonio',
  ],
};

const WHY_SA = [
  { icon: TrendingUp, stat: '2.6M+', label: 'Metro Population', desc: 'San Antonio is the 7th-largest city in the US and one of the fastest-growing metros in the country — adding tens of thousands of new residents each year.' },
  { icon: Users, stat: '100K+', label: 'Military Personnel', desc: 'Joint Base San Antonio generates a massive permanent renter base — military families on 2–3 year rotations who are well-qualified and motivated tenants.' },
  { icon: DollarSign, stat: 'No State Tax', label: 'Texas Tax Advantage', desc: 'Texas levies no state income tax, which meaningfully improves investor cash-on-cash returns compared to most other major metros in the country.' },
  { icon: BarChart2, stat: 'Top 5', label: 'Job Growth Markets', desc: 'Toyota, USAA, Valero, CPS Energy, and BAMC anchor a diverse, recession-resistant economy that supports sustained rental demand and property appreciation.' },
];

const INVESTMENT_TYPES = [
  {
    icon: Home,
    title: 'Long-Term Rental',
    subtitle: 'Buy & Hold',
    desc: 'Purchase single-family or small multifamily properties and lease them to qualified long-term tenants. The San Antonio metro\'s rental vacancy rate consistently runs below the national average, supported by the large military and university population. Cash flow positive acquisitions remain achievable at the right price points.',
    tags: ['Steady monthly income', 'Appreciation upside', 'Military/JBSA demand', 'Low vacancy risk'],
  },
  {
    icon: MapPin,
    title: 'Short-Term / Vacation Rental',
    subtitle: 'Canyon Lake & Hill Country',
    desc: 'Canyon Lake, New Braunfels, and the Guadalupe River corridor attract millions of Texas tourists annually. Short-term vacation rentals in these markets can generate 2–3x the annual income of a traditional long-term lease, with strong occupancy from spring through fall and solid shoulder-season demand.',
    tags: ['Higher nightly rates', 'Canyon Lake demand', 'Seasonal flexibility', 'Guadalupe River corridor'],
  },
  {
    icon: TrendingUp,
    title: 'Fix-and-Flip',
    subtitle: 'Value-Add & Resell',
    desc: 'San Antonio\'s aging inner-ring suburbs and rapidly appreciating northwest corridors offer value-add opportunities for experienced investors. Identify under-improved properties, execute targeted renovations, and capitalize on neighborhood appreciation. Our agents can identify candidate properties and connect you with local contractors.',
    tags: ['Short hold period', 'Forced appreciation', 'NW growth corridors', 'Contractor referrals'],
  },
];

const MARKET_STATS = [
  { label: 'Avg. Cap Rate (SFR Rental)', value: '4% – 6%', note: 'Single-family residential, metro average' },
  { label: 'Avg. Days on Market', value: '35 – 55 days', note: 'Varies by price point and submarket' },
  { label: '5-Year Appreciation Rate', value: '35% – 50%', note: 'San Antonio metro, 2019–2024 (select corridors higher)' },
  { label: 'Rental Vacancy Rate', value: '~4% – 5%', note: 'Below US national average of ~6%' },
];

const AREAS_TABLE = [
  { area: 'Helotes', avgPrice: '$380K–$520K', avgRent: '$1,900–$2,400/mo', capRate: '4.5%–5.5%', note: 'Strong Northside ISD schools, stable demand' },
  { area: 'San Antonio NW (Loop 1604)', avgPrice: '$280K–$420K', avgRent: '$1,600–$2,200/mo', capRate: '5.0%–6.5%', note: 'Best value-for-cash-flow in metro' },
  { area: 'New Braunfels', avgPrice: '$340K–$480K', avgRent: '$1,800–$2,400/mo', capRate: '4.5%–5.5%', note: 'Fastest-growing Texas city, Comal ISD' },
  { area: 'Canyon Lake (Vacation)', avgPrice: '$380K–$600K', avgRent: '$250–$450/night', capRate: '6%–9%*', note: '*STR gross yield; net varies by mgmt costs' },
  { area: 'Bulverde / Spring Branch', avgPrice: '$360K–$500K', avgRent: '$1,900–$2,500/mo', capRate: '4.5%–5.5%', note: 'Emerging growth corridor, Comal ISD' },
];

const AGENT_SERVICES = [
  'Off-market and distressed property identification',
  'Comparable rental analysis and cash flow modeling',
  'Connections to investor-friendly lenders and DSCR loans',
  'Trusted contractor and property manager referrals',
  ' 1031 exchange coordination and strategic guidance',
  'VA investment strategies for active-duty and retired military',
];

const FAQS = [
  {
    q: 'Is San Antonio a good real estate investment market?',
    a: 'Yes — consistently. San Antonio benefits from a uniquely diversified economy (military, healthcare, manufacturing, tourism), strong population growth, no state income tax, relatively affordable home prices compared to other major Texas metros, and a large permanent renter base from JBSA military personnel. The metro has seen strong appreciation over the past decade while maintaining cash flow potential that markets like Austin and Dallas have largely lost.',
  },
  {
    q: 'What types of investment properties are available in the Hill Country?',
    a: 'The Texas Hill Country offers several compelling investment niches. Long-term single-family rentals in Boerne, Helotes, and Bulverde serve the growing suburban market. Short-term vacation rentals along the Guadalupe River, Canyon Lake, and in Wimberley can generate significant premium income. There are also value-add opportunities in established neighborhoods throughout the northwest San Antonio corridor.',
  },
  {
    q: 'What is a DSCR loan and how does it help investors?',
    a: 'A DSCR (Debt Service Coverage Ratio) loan qualifies borrowers based on the rental income the property generates — not the investor\'s personal income or employment. This makes it an ideal financing vehicle for investors with multiple properties, self-employed buyers, or those who don\'t want to use their personal income documentation. DSCR loans are widely available for San Antonio investment properties and we can connect you with lenders who specialize in them.',
  },
  {
    q: 'Can I use a VA loan to buy investment property?',
    a: 'The VA loan is a primary residence benefit — you cannot use it to purchase a pure investment property. However, military buyers can use a VA loan to purchase a small multifamily property (up to 4 units) if they occupy one of the units as their primary residence. This is an excellent strategy for building long-term wealth while serving. Our VA specialist David Reyes can walk you through the details.',
  },
  {
    q: 'How do I get started finding investment properties in San Antonio?',
    a: 'The best first step is a consultation with one of our investment-experienced agents. We will review your goals (cash flow vs. appreciation, short-term vs. long-term hold, budget, and location preferences), run a quick cash flow analysis on properties matching your criteria, and put together a curated list of candidates — including any off-market opportunities we are aware of. There is no obligation and no cost for this initial call.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Investment Properties', item: CANONICAL },
      ],
    },
    {
      '@type': 'LocalBusiness',
      '@id': `${BASE_URL}/#business`,
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
        'Investment property specialists serving San Antonio, Fair Oaks Ranch, Boerne, and the Texas Hill Country.',
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQS.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
};

export default function InvestmentPropertiesPage() {
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
              <span className="text-primary font-medium">Investment Properties</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <TrendingUp className="mr-1 inline h-3 w-3" />
                Real Estate Investment
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Investment Properties in San Antonio<br />
                &amp; the Texas Hill Country
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                One of Texas&apos;s fastest-growing markets. No state income tax. A permanent renter base of
                100,000+ military personnel. Strong fundamentals and expert local guidance — this is where
                smart investors are putting capital to work.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/contact?service=investment">Schedule Investment Consultation</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Why San Antonio */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-[#C9A84C]">The Market Opportunity</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Why San Antonio for Real Estate Investment
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                San Antonio offers a rare combination of growth fundamentals, affordability, and built-in
                rental demand that few US metros can match — especially for investors priced out of Austin
                or Dallas.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {WHY_SA.map(({ icon: Icon, stat, label, desc }) => (
                <div key={label} className="rounded-2xl border border-border bg-white p-6 shadow-sm text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#C9A84C]/10">
                    <Icon className="h-6 w-6 text-[#C9A84C]" />
                  </div>
                  <div className="font-heading text-display-sm font-bold text-primary mb-1">{stat}</div>
                  <div className="font-semibold text-body-sm text-[#C9A84C] mb-3">{label}</div>
                  <p className="text-caption text-foreground-muted leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Types of Investment Properties */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">Investment Strategies</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Types of Investment Properties
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              {INVESTMENT_TYPES.map(({ icon: Icon, title, subtitle, desc, tags }) => (
                <div key={title} className="rounded-2xl border border-border bg-background-cream p-7 flex flex-col">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#C9A84C]/10 mb-4">
                    <Icon className="h-6 w-6 text-[#C9A84C]" />
                  </div>
                  <div className="mb-1 text-caption font-semibold uppercase tracking-wider text-[#C9A84C]">{subtitle}</div>
                  <h3 className="mb-3 font-heading text-heading font-bold text-primary">{title}</h3>
                  <p className="mb-5 text-body-sm text-foreground-muted leading-relaxed flex-1">{desc}</p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map(tag => (
                      <span key={tag} className="rounded-full border border-border bg-white px-3 py-1 text-caption text-foreground-muted">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Market Stats */}
        <section className="section-compact bg-primary text-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Data-Driven Investing</p>
              <h2 className="font-heading text-display-sm font-bold text-white">
                Market Stats for Investors
              </h2>
              <p className="mt-4 mx-auto max-w-xl text-body text-white/60">
                Key metrics for the San Antonio metro real estate investment market. Ranges reflect
                variation across submarkets and property types.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {MARKET_STATS.map(({ label, value, note }) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
                  <div className="font-heading text-display-sm font-bold text-[#C9A84C] mb-2">{value}</div>
                  <div className="font-semibold text-body-sm text-white mb-2">{label}</div>
                  <p className="text-caption text-white/40">{note}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-caption text-white/40">
              All figures are estimates based on recent market data. Individual properties will vary. Consult with our agents for property-specific analysis.
            </p>
          </Container>
        </section>

        {/* Best Areas Table */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Where to Invest</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Best Areas for Investment
              </h2>
              <p className="mt-6 mx-auto max-w-xl text-body text-foreground-muted">
                A quick-reference guide to investment potential across the San Antonio metro and Hill Country region.
              </p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="px-5 py-4 text-left font-semibold">Area</th>
                    <th className="px-5 py-4 text-left font-semibold">Avg. Buy Price</th>
                    <th className="px-5 py-4 text-left font-semibold">Avg. Rent / Rate</th>
                    <th className="px-5 py-4 text-left font-semibold">Est. Cap Rate</th>
                    <th className="px-5 py-4 text-left font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {AREAS_TABLE.map((row, i) => (
                    <tr key={row.area} className={i % 2 === 0 ? 'bg-white' : 'bg-background-cream'}>
                      <td className="px-5 py-4 font-semibold text-primary">{row.area}</td>
                      <td className="px-5 py-4 text-foreground-muted">{row.avgPrice}</td>
                      <td className="px-5 py-4 font-semibold text-[#C9A84C]">{row.avgRent}</td>
                      <td className="px-5 py-4 font-semibold text-primary">{row.capRate}</td>
                      <td className="px-5 py-4 text-caption text-foreground-muted">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-caption text-foreground-muted">
              * Canyon Lake cap rate reflects short-term rental gross yield. Net yield after management fees and expenses typically ranges 4%–7%. All figures are estimates; market conditions change.
            </p>
          </Container>
        </section>

        {/* Agent Value Prop */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-[#C9A84C]">Investment-Savvy Agents</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Work With an Agent Who Thinks Like an Investor
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  Most real estate agents are trained to help primary-residence buyers. Investment
                  real estate requires a different skill set — cash flow analysis, rental market knowledge,
                  renovation cost estimation, and an understanding of financing vehicles like DSCR loans
                  and 1031 exchanges. Our team has that background, and we apply it to every investor client.
                </p>
                <p className="mb-7 text-body text-foreground-muted leading-relaxed">
                  David Reyes is our dedicated VA and investment property specialist — a retired U.S. Army
                  veteran with deep knowledge of the JBSA rental market, military-relocation tenant dynamics,
                  and VA multifamily strategies. Whether you&apos;re a first-time investor or a seasoned portfolio
                  builder, David brings the analytical rigor and local relationships your investment deserves.
                </p>
                <ul className="mb-8 space-y-3">
                  {AGENT_SERVICES.map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-body-sm text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A84C]" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button size="lg" asChild>
                  <Link href="/contact?service=investment">
                    Schedule Investment Consultation <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="rounded-2xl bg-primary p-8 sm:p-10 text-white">
                <Star className="mb-4 h-9 w-9 text-[#C9A84C]" />
                <h3 className="mb-3 font-heading text-heading-xl font-bold text-white">
                  David Reyes — VA &amp; Investment Specialist
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  Retired U.S. Army veteran. Licensed Texas REALTOR® with 7+ years of experience in
                  Hill Country investment real estate. David has personally guided investors through
                  single-family rentals, small multifamily acquisitions, and VA house-hacking strategies.
                </p>
                <ul className="mb-6 space-y-2">
                  {[
                    'DSCR and investor loan specialist connections',
                    'Cash flow modeling for every candidate property',
                    'JBSA rental market expertise — landlord and tenant',
                    'Virtual consultations available for out-of-state investors',
                    'No cost, no obligation initial consultation',
                  ].map(item => (
                    <li key={item} className="flex items-center gap-2 text-body-sm text-white/70">
                      <CheckCircle className="h-4 w-4 shrink-0 text-[#C9A84C]" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button size="lg" fullWidth asChild>
                  <Link href="/contact?service=investment&agent=david">
                    Talk to David Reyes
                  </Link>
                </Button>
                <a
                  href="tel:+12103909997"
                  className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-white/20 px-6 py-3 text-body-sm font-semibold text-white hover:bg-white/10 transition-colors"
                >
                  <Phone className="h-4 w-4" /> (210) 390-9997
                </a>
              </div>
            </div>
          </Container>
        </section>

        {/* FAQ */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">Common Questions</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Investment Property FAQ
              </h2>
            </div>
            <div className="mx-auto max-w-3xl space-y-4">
              {FAQS.map(({ q, a }) => (
                <details
                  key={q}
                  className="group rounded-2xl border border-border bg-white shadow-sm overflow-hidden"
                >
                  <summary className="flex cursor-pointer items-start justify-between gap-4 px-6 py-5 font-heading text-heading-sm font-semibold text-primary list-none">
                    <span>{q}</span>
                    <span className="mt-0.5 shrink-0 text-[#C9A84C] group-open:rotate-45 transition-transform duration-200 text-xl leading-none">+</span>
                  </summary>
                  <div className="border-t border-border px-6 pb-6 pt-4">
                    <p className="text-body text-foreground-muted leading-relaxed">{a}</p>
                  </div>
                </details>
              ))}
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-[#C9A84C]">No Cost. No Obligation.</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Schedule Your Investment Consultation
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Thirty minutes with an investment-experienced agent can save you months of guesswork.
                Let&apos;s review your goals, budget, and timeline — and identify the right opportunities in
                one of Texas&apos;s best investment markets.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?service=investment">
                    Schedule Free Consultation <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997">
                    <Phone className="mr-2 h-4 w-4" />(210) 390-9997
                  </a>
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
