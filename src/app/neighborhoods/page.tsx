export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fair Oaks Ranch Neighborhoods & Communities | Area Guide',
  description:
    'Explore neighborhoods in Fair Oaks Ranch, Boerne, Helotes, and The Dominion TX. Find the perfect Texas Hill Country community — school ratings, home prices, and local highlights.',
  keywords: [
    'Fair Oaks Ranch neighborhoods',
    'Fair Oaks Ranch communities',
    'Fair Oaks Ranch TX area guide',
    'Boerne TX neighborhoods',
    'Helotes TX communities',
    'The Dominion San Antonio homes',
    'Texas Hill Country neighborhoods',
    'best neighborhoods Fair Oaks Ranch',
    'Fair Oaks Ranch school districts',
    'gated communities Fair Oaks Ranch TX',
  ],
  openGraph: {
    title: 'Fair Oaks Ranch Neighborhoods & Communities | Area Guide',
    description:
      'Explore the best neighborhoods in Fair Oaks Ranch, Boerne & Helotes TX. Compare home prices, school districts, and community features.',
    url: 'https://www.fairoaksrealtygroup.com/neighborhoods',
    type: 'website',
  },
  alternates: {
    canonical: 'https://www.fairoaksrealtygroup.com/neighborhoods',
  },
};

import Link from 'next/link';
import Image from 'next/image';
import { MapPin, Home } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';
import { RevealOnScroll } from '@/hooks/useScrollReveal';
import { getNeighborhoods, type Neighborhood } from '@/lib/supabase';
import { formatPrice } from '@/lib/utils';

const DEMO_NEIGHBORHOODS = [
  { id: '1', name: 'Fair Oaks Ranch', slug: 'fair-oaks-ranch', city: 'Fair Oaks Ranch', avg_price: 680000, image_url: null, highlights: ['Top-rated Boerne ISD', 'Gated communities', 'Hill Country views', 'Equestrian trails'], description: 'A premier master-planned community set in the rolling Texas Hill Country northwest of San Antonio.', featured: true, school_district: 'Boerne ISD', avg_sqft: 2800, created_at: '', updated_at: '' },
  { id: '2', name: 'Boerne', slug: 'boerne', city: 'Boerne', avg_price: 575000, image_url: null, highlights: ['Historic Main Street', 'Cibolo Creek access', 'Vibrant arts scene', 'Top-rated schools'], description: 'Charming Texas Hill Country town with a walkable historic district and world-class outdoor recreation.', featured: true, school_district: 'Boerne ISD', avg_sqft: 2400, created_at: '', updated_at: '' },
  { id: '3', name: 'Helotes', slug: 'helotes', city: 'Helotes', avg_price: 430000, image_url: null, highlights: ['Family-friendly neighborhoods', 'Large wooded lots', 'Close to UTSA & Loop 1604', 'Northside ISD'], description: 'A welcoming community on the northwest corner of San Antonio offering space, charm, and convenience.', featured: false, school_district: 'Northside ISD', avg_sqft: 2100, created_at: '', updated_at: '' },
  { id: '4', name: 'Leon Springs', slug: 'leon-springs', city: 'Leon Springs', avg_price: 510000, image_url: null, highlights: ['Wildlife corridors', 'IH-10 access', 'Acreage available', 'Northside ISD'], description: 'Peaceful community along the banks of Leon Creek, offering larger lots and natural scenery.', featured: false, school_district: 'Northside ISD', avg_sqft: 2350, created_at: '', updated_at: '' },
  { id: '5', name: 'The Dominion', slug: 'the-dominion', city: 'San Antonio', avg_price: 1200000, image_url: null, highlights: ['Ultra-luxury estates', 'Private golf club', '24-hr gated security', 'PGA Tour access'], description: 'San Antonio\'s most exclusive gated community, home to estates from $700K to $10M+.', featured: true, school_district: 'Northside ISD', avg_sqft: 5000, created_at: '', updated_at: '' },
  { id: '6', name: 'Bulverde', slug: 'bulverde', city: 'Bulverde', avg_price: 485000, image_url: null, highlights: ['New master-planned communities', 'Comal ISD', 'Rapid growth corridor', 'Proximity to Canyon Lake'], description: 'One of the fastest-growing communities in the Hill Country, with new builds and great schools.', featured: false, school_district: 'Comal ISD', avg_sqft: 2600, created_at: '', updated_at: '' },
];

