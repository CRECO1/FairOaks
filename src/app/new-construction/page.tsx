export const revalidate = 3600;

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CheckCircle, ArrowRight, Phone, MapPin,
  Hammer, Shield, DollarSign, HelpCircle,
  FileText, Home, Wrench, Star, Search,
} from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export const metadata: Metadata = {
  title: 'New Construction Homes in Texas Hill Country | Fair Oaks Realty Group',
  description:
    'Browse new construction homes in Fair Oaks Ranch, Boerne, Helotes, and surrounding Hill Country communities. New builds from top Texas builders.',
  keywords: [
    'new construction homes texas',
    'new builds fair oaks ranch',
    'new homes boerne tx',
    'new construction san antonio',
    'new homes texas hill country',
    'newly built homes helotes',
    'new homes bulverde tx',
    'new construction near san antonio',
    'builder homes hill country',
    'move in ready homes texas',
  ],
  alternates: { canonical: '/new-construction' },
  openGraph: {
    title: 'New Construction Homes in Texas Hill Country | Fair Oaks Realty Group',
    description:
      'New construction homes in Boerne, Helotes, Bulverde, New Braunfels, and Fair Oaks Ranch TX. Builder-new homes, master-planned communities, and custom builds — with no extra cost to buyers.',
    url: `${BASE_URL}/new-construction`,
    type: 'website',
    images: [{ url: `${BASE_URL}/images/og-home.jpg`, alt: 'New Construction Homes — Texas Hill Country' }],
  },
};

const STATS = [
  { label: 'Builder Representation', value: 'No Cost' },
  { label: 'New Communities', value: 'Available Now' },
  { label: 'Custom Build Options', value: 'Unlimited' },
  { label: 'Move-In Ready Homes', value: 'In Stock' },
];

const COMMUNITIES = [
  {
    name: 'Veramendi',
    location: 'New Braunfels, TX',
    priceRange: '$350K – $700K',
    school: 'Comal ISD',
    acres: '2,400 acres',
    highlights: ['Multiple builders on-site', 'Resort-style amenity center', 'Guadalupe River proximity', 'Top-rated Comal ISD'],
    description:
      'Veramendi is one of New Braunfels\'s most ambitious master-planned communities, spread across 2,400 acres with a vision for over 5,000 homes. With multiple national and regional builders active on-site, buyers can choose from dozens of floor plans and price points. The community features resort-style amenities, hike-and-bike trails, and is zoned to the consistently excellent Comal ISD.',
  },
  {
    name: 'Johnson Ranch',
    location: 'Bulverde, TX',
    priceRange: '$400K – $650K',
    school: 'Comal ISD',
    acres: 'Master-planned',
    highlights: ['Resort pool & splash pad', 'Sports courts & playgrounds', 'Easy access to 281 N', 'Comal ISD schools'],
    description:
      'Johnson Ranch in Bulverde delivers resort-style living at an approachable price point. The community\'s amenity package — featuring pools, sports courts, and green space — rivals communities at twice the cost. With quick access to US-281 North and zoning to Comal ISD, it has become one of the most sought-after new construction addresses on San Antonio\'s rapidly growing north side.',
  },
  {
    name: 'Kinder Ranch',
    location: 'San Antonio North, TX',
    priceRange: '$380K – $600K',
    school: 'Northside ISD',
    acres: 'Established community',
    highlights: ['Established Hill Country feel', 'Established tree canopy', 'Northside ISD', 'Near Loop 1604'],
    description:
      'Kinder Ranch on San Antonio\'s far northwest side offers new construction with the feel of an established neighborhood. Mature oak trees, Hill Country topography, and an active HOA give it a character that newer communities often lack. With Northside ISD schools and a location near Loop 1604, residents enjoy city conveniences without sacrificing the Hill Country atmosphere they moved for.',
  },
  {
    name: 'Headwaters at Barton Creek',
    location: 'Austin Area (Bee Cave), TX',
    priceRange: '$500K – $900K',
    school: 'Lake Travis ISD',
    acres: 'Premium Hill Country',
    highlights: ['Lake Travis ISD', 'Hill Country preserve land', 'Premium finish levels', 'Proximity to Austin & Lakeway'],
    description:
      'For buyers drawn to the Austin corridor, Headwaters at Barton Creek offers premium Hill Country new construction within the Lake Travis ISD. Homes here are crafted to a higher standard, with elevated architecture, larger lots, and preserved natural land woven throughout the community. It is a premier address for buyers who want Austin access with genuine Hill Country character.',
  },
  {
    name: 'Miralomas',
    location: 'Helotes, TX',
    priceRange: '$550K – $850K',
    school: 'Northside ISD',
    acres: 'Hillside community',
    highlights: ['Elevated hillside homesites', 'Panoramic SA city views', 'Luxury finishes standard', 'Minutes to Loop 1604'],
    description:
      'Miralomas brings luxury new construction to Helotes\'s dramatic limestone hillsides. Homesites are elevated to capture sweeping views of the San Antonio skyline and surrounding Hill Country, and builders here spec homes with finishes — stone exteriors, vaulted ceilings, and upgraded kitchen packages — that other communities offer only as expensive options. Northside ISD adds to the appeal for families.',
  },
  {
    name: 'Vintage Oaks',
    location: 'New Braunfels, TX',
    priceRange: '$500K – $1M',
    school: 'Comal ISD',
    acres: '3,900 acres',
    highlights: ['Estate lots 1–14 acres', 'Resort-style clubhouse', 'Custom and semi-custom builds', 'Canyon Lake proximity'],
    description:
      'Vintage Oaks spans nearly 3,900 acres of pristine Hill Country terrain between New Braunfels and Wimberley. The community specializes in larger homesites where buyers can choose from curated builders or bring their own custom builder. With a full resort amenity center, multiple pool areas, and a sports complex, it offers an estate lifestyle without the full price tag of communities closer to San Antonio.',
  },
  {
    name: 'Cross Mountain Ranch',
    location: 'Helotes / NW San Antonio, TX',
    priceRange: '$450K – $750K',
    school: 'Northside ISD',
    acres: 'Gated',
    highlights: ['Gated community entry', 'Hill Country views', 'Larger lots than most communities', 'Northside ISD'],
    description:
      'Cross Mountain Ranch in the Helotes/Northwest San Antonio corridor delivers gated Hill Country living with more generous lot sizes than you will find in most master-planned communities at this price. The elevated terrain offers dramatic views, and the gated entry gives residents a sense of privacy and security that open communities cannot match.',
  },
  {
    name: 'Alamo Ranch',
    location: 'Bexar County (Far West), TX',
    priceRange: '$320K – $520K',
    school: 'Northside ISD',
    acres: 'Large master-planned',
    highlights: ['One of SA\'s largest communities', 'Wide range of builders & plans', 'Strong retail & dining access', 'Active HOA & amenities'],
    description:
      'Alamo Ranch is one of the largest master-planned communities in the San Antonio area, offering an enormous range of builder choices, floor plans, and price points. For buyers who want a brand-new home at an accessible entry price with strong Northside ISD schools, established retail and dining nearby, and a large pool of comparable sales for future resale, Alamo Ranch checks every box.',
  },
];

