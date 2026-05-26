export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, Shield, Star,
  CheckCircle, ArrowRight, Phone, Trees, Trophy,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/neighborhoods/cordillera-ranch`;

export const metadata: Metadata = {
  title: 'Cordillera Ranch Boerne TX | Luxury Hill Country Community Homes',
  description:
    'Homes for sale in Cordillera Ranch, Boerne TX — 8,700-acre Hill Country community with equestrian facilities, golf, and luxury custom homes from $700K.',
  alternates: { canonical: '/neighborhoods/cordillera-ranch' },
  openGraph: {
    title: 'Cordillera Ranch Boerne TX | Luxury Hill Country Community Homes',
    description:
      'Discover Cordillera Ranch in Boerne, TX — a premier luxury gated community with custom estates, private club, and stunning Hill Country views. Homes from $800K to $5M+.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Cordillera Ranch Luxury Homes — Boerne TX' }],
  },
  twitter: { card: 'summary_large_image' },
  keywords: [
    'cordillera ranch boerne tx homes',
    'cordillera ranch real estate',
    'cordillera ranch homes for sale',
    'cordillera ranch community boerne',
    'luxury homes cordillera ranch tx',
    'cordillera ranch gated community',
    'hill country estate boerne',
    'cordillera ranch lot for sale',
    'cordillera ranch country club homes',
    'boerne luxury real estate',
  ],
};

const STATS = [
  { icon: DollarSign, value: '$800K – $5M+', label: 'Home Price Range' },
  { icon: Home, value: '$200K+', label: 'Estate Lots From' },
  { icon: Trees, value: '8,700 acres', label: 'Community Size' },
  { icon: MapPin, value: '30 min', label: 'To San Antonio' },
];

const AMENITIES = [
  { icon: Trophy, title: 'Jack Nicklaus Signature Golf', desc: 'One of the most acclaimed golf courses in Texas Hill Country — private, meticulously maintained, and available exclusively to Club members.' },
  { icon: Star, title: 'The Club at Cordillera Ranch', desc: 'A five-club resort complex offering dining, swimming, tennis, fitness, and a full social calendar in a stunning Hill Country setting.' },
  { icon: Home, title: 'Equestrian Center', desc: 'Full equestrian facilities including a riding arena, boarding stalls, and direct access to miles of riding trails through the ranch\'s natural terrain.' },
  { icon: Trees, title: 'Guadalupe River Access', desc: 'Residents enjoy a private river park with access to the Guadalupe River for fishing, kayaking, and peaceful riverside relaxation.' },
  { icon: Shield, title: 'Spa & Swim Club', desc: 'A resort-style pool complex and spa facility rounds out the world-class amenity package available to Cordillera Ranch Club members.' },
  { icon: MapPin, title: 'Fishing Lakes', desc: 'Stocked lakes throughout the property offer a quiet escape for fishing enthusiasts and those who simply enjoy waterfront scenery.' },
];

const PROPERTY_TYPES = [
  { type: 'Custom Estates', price: '$1.5M – $5M+', desc: 'Architect-designed homes on generous parcels — often featuring Hill Country views, infinity pools, guest quarters, and high-end finishes throughout.' },
  { type: 'Semi-Custom Homes', price: '$800K – $1.5M', desc: 'Builder homes with significant customization options. Buyer selects finishes, layouts, and upgrades within a framework designed for efficiency without sacrificing luxury.' },
  { type: 'Estate Lots', price: '$200K – $800K', desc: 'Bring your own builder and design your dream estate from scratch. Lots range from one acre to over 20 acres with Hill Country ridge views.' },
];

const WHY_FAIR_OAKS = [
  'Experienced in Cordillera Ranch transactions at every price point',
  'Relationships with community\'s top custom builders',
  'Access to off-market estate listings before they hit MLS',
  'Deep knowledge of lot values, views, and deed restrictions',
  'Sandra Whitfield: Broker/Owner and Hill Country luxury specialist',
  'Full-service — from search through custom build management',
];

const FAQS = [
  {
    q: 'What makes Cordillera Ranch different from other luxury communities?',
    a: 'Cordillera Ranch\'s 8,700 acres set it apart from every other Texas Hill Country community. That sheer scale means true privacy, diverse terrain, and an amenity package — five clubs, a Jack Nicklaus golf course, equestrian center, river park, and fishing lakes — that simply cannot be replicated on a smaller footprint. It is less a neighborhood and more a private resort community where you happen to own your home.',
  },
  {
    q: 'Do I need to join the Club at Cordillera Ranch?',
    a: 'Membership in The Club at Cordillera Ranch is separate from home ownership. Residents can purchase memberships to access specific amenities — Golf Club, Tennis Club, Swim Club, Equestrian Club, or Social Club. Full membership provides access to all five. Membership levels and pricing change periodically; we can connect you with the Club directly during your home search.',
  },
  {
    q: 'What school district serves Cordillera Ranch?',
    a: 'Cordillera Ranch is served by Boerne ISD, consistently one of the highest-rated school districts in the San Antonio metro area. The district serves the entire Boerne area and offers strong academic programs, competitive athletics, and a variety of extracurricular activities. Private school options in Boerne and San Antonio are also accessible.',
  },
  {
    q: 'Are there still available lots for custom builds in Cordillera Ranch?',
    a: 'Yes, estate lots remain available within Cordillera Ranch, though inventory fluctuates. Lots range from approximately one acre to over 20 acres, with pricing starting around $200,000 and going significantly higher for ridge-top or river-view parcels. We can provide current lot availability and connect you with the community\'s preferred builders.',
  },
];

const NEARBY = [
  { name: 'The Dominion', href: '/neighborhoods/the-dominion', desc: 'San Antonio\'s premier guard-gated luxury community' },
  { name: 'Fair Oaks Ranch', href: '/neighborhoods/fair-oaks-ranch', desc: 'Master-planned Hill Country living, 30 min from San Antonio' },
  { name: 'All Luxury Homes', href: '/luxury-homes', desc: 'Browse our complete luxury portfolio across the Hill Country' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Neighborhoods', item: `${BASE_URL}/neighborhoods` },
        { '@type': 'ListItem', position: 3, name: 'Cordillera Ranch', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+12103909997',
      description: 'Luxury real estate specialists serving Cordillera Ranch, Boerne, Fair Oaks Ranch, and the Texas Hill Country.',
      areaServed: { '@type': 'Place', name: 'Cordillera Ranch, Boerne, TX' },
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

export default function CordilleraRanchPage() {
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
              <Link href="/neighborhoods" className="hover:text-primary transition-colors">Neighborhoods</Link>
              <span>/</span>
              <span className="text-primary font-medium">Cordillera Ranch</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                Boerne, TX — Kendall County
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Cordillera Ranch —<br />
                Boerne&apos;s Luxury Hill Country Estate Community
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Discover 8,700 acres of private resort-style living in the Texas Hill Country.
                Custom estates from <strong className="text-white">$800K to $5M+</strong>, a Jack Nicklaus
                golf course, equestrian center, and Guadalupe River access — all within 30 minutes of San Antonio.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?community=cordillera-ranch">Browse Cordillera Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact?area=CordilleraRanch">Contact Sandra Whitfield</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Stats Bar */}
        <div className="bg-[#C9A84C] py-6">
          <Container>
            <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
              {STATS.map(({ icon: Icon, value, label }) => (
                <div key={label} className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-primary/60" />
                  <div>
                    <div className="font-heading text-heading font-bold text-primary">{value}</div>
                    <div className="text-caption text-primary/60">{label}</div>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </div>

        {/* Community Overview + Sidebar */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="overline mb-3 text-[#C9A84C]">Community Overview</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  A Private Ranch Community Like No Other
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Cordillera Ranch is one of Texas&apos;s most acclaimed private communities — a breathtaking
                    8,700-acre gated estate community set in the rolling limestone hills of Boerne. Unlike
                    traditional subdivisions, Cordillera feels more like a private resort than a neighborhood,
                    with diverse natural terrain, dramatic Hill Country views, and amenities that rival five-star
                    resorts.
                  </p>
                  <p>
                    The community is anchored by The Club at Cordillera Ranch — a five-club resort complex
                    offering a Jack Nicklaus Signature golf course, full equestrian facilities, a spa and swim
                    club, tennis courts, and a stunning social clubhouse with dining and event space. A private
                    river park provides Guadalupe River access for fishing, swimming, and kayaking. Stocked
                    fishing lakes add another dimension of outdoor recreation within the community borders.
                  </p>
                  <p>
                    Homes range from semi-custom builds for buyers who want luxury without the full custom
                    process, to architecturally significant estates on multi-acre ridge-top parcels. The
                    community also retains a meaningful inventory of estate lots, giving buyers the opportunity
                    to work with premier custom builders to create a home perfectly suited to the land and their
                    lifestyle. Boerne ISD provides top-tier schooling, and San Antonio is a comfortable
                    30-minute drive via TX-46 and I-10.
                  </p>
                </div>

                {/* Amenities Grid */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    World-Class Amenities
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {AMENITIES.map(({ icon: Icon, title, desc }) => (
                      <div key={title} className="flex items-start gap-4 rounded-xl border border-border bg-background-cream p-5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#C9A84C]/10">
                          <Icon className="h-5 w-5 text-[#C9A84C]" />
                        </div>
                        <div>
                          <h3 className="font-heading text-body font-semibold text-primary mb-1">{title}</h3>
                          <p className="text-body-sm text-foreground-muted">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Property Types */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Types of Properties Available
                  </h2>
                  <div className="space-y-4">
                    {PROPERTY_TYPES.map(({ type, price, desc }) => (
                      <div key={type} className="rounded-xl border border-border bg-white p-6 shadow-sm">
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <h3 className="font-heading text-body font-bold text-primary">{type}</h3>
                          <span className="shrink-0 font-heading text-body font-bold text-[#C9A84C]">{price}</span>
                        </div>
                        <p className="text-body-sm text-foreground-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Why Fair Oaks Realty */}
                <div className="mt-10 rounded-2xl border border-border bg-background-cream p-7">
                  <p className="overline mb-2 text-[#C9A84C]">Why Fair Oaks Realty Group</p>
                  <h3 className="mb-4 font-heading text-heading font-bold text-primary">
                    Your Cordillera Ranch Specialists
                  </h3>
                  <ul className="space-y-2 mb-6">
                    {WHY_FAIR_OAKS.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-body-sm text-foreground-muted">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A84C]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Button asChild>
                    <Link href="/contact?area=CordilleraRanch">
                      Talk to Sandra Whitfield <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                {/* Nearby Communities */}
                <div className="mt-8">
                  <h3 className="mb-4 font-heading text-heading font-semibold text-primary">Explore Nearby</h3>
                  <div className="space-y-3">
                    {NEARBY.map(({ name, href, desc }) => (
                      <Link
                        key={name}
                        href={href}
                        className="flex items-center justify-between rounded-xl border border-border bg-white p-4 hover:border-[#C9A84C] transition-colors group"
                      >
                        <div>
                          <span className="font-semibold text-primary group-hover:text-[#C9A84C] transition-colors">{name}</span>
                          <p className="text-caption text-foreground-muted">{desc}</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-[#C9A84C] shrink-0" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 space-y-5">
                  <div className="rounded-xl border border-border bg-white p-6 shadow-card">
                    <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                      Interested in Cordillera Ranch?
                    </h3>
                    <p className="mb-5 text-body-sm text-foreground-muted">
                      Our luxury specialists have deep knowledge of Cordillera Ranch and can help you find
                      the right home — or the right lot to build on.
                    </p>
                    <Button size="lg" fullWidth asChild>
                      <Link href="/contact?area=CordilleraRanch">Contact Sandra Whitfield</Link>
                    </Button>
                    <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                      <Link href="/listings?community=cordillera-ranch">View Current Listings</Link>
                    </Button>
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="text-caption text-foreground-muted text-center mb-3">Or call us directly</p>
                      <a
                        href="tel:+12103909997"
                        className="flex items-center justify-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors"
                      >
                        <Phone className="h-4 w-4" /> (210) 390-9997
                      </a>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-background-cream p-6">
                    <p className="text-caption font-semibold uppercase tracking-wider text-[#C9A84C] mb-3">Also Explore</p>
                    <Link href="/luxury-homes" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors mb-2">
                      <ArrowRight className="h-3.5 w-3.5" /> All Luxury Communities
                    </Link>
                    <Link href="/homes-for-sale/boerne-tx" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors">
                      <ArrowRight className="h-3.5 w-3.5" /> Boerne, TX Homes for Sale
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* FAQ */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3">Common Questions</p>
              <h2 className="font-heading text-display-sm font-bold text-primary">
                Cordillera Ranch FAQ
              </h2>
            </div>
            <div className="mx-auto max-w-3xl space-y-4">
              {FAQS.map(({ q, a }) => (
                <details
                  key={q}
                  className="group rounded-2xl border border-border bg-white shadow-sm overflow-hidden"
                >
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
              <p className="overline mb-3 text-[#C9A84C]">Your Hill Country Estate Awaits</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Start Your Cordillera Ranch Search
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Whether you want a move-in ready estate or a custom lot to build your dream home,
                our luxury specialists are ready to help. Contact Sandra Whitfield for a private consultation.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/contact?area=CordilleraRanch">Contact Sandra Whitfield</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/listings?community=cordillera-ranch">
                    Browse Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
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
