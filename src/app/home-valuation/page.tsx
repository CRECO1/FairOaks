import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle, Home, MapPin, Phone, UserCheck } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { jsonLdScript } from '@/lib/json-ld';
import { HomeValuationForm } from '@/components/sections/HomeValuationForm';
import { VALUATION_INCLUDES, VALUATION_DISCLAIMER } from '@/lib/valuation-copy';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export const metadata: Metadata = {
  title: { absolute: "What's My Home Worth? | Free Home Valuation | Fair Oaks Realty Group" },
  description:
    'Find out what your Fair Oaks Ranch, Boerne or Helotes home is worth. A free home valuation prepared personally by Zachary A. Stovall using recent Hill Country sales — not an automated estimate.',
  keywords: [
    "what's my home worth",
    'home valuation Fair Oaks Ranch',
    'home valuation Boerne TX',
    'what is my house worth Fair Oaks Ranch TX',
    'free home valuation Texas Hill Country',
    'Fair Oaks Ranch house value',
    'Boerne home value estimate',
    'Helotes home valuation',
    'comparative market analysis Fair Oaks Ranch',
    'how much is my house worth Boerne',
  ],
  alternates: { canonical: `${BASE_URL}/home-valuation` },
  openGraph: {
    title: "What's My Home Worth? | Free Home Valuation",
    description:
      'A free home valuation for your Fair Oaks Ranch, Boerne or Helotes home — prepared by a local broker, not an algorithm.',
    url: `${BASE_URL}/home-valuation`,
    type: 'website',
  },
};

