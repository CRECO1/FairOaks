export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fair Oaks Ranch Homes for Sale | #1 Local Realtor – Fair Oaks Realty Group',
  description:
    'Search homes for sale in Fair Oaks Ranch TX. Top-rated local realtors with 500+ homes sold, 103% list-to-sale ratio & 21-day average DOM. Free home valuations. Serving Fair Oaks Ranch, Boerne & Helotes.',
  keywords: [
    'Fair Oaks Ranch homes for sale',
    'Fair Oaks Ranch real estate',
    'homes for sale Fair Oaks Ranch Texas',
    'Fair Oaks Ranch TX realtor',
    'best realtor Fair Oaks Ranch TX',
    'Texas Hill Country homes for sale',
    'Fair Oaks Ranch real estate agent',
    'luxury homes Fair Oaks Ranch TX',
    'Boerne TX homes for sale',
    'Helotes TX homes for sale',
    'sell my home Fair Oaks Ranch',
    'Fair Oaks Ranch home value',
    'residential real estate Fair Oaks Ranch',
    'Fair Oaks Ranch property search',
    'buy home Fair Oaks Ranch Texas',
  ],
  openGraph: {
    title: 'Fair Oaks Ranch Homes for Sale | Fair Oaks Realty Group',
    description:
      'Search homes for sale in Fair Oaks Ranch, Boerne & Helotes TX. 500+ homes sold. Free home valuations. Texas Hill Country real estate experts.',
    url: 'https://www.fairoaksrealtygroup.com',
    type: 'website',
  },
  alternates: {
    canonical: 'https://www.fairoaksrealtygroup.com',
  },
};

import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Star, Home, TrendingUp, Award, Sparkles, MapPin, Bed, Bath, Square } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { RevealOnScroll } from '@/hooks/useScrollReveal';
import { getListings, getTestimonials, getNeighborhoods, supabase } from '@/lib/supabase';
import { formatPrice } from '@/lib/utils';

const DEMO_LISTINGS = [
  { id: '1', title: '124 Saddlebrook Drive', slug: '124-saddlebrook-drive', price: 725000, city: 'Fair Oaks Ranch', bedrooms: 4, bathrooms: 3, sqft: 2850, images: null, status: 'active' },
  { id: '2', title: '3318 Hill Country Blvd', slug: '3318-hill-country-blvd', price: 595000, city: 'Fair Oaks Ranch', bedrooms: 3, bathrooms: 2.5, sqft: 2200, images: null, status: 'active' },
  { id: '3', title: '7820 Cibolo Creek Court', slug: '7820-cibolo-creek-court', price: 949000, city: 'Boerne', bedrooms: 5, bathrooms: 4, sqft: 3900, images: null, status: 'active' },
];

const DEMO_TESTIMONIALS = [
  { id: '1', client_name: 'The Martinez Family', client_location: 'Fair Oaks Ranch, TX', quote: 'Fair Oaks Realty Group made buying our dream home effortless. They knew every neighborhood and found us the perfect fit on the first try.', rating: 5 },
  { id: '2', client_name: 'Robert & Linda Chen', client_location: 'Boerne, TX', quote: 'Professional, patient, and deeply knowledgeable about the Texas Hill Country market. We sold above asking price in under two weeks!', rating: 5 },
  { id: '3', client_name: 'Sarah Thompson', client_location: 'Helotes, TX', quote: 'As first-time buyers, we were nervous. Our agent held our hand through every step and we couldn\'t be happier with our new home.', rating: 5 },
];

