export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MapPin, CheckCircle, ArrowRight, Phone,
  Home, School, Shield, Star, Waves,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';
const CANONICAL = `${BASE_URL}/new-construction/canyon-lake`;

export const metadata: Metadata = {
  title: 'New Construction Homes in Canyon Lake, TX | Fair Oaks Realty Group',
  description:
    'New construction homes near Canyon Lake TX — custom builds and spec homes with Hill Country views, acreage, and lake proximity.',
  keywords: [
    'new construction canyon lake tx',
    'new homes canyon lake texas',
    'canyon lake tx new builds',
    'new construction near canyon lake',
    'custom homes canyon lake tx',
    'new homes comal isd canyon lake',
    'move-in ready canyon lake',
    'new development canyon lake',
    'builder homes canyon lake tx',
    'newly built homes canyon lake',
  ],
  alternates: { canonical: '/new-construction/canyon-lake' },
  openGraph: {
    title: 'New Construction Homes in Canyon Lake, TX | Fair Oaks Realty Group',
    description:
      'New construction homes near Canyon Lake TX — custom builds and spec homes with Hill Country views, acreage, and lake proximity.',
    url: CANONICAL,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'New Construction Homes Near Canyon Lake, TX' }],
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'New Construction', item: `${BASE_URL}/new-construction` },
        { '@type': 'ListItem', position: 3, name: 'Canyon Lake', item: CANONICAL },
      ],
    },
    {
      '@type': 'RealEstateAgent',
      '@id': `${BASE_URL}/#business`,
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
      telephone: '+1-2103909997',
      areaServed: { '@type': 'Place', name: 'Canyon Lake', addressRegion: 'TX', addressCountry: 'US' },
    },
  ],
};

const DEVELOPMENTS = [
  {
    name: 'Canyon Lake Custom Lots',
    priceRange: '$420K – $900K+',
    highlights: ['Bring your own builder options', 'Elevated lake-view homesites', 'Large acreage lots available', 'Comal ISD'],
    description:
      'The Canyon Lake area is primarily a custom and semi-custom build market. Buyers can acquire raw or improved lots with lake views and work with a local or regional custom builder to create a personalized home. This is a fundamentally different experience from a production builder community — more decisions, more time, but a result that reflects exactly what you want.',
  },
  {
    name: 'Sitterle Homes Communities',
    priceRange: '$450K – $750K',
    highlights: ['Texas Hill Country specialist', 'Semi-custom approach', 'Premium standard finishes', 'Strong resale history'],
    description:
      'Sitterle Homes brings a semi-custom approach to the Canyon Lake area, offering buyers the ability to personalize their home within a builder-guided framework. Known for elevated standard finishes and a genuine understanding of Hill Country architecture, Sitterle is among the most respected builders operating in the canyon lake region.',
  },
  {
    name: 'Stadler Custom Homes Projects',
    priceRange: '$550K – $1.2M+',
    highlights: ['True custom construction', 'Architectural flexibility', 'Premium craftsmanship', 'Lake view specialization'],
    description:
      'Stadler Custom Homes specializes in high-end custom construction in the Canyon Lake and greater Hill Country area. For buyers who want a home designed from the ground up — specific to their site, their lifestyle, and their aesthetic preferences — Stadler brings decades of Hill Country custom building expertise.',
  },
];

const BUILDERS = [
  { name: 'Local Custom Builders', note: 'Deep Hill Country site knowledge and custom expertise' },
  { name: 'Sitterle Homes', note: 'Hill Country specialist with semi-custom approach' },
  { name: 'Stadler Custom Homes', note: 'Premium custom builds, lake view specialization' },
];

