import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageCircle, ArrowRight, Phone } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

export const revalidate = 86400;

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export const metadata: Metadata = {
  title: 'Real Estate FAQ | Texas Hill Country Home Buying & Selling Questions',
  description:
    'Answers to common questions about buying and selling homes in Fair Oaks Ranch, Boerne, and the Texas Hill Country. Fair Oaks Realty Group FAQ.',
  alternates: { canonical: '/faq' },
  openGraph: {
    title: 'Real Estate FAQ | Texas Hill Country Home Buying & Selling Questions',
    description:
      'Answers to the most common real estate questions for buyers and sellers in the Texas Hill Country.',
    url: BASE_URL + '/faq',
  },
};

const FAQ_CATEGORIES = [
  {
    id: 'buying',
    title: 'Buying a Home',
    questions: [
      {
        q: 'How much do I need for a down payment in Texas?',
        a: 'The amount depends on your loan type. Conventional loans typically require 3–20% down — the more you put down, the better your rate and the less you pay in PMI. FHA loans require just 3.5% down with a credit score of 580 or higher. VA loans for eligible veterans and active-duty service members require 0% down payment, making homeownership accessible with no upfront equity. USDA loans also offer 0% down for qualifying rural properties. In the Texas Hill Country, a 20% down payment on a $450,000 home equals $90,000, but many buyers get in with far less.',
      },
      {
        q: 'What is the home buying process in Texas?',
        a: 'The Texas home buying process follows these key stages: (1) Get pre-approved — a lender reviews your finances and issues a commitment letter. (2) Search for homes — your agent shows you properties matching your criteria. (3) Make an offer — your agent drafts a Texas Real Estate Commission (TREC) contract. (4) Option period — typically 5–10 days to conduct inspections and negotiate repairs. (5) Financing and appraisal — your lender orders an appraisal and processes your loan. (6) Title search — a title company verifies clear ownership. (7) Final walk-through — check that the property is in agreed-upon condition. (8) Closing day — sign documents, fund the loan, and receive your keys. The entire process typically takes 30–60 days from accepted offer to closing.',
      },
      {
        q: 'How long does it take to buy a home in Texas?',
        a: 'From the moment your offer is accepted to closing day, plan on 30–60 days for a financed purchase. Cash buyers can close in as few as 7–14 days. The timeline depends on your loan type (VA and FHA loans can take slightly longer than conventional), the lender\'s workload, and how quickly the title company can clear the title. In the current Hill Country market, we recommend being ready to move quickly — popular homes in Boerne, Fair Oaks Ranch, and Helotes often receive multiple offers within days of listing.',
      },
      {
        q: 'What are closing costs in Texas?',
        a: 'Buyers in Texas typically pay 2–3% of the purchase price in closing costs. On a $450,000 home, that\'s roughly $9,000–$13,500. Common buyer closing costs include: loan origination fees (0.5–1%), title insurance ($1,000–$2,500), escrow/settlement fees ($500–$800), appraisal ($500–$700), home inspection ($300–$500), and prepaid items like property taxes and homeowner\'s insurance. One advantage unique to Texas: sellers often agree to pay a portion of buyer closing costs as part of negotiations, so always ask. VA loans also allow the seller to pay all buyer closing costs.',
      },
      {
        q: 'Should I get pre-approved before looking at homes?',
        a: 'Yes — and strongly so. In the competitive Texas Hill Country market, sellers expect offers to be accompanied by a pre-approval letter. Without one, your offer will likely be passed over in favor of buyers who are ready to move. Pre-approval also helps you understand your true budget, locks in your interest rate for a set period, and identifies any credit issues that need to be resolved before you\'re ready to buy. The process takes 1–3 business days with most lenders. We work with several trusted local lenders who can get you pre-approved quickly.',
      },
    ],
  },
  {
    id: 'selling',
    title: 'Selling a Home',
    questions: [
      {
        q: 'How do I price my home correctly?',
        a: 'Accurate pricing is the single most important factor in a successful home sale. We prepare a Comparative Market Analysis (CMA) — a detailed report comparing your home to recently sold properties in your neighborhood with similar size, age, condition, and features. A well-priced home attracts more buyers, generates more competing offers, and ultimately sells for a higher price than an overpriced home that sits on the market. We factor in current market conditions (buyer\'s vs. seller\'s market), seasonal trends, and your specific home\'s upgrades and condition. Overpricing by even 5% can cause your listing to stall and stigmatize the property.',
      },
      {
        q: 'What is the average time to sell a home in the Fair Oaks Ranch area?',
        a: 'Our team averages just 21 days on market for our listings — well below the broader San Antonio metro average. Fair Oaks Ranch, Boerne, and the surrounding Hill Country communities continue to attract strong buyer demand from San Antonio professionals, retirees, and relocation buyers drawn to the area\'s top-rated schools, safety, and lifestyle. The right pricing and marketing strategy is what separates a fast, top-dollar sale from a listing that lingers. Homes priced correctly and marketed aggressively consistently sell in under 30 days.',
      },
      {
        q: 'Do I need to make repairs before listing?',
        a: 'Not necessarily — but strategic improvements can significantly impact your sale price. We provide every seller with a pre-listing consultation to identify which repairs deliver the best return on investment. High-impact, low-cost updates include fresh interior paint, landscaping and curb appeal, deep cleaning, and fixing obvious defects (leaky faucets, broken fixtures, damaged screens). Major renovations like kitchen remodels rarely recoup their full cost before a sale. We\'ll help you prioritize what to fix, what to leave, and how to price accordingly so you net the most money without overspending on repairs.',
      },
      {
        q: 'What is your list-to-sale price ratio?',
        a: 'Our team consistently achieves a 103% list-to-sale price ratio — meaning our sellers receive, on average, 3% above their listing price. This is the result of strategic pricing (not underpricing), professional marketing that generates competitive offers, and skilled negotiation that keeps multiple buyers engaged. Compare this to the national average of roughly 99%, and the difference on a $500,000 home is approximately $20,000 in additional proceeds. Our track record speaks for itself: we don\'t just list homes, we sell them for more.',
      },
      {
        q: 'What does it cost to sell a home in Texas?',
        a: 'Total seller costs in Texas typically run 7–9% of the sale price. The largest expense is agent commission — traditionally split between the listing agent and buyer\'s agent. Seller closing costs add another 1–2%, covering items like title insurance (Texas requires sellers to pay for the owner\'s policy), prorated property taxes, HOA transfer fees, and any agreed-upon buyer concessions. On a $500,000 sale, plan for roughly $35,000–$45,000 in total selling costs, leaving you with $455,000–$465,000 before your remaining mortgage balance. We provide a detailed net sheet at the start of every listing consultation so you know exactly what to expect.',
      },
    ],
  },
  {
    id: 'hill-country',
    title: 'Texas Hill Country Specific',
    questions: [
      {
        q: 'Which school districts are in the Hill Country area?',
        a: 'The Texas Hill Country northwest of San Antonio is served by several well-regarded school districts. Boerne Independent School District (Boerne ISD) covers Fair Oaks Ranch, Boerne, and surrounding areas — consistently earning top state ratings and national recognition. Northside ISD serves portions of Helotes and the Leon Valley area and is one of the largest districts in Texas. Comal ISD covers New Braunfels, Bulverde, and Spring Branch. North East ISD (NEISD) serves portions of the northeastern San Antonio metro. School district boundaries can vary block by block, so we always verify which district a specific property falls within during your home search.',
      },
      {
        q: 'How far is Boerne from San Antonio?',
        a: 'Boerne is approximately 30 miles northwest of downtown San Antonio via I-10 West. The drive typically takes 30–40 minutes during off-peak hours and 45–55 minutes during morning and evening rush hours. Many residents commute daily to San Antonio for work, benefiting from Boerne\'s Hill Country lifestyle, larger lots, and top-rated schools while maintaining easy access to the city. Major San Antonio employment centers — the Medical Center, USAA headquarters, and downtown — are all within a comfortable commute. The proximity to San Antonio while still feeling like a separate community is one of the most appealing aspects of life in the Hill Country.',
      },
      {
        q: 'Is Fair Oaks Ranch a good place to live?',
        a: 'Fair Oaks Ranch is consistently ranked among the best places to live in Texas. It is one of the safest cities in the San Antonio metro area, with low crime rates, tight-knit community feel, and top-rated Boerne ISD schools. The community features large wooded lots, equestrian properties, Hill Country topography, and a small-town atmosphere while being just 25 miles from San Antonio. The area attracts professionals, families, retirees, and military families who want space, safety, and quality of life. Home values have appreciated steadily, making it both a great place to live and a sound long-term real estate investment.',
      },
      {
        q: 'What is the HOA situation in Hill Country communities?',
        a: 'HOA requirements vary widely across Hill Country communities. Some neighborhoods — particularly master-planned communities and newer subdivisions — have active HOAs with monthly or annual dues, architectural review committees, and community amenities like pools, trails, and parks. Others are entirely HOA-free, which many buyers prefer for the flexibility. In Fair Oaks Ranch and Boerne, you\'ll find everything from deed-restricted communities with $50/month dues to rural properties with no restrictions at all. We always disclose HOA status, dues, and rules as part of our standard buyer consultation, and we review HOA documents during the option period so you fully understand any obligations before you commit.',
      },
    ],
  },
  {
    id: 'va-military',
    title: 'VA & Military Homebuying',
    questions: [
      {
        q: 'What is a VA loan and who qualifies?',
        a: 'A VA loan is a mortgage backed by the U.S. Department of Veterans Affairs, designed to help eligible military borrowers buy homes with favorable terms. You may qualify if you are an active-duty service member with at least 90 days of service, a veteran who was honorably discharged, a National Guard or Reserve member with at least 6 years of service or 90 days of active duty, or the surviving spouse of a service member who died in the line of duty or from a service-connected disability. VA loans are issued by private lenders but guaranteed by the VA, which eliminates the need for a down payment or private mortgage insurance (PMI).',
      },
      {
        q: 'Can I use a VA loan in Texas?',
        a: 'Yes — VA loans work in every state, including Texas, and they are an outstanding benefit for eligible borrowers. Texas has one of the largest military populations in the country, and VA loans are widely used in San Antonio and the surrounding Hill Country. With a VA loan in Texas, you can purchase with 0% down payment, skip PMI entirely, and often secure a lower interest rate than conventional borrowers. The VA loan can also be used multiple times — it\'s a lifetime benefit, not a one-time use. Our team specializes in VA transactions and can help you understand your Certificate of Eligibility (COE) and maximize your benefit.',
      },
      {
        q: 'Are there VA loan limits in Texas?',
        a: 'As of 2020, there are no VA loan limits for veterans with full VA entitlement — meaning you can finance a home of any price with 0% down, subject to lender approval. If you have used your VA benefit before and have remaining (partial) entitlement, county loan limits may still apply. In Bexar and Kendall counties, conforming loan limits follow the standard FHFA guidelines. If you need a loan above conforming limits, VA jumbo loans are available with a small down payment on the amount exceeding the limit. This is far more favorable than conventional jumbo requirements.',
      },
      {
        q: 'Do you have experience with military relocations (PCS moves)?',
        a: 'Absolutely. Our team has extensive experience helping service members and their families navigate PCS (Permanent Change of Station) moves to the San Antonio area. We understand the time pressure of PCS orders, the importance of being near specific installations like Fort Sam Houston, Randolph AFB, Lackland AFB, and Kelly Field, and the unique financial considerations including BAH (Basic Allowance for Housing) rates. We offer virtual tours, remote consultations, and flexible scheduling to accommodate buyers who are relocating from other duty stations. David Reyes, our VA specialist, is himself a veteran who has navigated a PCS move — he gets it firsthand.',
      },
    ],
  },
];

