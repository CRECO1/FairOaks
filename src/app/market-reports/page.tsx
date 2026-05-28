import type { Metadata } from 'next';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Home, BarChart2, ArrowRight, FileText, CalendarDays } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { RevealOnScroll } from '@/hooks/useScrollReveal';

export const metadata: Metadata = {
  title: 'Hill Country Real Estate Market Report Q1 2025 | Fair Oaks Realty Group',
  description:
    'Q1 2025 market update for Fair Oaks Ranch, Boerne, and Greater San Antonio. Median sale prices, days on market, neighborhood breakdowns, and expert analysis from Fair Oaks Realty Group.',
  alternates: {
    canonical: '/market-reports',
  },
  openGraph: {
    title: 'Hill Country Real Estate Market Report Q1 2025 | Fair Oaks Realty Group',
    description:
      'Q1 2025 Hill Country market stats: median prices, inventory trends, and neighborhood breakdowns for Fair Oaks Ranch, Boerne, Cordillera Ranch, and surrounding areas.',
    url: 'https://www.fairoaksrealtygroup.com/market-reports',
    type: 'website',
  },
};

const KEY_STATS = [
  {
    label: 'Median Sale Price',
    value: '$625,000',
    change: '+4.2% YoY',
    trend: 'up',
    icon: Home,
  },
  {
    label: 'Avg Days on Market',
    value: '34 days',
    change: '-8 days YoY',
    trend: 'down-good',
    icon: CalendarDays,
  },
  {
    label: 'Homes Sold (Q1 2025)',
    value: '847 units',
    change: 'Q1 2025',
    trend: 'neutral',
    icon: BarChart2,
  },
  {
    label: 'List-to-Sale Ratio',
    value: '98.6%',
    change: 'Seller-favored market',
    trend: 'up',
    icon: TrendingUp,
  },
];

const NEIGHBORHOOD_DATA = [
  { name: 'Fair Oaks Ranch', medianPrice: '$680,000', avgDOM: '28 days', yoyChange: '+5.1%', trend: 'up' },
  { name: 'Boerne', medianPrice: '$575,000', avgDOM: '38 days', yoyChange: '+3.8%', trend: 'up' },
  { name: 'The Dominion', medianPrice: '$1,200,000', avgDOM: '45 days', yoyChange: '+2.1%', trend: 'up' },
  { name: 'Cordillera Ranch', medianPrice: '$950,000', avgDOM: '32 days', yoyChange: '+6.3%', trend: 'up' },
  { name: 'Helotes', medianPrice: '$485,000', avgDOM: '31 days', yoyChange: '+4.7%', trend: 'up' },
  { name: 'Bulverde', medianPrice: '$445,000', avgDOM: '42 days', yoyChange: '+3.2%', trend: 'up' },
];

const PAST_REPORTS = [
  { label: 'Q4 2024 Market Report', period: 'October – December 2024', href: '#' },
  { label: 'Q3 2024 Market Report', period: 'July – September 2024', href: '#' },
  { label: 'Q2 2024 Market Report', period: 'April – June 2024', href: '#' },
  { label: 'Q1 2024 Market Report', period: 'January – March 2024', href: '#' },
  { label: 'Year-End 2023 Market Report', period: 'Full Year 2023 Annual Summary', href: '#' },
];

