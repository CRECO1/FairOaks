// The ONE typeface for everything filled into a form: Liberation Sans Bold (metric-compatible with the Arial the
// printed forms use) in navy ink. A real bold face — never a faked outline — so small answers stay crisp and readable.
// Every writer of form text (editor Save, server stamper, Copilot restamp, signing-time fields) embeds it from here.
// Italic markup uses Bold Italic; **bold** markup is the same weight as the base (the base is already bold).
import type { PDFDocument, PDFFont } from 'pdf-lib';
import type { RichFonts } from '@/lib/rich-text';

export interface FormFonts { font: PDFFont; rich: RichFonts }

const toBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Embed the form typeface into `doc` (registers fontkit on it). Loaded lazily so the editor only pays for it on Save. */
export async function embedFormFonts(doc: PDFDocument): Promise<FormFonts> {
  const [{ default: fontkit }, data] = await Promise.all([import('@pdf-lib/fontkit'), import('@/lib/form-font-data')]);
  doc.registerFontkit(fontkit);
  const bold = await doc.embedFont(toBytes(data.LIBERATION_SANS_BOLD_B64), { subset: true });
  const boldItal = await doc.embedFont(toBytes(data.LIBERATION_SANS_BOLD_ITALIC_B64), { subset: true });
  return { font: bold, rich: { reg: bold, bold, ital: boldItal, boldItal } };
}
