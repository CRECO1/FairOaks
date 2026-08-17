// ─────────────────────────────────────────────────────────────────────────────
// Property flyer generator — reproduces the CRECO 2-page flyer template
// (full-bleed hero + FOR LEASE badge · black address banner in gold · two-column
// description/highlights + stat tiles + location map · agent footer with logo ·
// page 2 aerial + floor plan). Server-side pdf-lib with an embedded Oswald-Bold
// header font (via fontkit) + Helvetica body. All raster inputs (hero, maps, floor
// plan, logo) are passed in as bytes so this stays pure + unit-testable.
// ─────────────────────────────────────────────────────────────────────────────
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import type { RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const BLACK: RGB = rgb(0.086, 0.086, 0.098);
const GOLD: RGB = rgb(0.941, 0.616, 0.078);
const WHITE: RGB = rgb(1, 1, 1);
const INK: RGB = rgb(0.11, 0.11, 0.13);
const BODY: RGB = rgb(0.24, 0.26, 0.29);
const LINE: RGB = rgb(0.85, 0.86, 0.88);

const W = 612, H = 792;

export interface FlyerInput {
  badge: string;                 // "FOR LEASE" / "FOR SALE"
  address: string;               // full one-line address
  description: string;
  highlights: string[];
  statPrice: string;             // "$22.00 /SF/YR" or "$1,200,000"
  statSize: string;              // "2,760 SF" (or lot size)
  agentNames: string[];
  contacts: string[];            // email / phone lines
  hero?: { bytes: Uint8Array; png: boolean } | null;
  mapBytes?: Uint8Array | null;        // page-1 location map (PNG)
  aerialBytes?: Uint8Array | null;     // page-2 aerial map (PNG)
  floorPlan?: { bytes: Uint8Array; png: boolean } | null;
  fontBold: Uint8Array;          // Oswald-Bold TTF
  logoPng: Uint8Array;           // CRECO letterhead PNG
}

function sanitize(s: unknown): string {
  // Keep ASCII + Latin-1 (accents like é ñ) which both Helvetica-WinAnsi and the
  // embedded Oswald can draw; drop arrows/emoji/CJK that would throw on encode.
  return String(s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}
function fitSize(text: string, font: PDFFont, maxW: number, start: number, min = 6): number {
  let s = start;
  while (s > min && font.widthOfTextAtSize(text, s) > maxW) s -= 0.5;
  return s;
}
function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of sanitize(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = word; }
      else line = test;
    }
    if (line) out.push(line);
  }
  return out;
}
// Draw an image to COVER a box (fill + crop-overflow); caller paints over any spill.
function drawCover(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const iw = img.width * scale, ih = img.height * scale;
  page.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
}
// Draw an image CONTAINED in a box (letterbox), centered.
function drawContain(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / img.width, h / img.height);
  const iw = img.width * scale, ih = img.height * scale;
  page.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
}

