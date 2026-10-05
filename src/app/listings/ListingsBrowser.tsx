'use client';

// The interactive half of /listings: search, filters, pagination and the map. The
// page itself (page.tsx) is a server component that renders the H1, the intro and
// the first page of MLS listings into the initial HTML, then hands that page to this
// component as its starting state — so crawlers see real listing links and people
// see listings immediately instead of a skeleton.

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Search, SlidersHorizontal, Bed, Bath, Square, MapPin, Home, X, ChevronLeft, ChevronRight, List, Map } from 'lucide-react';
import { ListingsMap } from '@/components/sections/ListingsMap';
import { Container } from '@/components/ui/Container';
import { Input } from '@/components/ui/Input';
import { formatPrice } from '@/lib/utils';
import type { Listing } from '@/lib/supabase';
import { trackViewItemList, trackSearch, trackSelectItem } from '@/lib/analytics';
import { SaveSearchButton } from '@/components/sections/SaveSearchModal';
import { FORG } from '@/lib/site-identity';
import { COMMUNITIES, DISTRICTS, LUXURY_MIN_PRICE, newConstructionMinYear } from '@/lib/listing-filters';

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
const MORE_AREAS = ['San Antonio', 'Helotes', 'Bulverde', 'Spring Branch', 'Canyon Lake', 'New Braunfels', 'Kerrville', 'Fredericksburg'];

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

type PriceRange = { min: number; max: number };
const ANY_PRICE: PriceRange = { min: 0, max: Infinity };

/** A preset's label, or one built for a range that arrived in a link (e.g. $500K – $750K). */
function priceLabel(p: PriceRange): string {
  const preset = PRICE_RANGES.find(r => r.min === p.min && r.max === p.max);
  if (preset) return preset.label;
  const k = (n: number) => n >= 1_000_000 ? `$${+(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
  if (p.max === Infinity) return `${k(p.min)}+`;
  if (p.min === 0) return `Under ${k(p.max)}`;
  return `${k(p.min)} – ${k(p.max)}`;
}

/** Everything the search sends to /api/listings. */
interface Filters {
  search: string;
  city: string;
  price: PriceRange;
  minBeds: number;
  minBaths: number;
  status: string;
  community: string;
  district: string;
  newConstruction: boolean;
}

function filterParams(f: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.search)                            params.set('search',    f.search);
  if (f.city && f.city !== 'All Areas')    params.set('city',      f.city);
  if (f.community)                         params.set('community', f.community);
  if (f.district)                          params.set('district',  f.district);
  if (f.newConstruction)                   params.set('newConstruction', '1');
  if (f.price.min > 0)                     params.set('minPrice',  String(f.price.min));
  if (f.price.max < Infinity)              params.set('maxPrice',  String(f.price.max));
  if (f.minBeds > 0)                       params.set('minBeds',   String(f.minBeds));
  if (f.minBaths > 0)                      params.set('minBaths',  String(f.minBaths));
  if (f.status)                            params.set('status',    f.status);
  return params;
}

/**
 * Filters carried in the page URL by links across the site — area, neighborhood and
 * school pages, price-band pages, the footer. Unknown values are ignored rather than
 * guessed at. Returns null when the URL carries none.
 */
function filtersFromUrl(search: string): Partial<Filters> & { note?: string } | null {
  const q = new URLSearchParams(search);
  const out: Partial<Filters> & { note?: string } = {};
  const allAreas = [...FEATURED_AREAS, ...MORE_AREAS];

  const city = q.get('city');
  if (city && allAreas.includes(city)) out.city = city;

  const community = COMMUNITIES[q.get('community') ?? ''];
  if (community) {
    if (community.filter) out.community = q.get('community')!;
    else if (community.fallbackCity) {
      out.city = community.fallbackCity;
      out.note = `The MLS doesn't list homes under "${community.label}", so these are all homes for sale in ${community.fallbackCity}.`;
    }
  }

  const district = q.get('district') ?? '';
  if (DISTRICTS[district]) out.district = district;

  if (q.get('type') === 'new-construction') out.newConstruction = true;

  const min = Number(q.get('minPrice'));
  const max = Number(q.get('maxPrice'));
  if (q.get('price') === 'luxury') out.price = { min: LUXURY_MIN_PRICE, max: Infinity };
  else if ((min > 0 && Number.isFinite(min)) || (max > 0 && Number.isFinite(max))) {
    out.price = { min: min > 0 && Number.isFinite(min) ? min : 0, max: max > 0 && Number.isFinite(max) ? max : Infinity };
  }

  const beds = Number(q.get('minBeds'));
  if (Number.isInteger(beds) && beds > 0 && beds <= 5) out.minBeds = beds;

  const status = q.get('status') ?? '';
  if (STATUS_OPTIONS.some(o => o.value === status && status)) out.status = status;

  return Object.keys(out).length ? out : null;
}

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