export default async function NeighborhoodsPage() {
  const neighborhoods = await getNeighborhoods().catch(() => DEMO_NEIGHBORHOODS);
  const data = neighborhoods.length > 0 ? neighborhoods : DEMO_NEIGHBORHOODS;

  const featured = data.filter(n => n.featured);
  const rest = data.filter(n => !n.featured);

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">
        {/* Hero */}
        <div className="bg-primary py-16 text-white">
          <Container>
            <p className="overline mb-2 text-gold">Where You&apos;ll Live</p>
            <h1 className="font-heading text-display-sm font-bold">Explore Neighborhoods</h1>
            <p className="mt-3 max-w-xl text-body text-white/60">
              From gated Hill Country estates to charming historic towns — discover every community we serve.
            </p>
          </Container>
        </div>

        {/* Featured Neighborhoods */}
        {featured.length > 0 && (
          <section className="section-luxury bg-background-cream">
            <Container>
              <RevealOnScroll>
                <h2 className="mb-12 font-heading text-display font-bold text-primary text-center gold-line gold-line-center pb-4">
                  Featured Communities
                </h2>
              </RevealOnScroll>
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
                {featured.map((n, i) => (
                  <RevealOnScroll key={n.id} delay={i * 100}>
                    <NeighborhoodCard n={n} featured />
                  </RevealOnScroll>
                ))}
              </div>
            </Container>
          </section>
        )}

        {/* All Neighborhoods */}
        {rest.length > 0 && (
          <section className="section-compact bg-white">
            <Container>
              <h2 className="mb-8 font-heading text-heading-xl font-bold text-primary">All Areas</h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((n, i) => (
                  <RevealOnScroll key={n.id} delay={i * 80}>
                    <NeighborhoodCard n={n} />
                  </RevealOnScroll>
                ))}
              </div>
            </Container>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}

function NeighborhoodCard({ n, featured = false }: { n: Neighborhood; featured?: boolean }) {
  return (
    <Link href={`/neighborhoods/${n.slug}`} className="card-luxury group block overflow-hidden">
      <div className={`relative bg-background-warm ${featured ? 'aspect-[16/9]' : 'aspect-[4/3]'}`}>
        {n.image_url ? (
          <Image src={n.image_url} alt={n.name} fill className="object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-hillcountry-sage/20 to-hillcountry-oak/20">
            <MapPin className="h-12 w-12 text-hillcountry-sage/40" />
          </div>
        )}
      </div>
      <div className="p-6">
        <div className="mb-1 flex items-center gap-2">
          <p className="text-caption text-foreground-muted">{n.city}, TX · {n.school_district}</p>
        </div>
        <h3 className="font-heading text-heading font-semibold text-primary group-hover:text-gold transition-colors">
          {n.name}
        </h3>
        {n.avg_price && (
          <p className="mt-1 text-body-sm font-semibold text-gold">From {formatPrice(n.avg_price)}</p>
        )}
        {n.description && (
          <p className="mt-2 text-body-sm text-foreground-muted line-clamp-2">{n.description as string}</p>
        )}
        {Array.isArray(n.highlights) && (n.highlights as string[]).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {(n.highlights as string[]).slice(0, 3).map(h => (
              <span key={h} className="rounded-full border border-border px-3 py-1 text-caption text-foreground-muted">
                {h}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center gap-1 text-body-sm font-semibold text-gold">
          <Home className="h-4 w-4" />
          View Homes
        </div>
      </div>
    </Link>
  );
}
