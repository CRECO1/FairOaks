import type { Metadata } from 'next';
import Link from 'next/link';
import {
  TrendingUp, Clock, DollarSign, Users, CheckCircle, ArrowRight,
  Phone, Camera, BarChart2, Globe, Mail, Home, AlertTriangle,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

export const revalidate = 86400;

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export const metadata: Metadata = {
  title: "Texas Home Seller's Guide | How to Get Top Dollar in Hill Country",
  description:
    'Everything you need to know about selling your Hill Country home — pricing strategy, staging, negotiations, and closing. Free market analysis included.',
  keywords: ['sell my home texas', 'how to sell your home', 'home selling process texas', 'pricing your home', 'home staging tips', 'list to sale ratio texas', 'fair oaks ranch home seller', 'boerne tx sell home', 'texas hill country home sale', 'home valuation texas'],
  alternates: { canonical: '/seller-guide' },
  openGraph: {
    title: "Texas Home Seller's Guide | How to Get Top Dollar in Hill Country",
    description:
      'Pricing strategy, staging tips, marketing, and our proven 103% list-to-sale process for Texas Hill Country sellers.',
    url: BASE_URL + '/seller-guide',
  },
};

const STATS = [
  { icon: TrendingUp, value: '103%', label: 'List-to-Sale Price' },
  { icon: Clock, value: '21', label: 'Avg. Days on Market' },
  { icon: Users, value: '500+', label: 'Homes Sold' },
  { icon: DollarSign, value: '$0', label: 'Upfront Marketing Cost' },
];

const PREP_TIPS = [
  {
    icon: Home,
    title: 'Declutter & Depersonalize',
    description:
      'Buyers need to visualize themselves living in your home — not you. Remove personal photos, excess furniture, and anything that makes the space feel smaller or more personal. Rent a storage unit if needed. A decluttered home photographs better, shows better, and sells faster.',
  },
  {
    icon: Camera,
    title: 'Curb Appeal First',
    description:
      'The exterior is a buyer\'s first impression — online and in person. Mow and edge the lawn, trim overgrown shrubs, plant colorful annuals in entry beds, pressure wash the driveway, paint or clean the front door, and replace outdated house numbers. Curb appeal improvements consistently deliver some of the highest ROI of any pre-listing work.',
  },
  {
    icon: TrendingUp,
    title: 'Fresh Interior Paint',
    description:
      'A fresh coat of neutral paint (think warm whites, light greiges, soft sage) is one of the highest-return investments you can make before listing. It makes the home feel clean, modern, and move-in ready. Focus on high-visibility areas: living room, kitchen, primary bedroom, and hallways. Cost: $2,000–$5,000 for a typical Hill Country home.',
  },
  {
    icon: Globe,
    title: 'Professional Photography',
    description:
      'Over 95% of buyers start their search online. The quality of your listing photos determines whether they schedule a showing. We include professional photography — including wide-angle interior shots, drone aerials, and virtual tours — at no cost to you. Never list with only smartphone photos.',
  },
  {
    icon: BarChart2,
    title: 'Price It Right from Day One',
    description:
      'The most dangerous thing a seller can do is overprice their home. Overpriced listings sit, accumulate days on market, and trigger buyer suspicion ("what\'s wrong with it?"). Correct pricing generates activity, competing offers, and — paradoxically — higher sale prices. Our CMA process pinpoints the optimal listing price for your home and market conditions.',
  },
  {
    icon: CheckCircle,
    title: 'Consider a Pre-Listing Inspection',
    description:
      'A $300–$500 investment in a pre-listing inspection lets you find and fix issues before buyers discover them — on their terms. Sellers who provide a pre-listing inspection report demonstrate transparency, reduce buyer negotiation leverage, and often sell faster and for more money.',
  },
];

const SELLING_STEPS = [
  {
    number: '01',
    title: 'Free Home Valuation & CMA',
    description:
      'We start with a detailed Comparative Market Analysis — reviewing recent sales, active competition, and your home\'s specific features to determine the optimal listing price. We\'ll present a range and explain the strategy for each scenario.',
  },
  {
    number: '02',
    title: 'Strategic Preparation',
    description:
      'Based on our walkthrough, we provide a prioritized prep list focused on highest-return improvements. We coordinate professional photography, staging consultation, 3D Matterport tour, and drone footage — all included.',
  },
  {
    number: '03',
    title: 'Maximum Market Exposure',
    description:
      'Your home hits the MLS and syndicates instantly to Zillow, Realtor.com, Trulia, Redfin, and hundreds of partner sites. We also run targeted Facebook/Instagram ad campaigns, email your listing to our active buyer database, and host a broker open for local agents.',
  },
  {
    number: '04',
    title: 'Skilled Offer Negotiation',
    description:
      'We represent your interests aggressively on every offer — reviewing not just price but financing strength, contingencies, timelines, and concession requests. In multiple-offer situations, we create competitive tension that drives your price up.',
  },
  {
    number: '05',
    title: 'Smooth Closing Coordination',
    description:
      'From contract to close, we coordinate inspections, appraisals, title work, and lender communication. You\'ll receive weekly updates and never wonder where things stand. Our goal: a stress-free closing where you walk away with the number we promised.',
  },
];

const MARKETING_CHANNELS = [
  {
    icon: Globe,
    title: 'MLS & Portal Syndication',
    description: 'Listed on the San Antonio MLS and syndicated to Zillow, Realtor.com, Redfin, Trulia, and 200+ partner sites within hours of going live.',
  },
  {
    icon: Camera,
    title: 'Professional Photography & Video',
    description: 'Wide-angle interior photography, drone aerials, 3D Matterport virtual tour, and listing video — all included at no cost.',
  },
  {
    icon: TrendingUp,
    title: 'Targeted Social Media Ads',
    description: 'Facebook and Instagram campaigns targeting active buyers in your price range within driving distance — reaching buyers who haven\'t found you yet on Zillow.',
  },
  {
    icon: Mail,
    title: 'Email Marketing',
    description: 'Your listing is sent to our database of active buyers and agents. These are people who have expressed interest in your neighborhood and price range.',
  },
  {
    icon: Users,
    title: 'Agent Network & Open House',
    description: 'Broker open for local agents in the first week, followed by public open houses on peak weekend days. Agent-to-agent referrals are responsible for many of our fastest sales.',
  },
  {
    icon: Home,
    title: 'Custom Property Website',
    description: 'Every listing gets a dedicated property website with its own URL — perfect for sharing on social media and in yard sign QR codes.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to Sell Your Home in the Texas Hill Country',
  description:
    'Step-by-step guide to selling your home in Fair Oaks Ranch, Boerne, and the Texas Hill Country for maximum price.',
  step: SELLING_STEPS.map(step => ({
    '@type': 'HowToStep',
    name: step.title,
    text: step.description,
    position: parseInt(step.number),
  })),
};

export default function SellerGuidePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main className="min-h-screen pt-20">

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">The Seller&apos;s Playbook</p>
                <h1 className="mb-5 font-heading text-display font-bold text-white">
                  How to Sell Your Home<br />
                  <span className="text-gradient-gold">for Top Dollar in Texas</span>
                </h1>
                <p className="mb-6 max-w-lg text-body-lg text-white/70">
                  A proven guide to selling your home in Fair Oaks Ranch, Boerne, and the Texas Hill Country. Pricing strategy, preparation, marketing, and our record of 103% list-to-sale price ratio.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button size="lg" asChild>
                    <Link href="/sell">Request a Free Home Valuation</Link>
                  </Button>
                  <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                    <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />210-390-9997</a>
                  </Button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                {STATS.map(({ icon: Icon, value, label }) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-5 sm:p-6 text-center backdrop-blur-sm">
                    <Icon className="mx-auto mb-3 h-8 w-8 text-gold" />
                    <div className="font-heading text-display-sm font-bold text-white">{value}</div>
                    <div className="mt-1 text-caption uppercase tracking-wider text-white/50">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* Preparing Your Home */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-14 text-center">
              <p className="overline mb-3">Before You List</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Preparing Your Home to Sell
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body-lg text-foreground-muted">
                The preparation phase determines the ceiling on your sale price. These six steps consistently separate homes that sell in days for above asking from homes that sit for weeks.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {PREP_TIPS.map((tip) => {
                const Icon = tip.icon;
                return (
                  <div key={tip.title} className="rounded-2xl border border-border bg-white p-7 shadow-sm">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10">
                      <Icon className="h-6 w-6 text-gold" />
                    </div>
                    <h3 className="mb-2 font-heading text-heading-sm font-bold text-primary">{tip.title}</h3>
                    <p className="text-body-sm text-foreground-muted leading-relaxed">{tip.description}</p>
                  </div>
                );
              })}
            </div>
          </Container>
        </section>

        {/* Selling Process */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-14 text-center">
              <p className="overline mb-3">Our Proven System</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Our 5-Step Selling Process
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-5">
              {SELLING_STEPS.map((step, i) => (
                <div key={step.number} className="text-center">
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-primary font-heading text-heading font-bold">
                    {step.number}
                  </div>
                  <h3 className="mb-3 font-heading text-heading-sm font-semibold text-primary">{step.title}</h3>
                  <p className="text-body-sm text-foreground-muted">{step.description}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Net Proceeds */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-start">
              <div>
                <p className="overline mb-3 text-gold">Know Your Bottom Line</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Understanding Your Net Proceeds
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  The sale price of your home is not what you walk away with. Understanding the deductions helps you plan your next move with confidence. Here is what to expect on a typical Texas Hill Country home sale.
                </p>

                <div className="rounded-2xl border border-border bg-white p-6 shadow-sm mb-6">
                  <h3 className="mb-4 font-heading text-heading-sm font-semibold text-primary">Example: $550,000 Sale</h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Sale Price', amount: '$550,000', positive: true },
                      { label: 'Agent Commission (5–6%)', amount: '− $27,500–$33,000', positive: false },
                      { label: 'Owner\'s Title Insurance', amount: '− $1,500–$2,500', positive: false },
                      { label: 'Prorated Property Taxes', amount: '− $2,000–$5,000', positive: false },
                      { label: 'HOA Transfer Fee', amount: '− $300–$600', positive: false },
                      { label: 'Repairs / Concessions (negotiated)', amount: '− $0–$5,000', positive: false },
                      { label: 'Remaining Mortgage Balance', amount: 'Varies', positive: false },
                    ].map(row => (
                      <div key={row.label} className="flex items-center justify-between border-b border-border pb-2.5 last:border-0 last:pb-0">
                        <span className="text-body-sm text-foreground-muted">{row.label}</span>
                        <span className={`text-body-sm font-semibold ${row.positive ? 'text-primary' : 'text-red-600'}`}>{row.amount}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-2 border-t-2 border-border">
                      <span className="font-heading text-heading-sm font-bold text-primary">Estimated Net Proceeds</span>
                      <span className="font-heading text-heading-sm font-bold text-gold">~$500,000–$520,000</span>
                    </div>
                  </div>
                </div>

                <p className="text-body-sm text-foreground-muted">
                  We provide a personalized seller net sheet at the start of every listing consultation. No surprises at the closing table.
                </p>
              </div>

              <div>
                <p className="overline mb-3 text-gold">Seller Tax Considerations</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Capital Gains &amp; Texas Tax Rules
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  Texas has no state income tax, which is a significant advantage for sellers compared to states like California. However, federal capital gains tax may apply depending on your situation.
                </p>
                <ul className="space-y-4">
                  {[
                    {
                      title: 'Primary Residence Exclusion',
                      detail: 'If the home has been your primary residence for 2 of the last 5 years, you can exclude up to $250,000 in capital gains ($500,000 for married couples filing jointly). Most sellers in the Hill Country owe no federal capital gains tax.',
                    },
                    {
                      title: 'Investment Property',
                      detail: 'If the home is a rental or investment property, capital gains rules are different. A 1031 exchange can defer taxes if you\'re reinvesting proceeds into a like-kind property.',
                    },
                    {
                      title: 'Consult Your CPA',
                      detail: 'We always recommend consulting a CPA or tax advisor before listing — especially for inherited properties, homes that have appreciated significantly, or investment properties.',
                    },
                  ].map(item => (
                    <li key={item.title} className="rounded-xl border border-border bg-white p-5">
                      <h4 className="mb-1.5 font-heading text-heading-sm font-semibold text-primary">{item.title}</h4>
                      <p className="text-body-sm text-foreground-muted leading-relaxed">{item.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Container>
        </section>

        {/* Pricing Strategy */}
        <section className="section-compact bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">The Most Important Decision</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Pricing Strategy: The CMA
                </h2>
                <p className="mb-4 text-body text-foreground-muted leading-relaxed">
                  A Comparative Market Analysis (CMA) is the foundation of every listing we take. We analyze every home sold in your neighborhood over the past 6–12 months — adjusting for square footage, lot size, age, condition, upgrades, and location within the neighborhood — to arrive at a defensible market value for your home.
                </p>
                <p className="mb-4 text-body text-foreground-muted leading-relaxed">
                  The CMA tells us the market range. Our job is to price your home at the right point within that range to generate maximum buyer activity. The goal isn&apos;t to list at the top of the range and hope — it&apos;s to create a compelling value that brings multiple buyers to the table and creates upward pressure through competition.
                </p>
                <p className="text-body text-foreground-muted leading-relaxed">
                  Our 103% list-to-sale price ratio is not achieved by underpricing. It is achieved through disciplined market analysis, professional presentation, and strategic offer management.
                </p>
              </div>

              <div className="rounded-2xl border-2 border-red-100 bg-red-50 p-7">
                <div className="flex items-start gap-3 mb-5">
                  <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-500" />
                  <h3 className="font-heading text-heading font-bold text-red-900">The Danger of Overpricing</h3>
                </div>
                <p className="mb-5 text-body-sm text-red-800 leading-relaxed">
                  Overpricing is the most common and costly mistake sellers make. Here is what happens when a home is priced too high:
                </p>
                <ul className="space-y-3">
                  {[
                    'The most qualified buyers (those already searching) see it and pass',
                    'The listing accumulates days on market — a visible red flag',
                    'Buyer agents begin to discount the home without seeing it',
                    'Price reductions are required — each one signals desperation',
                    'The final sale price ends up lower than correct pricing would have achieved',
                    'Research shows homes that require a price cut sell for 5–10% less than comparable homes priced correctly from the start',
                  ].map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-body-sm text-red-800">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Container>
        </section>

        {/* Marketing */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-14 text-center">
              <p className="overline mb-3">Get Your Home Seen</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                How We Market Your Home
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body-lg text-foreground-muted">
                Listing on the MLS is the floor, not the ceiling. Our marketing system reaches every active buyer — whether they start their search on Zillow, Instagram, or through an agent referral.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {MARKETING_CHANNELS.map(channel => {
                const Icon = channel.icon;
                return (
                  <div key={channel.title} className="rounded-2xl border border-border bg-white p-7 shadow-sm">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10">
                      <Icon className="h-6 w-6 text-gold" />
                    </div>
                    <h3 className="mb-2 font-heading text-heading-sm font-bold text-primary">{channel.title}</h3>
                    <p className="text-body-sm text-foreground-muted leading-relaxed">{channel.description}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-10 rounded-2xl bg-primary p-8 sm:p-10 text-white">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 text-center">
                {[
                  { value: '200+', label: 'Listing Syndication Sites' },
                  { value: 'Day 1', label: 'MLS Live After Sign' },
                  { value: '$0', label: 'Upfront Marketing Cost' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="font-heading text-display-sm font-bold text-gold">{item.value}</div>
                    <div className="mt-1 text-body-sm text-white/70">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Get Started Today</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Request Your Free Home Valuation
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Find out what your Hill Country home is worth in today&apos;s market. No cost, no commitment — just an honest, data-driven valuation from a local expert.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/sell">
                    Request Free Valuation <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />210-390-9997</a>
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
