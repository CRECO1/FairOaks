export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Bed, Bath, Square, MapPin, Calendar, Phone, ArrowLeft, Home, CheckCircle } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { getListingBySlug } from '@/lib/supabase';
import { formatPrice } from '@/lib/utils';
import { ListingContactForm } from './ListingContactForm';

const DEMO: Record<string, object> = {
  '124-saddlebrook-drive': {
    id: '1', title: '124 Saddlebrook Drive', slug: '124-saddlebrook-drive', price: 725000,
    address: '124 Saddlebrook Drive', city: 'Fair Oaks Ranch', state: 'TX', zip: '78015',
    bedrooms: 4, bathrooms: 3, sqft: 2850, lot_size: '0.42 ac', year_built: 2019,
    property_type: 'Single Family', status: 'active', mls_number: '1234567',
    listing_date: '2026-03-15', images: null,
    description: 'Stunning Hill Country home on a generous lot with sweeping views. This meticulously maintained 4-bedroom residence features an open-concept great room, chef\'s kitchen with quartz countertops, and a resort-style backyard with a sparkling pool. Primary suite with spa bath, custom walk-in closet, and private patio access. Three-car garage, whole-home generator, and Boerne ISD schools.',
    features: ['Pool & Spa', 'Hill Country Views', '3-Car Garage', 'Whole-Home Generator', 'Chef\'s Kitchen', 'Primary Suite w/ Patio', 'Boerne ISD'],
  },
};

interface Props { params: Promise<{ slug: string }> }

export default async function ListingDetailPage({ params }: Props) {
  const { slug } = await params;

  let listing = await getListingBySlug(slug).catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!listing && DEMO[slug]) listing = DEMO[slug] as any;
  if (!listing) notFound();

  const images = (listing!.images as string[] | null) ?? [];

  return (
    <>
      <Header variant="minimal" />
      <main className="min-h-screen pt-20">

        {/* Back */}
        <div className="border-b border-border bg-background-cream py-4">
          <Container>
            <Link href="/listings" className="inline-flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back to Listings
            </Link>
          </Container>
        </div>

        {/* Image Gallery */}
        <div className="bg-background-warm">
          <Container className="py-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="md:col-span-2 aspect-[4/3] relative rounded-xl overflow-hidden bg-background-cream">
                {images[0] ? (
                  <Image src={images[0]} alt={listing!.title} fill className="object-cover" priority />
                ) : (
                  <div className="flex h-full items-center justify-center text-foreground-subtle">
                    <Home className="h-20 w-20" />
                  </div>
                )}
              </div>
              <div className="grid grid-rows-2 gap-3">
                {[1, 2].map(i => (
                  <div key={i} className="aspect-[4/3] relative rounded-xl overflow-hidden bg-background-cream">
                    {images[i] ? (
                      <Image src={images[i]} alt={`Photo ${i + 1}`} fill className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-foreground-subtle">
                        <Home className="h-10 w-10" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </div>

        {/* Detail Content */}
        <Container className="py-10">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">

            {/* Main */}
            <div className="lg:col-span-2">
              <div className="mb-6 flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3 sm:gap-4">
                <div>
                  <p className="text-caption text-foreground-muted mb-1">
                    <MapPin className="mr-1 inline h-3 w-3" />
                    {listing!.address}, {listing!.city}, {listing!.state} {listing!.zip}
                  </p>
                  <h1 className="font-heading text-display-sm font-bold text-primary">
                    {listing!.title}
                  </h1>
                </div>
                <div className="sm:text-right">
                  <p className="font-heading text-display-sm font-bold text-primary">
                    {formatPrice(listing!.price)}
                  </p>
                  <span className="inline-block mt-1 rounded-full bg-gold/20 px-3 py-0.5 text-caption font-semibold text-gold-dark uppercase">
                    {listing!.status}
                  </span>
                </div>
              </div>

              {/* Key Stats */}
              <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { icon: Bed, label: 'Bedrooms', value: listing!.bedrooms },
                  { icon: Bath, label: 'Bathrooms', value: listing!.bathrooms },
                  { icon: Square, label: 'Sq Ft', value: listing!.sqft.toLocaleString() },
                  { icon: Calendar, label: 'Year Built', value: listing!.year_built ?? '—' },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-xl border border-border p-4 text-center">
                    <Icon className="mx-auto mb-2 h-5 w-5 text-gold" />
                    <div className="font-heading text-heading font-bold text-primary">{value}</div>
                    <div className="text-caption text-foreground-muted">{label}</div>
                  </div>
                ))}
              </div>

              {/* Description */}
              {listing!.description && (
                <div className="mb-8">
                  <h2 className="mb-4 font-heading text-heading-lg font-semibold text-primary">About This Home</h2>
                  <p className="text-body text-foreground-muted leading-relaxed">{listing!.description as string}</p>
                </div>
              )}

              {/* Features */}
              {Array.isArray(listing!.features) && (listing!.features as string[]).length > 0 && (
                <div className="mb-8">
                  <h2 className="mb-4 font-heading text-heading-lg font-semibold text-primary">Features & Amenities</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {(listing!.features as string[]).map(f => (
                      <div key={f} className="flex items-center gap-2 text-body-sm text-foreground-muted">
                        <CheckCircle className="h-4 w-4 shrink-0 text-gold" />
                        {f}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Details */}
              <div>
                <h2 className="mb-4 font-heading text-heading-lg font-semibold text-primary">Property Details</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: 'MLS #', value: listing!.mls_number },
                    { label: 'Property Type', value: listing!.property_type },
                    { label: 'Lot Size', value: listing!.lot_size },
                    { label: 'Listed', value: listing!.listing_date ? new Date(listing!.listing_date).toLocaleDateString() : null },
                  ].filter(d => d.value).map(({ label, value }) => (
                    <div key={label} className="rounded-lg bg-background-cream p-4">
                      <div className="text-caption text-foreground-muted">{label}</div>
                      <div className="mt-1 text-body-sm font-semibold text-primary">{value as string}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1">
              <div className="sticky top-28 rounded-xl border border-border bg-white p-6 shadow-card">
                <h3 className="mb-2 font-heading text-heading font-semibold text-primary">
                  Interested in This Home?
                </h3>
                <p className="mb-6 text-body-sm text-foreground-muted">
                  Contact us to schedule a private showing or ask any questions.
                </p>
                <ListingContactForm listingTitle={listing!.title} />
                <div className="mt-6 pt-6 border-t border-border text-center">
                  <p className="text-caption text-foreground-muted mb-2">Or call us directly</p>
                  <a href="tel:+12103909997" className="inline-flex items-center gap-2 font-semibold text-primary hover:text-gold transition-colors">
                    <Phone className="h-5 w-5" />
                    (210) 390-9997
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}