export default function MarketReportsPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">

        {/* ── Hero ──────────────────────────────────────────────────── */}
        <section className="bg-primary text-white py-20 md:py-28 lg:py-32">
          <Container>
            <RevealOnScroll>
              <p className="overline mb-3 text-gold">Market Intelligence</p>
              <h1 className="font-heading text-display-sm font-bold text-white max-w-3xl mb-5">
                Hill Country Real Estate{' '}
                <span className="text-gradient-gold">Market Report</span>
              </h1>
              <p className="text-body-lg text-white/70 max-w-2xl">
                Q1 2025 Market Update &mdash; Fair Oaks Ranch, Boerne &amp; Greater San Antonio
              </p>
              <div className="mt-6 flex items-center gap-3 text-body-sm text-white/50">
                <CalendarDays className="h-4 w-4 text-gold/70" />
                <span>Data reflects January – March 2025 &bull; Updated April 2025</span>
              </div>
            </RevealOnScroll>
          </Container>
        </section>

        {/* ── Key Stats Row ─────────────────────────────────────────── */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <RevealOnScroll>
              <div className="mb-12 text-center">
                <p className="overline mb-3">Q1 2025 Snapshot</p>
                <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                  Key Market Statistics
                </h2>
              </div>
            </RevealOnScroll>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {KEY_STATS.map(({ label, value, change, trend, icon: Icon }, i) => (
                <RevealOnScroll key={label} delay={i * 80}>
                  <div className="card-luxury p-6 text-center">
                    <Icon className="mx-auto mb-4 h-8 w-8 text-gold" />
                    <div className="font-heading text-display-sm font-bold text-primary mb-1">
                      {value}
                    </div>
                    <div className="text-caption uppercase tracking-wider text-foreground-muted mb-3">
                      {label}
                    </div>
                    <span
                      className={[
                        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-caption font-semibold',
                        trend === 'up' ? 'bg-green-50 text-green-700' : '',
                        trend === 'down-good' ? 'bg-blue-50 text-blue-700' : '',
                        trend === 'neutral' ? 'bg-background-warm text-foreground-muted' : '',
                      ].join(' ')}
                    >
                      {trend === 'up' && <TrendingUp className="h-3 w-3" />}
                      {trend === 'down-good' && <TrendingDown className="h-3 w-3" />}
                      {change}
                    </span>
                  </div>
                </RevealOnScroll>
              ))}
            </div>
          </Container>
        </section>

        {/* ── Market Trend Section ──────────────────────────────────── */}
        <section className="section-luxury bg-white">
          <Container>
            <RevealOnScroll>
              <div className="mb-14 text-center">
                <p className="overline mb-3">Analysis</p>
                <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                  Market Conditions
                </h2>
              </div>
            </RevealOnScroll>

            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">

              {/* Left: Seller's Market */}
              <RevealOnScroll direction="left">
                <div className="rounded-2xl bg-primary text-white p-8 h-full">
                  <p className="overline mb-3 text-gold">Current Climate</p>
                  <h3 className="font-heading text-heading-xl font-bold mb-4">
                    Seller&rsquo;s Market Conditions
                  </h3>
                  <p className="text-body text-white/75 mb-6">
                    The Texas Hill Country continues to operate as a strong seller&rsquo;s market in
                    Q1 2025. Limited housing inventory — currently running approximately 1.8 months
                    of supply — combined with consistent demand from San Antonio metro relocations
                    and remote workers has kept upward pressure on home prices across all price tiers.
                  </p>
                  <p className="text-body text-white/75">
                    New construction in Boerne, Bulverde, and Helotes has added some relief, but
                    resale inventory in established subdivisions like Fair Oaks Ranch and Cordillera
                    Ranch remains exceptionally tight, fueling competitive offers and above-list-price
                    closings.
                  </p>
                </div>
              </RevealOnScroll>

              {/* Right: Buyer & Seller Implications */}
              <RevealOnScroll direction="right">
                <div className="space-y-6">

                  {/* Buyers */}
                  <div className="rounded-2xl border border-border bg-background-cream p-7">
                    <h3 className="font-heading text-heading font-bold text-primary mb-4 flex items-center gap-2">
                      <span className="h-8 w-8 rounded-full bg-gold flex items-center justify-center shrink-0">
                        <Home className="h-4 w-4 text-primary" />
                      </span>
                      What This Means for Buyers
                    </h3>
                    <ul className="space-y-3">
                      {[
                        'Get pre-approved before touring — competitive offers require proof of financing up front.',
                        'Expect limited negotiation room on well-priced homes; days-on-market under 30 often attract multiple offers.',
                        'New construction in Boerne and Bulverde may offer more flexibility on price and upgrades.',
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-3 text-body-sm text-foreground-muted">
                          <span className="mt-1 h-5 w-5 rounded-full bg-gold/20 flex items-center justify-center shrink-0 text-caption font-bold text-gold">{i + 1}</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Sellers */}
                  <div className="rounded-2xl border border-border bg-background-cream p-7">
                    <h3 className="font-heading text-heading font-bold text-primary mb-4 flex items-center gap-2">
                      <span className="h-8 w-8 rounded-full bg-gold flex items-center justify-center shrink-0">
                        <TrendingUp className="h-4 w-4 text-primary" />
                      </span>
                      What This Means for Sellers
                    </h3>
                    <ul className="space-y-3">
                      {[
                        'Properly staged and priced homes in Fair Oaks Ranch and Boerne are closing at or above list price.',
                        'Spring 2025 inventory remains historically low — listing now positions you ahead of summer competition.',
                        'Homes with Hill Country views, updated kitchens, and pool/outdoor living command the strongest premiums.',
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-3 text-body-sm text-foreground-muted">
                          <span className="mt-1 h-5 w-5 rounded-full bg-gold/20 flex items-center justify-center shrink-0 text-caption font-bold text-gold">{i + 1}</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </RevealOnScroll>
            </div>
          </Container>
        </section>

        {/* ── Neighborhood Breakdown Table ──────────────────────────── */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <RevealOnScroll>
              <div className="mb-12 text-center">
                <p className="overline mb-3">By Neighborhood</p>
                <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                  Neighborhood Breakdown
                </h2>
                <p className="mx-auto mt-6 max-w-xl text-body text-foreground-muted">
                  Q1 2025 median sale prices and average days on market across key Hill Country communities.
                </p>
              </div>
            </RevealOnScroll>

            <RevealOnScroll>
              <div className="overflow-hidden rounded-2xl border border-border shadow-card">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-primary text-white">
                      <th className="px-5 py-4 font-semibold text-body-sm">Neighborhood</th>
                      <th className="px-5 py-4 font-semibold text-body-sm text-right">Median Price</th>
                      <th className="px-5 py-4 font-semibold text-body-sm text-right hidden sm:table-cell">Avg DOM</th>
                      <th className="px-5 py-4 font-semibold text-body-sm text-right">YoY Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {NEIGHBORHOOD_DATA.map(({ name, medianPrice, avgDOM, yoyChange }, i) => (
                      <tr
                        key={name}
                        className={[
                          'border-t border-border transition-colors hover:bg-background-warm',
                          i % 2 === 0 ? 'bg-white' : 'bg-background-cream/50',
                        ].join(' ')}
                      >
                        <td className="px-5 py-4 font-semibold text-primary text-body-sm">{name}</td>
                        <td className="px-5 py-4 text-right font-heading font-bold text-primary text-body-sm">
                          {medianPrice}
                        </td>
                        <td className="px-5 py-4 text-right text-foreground-muted text-body-sm hidden sm:table-cell">
                          {avgDOM}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-caption font-semibold text-green-700">
                            <TrendingUp className="h-3 w-3" />
                            {yoyChange}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-caption text-foreground-subtle text-center">
                Source: SABOR MLS data, Q1 2025 (Jan–Mar). Fair Oaks Realty Group internal analysis.
              </p>
            </RevealOnScroll>
          </Container>
        </section>

        {/* ── CTA Section ──────────────────────────────────────────── */}
        <section className="section-luxury bg-primary text-white">
          <Container>
            <div className="mx-auto max-w-2xl text-center">
              <RevealOnScroll>
                <p className="overline mb-3 text-gold">Free &amp; No Obligation</p>
                <h2 className="font-heading text-display-sm font-bold text-white mb-4">
                  Want a Personalized Home Valuation?
                </h2>
                <p className="text-body-lg text-white/70 mb-8">
                  Get your free, hyper-local market report. We&rsquo;ll analyze recent comparable
                  sales in your specific neighborhood and get back to you within one business day.
                </p>
                <Button size="lg" asChild>
                  <Link href="/contact">
                    Get My Free Report <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              </RevealOnScroll>
            </div>
          </Container>
        </section>

        {/* ── Past Reports Archive ──────────────────────────────────── */}
        <section className="section-compact bg-white">
          <Container>
            <RevealOnScroll>
              <div className="mb-10 text-center">
                <p className="overline mb-3">Report Archive</p>
                <h2 className="font-heading text-display-xs font-bold text-primary">
                  Past Market Reports
                </h2>
              </div>
            </RevealOnScroll>
            <RevealOnScroll>
              <div className="mx-auto max-w-2xl divide-y divide-border rounded-2xl border border-border overflow-hidden">
                {PAST_REPORTS.map(({ label, period, href }) => (
                  <a
                    key={label}
                    href={href}
                    className="flex items-center justify-between gap-4 px-6 py-4 bg-white hover:bg-background-cream transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-gold shrink-0" />
                      <div>
                        <p className="text-body-sm font-semibold text-primary group-hover:text-gold transition-colors">
                          {label}
                        </p>
                        <p className="text-caption text-foreground-muted">{period}</p>
                      </div>
                    </div>
                    <span className="text-caption font-semibold text-gold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                      PDF →
                    </span>
                  </a>
                ))}
              </div>
            </RevealOnScroll>
          </Container>
        </section>

      </main>
      <Footer />
    </>
  );
}
