'use client';

import React, { useEffect, useRef, useState } from 'react';

// Renders a PDF's pages to <canvas> inline. Canvas avoids the frame-src/object-src
// CSP that blocks iframing external PDFs. The PDF is fetched from its signed URL
// (connect-src allows *.supabase.co) and pdf.js runs off a self-hosted worker
// (worker-src 'self').
export default function PdfViewer({ url, onReady }: { url: string; onReady?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';
        const targetW = Math.min(container.clientWidth || 820, 900);
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = targetW / base.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.cssText = 'display:block;width:100%;max-width:' + targetW + 'px;margin:0 auto 18px;box-shadow:0 1px 8px rgba(0,0,0,.16);border-radius:4px;background:#fff';
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (cancelled) return;
          container.appendChild(canvas);
        }
        setStatus('ready');
        onReady?.();
      } catch (e) {
        if (!cancelled) { console.error('[PdfViewer]', e); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  return (
    <div>
      {status === 'loading' && <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af' }}>Rendering pages…</div>}
      {status === 'error' && <div style={{ padding: 50, textAlign: 'center', color: '#ef4444' }}>Couldn’t render this PDF. Try Download instead.</div>}
      <div ref={containerRef} />
    </div>
  );
}
