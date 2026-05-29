export const revalidate = 86400;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, DollarSign, Home, School, Trees,
  CheckCircle, ArrowRight, Phone, Star, Calendar,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/neighborhoods/fair-oaks-ranch`;

export const metadata: Metadata = {
  title: 'Fair Oaks Ranch TX Community Guide | Neighborhoods, Homes & Lifestyle',
  description:
    'Homes for sale in Fair Oaks Ranch TX — a scenic Hill Country community near San Antonio with top-rated Boerne ISD schools and beautiful natural surroundings.',
  alternates: { canonical: '/neighborhoods/fair-oaks-ranch' },
  openGraph: {
    title: 'Fair Oaks Ranch TX Community Guide | Neighborhoods, Homes & Lifestyle',
    description:
      'Explore Fair Oaks Ranch, TX — a premier master-planned community 20 miles from San Antonio. Boerne ISD schools, gated options, equestrian lifestyle, and homes from $400K to $2M+.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'Fair Oaks Ranch TX Community Guide — Fair Oaks Realty Group' }],
  },
  twitter: { card: 'summary_large_image' },
  keywords: [
    'fair oaks ranch tx community',
    'fair oaks ranch neighborhood guide',
    'fair oaks ranch master planned',
    'living in fair oaks ranch',
    'fair oaks ranch amenities',
    'fair oaks ranch schools boerne isd',
    'fair oaks ranch gated communities',
    'fair oaks ranch real estate',
    'fair oaks ranch lifestyle',
    'move to fair oaks ranch',
  ],
};

const STATS = [
  { icon: DollarSign, value: '$400K – $2M+', label: 'Home Price Range' },
  { icon: School, value: 'Boerne ISD', label: 'School District' },
  { icon: MapPin, value: '~20 miles', label: 'From San Antonio' },
  { icon: Home, value: 'Est. 1978', label: 'Community Founded' },
];

const AMENITIES = [
  { icon: Trees, title: 'Hill Country Golf Club', desc: 'Fair Oaks Ranch Golf & Country Club features two 18-hole championship courses set amid native oak and cedar — one of the Hill Country\'s most storied golf venues.' },
  { icon: Star, title: 'Parks & Green Space', desc: 'Numerous neighborhood parks, open spaces, and natural areas are woven throughout the community, preserving the Hill Country character and providing residents with outdoor escapes.' },
  { icon: Home, title: 'Equestrian Lifestyle', desc: 'Horse properties and equestrian-friendly neighborhoods are a defining feature of Fair Oaks Ranch, with trails and dedicated areas for those who love the equestrian lifestyle.' },
  { icon: Calendar, title: 'Community Events', desc: 'The City of Fair Oaks Ranch hosts a robust calendar of community events throughout the year — from holiday celebrations to charity runs and neighborhood festivals.' },
  { icon: Trees, title: 'Nature Trails', desc: 'Miles of trails wind through the community\'s greenbelt areas, connecting neighborhoods and providing residents with access to the natural Hill Country landscape year-round.' },
  { icon: MapPin, title: 'Gated Communities', desc: 'Several premium gated enclaves within Fair Oaks Ranch offer additional privacy and security for buyers seeking a more exclusive lifestyle within the larger master-plan.' },
];

const PRICE_RANGES = [
  { tier: 'Community Entry', range: '$400K – $600K', desc: 'Established neighborhood homes on comfortable lots — ideal for families and those new to the Hill Country market.' },
  { tier: 'Move-Up Homes', range: '$600K – $1M', desc: 'Larger custom and semi-custom homes with generous yards, Hill Country views, and updated finishes throughout.' },
  { tier: 'Luxury & Gated Estates', range: '$1M – $2M+', desc: 'Custom-built homes in gated sections, on larger parcels, often featuring pools, guest quarters, and panoramic Hill Country views.' },
];

const SCHOOLS = [
  { name: 'Fair Oaks Ranch Elementary', grades: 'PK–5', rating: 'Highly Rated' },
  { name: 'Boerne Middle School South', grades: '6–8', rating: 'Highly Rated' },
  { name: 'Boerne Champion High School', grades: '9–12', rating: 'Highly Rated' },
];

const FAQS = [
  {
    q: 'What is the history of Fair Oaks Ranch?',
    a: 'Fair Oaks Ranch was established in 1978 as one of the first master-planned communities in the Texas Hill Country northwest of San Antonio. It was incorporated as a city in 1986. The community was originally developed around the Fair Oaks Ranch Golf & Country Club and has grown into a thriving residential community of roughly 10,000 residents — while retaining its Hill Country character and open-space feel.',
  },
  {
    q: 'What school district serves Fair Oaks Ranch?',
    a: 'Fair Oaks Ranch is served by Boerne ISD, consistently one of the highest-rated school districts in the greater San Antonio region. Students attend Fair Oaks Ranch Elementary, one of the Boerne middle schools, and ultimately Boerne Champion High School. The district is known for strong academics, competitive athletics, and a well-rounded extracurricular program.',
  },
  {
    q: 'Are there gated communities within Fair Oaks Ranch?',
    a: 'Yes. Several gated enclaves exist within the broader Fair Oaks Ranch master plan, offering additional privacy, security, and often more exclusive home designs and larger lot sizes. These communities typically price from $800,000 and above. Our agents can walk you through the specific gated options and help you identify which best fits your lifestyle.',
  },
  {
    q: 'How far is Fair Oaks Ranch from San Antonio?',
    a: 'Fair Oaks Ranch sits approximately 20 miles northwest of downtown San Antonio via TX-16 and I-10. The commute typically takes 25–35 minutes depending on traffic. The community is also well-positioned relative to key employment areas — the South Texas Medical Center is about 30 minutes, and Loop 1604 access makes most of the metro reachable within 40 minutes.',
  },
];

const NEARBY = [
  { name: 'Homes for Sale in Fair Oaks Ranch', href: '/homes-for-sale/fair-oaks-ranch-tx', desc: 'Browse active MLS listings in Fair Oaks Ranch' },
  { name: 'Cordillera Ranch', href: '/neighborhoods/cordillera-ranch', desc: 'Boerne\'s premier 8,700-acre private estate community' },
  { name: 'The Dominion', href: '/neighborhoods/the-dominion', desc: 'San Antonio\'s premier guard-gated luxury community' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'Neighborhoods', item: `${BASE_URL}/neighborhoods` },
        { '@type': 'ListItem', position: 3, name: 'Fair Oaks Ranch', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+12103909997',
      description: 'Fair Oaks Ranch and Hill Country real estate specialists — locally based, community-expert agents.',
      areaServed: { '@type': 'City', name: 'Fair Oaks Ranch', addressRegion: 'TX', addressCountry: 'US' },
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

export default function FairOaksRanchCommunityPage() {
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
              <span className="text-primary font-medium">Fair Oaks Ranch</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                Bexar &amp; Kendall Counties, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                Fair Oaks Ranch, TX —<br />
                Master-Planned Hill Country Living
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Discover one of the Texas Hill Country&apos;s most beloved communities. Fair Oaks Ranch offers
                top-rated Boerne ISD schools, an equestrian lifestyle, championship golf, and homes from
                <strong className="text-white"> $400K to $2M+</strong> — just 20 miles from San Antonio.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/homes-for-sale/fair-oaks-ranch-tx">Browse Listings</Link>
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
                <p className="overline mb-3 text-[#C9A84C]">Community History &amp; Character</p>
                <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                  About Fair Oaks Ranch
                </h2>
                <div className="space-y-5 text-body text-foreground-muted leading-relaxed">
                  <p>
                    Fair Oaks Ranch was established in 1978 as one of the first master-planned communities
                    in the Texas Hill Country — a visionary project built around the natural beauty of the
                    region&apos;s rolling limestone hills, ancient live oak trees, and spring-fed creeks. Incorporated
                    as a city in 1986, Fair Oaks Ranch has grown thoughtfully over nearly five decades while
                    preserving the open-space ethos and Hill Country character that first drew buyers here.
                  </p>
                  <p>
                    Today, the community of roughly 10,000 residents strikes an uncommon balance. It feels
                    genuinely like a small Texas town — with winding roads, equestrian properties, and
                    neighborhood events that bring residents together — while offering the schools, infrastructure,
                    and proximity to San Antonio that growing families need. The master plan designates significant
                    green space, preserving the landscape rather than filling every parcel with development.
                  </p>
                  <p>
                    The real estate market reflects this quality of life. Entry-level buyers find well-maintained
                    homes in established neighborhoods with mature trees and community amenities. Move-up buyers
                    discover custom and semi-custom homes on larger lots with Hill Country views. And those
                    seeking a more exclusive experience can explore the several gated communities within the
                    master plan, where larger estates and enhanced privacy await.
                  </p>
                </div>

                {/* Amenities */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Community Amenities &amp; Lifestyle
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

                {/* Schools */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Boerne ISD Schools
                  </h2>
                  <p className="mb-5 text-body text-foreground-muted">
                    Fair Oaks Ranch is served by Boerne Independent School District — one of the most highly
                    regarded school districts in the San Antonio metro. The district is known for academic
                    achievement, competitive athletics, and a strong fine arts program.
                  </p>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="bg-primary text-white">
                          <th className="px-5 py-3 text-left font-semibold">School</th>
                          <th className="px-5 py-3 text-left font-semibold">Grades</th>
                          <th className="px-5 py-3 text-left font-semibold">Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SCHOOLS.map((school, i) => (
                          <tr key={school.name} className={i % 2 === 0 ? 'bg-white' : 'bg-background-cream'}>
                            <td className="px-5 py-3 font-medium text-primary">{school.name}</td>
                            <td className="px-5 py-3 text-foreground-muted">{school.grades}</td>
                            <td className="px-5 py-3">
                              <span className="inline-flex items-center gap-1 text-[#C9A84C] font-semibold">
                                <Star className="h-3.5 w-3.5" />{school.rating}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Price Ranges */}
                <div className="mt-10">
                  <h2 className="mb-5 font-heading text-heading-xl font-bold text-primary">
                    Home Price Ranges
                  </h2>
                  <div className="space-y-4">
                    {PRICE_RANGES.map(({ tier, range, desc }) => (
                      <div key={tier} className="rounded-xl border border-border bg-white p-6 shadow-sm">
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <h3 className="font-heading text-body font-bold text-primary">{tier}</h3>
                          <span className="shrink-0 font-heading text-body font-bold text-[#C9A84C]">{range}</span>
                        </div>
                        <p className="text-body-sm text-foreground-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5">
                    <Button asChild>
                      <Link href="/homes-for-sale/fair-oaks-ranch-tx">
                        View All Fair Oaks Ranch Listings <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>

                {/* Nearby Links */}
                <div className="mt-10">
                  <h3 className="mb-4 font-heading text-heading font-semibold text-primary">Explore More</h3>
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
                      Ready to move to Fair Oaks Ranch?
                    </h3>
                    <p className="mb-5 text-body-sm text-foreground-muted">
                      We are Fair Oaks Ranch. Our agents live here, know every street, and can connect you
                      with the right home — no pressure, just expert local guidance.
                    </p>
                    <Button size="lg" fullWidth asChild>
                      <Link href="/contact?area=FairOaksRanch">Talk to a Local Expert</Link>
                    </Button>
                    <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                      <Link href="/homes-for-sale/fair-oaks-ranch-tx">Browse Listings</Link>
                    </Button>
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="text-caption text-foreground-muted text-center mb-3">Or call us directly</p>
                      <a
                        href="tel:+12103909997"
                        className="flex items-center justify-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors"
                      >
                        <Phone className="h-4 w-4" /> 210-390-9997
                      </a>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-background-cream p-6">
                    <p className="text-caption font-semibold uppercase tracking-wider text-[#C9A84C] mb-3">Quick Links</p>
                    <Link href="/homes-for-sale/fair-oaks-ranch-tx" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors mb-2">
                      <ArrowRight className="h-3.5 w-3.5" /> Fair Oaks Ranch Listings
                    </Link>
                    <Link href="/luxury-homes" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors mb-2">
                      <ArrowRight className="h-3.5 w-3.5" /> Luxury Homes
                    </Link>
                    <Link href="/neighborhoods" className="flex items-center gap-2 text-body-sm font-semibold text-primary hover:text-[#C9A84C] transition-colors">
                      <ArrowRight className="h-3.5 w-3.5" /> All Neighborhoods
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
                Fair Oaks Ranch FAQ
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
              <p className="overline mb-3 text-[#C9A84C]">Your Hill Country Home Awaits</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Find Your Home in Fair Oaks Ranch
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                From entry-level family homes to luxury gated estates, Fair Oaks Ranch has a home for every
                lifestyle. Our local agents are ready to help you find the right fit.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/homes-for-sale/fair-oaks-ranch-tx">Browse Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact?area=FairOaksRanch">
                    Talk to a Local Expert <ArrowRight className="ml-2 h-4 w-4" />
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
