'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Phone, Mail, Award, User, X, CheckCircle2 } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';
import { RevealOnScroll } from '@/hooks/useScrollReveal';
import { supabase } from '@/lib/supabase';

// The public team page shows only real agents from the `agents` table. There is
// deliberately no placeholder roster here: a failed query used to publish four
// fictitious agents, complete with invented names, bios and TX licence numbers.
interface Agent {
  id: string; name: string; slug: string; title: string; email: string; phone: string;
  image_url: string | null; license_number: string | null; years_experience: number | null;
  featured: boolean; order: number; specialties: string[] | null; bio: string | null;
}


const VALUES = [
  {
    title: 'Local Expertise',
    description: 'We live, work, and raise families in the communities we serve. Our boots-on-the-ground knowledge gives you an insider advantage in every transaction.',
  },
  {
    title: 'Honest Communication',
    description: 'We tell you what you need to hear, not just what you want to hear. Straight talk, clear guidance, and full transparency from first showing to closing day.',
  },
  {
    title: 'Community First',
    description: 'The Hill Country is more than a market to us — it\'s home. We are invested in the long-term health of these neighborhoods and the families who call them home.',
  },
];

const CREDENTIALS = [
  'REALTOR® Member',
  'Texas REALTORS® Member',
  'SABOR Member',
];