const faqSchemaItems = FAQ_CATEGORIES.flatMap(cat =>
  cat.questions.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  }))
);

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqSchemaItems,
};

export default function FAQPage() {
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
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">Your Questions, Answered</p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Real Estate FAQ<br />
                <span className="text-gradient-gold">Texas Hill Country</span>
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Buying or selling a home in Fair Oaks Ranch, Boerne, Helotes, or the greater San Antonio area? We&apos;ve compiled answers to the questions we hear most — straight from our agents.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/contact">Ask Us Anything</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* FAQ Categories */}
        <section className="section-luxury bg-background-cream">
          <Container>

            {/* Jump links */}
            <div className="mb-12 flex flex-wrap gap-3 justify-center">
              {FAQ_CATEGORIES.map(cat => (
                <a
                  key={cat.id}
                  href={`#${cat.id}`}
                  className="rounded-full border border-border bg-white px-5 py-2 text-body-sm font-semibold text-primary hover:border-gold hover:text-gold transition-colors"
                >
                  {cat.title}
                </a>
              ))}
            </div>

            <div className="space-y-16">
              {FAQ_CATEGORIES.map(cat => (
                <div key={cat.id} id={cat.id}>
                  <h2 className="mb-8 font-heading text-display-sm font-bold text-primary gold-line pb-4">
                    {cat.title}
                  </h2>
                  <div className="space-y-4">
                    {cat.questions.map(({ q, a }) => (
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
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <MessageCircle className="mx-auto mb-5 h-12 w-12 text-gold" />
              <p className="overline mb-3 text-gold">Still Have Questions?</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Have a Question Not Listed Here?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Our team is happy to answer any question about buying or selling in the Texas Hill Country — no pressure, no obligation.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact">
                    Contact Our Team <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

      </main>
      <Footer />
    </>
  );
}