const PROCESS_STEPS = [
  {
    step: '01',
    icon: Search,
    title: 'Choose Your Community',
    description:
      'We tour active new construction communities together, evaluating location, school district, builder quality, HOA fees, lot premiums, and price-per-square-foot. We will help you compare communities objectively so you make the right decision.',
  },
  {
    step: '02',
    icon: Home,
    title: 'Select Your Floor Plan',
    description:
      'Once you choose a community and builder, we guide you through floor plan selection — evaluating flow, resale potential, structural upgrades worth doing, and options to avoid. Not all upgrades add value at resale.',
  },
  {
    step: '03',
    icon: Star,
    title: 'Design Center Appointments',
    description:
      'The design center is where budgets often balloon. We help you prioritize the upgrades that are difficult or expensive to add later (structural, electrical, plumbing) vs. those you can do affordably after closing (flooring, fixtures, paint).',
  },
  {
    step: '04',
    icon: Hammer,
    title: 'Construction Phase',
    description:
      'Your builder\'s superintendent manages day-to-day construction. We stay in touch throughout, help you track milestones, and coordinate a third-party inspection at key phases — something the builder\'s agent will never suggest.',
  },
  {
    step: '05',
    icon: Wrench,
    title: 'Pre-Close Inspections',
    description:
      'We strongly recommend a professional third-party inspection before your final walk-through. Even new construction has deficiencies. We compile a punch list and work with the builder to address issues before you close.',
  },
  {
    step: '06',
    icon: FileText,
    title: 'Close & Move In',
    description:
      'We review the closing disclosure, confirm builder incentives are reflected correctly, and sit with you at the closing table. After closing, your warranty coverage begins — and we stay available for any warranty navigation questions.',
  },
];

const BUILDERS = [
  'David Weekley Homes',
  'Perry Homes',
  'Pulte Homes',
  'Ashton Woods',
  'Drees Custom Homes',
  'Scott Felder Homes',
  'Toll Brothers',
];

