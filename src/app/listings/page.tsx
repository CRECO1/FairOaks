'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Search, SlidersHorizontal, Bed, Bath, Square, MapPin, Home, X } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Input } from '@/components/ui/Input';
import { formatPrice } from '@/lib/utils';
import type { Listing } from '@/lib/supabase';

const DEMO_LISTINGS: Listing[] = [
  { id: '1', title: '124 Saddlebrook Drive', slug: '124-saddlebrook-drive', price: 725000, address: '124 Saddlebrook Drive', city: 'Fair Oaks Ranch', state: 'TX', zip: '78015', bedrooms: 4, bathrooms: 3, sqft: 2850, lot_size: '0.42 ac', year_built: 2019, property_type: 'single-family', status: 'active', description: null, features: ['Pool', 'Hill Country Views', '3-Car Garage'], images: null, virtual_tour_url: null, mls_number: '1234567', listing_date: '2026-03-15', created_at: '', updated_at: '' },
  { id: '2', title: '3318 Hill Country Blvd', slug: '3318-hill-country-blvd', price: 595000, address: '3318 Hill Country Blvd', city: 'Fair Oaks Ranch', state: 'TX', zip: '78015', bedrooms: 3, bathrooms: 2.5, sqft: 2200, lot_size: '0.28 ac', year_built: 2016, property_type: 'single-family', status: 'active', description: null, features: ['Fireplace', 'Updated Kitchen', 'Corner Lot'], images: null, virtual_tour_url: null, mls_number: '1234568', listing_date: '2026-03-20', created_at: '', updated_at: '' },
  { id: '3', title: '7820 Cibolo Creek Court', slug: '7820-cibolo-creek-court', price: 949000, address: '7820 Cibolo Creek Court', city: 'Boerne', state: 'TX', zip: '78006', bedrooms: 5, bathrooms: 4, sqft: 3900, lot_size: '1.1 ac', year_built: 2021, property_type: 'single-family', status: 'active', description: null, features: ['Acreage', 'Guest Suite', 'Chef\'s Kitchen'], images: null, virtual_tour_url: null, mls_number: '1234569', listing_date: '2026-02-28', created_at: '', updated_at: '' },
  { id: '4', title: '9102 River Trail Lane', slug: '9102-river-trail-lane', price: 425000, address: '9102 River Trail Lane', city: 'Helotes', state: 'TX', zip: '78023', bedrooms: 3, bathrooms: 2, sqft: 1850, lot_size: '0.22 ac', year_built: 2012, property_type: 'single-family', status: 'active', description: null, features: ['Backs to Greenbelt', 'Open Floor Plan'], images: null, virtual_tour_url: null, mls_number: '1234570', listing_date: '2026-04-01', created_at: '', updated_at: '' },
  { id: '5', title: '512 Oak Meadow Crossing', slug: '512-oak-meadow-crossing', price: 649000, address: '512 Oak Meadow Crossing', city: 'Boerne', state: 'TX', zip: '78006', bedrooms: 4, bathrooms: 3.5, sqft: 3100, lot_size: '0.5 ac', year_built: 2018, property_type: 'single-family', status: 'active', description: null, features: ['Outdoor Kitchen', 'Pool', 'Three Living Areas'], images: null, virtual_tour_url: null, mls_number: '1234571', listing_date: '2026-03-10', created_at: '', updated_at: '' },
  { id: '6', title: '215 Vintage Oaks Drive', slug: '215-vintage-oaks-drive', price: 1150000, address: '215 Vintage Oaks Drive', city: 'Fair Oaks Ranch', state: 'TX', zip: '78015', bedrooms: 5, bathrooms: 5, sqft: 5200, lot_size: '2.3 ac', year_built: 2020, property_type: 'single-family', status: 'active', description: null, features: ['Resort Pool', 'Home Theater', 'Guest Casita'], images: null, virtual_tour_url: null, mls_number: '1234572', listing_date: '2026-01-15', created_at: '', updated_at: '' },
];

