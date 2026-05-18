'use client';

import { useState } from 'react';
import { CheckCircle, TrendingUp, Laptop, Megaphone, Users, Award, DollarSign } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { trackLead, trackPhoneClick } from '@/lib/analytics';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const PERKS = [
  {
    icon: DollarSign,
    title: 'Competitive Splits',
    description: 'Industry-leading commission structures with no desk fees eating into your earnings.',
  },
  {
    icon: Laptop,
    title: 'Tech & CRM Tools',
    description: 'Full access to our custom CRM, automated drip campaigns, and lead management platform.',
  },
  {
    icon: Megaphone,
    title: 'Marketing Support',
    description: 'Professional photography, listing presentations, social media content, and brand resources.',
  },
  {
    icon: TrendingUp,
    title: 'Proven Lead Flow',
    description: 'Benefit from our established online presence, Zillow partnerships, and referral network.',
  },
  {
    icon: Users,
    title: 'Collaborative Culture',
    description: 'A team-first environment where experienced agents mentor and support each other.',
  },
  {
    icon: Award,
    title: 'Local Market Authority',
    description: 'Leverage our 20+ years of Texas Hill Country expertise and trusted brand recognition.',
  },
];

const PRODUCTION_OPTIONS = [
  'Under $2M',
  '$2M – $5M',
  '$5M – $10M',
  '$10M – $20M',
  '$20M+',
  'New Agent / Pre-License',
];

export default function JoinPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const data = new FormData(e.currentTarget);
    const payload = {
      name: data.get('name'),
      email: data.get('email'),
      phone: data.get('phone'),
      license: data.get('license'),
      experience: data.get('experience'),
      current_brokerage: data.get('current_brokerage'),
      production: data.get('production'),
      message: data.get('message'),
    };

    try {
      const res = await fetch('/api/agent-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Submission failed');
      setSubmitted(true);
      trackLead({ form_type: 'agent_apply' });
    } catch {
      setError('Something went wrong. Please try again or call us at (210) 390-9997.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">

        {/* Hero */}
        <div className="relative bg-primary py-16 sm:py-20 text-white overflow-hidden">
          <div className="absolute inset-0 bg-[url('/images/hero-bg.jpg')] bg-cover bg-center opacity-10" />
          <Container className="relative">
            <p className="overline mb-3 text-gold">We&apos;re Growing</p>
            <h1 className="font-heading text-display-sm font-bold max-w-2xl">
              Build Your Career With<br />
              <span className="text-gold">Fair Oaks Realty Group</span>
            </h1>
            <p className="mt-4 text-body text-white/70 max-w-xl">
              Join one of the Texas Hill Country&apos;s most trusted real estate teams. Whether you&apos;re an experienced agent or just starting out, we have the tools, support, and culture to help you thrive.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a href="#apply"
                className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 font-semibold text-primary transition-colors hover:bg-gold-dark">
                Apply Now
              </a>
              <a href="tel:+12103909997" onClick={() => trackPhoneClick('join_page')}
                className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-6 py-3 font-semibold text-white transition-colors hover:border-gold hover:text-gold">
                Call (210) 390-9997
              </a>
            </div>
          </Container>
        </div>

        {/* Why Join */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="text-center mb-12">
              <p className="overline mb-2 text-gold">Why Fair Oaks</p>
              <h2 className="font-heading text-display-xs font-bold text-primary">
                Everything You Need to Succeed
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {PERKS.map((perk) => (
                <div key={perk.title} className="rounded-2xl bg-white p-6 shadow-card">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gold/15">
                    <perk.icon className="h-6 w-6 text-gold-dark" />
                  </div>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">{perk.title}</h3>
                  <p className="text-body-sm text-foreground-muted">{perk.description}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Application Form */}
        <section id="apply" className="section-luxury bg-white">
          <Container>
            <div className="mx-auto max-w-3xl">
              <div className="mb-10 text-center">
                <p className="overline mb-2 text-gold">Join Our Team</p>
                <h2 className="font-heading text-display-xs font-bold text-primary">Agent Application</h2>
                <p className="mt-3 text-body text-foreground-muted">
                  Tell us a bit about yourself and we&apos;ll be in touch within 1 business day.
                </p>
              </div>

              <div className="rounded-2xl bg-background-cream p-6 sm:p-10 shadow-card">
                {submitted ? (
                  <div className="py-12 text-center">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gold/20">
                      <CheckCircle className="h-8 w-8 text-gold-dark" />
                    </div>
                    <h3 className="mb-2 font-heading text-heading-xl font-bold text-primary">
                      Application Received!
                    </h3>
                    <p className="text-body text-foreground-muted max-w-md mx-auto">
                      Thanks for your interest in joining Fair Oaks Realty Group. A member of our leadership team will reach out within 1 business day.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Name + Email */}
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label className="label-readable">Full Name *</label>
                        <input
                          name="name" required placeholder="Jane Smith"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>
                      <div>
                        <label className="label-readable">Email Address *</label>
                        <input
                          name="email" type="email" required placeholder="you@example.com"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>
                    </div>

                    {/* Phone + License */}
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label className="label-readable">Phone *</label>
                        <input
                          name="phone" type="tel" required placeholder="(210) 555-0000"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>
                      <div>
                        <label className="label-readable">TX License # <span className="text-foreground-muted font-normal">(if active)</span></label>
                        <input
                          name="license" placeholder="e.g. 0000000"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>
                    </div>

                    {/* Years Experience + Current Brokerage */}
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label className="label-readable">Years of Experience</label>
                        <select
                          name="experience"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                        >
                          <option value="">Select…</option>
                          <option>Pre-License / New Agent</option>
                          <option>Less than 1 year</option>
                          <option>1–3 years</option>
                          <option>3–5 years</option>
                          <option>5–10 years</option>
                          <option>10+ years</option>
                        </select>
                      </div>
                      <div>
                        <label className="label-readable">Current Brokerage</label>
                        <input
                          name="current_brokerage" placeholder="e.g. Keller Williams, eXp, etc."
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>
                    </div>

                    {/* Annual Production */}
                    <div>
                      <label className="label-readable">Annual Production Volume (last 12 months)</label>
                      <select
                        name="production"
                        className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                      >
                        <option value="">Select…</option>
                        {PRODUCTION_OPTIONS.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>

                    {/* Why FORG */}
                    <div>
                      <label className="label-readable">Why do you want to join Fair Oaks Realty Group?</label>
                      <textarea
                        name="message" rows={4}
                        placeholder="Tell us what you're looking for in a brokerage and what you'd bring to the team…"
                        className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold resize-none"
                      />
                    </div>

                    {error && (
                      <p className="rounded-lg bg-red-50 px-4 py-3 text-body-sm text-red-600">{error}</p>
                    )}

                    <p className="text-caption text-foreground-muted">
                      By submitting, you agree to be contacted by Fair Oaks Realty Group regarding your application.
                    </p>

                    <Button type="submit" size="lg" fullWidth loading={loading}>
                      Submit Application
                    </Button>
                  </form>
                )}
              </div>
            </div>
          </Container>
        </section>

      </main>
      <Footer />
    </>
  );
}
