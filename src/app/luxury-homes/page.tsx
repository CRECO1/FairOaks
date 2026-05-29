export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Star, CheckCircle, ArrowRight, Phone, MapPin,
  Home, DollarSign, Eye, Shield, Key, Search,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export const metadata: Metadata = {
  title: 'Luxury Homes for Sale in Texas Hill Country | Fair Oaks Realty Group',
  description:
    'Explore luxury homes for sale in the Texas Hill Country — Fair Oaks Ranch, Boerne, and San Antonio\'s finest neighborhoods. Properties from $750K to $3M+.',
  keywords: ['luxury homes texas hill country', 'luxury homes fair oaks ranch', 'luxury homes boerne tx', 'homes over 1 million san antonio', 'gated communities san antonio', 'cordillera ranch homes', 'the dominion san antonio', 'hill country estates', 'custom homes texas hill country', 'waterfront luxury homes texas'],
  alternates: { canonical: '/luxury-homes' },
  openGraph: {
    title: 'Luxury Homes for Sale in Texas Hill Country | Fair Oaks Realty Group',
    description:
      'Browse luxury homes $750K+ in Fair Oaks Ranch, Boerne, and the Texas Hill Country. Gated communities, Hill Country estates, waterfront properties, and custom builds.',
    url: `${BASE_URL}/luxury-homes`,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Luxury Homes — Texas Hill Country' }],
  },
};

const STATS = [
  { label: 'Price Range', value: '$750K – $5M+' },
  { label: 'Avg. Sqft', value: '3,200+' },
  { label: 'Gated Communities', value: 'Available' },
  { label: 'Hill Country Views', value: 'Iconic' },
];

const COMMUNITIES = [
  {
    name: 'Fair Oaks Ranch Gated Estates',
    location: 'Fair Oaks Ranch, TX',
    priceRange: '$850K – $2.5M',
    school: 'Boerne ISD',
    highlights: ['Gated entry with 24-hr security', 'Equestrian trails on-site', 'Custom estate home sites', 'Hill Country panoramic views'],
    description:
      'Nestled in the rolling terrain northwest of San Antonio, Fair Oaks Ranch gated estates represent the pinnacle of Hill Country luxury. Spanning thousands of acres, these enclaves blend privacy with community — offering equestrian facilities, resort-style amenities, and homes crafted by the region\'s premier custom builders.',
  },
  {
    name: 'The Dominion',
    location: 'San Antonio, TX',
    priceRange: '$1M – $5M+',
    school: 'Northside ISD',
    highlights: ['24-hour security & gate staff', 'Private golf club', 'Resort-style clubhouse', 'Tennis & fitness facilities'],
    description:
      'One of San Antonio\'s most prestigious addresses, The Dominion offers an unparalleled guard-gated lifestyle with a world-class private golf course and an active social scene. Properties range from elegant villa-style homes to sprawling custom estates, all within a carefully curated community that commands some of the highest prices in the metro.',
  },
  {
    name: 'Cordillera Ranch',
    location: 'Boerne, TX',
    priceRange: '$750K – $3M',
    school: 'Boerne ISD',
    highlights: ['8,700-acre private community', 'Jack Nicklaus Signature golf', 'Equestrian center & stables', 'Guadalupe River access'],
    description:
      'Cordillera Ranch is one of Texas\'s most acclaimed luxury communities — a breathtaking 8,700-acre private ranch community in the Boerne Hill Country. Home to a Jack Nicklaus Signature golf course, full equestrian center, river park, and five clubs, it offers a lifestyle that is genuinely unmatched anywhere in Central Texas.',
  },
  {
    name: 'TPC San Antonio Area',
    location: 'San Antonio North, TX',
    priceRange: '$800K – $2M',
    school: 'North East ISD',
    highlights: ['Adjacent to TPC golf resort', 'Luxury new construction available', 'Walkable resort amenities', 'Easy Stone Oak access'],
    description:
      'Homes in the TPC San Antonio corridor place residents steps from two championship PGA-caliber golf courses and the luxury JW Marriott resort. The surrounding neighborhoods offer upscale new construction and established estates with a hotel-resort lifestyle built into daily living.',
  },
  {
    name: 'Ruby Ranch',
    location: 'Dripping Springs, TX',
    priceRange: '$650K – $1.5M',
    school: 'Dripping Springs ISD',
    highlights: ['Hill Country acreage homesites', 'Private ranch atmosphere', 'Top-rated Dripping Springs ISD', 'Quiet, low-density community'],
    description:
      'Ruby Ranch offers the rare combination of acreage living and neighborhood community in Dripping Springs — one of the fastest-growing and most sought-after Hill Country corridors. Residents enjoy large private lots surrounded by oak canopy, dark skies, and the unhurried pace that defines the best of Texas Hill Country living.',
  },
  {
    name: 'Vintage Oaks',
    location: 'New Braunfels, TX',
    priceRange: '$600K – $1.5M',
    school: 'Comal ISD',
    highlights: ['Hill Country estate lots 1-14 acres', 'Resort-style clubhouse & pools', 'Fitness center & sports courts', 'Close to Canyon Lake'],
    description:
      'Vintage Oaks in New Braunfels is one of the Hill Country\'s premier master-planned estate communities. With sites ranging from one to fourteen acres amid native oak trees and limestone outcroppings, it\'s a place to build a custom legacy home while enjoying resort-class amenities and easy access to the Guadalupe River and Canyon Lake.',
  },
];

