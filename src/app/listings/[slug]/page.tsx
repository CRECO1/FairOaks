export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Bed, Bath, Square, MapPin, Calendar, Phone, ArrowLeft, Home, CheckCircle, ArrowRight } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { searchProperties, getMediaBatch, resoPropertyToListing } from '@/lib/sabor-reso';
import { formatPrice } from '@/lib/utils';
import { ListingContactForm } from './ListingContactForm';
import { MortgageCalculator } from '@/components/sections/MortgageCalculator';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

/** Extract the numeric ListingId that was appended to the slug, e.g. "3019-w-houston-1955235" → "1955235" */
function listingIdFromSlug(slug: string): string | null {
  const match = slug.match(/-(\d{5,})$/);
  return match?.[1] ?? null;
}

/** Detect which featured area a listing belongs to, and return the SABOR filter + display label */
function detectArea(listing: { city: string; subdivision_name: string | null }): { label: string; display: string; filter: string } | null {
  const sub = (listing.subdivision_name ?? '').toLowerCase();
  const city = listing.city.toLowerCase().replace(/\s+/g, '');

  // Labels must match the dropdown option values in /listings page exactly
  if (sub.includes('ominion') && city.includes('sanantonio')) {
    return { label: 'Dominion', display: 'The Dominion', filter: `City eq ODataService.City_Lkp_1'SANANTONIO' and contains(SubdivisionName,'ominion')` };
  }
  if (sub.includes('cordillera')) {
    return { label: 'Cordillera Ranch', display: 'Cordillera Ranch', filter: `contains(SubdivisionName,'CORDILLERA')` };
  }
  if (city === 'fairoaksra' || listing.city.toLowerCase().replace(/\s/g, '') === 'fairoaksranch') {
    return { label: 'Fair Oaks Ranch', display: 'Fair Oaks Ranch', filter: `City eq ODataService.City_Lkp_1'FAIROAKSRA'` };
  }
  if (city === 'boerne') {
    return { label: 'Boerne', display: 'Boerne', filter: `City eq ODataService.City_Lkp_1'BOERNE'` };
  }
  if (city === 'helotes') {
    return { label: 'Helotes', display: 'Helotes', filter: `City eq ODataService.City_Lkp_1'HELOTES'` };
  }
  return null;
}

/** Fetch nearby listings in the same area, excluding the current listing */
async function fetchNearbyListings(area: { label: string; filter: string }, excludeId: string) {
  try {
    const filter = `StandardStatus eq ODataService.StandardStatus'ACTIVE' and ${area.filter}`;
    const result = await searchProperties({ filter, top: 12, orderby: 'ListPrice desc' });
    const props = result.value.filter(p => p.ListingId !== excludeId).slice(0, 8);
    if (props.length === 0) return [];
    const mediaMap = await getMediaBatch(props.map(p => p.ListingId));
    return props.map(p => resoPropertyToListing(p, mediaMap.get(p.ListingId) ?? []));
  } catch { return []; }
}

async function fetchListing(slug: string) {
  const listingId = listingIdFromSlug(slug);
  if (!listingId) return null;

  try {
    const result = await searchProperties({
      filter: `ListingId eq '${listingId}'`,
      top: 1,
    });
    const property = result.value[0];
    if (!property) return null;

    const mediaMap = await getMediaBatch([property.ListingId]);
    const images = mediaMap.get(property.ListingId) ?? [];
    return resoPropertyToListing(property, images);
  } catch {
    return null;
  }
}

interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const listing = await fetchListing(slug);
  if (!listing) return {};

  const title = listing.price
    ? `${listing.title} | ${listing.city}, TX — ${formatPrice(listing.price)}`
    : `${listing.title} | ${listing.city}, TX`;

  const beds = listing.bedrooms ? `${listing.bedrooms}bd` : '';
  const baths = listing.bathrooms ? `${listing.bathrooms}ba` : '';
  const sqft = listing.sqft ? `${Number(listing.sqft).toLocaleString()} sqft` : '';
  const stats = [beds, baths, sqft].filter(Boolean).join(' · ');
  const description = `${listing.address}, ${listing.city}, TX ${listing.zip ?? ''}. ${stats}${listing.price ? ` Listed at ${formatPrice(listing.price)}.` : ''} Contact Fair Oaks Realty Group today.`.trim();

  const ogImage = Array.isArray(listing.images) && listing.images[0]
    ? listing.images[0]
    : `${BASE_URL}/images/og-home.jpg`;

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/listings/${slug}` },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/listings/${slug}`,
      type: 'website',
      images: [{ url: ogImage, alt: listing.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    keywords: [
      `${listing.address} ${listing.city} TX`,
      `${listing.city} TX homes for sale`,
      `${listing.city} TX real estate`,
      listing.mls_number ? `MLS ${listing.mls_number}` : '',
      'Texas Hill Country real estate',
      'Fair Oaks Realty Group',
    ].filter(Boolean),
  };
}

