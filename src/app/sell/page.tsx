'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingUp, Clock, DollarSign, Users, CheckCircle, ArrowRight, Phone } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { RevealOnScroll } from '@/hooks/useScrollReveal';

const STEPS = [
  { number: '01', title: 'Free Home Valuation', description: 'We analyze recent sales, market trends, and your home\'s unique features to establish the ideal listing price.' },
  { number: '02', title: 'Strategic Preparation', description: 'Professional photography, staging consultation, and a custom marketing plan designed to attract the right buyers.' },
  { number: '03', title: 'Maximum Market Exposure', description: 'MLS listing, targeted social media campaigns, email blasts to our buyer database, and featured placement on top real estate sites.' },
  { number: '04', title: 'Skilled Negotiation', description: 'We represent your interests fiercely — reviewing every offer and negotiating to get you the best possible terms.' },
  { number: '05', title: 'Smooth Closing', description: 'We coordinate inspections, appraisals, title, and every detail so your closing is stress-free.' },
];

const STATS = [
  { icon: TrendingUp, value: '103%', label: 'Avg. List-to-Sale Price' },
  { icon: Clock, value: '21', label: 'Avg. Days on Market' },
  { icon: DollarSign, value: '$0', label: 'Upfront Marketing Cost' },
  { icon: Users, value: '500+', label: 'Homes Sold' },
];

export default function SellPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const data = new FormData(e.currentTarget);
    await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.get('name'),
        email: data.get('email'),
        phone: data.get('phone'),
        message: `Address: ${data.get('address')}\nTimeline: ${data.get('timeline')}\nAdditional info: ${data.get('notes')}`,
        source: 'valuation',
      }),
    }).catch(() => {});
    setLoading(false);
    setSubmitted(true);
  }

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">
        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 sm:mb-4 text-gold">Sell with Confidence</p>
                <h1 className="mb-5 sm:mb-6 font-heading text-display font-bold text-white">
                  Get the Best Price<br />
                  <span className="text-gradient-gold">for Your Home</span>
                </h1>
                <p className="mb-6 sm:mb-8 max-w-lg text-body-lg text-white/70">
                  Our proven marketing system and deep knowledge of the Texas Hill Country market consistently delivers results above asking price — and fewer days on market.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <Button size="lg" className="w-full sm:w-auto" asChild>
                    <a href="#valuation">Get My Free Valuation</a>
                  </Button>
                  <Button size="lg" variant="outline" className="w-full sm:w-auto border-white/30 text-white hover:bg-white/10" asChild>
                    <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:gap-5">
                {STATS.map(({ icon: Icon, value, label }) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-6 text-center backdrop-blur-sm">
                    <Icon className="mx-auto mb-3 h-8 w-8 text-gold" />
                    <div className="font-heading text-display-sm font-bold text-white">{value}</div>
                    <div className="mt-1 text-caption uppercase tracking-wider text-white/50">{label}</div>
                  </div>
                ))}
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
                    '20+ years of local Hill Country market expertise',
                  ].map(item => (
                    <li key={item} className="flex items-start gap-3 text-body text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                      {item}
                    </li>
                  ))}
                </ul>
              </RevealOnScroll>

              {/* Valuation Form */}
              <RevealOnScroll direction="right">
                <div id="valuation" className="rounded-2xl bg-background-cream p-5 sm:p-8 lg:p-10">
                  {submitted ? (
                    <div className="text-center py-8">
                      <CheckCircle className="mx-auto mb-4 h-14 w-14 text-gold" />
                      <h3 className="font-heading text-heading-xl font-bold text-primary mb-2">Request Received!</h3>
                      <p className="text-body text-foreground-muted">
                        One of our agents will reach out within 24 hours to discuss your home&apos;s value.
                      </p>
                    </div>
                  ) : (
                    <>
                      <h3 className="mb-2 font-heading text-heading-xl font-bold text-primary">Get Your Free Home Valuation</h3>
                      <p className="mb-6 text-body-sm text-foreground-muted">No obligations. We&apos;ll provide a detailed market analysis within 24 hours.</p>
                      <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <input name="name" required placeholder="Your Name" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                          <input name="phone" type="tel" placeholder="Phone Number" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                        </div>
                        <input name="email" type="email" required placeholder="Email Address" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                        <input name="address" required placeholder="Property Address" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                        <select name="timeline" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold">
                          <option value="">When are you looking to sell?</option>
                          <option>ASAP (within 30 days)</option>
                          <option>1–3 months</option>
                          <option>3–6 months</option>
                          <option>6–12 months</option>
                          <option>Just exploring</option>
                        </select>
                        <textarea name="notes" rows={3} placeholder="Anything else we should know about your home?" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold resize-none" />
                        <Button type="submit" size="lg" fullWidth loading={loading}>
                          Request Free Valuation
                          <ArrowRight className="ml-2 h-5 w-5" />
                        </Button>
                      </form>
                    </>
                  )}
                </div>
              </RevealOnScroll>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
