export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  CheckCircle, ArrowRight, Phone, Trees, Star, Truck,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CITY = 'Helotes';
const STATE = 'TX';
const SLUG = 'helotes-tx';
const AVG_PRICE = '$490,000';
const AVG_SQFT = '2,200';
const SCHOOL = 'Northside ISD';
const DIST_SA = '15 min';
const CANONICAL = `${BASE_URL}/homes-for-sale/${SLUG}`;

export async function generateMetadata(): Promise<Metadata> {
  const title = `Helotes TX Homes for Sale | Fair Oaks Realty Group`;
  const description =
    `Search homes for sale in Helotes, TX — peaceful Hill Country suburb near San Antonio with great schools, large lots, and easy highway access.`;

  return {
    title,
    description,
    alternates: { canonical: '/homes-for-sale/helotes-tx' },
    openGraph: {
      title,
      description,
      url: CANONICAL,
      type: 'website',
      images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Helotes TX Homes for Sale — Fair Oaks Realty Group' }],
    },
    twitter: { card: 'summary_large_image', title, description },
    keywords: [
      'Helotes TX homes for sale',
      'Helotes Texas real estate',
      'homes for sale Helotes TX',
      'Northside ISD homes',
      'Helotes TX real estate agent',
      'Hill Country homes near San Antonio',
      'Fair Oaks Realty Group Helotes',
    ],
  };
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Homes for Sale', item: `${BASE_URL}/homes-for-sale` },
        { '@type': 'ListItem', position: 3, name: `${CITY}, ${STATE} Homes for Sale`, item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      areaServed: { '@type': 'City', name: CITY, addressRegion: STATE, addressCountry: 'US' },
    },
    {
      '@type': 'WebPage',
      '@id': CANONICAL,
      url: CANONICAL,
      name: `${CITY}, ${STATE} Homes for Sale | Fair Oaks Realty Group`,
      description: `Browse homes for sale in ${CITY}, ${STATE}. Average price ${AVG_PRICE}. ${SCHOOL}. Small-town Hill Country living 15 minutes from San Antonio.`,
    },
  ],
};

const WHY_BUY = [
  { icon: Star,    text: 'Beloved small-town atmosphere — neighbors know each other by name' },
  { icon: Truck,   text: 'Easy I-10 & Loop 1604 access for a quick 15-minute commute to San Antonio' },
  { icon: School,  text: 'Served by Northside ISD, one of the largest and most diverse districts in Texas' },
  { icon: Trees,   text: 'Large lots and acreage available — rare finds this close to the city' },
  { icon: Home,    text: 'Annual Cornyval Festival celebrating the community\'s rodeo heritage' },
  { icon: MapPin,  text: 'Convenient to UTSA, the Medical Center, and major northwest SA employers' },
];

