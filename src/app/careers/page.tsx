'use client';

import { useState } from 'react';
import {
  CheckCircle, TrendingUp, Laptop, Megaphone, Users, Award,
  DollarSign, MapPin, Clock, Briefcase, ArrowRight, Star,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { trackLead } from '@/lib/analytics';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

// ─── Data ─────────────────────────────────────────────────────────────────────

const STATS = [
  { value: '20+', label: 'Years in Business' },
  { value: '$500M+', label: 'In Sales Volume' },
  { value: '1,000+', label: 'Families Served' },
  { value: '2', label: 'Offices (Res + Comm)' },
];

const OPEN_ROLES = [
  {
    title: 'Residential Real Estate Agent',
    type: 'Full-Time · Commission',
    location: 'Fair Oaks Ranch, TX',
    division: 'Residential',
    divisionColor: '#1e40af',
    divisionBg: '#dbeafe',
    description: 'Serve buyers, sellers, and relocation clients across the Texas Hill Country. Ideal for licensed agents looking for a high-support environment with built-in lead flow.',
    requirements: ['Active TX Real Estate License', 'Strong communication skills', 'Self-motivated with a client-first mindset', 'Experience preferred but new agents welcome'],
  },
  {
    title: 'Commercial Real Estate Agent',
    type: 'Full-Time · Commission',
    location: 'San Antonio / Hill Country, TX',
    division: 'Commercial (CRECO)',
    divisionColor: '#92400e',
    divisionBg: '#fef3c7',
    description: 'Work with investors, tenants, and landlords on industrial, office, and retail transactions. Join the CRECO team and tap into our established commercial network.',
    requirements: ['Active TX Real Estate License', 'Interest in commercial real estate', 'Strong negotiation skills', 'Experience in commercial preferred'],
  },
  {
    title: 'Real Estate Team Lead / Mentor',
    type: 'Full-Time · Commission + Override',
    location: 'Fair Oaks Ranch, TX',
    division: 'Residential',
    divisionColor: '#1e40af',
    divisionBg: '#dbeafe',
    description: 'Lead and mentor a small team of agents while maintaining your own book of business. Help shape the future of our brokerage and earn on your team\'s production.',
    requirements: ['5+ years real estate experience', 'Active TX Real Estate License', 'Proven production record', 'Passion for coaching others'],
  },
];

const PERKS = [
  { icon: DollarSign, title: 'Competitive Splits', description: 'Industry-leading commission structures with no desk fees eating into your earnings.' },
  { icon: Laptop, title: 'Tech & CRM Tools', description: 'Full access to our custom CRM, automated drip campaigns, and lead management platform.' },
  { icon: Megaphone, title: 'Marketing Support', description: 'Professional photography, listing presentations, social media content, and brand resources.' },
  { icon: TrendingUp, title: 'Proven Lead Flow', description: 'Benefit from our established online presence, Zillow partnerships, and referral network.' },
  { icon: Users, title: 'Collaborative Culture', description: 'A team-first environment where experienced agents mentor and support each other.' },
  { icon: Award, title: 'Local Market Authority', description: 'Leverage our 20+ years of Texas Hill Country expertise and trusted brand recognition.' },
];

const PRODUCTION_OPTIONS = ['Under $2M', '$2M – $5M', '$5M – $10M', '$10M – $20M', '$20M+', 'New Agent / Pre-License'];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CareersPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRole, setSelectedRole] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/agent-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          phone: data.get('phone'),
          license: data.get('license'),
          experience: data.get('experience'),
          current_brokerage: data.get('current_brokerage'),
          production: data.get('production'),
          message: `Position: ${selectedRole || 'Not specified'}\n\n${data.get('message') ?? ''}`,
        }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
      trackLead({ form_type: 'agent_apply' });
    } catch {
      setError('Something went wrong. Please try again or call (210) 390-9997.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">

        {/* ── Hero ── */}
        <div className="relative bg-primary py-20 sm:py-28 text-white overflow-hidden">
          <div className="absolute inset-0 bg-[url('/images/hero-bg.jpg')] bg-cover bg-center opacity-10" />
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-primary to-transparent" />
          <Container className="relative">
            <p className="overline mb-3 text-gold">Now Hiring</p>
            <h1 className="font-heading text-display-sm sm:text-display font-bold max-w-3xl leading-tight">
              Build a Career You're<br />
              <span className="text-gold">Proud Of</span>
            </h1>
            <p className="mt-5 text-body text-white/70 max-w-xl leading-relaxed">
              Fair Oaks Realty Group is growing — and we&apos;re looking for talented agents who want more than just a desk. Join a team that invests in your success.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a href="#open-roles" className="inline-flex items-center gap-2 rounded-lg bg-gold px-7 py-3.5 font-semibold text-primary transition-colors hover:bg-gold-dark">
                View Open Positions <ArrowRight className="h-4 w-4" />
              </a>
              <a href="#apply" className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-7 py-3.5 font-semibold text-white transition-colors hover:border-gold hover:text-gold">
                Apply Now
              </a>
            </div>
          </Container>
        </div>

        {/* ── Stats bar ── */}
        <div className="bg-gold py-8">
          <Container>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 text-center">
              {STATS.map(s => (
                <div key={s.label}>
                  <div className="font-heading text-3xl font-bold text-primary">{s.value}</div>
                  <div className="mt-1 text-body-sm font-medium text-primary/70">{s.label}</div>
                </div>
              ))}
            </div>
          </Container>
        </div>

        {/* ── Open Positions ── */}
        <section id="open-roles" className="section-luxury bg-background-cream">
          <Container>
            <div className="text-center mb-12">
              <p className="overline mb-2 text-gold">Open Positions</p>
              <h2 className="font-heading text-display-xs font-bold text-primary">Where Do You Fit?</h2>
              <p className="mt-3 text-body text-foreground-muted max-w-xl mx-auto">
                We have openings across both our residential and commercial divisions. Click any role to apply.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {OPEN_ROLES.map((role) => (
                <div key={role.title} className="flex flex-col rounded-2xl bg-white shadow-card overflow-hidden border border-border">
                  {/* Card header */}
                  <div className="p-6 pb-4">
                    <span className="inline-block rounded-full px-3 py-1 text-caption font-semibold mb-3"
                      style={{ background: role.divisionBg, color: role.divisionColor }}>
                      {role.division}
                    </span>
                    <h3 className="font-heading text-heading-xl font-bold text-primary mb-3">{role.title}</h3>
                    <div className="flex flex-col gap-1.5 mb-4">
                      <div className="flex items-center gap-2 text-body-sm text-foreground-muted">
                        <Briefcase className="h-3.5 w-3.5 text-gold-dark" />
                        {role.type}
                      </div>
                      <div className="flex items-center gap-2 text-body-sm text-foreground-muted">
                        <MapPin className="h-3.5 w-3.5 text-gold-dark" />
                        {role.location}
                      </div>
                    </div>
                    <p className="text-body-sm text-foreground-muted leading-relaxed">{role.description}</p>
                  </div>

                  {/* Requirements */}
                  <div className="px-6 pb-4 flex-1">
                    <div className="text-caption font-semibold uppercase tracking-widest text-foreground-muted mb-2">Requirements</div>
                    <ul className="space-y-1.5">
                      {role.requirements.map(r => (
                        <li key={r} className="flex items-start gap-2 text-body-sm text-foreground-muted">
                          <CheckCircle className="h-4 w-4 text-gold-dark mt-0.5 shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* CTA */}
                  <div className="p-6 pt-4 border-t border-border">
                    <a href="#apply"
                      onClick={() => setSelectedRole(role.title)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-body-sm font-semibold text-white transition-colors hover:bg-primary/90">
                      Apply for This Role <ArrowRight className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* ── Why Join ── */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="text-center mb-12">
              <p className="overline mb-2 text-gold">Why Fair Oaks</p>
              <h2 className="font-heading text-display-xs font-bold text-primary">
                Everything You Need to Succeed
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {PERKS.map((perk) => (
                <div key={perk.title} className="rounded-2xl bg-background-cream p-6">
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

        {/* ── Culture quote ── */}
        <section className="py-16 bg-primary text-white">
          <Container>
            <div className="mx-auto max-w-3xl text-center">
              <div className="flex justify-center mb-6 gap-1">
                {[...Array(5)].map((_, i) => <Star key={i} className="h-5 w-5 fill-gold text-gold" />)}
              </div>
              <blockquote className="font-heading text-2xl sm:text-3xl font-bold leading-relaxed mb-6">
                &ldquo;We don&apos;t just hand you a desk and wish you luck. We give you the tools, the leads, and the mentorship to actually build something.&rdquo;
              </blockquote>
              <p className="text-white/60 text-body-sm">— Fair Oaks Realty Group Leadership</p>
              <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
                <a href="#apply"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-8 py-3.5 font-semibold text-primary transition-colors hover:bg-gold-dark">
                  Apply Today
                </a>
                <a href="/team"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/30 px-8 py-3.5 font-semibold text-white transition-colors hover:border-gold hover:text-gold">
                  Meet the Team
                </a>
              </div>
            </div>
          </Container>
        </section>

        {/* ── What to expect ── */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 items-center">
              <div>
                <p className="overline mb-2 text-gold">The Process</p>
                <h2 className="font-heading text-display-xs font-bold text-primary mb-6">What Happens After You Apply</h2>
                <div className="space-y-6">
                  {[
                    { step: '01', title: 'Application Review', desc: 'We review every application personally — no automated rejections. Expect a response within 1 business day.' },
                    { step: '02', title: 'Discovery Call', desc: 'A 20–30 minute call with our leadership team to get to know you and answer any questions about the role.' },
                    { step: '03', title: 'Team Introduction', desc: 'Shadow a current agent for a day, see how we operate, and make sure we\'re the right fit for each other.' },
                    { step: '04', title: 'Offer & Onboarding', desc: 'Get your commission structure, CRM access, and marketing assets — and start building your business.' },
                  ].map(item => (
                    <div key={item.step} className="flex gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/20 font-heading text-body-sm font-bold text-gold-dark">
                        {item.step}
                      </div>
                      <div>
                        <h3 className="font-semibold text-primary mb-1">{item.title}</h3>
                        <p className="text-body-sm text-foreground-muted">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl bg-white p-8 shadow-card">
                <div className="flex items-center gap-3 mb-6">
                  <Clock className="h-5 w-5 text-gold-dark" />
                  <h3 className="font-heading text-heading-xl font-bold text-primary">Quick Facts</h3>
                </div>
                <div className="space-y-4">
                  {[
                    ['License Required?', 'Yes — or currently pursuing'],
                    ['Experience Required?', 'Not always — we welcome new agents'],
                    ['Desk Fees?', 'None'],
                    ['Team Size', 'Small & intentional — not a factory'],
                    ['Residential + Commercial?', 'Yes — both divisions available'],
                    ['Response Time', 'Within 1 business day'],
                  ].map(([q, a]) => (
                    <div key={q} className="flex justify-between items-start gap-4 py-3 border-b border-border last:border-0">
                      <span className="text-body-sm text-foreground-muted">{q}</span>
                      <span className="text-body-sm font-semibold text-primary text-right">{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* ── Application Form ── */}
        <section id="apply" className="section-luxury bg-white">
          <Container>
            <div className="mx-auto max-w-3xl">
              <div className="mb-10 text-center">
                <p className="overline mb-2 text-gold">Get Started</p>
                <h2 className="font-heading text-display-xs font-bold text-primary">Submit Your Application</h2>
                {selectedRole && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-gold/15 px-4 py-1.5 text-body-sm font-semibold text-gold-dark">
                    <Briefcase className="h-3.5 w-3.5" />
                    Applying for: {selectedRole}
                    <button onClick={() => setSelectedRole('')} className="ml-1 text-gold-dark/60 hover:text-gold-dark">✕</button>
                  </div>
                )}
                {!selectedRole && (
                  <p className="mt-3 text-body text-foreground-muted">
                    Not sure which role fits? Just apply and we&apos;ll figure it out together.
                  </p>
                )}
              </div>

              <div className="rounded-2xl bg-background-cream p-6 sm:p-10 shadow-card">
                {submitted ? (
                  <div className="py-14 text-center">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gold/20">
                      <CheckCircle className="h-8 w-8 text-gold-dark" />
                    </div>
                    <h3 className="mb-2 font-heading text-heading-xl font-bold text-primary">Application Received!</h3>
                    <p className="text-body text-foreground-muted max-w-md mx-auto">
                      Thanks for applying to Fair Oaks Realty Group. A member of our leadership team will reach out within 1 business day.
                    </p>
                    <div className="mt-6 flex justify-center gap-4 flex-wrap">
                      <a href="/team" className="text-body-sm font-semibold text-gold hover:text-gold-dark">Meet the Team →</a>
                      <a href="/" className="text-body-sm font-semibold text-foreground-muted hover:text-primary">Back to Home →</a>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label className="label-readable">Full Name *</label>
                        <input name="name" required placeholder="Jane Smith"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                      </div>
                      <div>
                        <label className="label-readable">Email Address *</label>
                        <input name="email" type="email" required placeholder="you@example.com"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label className="label-readable">Phone *</label>
                        <input name="phone" type="tel" required placeholder="(210) 555-0000"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                      </div>
                      <div>
                        <label className="label-readable">TX License # <span className="text-foreground-muted font-normal">(if active)</span></label>
                        <input name="license" placeholder="e.g. 0000000"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label className="label-readable">Position of Interest</label>
                        <select name="role" value={selectedRole} onChange={e => setSelectedRole(e.target.value)}
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold">
                          <option value="">Not sure / Open to options</option>
                          {OPEN_ROLES.map(r => <option key={r.title}>{r.title}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label-readable">Years of Experience</label>
                        <select name="experience"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold">
                          <option value="">Select…</option>
                          <option>Pre-License / New Agent</option>
                          <option>Less than 1 year</option>
                          <option>1–3 years</option>
                          <option>3–5 years</option>
                          <option>5–10 years</option>
                          <option>10+ years</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label className="label-readable">Current Brokerage</label>
                        <input name="current_brokerage" placeholder="e.g. Keller Williams, eXp…"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                      </div>
                      <div>
                        <label className="label-readable">Annual Production Volume</label>
                        <select name="production"
                          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold">
                          <option value="">Select…</option>
                          {PRODUCTION_OPTIONS.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="label-readable">Why do you want to join Fair Oaks Realty Group?</label>
                      <textarea name="message" rows={4}
                        placeholder="Tell us what you're looking for in a brokerage and what you'd bring to the team…"
                        className="w-full rounded-lg border border-border bg-white px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold resize-none" />
                    </div>
                    {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-body-sm text-red-600">{error}</p>}
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