const BUYING_SERVICES = [
  {
    icon: Eye,
    title: 'Private & Off-Market Showings',
    description:
      'Many luxury properties never appear on public portals. Our network of top-producing agents and builder relationships gives you access to off-market estate listings and pre-market opportunities before they hit the MLS.',
  },
  {
    icon: Shield,
    title: 'Discretion & Confidentiality',
    description:
      'We understand that high-profile buyers and sellers require privacy. We handle every transaction with absolute professionalism — protecting your identity, timeline, and financial details throughout the process.',
  },
  {
    icon: Search,
    title: 'Custom Luxury Property Search',
    description:
      'A mass portal search won\'t find your dream estate. We take the time to understand your lifestyle needs — acreage, architecture, views, horses, pools, proximity — and hand-curate a short list of properties that actually match.',
  },
  {
    icon: Key,
    title: 'Relocation Concierge',
    description:
      'Moving to the Hill Country from another market? We coordinate everything — from neighborhood orientation tours to introductions to local luxury vendors, designers, and contractors — so your transition feels effortless.',
  },
  {
    icon: DollarSign,
    title: 'Expert Luxury Negotiation',
    description:
      'Negotiating a $2M estate requires different skills than a starter home. We bring sophisticated contract strategy, a deep knowledge of luxury comps, and the credibility with listing agents that gets your offers taken seriously.',
  },
  {
    icon: Home,
    title: 'Builder & Developer Access',
    description:
      'Interested in a custom build or a semi-custom spec home from a premier builder? We have established relationships with the Hill Country\'s top luxury builders and can shepherd you through the entire new construction process at no additional cost.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      description: 'Luxury real estate specialists serving the Texas Hill Country — Fair Oaks Ranch, Boerne, San Antonio, and surrounding communities.',
      areaServed: [
        { '@type': 'Place', name: 'Fair Oaks Ranch, TX' },
        { '@type': 'Place', name: 'Boerne, TX' },
        { '@type': 'Place', name: 'San Antonio, TX' },
        { '@type': 'Place', name: 'Texas Hill Country' },
      ],
      priceRange: '$$$',
    },
    {
      '@type': 'ItemList',
      name: 'Luxury Communities in the Texas Hill Country',
      description: 'Premier gated and estate communities with homes priced $750K and above.',
      numberOfItems: COMMUNITIES.length,
      itemListElement: COMMUNITIES.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        description: c.description,
      })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Luxury Homes', item: `${BASE_URL}/luxury-homes` },
      ],
    },
  ],
};