const CITIES = ['All Areas', 'Fair Oaks Ranch', 'Boerne', 'Helotes', 'Leon Springs'];
const PRICE_RANGES = [
  { label: 'Any Price', min: 0, max: Infinity },
  { label: 'Under $400K', min: 0, max: 400000 },
  { label: '$400K – $600K', min: 400000, max: 600000 },
  { label: '$600K – $900K', min: 600000, max: 900000 },
  { label: '$900K – $1.2M', min: 900000, max: 1200000 },
  { label: '$1.2M+', min: 1200000, max: Infinity },
];

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>(DEMO_LISTINGS);
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('All Areas');
  const [priceRange, setPriceRange] = useState(0);
  const [minBeds, setMinBeds] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    fetch('/api/listings').then(r => r.json()).then(d => {
      if (d.listings?.length) setListings(d.listings);
    }).catch(() => {});
  }, []);

  const filtered = listings.filter(l => {
    const range = PRICE_RANGES[priceRange];
    const matchSearch = !search || l.title.toLowerCase().includes(search.toLowerCase()) || l.address.toLowerCase().includes(search.toLowerCase());
    const matchCity = city === 'All Areas' || l.city === city;
    const matchPrice = l.price >= range.min && l.price <= range.max;
    const matchBeds = minBeds === 0 || l.bedrooms >= minBeds;
    return matchSearch && matchCity && matchPrice && matchBeds;
  });

  const hasFilters = city !== 'All Areas' || priceRange !== 0 || minBeds !== 0 || search !== '';

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">
        {/* Page Header */}
        <div className="bg-primary py-10 sm:py-14 text-white">
          <Container>
            <p className="overline mb-2 text-gold">Available Now</p>
            <h1 className="font-heading text-display-sm font-bold">Homes for Sale</h1>
            <p className="mt-2 text-body text-white/60">
              {listings.length} active listings in Fair Oaks Ranch and surrounding areas
            </p>
          </Container>
        </div>

        {/* Search & Filters */}
        <div className="sticky top-20 z-30 border-b border-border bg-white shadow-sm">
          <Container>
            <div className="flex flex-wrap items-center gap-3 py-4">
              <div className="relative w-full sm:flex-1 sm:min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
                <Input
                  placeholder="Search address or neighborhood…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <select
                value={city}
                onChange={e => setCity(e.target.value)}
                className="h-11 w-full sm:w-auto rounded-lg border border-border px-3 text-body-sm text-primary"
              >
                {CITIES.map(c => <option key={c}>{c}</option>)}
              </select>

              <button
                onClick={() => setFiltersOpen(v => !v)}
                className="flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-body-sm text-primary hover:border-gold transition-colors"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {hasFilters && <span className="h-2 w-2 rounded-full bg-gold" />}
              </button>

              {hasFilters && (
                <button
                  onClick={() => { setSearch(''); setCity('All Areas'); setPriceRange(0); setMinBeds(0); }}
                  className="flex items-center gap-1 text-caption text-foreground-muted hover:text-primary transition-colors"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              )}
            </div>

            {filtersOpen && (
              <div className="pb-4 flex flex-wrap gap-6 border-t border-border pt-4">
                <div>
                  <p className="label-readable">Price Range</p>
                  <div className="flex flex-wrap gap-2">
                    {PRICE_RANGES.map((r, i) => (
                      <button
                        key={r.label}
                        onClick={() => setPriceRange(i)}
                        className={`rounded-full border px-4 py-1.5 text-caption transition-colors ${priceRange === i ? 'border-gold bg-gold text-primary' : 'border-border text-foreground-muted hover:border-gold'}`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="label-readable">Min Bedrooms</p>
                  <div className="flex gap-2">
                    {[0, 2, 3, 4, 5].map(b => (
                      <button
                        key={b}
                        onClick={() => setMinBeds(b)}
                        className={`rounded-full border px-4 py-1.5 text-caption transition-colors ${minBeds === b ? 'border-gold bg-gold text-primary' : 'border-border text-foreground-muted hover:border-gold'}`}
                      >
                        {b === 0 ? 'Any' : `${b}+`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Container>
        </div>

        {/* Grid */}
        <div className="py-10">
          <Container>
            {filtered.length === 0 ? (
              <div className="py-24 text-center">
                <Home className="mx-auto mb-4 h-12 w-12 text-foreground-subtle" />
                <h2 className="font-heading text-heading font-semibold text-primary">No listings found</h2>
                <p className="mt-2 text-body text-foreground-muted">Try adjusting your filters.</p>
              </div>
            ) : (
              <>
                <p className="mb-6 text-body-sm text-foreground-muted">
                  Showing {filtered.length} {filtered.length === 1 ? 'property' : 'properties'}
                </p>
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map(listing => (
                    <Link key={listing.id} href={`/listings/${listing.slug}`} className="card-luxury group block">
                      <div className="image-luxury aspect-property bg-background-warm">
                        {listing.images && (listing.images as string[])[0] ? (
                          <Image src={(listing.images as string[])[0]} alt={listing.title} fill className="object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-foreground-subtle">
                            <Home className="h-10 w-10" />
                          </div>
                        )}
                        <div className="absolute top-4 left-4">
                          <span className="rounded-full bg-gold px-3 py-1 text-caption font-semibold text-primary uppercase">
                            {listing.status}
                          </span>
                        </div>
                      </div>
                      <div className="p-6">
                        <p className="mb-1 text-caption text-foreground-muted">
                          <MapPin className="mr-1 inline h-3 w-3" />
                          {listing.city}, TX · MLS# {listing.mls_number}
                        </p>
                        <h3 className="mb-2 font-heading text-heading-sm font-semibold text-primary group-hover:text-gold transition-colors line-clamp-1">
                          {listing.title}
                        </h3>
                        <p className="mb-4 price-tag text-2xl">{formatPrice(listing.price)}</p>
                        <div className="flex items-center gap-4 text-caption text-foreground-muted border-t border-border pt-4">
                          <span className="flex items-center gap-1.5"><Bed className="h-4 w-4" />{listing.bedrooms} bd</span>
                          <span className="flex items-center gap-1.5"><Bath className="h-4 w-4" />{listing.bathrooms} ba</span>
                          <span className="flex items-center gap-1.5"><Square className="h-4 w-4" />{listing.sqft.toLocaleString()} sf</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Container>
        </div>
      </main>
      <Footer />
    </>
  );
}
