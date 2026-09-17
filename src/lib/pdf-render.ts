// Shared PDF→images renderer for every surface that shows a document (the signing
// page, the review modal, the field editor). It rasterizes off the main thread in a
// worker (OffscreenCanvas + convertToBlob) so a big/multi-page PDF never freezes the
// UI, and falls back to main-thread rendering when the worker can't run (older Safari,
// a construction failure, etc.) so rendering never simply breaks.
//
// Pages are delivered progressively via `onPage` (page 1 shows while the rest render),
// and the render scale is matched to the display so a phone doesn't rasterize a canvas
// several times larger than it can show.

export interface RenderedPage { w: number; h: number; src: string }

interface Opts {
  /** Rasterize width in device pixels. Defaults to the display width × DPR, capped. */
  targetWidth?: number;
  quality?: number;
  /** Called as each page finishes, so the caller can paint page 1 immediately. */
  onPage?: (page: RenderedPage, index: number, total: number) => void;
  signal?: AbortSignal;
}

// Enough to look crisp on the actual display, capped so a phone doesn't rasterize a
// 1600px+ canvas it can never show. `cssWidth` is the width the doc is displayed at.
export function targetWidthFor(cssWidth?: number): number {
  const dpr = Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 2);
  const css = cssWidth && cssWidth > 0
    ? cssWidth
    : (typeof window !== 'undefined' ? Math.min(window.innerWidth, 1000) : 900);
  return Math.round(Math.min(Math.max(css * dpr, 620), 1400));
}

let worker: Worker | null = null;
let workerBroken = false;
let reqSeq = 0;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    workerBroken = true;
    return null;
  }
  if (!worker) {
    try {
      worker = new Worker(new URL('./pdf-render.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

function killWorker() {
  try { worker?.terminate(); } catch { /* ignore */ }
  worker = null;
  workerBroken = true; // don't keep retrying a broken worker this session
}

// DocError: the document itself is the problem (encrypted / corrupt), or the worker
// failed mid-stream after already emitting pages. The main thread would fail the same
// way, or re-rendering would duplicate the pages already shown — so surface it, don't
// fall back. FallbackError: the worker couldn't render THIS doc (pdf.js in a worker can
// trip over features that need `document`, which a worker lacks) but nothing was emitted
// yet — the main thread can do it, so fall back cleanly.
class DocError extends Error {}
class FallbackError extends Error {}
// pdf.js exception names where the main thread fails identically — no point retrying.
const DOC_FATAL = new Set(['PasswordException', 'InvalidPDFException', 'MissingPDFException', 'UnexpectedResponseException']);

function renderViaWorker(w: Worker, bytes: ArrayBuffer, targetWidth: number, quality: number, opts: Opts): Promise<RenderedPage[]> {
  return new Promise((resolve, reject) => {
    const id = ++reqSeq;
    const pages: RenderedPage[] = [];
    let settled = false;
    let timer = 0;
    // Idle timeout: give up only if the worker goes quiet for 45s. A big doc that keeps
    // streaming pages keeps resetting it, so slow-but-progressing never trips it. A stuck
    // worker is broken infra → kill it and fall back.
    const arm = () => { clearTimeout(timer); timer = window.setTimeout(() => finish(() => { killWorker(); reject(new FallbackError('render timeout')); }), 45_000); };
    const finish = (fn: () => void) => { if (settled) return; settled = true; w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); clearTimeout(timer); opts.signal?.removeEventListener('abort', onAbort); fn(); };
    const onErr = () => finish(() => { killWorker(); reject(new FallbackError('worker crashed')); }); // broken worker → fall back + don't reuse
    const onAbort = () => finish(() => reject(new DocError('aborted')));               // user navigated away → don't retry
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || d.id !== id) return;
      if (d.error) {
        // Propagate a genuine document error, or any failure that struck after pages were
        // already emitted (falling back would re-emit them as duplicates). Otherwise the
        // worker just can't do this doc — fall back to the main thread, keep the worker.
        const propagate = DOC_FATAL.has(d.name) || pages.length > 0;
        const e = propagate ? new DocError(d.error) : new FallbackError(d.error);
        e.name = d.name || 'Error';
        return finish(() => reject(e));
      }
      if (d.done) return finish(() => resolve(pages));
      if (d.blob) {
        arm(); // progress — reset the idle clock
        const p: RenderedPage = { w: d.w, h: d.h, src: URL.createObjectURL(d.blob as Blob) };
        pages.push(p);
        opts.onPage?.(p, d.page, d.total);
      }
    };
    arm();
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    opts.signal?.addEventListener('abort', onAbort);
    // Clone (no transfer) so the buffer survives for a main-thread fallback.
    w.postMessage({ id, bytes, targetWidth, quality });
  });
}

async function renderOnMainThread(bytes: ArrayBuffer, targetWidth: number, quality: number, opts: Opts): Promise<RenderedPage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  // '' unlocks owner-encrypted TAR/gov PDFs; the standard fonts draw non-embedded Helvetica/Times.
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), password: '', standardFontDataUrl: new URL('/pdfjs/standard_fonts/', window.location.origin).href }).promise;
  const out: RenderedPage[] = [];
  // toBlob is on the real <canvas>; don't reference OffscreenCanvas here — it's often
  // missing in exactly the browsers that land on this fallback.
  const canBlob = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.toBlob === 'function';
  for (let i = 1; i <= pdf.numPages; i++) {
    if (opts.signal?.aborted) throw new DocError('aborted');
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.max(0.2, targetWidth / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    // Prefer an async blob URL (encode off the main thread) over the synchronous
    // toDataURL when the browser supports it.
    const src: string = canBlob
      ? await new Promise<string>((res) => canvas.toBlob(b => res(b ? URL.createObjectURL(b) : canvas.toDataURL('image/jpeg', quality)), 'image/jpeg', quality))
      : canvas.toDataURL('image/jpeg', quality);
    const p: RenderedPage = { w: canvas.width, h: canvas.height, src };
    out.push(p);
    opts.onPage?.(p, i, pdf.numPages);
    // Yield so the UI can breathe between pages.
    await new Promise(r => setTimeout(r, 0));
  }
  return out;
}

export async function renderPdfPages(bytes: ArrayBuffer, opts: Opts = {}): Promise<RenderedPage[]> {
  const targetWidth = opts.targetWidth ?? targetWidthFor();
  const quality = opts.quality ?? 0.82;
  const w = getWorker();
  if (w) {
    try {
      return await renderViaWorker(w, bytes, targetWidth, quality, opts);
    } catch (e) {
      // Only a FallbackError falls through to the main thread (the worker couldn't do
      // this doc, but nothing was emitted). A DocError — encrypted/corrupt PDF, an abort,
      // or a mid-stream failure — would fail identically or duplicate pages, so surface it.
      if (!(e instanceof FallbackError)) throw e;
    }
  }
  return renderOnMainThread(bytes, targetWidth, quality, opts);
}

// Free the object URLs a render produced once the images are no longer shown.
export function revokePages(pages: RenderedPage[] | { src: string }[]) {
  for (const p of pages) { if (p?.src?.startsWith('blob:')) { try { URL.revokeObjectURL(p.src); } catch { /* ignore */ } } }
}
