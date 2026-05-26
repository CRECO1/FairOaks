import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Shield, DollarSign, TrendingDown, RotateCcw, HandCoins,
  CheckCircle, ArrowRight, Phone, Medal, Star, FileText,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

export const revalidate = 86400;

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export const metadata: Metadata = {
  title: 'Military & VA Home Buying in San Antonio TX | Fair Oaks Realty Group',
  description:
    'VA loan specialists helping military families buy homes near San Antonio, TX. Fair Oaks Realty Group understands military relocation and PCS moves.',
  alternates: { canonical: '/military-homebuying' },
  openGraph: {
    title: 'Military & VA Home Buying in San Antonio TX | Fair Oaks Realty Group',
    description:
      'Expert VA loan guidance for military families in San Antonio. Zero down payment, no PMI, competitive rates.',
    url: BASE_URL + '/military-homebuying',
  },
};

const STATS = [
  { value: '0%', label: 'Down Payment Required' },
  { value: 'No PMI', label: 'Private Mortgage Insurance' },
  { value: 'No Limits', label: 'Loan Amount (Full Entitlement)' },
  { value: 'Financed', label: 'VA Funding Fee Option' },
];

const VA_BENEFITS = [
  {
    icon: DollarSign,
    title: 'No Down Payment',
    description:
      'Buy a home with 0% down. Keep your savings for moving costs, home improvements, or emergencies — not tied up in a down payment.',
  },
  {
    icon: Shield,
    title: 'No Private Mortgage Insurance',
    description:
      'Conventional loans require PMI when you put less than 20% down. VA loans never require PMI, saving you $100–$300 per month.',
  },
  {
    icon: TrendingDown,
    title: 'Competitive Interest Rates',
    description:
      'VA loans consistently offer lower interest rates than conventional mortgages because the VA guarantee reduces lender risk.',
  },
  {
    icon: Star,
    title: 'No Loan Limits (Full Entitlement)',
    description:
      'Veterans with full entitlement can finance a home at any price with zero down payment, subject to lender approval.',
  },
  {
    icon: RotateCcw,
    title: 'Reusable Benefit',
    description:
      'Your VA benefit is not a one-time perk. You can use it multiple times throughout your life — even if you currently have a VA loan.',
  },
  {
    icon: HandCoins,
    title: 'Seller Can Pay Closing Costs',
    description:
      'The VA allows sellers to pay all of a buyer\'s closing costs. Skilled negotiation can get you into a home with truly zero out-of-pocket expenses.',
  },
];

const INSTALLATIONS = [
  {
    name: 'Fort Sam Houston',
    description:
      'The largest military installation in San Antonio and home of Army Medical Command. Located in northeast San Antonio, with easy access to the Hill Country via I-10.',
  },
  {
    name: 'Randolph AFB',
    description:
      'Home to Air Education and Training Command (AETC). Located in Universal City — 20 miles from Fair Oaks Ranch via Loop 1604.',
  },
  {
    name: 'Lackland AFB / Kelly Field',
    description:
      'The only Air Force Basic Military Training location in the US, part of Joint Base San Antonio. Located on the southwest side — about 40 minutes from Boerne.',
  },
  {
    name: 'Joint Base San Antonio (JBSA)',
    description:
      'The largest joint base in the Department of Defense, encompassing Fort Sam, Randolph, and Lackland. San Antonio\'s entire economy and culture are shaped by this military presence.',
  },
];

const VA_PROCESS_STEPS = [
  {
    number: '01',
    title: 'Obtain Your Certificate of Eligibility (COE)',
    description:
      'Your COE confirms to lenders that you are eligible for VA financing. We can help you request it online through the VA portal — it often takes just minutes.',
  },
  {
    number: '02',
    title: 'Get Pre-Approved with a VA Lender',
    description:
      'Work with a VA-approved lender to determine your buying power. We\'ll connect you with trusted local lenders who specialize in VA transactions and understand military timelines.',
  },
  {
    number: '03',
    title: 'Search for Your Home',
    description:
      'With pre-approval in hand, we begin your home search. We know which neighborhoods are closest to your installation, which schools your kids will love, and which homes are VA-appraisal friendly.',
  },
  {
    number: '04',
    title: 'VA Appraisal & Minimum Property Requirements',
    description:
      'The VA orders its own appraisal to confirm value and ensure the property meets Minimum Property Requirements (MPRs) for safety and livability. We help you navigate any issues.',
  },
  {
    number: '05',
    title: 'Close and Get Your Keys',
    description:
      'Sign your closing documents, the VA loan funds, and you receive the keys to your new home. For deployed buyers, we coordinate remote and power-of-attorney closings.',
  },
];

