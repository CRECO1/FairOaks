import type { Metadata } from 'next';
import Link from 'next/link';
import { Home, Tag, CalendarDays, FileSignature, Ruler, TrendingDown, ArrowRight, Mail } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { MarketReportSignup } from '@/components/sections/MarketReportSignup';
import { BrokerTrustCard } from '@/components/sections/BrokerTrustCard';
import { getMarketSnapshot, marketStory, MIN_SAMPLE, type AreaStats } from '@/lib/market-snapshot';

// Every figure on this page is computed from the live SABOR MLS feed at render time
// (lib/market-snapshot.ts) and refreshed every six hours — nothing is typed in. If the
// feed can't be reached on a render, the previous good page keeps being served; a
// first render with no data shows no figures at all rather than placeholders.
export const revalidate = 21600;

const asOfLabel = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
const monthLabel = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' });

export async function generateMetadata(): Promise<Metadata> {
  const month = monthLabel(new Date());
  const title = `Fair Oaks Ranch & Hill Country Housing Market Report — ${month}`;
  const description =
    `Live ${month} market snapshot from the SABOR MLS: homes for sale, homes under contract, median asking prices, ` +
    'price reductions and time on market for Fair Oaks Ranch, Boerne, Cordillera Ranch, The Dominion, Helotes and Bulverde.';
  return {
    // Carries the brand: absolute, so the layout template does not append it twice.
    title: { absolute: `${title} | Fair Oaks Realty Group` },
    description,
    alternates: { canonical: '/market-reports' },
    openGraph: {
      images: [{ url: '/images/og-home.jpg', width: 1200, height: 630, alt: 'Fair Oaks Realty Group' }],
      title,
      description,
      url: 'https://www.fairoaksrealtygroup.com/market-reports',
      type: 'website',
    },
  };
}