const BENEFITS = [
  {
    icon: Waves,
    title: 'Lake Access & Water Recreation',
    desc: 'Canyon Lake is one of the premier recreational lakes in the Texas Hill Country, offering boating, fishing, scuba diving, and swimming. New construction near Canyon Lake comes with access to a lifestyle centered on the water — something available nowhere else in the San Antonio metro.',
  },
  {
    icon: Home,
    title: 'Vacation Home & Investment Potential',
    desc: 'Canyon Lake homes carry strong short-term rental demand. Many buyers purchase new construction here as a primary residence with occasional rental income potential, or as a dedicated vacation home investment. The area\'s tourism draw makes it one of the Hill Country\'s most compelling investment markets.',
  },
  {
    icon: School,
    title: 'Comal ISD Schools',
    desc: 'The Canyon Lake area falls within Comal Independent School District, one of the highest-rated school districts in central Texas. Families who choose Canyon Lake for primary residence benefit from strong schools without the density and traffic of communities closer to San Antonio.',
  },
  {
    icon: Star,
    title: 'Genuine Hill Country Character',
    desc: 'The Canyon Lake area has not experienced the same degree of master-planned development as New Braunfels or Bulverde. The result is a more authentic Hill Country character — larger lots, native terrain, fewer cookie-cutter streetscapes, and a sense of space that newer master-planned communities cannot replicate.',
  },
];

