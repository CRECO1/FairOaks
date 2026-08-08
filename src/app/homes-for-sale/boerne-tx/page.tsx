export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  ArrowRight, Phone, Trees, Landmark, Star,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CITY = 'Boerne';
const STATE = 'TX';
const SLUG = 'boerne-tx';
const AVG_PRICE = '$575,000';
const AVG_SQFT = '2,400';
const SCHOOL = 'Boerne ISD';
const DIST_SA = '30 min';
const CANONICAL = `${BASE_URL}/homes-for-sale/${SLUG}`;

export async function generateMetadata(): Promise<Metadata> {
  const title = `Boerne TX Homes for Sale | Fair Oaks Realty Group`;
  const description =
    `Find homes for sale in Boerne, TX — charming Hill Country town with top-rated Boerne ISD schools, scenic landscapes, and homes from $300K to $1.5M+.`;

  return {
    title,
    description,
    alternates: { canonical: '/homes-for-sale/boerne-tx' },
    openGraph: {
      title,
      description,
      url: CANONICAL,
      type: 'website',
      images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Boerne TX Homes for Sale — Fair Oaks Realty Group' }],
    },
    twitter: { card: 'summary_large_image', title, description },
    keywords: [
      'Boerne TX homes for sale',
      'Boerne Texas real estate',
      'homes for sale Boerne TX',
      'Boerne ISD homes',
      'Hill Country homes for sale',
      'Boerne TX real estate agent',
      'Fair Oaks Realty Group Boerne',
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
      areaServed: {
        '@type': 'City',
        name: CITY,
        addressRegion: STATE,
        addressCountry: 'US',
      },
    },
    {
      '@type': 'WebPage',
      '@id': CANONICAL,
      url: CANONICAL,
      name: `${CITY}, ${STATE} Homes for Sale | Fair Oaks Realty Group`,
      description: `Browse homes for sale in ${CITY}, ${STATE}. Average price ${AVG_PRICE}. ${SCHOOL} schools. Hill Country lifestyle 30 minutes from San Antonio.`,
      about: {
        '@type': 'Place',
        name: `${CITY}, ${STATE}`,
        address: {
          '@type': 'PostalAddress',
          addressLocality: CITY,
          addressRegion: STATE,
          addressCountry: 'US',
        },
      },
    },
  ],
};

const WHY_BUY = [
  { icon: Landmark, text: 'Historic Main Street with walkable shops, restaurants & wine bars' },
  { icon: Trees,    text: 'Cibolo Creek Nature Center & miles of Hill Country outdoor recreation' },
  { icon: School,   text: 'Highly rated Boerne ISD — consistently strong academic performance' },
  { icon: Star,     text: 'Active community with festivals, farmers markets & local events year-round' },
  { icon: Home,     text: 'Diverse inventory — from charming cottages to luxury custom builds' },
  { icon: MapPin,   text: 'Just 30 minutes from San Antonio with quick I-10 access' },
];

export default function BourneTxPage() {
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
              <span className="text-primary font-medium">Boerne, TX</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">
                <MapPin className="mr-1 inline h-3 w-3" />
                Kendall County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Boerne, TX Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Discover life in one of Texas&apos;s most beloved Hill Country towns. Boerne offers award-winning
                schools, a vibrant historic district, and stunning natural scenery — all within 30 minutes of
                San Antonio. Average home prices around <strong className="text-white">{AVG_PRICE}</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Boerne">Browse Boerne Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />210-390-9997</a>
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

        {/* About the Area */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-gold">About the Area</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  Living in Boerne, TX
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Boerne (pronounced &ldquo;Bernie&rdquo;) sits at the heart of the Texas Hill Country, nestled along
                    the banks of Cibolo Creek in Kendall County. Founded by German settlers in 1849, the city has
                    grown thoughtfully over the decades — preserving its small-town character and walkable historic
                    Main Street while welcoming new families, restaurants, and boutiques. Today, Boerne is one of the
                    most sought-after addresses in the greater San Antonio region, drawing buyers who want the
                    best of both worlds: a peaceful, scenic place to call home with easy access to a major metro.
                  </p>
                  <p>
                    The real estate market here reflects that demand. Homes range from charming cottage-style
                    properties near downtown to sprawling custom builds on acreage outside city limits. Boerne ISD
                    is a consistent draw for families — the district has earned strong academic ratings and offers
                    a full slate of extracurriculars. Beyond schools, the community itself is a selling point: outdoor
                    concerts on Main Street, the River Road Wine Trail, the Cibolo Nature Center&apos;s 100-plus acres of
                    habitat, and the annual Berges Fest keep residents engaged year-round. If you value a lifestyle
                    that blends outdoor recreation, local culture, and genuine community spirit, Boerne delivers.
                  </p>
                </div>

                {/* Why Buy Here */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Why Buy in Boerne?
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

                {/* Featured Listings CTA */}
                <div className="mt-10 rounded-2xl border border-border bg-background-cream p-7">
                  <p className="overline mb-2 text-gold">Current Inventory</p>
                  <h3 className="mb-2 font-heading text-heading font-bold text-primary">
                    Browse Active Boerne Listings
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all homes currently for sale in Boerne, TX — filtered and updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?city=Boerne">
                      View Boerne Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                {/* Neighborhood Guide Link */}
                <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-white p-5">
                  <MapPin className="h-5 w-5 text-gold shrink-0" />
                  <div className="flex-1">
                    <p className="text-body-sm font-semibold text-primary">Boerne Neighborhood Guide</p>
                    <p className="text-caption text-foreground-muted">Explore specific subdivisions, schools & local insights</p>
                  </div>
                  <Link
                    href="/neighborhoods/boerne"
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
                    Ready to find your home in Boerne?
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    Contact our local experts for a no-pressure consultation. We know every subdivision,
                    school zone, and street in Boerne.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?area=Boerne">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?city=Boerne">See Available Homes</Link>
                  </Button>
                  <div className="mt-6 border-t border-border pt-5">
                    <p className="text-caption text-foreground-muted text-center mb-3">Or call us directly</p>
                    <a
                      href="tel:+12103909997"
                      className="flex items-center justify-center gap-2 text-body-sm font-semibold text-primary hover:text-gold transition-colors"
                    >
                      <Phone className="h-4 w-4" /> 210-390-9997
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
                Ready to find your home in Boerne?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Contact our Boerne area specialists today. No obligation — just local knowledge and
                honest guidance to help you find the right home at the right price.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=Boerne">Contact Our Boerne Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?city=Boerne">
                    Browse Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
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
              <Link href="/homes-for-sale/bulverde-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">Bulverde, TX</Link>
              <Link href="/homes-for-sale/new-braunfels-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">New Braunfels, TX</Link>
            </div>
          </Container>
        </section>

        {/* Back to all cities */}
        <div className="py-6 bg-white border-t border-border">
          <Container>
            <Link
              href="/homes-for-sale"
              className="inline-flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors"
            >
              <ArrowRight className="h-4 w-4 rotate-180" /> Browse all Texas Hill Country cities
            </Link>
          </Container>
        </div>

      </main>
      <Footer />
    </>
  );
}
