'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bed, Bath, Square, X } from 'lucide-react';
import { formatPrice } from '@/lib/utils';

interface MapListing {
  listing_key: string;
  slug: string;
  title: string;
  price: number;
  city: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  address: string;
  images: string[] | null;
  latitude: number | null;
  longitude: number | null;
}

interface Props {
  listings: MapListing[];
  center?: { lat: number; lng: number };
}

const GEOCODE_CACHE = new Map<string, { lat: number; lng: number }>();

async function geocodeAddress(address: string, city: string): Promise<{ lat: number; lng: number } | null> {
  const key = `${address}, ${city}, TX`;
  if (GEOCODE_CACHE.has(key)) return GEOCODE_CACHE.get(key)!;
  try {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const q = encodeURIComponent(key);
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${apiKey}`);
    const data = await res.json();
    if (data.results?.[0]) {
      const loc = data.results[0].geometry.location;
      GEOCODE_CACHE.set(key, loc);
      return loc;
    }
  } catch { /* silent */ }
  return null;
}

export function ListingsMap({ listings, center = { lat: 29.7385, lng: -98.6327 } }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const [selected, setSelected] = useState<MapListing | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load Google Maps script once
  useEffect(() => {
    if (window.google?.maps) { setLoaded(true); return; }
    const existing = document.getElementById('gmap-script');
    if (existing) { existing.addEventListener('load', () => setLoaded(true)); return; }
    const script = document.createElement('script');
    script.id = 'gmap-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=marker&v=beta`;
    script.async = true;
    script.onload = () => setLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Init map
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    if (googleMapRef.current) return;
    googleMapRef.current = new google.maps.Map(mapRef.current, {
      center,
      zoom: 11,
      mapId: 'fair-oaks-listings',
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: true,
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    });
  }, [loaded, center]);

  // Place markers
  useEffect(() => {
    if (!loaded || !googleMapRef.current) return;

    // Clear old markers
    markersRef.current.forEach(m => { m.map = null; });
    markersRef.current = [];

    async function placeMarkers() {
      for (const listing of listings) {
        let coords: { lat: number; lng: number } | null = null;

        if (listing.latitude && listing.longitude) {
          coords = { lat: listing.latitude, lng: listing.longitude };
        } else {
          coords = await geocodeAddress(listing.address, listing.city);
        }

        if (!coords || !googleMapRef.current) continue;

        // Price pin element
        const pin = document.createElement('div');
        pin.className = 'map-price-pin';
        pin.innerHTML = `<span>${formatPrice(listing.price).replace('$', '$').replace(',000', 'k')}</span>`;
        pin.style.cssText = `
          background: #1a1a2e; color: #fff; padding: 5px 10px;
          border-radius: 20px; font-size: 12px; font-weight: 700;
          cursor: pointer; white-space: nowrap; border: 2px solid #c9922c;
          box-shadow: 0 2px 8px rgba(0,0,0,.3); transition: all .15s;
          font-family: 'DM Sans', sans-serif;
        `;
        pin.onmouseenter = () => { pin.style.background = '#c9922c'; pin.style.transform = 'scale(1.08)'; };
        pin.onmouseleave = () => { pin.style.background = '#1a1a2e'; pin.style.transform = 'scale(1)'; };

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map: googleMapRef.current,
          position: coords,
          content: pin,
          title: listing.title,
        });

        marker.addListener('click', () => setSelected(listing));
        markersRef.current.push(marker);
      }
    }

    placeMarkers();
  }, [loaded, listings]);

  return (
    <div className="relative w-full h-full">
      {/* Map container */}
      <div ref={mapRef} className="w-full h-full rounded-xl overflow-hidden" />

      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background-cream rounded-xl">
          <div className="text-center">
            <div className="h-8 w-8 border-2 border-gold border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-body-sm text-foreground-muted">Loading map…</p>
          </div>
        </div>
      )}

      {/* Listing popup on pin click */}
      {selected && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-72 bg-white rounded-2xl shadow-2xl overflow-hidden z-10 border border-border">
          <button
            onClick={() => setSelected(null)}
            className="absolute top-2 right-2 z-10 bg-white/80 rounded-full p-1 hover:bg-white"
          >
            <X className="h-4 w-4 text-foreground-muted" />
          </button>
          {selected.images?.[0] && (
            <div className="relative h-36 w-full">
              <img src={selected.images[0]} alt={selected.title} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="p-4">
            <p className="font-heading text-body font-semibold text-primary line-clamp-1">{selected.title}</p>
            <p className="text-body-sm text-foreground-muted mb-2">{selected.city}, TX</p>
            <p className="font-bold text-gold text-body mb-3">{formatPrice(selected.price)}</p>
            <div className="flex items-center gap-3 text-caption text-foreground-muted mb-4">
              {selected.bedrooms > 0 && <span className="flex items-center gap-1"><Bed className="h-3 w-3" />{selected.bedrooms} bd</span>}
              {selected.bathrooms > 0 && <span className="flex items-center gap-1"><Bath className="h-3 w-3" />{selected.bathrooms} ba</span>}
              {selected.sqft > 0 && <span className="flex items-center gap-1"><Square className="h-3 w-3" />{selected.sqft.toLocaleString()} sf</span>}
            </div>
            <Link
              href={`/listings/${selected.slug}`}
              className="block w-full text-center bg-primary text-white rounded-lg py-2 text-body-sm font-semibold hover:bg-gold transition-colors"
            >
              View Details
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
