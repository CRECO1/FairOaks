export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  ArrowRight, Phone, Trees, Star, Shield, Layers,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CITY = 'Fair Oaks Ranch';
const STATE = 'TX';
const SLUG = 'fair-oaks-ranch-tx';
const AVG_PRICE = '$680,000';
const AVG_SQFT = '2,800';
const SCHOOL = 'Boerne ISD';
const DIST_SA = '20 min';
const CANONICAL = `${BASE_URL}/homes-for-sale/${SLUG}`;

export async function generateMetadata(): Promise<Metadata> {
  const title = `Fair Oaks Ranch TX Homes for Sale | Fair Oaks Realty Group`;
  const description =
    `Browse homes for sale in Fair Oaks Ranch, TX. Gated communities, horse properties, and Hill Country estates from $400K–$2M+. Local MLS listings updated daily.`;

  return {
    title,
    description,
    alternates: { canonical: '/homes-for-sale/fair-oaks-ranch-tx' },
    openGraph: {
      title,
      description,
      url: CANONICAL,
      type: 'website',
      images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Fair Oaks Ranch TX Homes for Sale — Fair Oaks Realty Group' }],
    },
    twitter: { card: 'summary_large_image', title, description },
    keywords: [
      'Fair Oaks Ranch TX homes for sale',
      'Fair Oaks Ranch Texas real estate',
      'homes for sale Fair Oaks Ranch TX',
      'Boerne ISD homes Fair Oaks Ranch',
      'Fair Oaks Ranch gated community',
      'Hill Country luxury homes for sale',
      'Fair Oaks Realty Group',
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
      description: `Browse homes for sale in ${CITY}, ${STATE}. Average price ${AVG_PRICE}. ${SCHOOL}. Premier master-planned Hill Country community, gated options, equestrian trails.`,
    },
  ],
};

const WHY_BUY = [
  { icon: Shield,  text: 'Gated community options providing an extra layer of privacy and security' },
  { icon: Star,    text: 'Premier master-planned community with active HOA and organized events' },
  { icon: Trees,   text: 'Equestrian trails, nature paths, and Hill Country views from most lots' },
  { icon: School,  text: 'Top-rated Boerne ISD — some of the best academic outcomes in the region' },
  { icon: Layers,  text: 'Diverse inventory: custom builds, luxury resales, and move-in-ready options' },
  { icon: MapPin,  text: 'Just 20 minutes from San Antonio — among the closest Hill Country communities to the city' },
];

export default function FairOaksRanchTxPage() {
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
              <span className="text-primary font-medium">Fair Oaks Ranch, TX</span>
            </nav>
          </Container>
        </div>

        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">
                <MapPin className="mr-1 inline h-3 w-3" />
                Bexar &amp; Kendall County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Fair Oaks Ranch, TX Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Fair Oaks Ranch is the Texas Hill Country at its finest — a premier master-planned community
                with Hill Country views, gated neighborhoods, equestrian trails, and top-rated Boerne ISD schools,
                just 20 minutes from San Antonio. Avg. price around <strong className="text-white">{AVG_PRICE}</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Fair+Oaks+Ranch">Browse Fair Oaks Ranch Listings</Link>
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
                  Living in Fair Oaks Ranch, TX
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Fair Oaks Ranch is not just where our brokerage is rooted — it is one of the genuine jewels
                    of the Texas Hill Country. Spanning both Bexar and Kendall counties along US-87 northwest of
                    San Antonio, this master-planned community was developed over five decades to embrace the
                    natural terrain rather than flatten it. The result is a neighborhood of winding roads, mature
                    live oaks, Hill Country vistas, and homes that feel like they belong to the landscape. The
                    community sits just 20 minutes from San Antonio — making it one of the most accessible
                    Hill Country addresses in the region while remaining genuinely removed from the city&apos;s pace.
                  </p>
                  <p>
                    Homes in Fair Oaks Ranch range from elegant custom builds on oversized lots to gated enclave
                    properties designed for privacy and luxury. The community&apos;s active HOA organizes regular events
                    — from community cleanup days to holiday parades — that foster a genuine neighborhood culture
                    you don&apos;t find in most suburban developments. Equestrian trails wind through the acreage,
                    and the views from higher elevations span miles of undisturbed Hill Country. For families,
                    Boerne ISD — which serves Fair Oaks Ranch — is consistently one of the top-performing
                    districts in all of Texas, with strong academic metrics and outstanding extracurricular programs.
                    This is a community where people come and put down roots for life.
                  </p>
                </div>

                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Why Buy in Fair Oaks Ranch?
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
                    Browse Active Fair Oaks Ranch Listings
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all homes currently for sale in Fair Oaks Ranch — updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?city=Fair+Oaks+Ranch">
                      View Fair Oaks Ranch Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-white p-5">
                  <MapPin className="h-5 w-5 text-gold shrink-0" />
                  <div className="flex-1">
                    <p className="text-body-sm font-semibold text-primary">Fair Oaks Ranch Neighborhood Guide</p>
                    <p className="text-caption text-foreground-muted">Explore gated communities, school zones & local insights</p>
                  </div>
                  <Link href="/neighborhoods/fair-oaks-ranch" className="inline-flex items-center gap-1 text-body-sm font-semibold text-gold hover:text-primary transition-colors">
                    View Guide <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Ready to find your home in Fair Oaks Ranch?
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    This is our home market. We know every street, subdivision, and gated community in Fair Oaks Ranch.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?area=Fair+Oaks+Ranch">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?city=Fair+Oaks+Ranch">See Available Homes</Link>
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
                Ready to find your home in Fair Oaks Ranch?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Contact our local experts — Fair Oaks Ranch is our home market and we bring unmatched knowledge to every transaction here.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=Fair+Oaks+Ranch">Contact Our Local Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?city=Fair+Oaks+Ranch">Browse Listings <ArrowRight className="ml-2 h-4 w-4" /></Link>
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
              <Link href="/homes-for-sale/boerne-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">Boerne, TX</Link>
              <Link href="/homes-for-sale/helotes-tx" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">Helotes, TX</Link>
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
