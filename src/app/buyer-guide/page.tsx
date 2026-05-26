import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CreditCard, FileText, MapPin, Users, FileSignature, Search,
  BarChart2, KeyRound, CheckCircle, ArrowRight, Phone, Home,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

export const revalidate = 86400;

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export const metadata: Metadata = {
  title: "Texas Home Buyer's Guide | Step-by-Step Guide for Hill Country Buyers",
  description:
    'Complete home buyer\'s guide for Fair Oaks Ranch and the Texas Hill Country — from pre-approval to closing. Expert advice from Fair Oaks Realty Group.',
  keywords: ['texas home buyer guide', 'how to buy a home in texas', 'first-time homebuyer texas', 'home buying process texas hill country', 'mortgage preapproval texas', 'closing costs texas', 'home inspection texas', 'fair oaks ranch buyer guide', 'boerne tx home buying', 'texas real estate process'],
  alternates: { canonical: '/buyer-guide' },
  openGraph: {
    title: "Texas Home Buyer's Guide | Step-by-Step Guide for Hill Country Buyers",
    description:
      'Complete guide to buying a home in the Texas Hill Country — step-by-step process, costs, and local market insights.',
    url: BASE_URL + '/buyer-guide',
  },
};

const STEPS = [
  {
    number: '01',
    icon: CreditCard,
    title: 'Check Your Finances & Credit',
    description:
      'Before anything else, review your credit score and financial health. Lenders typically want a minimum 620 score for conventional loans (580 for FHA, 640 for USDA). Pull your free credit reports from AnnualCreditReport.com and dispute any errors. Calculate your debt-to-income ratio — most lenders want it under 43%. Review your savings for the down payment and closing costs. This step is often where buyers discover they\'re in better (or worse) shape than expected — giving you time to improve before applying.',
    tips: [
      'Free credit check: AnnualCreditReport.com',
      '620+ score for conventional, 580+ for FHA',
      'Pay down credit cards to below 30% utilization',
      'Avoid opening new credit accounts before closing',
    ],
  },
  {
    number: '02',
    icon: FileText,
    title: 'Get Pre-Approved',
    description:
      'A pre-approval letter is not optional in the Texas Hill Country market — it\'s a requirement. Sellers won\'t take your offer seriously without one, and in competitive situations, pre-approved buyers win. During pre-approval, a lender verifies your income, assets, employment, and credit and commits to lending you a specific amount. Gather your last 2 years of tax returns, W-2s, 2 months of bank statements, and recent pay stubs. The process takes 1–3 business days. We work with several trusted local lenders who are familiar with Hill Country properties.',
    tips: [
      'Shop 2–3 lenders to compare rates',
      'Pre-approval vs. pre-qualification: pre-approval carries weight',
      'Rate lock: ask about lock options once your offer is accepted',
      'VA, FHA, Conventional, USDA — ask which fits your situation',
    ],
  },
  {
    number: '03',
    icon: MapPin,
    title: 'Choose Your Area',
    description:
      'The Texas Hill Country offers several distinct communities, each with its own character, school district, commute profile, and price point. Fair Oaks Ranch is ideal for families wanting larger lots, top Boerne ISD schools, and a quiet, safe environment close to San Antonio. Boerne itself offers small-town charm with a walkable historic district. Helotes combines affordability with Northside ISD schools and quick freeway access to San Antonio. Bulverde and Spring Branch offer rural acreage with Comal ISD. We\'ll help you understand the trade-offs and find the right fit for your lifestyle.',
    tips: [
      'Verify school districts at GreatSchools.org',
      'Test commute times during peak hours',
      'Consider HOA fees and restrictions',
      'Check flood zone status for Hill Country properties',
    ],
    links: [
      { label: 'Browse Homes for Sale', href: '/listings' },
      { label: 'Explore Neighborhoods', href: '/neighborhoods' },
    ],
  },
  {
    number: '04',
    icon: Users,
    title: 'Work with a Local Realtor',
    description:
      'In Texas, buyer representation costs you nothing — the seller pays both agents\' commissions. There is no financial reason not to have professional representation, and many reasons you should. A local Hill Country agent brings knowledge that no national platform can offer: which neighborhoods flood, which builders deliver quality, which streets have power line easements, which HOAs are financially healthy. We also have access to off-market and coming-soon listings that never hit Zillow. Our agents work exclusively in the Hill Country and San Antonio area.',
    tips: [
      'Buyer\'s agent is free to you — seller pays',
      'Sign a Buyer Representation Agreement before touring',
      'Ask about off-market and pocket listings',
      'Local agents know the micro-market inside out',
    ],
  },
  {
    number: '05',
    icon: FileSignature,
    title: 'Make an Offer',
    description:
      'When you find the right home, your agent will prepare a Texas Real Estate Commission (TREC) contract with your offer price, earnest money (typically 1% of purchase price), option fee (typically $200–$500 for a 5–10 day option period), financing terms, and proposed closing date. In competitive markets, we may recommend offering above list price, waiving certain contingencies, or including an escalation clause. We\'ll advise you on the current market temperature for that specific property and neighborhood.',
    tips: [
      'Earnest money: 1% of purchase price is typical',
      'Option period: your right to back out for any reason (usually 5–10 days)',
      'Include pre-approval letter with your offer',
      'Personal letter to seller can help in tight situations',
    ],
  },
  {
    number: '06',
    icon: Search,
    title: 'Home Inspection & Due Diligence',
    description:
      'During the option period, hire a licensed Texas home inspector to evaluate the property from foundation to roof. In the Hill Country, also consider a septic inspection (if applicable), well water test, HVAC service check, and wood-destroying insect (termite) inspection. A typical inspection costs $350–$600 for a single-family home. If the inspector identifies significant issues, your agent will negotiate repairs or a price reduction with the seller. If issues are too significant, you can terminate during the option period and receive your earnest money back.',
    tips: [
      'Budget $350–$600 for a full home inspection',
      'Attend the inspection — ask questions in person',
      'Septic and well inspections are separate (Hill Country-specific)',
      'Don\'t skip the inspection to "win" the offer — it\'s not worth it',
    ],
  },
  {
    number: '07',
    icon: BarChart2,
    title: 'Appraisal & Mortgage Approval',
    description:
      'After the option period closes, your lender orders an appraisal to confirm the property\'s market value supports the loan amount. The appraiser compares your home to recent comparable sales. If the home appraises below the purchase price, you can renegotiate the price, pay the difference in cash, or — if you included an appraisal contingency — terminate the contract. Your lender will also complete final underwriting, verifying all your financial documents one last time. Respond quickly to any underwriter requests to avoid closing delays.',
    tips: [
      'Appraisal typically costs $500–$700',
      'Don\'t make large purchases or change jobs during this phase',
      'Respond to lender document requests within 24 hours',
      'Review Closing Disclosure 3 business days before closing',
    ],
  },
  {
    number: '08',
    icon: KeyRound,
    title: 'Closing Day',
    description:
      'On closing day, you\'ll meet at the title company (in Texas, closings are typically handled by a title company, not an attorney). You\'ll sign the loan documents, deed, and closing disclosures — a stack of about 100 pages, though most are standard. Wire your closing costs and down payment to the title company in advance (wiring instructions will be sent securely by your title officer — always verify via phone before wiring). Once documents are signed and the lender funds the loan, you receive your keys. Congratulations — you\'re a Texas homeowner.',
    tips: [
      'Wire funds 1 day early to avoid delays',
      'Verify wiring instructions by phone — wire fraud is real',
      'Bring government-issued photo ID to closing',
      'Final walk-through the morning of closing',
    ],
  },
];