interface Props {
  /** First page of the unfiltered search, rendered on the server. Null if the feed was unreachable. */
  initialListings: Listing[] | null;
  initialTotal: number | null;
  initialTotalPages: number;
}

export function ListingsBrowser({ initialListings, initialTotal, initialTotalPages }: Props) {
  const hasInitial = !!initialListings && initialListings.length > 0;

  const [listings, setListings]     = useState<Listing[]>(initialListings ?? []);
  // A failed fetch is not "no homes match": say so, and offer a person instead.
  const [loadFailed, setLoadFailed] = useState(false);
  const [total, setTotal]           = useState<number | null>(hasInitial ? initialTotal : null);
  const [totalPages, setTotalPages] = useState(hasInitial ? initialTotalPages : 1);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(!hasInitial);

  // The server already rendered page 1 of the unfiltered search, so the mount-time
  // fetches would only re-request it. Each effect skips its first run when it has
  // that data; any filter or page change after that fetches as before.
  const skipFirstFilterFetch = useRef(hasInitial);
  const skipFirstPageFetch   = useRef(hasInitial);

  const [search,     setSearch]     = useState('');
  const [city,       setCity]       = useState('All Areas');
  const [price,      setPrice]      = useState<PriceRange>(ANY_PRICE);
  const [minBeds,    setMinBeds]    = useState(0);
  const [minBaths,   setMinBaths]   = useState(0);
  const [status,     setStatus]     = useState('');
  const [community,  setCommunity]  = useState('');
  const [district,   setDistrict]   = useState('');
  const [newConstruction, setNewConstruction] = useState(false);
  // Why the results differ from what the link promised, when they must (see filtersFromUrl).
  const [urlNote,    setUrlNote]    = useState<string | null>(null);
  const [viewMode,   setViewMode]   = useState<'list' | 'map'>('list');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Apply filters carried in the URL (?city=, ?community=, ?district=, price bands…).
  // Read after mount rather than via useSearchParams, which would force the whole page
  // to render client-side only and drop the listings from the server HTML. The server
  // HTML is the unfiltered first page, so show the skeleton until the filtered fetch
  // lands instead of flashing the wrong homes and count.
  useEffect(() => {
    const f = filtersFromUrl(window.location.search);
    if (!f) return;
    setLoading(true);
    if (f.city)            setCity(f.city);
    if (f.price)           setPrice(f.price);
    if (f.minBeds)         setMinBeds(f.minBeds);
    if (f.status)          setStatus(f.status);
    if (f.community)       setCommunity(f.community);
    if (f.district)        setDistrict(f.district);
    if (f.newConstruction) setNewConstruction(true);
    if (f.note)            setUrlNote(f.note);
  }, []);

  // Map-specific state: large batch loaded once when entering map view
  const [mapListings, setMapListings] = useState<Listing[]>([]);
  const [mapLoading,  setMapLoading]  = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filters: Filters = { search, city, price, minBeds, minBaths, status, community, district, newConstruction };
  // The filters object is rebuilt every render; effects key on its serialized form.
  const filtersKey = filterParams(filters).toString();

  const fetchListings = useCallback((f: Filters, pageVal: number) => {
    setLoading(true);
    const params = filterParams(f);
    params.set('page',  String(pageVal));
    params.set('limit', String(PAGE_LIMIT));

    fetch(`/api/listings?${params.toString()}`)
      .then(r => { if (!r.ok) throw new Error(`listings ${r.status}`); return r.json(); })
      .then(d => {
        setListings(d.listings ?? []);
        setTotal(d.total ?? 0);
        setTotalPages(d.totalPages ?? 1);
        setLoadFailed(false);
        setLoading(false);
      })
      .catch(() => {
        setListings([]);
        setTotal(0);
        setTotalPages(1);
        setLoadFailed(true);
        setLoading(false);
      });
  }, []);

  const fetchMapListings = useCallback((f: Filters) => {
    setMapLoading(true);
    const params = filterParams(f);
    params.set('mapMode', '1');
    fetch(`/api/listings?${params.toString()}`)
      .then(r => r.json())
      .then(d => { setMapListings(d.listings ?? []); setMapLoading(false); })
      .catch(() => { setMapLoading(false); });
  }, []);

  // Load map listings when entering map view or when filters change in map mode
  useEffect(() => {
    if (viewMode !== 'map') return;
    fetchMapListings(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, filtersKey, fetchMapListings]);

  // Debounced fetch when filters change — reset to page 1
  useEffect(() => {
    if (skipFirstFilterFetch.current) { skipFirstFilterFetch.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchListings(filters, 1);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, fetchListings]);

  // Fetch immediately when page changes (no debounce needed)
  useEffect(() => {
    if (skipFirstPageFetch.current) { skipFirstPageFetch.current = false; return; }
    fetchListings(filters, page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const hasPrice = price.min !== 0 || price.max !== Infinity;
  const hasFilters = city !== 'All Areas' || hasPrice || minBeds !== 0 || minBaths !== 0 || status !== ''
    || search !== '' || community !== '' || district !== '' || newConstruction;

  // Count of non-search active filters for the badge
  const activeFilterCount = [
    city !== 'All Areas',
    hasPrice,
    minBeds !== 0,
    minBaths !== 0,
    status !== '',
    community !== '',
    district !== '',
    newConstruction,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setSearch('');
    setCity('All Areas');
    setPrice(ANY_PRICE);
    setMinBeds(0);
    setMinBaths(0);
    setStatus('');
    setCommunity('');
    setDistrict('');
    setNewConstruction(false);
    setUrlNote(null);
  };

  const pageList = buildPageList(page, totalPages);

  return (
    <>
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
                onChange={e => { setCity(e.target.value); setUrlNote(null); trackViewItemList({ list_name: 'Search Results', city: e.target.value }); }}
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
                    {PRICE_RANGES.map(r => (
                      <button
                        key={r.label}
                        onClick={() => { setPrice({ min: r.min, max: r.max }); trackViewItemList({ list_name: 'Search Results', city, price_min: r.min > 0 ? r.min : undefined, price_max: r.max < Infinity ? r.max : undefined }); }}
                        className={`rounded-full border px-4 py-1.5 text-caption transition-colors ${price.min === r.min && price.max === r.max ? 'border-gold bg-gold text-primary' : 'border-border text-foreground-muted hover:border-gold'}`}
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
                    <button onClick={() => { setCity('All Areas'); setUrlNote(null); }} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove city filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {community && COMMUNITIES[community] && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    <Home className="h-3 w-3" />{COMMUNITIES[community].label}
                    <button onClick={() => setCommunity('')} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove neighborhood filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {district && DISTRICTS[district] && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    {DISTRICTS[district].label}
                    <button onClick={() => setDistrict('')} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove school district filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {newConstruction && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    New construction (built {newConstructionMinYear()}+)
                    <button onClick={() => setNewConstruction(false)} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove new construction filter"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {hasPrice && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-caption font-medium text-primary">
                    {priceLabel(price)}
                    <button onClick={() => setPrice(ANY_PRICE)} className="ml-0.5 hover:text-gold transition-colors" aria-label="Remove price filter"><X className="h-3 w-3" /></button>
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

            {urlNote && (
              <p className="mb-4 rounded-lg border border-border bg-background-cream px-4 py-3 text-body-sm text-foreground-muted">{urlNote}</p>
            )}

            {/* Listing alerts CTA — always visible, pre-filled with current filters */}
            <div className="mb-6 flex items-center justify-between rounded-xl border border-gold/30 bg-gold/5 px-5 py-3.5">
              <div>
                <p className="text-body-sm font-semibold text-primary">Don&apos;t miss a new listing</p>
                <p className="text-caption text-foreground-muted">Get emailed the moment a home matching your search hits the market.</p>
              </div>
              <SaveSearchButton
                cities={city === 'All Areas' ? ['All Areas'] : [city]}
                minPrice={price.min > 0 ? price.min : undefined}
                maxPrice={price.max < Infinity ? price.max : undefined}
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
                <h2 className="font-heading text-heading font-semibold text-primary">
                  {loadFailed ? 'We couldn’t load listings just now' : 'No listings found'}
                </h2>
                <p className="mt-2 text-body text-foreground-muted">
                  {loadFailed
                    ? 'Please try again in a moment — or let one of our agents search the MLS for you.'
                    : 'Try adjusting your filters or broadening your search.'}
                </p>
                {hasFilters && !loadFailed && (
                  <button onClick={clearFilters} className="mt-4 text-body-sm text-gold hover:underline">
                    Clear all filters
                  </button>
                )}
                {/* Never a dead end: a person can always take it from here. */}
                <p className="mt-6 text-body-sm text-foreground-muted">
                  <Link href="/contact?topic=home-search" className="font-semibold text-gold hover:underline">Have an agent search for you</Link>
                  {' '}or call/text <a href={`tel:${FORG.telephone}`} className="font-semibold text-primary hover:underline">{FORG.phoneDisplay}</a>
                </p>
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
                      <Link key={listing.listing_key ?? listing.slug} href={`/listings/${listing.slug}`} className="card-luxury group block" onClick={() => trackSelectItem({ id: listing.listing_key ?? listing.slug, name: listing.title, price: listing.price, list_name: 'Search Results' })}>
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
                              {/* Days on market is computed from "now", which moves between the cached server render and the browser. */}
                              <span suppressHydrationWarning className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold backdrop-blur-sm bg-black/40 ${db.cls}`}>
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

    </>
  );
}