export default async function ListingDetailPage({ params }: Props) {
  const { slug } = await params;

  const listing = await fetchListing(slug);
  if (!listing) notFound();

  const images = (listing.images as string[] | null) ?? [];

  // Detect area + fetch nearby listings in parallel
  const area = detectArea({ city: listing.city, subdivision_name: listing.subdivision_name });
  const nearbyListings = area ? await fetchNearbyListings(area, listing.listing_key) : [];

  const citySlug = listing.city
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
          { '@type': 'ListItem', position: 2, name: 'Listings', item: `${BASE_URL}/listings` },
          { '@type': 'ListItem', position: 3, name: listing.title, item: `${BASE_URL}/listings/${slug}` },
        ],
      },
      {
        '@type': 'SingleFamilyResidence',
        name: listing.title,
        url: `${BASE_URL}/listings/${slug}`,
        description: listing.description ?? undefined,
        numberOfRooms: listing.bedrooms ?? undefined,
        numberOfBathroomsTotal: listing.bathrooms ?? undefined,
        floorSize: listing.sqft ? { '@type': 'QuantitativeValue', value: listing.sqft, unitCode: 'FTK' } : undefined,
        yearBuilt: listing.year_built ?? undefined,
        address: {
          '@type': 'PostalAddress',
          streetAddress: listing.address,
          addressLocality: listing.city,
          addressRegion: listing.state ?? 'TX',
          postalCode: listing.zip ?? undefined,
          addressCountry: 'US',
        },
        ...(listing.price ? {
          offers: {
            '@type': 'Offer',
            price: listing.price,
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
        } : {}),
        ...(images[0] ? { image: images[0] } : {}),
      },
    ],
  };

  const realEstateListingLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: listing.title,
    description: listing.description ?? listing.address,
    url: `${BASE_URL}/listings/${slug}`,
    ...(listing.listing_date ? { datePosted: listing.listing_date } : {}),
    price: listing.price ?? undefined,
    priceCurrency: 'USD',
    ...(images[0] ? { image: images[0] } : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: listing.address,
      addressLocality: listing.city,
      addressRegion: 'TX',
      postalCode: listing.zip ?? undefined,
      addressCountry: 'US',
    },
    ...(listing.bedrooms ? { numberOfRooms: listing.bedrooms } : {}),
    ...(listing.sqft ? {
      floorSize: {
        '@type': 'QuantitativeValue',
        value: listing.sqft,
        unitCode: 'FTK',
      },
    } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(realEstateListingLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
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
                  <Image src={images[0]} alt={listing.title} fill className="object-cover" priority />
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
                      <Image src={images[i]} alt={`${listing.title} — photo ${i + 1}`} fill className="object-cover" />
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
                    {listing.address}, {listing.city}, {listing.state} {listing.zip}
                  </p>
                  <h1 className="font-heading text-display-sm font-bold text-primary">
                    {listing.title}
                  </h1>
                </div>
                <div className="sm:text-right">
                  <p className="font-heading text-display-sm font-bold text-primary">
                    {listing.price ? formatPrice(listing.price) : 'Contact for Price'}
                  </p>
                  <span className="inline-block mt-1 rounded-full bg-gold/20 px-3 py-0.5 text-caption font-semibold text-gold-dark uppercase">
                    {listing.status}
                  </span>
                </div>
              </div>

              {/* Key Stats */}
              {(() => {
                const stats = [
                  { icon: Bed, label: 'Bedrooms', value: listing.bedrooms },
                  { icon: Bath, label: 'Bathrooms', value: listing.bathrooms },
                  { icon: Square, label: 'Sq Ft', value: listing.sqft },
                  { icon: Calendar, label: 'Year Built', value: listing.year_built ?? null },
                ].filter(s => s.value);
                return stats.length > 0 ? (
                  <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {stats.map(({ icon: Icon, label, value }) => (
                      <div key={label} className="rounded-xl border border-border p-4 text-center">
                        <Icon className="mx-auto mb-2 h-5 w-5 text-gold" />
                        <div className="font-heading text-heading font-bold text-primary">{typeof value === 'number' ? value.toLocaleString() : value}</div>
                        <div className="text-caption text-foreground-muted">{label}</div>
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}

              {/* Description */}
              {listing.description && (
                <div className="mb-8">
                  <h2 className="mb-4 font-heading text-heading-lg font-semibold text-primary">
                    {listing.property_type === 'commercial' ? 'About This Property' : 'About This Home'}
                  </h2>
                  <p className="text-body text-foreground-muted leading-relaxed">{listing.description}</p>
                </div>
              )}

              {/* Property Details */}
              <div>
                <h2 className="mb-4 font-heading text-heading-lg font-semibold text-primary">Property Details</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: 'MLS #', value: listing.mls_number },
                    { label: 'Property Type', value: listing.property_type },
                    { label: 'Lot Size', value: listing.lot_size },
                    { label: 'Garage', value: listing.garage_spaces ? `${listing.garage_spaces} car` : null },
                    { label: 'HOA', value: listing.hoa_fee ? `$${listing.hoa_fee}/mo` : null },
                    { label: 'Subdivision', value: listing.subdivision_name },
                    { label: 'Listed', value: listing.listing_date ? new Date(listing.listing_date).toLocaleDateString() : null },
                    { label: 'Agent', value: listing.list_agent_name },
                    { label: 'Office', value: listing.list_office_name },
                  ].filter(d => d.value).map(({ label, value }) => (
                    <div key={label} className="rounded-lg bg-background-cream p-4">
                      <div className="text-caption text-foreground-muted">{label}</div>
                      <div className="mt-1 text-body-sm font-semibold text-primary">{value as string}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Neighborhood Guide CTA */}
              <div className="mt-8 rounded-xl border border-gold/30 bg-gold/5 p-5">
                <p className="text-body-sm text-foreground-muted">
                  <MapPin className="mr-1 inline h-3.5 w-3.5 text-gold" />
                  This home is located in{' '}
                  <Link
                    href={`/neighborhoods/${citySlug}`}
                    className="font-semibold text-primary hover:text-gold transition-colors"
                  >
                    {listing.city}
                  </Link>
                  {' '}— explore schools, lifestyle, and more homes in the area.
                </p>
                <Link
                  href={`/neighborhoods/${citySlug}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-body-sm font-semibold text-gold hover:underline"
                >
                  View the {listing.city} neighborhood guide →
                </Link>
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
                <ListingContactForm listingTitle={listing.title} />
                <MortgageCalculator listingPrice={listing.price} />
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
      {/* ── More Homes in [Area] ───────────────────────────────────────── */}
      {area && nearbyListings.length > 0 && (
        <section className="bg-background-cream border-t border-border py-12">
          <Container>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-caption uppercase tracking-widest text-foreground-muted mb-1">More Homes</p>
                <h2 className="font-heading text-heading-lg font-bold text-primary">
                  More in {area.display}
                </h2>
              </div>
              <Link
                href={`/listings?city=${encodeURIComponent(area.label)}`}
                className="hidden sm:inline-flex items-center gap-1.5 text-body-sm font-semibold text-gold hover:underline"
              >
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Horizontal scroll strip */}
            <div className="flex gap-5 overflow-x-auto pb-4 -mx-4 px-4 snap-x snap-mandatory scroll-smooth"
                 style={{ scrollbarWidth: 'none' }}>
              {nearbyListings.map(nearby => {
                const nearbyImages = (nearby.images as string[] | null) ?? [];
                return (
                  <Link
                    key={nearby.listing_key}
                    href={`/listings/${nearby.slug}`}
                    className="card-luxury group block flex-none w-64 snap-start"
                  >
                    <div className="relative h-44 w-full overflow-hidden rounded-t-xl bg-background-warm">
                      {nearbyImages[0] ? (
                        <Image src={nearbyImages[0]} alt={nearby.title} fill className="object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-foreground-subtle">
                          <Home className="h-10 w-10" />
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <p className="font-heading text-body font-semibold text-primary group-hover:text-gold transition-colors line-clamp-1">{nearby.title}</p>
                      <p className="mt-1 text-body-sm font-bold text-gold">{formatPrice(nearby.price)}</p>
                      <div className="mt-2 flex items-center gap-3 text-caption text-foreground-muted">
                        {nearby.bedrooms > 0 && <span className="flex items-center gap-1"><Bed className="h-3 w-3" />{nearby.bedrooms}</span>}
                        {nearby.bathrooms > 0 && <span className="flex items-center gap-1"><Bath className="h-3 w-3" />{nearby.bathrooms}</span>}
                        {nearby.sqft > 0 && <span className="flex items-center gap-1"><Square className="h-3 w-3" />{nearby.sqft.toLocaleString()} sf</span>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="mt-5 sm:hidden text-center">
              <Link
                href={`/listings?city=${encodeURIComponent(area.label)}`}
                className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-gold hover:underline"
              >
                View all homes in {area.display} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Container>
        </section>
      )}

      <Footer />
    </>
  );
}