const VA_FAQS = [
  {
    q: 'Can I use my VA benefit if I\'ve used it before?',
    a: 'Yes. The VA loan benefit is reusable. If you\'ve paid off a previous VA loan and sold the home, your full entitlement is restored. You can also have multiple VA loans simultaneously in some circumstances — for example, when PCS\'ing to a new duty station without selling your previous home.',
  },
  {
    q: 'What is the VA Funding Fee and can it be waived?',
    a: 'The VA Funding Fee is a one-time fee (typically 1.25–3.3% of the loan amount) charged by the VA in lieu of PMI. It can be financed into the loan rather than paid at closing. Importantly, veterans with a VA disability rating of 10% or higher are completely exempt from the funding fee — a significant savings of thousands of dollars.',
  },
  {
    q: 'How does a PCS move work with a VA loan?',
    a: 'A PCS (Permanent Change of Station) move is one of the most common scenarios we handle. Your VA benefit can be used at your new duty station, and we can coordinate your purchase remotely — virtual tours, digital document signing, and even power-of-attorney closings for deployed buyers. We\'re experienced with tight PCS timelines and will work around your orders.',
  },
  {
    q: 'Is San Antonio a good city for military homebuyers?',
    a: 'San Antonio is consistently ranked one of the most military-friendly cities in the United States. With 4 major military installations, a robust veteran community, competitive home prices relative to other major metros, no Texas state income tax, and a booming job market — it\'s an excellent place to buy. The Texas Hill Country suburbs (Fair Oaks Ranch, Boerne, Helotes) offer top schools, safety, and a high quality of life within easy commute of all installations.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
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
        'Military and VA home buying specialists serving San Antonio, Fort Sam Houston, Randolph AFB, Lackland AFB, and the Texas Hill Country.',
    },
    {
      '@type': 'FAQPage',
      mainEntity: VA_FAQS.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
};

export default function MilitaryHomebuyingPage() {
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
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-yellow-400/10 px-4 py-1.5 border border-yellow-400/30">
                  <Medal className="h-4 w-4 text-yellow-400" />
                  <span className="text-caption font-semibold uppercase tracking-wider text-yellow-400">VA Loan Specialists</span>
                </div>
                <h1 className="mb-5 font-heading text-display font-bold text-white">
                  Military &amp; VA Home Buying<br />
                  <span className="text-gradient-gold">in San Antonio, TX</span>
                </h1>
                <p className="mb-6 max-w-lg text-body-lg text-white/70">
                  You&apos;ve earned the VA loan benefit. We help you use every dollar of it. Zero down payment, no PMI, no loan limits — and an agent who has been through a PCS move himself.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button size="lg" asChild>
                    <Link href="/contact?service=military">Schedule a Free VA Consultation</Link>
                  </Button>
                  <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                    <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                  </Button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                {STATS.map(({ value, label }) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-5 sm:p-6 text-center backdrop-blur-sm">
                    <div className="font-heading text-display-sm font-bold text-yellow-400">{value}</div>
                    <div className="mt-1 text-caption uppercase tracking-wider text-white/60">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* Military Friendly City */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-14 text-center">
              <p className="overline mb-3 text-gold">Why San Antonio</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                One of America&apos;s Most Military-Friendly Cities
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body-lg text-foreground-muted">
                San Antonio is home to Joint Base San Antonio — the largest joint base in the Department of Defense — with over 80,000 active-duty personnel across four major installations. There is no better city in America to use your VA benefit.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {INSTALLATIONS.map(inst => (
                <div key={inst.name} className="rounded-2xl border border-border bg-white p-7 shadow-sm">
                  <div className="flex items-start gap-3 mb-3">
                    <Shield className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                    <h3 className="font-heading text-heading-sm font-bold text-primary">{inst.name}</h3>
                  </div>
                  <p className="text-body-sm text-foreground-muted leading-relaxed">{inst.description}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 rounded-2xl bg-blue-900 p-7 sm:p-10 text-white">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 text-center">
                {[
                  { value: '80,000+', label: 'Active-Duty Personnel' },
                  { value: '4', label: 'Major Military Installations' },
                  { value: 'No State Income Tax', label: 'Texas Tax Advantage' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="font-heading text-display-sm font-bold text-yellow-400">{item.value}</div>
                    <div className="mt-1 text-body-sm text-white/70">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* VA Loan Benefits */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">Your Earned Benefit</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                6 Reasons the VA Loan is the Best Mortgage in America
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {VA_BENEFITS.map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <div key={benefit.title} className="rounded-2xl border border-border bg-background-cream p-7">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10">
                      <Icon className="h-6 w-6 text-gold" />
                    </div>
                    <h3 className="mb-2 font-heading text-heading-sm font-bold text-primary">{benefit.title}</h3>
                    <p className="text-body-sm text-foreground-muted leading-relaxed">{benefit.description}</p>
                  </div>
                );
              })}
            </div>
          </Container>
        </section>

        {/* VA Process */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-14 text-center">
              <p className="overline mb-3">Step by Step</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                The VA Home Buying Process
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-5">
              {VA_PROCESS_STEPS.map((step, i) => (
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

        {/* About David Reyes */}
        <section className="section-compact bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">Your VA Specialist</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Meet David Reyes —<br />A Veteran Who Gets It
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  David Reyes is a retired U.S. Army veteran and a licensed Texas REALTOR® with over 7 years of experience helping military families navigate the home buying process in San Antonio and the Hill Country. He has personally used the VA loan benefit and has helped hundreds of fellow veterans and active-duty service members do the same.
                </p>
                <p className="mb-7 text-body text-foreground-muted leading-relaxed">
                  David understands the unique pressures of a PCS move — the tight timelines, the uncertainty, the need to find a home remotely before your family arrives. He builds his entire client process around those realities. Whether you have 30 days or 90 days, David will get you into the right home.
                </p>
                <ul className="mb-8 space-y-3">
                  {[
                    'Retired U.S. Army veteran',
                    'Specialized VA loan and PCS relocation expertise',
                    '7+ years of Hill Country market experience',
                    'Virtual tours and remote closings available',
                    'Available outside normal business hours for military clients',
                    'All branches welcome: Army, Air Force, Navy, Marines, Coast Guard',
                  ].map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-body-sm text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button size="lg" asChild>
                  <Link href="/contact?service=military">
                    Talk to David <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="rounded-2xl bg-primary p-8 sm:p-10 text-white">
                <Medal className="mb-5 h-10 w-10 text-yellow-400" />
                <h3 className="mb-4 font-heading text-heading-xl font-bold text-white">
                  BAH in San Antonio
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  San Antonio BAH rates are competitive and can cover a significant portion — or in some cases all — of your monthly mortgage payment in the Hill Country suburbs. We&apos;ll help you understand how to structure your purchase to maximize your monthly housing allowance.
                </p>
                <ul className="space-y-3">
                  {[
                    'E-5 with dependents: ~$1,800–$2,100/mo',
                    'O-3 with dependents: ~$2,100–$2,500/mo',
                    'O-5 with dependents: ~$2,400–$2,800/mo',
                    'Many Hill Country homes within BAH range',
                    'No state income tax means more buying power',
                  ].map(item => (
                    <li key={item} className="flex items-center gap-2.5 text-body-sm text-white/70">
                      <CheckCircle className="h-4 w-4 shrink-0 text-yellow-400" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-caption text-white/40">BAH rates are estimates and subject to annual adjustment by DoD.</p>
              </div>
            </div>
          </Container>
        </section>

        {/* VA FAQ */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">Common Questions</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                VA Loan FAQs
              </h2>
            </div>

            <div className="mx-auto max-w-3xl space-y-4">
              {VA_FAQS.map(({ q, a }) => (
                <details
                  key={q}
                  className="group rounded-2xl border border-border bg-white shadow-sm overflow-hidden"
                >
                  <summary className="flex cursor-pointer items-start justify-between gap-4 px-6 py-5 font-heading text-heading-sm font-semibold text-primary list-none">
                    <span>{q}</span>
                    <span className="mt-0.5 shrink-0 text-gold group-open:rotate-45 transition-transform duration-200 text-xl leading-none">+</span>
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
            <div className="rounded-2xl bg-blue-900 px-8 py-14 text-center text-white">
              <Medal className="mx-auto mb-5 h-12 w-12 text-yellow-400" />
              <p className="overline mb-3 text-yellow-400">No Cost. No Obligation.</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Schedule Your Free VA Consultation
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                30 minutes with a veteran-specialist agent can save you thousands. Let&apos;s review your VA entitlement, your budget, and your timeline — completely free.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  href="/contact?service=military"
                  className="inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-8 py-3.5 text-body font-bold text-blue-900 hover:bg-yellow-300 transition-colors"
                >
                  Book Free VA Consultation <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="tel:+12103909997"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-8 py-3.5 text-body font-semibold text-white hover:bg-white/10 transition-colors"
                >
                  <Phone className="h-4 w-4" />(210) 390-9997
                </a>
              </div>
            </div>
          </Container>
        </section>

      </main>
      <Footer />
    </>
  );
}
