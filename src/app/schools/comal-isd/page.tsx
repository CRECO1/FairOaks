export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  School, MapPin, Star, ArrowRight, Phone,
  Home, DollarSign, TrendingUp,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/schools/comal-isd`;

export const metadata: Metadata = {
  title: 'Homes in Comal ISD | New Braunfels, Bulverde & Spring Branch TX',
  description:
    'Find homes for sale in Comal ISD — covering Bulverde, New Braunfels, Spring Branch, and Canyon Lake. Consistently rated an A school district.',
  alternates: { canonical: '/schools/comal-isd' },
  openGraph: {
    title: 'Homes in Comal ISD | New Braunfels, Bulverde & Spring Branch TX',
    description:
      'Find homes in Comal ISD — one of the fastest-growing and highest-rated school districts in Texas. Serving New Braunfels, Bulverde, Spring Branch, and Canyon Lake.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Homes in Comal ISD — Fair Oaks Realty Group' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Homes in Comal ISD | New Braunfels, Bulverde & Spring Branch TX',
    description: 'Find homes in Comal ISD — one of the fastest-growing and highest-rated school districts in Texas.',
  },
  keywords: [
    'comal isd homes for sale',
    'homes in comal isd',
    'new braunfels comal isd',
    'bulverde comal isd',
    'spring branch comal isd',
    'comal independent school district homes',
    'best schools new braunfels',
    'comal isd real estate',
    'homes near canyon lake comal isd',
    'comal isd rating',
  ],
};

const SCHOOL_SPOTLIGHTS = [
  {
    name: 'Canyon High School',
    grades: '9–12',
    rating: '9/10',
    location: 'New Braunfels',
    description: 'Flagship high school of Comal ISD with exceptional academics, state-championship athletics, and strong college placement rates.',
  },
  {
    name: 'Davenport High School',
    grades: '9–12',
    rating: '8/10',
    location: 'Comal County',
    description: 'Modern campus serving the fast-growing northern portions of Comal ISD. Strong STEM and career tech programming.',
  },
  {
    name: 'Canyon Lake High School',
    grades: '9–12',
    rating: '8/10',
    location: 'Canyon Lake',
    description: 'Scenic Hill Country campus serving Canyon Lake and Spring Branch communities. Known for a tight-knit student body and strong community involvement.',
  },
  {
    name: 'Smithson Valley High School',
    grades: '9–12',
    rating: '8/10',
    location: 'Spring Branch',
    description: 'One of Texas\'s most recognized schools for academic and athletic achievement. Serves much of the Bulverde and Spring Branch corridor.',
  },
];

const COMMUNITIES = [
  {
    name: 'New Braunfels',
    slug: '/homes-for-sale/new-braunfels-tx',
    description: 'The largest city in Comal ISD\'s footprint — and one of the fastest-growing cities in the United States. German heritage, the Comal River, Schlitterbahn, and a booming job market.',
    priceRange: '$320K – $700K',
  },
  {
    name: 'Bulverde',
    slug: '/homes-for-sale/bulverde-tx',
    description: 'A sought-after Hill Country community north of San Antonio with master-planned neighborhoods, new construction, and a family-friendly atmosphere.',
    priceRange: '$380K – $800K',
  },
  {
    name: 'Spring Branch',
    slug: '/homes-for-sale/spring-branch-tx',
    description: 'Rural Hill Country charm with acreage properties and newer subdivisions. Home to Smithson Valley High School — one of the top programs in the state.',
    priceRange: '$400K – $1M+',
  },
  {
    name: 'Canyon Lake',
    slug: '/homes-for-sale/canyon-lake-tx',
    description: 'Texas Hill Country lakeside living at its finest. Canyon Lake offers waterfront properties, vacation homes, and a permanent-resident community with top Comal ISD schools.',
    priceRange: '$350K – $1.5M+',
  },
];

const PRICE_RANGES = [
  { label: 'Entry-Level Homes', range: '$280K – $380K', description: 'Starter homes and townhomes in established New Braunfels neighborhoods.' },
  { label: 'Mid-Range Family Homes', range: '$380K – $600K', description: 'Most active segment — 3–4 bedrooms in new construction communities.' },
  { label: 'Upper Mid-Range', range: '$600K – $900K', description: 'Larger homes in Bulverde and Spring Branch with Hill Country views.' },
  { label: 'Luxury / Waterfront', range: '$900K – $2M+', description: 'Canyon Lake waterfront estates and custom acreage properties.' },
];

const DISTRICT_STATS = [
  { value: '30,000+', label: 'Students Enrolled' },
  { value: 'A', label: 'TEA District Rating' },
  { value: '8–9/10', label: 'GreatSchools Rating' },
  { value: 'Top 10%', label: 'TX Growth Rate' },
];

const FAQS = [
  {
    q: 'What cities are served by Comal ISD?',
    a: 'Comal ISD serves a large geographic area in Comal County, including the city of New Braunfels, the communities of Bulverde, Spring Branch, and Canyon Lake, as well as portions of unincorporated Comal County. The district spans from just north of San Antonio all the way to Canyon Lake and the Hill Country beyond.',
  },
  {
    q: 'How is Comal ISD rated?',
    a: 'Comal ISD earns ratings of 8–9 out of 10 on GreatSchools and consistently receives an "A" rating from the Texas Education Agency. It is one of the top-performing mid-size districts in the state and has earned recognition for both academic achievement and student growth.',
  },
  {
    q: 'Is there new construction available in Comal ISD?',
    a: 'Yes — Comal ISD is one of the most active new construction markets in Texas. With rapid growth in New Braunfels, Bulverde, and Spring Branch, there are numerous master-planned communities and custom build sites. Major builders including DR Horton, Meritage Homes, and Toll Brothers have active projects within district boundaries.',
  },
  {
    q: 'What is the average home price in Comal ISD?',
    a: 'Home prices in Comal ISD span a wide range depending on location. New Braunfels offers the most inventory at $320,000–$700,000. Bulverde and Spring Branch run $380,000–$800,000. Canyon Lake waterfront homes can reach $1.5M or more. New construction starts around $340,000 for production homes.',
  },
  {
    q: 'Is Comal ISD good for families moving from out of state?',
    a: 'Comal ISD is an excellent choice for relocating families. The district has a welcoming community, outstanding schools, and a wide variety of housing options at accessible price points compared to similar school quality in other states. New Braunfels and Bulverde both have active newcomer communities, and the district\'s student population includes many transfer families from across the country.',
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
        { '@type': 'ListItem', position: 3, name: 'Comal ISD', item: CANONICAL },
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

export default function ComalIsdPage() {
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
              <span className="text-primary font-medium">Comal ISD</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <School className="mr-1 inline h-3 w-3" />
                Comal County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Homes for Sale in Comal ISD School District
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Comal ISD is one of the fastest-growing and highest-rated school districts in Texas —
                earning consistent &ldquo;A&rdquo; ratings from the TEA and 8–9/10 on GreatSchools.
                Serving New Braunfels, Bulverde, Spring Branch, and Canyon Lake, this district combines
                top academics with Hill Country living.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?district=comal-isd">Browse Comal ISD Homes</Link>
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
                  About Comal Independent School District
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Comal ISD has earned its reputation as one of Texas&apos;s standout school districts through
                    a combination of academic excellence and remarkable growth management. Despite being one of
                    the fastest-growing districts in the state — driven by New Braunfels&apos; position as one of
                    America&apos;s fastest-growing cities — Comal ISD has maintained &ldquo;A&rdquo; ratings from the Texas
                    Education Agency year after year.
                  </p>
                  <p>
                    The district spans a large geographic footprint that encompasses diverse communities: the
                    vibrant city of New Braunfels, the master-planned neighborhoods of Bulverde, the scenic
                    Hill Country landscapes of Spring Branch, and the waterfront living of Canyon Lake. Each
                    area has its own character, price range, and lifestyle — but all share access to Comal
                    ISD&apos;s top-tier schools.
                  </p>
                  <p>
                    For families relocating to the San Antonio area, Comal ISD offers something unique: the
                    combination of nationally recognized academic performance, strong new construction inventory,
                    and home prices that remain competitive compared to similarly-rated districts in other major
                    Texas metros. It is an outstanding long-term investment for families and investors alike.
                  </p>
                </div>

                {/* School Spotlights */}
                <div className="mt-10">
                  <h3 className="mb-5 font-heading text-heading font-bold text-primary">
                    School Spotlights
                  </h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {SCHOOL_SPOTLIGHTS.map((school) => (
                      <div key={school.name} className="rounded-2xl border border-border bg-background-cream p-6">
                        <div className="flex items-start justify-between mb-3 gap-3">
                          <div>
                            <h4 className="font-heading text-heading-sm font-bold text-primary">{school.name}</h4>
                            <div className="flex items-center gap-3 mt-1 text-caption text-foreground-muted">
                              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {school.location}</span>
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

                {/* New Construction Callout */}
                <div className="mt-10 rounded-2xl border-l-4 border-[#C9A84C] bg-[#C9A84C]/5 p-6">
                  <div className="flex items-start gap-3">
                    <TrendingUp className="h-6 w-6 text-[#C9A84C] shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-heading text-heading-sm font-bold text-primary mb-2">
                        Strong New Construction Market
                      </h3>
                      <p className="text-body-sm text-foreground-muted leading-relaxed">
                        Comal ISD is one of Texas&apos;s most active new construction markets. Master-planned communities
                        in New Braunfels, Bulverde, and Spring Branch offer new homes from the $340s–$800s+.
                        Major builders including DR Horton, Meritage, and Toll Brothers are all active within
                        district boundaries. Our agents have direct relationships with builder sales teams and
                        can help you navigate new construction purchases.
                      </p>
                      <Button variant="outline" size="sm" className="mt-4" asChild>
                        <Link href="/new-construction?district=comal-isd">
                          Explore New Construction <ArrowRight className="ml-2 h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Listings CTA */}
                <div className="mt-8 rounded-2xl border border-border bg-background-cream p-7">
                  <p className="overline mb-2 text-[#C9A84C]">Current Inventory</p>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">
                    Browse Homes Zoned for Comal ISD
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View active listings filtered to Comal ISD — resale and new construction. Updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?district=comal-isd">
                      View Comal ISD Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Find a Home in Comal ISD
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    We know every Comal ISD community — from Canyon Lake waterfront to Bulverde master-planned.
                    Tell us your must-haves and we&apos;ll find the match.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?district=comal-isd">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?district=comal-isd">See Available Homes</Link>
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
                      <Link href="/schools/northside-isd" className="flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors">
                        <ArrowRight className="h-3 w-3 text-[#C9A84C]" /> Northside ISD
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
                Communities Served by Comal ISD
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
                Home Price Ranges in Comal ISD
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
                Comal ISD FAQs
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
                Find Your Home in Comal ISD Today
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                From Canyon Lake waterfront to New Braunfels new construction, our agents know every Comal ISD
                community. Let us find the right home — and the right school zone — for your family.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?district=comal-isd">Talk to a Local Expert</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?district=comal-isd">
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
