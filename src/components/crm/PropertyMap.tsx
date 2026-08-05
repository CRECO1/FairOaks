'use client';

import React, { useEffect, useRef } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface MapProperty {
  id: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  asset_type?: string;
  latitude?: number | null;
  longitude?: number | null;
  [k: string]: unknown;
}

export default function PropertyMap({
  properties,
  onSelect,
}: {
  properties: MapProperty[];
  onSelect: (p: MapProperty) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !elRef.current) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const pts = properties.filter(
        p => typeof p.latitude === 'number' && typeof p.longitude === 'number'
          && Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
      );

      const map = L.map(elRef.current, { scrollWheelZoom: true }).setView([29.55, -98.5], 9);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map);

      const markers: Marker[] = [];
      for (const p of pts) {
        const icon = L.divIcon({
          className: '',
          html: '<div style="width:16px;height:16px;border-radius:50% 50% 50% 0;background:#c9922c;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45);transform:rotate(-45deg)"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 16],
        });
        const m = L.marker([p.latitude as number, p.longitude as number], { icon }).addTo(map);
        const label = [p.name || p.address, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
        m.bindTooltip(label, { direction: 'top', offset: [0, -14] });
        m.on('click', () => onSelect(p));
        markers.push(m);
      }
      if (markers.length) {
        map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
      }
      // tiles sometimes need a nudge after layout settles
      setTimeout(() => { if (!cancelled) map.invalidateSize(); }, 200);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [properties, onSelect]);

  return <div ref={elRef} style={{ height: 560, width: '100%', borderRadius: 12, border: '1px solid #eef0f2', overflow: 'hidden', zIndex: 0 }} />;
}
