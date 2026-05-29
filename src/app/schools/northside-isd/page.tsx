export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  School, MapPin, Star, ArrowRight, Phone,
  Home, DollarSign, Users,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/schools/northside-isd`;

export const metadata: Metadata = {
  title: 'Homes in Northside ISD | Helotes, Leon Springs & San Antonio TX',
  description:
    'Browse homes for sale in Northside ISD — San Antonio\'s largest school district covering Helotes, Leon Valley, and northwest San Antonio neighborhoods.',
  alternates: { canonical: '/schools/northside-isd' },
  openGraph: {
    title: 'Homes in Northside ISD | Helotes, Leon Springs & San Antonio TX',
    description:
      'Search homes in Northside ISD — one of the largest and most respected school districts in Texas. Serving Helotes, Leon Springs, and northwest San Antonio.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Homes in Northside ISD — Fair Oaks Realty Group' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Homes in Northside ISD | Helotes, Leon Springs & San Antonio TX',
    description: 'Search homes in Northside ISD — one of the largest and most respected school districts in Texas.',
  },
  keywords: [
    'northside isd homes for sale',
    'homes in northside isd',
    'helotes northside isd',
    'leon springs northside isd',
    'northside isd real estate',
    'san antonio northside isd homes',
    'best schools helotes tx',
    'northside isd elementary',
    "homes near o'connor high school",
    'northside isd neighborhoods',
  ],
};

const SCHOOL_SPOTLIGHTS = [
  {
    name: 'O\'Connor High School',
    grades: '9–12',
    rating: '8/10',
    location: 'Helotes',
    description: 'One of the top-performing high schools in Northside ISD. Strong academics, athletics, and a vibrant community in the heart of Helotes.',
  },
  {
    name: 'Brandeis High School',
    grades: '9–12',
    rating: '8/10',
    location: 'NW San Antonio',
    description: 'Consistently high graduation rates and broad AP course offerings. Serves northwest San Antonio\'s established neighborhoods.',
  },
  {
    name: 'Warren High School',
    grades: '9–12',
    rating: '7/10',
    location: 'NW San Antonio',
    description: 'Large comprehensive high school with strong extracurricular programs and career & technical education pathways.',
  },
];

const COMMUNITIES = [
  {
    name: 'Helotes',
    slug: '/homes-for-sale/helotes-tx',
    description: 'A charming Hill Country city just northwest of San Antonio. Helotes offers tight-knit community living, strong schools, and beautiful scenery — all within 20 minutes of the city.',
    priceRange: '$350K – $750K',
  },
  {
    name: 'Leon Springs',
    slug: '/homes-for-sale/san-antonio-tx',
    description: 'A sought-after unincorporated community on I-10 NW, known for its Hill Country character, larger lots, and easy access to the Rim and La Cantera shopping districts.',
    priceRange: '$400K – $900K',
  },
  {
    name: 'NW San Antonio',
    slug: '/homes-for-sale/san-antonio-tx',
    description: 'The largest portion of Northside ISD\'s territory — established neighborhoods, strong resale values, and convenient access to the Medical Center, USAA, and downtown.',
    priceRange: '$250K – $550K',
  },
];

const PRICE_RANGES = [
  { label: 'Entry-Level Homes', range: '$220K – $320K', description: 'Established NW San Antonio neighborhoods with solid school access.' },
  { label: 'Mid-Range Family Homes', range: '$320K – $500K', description: 'Most active segment — 3–4 bedrooms in Northside communities.' },
  { label: 'Upper Mid-Range', range: '$500K – $750K', description: 'Helotes and Leon Springs homes with premium finishes and larger lots.' },
  { label: 'Luxury / Acreage', range: '$750K – $1.5M+', description: 'Custom builds and acreage properties on the NW fringe.' },
];

const DISTRICT_STATS = [
  { value: '100,000+', label: 'Students Enrolled' },
  { value: '100+', label: 'District Campuses' },
  { value: '7–8/10', label: 'GreatSchools Rating' },
  { value: 'A/B', label: 'TEA District Rating' },
];

const FAQS = [
  {
    q: 'What cities are served by Northside ISD?',
    a: 'Northside ISD serves a large swath of northwest San Antonio, including the city of Helotes, the community of Leon Springs, and many established neighborhoods within San Antonio\'s city limits. The district spans Bexar County and is one of the largest in Texas by enrollment.',
  },
  {
    q: 'How is Northside ISD rated?',
    a: 'Northside ISD earns ratings of 7–8 out of 10 on GreatSchools and typically receives a "B" or better district rating from the Texas Education Agency. Individual campuses vary — O\'Connor High School and several elementary schools consistently earn top marks within the district.',
  },
  {
    q: 'What is the average home price in Northside ISD?',
    a: 'Home prices in Northside ISD vary significantly by location. In Helotes and Leon Springs, expect $350,000–$750,000+. In established NW San Antonio neighborhoods, homes typically range from $220,000–$450,000. The district covers a wide range of price points, making it accessible to more buyers than Boerne ISD.',
  },
  {
    q: 'Is Northside ISD a good school district?',
    a: 'Yes. Northside ISD is one of the most respected large school districts in Texas. It offers a wide variety of magnet programs, dual-language schools, fine arts academies, and STEM pathways. For families who want strong academics in a more urban or suburban setting — closer to San Antonio employers — Northside ISD is an excellent choice.',
  },
  {
    q: 'How do I know if a home in Helotes is in Northside or another district?',
    a: 'Most of Helotes falls within Northside ISD, but some addresses near the western edge may be in Northside ISD or Boerne ISD depending on exact location. School boundaries don\'t always follow city lines. Our agents verify the exact school zone for every listing — don\'t rely on listing portal estimates, which can be wrong.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'School Districts', item: `${BASE_URL}/schools` },
        { '@type': 'ListItem', position: 3, name: 'Northside ISD', item: CANONICAL },
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

export default function NorthsideIsdPage() {
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
              <Link href="/schools" className="hover:text-primary transition-colors">School Districts</Link>
              <span>/</span>
              <span className="text-primary font-medium">Northside ISD</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <School className="mr-1 inline h-3 w-3" />
                Bexar County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Homes for Sale in Northside ISD School District
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Northside ISD is one of the largest and most respected school districts in Texas —
                serving over 100,000 students across Helotes, Leon Springs, and northwest San Antonio.
                Find your family&apos;s home in a community backed by strong schools and a vibrant lifestyle.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?district=northside-isd">Browse Northside ISD Homes</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />210-390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Stats Bar */}
        <div className="bg-[#C9A84C] py-6">
          <Container>
            <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
              {DISTRICT_STATS.map(({ value, label }) => (
                <div key={label} className="flex items-center gap-3">
                  <div>
                    <div className="font-heading text-heading font-bold text-primary">{value}</div>
                    <div className="text-caption text-primary/60">{label}</div>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </div>

        {/* District Overview + Sidebar */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-[#C9A84C]">District Overview</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  About Northside Independent School District
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Northside ISD is the fourth-largest school district in Texas, serving over 100,000 students
                    across more than 100 campuses. Despite its size, the district maintains strong academic
                    outcomes — offering a breadth of programs that smaller districts simply cannot match, including
                    magnet schools, dual-language programs, fine arts academies, and career & technical education centers.
                  </p>
                  <p>
                    The district covers a diverse geographic area: from the Hill Country community of Helotes in the
                    northwest, through the scenic Leon Springs corridor on I-10, and into well-established neighborhoods
                    in northwest San Antonio. No matter your budget or lifestyle preference, there is a Northside ISD
                    community that fits.
                  </p>
                  <p>
                    Northside ISD is also known for its accessibility. With home prices starting well below $300,000
                    in some neighborhoods and reaching $750,000+ in Helotes and Leon Springs, it serves a wider
                    range of buyers than more premium districts — while still delivering quality academics and
                    a strong sense of community.
                  </p>
                </div>

                {/* School Spotlights */}
                <div className="mt-10">
                  <h3 className="mb-5 font-heading text-heading font-bold text-primary">
                    School Spotlights
                  </h3>
                  <div className="space-y-4">
                    {SCHOOL_SPOTLIGHTS.map((school) => (
                      <div key={school.name} className="rounded-2xl border border-border bg-background-cream p-6">
                        <div className="flex items-start justify-between mb-3 gap-3">
                          <div>
                            <h4 className="font-heading text-heading-sm font-bold text-primary">{school.name}</h4>
                            <div className="flex items-center gap-3 mt-1 text-caption text-foreground-muted">
                              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {school.location}</span>
                              <span>Grades {school.grades}</span>
                            </div>
                          </div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#C9A84C]/10 px-3 py-1 text-caption font-semibold text-[#C9A84C] shrink-0">
                            <Star className="h-3 w-3" /> {school.rating}
                          </span>
                        </div>
                        <p className="text-body-sm text-foreground-muted">{school.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Listings CTA */}
                <div className="mt-10 rounded-2xl border border-border bg-background-cream p-7">
                  <p className="overline mb-2 text-[#C9A84C]">Current Inventory</p>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">
                    Browse Homes Zoned for Northside ISD
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View active listings filtered to Northside ISD. Updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?district=northside-isd">
                      View Northside ISD Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Find a Home in Northside ISD
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    We know every Northside ISD neighborhood and can filter your search by school, community,
                    and price range.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?district=northside-isd">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?district=northside-isd">See Available Homes</Link>
                  </Button>
                  <div className="mt-6 border-t border-border pt-5">
                    <p className="text-caption text-foreground-muted text-center mb-3">Or call us directly</p>
                    <a
                      href="tel:+12103909997"
                      className="flex items-center justify-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors"
                    >
                      <Phone className="h-4 w-4" /> 210-390-9997
                    </a>
                  </div>
                  <div className="mt-5 border-t border-border pt-5">
                    <p className="text-caption font-semibold text-primary mb-3">Other Districts</p>
                    <div className="space-y-2">
                      <Link href="/schools/boerne-isd" className="flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors">
                        <ArrowRight className="h-3 w-3 text-[#C9A84C]" /> Boerne ISD
                      </Link>
                      <Link href="/schools/comal-isd" className="flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors">
                        <ArrowRight className="h-3 w-3 text-[#C9A84C]" /> Comal ISD
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* Communities */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Where to Live</p>
              <h2 className="font-heading text-heading-xl font-bold text-primary">
                Communities Served by Northside ISD
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {COMMUNITIES.map((c) => (
                <div key={c.name} className="rounded-2xl border border-border bg-white p-6 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="h-4 w-4 text-[#C9A84C] shrink-0" />
                    <h3 className="font-heading text-heading-sm font-bold text-primary">{c.name}</h3>
                  </div>
                  <p className="mb-4 text-body-sm text-foreground-muted leading-relaxed flex-1">{c.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-caption font-semibold text-[#C9A84C]">{c.priceRange}</span>
                    <Link
                      href={c.slug}
                      className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors"
                    >
                      Explore <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Price Ranges */}
        <section className="section-compact bg-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Budget Guide</p>
              <h2 className="font-heading text-heading-xl font-bold text-primary">
                Home Price Ranges in Northside ISD
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PRICE_RANGES.map(({ label, range, description }) => (
                <div key={label} className="rounded-2xl border border-border bg-background-cream p-6">
                  <DollarSign className="mb-3 h-6 w-6 text-[#C9A84C]" />
                  <div className="mb-1 font-heading text-heading font-bold text-primary">{range}</div>
                  <div className="mb-3 text-body-sm font-semibold text-foreground-muted">{label}</div>
                  <p className="text-caption text-foreground-muted">{description}</p>
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
                Northside ISD FAQs
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
              <p className="overline mb-3 text-[#C9A84C]">Ready to Search?</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Find Your Home in Northside ISD Today
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                From Helotes to northwest San Antonio, our agents know every Northside ISD neighborhood.
                Tell us your target schools and budget — we&apos;ll handle the rest.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?district=northside-isd">Talk to a Local Expert</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?district=northside-isd">
                    Browse Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        <div className="py-6 bg-white border-t border-border">
          <Container>
            <Link
              href="/schools"
              className="inline-flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors"
            >
              <ArrowRight className="h-4 w-4 rotate-180" /> Back to all school districts
            </Link>
          </Container>
        </div>

      </main>
      <Footer />
    </>
  );
}
