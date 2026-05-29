export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  ArrowRight, Phone, Waves, Star, Users, Building2,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CITY = 'New Braunfels';
const STATE = 'TX';
const SLUG = 'new-braunfels-tx';
const AVG_PRICE = '$435,000';
const AVG_SQFT = '2,100';
const SCHOOL = 'Comal / Seguin ISD';
const DIST_SA = '35 min';
const CANONICAL = `${BASE_URL}/homes-for-sale/${SLUG}`;

export async function generateMetadata(): Promise<Metadata> {
  const title = `New Braunfels TX Homes for Sale | Fair Oaks Realty Group`;
  const description =
    `Search New Braunfels TX homes for sale. Hill Country charm meets rapid growth — Comal ISD schools, Guadalupe River access, and diverse price points.`;

  return {
    title,
    description,
    alternates: { canonical: '/homes-for-sale/new-braunfels-tx' },
    openGraph: {
      title,
      description,
      url: CANONICAL,
      type: 'website',
      images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'New Braunfels TX Homes for Sale — Fair Oaks Realty Group' }],
    },
    twitter: { card: 'summary_large_image', title, description },
    keywords: [
      'New Braunfels TX homes for sale',
      'New Braunfels Texas real estate',
      'homes for sale New Braunfels',
      'Comal ISD homes New Braunfels',
      'Guadalupe River homes for sale',
      'New Braunfels TX real estate agent',
      'Gruene TX homes for sale',
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
      description: `Browse homes for sale in ${CITY}, ${STATE}. Average price ${AVG_PRICE}. Comal ISD. Guadalupe River, historic Gruene, master-planned communities. 35 min from San Antonio.`,
    },
  ],
};

const WHY_BUY = [
  { icon: Waves,    text: 'Guadalupe River access — tubing, kayaking, and waterfront living' },
  { icon: Star,     text: 'Historic Gruene district with nationally recognized live music, dining & antiques' },
  { icon: School,   text: 'Comal ISD and New Braunfels ISD both earning strong academic ratings' },
  { icon: Users,    text: 'Diverse price range — from starter homes under $300K to luxury estates' },
  { icon: Building2, text: 'Master-planned communities like Vintage Oaks, Veramendi & Copper Ridge' },
  { icon: MapPin,   text: 'Midpoint between San Antonio & Austin on I-35 — strategic location for remote workers' },
];

export default function NewBraunfelsTxPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Header />
      <main className="min-h-screen pt-20">

        <div className="border-b border-border bg-background-cream py-3">
          <Container>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-caption text-foreground-muted">
              <Link href="/" className="hover:text-primary transition-colors">Home</Link>
              <span>/</span>
              <Link href="/homes-for-sale" className="hover:text-primary transition-colors">Homes for Sale</Link>
              <span>/</span>
              <span className="text-primary font-medium">New Braunfels, TX</span>
            </nav>
          </Container>
        </div>

        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">
                <MapPin className="mr-1 inline h-3 w-3" />
                Comal County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                New Braunfels, TX Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                New Braunfels offers the best of Texas living — Guadalupe River access, historic Gruene,
                top-rated schools, and a fast-growing market that appeals to buyers at every price point.
                Average home prices around <strong className="text-white">{AVG_PRICE}</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=New+Braunfels">Browse New Braunfels Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />210-390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

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
                  <div className="text-caption text-primary/60">School Districts</div>
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

        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-gold">About the Area</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  Living in New Braunfels, TX
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Founded by German immigrants in 1845, New Braunfels has grown from a small settlement on
                    the Guadalupe River into one of the fastest-growing cities in the United States — while
                    somehow maintaining the character and warmth that made it special in the first place.
                    The river is still the heart of the community: summer weekends bring families to Schlitterbahn,
                    the legendary water park, and locals know the best put-in spots for a lazy afternoon tube float
                    on the Comal or Guadalupe. Meanwhile, the historic district of Gruene — with its legendary
                    Gruene Hall dance venue, charming shops, and farm-to-table dining — draws visitors from
                    across the state and gives residents a genuinely world-class backyard.
                  </p>
                  <p>
                    The real estate market here has seen sustained demand driven by its position as a midpoint
                    between San Antonio and Austin on I-35. Remote workers and hybrid commuters have flocked
                    to New Braunfels over the past several years, drawn by the relative affordability compared
                    to Austin and the high quality of life. Master-planned communities like Vintage Oaks,
                    Veramendi, and Copper Ridge offer resort-style amenities with Comal ISD schools, while
                    established neighborhoods near downtown offer charming older homes at more accessible
                    price points. For investors, the short-term rental market near the river also provides
                    compelling opportunities.
                  </p>
                </div>

                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Why Buy in New Braunfels?
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
                    Browse Active New Braunfels Listings
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all homes for sale in New Braunfels — new construction, river properties, and established neighborhoods.
                  </p>
                  <Button asChild>
                    <Link href="/listings?city=New+Braunfels">
                      View New Braunfels Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-white p-5">
                  <MapPin className="h-5 w-5 text-gold shrink-0" />
                  <div className="flex-1">
                    <p className="text-body-sm font-semibold text-primary">New Braunfels Neighborhood Guide</p>
                    <p className="text-caption text-foreground-muted">Explore Gruene, Vintage Oaks, Veramendi & more</p>
                  </div>
                  <Link href="/neighborhoods/new-braunfels" className="inline-flex items-center gap-1 text-body-sm font-semibold text-gold hover:text-primary transition-colors">
                    View Guide <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Ready to find your home in New Braunfels?
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    From river properties to master-planned communities, our agents know every corner of New Braunfels.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?area=New+Braunfels">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?city=New+Braunfels">See Available Homes</Link>
                  </Button>
                  <div className="mt-6 border-t border-border pt-5">
                    <p className="text-caption text-foreground-muted text-center mb-3">Or call us directly</p>
                    <a href="tel:+12103909997" className="flex items-center justify-center gap-2 text-body-sm font-semibold text-primary hover:text-gold transition-colors">
                      <Phone className="h-4 w-4" /> 210-390-9997
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        <section className="section-compact bg-background-cream">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Let&apos;s Get Started</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Ready to find your home in New Braunfels?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Contact our local experts today. Whether it&apos;s your first home or an investment property on the river, we&apos;ll help you find it.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=New+Braunfels">Contact Our New Braunfels Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?city=New+Braunfels">Browse Listings <ArrowRight className="ml-2 h-4 w-4" /></Link>
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
              <Link href="/homes-for-sale/bulverde-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">Bulverde, TX</Link>
              <Link href="/homes-for-sale/canyon-lake-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">Canyon Lake, TX</Link>
              <Link href="/homes-for-sale/spring-branch-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">Spring Branch, TX</Link>
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