const FAQS = [
  {
    question: 'Do I need my own agent for new construction?',
    answer:
      'Yes — and it costs you nothing. The builder\'s sales agent is employed by the builder and represents the builder\'s interests, not yours. They are trained to maximize the builder\'s price and protect the builder\'s contract. Having your own agent means you have a fiduciary in your corner reviewing contract terms, negotiating incentives, and flagging issues the builder\'s rep won\'t raise. In most cases, the builder pays your agent\'s commission, so there is no reason not to have representation.',
  },
  {
    question: 'How long does new construction take?',
    answer:
      'Build timelines typically range from 6 to 18 months, depending on the builder, the floor plan complexity, the availability of labor and materials, and the current level of demand. Production builders (those building from a set catalog of plans) tend to complete homes in 6–10 months. Semi-custom and custom builds take longer — often 12–18 months — as more decisions require direct owner involvement. We will help you understand the realistic timeline before you sign.',
  },
  {
    question: 'Can I negotiate with a builder?',
    answer:
      'Yes, though the approach differs from resale negotiations. Builders rarely reduce their base price (it would undermine comps in the community), but they routinely negotiate on incentives: closing cost contributions, design center upgrade allowances, lot premium reductions, and financing rate buydowns through their preferred lender. We know which builders are most motivated, what incentives are actually available, and how to structure your offer to maximize the value you receive.',
  },
  {
    question: 'What is a construction-to-permanent loan?',
    answer:
      'A construction-to-permanent loan (also called a "one-time close" or C2P loan) finances both the construction phase and the final mortgage in a single loan product. During construction, you typically pay interest only on funds drawn. Once construction is complete, the loan automatically converts to a standard mortgage — avoiding a second round of closing costs. This is different from buying a spec home (already built), where you simply apply for a standard purchase mortgage. We can connect you with lenders experienced in both products.',
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
      description:
        'New construction home specialists serving Boerne, Helotes, Bulverde, New Braunfels, and the Texas Hill Country. Buyer representation at no cost.',
      areaServed: [
        { '@type': 'Place', name: 'Boerne, TX' },
        { '@type': 'Place', name: 'Helotes, TX' },
        { '@type': 'Place', name: 'Bulverde, TX' },
        { '@type': 'Place', name: 'New Braunfels, TX' },
        { '@type': 'Place', name: 'Fair Oaks Ranch, TX' },
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQS.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: 'New Construction', item: `${BASE_URL}/new-construction` },
      ],
    },
  ],
};

