export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Clock,
  ArrowRight, Phone, Trees, Star, Waves, Hammer,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CITY = 'Spring Branch';
const STATE = 'TX';
const SLUG = 'spring-branch-tx';
const AVG_PRICE = '$560,000';
const AVG_SQFT = '2,600';
const SCHOOL = 'Comal ISD';
const DIST_SA = '35 min';
const CANONICAL = `${BASE_URL}/homes-for-sale/${SLUG}`;

export async function generateMetadata(): Promise<Metadata> {
  const title = `Spring Branch TX Homes for Sale | Fair Oaks Realty Group`;
  const description =
    `Browse Spring Branch TX homes for sale. Avg. price ${AVG_PRICE}, Comal ISD, secluded Hill Country acreage, Guadalupe River access & custom homes. 35 min from San Antonio.`;

  return {
    title,
    description,
    alternates: { canonical: CANONICAL },
    openGraph: {
      title,
      description,
      url: CANONICAL,
      type: 'website',
      images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Spring Branch TX Homes for Sale — Fair Oaks Realty Group' }],
    },
    twitter: { card: 'summary_large_image', title, description },
    keywords: [
      'Spring Branch TX homes for sale',
      'Spring Branch Texas real estate',
      'homes for sale Spring Branch TX',
      'acreage homes Spring Branch TX',
      'Guadalupe River homes Texas',
      'Spring Branch TX real estate agent',
      'Comal ISD homes Hill Country',
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
      description: `Browse homes for sale in ${CITY}, ${STATE}. Average price ${AVG_PRICE}. ${SCHOOL}. Secluded Hill Country, Guadalupe River access, acreage properties and custom homes.`,
    },
  ],
};

const WHY_BUY = [
  { icon: Trees,   text: 'True Hill Country seclusion — large acreage properties with complete privacy' },
  { icon: Waves,   text: 'Guadalupe River access — swimming, kayaking & some of Texas\'s finest freshwater scenery' },
  { icon: Hammer,  text: 'Custom home market — bring your builder or choose from existing custom builds' },
  { icon: Star,    text: 'Abundant wildlife — deer, turkey, and native birds on most larger properties' },
  { icon: School,  text: 'Served by Comal ISD, consistently among the top-rated school districts in Texas' },
  { icon: MapPin,  text: '35 minutes to San Antonio and 20 minutes to New Braunfels via TX-46' },
];

export default function SpringBranchTxPage() {
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
              <span className="text-primary font-medium">Spring Branch, TX</span>
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
                Spring Branch, TX Homes for Sale
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Spring Branch is the Hill Country at its most authentic — secluded acreage, Guadalupe River
                access, abundant wildlife, and custom-built homes surrounded by cedar and live oak. If you want
                privacy, space, and natural beauty, this is it. Avg. home prices around <strong className="text-white">{AVG_PRICE}</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Spring+Branch">Browse Spring Branch Listings</Link>
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
                  Living in Spring Branch, TX
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Spring Branch occupies some of the most beautiful terrain in all of Comal County — a mostly
                    unincorporated stretch of rolling Hill Country along TX-46 between Boerne and New Braunfels.
                    The Guadalupe River winds through the area, providing water access, wildlife corridors, and
                    the distinctive sounds of a Texas Hill Country evening that residents describe as irreplaceable.
                    Properties here tend toward the larger end — acreage tracts ranging from a few acres to
                    hundreds of acres — and most homes are either custom-built originals or thoughtfully renovated
                    ranch-style properties that fit their natural surroundings.
                  </p>
                  <p>
                    What distinguishes Spring Branch from other Hill Country communities is its sense of genuine
                    remoteness. You can be 35 minutes from San Antonio International Airport and still feel
                    entirely disconnected from the city — waking up to deer on the property, spending afternoons
                    on the river, and watching sunsets over cedar ridges that stretch to the horizon. The community
                    is served by Comal ISD, which has built a reputation as one of the finest school districts in
                    Texas, making Spring Branch an attractive option even for families who need access to strong
                    public schools. For buyers seeking a custom home on meaningful acreage — not just a large
                    subdivision lot — Spring Branch offers opportunities that are increasingly scarce as the
                    surrounding Hill Country fills in.
                  </p>
                </div>

                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Why Buy in Spring Branch?
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
                    Browse Active Spring Branch Listings
                  </h3>
                  <p className="mb-5 text-body-sm text-foreground-muted">
                    View all homes and acreage properties for sale in Spring Branch, TX — updated daily from the MLS.
                  </p>
                  <Button asChild>
                    <Link href="/listings?city=Spring+Branch">
                      View Spring Branch Homes <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-white p-5">
                  <MapPin className="h-5 w-5 text-gold shrink-0" />
                  <div className="flex-1">
                    <p className="text-body-sm font-semibold text-primary">Spring Branch Neighborhood Guide</p>
                    <p className="text-caption text-foreground-muted">Explore acreage areas, river access properties & local insights</p>
                  </div>
                  <Link href="/neighborhoods/spring-branch" className="inline-flex items-center gap-1 text-body-sm font-semibold text-gold hover:text-primary transition-colors">
                    View Guide <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Ready to find your home in Spring Branch?
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    Acreage and custom home transactions are our specialty. Let us help you find the right property in Spring Branch.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href="/contact?area=Spring+Branch">Talk to a Local Expert</Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href="/listings?city=Spring+Branch">See Available Homes</Link>
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
                Ready to find your home in Spring Branch?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Contact our local experts for guidance on acreage, custom homes, and river properties in Spring Branch, TX.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=Spring+Branch">Contact Our Spring Branch Experts</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?city=Spring+Branch">Browse Listings <ArrowRight className="ml-2 h-4 w-4" /></Link>
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
