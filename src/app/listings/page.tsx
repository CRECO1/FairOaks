'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Search, SlidersHorizontal, Bed, Bath, Square, MapPin, Home, X, ChevronLeft, ChevronRight, List, Map } from 'lucide-react';
import { ListingsMap } from '@/components/sections/ListingsMap';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Input } from '@/components/ui/Input';
import { formatPrice } from '@/lib/utils';
import type { Listing } from '@/lib/supabase';
import { SaveSearchButton } from '@/components/sections/SaveSearchModal';

const FEATURED_AREAS = ['Fair Oaks Ranch', 'Boerne', 'Dominion', 'Cordillera Ranch'];
const MORE_AREAS = ['San Antonio', 'Helotes', 'Bulverde', 'New Braunfels', 'Kerrville', 'Fredericksburg'];

const PRICE_RANGES = [
  { label: 'Any Price',     min: 0,       max: Infinity },
  { label: 'Under $400K',   min: 0,       max: 400000   },
  { label: '$400K – $600K', min: 400000,  max: 600000   },
  { label: '$600K – $900K', min: 600000,  max: 900000   },
  { label: '$900K – $1.2M', min: 900000,  max: 1200000  },
  { label: '$1.2M+',        min: 1200000, max: Infinity  },
];

const PAGE_LIMIT = 24;

// Build a compact page-number list with ellipsis, max 7 visible buttons
function buildPageList(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '...')[] = [];
  pages.push(1);
  const left  = Math.max(2, current - 2);
  const right = Math.min(total - 1, current + 2);
  if (left > 2)       pages.push('...');
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push('...');
  pages.push(total);
  return pages;
}

// ---- Skeleton card ----
function SkeletonCard() {
  return (
    <div className="card-luxury animate-pulse">
      <div className="image-luxury aspect-property bg-background-warm" />
      <div className="p-6 space-y-3">
        <div className="h-3 w-2/3 rounded bg-background-warm" />
        <div className="h-4 w-4/5 rounded bg-background-warm" />
        <div className="h-6 w-1/2 rounded bg-background-warm" />
        <div className="h-3 w-full rounded bg-background-warm" />
      </div>
    </div>
  );
}

