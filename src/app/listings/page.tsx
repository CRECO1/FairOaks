'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Search, SlidersHorizontal, Bed, Bath, Square, MapPin, Home, X, ChevronLeft, ChevronRight, List, Map } from 'lucide-react';
import { ListingsMap } from '@/components/sections/ListingsMap';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';
import { Input } from '@/components/ui/Input';
import { formatPrice } from '@/lib/utils';
import type { Listing } from '@/lib/supabase';
import { trackViewItemList, trackSearch, trackSelectItem } from '@/lib/analytics';
import { SaveSearchButton } from '@/components/sections/SaveSearchModal';

/** Compute days on market from a listing date string. */
function calcDaysOnMarket(listingDate: string | null | undefined): number | null {
  if (!listingDate) return null;
  const listed = new Date(listingDate);
  if (isNaN(listed.getTime())) return null;
  return Math.floor((Date.now() - listed.getTime()) / 86_400_000);
}

/** Status badge config */
function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'active':  return { label: 'Active',          cls: 'bg-green-500 text-white' };
    case 'pending': return { label: 'Under Contract',  cls: 'bg-amber-500 text-white' };
    case 'sold':    return { label: 'Closed',          cls: 'bg-gray-500 text-white'  };
    default:        return { label: 'Coming Soon',     cls: 'bg-blue-500 text-white'  };
  }
}

/** DOM badge config */
function domBadge(days: number | null): { label: string; cls: string } | null {
  if (days === null) return null;
  if (days <= 7)  return { label: 'Just Listed', cls: 'bg-green-500 text-white' };
  if (days <= 14) return { label: `${days} days`, cls: 'bg-green-500 text-white' };
  if (days <= 45) return { label: `${days} days`, cls: 'bg-amber-500 text-white' };
  return { label: `${days} days`, cls: 'bg-gray-500 text-white' };
}

const FEATURED_AREAS = ['Fair Oaks Ranch', 'Boerne', 'Dominion', 'Cordillera Ranch'];
const MORE_AREAS = ['San Antonio', 'Helotes', 'Bulverde', 'New Braunfels', 'Kerrville', 'Fredericksburg'];