export async function renderFlyer(input: FlyerInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const osw = await pdf.embedFont(input.fontBold, { subset: true });   // condensed header font
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const logo = await pdf.embedPng(input.logoPng).catch(() => null);

  const embed = async (a?: { bytes: Uint8Array; png: boolean } | null): Promise<PDFImage | null> => {
    if (!a) return null;
    try { return a.png ? await pdf.embedPng(a.bytes) : await pdf.embedJpg(a.bytes); } catch { return null; }
  };
  const embedPng = async (b?: Uint8Array | null): Promise<PDFImage | null> => {
    if (!b) return null; try { return await pdf.embedPng(b); } catch { return null; }
  };

  const hero = await embed(input.hero);
  const map = await embedPng(input.mapBytes);
  const aerial = await embedPng(input.aerialBytes);
  const floor = await embed(input.floorPlan);

  // ── PAGE 1 ─────────────────────────────────────────────────────────────────
  const p1 = pdf.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });

  // Hero (full-bleed top) — cover, then paint white below to erase any spill.
  const heroY = 420, heroH = H - heroY;   // 372 tall
  if (hero) drawCover(p1, hero, 0, heroY, W, heroH);
  else { p1.drawRectangle({ x: 0, y: heroY, width: W, height: heroH, color: rgb(0.9, 0.91, 0.93) }); p1.drawText('Add a property photo', { x: W / 2 - 70, y: heroY + heroH / 2, size: 12, font: body, color: rgb(0.6, 0.63, 0.67) }); }
  p1.drawRectangle({ x: 0, y: 0, width: W, height: heroY, color: WHITE });

  // FOR LEASE badge (top-left over hero)
  const badge = sanitize(input.badge).toUpperCase();
  const bSize = 30, bW = osw.widthOfTextAtSize(badge, bSize);
  p1.drawRectangle({ x: 0, y: H - 62, width: bW + 30, height: 62, color: BLACK, opacity: 0.82 });
  p1.drawText(badge, { x: 15, y: H - 45, size: bSize, font: osw, color: WHITE });

  // Address banner (black bar, gold text)
  const bannerY = heroY - 50, bannerH = 50;
  p1.drawRectangle({ x: 0, y: bannerY, width: W, height: bannerH, color: BLACK });
  const addr = sanitize(input.address);
  const aSize = fitSize(addr, osw, W - 44, 27, 13);
  p1.drawText(addr, { x: 22, y: bannerY + bannerH / 2 - aSize * 0.34, size: aSize, font: osw, color: GOLD });

  // ── Two-column body ──
  const M = 34;
  const colGap = 22;
  const leftX = M, leftW = 250;
  const rightX = leftX + leftW + colGap, rightW = W - M - rightX;   // ~272
  let ly = bannerY - 24;

  // Left: PROPERTY DESCRIPTION
  p1.drawText('PROPERTY DESCRIPTION', { x: leftX, y: ly, size: 13, font: osw, color: INK });
  ly -= 17;
  const descLines = wrapText(input.description || 'Contact the listing agent for full property details.', body, 9.3, leftW);
  for (const ln of descLines.slice(0, 12)) { p1.drawText(ln, { x: leftX, y: ly, size: 9.3, font: body, color: BODY }); ly -= 12.4; }
  ly -= 12;

  // Left: HIGHLIGHTS
  const hl = (input.highlights || []).map(s => sanitize(s).trim()).filter(Boolean).slice(0, 8);
  if (hl.length) {
    p1.drawText('HIGHLIGHTS', { x: leftX, y: ly, size: 13, font: osw, color: INK });
    ly -= 18;
    for (const h of hl) {
      p1.drawEllipse({ x: leftX + 3, y: ly + 3, xScale: 2, yScale: 2, color: GOLD });
      const lines = wrapText(h, body, 10, leftW - 16);
      lines.forEach((ln, i) => { p1.drawText(ln, { x: leftX + 14, y: ly, size: 10, font: body, color: INK }); if (i < lines.length - 1) ly -= 13; });
      ly -= 16;
    }
  }

  // Right: two stat tiles (black, gold value)
  const tileY = bannerY - 24 - 46, tileH = 46;
  p1.drawRectangle({ x: rightX, y: tileY, width: rightW, height: tileH, color: BLACK });
  const half = rightW / 2;
  p1.drawRectangle({ x: rightX + half - 0.5, y: tileY + 8, width: 1, height: tileH - 16, color: rgb(0.3, 0.31, 0.34) });
  const tile = (cx: number, cw: number, label: string, value: string) => {
    // small gold glyph
    p1.drawRectangle({ x: cx + 12, y: tileY + tileH / 2 - 7, width: 14, height: 14, color: GOLD, opacity: 0.9 });
    const v = sanitize(value) || '—';
    const vs = fitSize(v, osw, cw - 44, 15, 8);
    p1.drawText(v, { x: cx + 34, y: tileY + tileH / 2 - vs * 0.34, size: vs, font: osw, color: WHITE });
  };
  tile(rightX, half, 'PRICE', input.statPrice);
  tile(rightX + half, half, 'SIZE', input.statSize);

  // Right: location map
  const mapTop = tileY - 12, mapBottom = 116, mapH = mapTop - mapBottom;
  if (map) { drawContain(p1, map, rightX, mapBottom, rightW, mapH); p1.drawRectangle({ x: rightX, y: mapBottom, width: rightW, height: mapH, borderColor: LINE, borderWidth: 1 }); }
  else { p1.drawRectangle({ x: rightX, y: mapBottom, width: rightW, height: mapH, color: rgb(0.95, 0.96, 0.97), borderColor: LINE, borderWidth: 1 }); p1.drawText('Location map', { x: rightX + rightW / 2 - 30, y: mapBottom + mapH / 2, size: 10, font: body, color: rgb(0.6, 0.63, 0.67) }); }

  // ── Footer (white) with gold accent bar ──
  const footTop = 104;
  p1.drawLine({ start: { x: M, y: footTop }, end: { x: W - M, y: footTop }, thickness: 1, color: LINE });
  const names = input.agentNames.filter(Boolean);
  let ny = names.length > 1 ? 78 : 68;
  for (const nm of names.slice(0, 3)) { p1.drawText(sanitize(nm).toUpperCase(), { x: M, y: ny, size: 15, font: osw, color: INK }); ny -= 18; }
  p1.drawLine({ start: { x: 188, y: 46 }, end: { x: 188, y: 88 }, thickness: 1, color: LINE });
  let cy = 80;
  for (const c of input.contacts.filter(Boolean).slice(0, 3)) {
    p1.drawEllipse({ x: 206, y: cy + 3, xScale: 2.2, yScale: 2.2, color: GOLD });
    p1.drawText(sanitize(c), { x: 216, y: cy, size: 10.5, font: body, color: INK });
    cy -= 17;
  }
  if (logo) drawContain(p1, logo, W - M - 168, 40, 168, 52);
  p1.drawRectangle({ x: 0, y: 0, width: W, height: 8, color: GOLD });

  // ── PAGE 2 ─────────────────────────────────────────────────────────────────
  const p2 = pdf.addPage([W, H]);
  p2.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
  // Banner
  const b2H = 72, b2Y = H - b2H;
  p2.drawRectangle({ x: 0, y: b2Y, width: W, height: b2H, color: BLACK });
  p2.drawText(badge, { x: 22, y: b2Y + b2H - 24, size: 13, font: osw, color: WHITE });
  const a2 = fitSize(addr, osw, W - 44, 24, 12);
  p2.drawText(addr, { x: 22, y: b2Y + 14, size: a2, font: osw, color: GOLD });

  // Aerial (top) + floor plan (bottom). The static map is requested at the box aspect,
  // so contain fills it exactly with no overflow.
  const gap = 18;
  const aerialTop = b2Y - gap, aerialBottom = 372, aerialH = aerialTop - aerialBottom;
  if (aerial) drawContain(p2, aerial, 18, aerialBottom, W - 36, aerialH);
  else { p2.drawRectangle({ x: 18, y: aerialBottom, width: W - 36, height: aerialH, color: rgb(0.93, 0.94, 0.95) }); p2.drawText('Aerial map', { x: W / 2 - 26, y: aerialBottom + aerialH / 2, size: 11, font: body, color: rgb(0.6, 0.63, 0.67) }); }
  p2.drawRectangle({ x: 18, y: aerialBottom, width: W - 36, height: aerialH, borderColor: LINE, borderWidth: 1 });

  const fpTop = aerialBottom - gap, fpBottom = 30, fpH = fpTop - fpBottom;
  p2.drawText('FLOOR PLAN', { x: 20, y: fpTop - 2, size: 12, font: osw, color: INK });
  const fpBoxTop = fpTop - 18;
  if (floor) drawContain(p2, floor, 18, fpBottom, W - 36, fpBoxTop - fpBottom);
  else { p2.drawRectangle({ x: 18, y: fpBottom, width: W - 36, height: fpBoxTop - fpBottom, color: rgb(0.98, 0.98, 0.98), borderColor: LINE, borderWidth: 1 }); p2.drawText('Upload a floor plan under Documents / Floor Plans to include it here.', { x: 34, y: (fpBottom + fpBoxTop) / 2, size: 10, font: body, color: rgb(0.62, 0.65, 0.69) }); }
  p2.drawRectangle({ x: 0, y: 0, width: W, height: 8, color: GOLD });

  return pdf.save();
}