const DEMO_NEIGHBORHOODS = [
  { id: '1', name: 'Fair Oaks Ranch', slug: 'fair-oaks-ranch', avg_price: 680000, image_url: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&auto=format&fit=crop&q=80', highlights: ['Top-rated schools', 'Gated communities', 'Hill Country views'] },
  { id: '2', name: 'Boerne', slug: 'boerne', avg_price: 575000, image_url: 'https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=1200&auto=format&fit=crop&q=80', highlights: ['Historic charm', 'River access', 'Vibrant downtown'] },
  { id: '3', name: 'The Dominion', slug: 'the-dominion', avg_price: 1200000, image_url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&auto=format&fit=crop&q=80', highlights: ['Ultra-luxury estates', 'Private golf club', 'Gated 24/7'] },
];

const DEFAULT_SETTINGS = {
  hero_headline: 'Your Home in the Texas Hill Country',
  hero_subheadline: 'Trusted local experts helping families find the perfect home in Fair Oaks Ranch, Boerne, and the greater San Antonio area.',
  hero_image_url: null as string | null,
  stat_homes_sold: 500,
  stat_years_experience: 20,
  stat_satisfaction: '98%',
  stat_avg_days: 21,
  about_headline: 'Why Fair Oaks Realty Group?',
  about_text: 'We\'ve been helping families call the Texas Hill Country home for over 20 years. Our deep roots in Fair Oaks Ranch give you an insider advantage.',
  cta_headline: 'Not sure where to start?',
  cta_subheadline: 'Take our 2-minute quiz and we\'ll match you with your perfect neighborhood.',
  phone: '(210) 390-9997',
  email: 'info@fairoaksrealtygroup.com',
  address: '123 Fair Oaks Pkwy, Fair Oaks Ranch, TX 78015',
};

export default async function HomePage() {
  const [listingsResult, testimonialsResult, neighborhoodsResult, settingsResult] = await Promise.allSettled([
    getListings('active'),
    getTestimonials(true),
    getNeighborhoods(),
    supabase.from('site_settings').select('*').eq('id', 1).single(),
  ]);

  const featuredListings = listingsResult.status === 'fulfilled' && listingsResult.value.length > 0
    ? listingsResult.value.slice(0, 3) : DEMO_LISTINGS;

  const featuredTestimonials = testimonialsResult.status === 'fulfilled' && testimonialsResult.value.length > 0
    ? testimonialsResult.value.slice(0, 3) : DEMO_TESTIMONIALS;

  const featuredNeighborhoods = neighborhoodsResult.status === 'fulfilled' && neighborhoodsResult.value.length > 0
    ? neighborhoodsResult.value.slice(0, 3) : DEMO_NEIGHBORHOODS;

  const s = (settingsResult.status === 'fulfilled' && settingsResult.value.data)
    ? settingsResult.value.data
    : DEFAULT_SETTINGS;

  const STATS = [
    { value: `${s.stat_homes_sold}+`, label: 'Homes Sold', icon: Home },
    { value: `${s.stat_years_experience}+`, label: 'Years Experience', icon: Award },
    { value: s.stat_satisfaction, label: 'Client Satisfaction', icon: Star },
    { value: String(s.stat_avg_days), label: 'Avg Days on Market', icon: TrendingUp },
  ];

  return (
    <>
      <Header variant="transparent" />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-primary">
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-primary/80" />
        {s.hero_image_url ? (
          <Image
            src={s.hero_image_url}
            alt="Hero background"
            fill
            className="object-cover opacity-40"
            priority
          />
        ) : (
          <div className="absolute inset-0 opacity-20"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1600&auto=format')", backgroundSize: 'cover', backgroundPosition: 'center' }} />
        )}
        <div className="hero-overlay-luxury absolute inset-0" />

        <Container className="relative z-10 text-center text-white px-5 sm:px-6">
          <p className="overline mb-4 sm:mb-6 animate-fade-in-down text-gold text-xs sm:text-overline">Texas Hill Country Real Estate</p>
          <h1 className="mb-5 sm:mb-6 animate-fade-in-up font-heading text-display-xl font-bold text-white text-shadow-hero fill-both">
            {s.hero_headline.includes('\n')
              ? s.hero_headline.split('\n').map((line: string, i: number) => (
                <span key={i}>{i > 0 && <br />}{line}</span>
              ))
              : <><span className="text-gradient-gold">{s.hero_headline}</span></>
            }
          </h1>
          <p className="mx-auto mb-8 sm:mb-10 max-w-2xl animate-fade-in text-base sm:text-body-lg text-white/80 delay-200 fill-both">
            {s.hero_subheadline}
          </p>
          <div className="flex flex-col items-center gap-3 sm:gap-4 sm:flex-row sm:justify-center animate-fade-in delay-300 fill-both w-full">
            <Button size="lg" className="w-full sm:w-auto" asChild>
              <Link href="/listings">Browse Homes <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
            <Button size="lg" variant="outline" className="w-full sm:w-auto border-white text-white hover:bg-white hover:text-primary" asChild>
              <Link href="/quiz"><Sparkles className="mr-2 h-5 w-5" />Find My Home</Link>
            </Button>
          </div>

          <div className="mt-10 sm:mt-16 grid grid-cols-2 gap-4 sm:gap-6 sm:grid-cols-4 animate-fade-in delay-500 fill-both">
            {STATS.map(({ value, label, icon: Icon }) => (
              <div key={label} className="text-center">
                <div className="mb-1 font-heading text-2xl sm:text-3xl font-bold text-gold">{value}</div>
                <div className="text-xs sm:text-caption uppercase tracking-widest text-white/60">{label}</div>
              </div>
            ))}
          </div>
        </Container>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="h-10 w-6 rounded-full border-2 border-white/30 flex items-center justify-center">
            <div className="h-2 w-0.5 rounded-full bg-white/60" />
          </div>
        </div>
      </section>

      {/* ── Featured Listings ─────────────────────────────────────────── */}
      <section className="section-luxury bg-background-cream">
        <Container>
          <RevealOnScroll>
            <div className="mb-14 text-center">
              <p className="overline mb-3">Hand-Picked Properties</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">Featured Properties</h2>
              <p className="mx-auto mt-6 max-w-xl text-body text-foreground-muted">
                Discover exceptional homes across the Texas Hill Country, curated by our expert team.
              </p>
            </div>
          </RevealOnScroll>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {featuredListings.map((listing, i) => (
              <RevealOnScroll key={listing.id} delay={i * 100}>
                <Link href={`/listings/${listing.slug}`} className="card-luxury group block">
                  <div className="image-luxury aspect-property bg-background-warm">
                    {listing.images && (listing.images as string[])[0] ? (
                      <Image src={(listing.images as string[])[0]} alt={listing.title} fill className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-foreground-subtle"><Home className="h-12 w-12" /></div>
                    )}
                  </div>
                  <div className="p-6">
                    <p className="mb-1 text-caption uppercase tracking-wider text-foreground-muted">
                      <MapPin className="mr-1 inline h-3 w-3" />{listing.city}, TX
                    </p>
                    <h3 className="mb-2 font-heading text-heading font-semibold text-primary group-hover:text-gold transition-colors">{listing.title}</h3>
                    <p className="mb-4 price-tag">{formatPrice(listing.price)}</p>
                    <div className="flex items-center gap-4 text-caption text-foreground-muted border-t border-border pt-4">
                      <span className="flex items-center gap-1.5"><Bed className="h-4 w-4" />{listing.bedrooms} bd</span>
                      <span className="flex items-center gap-1.5"><Bath className="h-4 w-4" />{listing.bathrooms} ba</span>
                      <span className="flex items-center gap-1.5"><Square className="h-4 w-4" />{(listing.sqft ?? 0).toLocaleString()} sqft</span>
                    </div>
                  </div>
                </Link>
              </RevealOnScroll>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Button variant="outline" size="lg" asChild>
              <Link href="/listings">View All Listings <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </Container>
      </section>

      {/* ── Neighborhoods ─────────────────────────────────────────────── */}
      <section className="section-luxury bg-white">
        <Container>
          <RevealOnScroll>
            <div className="mb-14 text-center">
              <p className="overline mb-3">Where You&apos;ll Live</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">Explore Neighborhoods</h2>
            </div>
          </RevealOnScroll>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredNeighborhoods.map((n, i) => (
              <RevealOnScroll key={n.id} delay={i * 120}>
                <Link href={`/neighborhoods/${n.slug}`}
                  className="group relative overflow-hidden rounded-xl bg-primary aspect-[4/3] flex flex-col justify-end p-6 text-white">
                  {n.image_url ? (
                    <Image src={n.image_url} alt={n.name} fill className="object-cover transition-transform duration-700 group-hover:scale-105" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-hillcountry-oak to-primary" />
                  )}
                  <div className="gradient-card absolute inset-0" />
                  <div className="relative z-10">
                    <h3 className="font-heading text-heading-lg font-bold">{n.name}</h3>
                    {n.avg_price && <p className="mt-1 text-body-sm text-white/70">From {formatPrice(n.avg_price)}</p>}
                    {Array.isArray(n.highlights) && n.highlights.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(n.highlights as string[]).slice(0, 2).map((h: string) => (
                          <span key={h} className="rounded-full bg-white/20 px-3 py-1 text-caption backdrop-blur-sm">{h}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </RevealOnScroll>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Button variant="outline" size="lg" asChild>
              <Link href="/neighborhoods">All Neighborhoods</Link>
            </Button>
          </div>
        </Container>
      </section>

      {/* ── Why Us ───────────────────────────────────────────────────── */}
      <section className="section-luxury bg-primary text-white">
        <Container>
          <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center">
            <RevealOnScroll direction="left">
              <p className="overline mb-4 text-gold">Why Fair Oaks Realty Group</p>
              <h2 className="mb-6 font-heading text-display-sm font-bold text-white">
                {s.about_headline}
              </h2>
              <p className="mb-8 text-body-lg text-white/70">{s.about_text}</p>
              <ul className="space-y-4 mb-10">
                {['Hyper-local market expertise — we live here too', 'Dedicated buyer and seller representation', 'Concierge-level service from search to close', 'Transparent, honest guidance at every step'].map(item => (
                  <li key={item} className="flex items-start gap-3 text-body text-white/80">
                    <span className="mt-1 h-5 w-5 rounded-full bg-gold flex items-center justify-center shrink-0">
                      <svg className="h-3 w-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <Button size="lg" className="w-full sm:w-auto" asChild><Link href="/team">Meet the Team</Link></Button>
                <Button size="lg" variant="outline" className="w-full sm:w-auto border-white/30 text-white hover:bg-white/10" asChild>
                  <Link href="/sell">Sell My Home</Link>
                </Button>
              </div>
            </RevealOnScroll>
            <RevealOnScroll direction="right">
              <div className="grid grid-cols-2 gap-4 sm:gap-5">
                {STATS.map(({ value, label, icon: Icon }) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-6 text-center backdrop-blur-sm">
                    <Icon className="mx-auto mb-2 sm:mb-3 h-6 w-6 sm:h-8 sm:w-8 text-gold" />
                    <div className="font-heading text-2xl sm:text-display-sm font-bold text-white">{value}</div>
                    <div className="mt-1 text-[10px] sm:text-caption uppercase tracking-wider text-white/50">{label}</div>
                  </div>
                ))}
              </div>
            </RevealOnScroll>
          </div>
        </Container>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────── */}
      <section className="section-luxury bg-background-cream">
        <Container>
          <RevealOnScroll>
            <div className="mb-14 text-center">
              <p className="overline mb-3">Client Stories</p>
              <h2 className="font-heading text-display font-bold text-primary gold-line gold-line-center inline-block pb-4">What Our Clients Say</h2>
            </div>
          </RevealOnScroll>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {featuredTestimonials.map((t, i) => (
              <RevealOnScroll key={t.id} delay={i * 100}>
                <div className="rounded-xl bg-white p-5 sm:p-8 shadow-card h-full flex flex-col">
                  <div className="flex gap-1 mb-5">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="h-5 w-5 fill-gold text-gold" />
                    ))}
                  </div>
                  <p className="quote-luxury flex-1 text-foreground-muted">{t.quote}</p>
                  <div className="mt-6 pt-6 border-t border-border">
                    <p className="font-semibold text-primary">{t.client_name}</p>
                    {t.client_location && <p className="text-caption text-foreground-muted">{t.client_location}</p>}
                  </div>
                </div>
              </RevealOnScroll>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Quiz CTA ─────────────────────────────────────────────────── */}
      <section className="section-compact bg-gold">
        <Container>
          <div className="flex flex-col items-center justify-between gap-8 text-center lg:flex-row lg:text-left">
            <div>
              <h2 className="font-heading text-display-sm font-bold text-primary">{s.cta_headline}</h2>
              <p className="mt-2 text-body text-primary/70">{s.cta_subheadline}</p>
            </div>
            <Button size="xl" className="shrink-0 bg-white text-primary hover:bg-white/90 shadow-lg font-bold" asChild>
              <Link href="/quiz"><Sparkles className="mr-2 h-5 w-5 text-gold" />Find My Perfect Home</Link>
            </Button>
          </div>
        </Container>
      </section>

      <Footer />
    </>
  );
}