export default function HelotesTxPage() {
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
              <Link href="/homes-for-sale" className="hover:text-primary transition-colors">Homes for Sale</Link>
              <span>/</span>
              <span className="text-primary font-medium">Helotes, TX</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">
                <MapPin className="mr-1 inline h-3 w-3" />
                Bexar County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Helotes, TX Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Helotes blends Hill Country charm with unbeatable convenience. Just 15 minutes from San Antonio
                with quick I-10 access, it offers large lots, a genuine community feel, and Northside ISD schools —
                all at an average home price around <strong className="text-white">{AVG_PRICE}</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Helotes">Browse Helotes Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Stats Bar */}
        <div className="bg-gold py-6">
          <Container>
            <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
              <div className="flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-primary/60" />
                <div>
                  <div className="font-heading text-heading font-bold text-primary">{AVG_PRICE}</div>
                  <div className="text-caption text-primary/60">Avg. Home Price</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Home className="h-5 w-5 text-primary/60" />
                <div>
                  <div className="font-heading text-heading font-bold text-primary">{AVG_SQFT} sf</div>
                  <div className="text-caption text-primary/60">Avg. Home Size</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <School className="h-5 w-5 text-primary/60" />
                <div>
                  <div className="font-heading text-heading font-bold text-primary">{SCHOOL}</div>
                  <div className="text-caption text-primary/60">School District</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary/60" />
                <div>
                  <div className="font-heading text-heading font-bold text-primary">{DIST_SA}</div>
                  <div className="text-caption text-primary/60">To San Antonio</div>
                </div>
              </div>
            </div>
          </Container>
        </div>

        {/* About + Why Buy + CTAs */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-gold">About the Area</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  Living in Helotes, TX
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Helotes occupies a unique sweet spot in the San Antonio market: it sits at the very edge of
                    the city, just inside Bexar County, but feels entirely like the Hill Country. Mature oak trees
                    canopy quiet residential streets, horses are still a common sight on the area&apos;s larger lots, and
                    the annual Cornyval Festival — a beloved Western Heritage celebration — draws thousands of families
                    every spring. That sense of tradition is part of what makes Helotes so appealing to buyers who
                    want community roots, not just a subdivision.
                  </p>
                  <p>
                    From a practical standpoint, Helotes is hard to beat. Positioned along I-10 and Loop 1604,
                    it offers one of the shortest commutes to downtown San Antonio, the Medical Center, and UTSA
                    of any Hill Country-adjacent community. Northside ISD, which serves Helotes, is one of the
                    largest and most well-regarded school districts in Texas, with multiple campuses earning
                    strong academic ratings. Real estate inventory ranges from comfortable family homes in
                    established subdivisions to large acreage properties where you can keep livestock, build a
                    guest house, or simply enjoy the space. For buyers who want proximity to the city without
                    sacrificing the feel of the country, Helotes consistently delivers.
                  </p>
                </div>

                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Why Buy in Helotes?
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {WHY_BUY.map(({ icon: Icon, text }) => (
                      <div key={text} className="flex items-start gap-3 text-body-sm text-foreground-muted">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/10">
                          <Icon className="h-4 w-4 text-gold" />
                        </div>
                        <p className="mt-1">{text}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-10 rounded-2xl border border-border bg-background-cream p-7">
                  <p className="overline mb-2 text-gold">Current Inventory</p>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">
                    Browse Active Helotes Listings
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all homes currently for sale in Helotes, TX — updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?city=Helotes">
                      View Helotes Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-white p-5">
                  <MapPin className="h-5 w-5 text-gold shrink-0" />
                  <div className="flex-1">
                    <p className="text-body-sm font-semibold text-primary">Helotes Neighborhood Guide</p>
                    <p className="text-caption text-foreground-muted">Explore subdivisions, school zones & local insights</p>
                  </div>
                  <Link
                    href="/neighborhoods/helotes"
                    className="inline-flex items-center gap-1 text-body-sm font-semibold text-gold hover:text-primary transition-colors"
                  >
                    View Guide <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Ready to find your home in Helotes?
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    Our agents know every street and school zone in Helotes. Let us match you with the right home.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?area=Helotes">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?city=Helotes">See Available Homes</Link>
                  </Button>
                  <div className="mt-6 border-t border-border pt-5">
                    <p className="text-caption text-foreground-muted text-center mb-3">Or call us directly</p>
                    <a href="tel:+12103909997" className="flex items-center justify-center gap-2 text-body-sm font-semibold text-primary hover:text-gold transition-colors">
                      <Phone className="h-4 w-4" /> (210) 390-9997
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* Contact CTA */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Let&apos;s Get Started</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Ready to find your home in Helotes?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Contact our local experts for honest guidance on Helotes real estate. No pressure, just results.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=Helotes">Contact Our Helotes Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?city=Helotes">Browse Listings <ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Nearby Communities */}
        <section className="py-10 bg-gray-50">
          <Container>
            <h2 className="text-xl font-semibold text-primary mb-4">Explore Nearby Communities</h2>
            <div className="flex flex-wrap gap-3">
              <Link href="/homes-for-sale/fair-oaks-ranch-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">Fair Oaks Ranch, TX</Link>
              <Link href="/homes-for-sale/san-antonio-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">San Antonio, TX</Link>
              <Link href="/homes-for-sale/san-antonio-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">Leon Springs, TX</Link>
            </div>
          </Container>
        </section>

        <div className="py-6 bg-white border-t border-border">
          <Container>
            <Link href="/homes-for-sale" className="inline-flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors">
              <ArrowRight className="h-4 w-4 rotate-180" /> Browse all Texas Hill Country cities
            </Link>
          </Container>
        </div>

      </main>
      <Footer />
    </>
  );
}
