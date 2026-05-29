export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  School, MapPin, Star, ArrowRight, Phone,
  CheckCircle, Home, DollarSign, BookOpen,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/schools/boerne-isd`;

export const metadata: Metadata = {
  title: 'Homes in Boerne ISD | Fair Oaks Ranch & Boerne TX Real Estate',
  description:
    'Search homes for sale in Boerne ISD — one of Texas\'s top-rated school districts. Find Fair Oaks Ranch, Boerne, and Leon Springs properties zoned to Boerne ISD.',
  alternates: { canonical: '/schools/boerne-isd' },
  openGraph: {
    title: 'Homes in Boerne ISD | Fair Oaks Ranch & Boerne TX Real Estate',
    description:
      'Find homes zoned to Boerne ISD — one of Texas\'s top-rated school districts. Serving Fair Oaks Ranch, Boerne, and surrounding Hill Country communities.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Homes in Boerne ISD — Fair Oaks Realty Group' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Homes in Boerne ISD | Fair Oaks Ranch & Boerne TX Real Estate',
    description: 'Find homes zoned to Boerne ISD — one of Texas\'s top-rated school districts.',
  },
  keywords: [
    'boerne isd homes for sale',
    'homes zoned boerne isd',
    'fair oaks ranch boerne isd',
    'boerne independent school district homes',
    'boerne isd real estate',
    'boerne tx school district homes',
    'best schools fair oaks ranch',
    'boerne isd elementary schools',
    'homes near boerne high school',
    'boerne isd rating',
  ],
};

const SCHOOLS = [
  { name: 'Boerne High School', grades: '9–12', rating: '9/10', type: 'High School' },
  { name: 'Boerne Middle School', grades: '6–8', rating: '8/10', type: 'Middle School' },
  { name: 'Boerne Samuel V. Champion High School', grades: '9–12', rating: '8/10', type: 'High School' },
  { name: 'Curington Elementary', grades: 'K–5', rating: '9/10', type: 'Elementary' },
  { name: 'Cibolo Creek Elementary', grades: 'K–5', rating: '8/10', type: 'Elementary' },
  { name: 'Fabra Elementary', grades: 'K–5', rating: '8/10', type: 'Elementary' },
  { name: 'Kendall Elementary', grades: 'K–5', rating: '8/10', type: 'Elementary' },
];

const COMMUNITIES = [
  {
    name: 'Fair Oaks Ranch',
    slug: '/homes-for-sale/fair-oaks-ranch-tx',
    description: 'The crown jewel of Boerne ISD. Fair Oaks Ranch offers master-planned subdivisions, equestrian estates, and top-rated schools minutes from I-10.',
    priceRange: '$450K – $1.2M+',
  },
  {
    name: 'Boerne',
    slug: '/homes-for-sale/boerne-tx',
    description: 'Historic Hill Country charm meets modern living. Boerne\'s walkable Main Street, boutique restaurants, and strong community make it a perennial top choice for families.',
    priceRange: '$350K – $900K',
  },
  {
    name: 'Scenic Loop / Leon Springs',
    slug: '/homes-for-sale/san-antonio-tx',
    description: 'Acreage properties and custom builds along the scenic Boerne ISD boundary. Great for buyers seeking space and privacy with Hill Country character.',
    priceRange: '$500K – $1.5M+',
  },
];

const PRICE_RANGES = [
  { label: 'Entry-Level / Starter Homes', range: '$300K – $400K', description: 'Smaller homes and townhomes in established Boerne neighborhoods.' },
  { label: 'Mid-Range Family Homes', range: '$400K – $650K', description: 'The most active price band — 3–4 bedrooms in master-planned communities.' },
  { label: 'Upper Mid-Range', range: '$650K – $900K', description: 'Larger homes with premium finishes, pools, and expansive lots.' },
  { label: 'Luxury & Custom Builds', range: '$900K – $2M+', description: 'Estate homes, acreage ranches, and custom new construction.' },
];

const FAQS = [
  {
    q: 'What cities and communities are in Boerne ISD?',
    a: 'Boerne ISD primarily serves the city of Boerne and the city of Fair Oaks Ranch, along with portions of unincorporated Kendall County including Scenic Loop and some Leon Springs addresses. Not all Fair Oaks Ranch addresses are in Boerne ISD — some fall in Northside ISD. We verify the zone for every listing.',
  },
  {
    q: 'How is Boerne ISD rated?',
    a: 'Boerne ISD consistently earns ratings of 8–9 out of 10 on GreatSchools and receives "A" ratings from the Texas Education Agency (TEA). Individual campuses — particularly Curington Elementary and Boerne High School — are among the highest-rated in the San Antonio region.',
  },
  {
    q: 'What is the average home price in Boerne ISD?',
    a: 'Home prices in Boerne ISD vary by community. In Boerne, the median price is approximately $475,000–$550,000. In Fair Oaks Ranch, it ranges from $500,000 to over $1 million for larger estates. Overall, the district commands a premium that reflects its academic reputation.',
  },
  {
    q: 'Does buying in Boerne ISD affect resale value?',
    a: 'Yes. Homes in Boerne ISD consistently hold value well and sell faster than comparable homes in lower-rated districts. The district\'s reputation draws buyers from across San Antonio and from out-of-state relocators — keeping demand strong even during slower market periods.',
  },
  {
    q: 'How do I confirm a specific home is zoned for Boerne ISD?',
    a: 'School district boundaries can split streets and even individual subdivisions. The most reliable way to verify is through Boerne ISD\'s official boundary maps or by asking your agent. Our team verifies the exact school zone for every home we show — never rely on a listing portal\'s auto-assigned school, as they are frequently inaccurate.',
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
        { '@type': 'ListItem', position: 3, name: 'Boerne ISD', item: CANONICAL },
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

export default function BoerneIsdPage() {
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
              <span className="text-primary font-medium">Boerne ISD</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <School className="mr-1 inline h-3 w-3" />
                Kendall County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Homes for Sale in Boerne ISD School District
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Boerne ISD is one of Texas&apos;s most consistently top-rated school districts — earning 8–9/10 ratings
                on GreatSchools and &ldquo;A&rdquo; ratings from the TEA. Serving Fair Oaks Ranch, Boerne, and the
                surrounding Hill Country, this district is a top reason families choose this area.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?district=boerne-isd">Browse Boerne ISD Homes</Link>
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
              <div className="flex items-center gap-3">
                <Star className="h-5 w-5 text-primary/60" />
                <div>
                  <div className="font-heading text-heading font-bold text-primary">8–9 / 10</div>
                  <div className="text-caption text-primary/60">GreatSchools Rating</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <School className="h-5 w-5 text-primary/60" />
                <div>
                  <div className="font-heading text-heading font-bold text-primary">15+</div>
                  <div className="text-caption text-primary/60">District Campuses</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Home className="h-5 w-5 text-primary/60" />
                <div>
                  <div className="font-heading text-heading font-bold text-primary">$475K+</div>
                  <div className="text-caption text-primary/60">Median Home Price</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-primary/60" />
                <div>
                  <div className="font-heading text-heading font-bold text-primary">30 min</div>
                  <div className="text-caption text-primary/60">To San Antonio</div>
                </div>
              </div>
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
                  About Boerne Independent School District
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Boerne ISD has long been regarded as one of the premier school districts in the Texas Hill Country.
                    With campuses earning consistent &ldquo;A&rdquo; ratings from the Texas Education Agency and top marks
                    on GreatSchools, the district draws families from across San Antonio who want the best academic
                    environment for their children.
                  </p>
                  <p>
                    The district serves the cities of Boerne and Fair Oaks Ranch, along with portions of unincorporated
                    Kendall County. Its high schools — Boerne High School and Boerne Samuel V. Champion High School —
                    both offer robust AP programs, fine arts, athletics, and career & technical education pathways.
                    Elementary campuses like Curington Elementary consistently earn recognition for academic excellence.
                  </p>
                  <p>
                    Buying in Boerne ISD isn&apos;t just about education — it&apos;s a long-term investment. District-zoned
                    homes command a measurable premium and hold value well, making this one of the most sought-after
                    areas in the San Antonio metro for families and investors alike.
                  </p>
                </div>

                {/* Schools List */}
                <div className="mt-10">
                  <h3 className="mb-5 font-heading text-heading font-bold text-primary">
                    Boerne ISD Schools
                  </h3>
                  <div className="overflow-hidden rounded-2xl border border-border">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="bg-background-cream border-b border-border">
                          <th className="px-5 py-3 text-left font-semibold text-primary">School</th>
                          <th className="px-5 py-3 text-left font-semibold text-primary">Type</th>
                          <th className="px-5 py-3 text-left font-semibold text-primary">Grades</th>
                          <th className="px-5 py-3 text-left font-semibold text-primary">Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SCHOOLS.map((school, i) => (
                          <tr key={school.name} className={i % 2 === 0 ? 'bg-white' : 'bg-background-cream/40'}>
                            <td className="px-5 py-3 font-medium text-primary">{school.name}</td>
                            <td className="px-5 py-3 text-foreground-muted">{school.type}</td>
                            <td className="px-5 py-3 text-foreground-muted">{school.grades}</td>
                            <td className="px-5 py-3">
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#C9A84C]/10 px-2 py-0.5 text-caption font-semibold text-[#C9A84C]">
                                <Star className="h-3 w-3" /> {school.rating}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="px-5 py-3 text-caption text-foreground-muted bg-background-cream border-t border-border">
                      Ratings based on GreatSchools. Verify current ratings at greatschools.org.
                    </p>
                  </div>
                </div>

                {/* Listings CTA */}
                <div className="mt-10 rounded-2xl border border-border bg-background-cream p-7">
                  <p className="overline mb-2 text-[#C9A84C]">Current Inventory</p>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">
                    Browse Homes Zoned for Boerne ISD
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View active listings filtered to Boerne ISD. Updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?district=boerne-isd">
                      View Boerne ISD Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Find a Home in Boerne ISD
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    Our agents verify school zones for every listing. Tell us your target schools and we&apos;ll find
                    homes that qualify.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?district=boerne-isd">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?district=boerne-isd">See Available Homes</Link>
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
                    <p className="text-caption text-foreground-muted mb-3 font-semibold text-primary">Other Districts</p>
                    <div className="space-y-2">
                      <Link href="/schools/northside-isd" className="flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors">
                        <ArrowRight className="h-3 w-3 text-[#C9A84C]" /> Northside ISD
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
                Communities in Boerne ISD
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
                Home Price Ranges in Boerne ISD
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
                Boerne ISD FAQs
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
                Find Your Home in Boerne ISD Today
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Our Hill Country agents know every Boerne ISD neighborhood, school zone, and subdivision.
                Let us do the research — you focus on finding the right home for your family.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?district=boerne-isd">Talk to a Local Expert</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?district=boerne-isd">
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