const usd = (n: number | null) => (n === null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
const days = (n: number | null) => (n === null ? '—' : `${n} days`);

function headlineStats(a: AreaStats) {
  return [
    { icon: Home,          label: 'Homes for sale',         value: a.forSale.toLocaleString('en-US') },
    { icon: FileSignature, label: 'Under contract',         value: `${a.underContract.toLocaleString('en-US')}${a.underContractShare !== null ? ` (${pct(a.underContractShare)})` : ''}` },
    { icon: Tag,           label: 'Median asking price',    value: usd(a.medianAskingPrice) },
    { icon: Ruler,         label: 'Median asking $ / sq ft', value: usd(a.medianPricePerSqft) },
    { icon: CalendarDays,  label: 'Median days listed',     value: days(a.medianDaysListed) },
    { icon: TrendingDown,  label: 'Homes with a price cut', value: a.priceCutShare !== null ? `${a.priceCutCount} (${pct(a.priceCutShare)})` : '—' },
  ];
}

function SignupBlock() {
  return (
    <section id="updates" className="section-luxury bg-primary text-white scroll-mt-24">
      <Container>
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="overline mb-3 text-gold">Market Updates by Email</p>
            <h2 className="font-heading text-display-xs font-bold mb-4">Get the market update in your inbox</h2>
            <p className="text-body text-white/70">
              The Fair Oaks Ranch and Hill Country numbers, with what they mean for buying or selling — from a local broker,
              not an algorithm.
            </p>
          </div>
          <div className="rounded-2xl bg-white p-5 sm:p-8 text-primary">
            <BrokerTrustCard surface="market_report" className="mb-5" />
            <MarketReportSignup />
          </div>
        </div>
      </Container>
    </section>
  );
}

export default async function MarketReportsPage() {
  const snapshot = await getMarketSnapshot(revalidate);

  if (!snapshot) {
    return (
      <>
        <Header />
        <main className="min-h-screen pt-20">
          <section className="bg-primary py-16 sm:py-20 text-white">
            <Container>
              <p className="overline mb-3 text-gold">Market Report</p>
              <h1 className="font-heading text-display-sm sm:text-display font-bold">Fair Oaks Ranch &amp; Hill Country Housing Market</h1>
              <p className="mt-4 max-w-2xl text-body-lg text-white/70">
                The live MLS figures are temporarily unavailable. Please check back shortly, or sign up below and we&apos;ll send you the update.
              </p>
            </Container>
          </section>
          <SignupBlock />
        </main>
        <Footer />
      </>
    );
  }

  const story = marketStory(snapshot);
  const home = snapshot.areas[0];
  const asOf = asOfLabel(snapshot.asOf);

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">

        {/* ── Story hero: headline and lead built from the figures below ── */}
        <section className="bg-primary py-16 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">Market Report · {monthLabel(snapshot.asOf)}</p>
              <h1 className="font-heading text-display-sm sm:text-display font-bold leading-tight">{story.headline}</h1>
              <p className="mt-5 text-body-lg leading-relaxed text-white/75">{story.lead}</p>
              <p className="mt-4 text-caption text-white/50">
                Live from the SABOR MLS · Data as of {asOf} · Residential listings
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <a href="#updates"><Mail className="mr-2 h-4 w-4" />Get the market update by email</a>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/home-valuation?from=market-report">What&apos;s my home worth?</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* ── Headline market at a glance ── */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3">{home.area.label} · As of {asOf}</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                The Market Right Now
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
              {headlineStats(home).map(({ icon: Icon, label, value }) => (
                <div key={label} className="card-luxury p-5 sm:p-6 text-center">
                  <Icon className="mx-auto mb-3 h-7 w-7 text-gold" />
                  <div className="font-heading text-heading-xl sm:text-display-xs font-bold text-primary mb-1">{value}</div>
                  <div className="text-caption uppercase tracking-wider text-foreground-muted">{label}</div>
                </div>
              ))}
            </div>
            <ul className="mx-auto mt-10 max-w-3xl space-y-3">
              {story.points.map(point => (
                <li key={point} className="flex gap-3 text-body text-foreground-muted">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gold" />
                  {point}
                </li>
              ))}
            </ul>
          </Container>
        </section>

        {/* ── By area ── */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3">By Area · As of {asOf}</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Fair Oaks Ranch &amp; the Hill Country
              </h2>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[760px] text-left text-body-sm">
                <thead className="bg-background-cream text-caption uppercase tracking-wider text-foreground-muted">
                  <tr>
                    <th className="px-4 py-3">Area</th>
                    <th className="px-4 py-3 text-right">For sale</th>
                    <th className="px-4 py-3 text-right">Under contract</th>
                    <th className="px-4 py-3 text-right">Median asking</th>
                    <th className="px-4 py-3 text-right">$ / sq ft</th>
                    <th className="px-4 py-3 text-right">Median days listed</th>
                    <th className="px-4 py-3 text-right">With a price cut</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.areas.map(a => (
                    <tr key={a.area.key} className="border-t border-border">
                      <td className="px-4 py-3 font-semibold text-primary">
                        <Link href={a.area.href} className="inline-flex items-center gap-1 hover:text-gold transition-colors">
                          {a.area.label} <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">{a.forSale.toLocaleString('en-US')}</td>
                      <td className="px-4 py-3 text-right">{a.underContract.toLocaleString('en-US')} <span className="text-foreground-muted">({pct(a.underContractShare)})</span></td>
                      <td className="px-4 py-3 text-right">{usd(a.medianAskingPrice)}</td>
                      <td className="px-4 py-3 text-right">{usd(a.medianPricePerSqft)}</td>
                      <td className="px-4 py-3 text-right">{days(a.medianDaysListed)}</td>
                      <td className="px-4 py-3 text-right">{pct(a.priceCutShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Container>
        </section>

        <SignupBlock />

        {/* ── Source and method: what each figure is, and what the feed can't say ── */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="mx-auto max-w-3xl text-body-sm text-foreground-muted space-y-3">
              <h2 className="font-heading text-heading font-bold text-primary">About these numbers</h2>
              <p>
                <strong className="text-primary">Source:</strong> San Antonio Board of REALTORS&reg; (SABOR) MLS, via the IDX feed
                that powers our home search. Figures are computed automatically from residential listings and refreshed several
                times a day; this page reflects data as of {asOf}. Information is deemed reliable but not guaranteed.
              </p>
              <p>
                <strong className="text-primary">What each figure means:</strong> &ldquo;For sale&rdquo; is active listings;
                &ldquo;under contract&rdquo; is listings marked Active Under Contract or Pending, shown with their share of all
                homes on the market. Prices are <em>asking</em> prices. &ldquo;Days listed&rdquo; runs from the listing&apos;s
                on-market date to today, so a home that was taken off and relisted counts from its latest listing.
                A &ldquo;price cut&rdquo; is a home now asking less than its original list price. Medians are shown only when at
                least {MIN_SAMPLE} listings contribute. Cordillera Ranch homes are also counted in Boerne.
              </p>
              <p>
                <strong className="text-primary">What&apos;s not here:</strong> sold prices, homes sold and sale-to-list ratios.
                Texas doesn&apos;t require sale prices to be disclosed, and the MLS feed available to this site includes only
                homes on the market or under contract — not closed sales. For what homes like yours have actually sold for,{' '}
                <Link href="/home-valuation?from=market-report" className="font-semibold text-gold hover:underline">ask for a broker valuation</Link>.
              </p>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