function ListingsPageInner() {
  const searchParams = useSearchParams();

  const [listings, setListings]     = useState<Listing[]>([]);
  const [total, setTotal]           = useState<number | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(true);

  const [search,     setSearch]     = useState('');
  // Pre-populate city from ?city= URL param (e.g. from "View all" on listing detail)
  const [city,       setCity]       = useState(() => {
    const all = ['All Areas', ...FEATURED_AREAS, ...MORE_AREAS];
    const param = searchParams.get('city') ?? 'All Areas';
    return all.includes(param) ? param : 'All Areas';
  });
  const [priceRange, setPriceRange] = useState(0);
  const [minBeds,    setMinBeds]    = useState(0);
  const [viewMode,   setViewMode]   = useState<'list' | 'map'>('list');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Map-specific state: listings fetched by viewport bounds
  const [mapListings,       setMapListings]       = useState<Listing[]>([]);
  const [mapLoading,        setMapLoading]         = useState(false);
  const [hasMapData,        setHasMapData]         = useState(false);
  const mapBoundsRef = useRef<{ latMin: number; latMax: number; lngMin: number; lngMax: number } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchListings = useCallback((
    searchVal: string,
    cityVal: string,
    priceIdx: number,
    minBedsVal: number,
    pageVal: number,
  ) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchVal)                          params.set('search',   searchVal);
    if (cityVal && cityVal !== 'All Areas') params.set('city',     cityVal);
    const range = PRICE_RANGES[priceIdx];
    if (range.min > 0)          params.set('minPrice', String(range.min));
    if (range.max < Infinity)   params.set('maxPrice', String(range.max));
    if (minBedsVal > 0)         params.set('minBeds',  String(minBedsVal));
    params.set('page',  String(pageVal));
    params.set('limit', String(PAGE_LIMIT));

    fetch(`/api/listings?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        setListings(d.listings ?? []);
        setTotal(d.total ?? 0);
        setTotalPages(d.totalPages ?? 1);
        setLoading(false);
      })
      .catch(() => {
        setListings([]);
        setTotal(0);
        setTotalPages(1);
        setLoading(false);
      });
  }, []);

  const fetchMapListings = useCallback((
    bounds: { latMin: number; latMax: number; lngMin: number; lngMax: number },
    priceIdx: number,
    minBedsVal: number,
  ) => {
    setMapLoading(true);
    const params = new URLSearchParams();
    params.set('latMin', String(bounds.latMin));
    params.set('latMax', String(bounds.latMax));
    params.set('lngMin', String(bounds.lngMin));
    params.set('lngMax', String(bounds.lngMax));
    const range = PRICE_RANGES[priceIdx];
    if (range.min > 0)        params.set('minPrice', String(range.min));
    if (range.max < Infinity) params.set('maxPrice', String(range.max));
    if (minBedsVal > 0)       params.set('minBeds',  String(minBedsVal));
    fetch(`/api/listings?${params.toString()}`)
      .then(r => r.json())
      .then(d => { setMapListings(d.listings ?? []); setMapLoading(false); setHasMapData(true); })
      .catch(() => { setMapLoading(false); });
  }, []);

  const handleBoundsChange = useCallback((bounds: { latMin: number; latMax: number; lngMin: number; lngMax: number }) => {
    mapBoundsRef.current = bounds;
    if (mapDebounceRef.current) clearTimeout(mapDebounceRef.current);
    mapDebounceRef.current = setTimeout(() => {
      fetchMapListings(bounds, priceRange, minBeds);
    }, 300);
  }, [fetchMapListings, priceRange, minBeds]);

  // Re-fetch map listings when price/bed filters change while in map mode
  useEffect(() => {
    if (viewMode !== 'map' || !mapBoundsRef.current) return;
    fetchMapListings(mapBoundsRef.current, priceRange, minBeds);
  }, [priceRange, minBeds, viewMode, fetchMapListings]);

  // Debounced fetch when filters change — reset to page 1
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchListings(search, city, priceRange, minBeds, 1);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, city, priceRange, minBeds, fetchListings]);

  // Fetch immediately when page changes (no debounce needed)
  useEffect(() => {
    fetchListings(search, city, priceRange, minBeds, page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const hasFilters = city !== 'All Areas' || priceRange !== 0 || minBeds !== 0 || search !== '';

  const clearFilters = () => {
    setSearch('');
    setCity('All Areas');
    setPriceRange(0);
    setMinBeds(0);
  };

  const pageList = buildPageList(page, totalPages);

  const now = new Date();
  const lastUpdated = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">

        {/* Page Header */}
        <div className="bg-primary py-10 sm:py-14 text-white">
          <Container>
            <p className="overline mb-2 text-gold">SABOR MLS</p>
            <h1 className="font-heading text-display-sm font-bold">Search All MLS Listings</h1>
            <p className="mt-2 text-body text-white/60">Powered by SABOR MLS</p>
          </Container>
        </div>

        {/* Search & Filters */}
        <div className="sticky top-20 z-30 border-b border-border bg-white shadow-sm">
          <Container>
            <div className="flex flex-wrap items-center gap-3 py-4">
              <div className="relative w-full sm:flex-1 sm:min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
                <Input
                  placeholder="Search address, neighborhood, or MLS#…"
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
                <option value="All Areas">All Areas</option>
                <optgroup label="Our Featured Areas">
                  {FEATURED_AREAS.map(c => <option key={c}>{c}</option>)}
                </optgroup>
                <optgroup label="More Areas">
                  {MORE_AREAS.map(c => <option key={c}>{c}</option>)}
                </optgroup>
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
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-caption text-foreground-muted hover:text-primary transition-colors"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              )}

              <div className="ml-auto">
                <SaveSearchButton
                  cities={city === 'All Areas' ? ['All Areas'] : [city]}
                  minPrice={PRICE_RANGES[priceRange].min > 0 ? PRICE_RANGES[priceRange].min : undefined}
                  maxPrice={PRICE_RANGES[priceRange].max < Infinity ? PRICE_RANGES[priceRange].max : undefined}
                  minBeds={minBeds > 0 ? minBeds : undefined}
                />
              </div>
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

        {/* Results */}
        <div className="py-10">
          <Container>

            {/* Result count + List/Map toggle */}
            <div className="mb-6 flex items-center justify-between">
              {!loading && total !== null ? (
                <p className="text-body-sm text-foreground-muted">
                  {total > 0
                    ? `${total.toLocaleString()} ${total === 1 ? 'listing' : 'listings'} in Greater San Antonio`
                    : 'No listings match your search'}
                </p>
              ) : <div />}

              {/* List / Map toggle */}
              <div className="flex items-center rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1.5 px-4 py-2 text-body-sm font-semibold transition-colors ${viewMode === 'list' ? 'bg-primary text-white' : 'bg-white text-foreground-muted hover:bg-background-cream'}`}
                >
                  <List className="h-4 w-4" /> List
                </button>
                <button
                  onClick={() => setViewMode('map')}
                  className={`flex items-center gap-1.5 px-4 py-2 text-body-sm font-semibold transition-colors ${viewMode === 'map' ? 'bg-primary text-white' : 'bg-white text-foreground-muted hover:bg-background-cream'}`}
                >
                  <Map className="h-4 w-4" /> Map
                </button>
              </div>
            </div>

            {/* Loading skeleton */}
            {loading && (
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: PAGE_LIMIT }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loading && listings.length === 0 && (
              <div className="py-24 text-center">
                <Home className="mx-auto mb-4 h-12 w-12 text-foreground-subtle" />
                <h2 className="font-heading text-heading font-semibold text-primary">No listings found</h2>
                <p className="mt-2 text-body text-foreground-muted">Try adjusting your filters or broadening your search.</p>
                {hasFilters && (
                  <button onClick={clearFilters} className="mt-4 text-body-sm text-gold hover:underline">
                    Clear all filters
                  </button>
                )}
              </div>
            )}

            {/* Map view — uses viewport-bounds listings once map fires idle */}
            {viewMode === 'map' && (
              <div className="h-[70vh] w-full rounded-xl overflow-hidden border border-border shadow-card">
                <ListingsMap
                  listings={(hasMapData ? mapListings : listings).map((l: any) => ({
                    listing_key: l.listing_key ?? l.id,
                    slug:        l.slug,
                    title:       l.title,
                    price:       l.price,
                    city:        l.city,
                    bedrooms:    l.bedrooms ?? 0,
                    bathrooms:   l.bathrooms ?? 0,
                    sqft:        l.sqft ?? 0,
                    address:     l.address,
                    images:      l.images as string[] | null,
                    latitude:    l.latitude ?? null,
                    longitude:   l.longitude ?? null,
                  }))}
                  onBoundsChange={handleBoundsChange}
                  mapLoading={mapLoading}
                />
              </div>
            )}

            {/* Listing grid */}
            {!loading && listings.length > 0 && viewMode === 'list' && (
              <>
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                  {listings.map(listing => {
                    const agentParts: string[] = [];
                    if (listing.list_agent_name)  agentParts.push(listing.list_agent_name);
                    if (listing.list_office_name) agentParts.push(listing.list_office_name);
                    const attribution = agentParts.length > 0 ? `Listed by ${agentParts.join(' · ')}` : null;

                    return (
                      <Link key={listing.id} href={`/listings/${listing.slug}`} className="card-luxury group block">
                        <div className="image-luxury aspect-property bg-background-warm">
                          {listing.images && (listing.images as string[])[0] ? (
                            <Image
                              src={(listing.images as string[])[0]}
                              alt={listing.title}
                              fill
                              className="object-cover"
                            />
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
                            {listing.sqft ? (
                              <span className="flex items-center gap-1.5"><Square className="h-4 w-4" />{listing.sqft.toLocaleString()} sf</span>
                            ) : null}
                          </div>
                          {attribution && (
                            <p className="mt-2 text-[10px] leading-tight text-foreground-muted truncate">
                              {attribution}
                            </p>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-12 flex items-center justify-center gap-1 flex-wrap">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-caption text-primary disabled:opacity-40 hover:border-gold transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" /> Prev
                    </button>

                    {pageList.map((p, idx) =>
                      p === '...' ? (
                        <span key={`ellipsis-${idx}`} className="px-2 py-2 text-caption text-foreground-muted select-none">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p as number)}
                          className={`h-9 w-9 rounded-lg border text-caption transition-colors ${page === p ? 'border-gold bg-gold text-primary font-semibold' : 'border-border text-primary hover:border-gold'}`}
                        >
                          {p}
                        </button>
                      ),
                    )}

                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-caption text-primary disabled:opacity-40 hover:border-gold transition-colors"
                    >
                      Next <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </>
            )}

          </Container>
        </div>

        {/* IDX Disclaimer */}
        <div className="border-t border-border bg-background-cream py-6">
          <Container>
            <p className="text-[11px] leading-relaxed text-foreground-muted">
              Information provided is deemed reliable but not guaranteed. Listings courtesy of San Antonio Board of
              REALTORS® MLS. &copy; {now.getFullYear()} SABOR. All rights reserved. Information last updated {lastUpdated}.
              IDX information is provided exclusively for consumers&apos; personal, non-commercial use and may not be used for
              any purpose other than to identify prospective properties consumers may be interested in purchasing.
            </p>
          </Container>
        </div>

      </main>
      <Footer />
    </>
  );
}

export default function ListingsPage() {
  return (
    <Suspense fallback={null}>
      <ListingsPageInner />
    </Suspense>
  );
}