export default function LuxuryHomesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main className="min-h-screen pt-20">

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-gold">Exceptional Properties</p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Luxury Homes in the<br />
                <span className="text-gradient-gold">Texas Hill Country</span>
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Discover estates priced from $750K to $5M+ across Fair Oaks Ranch, Boerne, and the surrounding
                Hill Country. Private gated enclaves, custom ranch homes, resort-style living — and agents who know
                every community from the inside out.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?minPrice=750000">Browse Luxury Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Schedule Private Consultation</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Stats Bar */}
        <div className="bg-gold py-6">
          <Container>
            <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
              {STATS.map(({ label, value }) => (
                <div key={label} className="text-center sm:text-left">
                  <div className="font-heading text-heading font-bold text-primary">{value}</div>
                  <div className="text-caption text-primary/60">{label}</div>
                </div>
              ))}
            </div>
          </Container>
        </div>

        {/* What Defines Hill Country Luxury */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-14 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">A Different Kind of Luxury</p>
                <h2 className="mb-6 font-heading text-display-sm font-bold text-primary">
                  What Defines Hill Country Luxury
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Luxury in the Texas Hill Country is not the same as luxury anywhere else. Here, the terrain
                    is the amenity. Sweeping limestone ridgelines, ancient live oaks, and spring-fed creeks form
                    the backdrop for estates that emphasize privacy, scale, and a deep connection to the land.
                    Properties routinely feature multi-acre homesites, custom architecture that embraces the
                    natural landscape, and outdoor living spaces designed around the region&apos;s legendary sunsets.
                  </p>
                  <p>
                    Whether you are drawn to a gated equestrian community in Cordillera Ranch, a resort-style
                    villa in The Dominion, or a private custom estate on acreage outside Boerne, the common thread
                    is intentionality. These are not simply large homes — they are lifestyle investments. Expect
                    smart home automation, resort-style pools, wine cellars, guest quarters, and outdoor kitchens
                    as standard features in the $1M+ tier. At the ultra-luxury level, working horse facilities,
                    private ponds, and full guest ranches are not uncommon.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  { icon: MapPin, label: 'Hill Country Terrain', desc: 'Panoramic ridge views, canyon overlooks, and spring-fed creek frontage' },
                  { icon: Shield, label: 'Privacy & Security', desc: 'Guard-gated entries, acreage buffers, and discreet listing practices' },
                  { icon: Home, label: 'Custom Architecture', desc: 'Limestone, cedar, and steel — built to harmonize with the land, not fight it' },
                  { icon: Star, label: 'Resort-Style Living', desc: 'Infinity pools, outdoor kitchens, and equestrian facilities as standard' },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="rounded-xl bg-white p-5 shadow-sm border border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold/10 mb-3">
                      <Icon className="h-5 w-5 text-gold" />
                    </div>
                    <h3 className="font-heading text-body font-semibold text-primary mb-1">{label}</h3>
                    <p className="text-body-sm text-foreground-muted">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        {/* Luxury Communities */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">Where Luxury Lives</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Luxury Communities
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                From gated golf communities to private ranch estates, the Hill Country offers a luxury community
                for every lifestyle. Here are the areas we know best.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              {COMMUNITIES.map((community) => (
                <div
                  key={community.name}
                  className="rounded-2xl bg-white border border-border shadow-sm p-7 sm:p-8 flex flex-col h-full"
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-heading text-heading font-bold text-primary mb-1">
                        {community.name}
                      </h3>
                      <p className="flex items-center gap-1 text-body-sm text-foreground-muted">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        {community.location}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-heading text-body font-bold text-gold">{community.priceRange}</div>
                      <div className="text-caption text-foreground-muted">{community.school}</div>
                    </div>
                  </div>

                  <p className="mb-5 text-body-sm text-foreground-muted leading-relaxed flex-1">
                    {community.description}
                  </p>

                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {community.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-body-sm text-foreground-muted">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Luxury Buying Services */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">White-Glove Service</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Luxury Buying Services
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Buying a luxury home requires a different level of service. Here is what we do differently for
                buyers in the $750K+ market.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {BUYING_SERVICES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-2xl bg-white border border-border shadow-sm p-7 flex flex-col"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10 mb-4">
                    <Icon className="h-6 w-6 text-gold" />
                  </div>
                  <h3 className="mb-3 font-heading text-body font-bold text-primary">{title}</h3>
                  <p className="text-body-sm text-foreground-muted leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Search Luxury Listings CTA Card */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Start Your Search</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Search Luxury Listings
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse our current selection of $750K+ homes across Fair Oaks Ranch, Boerne, The Dominion,
                Cordillera Ranch, and beyond. Updated daily with the latest MLS data.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?minPrice=750000">
                    Browse $750K+ Homes <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Schedule Private Showing</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Why We're Different */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">Local Expertise</p>
                <h2 className="mb-6 font-heading text-display-sm font-bold text-primary">
                  Hill Country Luxury<br />Is Our Specialty
                </h2>
                <div className="space-y-4 text-body text-foreground-muted leading-relaxed">
                  <p>
                    We are not a national brokerage with a Hill Country branch office. Fair Oaks Realty Group
                    was built here, and our agents have spent years developing relationships with the region&apos;s
                    premier custom builders, luxury developers, and listing agents. When a Cordillera estate
                    is coming to market or a builder has a signature spec home nearly complete, we hear about
                    it — and we bring that intelligence directly to our clients.
                  </p>
                  <p>
                    For sellers, we bring the same depth of knowledge to pricing and marketing. We know which
                    luxury communities are seeing the strongest absorption, which features command premiums,
                    and how to position your estate to attract the right buyer — not just any buyer.
                  </p>
                </div>
                <ul className="mt-6 space-y-3">
                  {[
                    '20+ years of Hill Country market experience',
                    'Deep relationships with luxury builders and developers',
                    'Proven track record in $1M+ transactions',
                    'Full-service — from search to keys and beyond',
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-body text-foreground-muted">
                      <CheckCircle className="h-5 w-5 shrink-0 text-gold" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Footer CTA Card */}
              <div className="rounded-2xl border border-border bg-white p-8 shadow-sm">
                <Star className="mb-4 h-9 w-9 text-gold" />
                <h3 className="mb-3 font-heading text-heading-xl font-bold text-primary">
                  Ready for a Private Luxury Consultation?
                </h3>
                <p className="mb-6 text-body text-foreground-muted leading-relaxed">
                  Tell us about the estate you are looking for — or the one you are ready to sell. Our luxury
                  specialists will connect with you personally to discuss your goals with full discretion.
                </p>
                <Button size="lg" fullWidth asChild>
                  <Link href="/contact">
                    Request Private Consultation <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                  <a href="tel:+12103909997">
                    <Phone className="mr-2 h-4 w-4" />210-390-9997
                  </a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

      </main>
      <Footer />
    </>
  );
}
