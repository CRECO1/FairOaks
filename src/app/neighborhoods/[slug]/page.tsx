export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, MapPin, Home, DollarSign, School, CheckCircle } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { getNeighborhoodBySlug, getListingsByCity } from '@/lib/supabase';
import { formatPrice } from '@/lib/utils';

const DEMO_NEIGHBORHOODS: Record<string, object> = {
  'fair-oaks-ranch': {
    id: '1', name: 'Fair Oaks Ranch', slug: 'fair-oaks-ranch', city: 'Fair Oaks Ranch',
    avg_price: 680000, avg_sqft: 2800, image_url: null, school_district: 'Boerne ISD',
    description: 'A premier master-planned community set in the rolling Texas Hill Country northwest of San Antonio. Fair Oaks Ranch offers an unmatched lifestyle blending natural beauty, top-rated schools, and a strong sense of community. With over 5,000 acres of scenic terrain, residents enjoy quiet cul-de-sacs, equestrian trails, and sweeping views that make every drive feel like a getaway.',
    highlights: ['Top-rated Boerne ISD', 'Gated communities available', 'Hill Country views from most lots', 'Equestrian & hiking trails', '20 min to San Antonio', 'Active HOA & community events'],
    featured: true,
  },
  'boerne': {
    id: '2', name: 'Boerne', slug: 'boerne', city: 'Boerne',
    avg_price: 575000, avg_sqft: 2400, image_url: null, school_district: 'Boerne ISD',
    description: 'Boerne (pronounced "Bernie") is a charming Texas Hill Country town with a walkable historic Main Street, thriving local restaurants, and world-class outdoor recreation. The Cibolo Creek runs through town and the scenic countryside draws buyers from across Texas seeking a slower, richer pace of life without sacrificing modern convenience.',
    highlights: ['Historic Main Street', 'Cibolo Creek access', 'Vibrant arts & dining scene', 'Highly rated schools', '30 min to San Antonio', 'Annual events & festivals'],
    featured: true,
  },
};

interface Props { params: Promise<{ slug: string }> }

export default async function NeighborhoodDetailPage({ params }: Props) {
  const { slug } = await params;

  let neighborhood = await getNeighborhoodBySlug(slug).catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!neighborhood && DEMO_NEIGHBORHOODS[slug]) neighborhood = DEMO_NEIGHBORHOODS[slug] as any;
  if (!neighborhood) notFound();

  const listings = await getListingsByCity(neighborhood!.city).catch(() => []);

  return (
    <>
      <Header variant="minimal" />
      <main className="min-h-screen pt-20">
        {/* Back */}
        <div className="border-b border-border bg-background-cream py-4">
          <Container>
            <Link href="/neighborhoods" className="inline-flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors">
              <ArrowLeft className="h-4 w-4" /> All Neighborhoods
            </Link>
          </Container>
        </div>

        {/* Hero */}
        <div className="relative min-h-[40vh] bg-primary flex items-end">
          {neighborhood!.image_url && (
            <Image src={neighborhood!.image_url as string} alt={neighborhood!.name} fill className="object-cover" />
          )}
          <div className="absolute inset-0 hero-overlay-luxury" />
          <Container className="relative z-10 pb-12 pt-20 text-white">
            <p className="overline mb-2 text-gold">
              <MapPin className="mr-1 inline h-3 w-3" />
              {neighborhood!.city}, TX
            </p>
            <h1 className="font-heading text-display-sm font-bold">{neighborhood!.name}</h1>
          </Container>
        </div>

        {/* Stats Bar */}
        <div className="bg-gold py-6">
          <Container>
            <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
              {neighborhood!.avg_price && (
                <div className="flex items-center gap-3">
                  <DollarSign className="h-5 w-5 text-primary/60" />
                  <div>
                    <div className="font-heading text-heading font-bold text-primary">{formatPrice(neighborhood!.avg_price as number)}</div>
                    <div className="text-caption text-primary/60">Avg. Home Price</div>
                  </div>
                </div>
              )}
              {neighborhood!.avg_sqft && (
                <div className="flex items-center gap-3">
                  <Home className="h-5 w-5 text-primary/60" />
                  <div>
                    <div className="font-heading text-heading font-bold text-primary">{(neighborhood!.avg_sqft as number).toLocaleString()} sf</div>
                    <div className="text-caption text-primary/60">Avg. Home Size</div>
                  </div>
                </div>
              )}
              {neighborhood!.school_district && (
                <div className="flex items-center gap-3">
                  <School className="h-5 w-5 text-primary/60" />
                  <div>
                    <div className="font-heading text-heading font-bold text-primary">{neighborhood!.school_district as string}</div>
                    <div className="text-caption text-primary/60">School District</div>
                  </div>
                </div>
              )}
            </div>
          </Container>
        </div>

        {/* Content */}
        <section className="section-luxury">
          <Container>
            <div className="grid grid-cols-1 gap-14 lg:grid-cols-3">
              <div className="lg:col-span-2">
                {neighborhood!.description && (
                  <div className="mb-10">
                    <h2 className="mb-4 font-heading text-heading-xl font-bold text-primary">About {neighborhood!.name}</h2>
                    <p className="text-body text-foreground-muted leading-relaxed">{neighborhood!.description as string}</p>
                  </div>
                )}

                {Array.isArray(neighborhood!.highlights) && (neighborhood!.highlights as string[]).length > 0 && (
                  <div className="mb-10">
                    <h2 className="mb-4 font-heading text-heading-xl font-bold text-primary">Why People Love It Here</h2>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {(neighborhood!.highlights as string[]).map(h => (
                        <div key={h} className="flex items-center gap-3 text-body text-foreground-muted">
                          <CheckCircle className="h-5 w-5 shrink-0 text-gold" />
                          {h}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {listings.length > 0 && (
                  <div>
                    <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">
                      Homes for Sale in {neighborhood!.name}
                    </h2>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                      {listings.slice(0, 4).map(l => (
                        <Link key={l.id} href={`/listings/${l.slug}`} className="card-luxury group block p-5">
                          <p className="text-body-sm font-semibold text-primary group-hover:text-gold transition-colors line-clamp-1">{l.title}</p>
                          <p className="mt-1 font-heading text-heading font-bold text-gold">{formatPrice(l.price)}</p>
                          <p className="mt-1 text-caption text-foreground-muted">{l.bedrooms} bd · {l.bathrooms} ba · {l.sqft.toLocaleString()} sf</p>
                        </Link>
                      ))}
                    </div>
                    <div className="mt-6">
                      <Button variant="outline" asChild>
                        <Link href={`/listings?city=${encodeURIComponent(neighborhood!.city)}`}>
                          View All Listings in {neighborhood!.name}
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Sidebar */}
              <div>
                <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                    Interested in {neighborhood!.name}?
                  </h3>
                  <p className="mb-6 text-body-sm text-foreground-muted">
                    Let us show you available homes and share insider knowledge about this community.
                  </p>
                  <Button size="lg" fullWidth asChild>
                    <Link href={`/contact?area=${encodeURIComponent(neighborhood!.name)}`}>
                      Talk to a Local Expert
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" fullWidth className="mt-3" asChild>
                    <Link href={`/listings?city=${encodeURIComponent(neighborhood!.city)}`}>
                      See Available Homes
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