export default function TeamPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);

  useEffect(() => {
    supabase
      .from('agents')
      .select('*')
      .order('order', { ascending: true })
      .then(({ data, error }) => {
        // Never substitute placeholder agents — an empty roster is the honest
        // result of a failed or empty query.
        if (error || !data) { console.error('[team] agents query failed', error); setAgents([]); }
        else setAgents(data as Agent[]);
      });
  }, []);

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">

        {/* ── Section A: Company Story Hero ─────────────────────────── */}
        <section className="bg-primary text-white">
          <Container className="py-20 md:py-28 lg:py-32">
            <RevealOnScroll>
              <p className="overline mb-3 text-gold">About Fair Oaks Realty Group</p>
              <h1 className="font-heading text-display-sm font-bold text-white max-w-3xl mb-5">
                Trusted{' '}
                <span className="text-gradient-gold">Hill Country Real Estate</span>
              </h1>
              <p className="text-body-lg text-white/70 max-w-2xl">
                Founded in 2024, Fair Oaks Realty Group has been the local experts families across
                Fair Oaks Ranch, Boerne, and the greater Texas Hill Country turn to when it matters
                most. We are not just agents — we are neighbors.
              </p>
            </RevealOnScroll>

          </Container>
        </section>

        {/* ── Section B: Our Mission ────────────────────────────────── */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-start">

              {/* Left: Mission Quote */}
              <RevealOnScroll direction="left">
                <p className="overline mb-4">Our Mission</p>
                <h2 className="font-heading text-display-sm font-bold text-primary mb-8 gold-line pb-4">
                  What We Believe
                </h2>
                <blockquote className="quote-luxury text-foreground-muted">
                  We believe buying or selling a home is one of the most important decisions
                  you&rsquo;ll ever make. Our job is to make it feel like the easiest.
                </blockquote>
                <p className="mt-8 text-body text-foreground-muted">
                  Since 2024, every decision we make has been guided by that belief. We don&rsquo;t
                  chase volume — we chase results for the families who trust us with their most
                  valuable asset.
                </p>
              </RevealOnScroll>

              {/* Right: Values */}
              <RevealOnScroll direction="right">
                <p className="overline mb-4">Our Values</p>
                <div className="space-y-6">
                  {VALUES.map(({ title, description }) => (
                    <div key={title} className="flex gap-4">
                      <CheckCircle2 className="h-6 w-6 text-gold shrink-0 mt-0.5" />
                      <div>
                        <h3 className="font-heading text-heading font-semibold text-primary mb-1">
                          {title}
                        </h3>
                        <p className="text-body-sm text-foreground-muted">{description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </RevealOnScroll>
            </div>
          </Container>
        </section>

        {/* ── Section C: Awards & Credentials ──────────────────────── */}
        <section className="section-compact bg-white border-y border-border">
          <Container>
            <RevealOnScroll>
              <p className="overline text-center mb-6">Professional Affiliations & Credentials</p>
            </RevealOnScroll>
            <RevealOnScroll>
              <div className="flex flex-wrap justify-center gap-3">
                {CREDENTIALS.map((credential) => (
                  <span
                    key={credential}
                    className="rounded-full border border-gold/40 bg-white px-5 py-2.5 text-body-sm font-semibold text-primary shadow-sm"
                  >
                    {credential}
                  </span>
                ))}
              </div>
            </RevealOnScroll>
          </Container>
        </section>

        {/* ── Agent Grid ───────────────────────────────────────────── */}
        <section className="section-luxury bg-white">
          <Container>
            <RevealOnScroll>
              <div className="mb-14 text-center">
                <p className="overline mb-3">The People Behind the Promise</p>
                <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                  Meet Our Team
                </h2>
                <p className="mx-auto mt-6 max-w-xl text-body text-foreground-muted">
                  Local experts who live, work, and raise families in the communities they serve.
                </p>
              </div>
            </RevealOnScroll>
            {agents.length === 0 && (
              <p className="text-center text-body text-foreground-muted">
                Our agent profiles are loading. If they don&apos;t appear, please{' '}
                <a href="/contact" className="text-gold underline">contact us</a> and we&apos;ll connect you with the right agent.
              </p>
            )}
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {agents.map((agent, i) => (
                <RevealOnScroll key={agent.id} delay={i * 80}>
                  <button
                    onClick={() => setSelected(agent)}
                    className="card-luxury group p-6 text-center w-full text-left focus:outline-none focus:ring-2 focus:ring-gold rounded-2xl transition-all hover:-translate-y-1"
                  >
                    <div className="mx-auto mb-5 h-28 w-28 rounded-full bg-background-warm overflow-hidden">
                      {agent.image_url ? (
                        <Image src={agent.image_url as string} alt={agent.name} width={112} height={112} className="object-cover w-full h-full" />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <User className="h-12 w-12 text-foreground-subtle" />
                        </div>
                      )}
                    </div>
                    <h3 className="font-heading text-heading font-semibold text-primary">{agent.name}</h3>
                    <p className="text-body-sm text-foreground-muted mt-1">{agent.title}</p>
                    {agent.license_number && (
                      <p className="text-caption text-foreground-subtle mt-1 mb-4">TREC License #{agent.license_number}</p>
                    )}
                    {!agent.license_number && <div className="mb-4" />}
                    {agent.specialties && (
                      <div className="flex flex-wrap justify-center gap-2 mb-5">
                        {(agent.specialties as string[]).slice(0, 3).map(s => (
                          <span key={s} className="rounded-full border border-border px-3 py-1 text-caption text-foreground-muted">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="text-caption font-semibold text-gold group-hover:underline">View Profile →</span>
                  </button>
                </RevealOnScroll>
              ))}
            </div>
          </Container>
        </section>

        {/* ── Join CTA (Hiring) ─────────────────────────────────────── */}
        <section className="section-luxury bg-primary text-white">
          <Container>
            <div className="mx-auto max-w-2xl text-center">
              <p className="overline mb-3 text-gold">We&apos;re Hiring</p>
              <h2 className="font-heading text-display-xs font-bold mb-4">
                Interested in Joining Our Team?
              </h2>
              <p className="text-body text-white/70 mb-8">
                We&apos;re always looking for talented, motivated agents who want to grow their career with one of the Texas Hill Country&apos;s most trusted brokerages.
              </p>
              <a
                href="/careers"
                className="inline-flex items-center gap-2 rounded-lg bg-gold px-8 py-3.5 font-semibold text-primary transition-colors hover:bg-gold-dark"
              >
                Join Our Team
              </a>
            </div>
          </Container>
        </section>
      </main>
      <Footer />

      {/* Bio Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setSelected(null)}
              className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-foreground-muted hover:text-primary shadow-sm transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Photo — portrait aspect ratio so full headshot shows */}
            <div className="relative w-full bg-background-warm" style={{ aspectRatio: '4/5', maxHeight: '420px' }}>
              {selected.image_url ? (
                <Image src={selected.image_url as string} alt={selected.name} fill className="object-cover object-top" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <User className="h-24 w-24 text-foreground-subtle" />
                </div>
              )}
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto">
              <p className="text-caption font-semibold uppercase tracking-widest text-gold mb-0.5">{selected.title}</p>
              <h2 className="font-heading text-heading-xl font-bold text-primary mb-1">{selected.name}</h2>
              {selected.license_number && (
                <p className="text-caption text-foreground-subtle mb-2">
                  TREC License #{selected.license_number}
                </p>
              )}

              {selected.years_experience && (
                <div className="flex items-center gap-1.5 mb-3">
                  <Award className="h-3.5 w-3.5 text-gold" />
                  <span className="text-caption text-foreground-muted">{selected.years_experience}+ years of experience</span>
                </div>
              )}

              {selected.bio && (
                <p className="text-body-sm text-foreground-muted leading-relaxed mb-4">{selected.bio as string}</p>
              )}

              {selected.specialties && (
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {(selected.specialties as string[]).map(s => (
                    <span key={s} className="rounded-full bg-background-cream border border-border px-2.5 py-0.5 text-caption text-foreground-muted">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                {selected.phone && (
                  <a
                    href={`tel:${(selected.phone as string).replace(/\D/g, '')}`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-caption font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    <Phone className="h-3.5 w-3.5" /> {selected.phone as string}
                  </a>
                )}
                <a
                  href={`mailto:${selected.email}`}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-caption font-semibold text-primary hover:border-gold hover:text-gold transition-colors"
                >
                  <Mail className="h-3.5 w-3.5" /> Email {(selected.name as string).split(' ')[0]}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
