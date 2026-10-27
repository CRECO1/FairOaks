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

// Pin colours follow the type chips, so a glance at the map reads like the list.
const TYPE_COLORS: Record<string, string> = {
  Retail: '#d97706', Office: '#2563eb', Industrial: '#64748b', Land: '#16a34a',
  Multifamily: '#9333ea', 'Mixed-Use': '#db2777', Medical: '#0891b2', Flex: '#ea580c',
};
const DEFAULT_PIN = '#c9922c';
const pinColor = (t?: string) => TYPE_COLORS[t ?? ''] ?? DEFAULT_PIN;

export default function PropertyMap({
  properties,
  onSelect,
  starred,
}: {
  properties: MapProperty[];
  onSelect: (p: MapProperty) => void;
  /** Ids on the agent's shortlist — drawn larger with a dark ring so they stand out. */
  starred?: ReadonlySet<string>;
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
  const starredRef = useRef(starred);
  starredRef.current = starred;

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
      const isStar = !!starredRef.current?.has(p.id);
      const m = L.circleMarker([p.latitude as number, p.longitude as number], {
        radius: isStar ? 9 : 6, color: isStar ? '#111827' : '#fff', weight: isStar ? 2.5 : 1.5, fillColor: pinColor(p.asset_type), fillOpacity: 0.95,
      });
      const label = [p.name || p.address, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
      if (label) m.bindTooltip(label, { direction: 'top', offset: [0, -6] });
      m.on('click', () => onSelectRef.current(p));
      m.addTo(layer);
      markers.push(m);
      if (isStar) m.bringToFront();
    }
    if (markers.length) {
      // Fit to where most of the pins are. A few far-away listings (another state) used to drag the
      // opening view out to the whole country; they are still on the map — pan or zoom out to find them.
      // The outer 3% of pins on each side are ignored for the opening view when there are plenty.
      let bounds = L.featureGroup(markers).getBounds();
      if (pts.length >= 25) {
        const q = (arr: number[], f: number) => arr[Math.floor(f * (arr.length - 1))];
        const lats = pts.map(p => p.latitude as number).sort((a, b) => a - b);
        const lngs = pts.map(p => p.longitude as number).sort((a, b) => a - b);
        bounds = L.latLngBounds([q(lats, 0.03), q(lngs, 0.03)], [q(lats, 0.97), q(lngs, 0.97)]);
      }
      map.fitBounds(bounds.pad(0.15), { maxZoom: 15 });
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
    .map(p => `${p.id}:${p.latitude},${p.longitude}:${p.asset_type ?? ''}:${starred?.has(p.id) ? 1 : 0}`)
    .join('|');
  useEffect(() => { replot(); }, [sig, replot]);

  const typesShown = Array.from(new Set(properties.filter(p => Number.isFinite(p.latitude as number) && Number.isFinite(p.longitude as number)).map(p => p.asset_type).filter(Boolean))) as string[];
  return (
    <div>
      <div ref={elRef} style={{ height: 'clamp(340px, 60vh, 560px)', width: '100%', borderRadius: 12, border: '1px solid #eef0f2', overflow: 'hidden', zIndex: 0 }} />
      {typesShown.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10, fontSize: 12, color: 'var(--k-6b7280)', fontFamily: "'DM Sans',sans-serif" }}>
          {typesShown.sort().map(t => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: pinColor(t), display: 'inline-block' }} />{t}
            </span>
          ))}
          {starred && starred.size > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2.5px solid #111827', boxSizing: 'border-box', display: 'inline-block' }} />On your shortlist
            </span>
          )}
        </div>
      )}
    </div>
  );
}
