'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { X, ChevronLeft, ChevronRight, Home, Grid2X2 } from 'lucide-react';

interface Props {
  images: string[];
  title: string;
}

export function ListingGallery({ images, title }: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const openAt = (i: number) => { setActiveIndex(i); setLightboxOpen(true); };
  const close = () => setLightboxOpen(false);

  const prev = useCallback(() => setActiveIndex(i => (i - 1 + images.length) % images.length), [images.length]);
  const next = useCallback(() => setActiveIndex(i => (i + 1) % images.length), [images.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  prev();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'Escape')     close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxOpen, prev, next]);

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    document.body.style.overflow = lightboxOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [lightboxOpen]);

  const hasImages = images.length > 0;

  return (
    <>
      {/* ── Grid Preview ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4 md:grid-rows-2 h-[320px] md:h-[480px]">

        {/* Main image — spans 2 cols + 2 rows */}
        <div
          className="relative md:col-span-2 md:row-span-2 rounded-xl overflow-hidden bg-background-cream cursor-pointer group"
          onClick={() => openAt(0)}
        >
          {hasImages ? (
            <Image src={images[0]} alt={title} fill className="object-cover group-hover:scale-105 transition-transform duration-300" priority />
          ) : (
            <div className="flex h-full items-center justify-center text-foreground-subtle"><Home className="h-20 w-20" /></div>
          )}
        </div>

        {/* Side thumbnails — 4 slots */}
        {[1, 2, 3, 4].map(i => (
          <div
            key={i}
            className="relative rounded-xl overflow-hidden bg-background-cream cursor-pointer group hidden md:block"
            onClick={() => openAt(i)}
          >
            {images[i] ? (
              <Image src={images[i]} alt={`${title} — photo ${i + 1}`} fill className="object-cover group-hover:scale-105 transition-transform duration-300" />
            ) : (
              <div className="flex h-full items-center justify-center text-foreground-subtle"><Home className="h-8 w-8" /></div>
            )}
            {/* "View all" overlay on last visible thumbnail */}
            {i === 4 && images.length > 5 && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white"
                onClick={e => { e.stopPropagation(); openAt(4); }}
              >
                <Grid2X2 className="h-6 w-6 mb-1" />
                <span className="text-body-sm font-semibold">+{images.length - 4} photos</span>
              </div>
            )}
          </div>
        ))}

        {/* Mobile: "View all photos" button */}
        {images.length > 1 && (
          <button
            onClick={() => openAt(0)}
            className="md:hidden absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-full bg-white/90 backdrop-blur-sm border border-border px-4 py-2 text-body-sm font-semibold text-primary shadow-md"
          >
            <Grid2X2 className="h-4 w-4" />
            {images.length} photos
          </button>
        )}
      </div>

      {/* View all photos button (desktop) */}
      {images.length > 5 && (
        <button
          onClick={() => openAt(0)}
          className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-body-sm font-semibold text-primary hover:border-gold hover:text-gold transition-colors shadow-sm"
        >
          <Grid2X2 className="h-4 w-4" />
          View all {images.length} photos
        </button>
      )}

      {/* ── Lightbox ─────────────────────────────────────────────────────── */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={close}>

          {/* Top bar */}
          <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <span className="text-white/70 text-body-sm font-medium">
              {activeIndex + 1} / {images.length}
            </span>
            <p className="text-white font-heading text-body font-semibold line-clamp-1 hidden sm:block">{title}</p>
            <button
              onClick={close}
              className="flex items-center justify-center h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <X className="h-5 w-5 text-white" />
            </button>
          </div>

          {/* Main image */}
          <div className="relative flex-1 flex items-center justify-center px-16" onClick={e => e.stopPropagation()}>
            <div className="relative w-full h-full max-w-5xl max-h-full">
              <Image
                src={images[activeIndex]}
                alt={`${title} — photo ${activeIndex + 1}`}
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 80vw"
                priority
              />
            </div>

            {/* Prev button */}
            <button
              onClick={prev}
              className="absolute left-3 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/25 transition-colors"
            >
              <ChevronLeft className="h-6 w-6 text-white" />
            </button>

            {/* Next button */}
            <button
              onClick={next}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/25 transition-colors"
            >
              <ChevronRight className="h-6 w-6 text-white" />
            </button>
          </div>

          {/* Thumbnail strip */}
          <div className="flex-shrink-0 px-4 py-4 overflow-x-auto" onClick={e => e.stopPropagation()}>
            <div className="flex gap-2 justify-center min-w-max mx-auto">
              {images.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setActiveIndex(i)}
                  className={`relative h-16 w-24 flex-none rounded-lg overflow-hidden border-2 transition-all ${
                    i === activeIndex ? 'border-gold scale-105' : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <Image src={src} alt={`Thumbnail ${i + 1}`} fill className="object-cover" sizes="96px" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
