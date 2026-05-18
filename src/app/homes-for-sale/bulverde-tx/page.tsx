export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  ArrowRight, Phone, Trees, Star, Hammer, Layers,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CITY = 'Bulverde';
const STATE = 'TX';
const SLUG = 'bulverde-tx';
const AVG_PRICE = '$520,000';
const AVG_SQFT = '2,500';
const SCHOOL = 'Comal ISD';
const DIST_SA = '30 min';
const CANONICAL = `${BASE_URL}/homes-for-sale/${SLUG}`;

export async function generateMetadata(): Promise<Metadata> {
  const title = `Bulverde TX Homes for Sale | Fair Oaks Realty Group`;
  const description =
    `Browse Bulverde TX homes for sale. Avg. price ${AVG_PRICE}, Comal ISD, fast-growing Hill Country community with new construction & acreage lots, 30 min from San Antonio.`;

  return {
    title,
    description,
    alternates: { canonical: CANONICAL },
    openGraph: {
      title,
      description,
      url: CANONICAL,
      type: 'website',
      images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Bulverde TX Homes for Sale — Fair Oaks Realty Group' }],
    },
    twitter: { card: 'summary_large_image', title, description },
    keywords: [
      'Bulverde TX homes for sale',
      'Bulverde Texas real estate',
      'homes for sale Bulverde TX',
      'Comal ISD homes Bulverde',
      'new construction Bulverde TX',
      'Bulverde TX real estate agent',
      'Hill Country homes for sale near San Antonio',
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
      description: `Browse homes for sale in ${CITY}, ${STATE}. Average price ${AVG_PRICE}. ${SCHOOL}. Fast-growing Hill Country community with new construction and acreage lots.`,
    },
  ],
};

const WHY_BUY = [
  { icon: Star,    text: 'One of the fastest-growing communities in the Texas Hill Country' },
  { icon: Hammer,  text: 'Strong new construction inventory from top regional builders' },
  { icon: Layers,  text: 'Acreage lots available — build your custom home with room to breathe' },
  { icon: School,  text: 'Served by Comal ISD, consistently one of the top-rated districts in Texas' },
  { icon: Trees,   text: 'Rural Hill Country character with established neighborhood amenities' },
  { icon: MapPin,  text: 'Positioned between San Antonio and New Braunfels — easy commutes in both directions' },
];

export default function BulverdeTxPage() {
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
              <span className="text-primary font-medium">Bulverde, TX</span>
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
                Bulverde, TX Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Bulverde is one of the Hill Country&apos;s fastest-growing communities — offering new construction
                homes, acreage lots, and top-rated Comal ISD schools, all just 30 minutes from San Antonio.
                Average home prices around <strong className="text-white">{AVG_PRICE}</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Bulverde">Browse Bulverde Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
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

        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-gold">About the Area</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  Living in Bulverde, TX
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Bulverde sits in the heart of Comal County, occupying the rolling terrain between San Antonio
                    and New Braunfels. For the past decade, it has consistently ranked among the fastest-growing
                    communities in Texas — and buyers are coming for a combination of reasons that&apos;s hard to replicate
                    elsewhere. Comal ISD, which serves Bulverde, is widely regarded as one of the best school districts
                    in the state. The landscape offers genuine Hill Country character with wide-open skies, cedar and
                    live oak, and the kind of stargazing that&apos;s impossible closer to the city. And yet San Antonio
                    remains just 30 minutes south on US-281 — close enough for work, entertainment, and the airport.
                  </p>
                  <p>
                    The housing market reflects the area&apos;s growth. Builders have invested heavily in new construction
                    master-planned communities throughout Bulverde, offering modern floorplans and energy-efficient
                    builds at prices that remain below equivalent new construction in Boerne or Fair Oaks Ranch. At
                    the same time, there&apos;s still a meaningful supply of acreage lots for buyers who want a custom home
                    with room for a workshop, garden, or livestock. Whether you&apos;re a growing family looking for a
                    top-rated school district and room to expand, or a buyer who wants the character of the Hill
                    Country without the premium of a more established address, Bulverde is worth serious consideration.
                  </p>
                </div>

                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Why Buy in Bulverde?
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
                    Browse Active Bulverde Listings
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all homes currently for sale in Bulverde, TX — including new construction and resale.
                  </p>
                  <Button asChild>
                    <Link href="/listings?city=Bulverde">
                      View Bulverde Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-white p-5">
                  <MapPin className="h-5 w-5 text-gold shrink-0" />
                  <div className="flex-1">
                    <p className="text-body-sm font-semibold text-primary">Bulverde Neighborhood Guide</p>
                    <p className="text-caption text-foreground-muted">Explore master-planned communities, school zones & local insights</p>
                  </div>
                  <Link href="/neighborhoods/bulverde" className="inline-flex items-center gap-1 text-body-sm font-semibold text-gold hover:text-primary transition-colors">
                    View Guide <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Ready to find your home in Bulverde?
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    Our agents specialize in Bulverde new construction and resale — we&apos;ll help you compare builders, communities, and lots.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?area=Bulverde">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?city=Bulverde">See Available Homes</Link>
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

        <section className="section-compact bg-background-cream">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Let&apos;s Get Started</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Ready to find your home in Bulverde?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Contact our local experts for honest guidance on Bulverde real estate — new construction, resale, or acreage.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=Bulverde">Contact Our Bulverde Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?city=Bulverde">Browse Listings <ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
              </div>
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
