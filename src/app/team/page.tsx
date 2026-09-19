import { CheckCircle2 } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';
import { RevealOnScroll } from '@/hooks/useScrollReveal';
import { supabase } from '@/lib/supabase';
import { TeamRoster, type TeamAgent } from './TeamRoster';

// Server-rendered (ISR) so the roster — names, titles, TREC licence numbers and
// photos — is in the initial HTML. It used to be fetched in the browser after load,
// so crawlers saw only a "profiles are loading" message.
//
// The page shows only real agents from the `agents` table. There is deliberately no
// placeholder roster: a failed query once published four fictitious agents,
// complete with invented names, bios and TX licence numbers.
export const revalidate = 3600;

async function getAgents(): Promise<TeamAgent[]> {
  const { data, error } = await supabase.from('agents').select('*').order('order', { ascending: true });
  // Never substitute placeholder agents — an empty roster is the honest result of a
  // failed or empty query.
  if (error || !data) { console.error('[team] agents query failed', error); return []; }
  return data as TeamAgent[];
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

export default async function TeamPage() {
  const agents = await getAgents();

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
                Meet the{' '}
                <span className="text-gradient-gold">Fair Oaks Realty Group</span> Team
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
                  Our Licensed Agents
                </h2>
                <p className="mx-auto mt-6 max-w-xl text-body text-foreground-muted">
                  Local experts who live, work, and raise families in the communities they serve.
                </p>
              </div>
            </RevealOnScroll>
            <TeamRoster agents={agents} />
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
                We&apos;re always looking for talented, motivated agents who want to grow their career in the Texas Hill Country.
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
    </>
  );
}
