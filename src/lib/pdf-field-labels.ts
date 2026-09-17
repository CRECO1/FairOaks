// Names a fill-in field after the words printed next to it on the form.
//
// A text field an agent drops onto an imported PDF usually has no label of its own —
// it sits on a line the form already labels ("Printed Name: ____"). Without one the
// signer saw a stack of identical "Type here" boxes and had no way to tell which was
// which. The label is the text that ends just before the field starts, on the same
// line — which is how a person reads the form.

export interface TextRun {
  page: number;   // 1-based
  x0: number;     // left edge, fraction of page width
  x1: number;     // right edge, fraction of page width
  y: number;      // baseline, fraction of page height measured from the top (same frame as a field's fy)
  str: string;
}

export interface LabelableField { page?: number; fx: number; fy: number }

// Placeholder labels that say nothing about what goes in the blank.
const GENERIC = new Set(['', 'text', 'type here', 'fill in', 'field']);
export const isGenericLabel = (label?: string | null) => GENERIC.has(String(label ?? '').trim().toLowerCase());

const SAME_LINE = 0.009;    // ≈ 7pt on a letter page: well inside one line of a dense block
const OVERLAP = 0.015;      // a label may run a hair past where the agent dropped the field
const REACH = 0.25;         // …but a label a quarter-page to the left belongs to another column

function clean(s: string): string {
  return s
    .replace(/_{2,}.*$/, '')          // "Title: ______" → "Title:"
    .replace(/[:\s.]+$/, '')          // trailing colon / dots
    .replace(/\s+/g, ' ')
    .trim();
}

export function labelFor(runs: TextRun[], field: LabelableField): string | undefined {
  const page = field.page || 1;
  let best: TextRun | undefined;
  for (const r of runs) {
    if (r.page !== page) continue;
    if (Math.abs(r.y - field.fy) > SAME_LINE) continue;
    if (r.x1 > field.fx + OVERLAP || r.x1 < field.fx - REACH) continue;
    const text = clean(r.str);
    if (!text || text.length > 40 || !/[A-Za-z]/.test(text)) continue;
    if (!best || r.x1 > best.x1) best = r;
  }
  return best ? clean(best.str) : undefined;
}

// Pull positioned text out of the pages that need it. pdf.js takes ownership of the
// buffer it's given, so this always works on its own copy.
export async function readTextRuns(bytes: ArrayBuffer, pages: Iterable<number>): Promise<TextRun[]> {
  const pdfjs = await import('pdfjs-dist');
  if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), password: '' });
  const pdf = await task.promise;
  const runs: TextRun[] = [];
  try {
    for (const n of new Set(pages)) {
      if (n < 1 || n > pdf.numPages) continue;
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const x = item.transform[4], y = item.transform[5];
        runs.push({ page: n, x0: x / width, x1: (x + item.width) / width, y: 1 - y / height, str: item.str });
      }
    }
  } finally {
    void task.destroy();
  }
  return runs;
}
