'use client';

import Link from 'next/link';
import { TrendingUp, Clock, DollarSign, Users, CheckCircle, ArrowRight, Phone } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { ValuationCta } from '@/components/sections/ValuationCta';
import { trackPhoneClick } from '@/lib/analytics';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { RevealOnScroll } from '@/hooks/useScrollReveal';
import { BrokerTrustCard } from '@/components/sections/BrokerTrustCard';

const STEPS = [
  { number: '01', title: 'Free Home Valuation', description: 'We analyze recent sales, market trends, and your home\'s unique features to establish the ideal listing price.' },
  { number: '02', title: 'Strategic Preparation', description: 'Professional photography, staging consultation, and a custom marketing plan designed to attract the right buyers.' },
  { number: '03', title: 'Maximum Market Exposure', description: 'MLS listing, targeted social media campaigns, email blasts to our buyer database, and featured placement on top real estate sites.' },
  { number: '04', title: 'Skilled Negotiation', description: 'We represent your interests fiercely — reviewing every offer and negotiating to get you the best possible terms.' },
  { number: '05', title: 'Smooth Closing', description: 'We coordinate inspections, appraisals, title, and every detail so your closing is stress-free.' },
];

export default function SellPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">
        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <div>
                <p className="overline mb-3 sm:mb-4 text-gold">Sell with Confidence</p>
                <h1 className="mb-5 sm:mb-6 font-heading text-display font-bold text-white">
                  Get the Best Price<br />
                  <span className="text-gradient-gold">for Your Home</span>
                </h1>
                <p className="mb-6 sm:mb-8 max-w-lg text-body-lg text-white/70">
                  We price your home from real comparable sales, prepare it to show well, and market it across the Texas Hill Country — then negotiate for your best terms.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <Button size="lg" className="w-full sm:w-auto" asChild>
                    <Link href="/home-valuation?from=sell">Get My Free Valuation</Link>
                  </Button>
                  <Button size="lg" variant="outline" className="w-full sm:w-auto border-white/30 text-white hover:bg-white/10" asChild>
                    <a href="tel:+12103909997" onClick={() => trackPhoneClick('sell_page')}><Phone className="mr-2 h-4 w-4" />210-390-9997</a>
                  </Button>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* Process */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <RevealOnScroll>
              <div className="mb-14 text-center">
                <p className="overline mb-3">Our Process</p>
                <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                  How We Sell Your Home
                </h2>
              </div>
            </RevealOnScroll>

            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {STEPS.map((step, i) => (
                <RevealOnScroll key={step.number} delay={i * 100}>
                  <div className="text-center">
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-primary font-heading text-heading font-bold">
                      {step.number}
                    </div>
                    <h3 className="mb-3 font-heading text-heading-sm font-semibold text-primary">{step.title}</h3>
                    <p className="text-body-sm text-foreground-muted">{step.description}</p>
                  </div>
                </RevealOnScroll>
              ))}
            </div>
          </Container>
        </section>

        {/* Benefits */}
        <section className="section-compact bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <RevealOnScroll direction="left">
                <p className="overline mb-3 text-gold">Our Commitment</p>
                <h2 className="mb-6 font-heading text-display-sm font-bold text-primary">
                  The Fair Oaks Realty<br />Difference
                </h2>
                <ul className="space-y-4">
                  {[
                    'Professional photography & virtual tour at no extra cost',
                    'Custom property website for every listing',
                    'Targeted ads reaching active buyers in your price range',
                    'Weekly progress reports — we keep you informed',
                    'No sale, no fee — you pay nothing unless we sell',
                    'Deep local Hill Country market expertise',
                  ].map(item => (
                    <li key={item} className="flex items-start gap-3 text-body text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                      {item}
                    </li>
                  ))}
                </ul>
              </RevealOnScroll>

              {/* Valuation CTA */}
              <RevealOnScroll direction="right">
                <div id="valuation" className="rounded-2xl bg-background-cream p-5 sm:p-8 lg:p-10">
                  <BrokerTrustCard surface="sell_page" className="mb-6" />
                  {/* One valuation flow site-wide: /home-valuation, the page built for it. */}
                  <h3 className="mb-2 font-heading text-heading-xl font-bold text-primary">Get Your Free Home Valuation</h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    No obligation. Zack prepares it personally from recent sales near your home — four details and you&apos;re done.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/home-valuation?from=sell">
                      Request My Free Valuation
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Link>
                  </Button>
                </div>
              </RevealOnScroll>
            </div>
          </Container>
        </section>
      </main>
      <ValuationCta surface="sell" />
      <Footer />
    </>
  );
}
