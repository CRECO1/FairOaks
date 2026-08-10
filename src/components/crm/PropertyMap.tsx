'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import type { Map as LeafletMap, CircleMarker, LayerGroup } from 'leaflet';
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
  const layerRef = useRef<LayerGroup | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const LRef = useRef<typeof import('leaflet') | null>(null);
  // Latest onSelect / properties held in refs so the map never re-inits when the
  // parent re-renders (the inline onSelect changing identity was the glitch).
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const propsRef = useRef(properties);
  propsRef.current = properties;

  // Redraw markers into the existing layer from the latest props. Reads only refs,
  // so it never tears down the map.
  const replot = useCallback(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const pts = propsRef.current.filter(
      p => typeof p.latitude === 'number' && typeof p.longitude === 'number'
        && Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
    );
    const markers: CircleMarker[] = [];
    for (const p of pts) {
      // Canvas-rendered circle markers stay smooth with well over a thousand points
      // (DOM divIcons do not).
      const m = L.circleMarker([p.latitude as number, p.longitude as number], {
        radius: 6, color: '#fff', weight: 1.5, fillColor: '#c9922c', fillOpacity: 0.95,
      });
      const label = [p.name || p.address, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
      if (label) m.bindTooltip(label, { direction: 'top', offset: [0, -6] });
      m.on('click', () => onSelectRef.current(p));
      m.addTo(layer);
      markers.push(m);
    }
    if (markers.length) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2), { maxZoom: 15 });
    }
  }, []);

  // Init the map exactly once (empty-ish deps: replot is stable).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      LRef.current = L;
      const el = elRef.current;
      if (!el || mapRef.current) return;
      const map = L.map(el, { scrollWheelZoom: true, preferCanvas: true }).setView([29.55, -98.5], 9);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      // The container is inside a conditional/flex region, so its final size may
      // arrive after init — re-measure a couple of times and on resize so tiles
      // fill the whole map instead of loading only a corner.
      const nudge = () => { if (!cancelled && mapRef.current) mapRef.current.invalidateSize(); };
      setTimeout(() => { nudge(); replot(); }, 120);
      setTimeout(nudge, 500);
      const ro = new ResizeObserver(() => { if (!cancelled && mapRef.current) mapRef.current.invalidateSize(); });
      ro.observe(el);
      roRef.current = ro;
      replot();
    })();

    return () => {
      cancelled = true;
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      layerRef.current = null;
    };
  }, [replot]);

  // Re-plot only when the actual point set changes — NOT on every parent render.
  const sig = properties
    .filter(p => Number.isFinite(p.latitude as number) && Number.isFinite(p.longitude as number))
    .map(p => `${p.id}:${p.latitude},${p.longitude}`)
    .join('|');
  useEffect(() => { replot(); }, [sig, replot]);

  return <div ref={elRef} style={{ height: 'clamp(340px, 60vh, 560px)', width: '100%', borderRadius: 12, border: '1px solid #eef0f2', overflow: 'hidden', zIndex: 0 }} />;
}
