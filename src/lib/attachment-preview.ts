// Helpers for the composer's attachment preview: one shape for "a file about to be sent" (from the agent's computer OR
// attached from the CRM), cached first-page thumbnails, and a guess at "this is another version of that file".

import { renderPdfPages, revokePages, targetWidthFor, type RenderedPage } from '@/lib/pdf-render';

export interface PreviewItem {
  key: string;
  name: string;
  size: number | null;
  mime: string;
  /** Where it comes from, in the agent's words ("Property flyer · 123 Main", "From your computer"…). */
  source: string;
  /** When the file was last changed/added (ISO or ms), so look-alike versions can be told apart. */
  date?: string | number | null;
  file?: File;
  ref?: { kind: string; id: string };
}

const isPdf = (m: string, n: string) => /pdf/i.test(m) || /\.pdf$/i.test(n);
const isImage = (m: string, n: string) => /^image\/(png|jpe?g|gif|webp)$/i.test(m) || /\.(png|jpe?g|gif|webp)$/i.test(n);
export type PreviewKind = 'pdf' | 'image' | 'sheet' | 'doc' | 'other';
export const previewKind = (i: Pick<PreviewItem, 'mime' | 'name'>): PreviewKind =>
  isPdf(i.mime, i.name) ? 'pdf' : isImage(i.mime, i.name) ? 'image'
  : /\.(xlsx|xls|csv|ods)$/i.test(i.name) ? 'sheet' : /\.docx$/i.test(i.name) ? 'doc' : 'other';

// Bytes cache (last few) so opening the big view doesn't download a flyer a second time.
const bytesCache = new Map<string, Promise<ArrayBuffer>>();
export function loadBytes(item: PreviewItem): Promise<ArrayBuffer> {
  const hit = bytesCache.get(item.key);
  if (hit) return hit;
  const p: Promise<ArrayBuffer> = item.file
    ? item.file.arrayBuffer()
    : fetch(`/api/crm/attachment-preview?kind=${encodeURIComponent(item.ref!.kind)}&id=${encodeURIComponent(item.ref!.id)}`).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Couldn’t load (${r.status})`);
        return r.arrayBuffer();
      });
  bytesCache.set(item.key, p);
  p.catch(() => bytesCache.delete(item.key));
  while (bytesCache.size > 8) bytesCache.delete(bytesCache.keys().next().value as string);
  return p;
}

// First-page thumbnails, cached by key (a CRM flyer's key never changes for the life of the composer).
const thumbCache = new Map<string, Promise<Thumb | null>>();
export type Thumb = { src: string; pages: number | null; grid?: string[][] };
export function loadThumb(item: PreviewItem): Promise<Thumb | null> {
  const hit = thumbCache.get(item.key);
  if (hit) return hit;
  const kind = previewKind(item);
  const p = (async () => {
    if (kind === 'other' || kind === 'doc') return null;
    const bytes = await loadBytes(item);
    if (kind === 'sheet') {
      // A peek at the top-left of the first sheet, drawn as a mini table.
      const XLSX = await import('xlsx');
      const wb = XLSX.read(bytes.slice(0), { type: 'array', sheetRows: 8 });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false }) as unknown[][];
      return { src: '', pages: null, grid: rows.slice(0, 7).map(r => Array.from({ length: 4 }, (_, c) => String(r[c] ?? '').slice(0, 14))) };
    }
    if (kind === 'image') return { src: URL.createObjectURL(new Blob([bytes], { type: item.mime || 'image/png' })), pages: 1 };
    let first: RenderedPage | null = null, total: number | null = null;
    const ac = new AbortController();
    try {
      await renderPdfPages(bytes.slice(0), { targetWidth: targetWidthFor(260), quality: 0.8, signal: ac.signal, onPage: (pg, _i, n) => { if (!first) { first = pg; total = n; ac.abort(); } } });
    } catch { /* aborted on purpose once page 1 is in, or the PDF couldn't be drawn */ }
    return first ? { src: (first as RenderedPage).src, pages: total } : null;
  })();
  thumbCache.set(item.key, p);
  p.catch(() => thumbCache.delete(item.key));
  while (thumbCache.size > 40) {
    const k = thumbCache.keys().next().value as string;
    thumbCache.get(k)?.then(t => t && revokePages([t])).catch(() => {});
    thumbCache.delete(k);
  }
  return p;
}

/** "Elkhorn Point — Flyer v3 (final) 2026-11-02.pdf" → "elkhorn point flyer" so versions of the same file group together. */
export function versionStem(name: string): string {
  return name.toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/\b(20\d{2})[-_. ]?(0[1-9]|1[0-2])[-_. ]?([0-3]\d)\b/g, ' ')
    .replace(/\b\d{1,2}[-_.]\d{1,2}[-_.]\d{2,4}\b/g, ' ')
    .replace(/\b(v|ver|version|rev|revision)\s?\.?\d+\b/g, ' ')
    .replace(/\((\d+|copy|final|draft|updated|new|old)\)/g, ' ')
    .replace(/\b(copy|final|draft|updated|new|old|latest|edited|revised|signed)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Keys of items that share a name stem with another attached item (likely two versions of one document). */
export function likelyVersions(items: PreviewItem[]): Set<string> {
  const byStem = new Map<string, string[]>();
  for (const i of items) {
    const s = versionStem(i.name);
    if (s.length < 4) continue;
    byStem.set(s, [...(byStem.get(s) ?? []), i.key]);
  }
  const out = new Set<string>();
  for (const keys of byStem.values()) if (keys.length > 1) keys.forEach(k => out.add(k));
  return out;
}

export const fmtSize = (n: number | null) => n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export const fmtDate = (d?: string | number | null) => {
  if (d == null || d === '') return '';
  const t = new Date(d); if (isNaN(+t)) return '';
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(t.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};

/** Among look-alike files, the key of the most recently changed one in each group (null when dates are missing). */
export function newestOfVersions(items: PreviewItem[]): Set<string> {
  const groups = new Map<string, PreviewItem[]>();
  for (const i of items) { const s = versionStem(i.name); if (s.length >= 4) groups.set(s, [...(groups.get(s) ?? []), i]); }
  const out = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2 || g.some(i => !i.date || isNaN(+new Date(i.date)))) continue;
    out.add(g.reduce((a, b) => +new Date(b.date!) > +new Date(a.date!) ? b : a).key);
  }
  return out;
}
