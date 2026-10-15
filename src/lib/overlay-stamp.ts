// Server-side twin of TransactionDocEditor's build(): stamp an overlay form's field
// values onto its blank PDF. The editor does this in the browser when an agent clicks
// Save; the Copilot edits a document's values from the server, so it needs the same
// stamp or the PDF that goes out for signature would still show the OLD text.
// Keep the layout maths identical to the editor's build().
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { parseRich, drawRichText, drawnWidth, hasMarkup, type RichFonts } from '@/lib/rich-text';

export interface StampField {
  page: number; fx: number; fy: number; fw: number;
  value?: string | null; size?: number; type?: string;
}

// pdf-lib's StandardFonts can only draw WinAnsi (Latin-1); map typographic characters
// to ASCII and drop the rest so a stamp never throws mid-render.
const winAnsi = (s: string): string =>
  (s || '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•●]/g, '*')
    .replace(/[✓✔✅]/g, 'X')
    .replace(/ /g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');

export async function stampOverlay(blank: Uint8Array, fields: StampField[]): Promise<Uint8Array> {
  // Texas REALTORS PDFs ship with permission encryption pdf-lib refuses to edit unless told.
  const doc = await PDFDocument.load(blank, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const rich: RichFonts = {
    reg: font,
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    ital: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItal: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const ink = rgb(0.06, 0.06, 0.1);
  const pgs = doc.getPages();
  for (const f of fields) {
    const pg = pgs[(f.page ?? 1) - 1]; if (!pg) continue;
    // Signer placeholders are stamped at signing time, never here.
    if (f.type === 'signature' || f.type === 'initial' || f.type === 'date') continue;
    const { width, height } = pg.getSize();
    const x = f.fx * width + 2;
    const y = height - f.fy * height + 2;
    const size = (f.size ?? 11) * 0.85;
    if (f.type === 'check') {
      if (String(f.value ?? '').trim()) {
        const box = f.fw * width;
        const xw = font.widthOfTextAtSize('X', size);
        const cap = size * 0.72;
        pg.drawText('X', { x: f.fx * width + Math.max(0, (box - xw) / 2), y: height - f.fy * height + Math.max(1, (box - cap) / 2), size, font, color: ink });
      }
      continue;
    }
    const val = winAnsi(f.value || '');
    if (!val) continue;
    const maxW = Math.max(24, f.fw * width - 4);
    if (hasMarkup(val)) {
      drawRichText({ page: pg, runs: parseRich(val), x, y, size, lineHeight: size * 1.08, maxW, fonts: rich, color: ink });
    } else if (drawnWidth(font, val, size) <= maxW) {
      pg.drawText(val, { x, y, size, font, color: ink });
    } else if (drawnWidth(font, val, size) * 0.72 <= maxW) {
      pg.drawText(val, { x, y, size: size * maxW / drawnWidth(font, val, size), font, color: ink });
    } else {
      drawRichText({ page: pg, runs: parseRich(val), x, y, size, lineHeight: size * 1.08, maxW, fonts: rich, color: ink });
    }
  }
  return doc.save();
}
