import type { Metadata } from 'next';
import { FORG } from '@/lib/site-identity';
import Link from 'next/link';
import { CheckCircle, Phone, Search, Home, ArrowRight } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';
import { THANK_YOU_FORMS, safeListingPath, type ThankYouForm } from '@/lib/thank-you';

export const metadata: Metadata = {
  // The root layout's title template appends " | Fair Oaks Realty Group".
  title: 'Thank You',
  description: 'Thank you for contacting Fair Oaks Realty Group. A member of our team will be in touch personally.',
  robots: 'noindex, nofollow',
};

const NEXT_STEPS = [
  {
    icon: Phone,
    title: 'Expect a call or email',
    body: 'A member of our team will reach out to you personally.',
  },
  {
    icon: Search,
    title: 'Browse active listings',
    body: 'Get a head start — search our live MLS listings while you wait.',
    href: '/listings',
    cta: 'Search Listings',
  },
  {
    icon: Home,
    title: 'Explore neighborhoods',
    body: 'Not sure where to focus? Our neighborhood guides break down schools, pricing, and lifestyle.',
    href: '/neighborhoods',
    cta: 'View Neighborhoods',
  },
];

// The one success page for every lead form (see lib/thank-you.ts). ?form= picks the
// heading so the visitor sees their request acknowledged in its own terms.
const HEADLINES: Record<ThankYouForm, { title: string; body: string }> = {
  contact:   { title: 'You\u2019re all set!',               body: 'We received your message and will be in touch personally. Keep an eye on your phone and email.' },
  valuation: { title: 'Your valuation request is in',      body: 'Zack will look at recent sales near your home and reach out personally with your valuation. Keep an eye on your phone and email.' },
  listing:   { title: 'We\u2019ve got your question',       body: 'We received your inquiry about this home and will be in touch personally. Keep an eye on your phone and email.' },
  showing:   { title: 'Showing request received',          body: 'We\u2019ll call you shortly to find a time that works. Keep an eye on your phone.' },
  quiz:      { title: 'Your results are on the way!',      body: 'One of our local experts will reach out personally with homes matched to your answers.' },
  'market-report': { title: 'You\u2019re on the list',      body: 'We\u2019ll send you the Fair Oaks Ranch & Hill Country market update. In the meantime, the live numbers are always on our market report page.' },
};

export default async function ThankYouPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const formParam = typeof sp.form === 'string' ? sp.form : '';
  const form: ThankYouForm = (THANK_YOU_FORMS as readonly string[]).includes(formParam) ? formParam as ThankYouForm : 'contact';
  const backToListing = safeListingPath(typeof sp.from === 'string' ? sp.from : null);
  const headline = HEADLINES[form];

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20 bg-background-cream">
        {/* Hero */}
        <section className="bg-primary py-16 sm:py-20 text-white">
          <Container>
            <div className="max-w-2xl mx-auto text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gold/20">
                <CheckCircle className="h-10 w-10 text-gold" />
              </div>
              <h1 className="font-heading text-display-sm sm:text-display font-bold mb-4">
                {headline.title}
              </h1>
              <p className="text-body-lg text-white/75 leading-relaxed">
                {headline.body}
              </p>
              {backToListing && (
                <Link href={backToListing} className="mt-6 inline-flex items-center gap-1 text-body-sm font-semibold text-gold hover:text-gold/80 transition-colors">
                  Back to the home you were viewing <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          </Container>
        </section>

        {/* Next Steps */}
        <section className="py-16 sm:py-20">
          <Container>
            <div className="max-w-3xl mx-auto">
              <h2 className="font-heading text-heading-xl font-bold text-primary text-center mb-12">
                While you wait — here&apos;s what to do next
              </h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                {NEXT_STEPS.map(step => {
                  const Icon = step.icon;
                  return (
                    <div key={step.title} className="rounded-2xl border border-border bg-white p-6 shadow-sm flex flex-col">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10">
                        <Icon className="h-6 w-6 text-gold-dark" />
                      </div>
                      <h3 className="font-heading text-body-lg font-bold text-primary mb-2">{step.title}</h3>
                      <p className="text-body-sm text-foreground-muted leading-relaxed flex-1">{step.body}</p>
                      {step.href && (
                        <Link
                          href={step.href}
                          className="mt-4 inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:text-gold transition-colors"
                        >
                          {step.cta} <ArrowRight className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Direct contact */}
              <div className="mt-10 rounded-2xl bg-primary px-8 py-10 text-center text-white">
                <p className="text-body font-semibold text-white/80 mb-2">Need to reach us right now?</p>
                <a
                  href="tel:+12103909997"
                  className="font-heading text-display-sm font-bold text-gold hover:text-gold/80 transition-colors"
                >
                  210-390-9997
                </a>
                <p className="mt-2 text-body-sm text-white/50">{FORG.hoursShort} · Central</p>
              </div>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