export default function NewConstructionPage() {
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
              <p className="overline mb-3 text-gold">Build Your Dream Home</p>
              <h1 className="mb-5 font-heading text-display font-bold text-white">
                New Construction Homes in the<br />
                <span className="text-gradient-gold">Texas Hill Country</span>
              </h1>
              <p className="mb-8 max-w-2xl text-body-lg text-white/70">
                Explore brand-new homes across Boerne, Helotes, Bulverde, New Braunfels, and Fair Oaks Ranch.
                We represent new construction buyers at no extra cost — and we know how to get you better terms
                than you would get walking in alone.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/listings">Browse New Construction</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Talk to a Builder Specialist</Link>
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

        {/* Browse by City */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-10 text-center">
              <p className="overline mb-3 text-gold">Explore by Location</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Browse New Construction by City
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                We serve buyers across the Texas Hill Country. Select your city to see active developments,
                top builders, and community details for that market.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[
                { name: 'Fair Oaks Ranch', href: '/new-construction/fair-oaks-ranch', isd: 'Boerne ISD', price: '$450K – $900K', desc: 'Gated communities, custom lots & Hill Country lifestyle 20 min from San Antonio.' },
                { name: 'Boerne', href: '/new-construction/boerne', isd: 'Boerne ISD', price: '$380K – $850K', desc: 'Headwaters, Esperanza & other master-planned communities near historic downtown.' },
                { name: 'Helotes', href: '/new-construction/helotes', isd: 'Northside ISD', price: '$450K – $950K', desc: 'Miralomas & other hillside communities with panoramic San Antonio views.' },
                { name: 'San Antonio', href: '/new-construction/san-antonio', isd: 'Multiple ISDs', price: '$280K – $700K+', desc: 'New builds across all price ranges. Military-friendly, VA loan accepted.' },
                { name: 'Bulverde', href: '/new-construction/bulverde', isd: 'Comal ISD', price: '$370K – $700K', desc: 'Fast-growing Hill Country community with Johnson Ranch, Copper Canyon & more.' },
                { name: 'New Braunfels', href: '/new-construction/new-braunfels', isd: 'Comal ISD', price: '$350K – $750K', desc: 'Veramendi, Vintage Oaks & Solms Landing — Hill Country charm with city access.' },
                { name: 'Canyon Lake', href: '/new-construction/canyon-lake', isd: 'Comal ISD', price: '$380K – $900K', desc: 'Custom and semi-custom builds near the lake. Hill Country views & vacation potential.' },
              ].map(({ name, href, isd, price, desc }) => (
                <Link
                  key={name}
                  href={href}
                  className="group flex flex-col rounded-2xl border border-border bg-background-cream p-6 shadow-sm hover:border-gold hover:shadow-md transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-heading text-body font-bold text-primary group-hover:text-gold transition-colors">
                      {name}
                    </h3>
                    <ArrowRight className="h-4 w-4 text-gold shrink-0" />
                  </div>
                  <p className="text-caption text-foreground-muted mb-1">{isd}</p>
                  <p className="text-body-sm font-semibold text-gold mb-3">{price}</p>
                  <p className="text-body-sm text-foreground-muted leading-relaxed flex-1">{desc}</p>
                </Link>
              ))}
            </div>
          </Container>
        </section>

        {/* Why Use a Realtor for New Construction */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-14 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="overline mb-3 text-gold">Your Best Move</p>
                <h2 className="mb-6 font-heading text-display-sm font-bold text-primary">
                  Why Use a Realtor for New Construction?
                </h2>
                <p className="mb-6 text-body text-foreground-muted leading-relaxed">
                  Most buyers assume they do not need their own agent when buying from a builder — and builders
                  love that assumption. The salesperson at the model home works for the builder. Their job is to
                  sell you the home at the best price and terms for the builder, not for you.
                </p>
                <ul className="space-y-5">
                  {[
                    {
                      icon: DollarSign,
                      title: 'We negotiate builder incentives on your behalf',
                      desc: 'Closing cost contributions, upgrade allowances, rate buydowns, and lot premium reductions are all negotiable. We know what builders are offering and how to ask.',
                    },
                    {
                      icon: Shield,
                      title: 'The builder\'s agent represents the builder — not you',
                      desc: 'Builder contracts are written by builders\' attorneys to protect the builder. Without your own representation, you sign those terms as-is. We review every contract for buyer-unfriendly clauses.',
                    },
                    {
                      icon: Star,
                      title: 'We know which builders have the best quality',
                      desc: 'Not all builders are equal. We have toured finished homes, spoken with owners, and tracked warranty claims. We will tell you honestly which builders to trust and which to approach carefully.',
                    },
                    {
                      icon: Hammer,
                      title: 'We coordinate third-party inspections',
                      desc: 'New construction is not perfect. We strongly recommend phase inspections — pre-drywall and pre-closing — by an independent inspector. This step catches deficiencies before they become your problem.',
                    },
                  ].map(({ icon: Icon, title, desc }) => (
                    <li key={title} className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold/10">
                        <Icon className="h-5 w-5 text-gold" />
                      </div>
                      <div>
                        <h3 className="mb-1 font-heading text-body font-semibold text-primary">{title}</h3>
                        <p className="text-body-sm text-foreground-muted">{desc}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl bg-primary p-8 sm:p-10 text-white">
                <Hammer className="mb-5 h-10 w-10 text-gold" />
                <h3 className="mb-4 font-heading text-heading-xl font-bold text-white">
                  Builder Representation at No Extra Cost
                </h3>
                <p className="mb-5 text-body text-white/70 leading-relaxed">
                  In virtually every new construction purchase, the builder pays your agent&apos;s commission as
                  part of their sales and marketing budget. You do not pay more to have representation — you
                  simply get an advocate who works exclusively for you throughout the process.
                </p>
                <ul className="mb-7 space-y-3 text-body-sm text-white/70">
                  {[
                    'No additional cost to you — builder pays the commission',
                    'Fiduciary representation from contract through closing',
                    'Negotiation on incentives, lot premiums & upgrades',
                    'Third-party inspection coordination',
                    'Contract review by agents, not builder employees',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 text-body-sm font-bold text-primary hover:opacity-90 transition-opacity"
                >
                  Get Builder Representation <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </Container>
        </section>

        {/* Top New Construction Communities */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">Where to Build</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Top New Construction Communities
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                The Texas Hill Country is home to some of the most dynamic new construction markets in Texas.
                Here are the communities we know best and recommend most often.
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

        {/* Process Steps */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3 text-gold">Step by Step</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                What to Expect: The New Construction Process
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Buying new construction is a process unlike any resale purchase. Here is what the journey looks
                like from community selection to move-in day.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {PROCESS_STEPS.map(({ step, icon: Icon, title, description }) => (
                <div
                  key={step}
                  className="rounded-2xl bg-white border border-border shadow-sm p-7 flex flex-col"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <span className="font-heading text-display-sm font-bold text-gold/30 leading-none">{step}</span>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold/10">
                      <Icon className="h-5 w-5 text-gold" />
                    </div>
                  </div>
                  <h3 className="mb-3 font-heading text-body font-bold text-primary">{title}</h3>
                  <p className="text-body-sm text-foreground-muted leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Builder vs Resale Comparison */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">Make the Right Choice</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Builder vs. Resale: Which Is Right for You?
              </h2>
              <p className="mt-6 mx-auto max-w-2xl text-body text-foreground-muted">
                Both new construction and resale have real advantages. The right choice depends on your timeline,
                priorities, and the current market. Here is a straightforward comparison.
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="px-6 py-4 font-heading font-semibold w-1/3">Factor</th>
                    <th className="px-6 py-4 font-heading font-semibold w-1/3">New Construction</th>
                    <th className="px-6 py-4 font-heading font-semibold w-1/3">Resale Home</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Warranty', '1–10 year builder warranties included', 'No warranty; as-is unless negotiated'],
                    ['Customization', 'Choose finishes, layout options, upgrades', 'What you see is what you get'],
                    ['Timeline', '6–18 months to complete', 'Close in 30–60 days typically'],
                    ['Price', 'Often at or above market; less room to negotiate base price', 'More negotiating room, especially in slower markets'],
                    ['Condition', 'Brand new — no deferred maintenance', 'May need updates, repairs, or renovations'],
                    ['Negotiability', 'Incentives, upgrades, lot premiums, rate buydowns', 'Purchase price, repairs, closing costs, personal property'],
                  ].map(([factor, newConst, resale], i) => (
                    <tr key={factor} className={i % 2 === 0 ? 'bg-white' : 'bg-background-cream'}>
                      <td className="px-6 py-4 font-semibold text-primary">{factor}</td>
                      <td className="px-6 py-4 text-foreground-muted">{newConst}</td>
                      <td className="px-6 py-4 text-foreground-muted">{resale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Container>
        </section>

        {/* Popular Builders */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="text-center mb-10">
              <p className="overline mb-3 text-gold">Who We Work With</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                Popular Builders in the Hill Country
              </h2>
              <p className="mt-6 mx-auto max-w-xl text-body text-foreground-muted">
                We have experience working with all of the major builders active in the Texas Hill Country market.
                Each has different strengths — we will tell you honestly which one fits your needs.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              {BUILDERS.map((builder) => (
                <span
                  key={builder}
                  className="inline-flex items-center rounded-full border border-border bg-white px-5 py-2.5 font-heading text-body-sm font-semibold text-primary shadow-sm"
                >
                  {builder}
                </span>
              ))}
            </div>
          </Container>
        </section>

        {/* FAQ */}
        <section className="section-luxury bg-white">
          <Container>
            <div className="mb-12 text-center">
              <p className="overline mb-3">Common Questions</p>
              <h2 className="font-heading text-display-sm font-bold text-primary gold-line gold-line-center inline-block pb-4">
                New Construction FAQ
              </h2>
            </div>

            <div className="mx-auto max-w-3xl space-y-4">
              {FAQS.map((faq) => (
                <details
                  key={faq.question}
                  className="group rounded-xl border border-border bg-background-cream overflow-hidden"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-4 px-6 py-5 font-heading text-body font-semibold text-primary list-none hover:bg-gold/5 transition-colors">
                    <span className="flex items-center gap-3">
                      <HelpCircle className="h-5 w-5 shrink-0 text-gold" />
                      {faq.question}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-gold transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="px-6 pb-6 pt-2">
                    <p className="text-body text-foreground-muted leading-relaxed pl-8">{faq.answer}</p>
                  </div>
                </details>
              ))}
            </div>
          </Container>
        </section>

        {/* Final CTA */}
        <section className="section-compact bg-background-cream">
          <Container>
            <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
              <p className="overline mb-3 text-gold">Find Your New Construction Home</p>
              <h2 className="mb-4 font-heading text-display-sm font-bold text-white">
                Ready to Build or Buy New?
              </h2>
              <p className="mb-8 mx-auto max-w-xl text-body-lg text-white/70">
                Whether you are exploring communities, have a builder in mind, or are ready to sign a contract —
                we are here to guide you every step of the way, at no cost to you.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" asChild>
                  <Link href="/listings">
                    Search All Listings <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/contact">Talk to a Builder Specialist</Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                  <a href="tel:+12103909997">
                    <Phone className="mr-2 h-4 w-4" />(210) 390-9997
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
