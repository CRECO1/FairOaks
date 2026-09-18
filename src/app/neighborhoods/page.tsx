export const revalidate = 3600;

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fair Oaks Ranch Neighborhoods & Communities | Area Guide',
  description:
    'Explore neighborhoods in the Texas Hill Country — Fair Oaks Ranch, Boerne, Helotes, The Dominion, Cordillera Ranch, and more. Find your perfect community.',
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
    canonical: '/neighborhoods',
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
import { jsonLdScript } from '@/lib/json-ld';

export default async function NeighborhoodsPage() {
  // No demo fallback: the featured/rest sections below already render nothing
  // when the list is empty, which is the honest result of a failed query.
  const data = await getNeighborhoods().catch(() => []);

  const featured = data.filter(n => n.featured);
  const rest = data.filter(n => !n.featured);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Fair Oaks Ranch Neighborhoods & Communities',
    description: 'Explore neighborhoods in Fair Oaks Ranch, Boerne, Helotes, and The Dominion TX.',
    url: 'https://www.fairoaksrealtygroup.com/neighborhoods',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: data.map((n, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `https://www.fairoaksrealtygroup.com/neighborhoods/${n.slug}`,
        name: n.name,
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <Header />
      <main className="min-h-screen pt-20">
        {/* Hero */}
        <div className="bg-primary py-10 sm:py-16 text-white">
          <Container>
            <p className="overline mb-2 text-gold">Where You&apos;ll Live</p>
            <h1 className="font-heading text-display-sm font-bold">Explore Neighborhoods</h1>
            <p className="mt-3 max-w-xl text-body text-white/60">
              From gated Hill Country estates to charming historic towns — discover every community we serve.
            </p>
          </Container>
        </div>

        {/* Featured Neighborhoods */}
        {data.length === 0 && (
          <Container>
            <p className="py-12 text-center text-body text-foreground-muted">
              Neighborhood guides aren&apos;t available right now. Please{' '}
              <a href="/contact" className="text-gold underline">contact us</a> and we&apos;ll walk you through the area.
            </p>
          </Container>
        )}
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