export default function CanyonLakeNewConstructionPage() {
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
              <Link href="/new-construction" className="hover:text-primary transition-colors">New Construction</Link>
              <span>/</span>
              <span className="text-primary font-medium">Canyon Lake</span>
            </nav>
          </Container>
        </div>

        {/* Hero */}
        <section className="bg-primary py-14 sm:py-20 text-white">
          <Container>
            <div className="max-w-3xl">
              <p className="overline mb-3 text-[#C9A84C]">
                <MapPin className="mr-1 inline h-3 w-3" />
                Comal County, Texas
              </p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                New Construction Homes Near Canyon Lake, TX
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Find new builds with Hill Country views, lake access, and genuine custom home opportunities
                near one of Texas&apos;s premier recreational lakes. Comal ISD schools, vacation home potential,
                and a community that retains authentic Hill Country character.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Canyon+Lake">Browse Canyon Lake Listings</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Talk to a Builder Specialist</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Stats Bar */}
        <div className="bg-[#C9A84C] py-6">
          <Container>
            <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
              {[
                { label: 'Price Range', value: '$380K – $1.2M+' },
                { label: 'School District', value: 'Comal ISD' },
                { label: 'To New Braunfels', value: '20 min' },
                { label: 'Build Style', value: 'Custom / Semi-Custom' },
              ].map(({ label, value }) => (
                <div key={label} className="text-center sm:text-left">
                  <div className="font-heading text-heading font-bold text-primary">{value}</div>
                  <div className="text-caption text-primary/60">{label}</div>
                </div>
              ))}
            </div>
          </Container>
        </div>

        {/* What Makes This Market Different */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-start">
              <div>
                <p className="overline mb-3 text-[#C9A84C]">Custom & Semi-Custom Market</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Canyon Lake Is a Different Kind of New Construction Market
                </h2>
                <p className="mb-4 text-body text-foreground-muted leading-relaxed">
                  Unlike the master-planned production builder communities of New Braunfels or Bulverde,
                  Canyon Lake&apos;s new construction market is dominated by custom and semi-custom construction.
                  Buyers here typically start by finding a lot — often elevated with lake or Hill Country views
                  — and then work with a builder to design and construct a home specific to that site.
                </p>
                <p className="mb-6 text-body text-foreground-muted leading-relaxed">
                  This process takes longer and involves more decisions than a production build, but the
                  result is a home that is genuinely tailored to the land, the views, and the buyer&apos;s
                  lifestyle. For buyers willing to invest the time, Canyon Lake custom construction delivers
                  something that master-planned communities simply cannot.
                </p>
                <div className="rounded-xl border border-border bg-background-cream p-5">
                  <h3 className="font-heading text-body font-semibold text-primary mb-2">Custom Build Timeline</h3>
                  <p className="text-body-sm text-foreground-muted">
                    Custom construction near Canyon Lake typically takes 12–18 months from lot purchase
                    to move-in. We can help you navigate the lot selection, builder search, permit process,
                    and construction management — all at no extra cost to you.
                  </p>
                </div>
              </div>
              <div>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Why Buy New Construction Near Canyon Lake?
                </h2>
                <div className="space-y-4">
                  {BENEFITS.map(({ icon: Icon, title, desc }) => (
                    <div key={title} className="flex items-start gap-4 rounded-xl border border-border bg-background-cream p-5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#C9A84C]/10">
                        <Icon className="h-5 w-5 text-[#C9A84C]" />
                      </div>
                      <div>
                        <h3 className="mb-1 font-heading text-body-sm font-semibold text-primary">{title}</h3>
                        <p className="text-body-sm text-foreground-muted leading-relaxed">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* Active Developments */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3">Building Opportunities</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                New Construction Options Near Canyon Lake
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Canyon Lake&apos;s new construction landscape spans custom lots, semi-custom builder projects,
                and a growing number of spec homes from regional Hill Country specialists.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {DEVELOPMENTS.map((dev) => (
                <div key={dev.name} className="rounded-2xl bg-white border border-border shadow-sm p-7 flex flex-col">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-heading text-body font-bold text-primary">{dev.name}</h3>
                    <span className="shrink-0 font-heading text-body-sm font-semibold text-[#C9A84C]">{dev.priceRange}</span>
                  </div>
                  <p className="mb-4 text-body-sm text-foreground-muted leading-relaxed flex-1">{dev.description}</p>
                  <ul className="space-y-1.5">
                    {dev.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-body-sm text-foreground-muted">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A84C]" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Top Builders */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-[#C9A84C]">Who&apos;s Building</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Top Builders Near Canyon Lake
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {BUILDERS.map(({ name, note }) => (
                <div key={name} className="rounded-xl border border-border bg-background-cream p-5">
                  <h3 className="font-heading text-body font-semibold text-primary mb-2">{name}</h3>
                  <p className="text-body-sm text-foreground-muted">{note}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Buyer Tips */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-[#C9A84C]">Your Best Advantage</p>
                <h2 className="mb-5 font-heading text-display-sm font-bold text-primary">
                  Navigating the Canyon Lake Custom Build Process
                </h2>
                <p className="mb-5 text-body text-foreground-muted leading-relaxed">
                  Custom construction in a lake area market involves complexities that production builder
                  communities don&apos;t. Lot evaluation, septic vs. sewer determinations, flood zone considerations,
                  and builder vetting are all critical steps. An experienced buyer&apos;s agent who knows this
                  specific market helps you avoid costly mistakes before and during construction.
                </p>
                <ul className="space-y-3">
                  {[
                    'Lot evaluation: flood zone, view corridors, septic suitability, and access',
                    'Builder vetting: licensing, insurance, warranty terms, and local references',
                    'Contract review: custom build contracts carry more risk than production contracts',
                    'Phase inspection coordination at foundation, framing, and pre-close',
                    'Lender connections: construction-to-permanent loans for custom builds',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-body-sm text-foreground-muted">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A84C]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl bg-primary p-8 text-white">
                <Shield className="mb-4 h-8 w-8 text-[#C9A84C]" />
                <h3 className="mb-3 font-heading text-heading-xl font-bold text-white">
                  Your Canyon Lake New Construction Specialists
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  Custom builds require more guidance than any other real estate transaction. We have
                  helped buyers navigate the Canyon Lake market from lot selection through move-in day —
                  and we know the builders, the terrain, and the pitfalls to avoid. All at no cost to you.
                </p>
                <Button asChild>
                  <Link href="/contact">Connect With Our Team</Link>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="section-compact bg-white">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-[#C9A84C]">Start Your Search</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Ready to Build Near Canyon Lake?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Browse available listings or connect with our Canyon Lake new construction specialists.
                Whether you&apos;re looking for a lot, a spec home, or a custom build partner — we can help.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings?city=Canyon+Lake">
                    Browse Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Talk to a Builder Specialist</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997"><Phone className="mr-2 h-4 w-4" />(210) 390-9997</a>
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Footer nav */}
        <div className="py-6 bg-background-cream border-t border-border">
          <Container>
            <div className="flex flex-wrap items-center gap-4 text-body-sm text-foreground-muted">
              <Link href="/new-construction" className="inline-flex items-center gap-1 hover:text-primary transition-colors">
                <ArrowRight className="h-4 w-4 rotate-180" /> All New Construction
              </Link>
              <span>·</span>
              <Link href="/new-construction/new-braunfels" className="hover:text-primary transition-colors">
                New Braunfels New Construction
              </Link>
              <span>·</span>
              <Link href="/contact" className="hover:text-primary transition-colors">Contact Us</Link>
            </div>
          </Container>
        </div>

      </main>
      <Footer />
    </>
  );
}