const CLOSING_COSTS = [
  { item: 'Loan Origination Fee', amount: '0.5–1% of loan', paidBy: 'Buyer' },
  { item: 'Appraisal Fee', amount: '$500–$700', paidBy: 'Buyer' },
  { item: 'Home Inspection', amount: '$350–$600', paidBy: 'Buyer' },
  { item: 'Title Insurance (Lender\'s Policy)', amount: '$500–$1,200', paidBy: 'Buyer' },
  { item: 'Title Insurance (Owner\'s Policy)', amount: '$1,000–$2,500', paidBy: 'Seller (Texas custom)' },
  { item: 'Escrow/Settlement Fee', amount: '$500–$800', paidBy: 'Split' },
  { item: 'Recording Fees', amount: '$50–$150', paidBy: 'Buyer' },
  { item: 'Prepaid Homeowners Insurance', amount: '$1,200–$2,400/yr', paidBy: 'Buyer' },
  { item: 'Property Tax Escrow (2–3 months)', amount: 'Varies', paidBy: 'Buyer' },
  { item: 'HOA Transfer Fee', amount: '$200–$500', paidBy: 'Varies' },
];

const BUYER_PROGRAMS = [
  {
    name: 'TSAHC My First Texas Home',
    description:
      'Texas State Affordable Housing Corporation offers down payment assistance of 3–5% of the loan amount for first-time buyers and veterans. Can be used with FHA, VA, USDA, or conventional loans. Income and purchase price limits apply.',
    link: 'https://www.tsahc.org',
  },
  {
    name: 'Mortgage Credit Certificate (MCC)',
    description:
      'A federal tax credit of up to 20–40% of annual mortgage interest, claimed yearly on your federal taxes. Issued by TSAHC for first-time buyers below income limits. Can save thousands over the life of the loan.',
    link: null,
  },
  {
    name: 'FHA Loan',
    description:
      'Federal Housing Administration loans require just 3.5% down with a 580+ credit score. More flexible debt-to-income requirements than conventional loans. Requires mortgage insurance premium (MIP) for the life of the loan if down payment is below 10%.',
    link: null,
  },
  {
    name: 'USDA Rural Development Loan',
    description:
      'For properties in eligible rural areas — including parts of the Hill Country around Boerne, Bandera County, and Medina County. Offers 0% down payment and below-market interest rates. Income limits apply.',
    link: null,
  },
  {
    name: 'VA Loan',
    description:
      'For eligible veterans, active duty, and surviving spouses. Zero down payment, no PMI, competitive rates, and no loan limits with full entitlement. The best mortgage product available for those who qualify.',
    link: '/military-homebuying',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to Buy a Home in the Texas Hill Country',
  description:
    'Step-by-step guide to buying a home in Fair Oaks Ranch, Boerne, Helotes, and the Texas Hill Country.',
  step: STEPS.map(step => ({
    '@type': 'HowToStep',
    name: step.title,
    text: step.description,
    position: parseInt(step.number),
  })),
};

export default function BuyerGuidePage() {
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
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">First-Time &amp; Repeat Buyers</p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Your Complete Texas<br />
                <span className="text-gradient-gold">Home Buyer&apos;s Guide</span>
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Everything you need to know about buying a home in Fair Oaks Ranch, Boerne, Helotes, and the Texas Hill Country — from first steps to closing day.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings">Start Your Home Search</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Market Context */}
        <section className="section-compact bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">Market Context</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Is Now a Good Time to Buy in the Hill Country?
                </h2>
                <p className="mb-4 text-body text-foreground-muted leading-relaxed">
                  The Texas Hill Country real estate market remains one of the most resilient in the country. While national markets have fluctuated with interest rate changes, the San Antonio metro and its Hill Country suburbs have maintained strong buyer demand driven by continued job growth, military relocation, and in-migration from higher-cost Texas metros.
                </p>
                <p className="mb-4 text-body text-foreground-muted leading-relaxed">
                  Home prices in Boerne, Fair Oaks Ranch, and Helotes have appreciated steadily over the past decade. While year-over-year appreciation rates have moderated from the pandemic-era peaks, the Hill Country still offers compelling long-term value — especially for buyers who plan to stay 5+ years.
                </p>
                <p className="text-body text-foreground-muted leading-relaxed">
                  The most important factor is not the market — it&apos;s your personal readiness. If your finances are in order, you have job stability, and you plan to be in the area for several years, the best time to buy is when it&apos;s right for you.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { value: '30 mi', label: 'To San Antonio from Boerne' },
                  { value: 'Top 5%', label: 'Boerne ISD State Rating' },
                  { value: 'Low', label: 'Unemployment Rate' },
                  { value: 'No', label: 'Texas State Income Tax' },
                ].map(stat => (
                  <div key={stat.label} className="rounded-xl border border-border bg-background-cream p-5 text-center">
                    <div className="font-heading text-display-sm font-bold text-gold">{stat.value}</div>
                    <div className="mt-1 text-caption text-foreground-muted">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* Step-by-Step Process */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-14 text-center">
              <p className="overline mb-3">The Buying Process</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                8 Steps to Buying a Home in Texas
              </h2>
            </div>

            <div className="space-y-10">
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.number}
                    className={`grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start ${i % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}
                  >
                    <div className={`${i % 2 === 1 ? 'lg:order-2' : ''}`}>
                      <div className="flex items-center gap-4 mb-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold text-primary font-heading text-heading font-bold">
                          {step.number}
                        </div>
                        <div>
                          <h3 className="font-heading text-heading font-bold text-primary">{step.title}</h3>
                        </div>
                      </div>
                      <p className="text-body text-foreground-muted leading-relaxed mb-5">{step.description}</p>
                      {'links' in step && step.links && (
                        <div className="flex flex-wrap gap-3 mt-4">
                          {step.links.map(link => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-gold hover:underline"
                            >
                              {link.label} <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className={`rounded-2xl bg-white border border-border p-6 shadow-sm ${i % 2 === 1 ? 'lg:order-1' : ''}`}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/10">
                          <Icon className="h-5 w-5 text-gold" />
                        </div>
                        <h4 className="font-heading text-heading-sm font-semibold text-primary">Key Tips</h4>
                      </div>
                      <ul className="space-y-2.5">
                        {step.tips.map(tip => (
                          <li key={tip} className="flex items-start gap-2.5 text-body-sm text-foreground-muted">
                            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          </Container>
        </section>

        {/* Closing Costs Table */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-gold">Know Your Numbers</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Understanding Texas Closing Costs
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Texas buyers typically pay 2–3% of the purchase price in closing costs. On a $450,000 home, plan for roughly $9,000–$13,500. Here is a breakdown of what to expect.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="pb-3 pr-6 font-heading text-heading-sm font-semibold text-primary">Cost Item</th>
                    <th className="pb-3 pr-6 font-heading text-heading-sm font-semibold text-primary">Typical Amount</th>
                    <th className="pb-3 font-heading text-heading-sm font-semibold text-primary">Paid By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {CLOSING_COSTS.map(row => (
                    <tr key={row.item} className="hover:bg-background-cream transition-colors">
                      <td className="py-3.5 pr-6 font-medium text-primary">{row.item}</td>
                      <td className="py-3.5 pr-6 text-foreground-muted">{row.amount}</td>
                      <td className="py-3.5 text-foreground-muted">{row.paidBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-caption text-foreground-muted">
              Note: In Texas, it is customary for the seller to pay for the owner&apos;s title insurance policy. This is negotiable but is the prevailing custom in most Hill Country transactions.
            </p>
          </Container>
        </section>

        {/* First-Time Buyer Programs */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">Down Payment Help</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                First-Time Buyer Programs in Texas
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Several programs exist to help Texas buyers reduce their upfront costs. You may qualify for more than one.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {BUYER_PROGRAMS.map(prog => (
                <div key={prog.name} className="rounded-2xl border border-border bg-white p-7 shadow-sm flex flex-col">
                  <div className="flex items-start gap-3 mb-3">
                    <Home className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                    <h3 className="font-heading text-heading-sm font-bold text-primary">{prog.name}</h3>
                  </div>
                  <p className="text-body-sm text-foreground-muted leading-relaxed flex-1">{prog.description}</p>
                  {prog.link && (
                    <div className="mt-4">
                      <Link
                        href={prog.link}
                        className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-gold hover:underline"
                      >
                        Learn more <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Ready to Begin?</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Start Your Hill Country Home Search
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse available homes or connect with an agent today. No pressure — just helpful, knowledgeable guidance when you need it.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings">
                    Browse Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Talk to an Agent</Link>
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
