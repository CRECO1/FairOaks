/// <reference lib="webworker" />
// Off-main-thread PDF rasterizer. Renders each page to an OffscreenCanvas and encodes
// it to a JPEG blob — both the paint and the encode happen HERE, in the worker, so a
// big or multi-page document never freezes the page's UI thread. Pages are posted back
// one at a time so the first one can show while the rest are still rendering.
//
// pdf.js parses in its own nested worker where the browser allows it; if not, it parses
// inline in this worker — either way it's off the main thread. `src/lib/pdf-render.ts`
// falls back to main-thread rendering if this worker can't be created or crashes.
import * as pdfjs from 'pdfjs-dist';

try {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('/pdf.worker.min.mjs', self.location.origin).href;
} catch {
  /* pdf.js will parse inline in this worker */
}

interface Req { id: number; bytes: ArrayBuffer; targetWidth: number; quality: number }

self.onmessage = async (e: MessageEvent<Req>) => {
  const post = (m: Record<string, unknown>) => (self as unknown as Worker).postMessage(m);
  const { id, bytes, targetWidth, quality } = e.data || ({} as Req);
  try {
    // Most TAR/TREC forms don't embed Helvetica/Times; pdf.js draws them from these files.
    // A worker can't fall back to system fonts, so without them every label renders as □.
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), password: '', standardFontDataUrl: new URL('/pdfjs/standard_fonts/', self.location.origin).href }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(0.2, targetWidth / base.width);
      const vp = page.getViewport({ scale });
      const w = Math.max(1, Math.floor(vp.width));
      const h = Math.max(1, Math.floor(vp.height));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      post({ id, page: i, total: pdf.numPages, w, h, blob });
      page.cleanup();
    }
    post({ id, done: true });
  } catch (err) {
    post({ id, error: (err as Error)?.message || String(err), name: (err as Error)?.name || 'Error' });
  }
};