/**
 * Honest answers only. There is no instant estimate on this site because we do
 * not hold the comparable-sales feed that would make one accurate — saying so
 * plainly is better for a seller than a number we cannot stand behind, and it
 * is the differentiator against the portals.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: 'How is a home valuation different from an online estimate?',
    a: 'An online estimate is produced by an algorithm working from public records and past sales. It has never been inside your house, so it cannot see a renovated kitchen, a failing roof, a premium lot, or a floor plan buyers dislike. A broker valuation starts from the same comparable sales and then adjusts for what is actually true of your home. On an unusual property — acreage, a custom build, significant updates, or anything the neighbourhood has few matches for — the gap between the two can be large.',
  },
  {
    q: 'Is a home valuation the same as an appraisal?',
    a: 'No. An appraisal is a formal opinion of value by a state-licensed appraiser, usually ordered by a lender, and it carries a fee. A broker valuation is a licensed real estate agent’s opinion of market value based on comparable sales and local market knowledge, provided free. Both look at similar evidence, but only an appraisal satisfies a lender.',
  },
  {
    q: 'What determines what my home is worth?',
    a: 'Location and lot come first, then size and layout, then condition and updates. After that: how many comparable homes are for sale right now, how long they are taking to sell, and what buyers are currently willing to pay for the features yours has. Two homes with identical square footage on the same street can be worth meaningfully different amounts once condition, updates and lot are accounted for.',
  },
  {
    q: 'Which areas do you cover?',
    a: 'Fair Oaks Ranch, Boerne, Helotes, The Dominion, Cordillera Ranch, Bulverde, and the surrounding Texas Hill Country and north San Antonio areas. If your home is outside the areas we work in, we will tell you rather than guess at a number.',
  },
  {
    q: 'Do I have to list with you to get the valuation?',
    a: 'No. It is free, there is no obligation, and there is no requirement to sell now or ever. Plenty of owners want a realistic number for planning, refinancing or curiosity, and that is a perfectly good reason to ask.',
  },
  {
    q: 'What happens after I request one?',
    a: 'Zachary A. Stovall reviews your property and the recent comparable sales around it, and contacts you directly to discuss what he found. He may ask a few questions about condition and updates, or arrange to walk the home, because those are the things a valuation cannot get right from the outside.',
  },
];

const HOW_IT_WORKS = [
  { icon: Home, title: 'Tell us about the home', body: 'Address and how to reach you. If there is anything unusual about the property, say so — it matters more than square footage.' },
  { icon: MapPin, title: 'Zack pulls the comparables', body: 'Recent sales near you, adjusted for how those homes actually compared to yours in size, condition and lot.' },
  { icon: UserCheck, title: 'You get a straight answer', body: 'A realistic range, what would have to be true to reach the top of it, and what he would do with the house before listing.' },
];

export default function HomeValuationPage() {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${BASE_URL}/home-valuation#faq`,
    mainEntity: FAQS.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Home Valuation', path: '/home-valuation' }]} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqSchema) }} />
      <Header />
      <main className="min-h-screen pt-20">

        {/* Hero + form, side by side — the ask is visible without scrolling */}
        <section className="bg-primary py-16 sm:py-20 text-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">Free · No Obligation</p>
                <h1 className="font-heading text-display-sm sm:text-display font-bold leading-tight">
                  What&rsquo;s your Hill Country home worth?
                </h1>
                <p className="mt-5 max-w-xl text-body-lg leading-relaxed text-white/75">
                  Not an automated guess from a website that has never seen your house. A real valuation of
                  your home in Fair Oaks Ranch, Boerne or Helotes — prepared personally by Zachary A. Stovall,
                  broker and owner, using recent sales in your neighbourhood.
                </p>
                <ul className="mt-7 space-y-3">
                  {[
                    'Free, with no obligation to list',
                    'Prepared by a person, not an algorithm',
                    'Based on homes that actually sold near you',
                  ].map(item => (
                    <li key={item} className="flex items-center gap-3 text-body text-white/80">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold">
                        <CheckCircle className="h-3.5 w-3.5 text-primary" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-7 sm:p-8 backdrop-blur-sm">
                <h2 className="mb-2 font-heading text-heading-xl font-bold text-white">Request your valuation</h2>
                <p className="mb-6 text-body-sm text-white/60">
                  Four details. Zack handles the rest himself.
                </p>
                <HomeValuationForm tone="dark" surface="home-valuation-page" />
              </div>
            </div>
          </Container>
        </section>

        {/* How it works */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mx-auto max-w-4xl">
              <div className="mb-12 text-center">
                <p className="overline mb-2 text-gold">How it works</p>
                <h2 className="font-heading text-display-xs font-bold text-primary">Three steps, no runaround</h2>
              </div>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
                {HOW_IT_WORKS.map(({ icon: Icon, title, body }, i) => (
                  <div key={title}>
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gold/15">
                      <Icon className="h-6 w-6 text-gold-dark" />
                    </div>
                    <p className="text-caption uppercase tracking-widest text-gold-dark">Step {i + 1}</p>
                    <h3 className="mb-2 mt-1 font-heading text-heading font-bold text-primary">{title}</h3>
                    <p className="text-body-sm leading-relaxed text-foreground-muted">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* What you get */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mx-auto max-w-4xl">
              <div className="mb-12 text-center">
                <p className="overline mb-2 text-gold">What you get</p>
                <h2 className="font-heading text-display-xs font-bold text-primary">
                  What&rsquo;s actually in your valuation
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {VALUATION_INCLUDES.map(item => (
                  <div key={item.title} className="rounded-2xl bg-white p-6 shadow-card">
                    <h3 className="mb-2 font-heading text-heading font-bold text-primary">{item.title}</h3>
                    <p className="text-body-sm leading-relaxed text-foreground-muted">{item.body}</p>
                  </div>
                ))}
              </div>
              <p className="mx-auto mt-8 max-w-3xl text-body-sm leading-relaxed text-foreground-muted">
                <strong className="text-primary">Worth being clear about:</strong> {VALUATION_DISCLAIMER}
              </p>
            </div>
          </Container>
        </section>

        {/* Why not an instant number — the honest differentiator */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mx-auto max-w-3xl">
              <p className="overline mb-2 text-gold">Why there is no instant number here</p>
              <h2 className="mb-5 font-heading text-display-xs font-bold text-primary">
                We could show you one. It would just be wrong.
              </h2>
              <div className="space-y-4 text-body leading-relaxed text-foreground-muted">
                <p>
                  Plenty of sites will hand you an instant figure for your house. Those come from algorithms
                  reading public records, and on an ordinary home in a uniform subdivision they can land
                  reasonably close.
                </p>
                <p>
                  Hill Country homes are frequently not that. Acreage, custom builds, wells and septic,
                  significant updates, homes on lots with a view and homes on lots without one — these are
                  exactly the cases where an automated estimate drifts furthest, because the data it reads
                  does not contain the things that set the price.
                </p>
                <p>
                  So we do not publish a number we would have to caveat. Zack looks at your property and the
                  sales around it and tells you what he actually thinks, including when that is less than you
                  were hoping to hear.
                </p>
              </div>
            </div>
          </Container>
        </section>

        {/* FAQ */}
        <section className="section-luxury bg-background-cream" aria-labelledby="val-faq">
          <Container>
            <div className="mx-auto max-w-3xl">
              <h2 id="val-faq" className="mb-8 font-heading text-display-xs font-bold text-primary">
                Home valuation questions
              </h2>
              <div className="space-y-3">
                {FAQS.map(f => (
                  <details key={f.q} className="group rounded-xl border border-border bg-white p-5">
                    <summary className="flex cursor-pointer items-center justify-between gap-4 font-heading text-heading font-semibold text-primary">
                      {f.q}
                      <span className="shrink-0 text-gold-dark transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <p className="mt-3 text-body-sm leading-relaxed text-foreground-muted">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* Closing CTA — anchors back to the form rather than repeating it */}
        <section className="bg-primary py-14 text-white">
          <Container>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-heading text-display-xs font-bold">Ready for a real number?</h2>
              <p className="mt-4 text-body text-white/75">
                Free, no obligation, and no requirement to sell — now or ever.
              </p>
              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="#top"
                  className="inline-flex items-center gap-2 rounded-lg bg-gold px-7 py-3.5 text-body-sm font-bold text-primary transition-colors hover:bg-gold-dark"
                >
                  Request my home valuation
                </Link>
                <a
                  href="tel:+12103909997"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-7 py-3.5 text-body-sm font-semibold text-white transition-colors hover:border-gold hover:text-gold"
                >
                  <Phone className="h-4 w-4" /> Call 210-390-9997
                </a>
              </div>
              <p className="mt-6 text-caption text-white/50">
                Fair Oaks Realty Group · 8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015
              </p>
            </div>
          </Container>
        </section>

      </main>
      <Footer />
    </>
  );
}
