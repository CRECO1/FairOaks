export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  School, MapPin, Star, ArrowRight, Phone,
  CheckCircle, BookOpen, Home, Users,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/schools`;

export const metadata: Metadata = {
  title: 'Best School Districts in Texas Hill Country | Fair Oaks Ranch Real Estate',
  description:
    'Find homes in top-rated school districts near San Antonio — Boerne ISD, Northside ISD, and Comal ISD. Expert local realtors help families find the right neighborhood and school zone.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'Best School Districts in Texas Hill Country | Fair Oaks Ranch Real Estate',
    description:
      'Find homes in top-rated school districts near San Antonio — Boerne ISD, Northside ISD, and Comal ISD. Expert local realtors help families find the right neighborhood and school zone.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Best School Districts Texas Hill Country — Fair Oaks Realty Group' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Best School Districts in Texas Hill Country | Fair Oaks Ranch Real Estate',
    description: 'Find homes in top-rated school districts near San Antonio — Boerne ISD, Northside ISD, and Comal ISD.',
  },
  keywords: [
    'best schools fair oaks ranch',
    'top school districts san antonio',
    'boerne isd homes',
    'northside isd real estate',
    'comal isd homes for sale',
    'schools near fair oaks ranch',
    'best school district texas hill country',
    'homes near good schools san antonio',
    'school ratings texas',
    'family homes good schools texas',
  ],
};

const DISTRICTS = [
  {
    name: 'Boerne ISD',
    slug: '/schools/boerne-isd',
    rating: '8–9/10',
    description:
      'One of Texas\'s most consistently top-rated school districts. Serving Fair Oaks Ranch, Boerne, and surrounding Hill Country communities.',
    highlights: ['Fair Oaks Ranch', 'Boerne', 'Scenic Loop'],
    listingLink: '/listings?district=boerne-isd',
    color: 'border-[#C9A84C]',
  },
  {
    name: 'Northside ISD',
    slug: '/schools/northside-isd',
    rating: '7–8/10',
    description:
      'One of the largest and most respected school districts in Texas, serving Helotes, Leon Springs, and northwest San Antonio.',
    highlights: ['Helotes', 'Leon Springs', 'NW San Antonio'],
    listingLink: '/listings?district=northside-isd',
    color: 'border-blue-500',
  },
  {
    name: 'Comal ISD',
    slug: '/schools/comal-isd',
    rating: '8–9/10',
    description:
      'One of the fastest-growing and highest-rated districts in Texas. Serving New Braunfels, Bulverde, Spring Branch, and Canyon Lake.',
    highlights: ['New Braunfels', 'Bulverde', 'Spring Branch', 'Canyon Lake'],
    listingLink: '/listings?district=comal-isd',
    color: 'border-green-600',
  },
];

const WHY_SCHOOL_MATTERS = [
  {
    icon: Home,
    title: 'Resale Value',
    description:
      'Homes in highly rated school districts command a consistent premium — and hold value better during market downturns. Buying in a top district is a smart long-term investment.',
  },
  {
    icon: Users,
    title: 'Community Quality',
    description:
      'Great school districts attract engaged families who invest in their neighborhoods. The result is better-maintained homes, lower crime, and a stronger sense of community.',
  },
  {
    icon: BookOpen,
    title: 'Academic Outcomes',
    description:
      'Texas Hill Country districts regularly outperform statewide averages in graduation rates, AP enrollment, and college acceptance. Your children deserve the best start.',
  },
  {
    icon: Star,
    title: 'Extracurriculars & Facilities',
    description:
      'Top districts invest in athletics, fine arts, STEM labs, and career programs — giving kids opportunities that shape who they become.',
  },
];

const FAQS = [
  {
    q: 'What are the best school districts near Fair Oaks Ranch, TX?',
    a: 'Fair Oaks Ranch is primarily served by Boerne ISD, which consistently earns ratings of 8–9 out of 10 on GreatSchools. Nearby options include Northside ISD (serving Helotes and Leon Springs) and Comal ISD (serving Bulverde and New Braunfels). All three are among the top-rated districts in the San Antonio metro area.',
  },
  {
    q: 'How do I find out which school district a home is in?',
    a: 'The easiest way is to ask your real estate agent. School district boundaries don\'t always follow city lines — two homes on the same street can be in different districts. Our agents verify school zones for every listing and can filter your home search by district.',
  },
  {
    q: 'Does being in a top school district affect home prices?',
    a: 'Yes, significantly. Research consistently shows that homes in top-rated districts sell for 5–25% more than comparable homes in lower-rated districts. In Texas Hill Country, Boerne ISD and Comal ISD properties carry notable premiums. That premium often holds up better during market corrections, making it a sound investment.',
  },
  {
    q: 'Can I enroll my child in a school outside our district?',
    a: 'Texas has an open enrollment policy that allows transfers in some cases, but acceptance depends on capacity and the district\'s policies. It\'s not guaranteed. If attending a specific school is important, we strongly recommend buying a home zoned for that school rather than relying on a transfer.',
  },
  {
    q: 'What is the best school district in the Texas Hill Country?',
    a: 'Boerne ISD and Comal ISD are consistently ranked among the highest-performing districts in the San Antonio metro and across Texas. Both earn 8–9/10 ratings on GreatSchools. Boerne ISD serves Fair Oaks Ranch and Boerne; Comal ISD serves New Braunfels, Bulverde, and Canyon Lake. The "best" district depends on where you want to live — and we can help you explore all of them.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'School Districts', item: CANONICAL },
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQS.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
};

export default function SchoolsHubPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Header />
      <main className="min-h-screen pt-20">

        {/* Breadcrumb */}
        <div className="border-b border-border bg-background-cream py-3">
          <Container>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-caption text-foreground-muted">
              <Link href="/" className="hover:text-primary transition-colors">Home</Link>
              <span>/</span>
              <span className="text-primary font-medium">School Districts</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <School className="mr-1 inline h-3 w-3" />
                Texas Hill Country Schools
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Find Your Home in the Best Texas Hill Country School Districts
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Boerne ISD. Northside ISD. Comal ISD. Three of the top-rated school districts near San Antonio
                — and we know every neighborhood, school zone, and street in each one. Let us help your family
                find the right home in the right district.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/contact?topic=schools">Talk to a School Zone Expert</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* District Cards */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Explore by District</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Top-Rated School Districts Near San Antonio
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body-lg text-foreground-muted">
                Each district below serves distinct communities in the Texas Hill Country and northwest San Antonio.
                Click to explore neighborhoods, school spotlights, and active listings.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
              {DISTRICTS.map((district) => (
                <div
                  key={district.name}
                  className={`rounded-2xl border-t-4 ${district.color} border border-border bg-white p-7 shadow-sm flex flex-col`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="font-heading text-heading font-bold text-primary">{district.name}</h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#C9A84C]/10 px-3 py-1 text-caption font-semibold text-[#C9A84C]">
                      <Star className="h-3 w-3" /> {district.rating}
                    </span>
                  </div>
                  <p className="mb-5 text-body-sm text-foreground-muted leading-relaxed flex-1">
                    {district.description}
                  </p>
                  <div className="mb-6 flex flex-wrap gap-2">
                    {district.highlights.map((h) => (
                      <span key={h} className="inline-flex items-center gap-1 rounded-lg bg-background-cream px-3 py-1 text-caption text-foreground-muted">
                        <MapPin className="h-3 w-3" /> {h}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button asChild fullWidth>
                      <Link href={district.slug}>
                        Explore {district.name} <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="outline" asChild fullWidth>
                      <Link href={district.listingLink}>View Listings</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Why School District Matters */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-[#C9A84C]">The Smart Buyer&apos;s Edge</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Why School District Matters When You Buy
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {WHY_SCHOOL_MATTERS.map(({ icon: Icon, title, description }) => (
                <div key={title} className="rounded-2xl border border-border bg-background-cream p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#C9A84C]/10">
                    <Icon className="h-6 w-6 text-[#C9A84C]" />
                  </div>
                  <h3 className="mb-2 font-heading text-heading-sm font-bold text-primary">{title}</h3>
                  <p className="text-body-sm text-foreground-muted leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* FAQ */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">Common Questions</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                School District FAQs
              </h2>
            </div>
            <div className="mx-auto max-w-3xl space-y-4">
              {FAQS.map(({ q, a }) => (
                <details key={q} className="group rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
                  <summary className="flex cursor-pointer items-start justify-between gap-4 px-6 py-5 font-heading text-heading-sm font-semibold text-primary list-none">
                    <span>{q}</span>
                    <span className="mt-0.5 shrink-0 text-[#C9A84C] group-open:rotate-45 transition-transform duration-200 text-xl leading-none">+</span>
                  </summary>
                  <div className="border-t border-border px-6 pb-6 pt-4">
                    <p className="text-body text-foreground-muted leading-relaxed">{a}</p>
                  </div>
                </details>
              ))}
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-[#C9A84C]">Let&apos;s Find the Right Fit</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                We Know Every School Zone — Let Us Help
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                School zoning can be confusing. Two homes on the same street can be in different districts.
                Our local agents verify every school zone and can filter your search by district, school, and
                neighborhood. No guesswork.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?topic=schools">Get School Zone Help</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings">
                    Browse All Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
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