const STATUS_OPTIONS = [
  { label: 'Any Status',     value: '' },
  { label: 'Active',         value: 'active' },
  { label: 'Under Contract', value: 'under_contract' },
  { label: 'Coming Soon',    value: 'coming_soon' },
];

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
  const [minBaths,   setMinBaths]   = useState(0);
  const [status,     setStatus]     = useState('');
  const [viewMode,   setViewMode]   = useState<'list' | 'map'>('list');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Map-specific state: large batch loaded once when entering map view
  const [mapListings, setMapListings] = useState<Listing[]>([]);
  const [mapLoading,  setMapLoading]  = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchListings = useCallback((
    searchVal: string,
    cityVal: string,
    priceIdx: number,
    minBedsVal: number,
    pageVal: number,
    minBathsVal: number,
    statusVal: string,
  ) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchVal)                          params.set('search',   searchVal);
    if (cityVal && cityVal !== 'All Areas') params.set('city',     cityVal);
    const range = PRICE_RANGES[priceIdx];
    if (range.min > 0)          params.set('minPrice', String(range.min));
    if (range.max < Infinity)   params.set('maxPrice', String(range.max));
    if (minBedsVal > 0)         params.set('minBeds',  String(minBedsVal));
    if (minBathsVal > 0)        params.set('minBaths', String(minBathsVal));
    if (statusVal)              params.set('status',   statusVal);
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
    cityVal: string,
    priceIdx: number,
    minBedsVal: number,
    searchVal: string,
    minBathsVal: number,
    statusVal: string,
  ) => {
    setMapLoading(true);
    const params = new URLSearchParams();
    params.set('mapMode', '1');
    if (searchVal)                          params.set('search',   searchVal);
    if (cityVal && cityVal !== 'All Areas') params.set('city',     cityVal);
    const range = PRICE_RANGES[priceIdx];
    if (range.min > 0)        params.set('minPrice', String(range.min));
    if (range.max < Infinity) params.set('maxPrice', String(range.max));
    if (minBedsVal > 0)       params.set('minBeds',  String(minBedsVal));
    if (minBathsVal > 0)      params.set('minBaths', String(minBathsVal));
    if (statusVal)            params.set('status',   statusVal);
    fetch(`/api/listings?${params.toString()}`)
      .then(r => r.json())
      .then(d => { setMapListings(d.listings ?? []); setMapLoading(false); })
      .catch(() => { setMapLoading(false); });
  }, []);

  // Load map listings when entering map view or when filters change in map mode
  useEffect(() => {
    if (viewMode !== 'map') return;
    fetchMapListings(city, priceRange, minBeds, search, minBaths, status);
  }, [viewMode, city, priceRange, minBeds, search, minBaths, status, fetchMapListings]);

  // Debounced fetch when filters change — reset to page 1
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchListings(search, city, priceRange, minBeds, 1, minBaths, status);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, city, priceRange, minBeds, minBaths, status, fetchListings]);

  // Fetch immediately when page changes (no debounce needed)
  useEffect(() => {
    fetchListings(search, city, priceRange, minBeds, page, minBaths, status);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const hasFilters = city !== 'All Areas' || priceRange !== 0 || minBeds !== 0 || minBaths !== 0 || status !== '' || search !== '';

  // Count of non-search active filters for the badge
  const activeFilterCount = [
    city !== 'All Areas',
    priceRange !== 0,
    minBeds !== 0,
    minBaths !== 0,
    status !== '',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setSearch('');
    setCity('All Areas');
    setPriceRange(0);
    setMinBeds(0);
    setMinBaths(0);
    setStatus('');
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
            <h1 className="font-heading text-display-sm font-bold">MLS Listings — Fair Oaks Ranch, Boerne &amp; Texas Hill Country</h1>
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
                  onChange={e => { setSearch(e.target.value); trackSearch({ term: e.target.value, city, beds: minBeds > 0 ? String(minBeds) : undefined }); }}
                  className="pl-9"
                />
              </div>

              <select
                value={city}
                onChange={e => { setCity(e.target.value); trackViewItemList({ list_name: 'Search Results', city: e.target.value }); }}
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
                className={`flex h-11 items-center gap-2 rounded-lg border px-4 text-body-sm font-semibold transition-colors ${filtersOpen || activeFilterCount > 0 ? 'border-gold bg-gold/10 text-primary' : 'border-border text-primary hover:border-gold'}`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
              </button>

              {hasFilters && (
                <button
                  onClick={clearFilters}
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
                        onClick={() => { setPriceRange(i); trackViewItemList({ list_name: 'Search Results', city, price_min: r.min > 0 ? r.min : undefined, price_max: r.max < Infinity ? r.max : undefined }); }}
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
                    {[0, 1, 2, 3, 4, 5].map(b => (
                      <button
                        key={b}
                        onClick={() => { setMinBeds(b); trackViewItemList({ list_name: 'Search Results', city, beds: b > 0 ? String(b) : undefined }); }}
                        className={`rounded-full border px-4 py-1.5 text-caption transition-colors ${minBeds === b ? 'border-gold bg-gold text-primary' : 'border-border text-foreground-muted hover:border-gold'}`}
                      >
                        {b === 0 ? 'Any' : `${b}+`}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="label-readable">Min Bathrooms</p>
                  <div className="flex gap-2">
                    {[0, 1, 2, 3].map(b => (
                      <button
                        key={b}
                        onClick={() => setMinBaths(b)}
                        className={`rounded-full border px-4 py-1.5 text-caption transition-colors ${minBaths === b ? 'border-gold bg-gold text-primary' : 'border-border text-foreground-muted hover:border-gold'}`}
                      >
                        {b === 0 ? 'Any' : `${b}+`}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="label-readable">Status</p>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setStatus(opt.value)}
                        className={`rounded-full border px-4 py-1.5 text-caption transition-colors ${status === opt.value ? 'border-gold bg-gold text-primary' : 'border-border text-foreground-muted hover:border-gold'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Active filter chips */}
            {hasFilters && (
              <div className="flex flex-wrap gap-2 pb-3">
                {search && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    &ldquo;{search}&rdquo;
                    <button onClick={() => setSearch('')} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove search filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {city !== 'All Areas' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    <MapPin className="h-3 w-3" />{city}
                    <button onClick={() => setCity('All Areas')} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove city filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {priceRange !== 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    {PRICE_RANGES[priceRange].label}
                    <button onClick={() => setPriceRange(0)} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove price filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {minBeds !== 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    <Bed className="h-3 w-3" />{minBeds}+ beds
                    <button onClick={() => setMinBeds(0)} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove beds filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {minBaths !== 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    <Bath className="h-3 w-3" />{minBaths}+ baths
                    <button onClick={() => setMinBaths(0)} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove baths filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {status !== '' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    {STATUS_OPTIONS.find(o => o.value === status)?.label ?? status}
                    <button onClick={() => setStatus('')} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove status filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
              </div>
            )}
          </Container>
        </div>

        {/* Results */}
        <div className="py-10">
          <Container>

            {/* Result count + List/Map toggle */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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

            {/* Listing alerts CTA — always visible, pre-filled with current filters */}
            <div className="mb-6 flex items-center justify-between rounded-xl border border-gold/30 bg-gold/5 px-5 py-3.5">
              <div>
                <p className="text-body-sm font-semibold text-primary">Don&apos;t miss a new listing</p>
                <p className="text-caption text-foreground-muted">Get emailed the moment a home matching your search hits the market.</p>
              </div>
              <SaveSearchButton
                cities={city === 'All Areas' ? ['All Areas'] : [city]}
                minPrice={PRICE_RANGES[priceRange].min > 0 ? PRICE_RANGES[priceRange].min : undefined}
                maxPrice={PRICE_RANGES[priceRange].max < Infinity ? PRICE_RANGES[priceRange].max : undefined}
                minBeds={minBeds > 0 ? minBeds : undefined}
                minBaths={minBaths > 0 ? minBaths : undefined}
                search={search || undefined}
              />
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

            {/* Map view — loads 200 listings for current filters, Google Maps handles viewport */}
            {viewMode === 'map' && (
              <div className="h-[50vh] sm:h-[60vh] md:h-[70vh] w-full rounded-xl overflow-hidden border border-border shadow-card">
                <ListingsMap
                  listings={mapListings.map((l: any) => ({
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
                    const listingImages = Array.isArray(listing.images) ? listing.images as string[] : [];
                    const firstImage = listingImages[0] ?? null;
                    const dom = calcDaysOnMarket(listing.listing_date);
                    const sb  = statusBadge(listing.status);
                    const db  = domBadge(dom);

                    return (
                      <Link key={listing.id} href={`/listings/${listing.slug}`} className="card-luxury group block" onClick={() => trackSelectItem({ id: listing.id, name: listing.title, price: listing.price, list_name: 'Search Results' })}>
                        <div className="image-luxury aspect-property bg-background-warm">
                          {firstImage ? (
                            <Image
                              src={firstImage}
                              alt={listing.title}
                              fill
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-foreground-subtle">
                              <Home className="h-10 w-10" />
                            </div>
                          )}
                          {/* Status badge — top-left */}
                          <div className="absolute top-2 left-2">
                            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur-sm bg-black/40 ${sb.cls}`}>
                              {sb.label}
                            </span>
                          </div>
                          {/* Days on market badge — top-right */}
                          {db && (
                            <div className="absolute top-2 right-2">
                              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold backdrop-blur-sm bg-black/40 ${db.cls}`}>
                                {db.label}
                              </span>
                            </div>
                          )}
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
