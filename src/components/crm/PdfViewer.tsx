'use client';

import React, { useEffect, useRef, useState } from 'react';
import { renderPdfPages, revokePages, type RenderedPage } from '@/lib/pdf-render';

// Renders a PDF's pages to <img> inline (rasterized off the main thread so a big
// document doesn't freeze the CRM). Image tags avoid the frame-src/object-src CSP
// that blocks iframing external PDFs. The PDF is fetched from its signed URL
// (connect-src allows *.supabase.co) and pdf.js runs off a self-hosted worker
// (worker-src 'self').
export default function PdfViewer({ url, onReady }: { url: string; onReady?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const ac = new AbortController();
    const collected: RenderedPage[] = [];
    (async () => {
      try {
        setStatus('loading');
        const resp = await fetch(url, { signal: ac.signal });
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (ac.signal.aborted) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';
        const targetW = Math.min(container.clientWidth || 820, 900);
        // Rasterize at 2× the display width, off the main thread, so pages stay sharp on
        // retina AND when PRINTED — an <img> prints at its own bitmap resolution, same as
        // the canvas it replaced — without a big doc locking up the UI. High JPEG quality
        // keeps print crisp. Pages append as they render (page 1 shows immediately).
        await renderPdfPages(data, {
          targetWidth: targetW * 2, quality: 0.92, signal: ac.signal,
          onPage: (p) => {
            collected.push(p);
            const c = containerRef.current;
            if (ac.signal.aborted || !c) return;
            const img = document.createElement('img');
            img.src = p.src;
            img.style.cssText = 'display:block;width:100%;max-width:' + targetW + 'px;margin:0 auto 18px;box-shadow:0 1px 8px rgba(0,0,0,.16);border-radius:4px;background:#fff';
            c.appendChild(img);
          },
        });
        if (ac.signal.aborted) return;
        setStatus('ready');
        onReady?.();
      } catch (e) {
        if (ac.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
        console.error('[PdfViewer]', e); setStatus('error');
      }
    })();
    return () => { ac.abort(); revokePages(collected); };
  }, [url]);

  return (
    <div>
      {status === 'loading' && <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af' }}>Rendering pages…</div>}
      {status === 'error' && <div style={{ padding: 50, textAlign: 'center', color: '#ef4444' }}>Couldn’t render this PDF. Try Download instead.</div>}
      <div ref={containerRef} />
    </div>
  );
}
