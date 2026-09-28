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
  // Set when pages rendered but the run still ended in an error (a partial document): we
  // show what we have plus a quiet note, never a hard "couldn't render" over real content.
  const [partial, setPartial] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    let collected: RenderedPage[] = [];
    setPartial(false);
    const targetWof = () => Math.min(containerRef.current?.clientWidth || 820, 900);
    const appendPage = (p: RenderedPage) => {
      const c = containerRef.current;
      if (ac.signal.aborted || !c) return;
      const img = document.createElement('img');
      img.src = p.src;
      img.style.cssText = 'display:block;width:100%;max-width:' + targetWof() + 'px;margin:0 auto 18px;box-shadow:0 1px 8px rgba(0,0,0,.16);border-radius:4px;background:#fff';
      c.appendChild(img);
    };
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
        const targetW = targetWof();
        // Rasterize at 2× the display width, off the main thread, so pages stay sharp on
        // retina AND when PRINTED — an <img> prints at its own bitmap resolution, same as
        // the canvas it replaced — without a big doc locking up the UI. High JPEG quality
        // keeps print crisp. Pages append as they render (page 1 shows immediately).
        await renderPdfPages(data, {
          targetWidth: targetW * 2, quality: 0.92, signal: ac.signal,
          // The renderer is restarting on the main thread — drop the worker's partial
          // pages (from the DOM and from `collected`) so they aren't duplicated.
          onReset: () => {
            revokePages(collected); collected = [];
            const c = containerRef.current; if (c) c.innerHTML = '';
          },
          onPage: (p) => { collected.push(p); appendPage(p); },
        });
        if (ac.signal.aborted) return;
        setStatus('ready');
        onReady?.();
      } catch (e) {
        if (ac.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
        console.error('[PdfViewer]', e);
        // If pages actually painted, keep them on screen — a red "couldn't render" over a
        // visible document is worse than a quiet "some pages may be missing" note.
        if (collected.length > 0) { setStatus('ready'); setPartial(true); onReady?.(); }
        else setStatus('error');
      }
    })();
    return () => { ac.abort(); revokePages(collected); };
  }, [url]);

  return (
    <div>
      {status === 'loading' && <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af' }}>Rendering pages…</div>}
      {status === 'error' && <div style={{ padding: 50, textAlign: 'center', color: '#ef4444' }}>Couldn’t render this PDF. Try Download instead.</div>}
      <div ref={containerRef} />
      {partial && status === 'ready' && <div style={{ padding: '9px 14px', textAlign: 'center', color: '#9a7b1f', fontSize: 13, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, margin: '2px auto 10px', maxWidth: 560 }}>Some pages couldn’t be displayed. Download for the complete document.</div>}
    </div>
  );
}
