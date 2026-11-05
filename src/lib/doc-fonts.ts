// Font families, sizes and colours offered in the document toolbar, and how a run's `textStyle` mark maps onto the PDF / Word writers.

export const DOC_FONTS: Array<{ label: string; css: string | null; word: string | null; pdf: 'sans' | 'serif' | 'mono' | null }> = [
  { label: 'Default', css: null, word: null, pdf: null },
  { label: 'Arial', css: 'Arial, Helvetica, sans-serif', word: 'Arial', pdf: 'sans' },
  { label: 'Verdana', css: 'Verdana, Geneva, sans-serif', word: 'Verdana', pdf: 'sans' },
  { label: 'Georgia', css: 'Georgia, serif', word: 'Georgia', pdf: 'serif' },
  { label: 'Times New Roman', css: "'Times New Roman', Times, serif", word: 'Times New Roman', pdf: 'serif' },
  { label: 'Courier New', css: "'Courier New', Courier, monospace", word: 'Courier New', pdf: 'mono' },
];
export const DOC_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
export const DOC_COLORS = ['#111827', '#6b7280', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#c9922c', '#1f3d2e'];

/** The first family named in a CSS font-family value, lower-cased ('Georgia, serif' → 'georgia'). */
const firstFamily = (css: string) => css.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
export const fontByCss = (css: unknown) => (typeof css === 'string' && css ? DOC_FONTS.find(f => f.css && firstFamily(f.css) === firstFamily(css)) : undefined);

/** Font size in points from a mark value like '12pt' or '16px' (undefined when absent / unreadable). */
export function sizePt(v: unknown): number | undefined {
  const m = typeof v === 'string' ? /^([\d.]+)\s*(pt|px)?$/i.exec(v.trim()) : null;
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? (m[2]?.toLowerCase() === 'px' ? Math.round(n * 0.75 * 2) / 2 : n) : undefined;
}

/** '#rrggbb' / '#rgb' → [r, g, b] 0–255 (undefined for anything else). */
export function rgbOf(v: unknown): [number, number, number] | undefined {
  const m = typeof v === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim()) : null;
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
