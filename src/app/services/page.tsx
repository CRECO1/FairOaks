'use client';

import Link from 'next/link';
import {
  Home, TrendingUp, Building2, Truck, Hammer,
  Shield, Star, CheckCircle, ArrowRight, Phone, Medal,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { RevealOnScroll } from '@/hooks/useScrollReveal';

const SERVICES = [
  {
    id: 'buyer',
    icon: Home,
    label: 'Buyer Representation',
    tagline: 'Your Advocate From Search to Keys',
    color: 'bg-gold/10 text-gold',
    description:
      'Finding the right home in a competitive market takes more than a search portal. We guide you through every step — from understanding your needs and budget to crafting winning offers and navigating inspections.',
    bullets: [
      'Access to MLS & off-market listings before they hit Zillow',
      'Expert neighborhood knowledge across the Hill Country',
      'Contract negotiation to protect your interests',
      'Full coordination through inspection, appraisal & closing',
      'No cost to buyers — our commission is paid by the seller',
    ],
    cta: { label: 'Start Your Home Search', href: '/listings' },
  },
  {
    id: 'seller',
    icon: TrendingUp,
    label: 'Seller Representation',
    tagline: 'Maximum Exposure. Maximum Price.',
    color: 'bg-gold/10 text-gold',
    description:
      'We don\'t just list your home — we market it. Our proven system combines professional photography, targeted digital advertising, and a deep buyer network to get you the best possible price in the shortest time.',
    bullets: [
      'Professional photography & virtual tour included',
      'Custom marketing plan tailored to your home',
      'MLS listing + targeted social & email campaigns',
      'Skilled negotiation to maximize your net proceeds',
      'No upfront marketing costs — you pay nothing unless we sell',
    ],
    cta: { label: 'Get a Free Home Valuation', href: '/sell' },
  },
  {
    id: 'military',
    icon: Medal,
    label: 'Military & VA Homebuying',
    tagline: 'Serving Those Who Serve',
    color: 'bg-blue-500/10 text-blue-600',
    highlight: true,
    description:
      'San Antonio is home to one of the largest military communities in the nation — Fort Sam Houston, Randolph, Lackland, and more. We proudly serve active duty service members, veterans, and their families with specialized expertise in VA financing and military relocation.',
    bullets: [
      'VA loan specialists who know how to maximize your benefit',
      'PCS relocation — we work around your orders & timeline',
      '$0 down payment options and no PMI with VA loans',
      'Familiarity with BAH rates across all local installations',
      'Priority scheduling and remote/virtual tours for deployed buyers',
      'Veterans: we honor your service with the same dedication you showed ours',
    ],
    cta: { label: 'Talk to a VA Specialist', href: '/contact?service=military' },
  },
  {
    id: 'relocation',
    icon: Truck,
    label: 'Relocation Services',
    tagline: 'Moving to Texas Hill Country? We\'ve Got You.',
    color: 'bg-gold/10 text-gold',
    description:
      'Whether you\'re moving from across the state or across the country, our relocation specialists make the transition seamless. We do the legwork so you can focus on the move.',
    bullets: [
      'Virtual tours and remote closings available',
      'Neighborhood match based on lifestyle, commute & schools',
      'Trusted network of movers, lenders & local vendors',
      'Employer & corporate relocation packages welcome',
      'Same-week showings for time-sensitive relocations',
    ],
    cta: { label: 'Plan Your Relocation', href: '/contact?service=relocation' },
  },
  {
    id: 'new-construction',
    icon: Hammer,
    label: 'New Construction',
    tagline: 'Build the Home You\'ve Always Envisioned',
    color: 'bg-gold/10 text-gold',
    description:
      'Navigating new construction is different — builder contracts favor the builder. We represent your interests throughout the entire build process, from lot selection and design center choices to the final walk-through.',
    bullets: [
      'Representation at no extra cost — builders pay our fee',
      'Knowledge of top builders in the Hill Country market',
      'Help negotiating upgrades, lot premiums & closing costs',
      'Third-party inspection coordination during construction',
      'Guidance on build timelines and financing options',
    ],
    cta: { label: 'Explore New Construction', href: '/listings?type=new-construction' },
  },
  {
    id: 'commercial',
    icon: Building2,
    label: 'Commercial Real Estate',
    tagline: 'Invest, Expand, or Relocate Your Business',
    color: 'bg-gold/10 text-gold',
    description:
      'For commercial real estate needs, we partner with our sister company CRECO — a dedicated commercial brokerage serving the greater San Antonio market. From retail and office space to investment properties and land, CRECO brings deep expertise and the same standard of service you expect from Fair Oaks Realty Group.',
    bullets: [
      'Office, retail, industrial & mixed-use properties',
      'Investment property analysis and cap rate evaluation',
      'Land acquisition for development projects',
      'Lease negotiation and tenant representation',
      'Local zoning knowledge across Bexar & Kendall counties',
    ],
    cta: { label: 'Visit CRECO — Our Commercial Division', href: 'https://crecotx.com' },
  },
];

const WHY_US = [
  { icon: Star,       text: '20+ years of Texas Hill Country expertise' },
  { icon: Shield,     text: 'Fiduciary duty — your interests always come first' },
  { icon: Medal,      text: 'Proud military community partners' },
  { icon: CheckCircle, text: 'Transparent communication at every step' },
];

export default function ServicesPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">

        {/* Hero */}
        <section className="bg-primary py-16 sm:py-24 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">Full-Service Real Estate</p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Every Service You Need,<br />
                <span className="text-gradient-gold">Under One Roof</span>
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Whether you&apos;re buying, selling, building, relocating, or serving our country — Fair Oaks Realty Group has the expertise and local knowledge to guide you every step of the way.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/contact">Get Started Today</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Military spotlight banner */}
        <section className="bg-blue-900 py-5 text-white">
          <Container>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Medal className="h-7 w-7 text-yellow-400 shrink-0" />
                <p className="text-body font-semibold">
                  Proud to serve our military community — VA loan experts &amp; PCS specialists on staff.
                </p>
              </div>
              <Link
                href="/contact?service=military"
                className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-5 py-2.5 text-body-sm font-bold text-blue-900 hover:bg-yellow-300 transition-colors"
              >
                Talk to a VA Specialist <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Container>
        </section>

        {/* Services Grid */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <RevealOnScroll>
              <div className="mb-14 text-center">
                <p className="overline mb-3">What We Do</p>
                <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                  Our Services
                </h2>
              </div>
            </RevealOnScroll>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              {SERVICES.map((service, i) => {
                const Icon = service.icon;
                return (
                  <RevealOnScroll key={service.id} delay={i * 80}>
                    <div className={`rounded-2xl bg-white p-7 sm:p-9 shadow-sm border ${service.highlight ? 'border-blue-200 ring-2 ring-blue-200' : 'border-border'} h-full flex flex-col`}>
                      <div className="flex items-start gap-4 mb-5">
                        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${service.color}`}>
                          <Icon className="h-6 w-6" />
                        </div>
                        <div>
                          {service.highlight && (
                            <span className="mb-1 inline-block rounded-full bg-blue-100 px-3 py-0.5 text-caption font-semibold uppercase tracking-wider text-blue-700">
                              Military &amp; VA
                            </span>
                          )}
                          <h3 className="font-heading text-heading font-bold text-primary">{service.label}</h3>
                          <p className="text-body-sm text-gold font-semibold">{service.tagline}</p>
                        </div>
                      </div>

                      <p className="mb-5 text-body text-foreground-muted leading-relaxed">{service.description}</p>

                      <ul className="mb-7 space-y-2.5 flex-1">
                        {service.bullets.map(b => (
                          <li key={b} className="flex items-start gap-2.5 text-body-sm text-foreground-muted">
                            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                            {b}
                          </li>
                        ))}
                      </ul>

                      <Link
                        href={service.cta.href}
                        className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-body-sm font-semibold transition-colors ${
                          service.highlight
                            ? 'bg-blue-900 text-white hover:bg-blue-800'
                            : 'bg-primary text-white hover:bg-gold'
                        }`}
                      >
                        {service.cta.label} <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </RevealOnScroll>
                );
              })}
            </div>
          </Container>
        </section>

        {/* Why Fair Oaks */}
        <section className="section-compact bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <RevealOnScroll direction="left">
                <p className="overline mb-3 text-gold">Why Us</p>
                <h2 className="mb-6 font-heading text-display-sm font-bold text-primary">
                  The Fair Oaks Realty<br />Difference
                </h2>
                <p className="mb-8 text-body text-foreground-muted leading-relaxed">
                  We&apos;re not a national franchise. We&apos;re your neighbors — rooted in Fair Oaks Ranch and the Texas Hill Country, with relationships built over two decades of helping families find their place here.
                </p>
                <ul className="space-y-4">
                  {WHY_US.map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-center gap-3 text-body text-foreground-muted">
                      <Icon className="h-5 w-5 shrink-0 text-gold" />
                      {text}
                    </li>
                  ))}
                </ul>
              </RevealOnScroll>

              <RevealOnScroll direction="right">
                <div className="rounded-2xl bg-primary p-8 sm:p-10 text-white">
                  <Medal className="mb-5 h-10 w-10 text-yellow-400" />
                  <h3 className="mb-4 font-heading text-heading-xl font-bold text-white">
                    Committed to Our Military Community
                  </h3>
                  <p className="mb-5 text-body text-white/70 leading-relaxed">
                    San Antonio is a military city, and we take that seriously. From PCS moves on tight timelines to maximizing VA loan benefits, our team understands the unique challenges service members and their families face. We move at your pace — not ours.
                  </p>
                  <ul className="mb-7 space-y-2 text-body-sm text-white/70">
                    {[
                      'Active duty, veterans & surviving spouses',
                      'All branches: Army, Air Force, Navy, Marines, Coast Guard',
                      'Remote closings for deployed buyers',
                      'Flexible scheduling around your orders',
                    ].map(item => (
                      <li key={item} className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 shrink-0 text-yellow-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/contact?service=military"
                    className="inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-6 py-3 text-body-sm font-bold text-blue-900 hover:bg-yellow-300 transition-colors"
                  >
                    Connect with a VA Specialist <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </RevealOnScroll>
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-background-cream">
          <Container>
            <RevealOnScroll>
              <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
                <p className="overline mb-3 text-gold">Ready to Get Started?</p>
                <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                  Let&apos;s Talk About Your Goals
                </h2>
                <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                  No pressure, no obligation. A quick conversation with one of our agents is the best first step.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Button size="lg" asChild>
                    <Link href="/contact">Contact Us</Link>
                  </Button>
                  <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                    <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                  </Button>
                </div>
              </div>
            </RevealOnScroll>
          </Container>
        </section>

      </main>
      <Footer />
    </>
  );
}
