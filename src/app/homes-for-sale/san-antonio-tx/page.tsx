export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  ArrowRight, Phone, Star, Shield, Building2, Users,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CITY = 'San Antonio';
const STATE = 'TX';
const SLUG = 'san-antonio-tx';
const AVG_PRICE = '$385,000';
const AVG_SQFT = '1,950';
const SCHOOL = 'Multiple ISDs';
const DIST_SA = 'Urban Center';
const CANONICAL = `${BASE_URL}/homes-for-sale/${SLUG}`;

export async function generateMetadata(): Promise<Metadata> {
  const title = `San Antonio TX Homes for Sale | Fair Oaks Realty Group`;
  const description =
    `Browse San Antonio TX homes for sale. Avg. price ${AVG_PRICE}. Military-friendly, VA loan experts, diverse neighborhoods & major employers. Local agents who know every zip code.`;

  return {
    title,
    description,
    alternates: { canonical: CANONICAL },
    openGraph: {
      title,
      description,
      url: CANONICAL,
      type: 'website',
      images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'San Antonio TX Homes for Sale — Fair Oaks Realty Group' }],
    },
    twitter: { card: 'summary_large_image', title, description },
    keywords: [
      'San Antonio TX homes for sale',
      'San Antonio Texas real estate',
      'homes for sale San Antonio',
      'VA loan San Antonio',
      'military homes San Antonio TX',
      'San Antonio TX real estate agent',
      'Fair Oaks Realty Group San Antonio',
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
      description: `Browse homes for sale in ${CITY}, ${STATE}. Average price ${AVG_PRICE}. Military-friendly, VA loan expertise, diverse neighborhoods across all price ranges.`,
    },
  ],
};

const WHY_BUY = [
  { icon: Shield,    text: 'Military-friendly — VA loan specialists serving Fort Sam Houston, Lackland, Randolph & JBSA' },
  { icon: Users,     text: 'Deeply diverse market with neighborhoods at every price point, from $200K to $1M+' },
  { icon: Building2, text: 'Major employers: USAA, Valero, H-E-B, Methodist Health System & the Medical Center' },
  { icon: Star,      text: 'Rich culture — River Walk, The Pearl, local dining, arts & world-class entertainment' },
  { icon: Home,      text: 'Strong long-term appreciation with a rapidly growing metro economy' },
  { icon: MapPin,    text: 'Gateway to the Hill Country — access suburban and rural communities in under 30 minutes' },
];

export default function SanAntonioTxPage() {
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
              <span className="text-primary font-medium">San Antonio, TX</span>
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
                San Antonio, TX Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                San Antonio is Texas&apos;s second-largest city and one of the most affordable major metros in the
                nation. With a booming economy, rich culture, and a proud military community, it offers something
                for every buyer. Average home prices around <strong className="text-white">{AVG_PRICE}</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=San+Antonio">Browse San Antonio Listings</Link>
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
                  <div className="text-caption text-primary/60">School Districts</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary/60" />
                <div>
                  <div className="font-heading text-heading font-bold text-primary">{DIST_SA}</div>
                  <div className="text-caption text-primary/60">Location</div>
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
                  Living in San Antonio, TX
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    San Antonio is one of the fastest-growing major metros in the United States — and for good reason.
                    The city offers a rare combination of affordability, culture, economic opportunity, and lifestyle
                    that is increasingly hard to find in Texas. From the world-famous River Walk and Pearl District
                    to the sprawling Medical Center and the technology corridor along I-10, San Antonio&apos;s diverse
                    neighborhoods give buyers an enormous range of options without the price premiums seen in
                    Austin or Dallas. With home prices averaging around $385,000, San Antonio remains one of the
                    most accessible major city real estate markets in the South.
                  </p>
                  <p>
                    San Antonio is also home to one of the largest military communities in the nation. Fort Sam
                    Houston, Joint Base San Antonio–Lackland, Randolph Air Force Base, and Camp Bullis collectively
                    support tens of thousands of active duty service members, veterans, and their families.
                    Fair Oaks Realty Group has deep expertise in VA financing, PCS timelines, and military-adjacent
                    neighborhoods — making us a natural partner for military buyers navigating the San Antonio market.
                    Whether you&apos;re buying with a VA loan for the first time or selling before a reassignment, our team
                    understands the unique demands of military real estate.
                  </p>
                </div>

                {/* Military Spotlight */}
                <div className="mt-8 rounded-xl bg-blue-900 p-6 text-white">
                  <div className="flex items-start gap-3">
                    <Shield className="h-6 w-6 text-yellow-400 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="mb-2 font-heading text-heading font-bold text-white">
                        Military &amp; VA Loan Specialists
                      </h3>
                      <p className="mb-4 text-body-sm text-white/70">
                        We proudly serve active duty, veterans, and military families across all JBSA installations.
                        VA loans, $0 down, PCS-ready timelines — we handle it all.
                      </p>
                      <Link
                        href="/contact?service=military"
                        className="inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-body-sm font-bold text-blue-900 hover:bg-yellow-300 transition-colors"
                      >
                        Talk to a VA Specialist <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Why Buy in San Antonio?
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
                    Browse Active San Antonio Listings
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all homes currently for sale in San Antonio, TX — updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?city=San+Antonio">
                      View San Antonio Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Ready to find your home in San Antonio?
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    From the northwest side near the Hill Country to established neighborhoods near the Medical Center — our agents know every corner of this city.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?area=San+Antonio">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?city=San+Antonio">See Available Homes</Link>
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
                Ready to find your home in San Antonio?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Contact our local experts for honest guidance. Whether you&apos;re using a VA loan or conventional financing, we&apos;ll get you home.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=San+Antonio">Contact Our San Antonio Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?city=San+Antonio">Browse Listings <ArrowRight className="ml-2 h-4 w-4" /></Link>
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
