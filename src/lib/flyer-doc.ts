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
// Matches the letterhead used on the LOIs — a rule, the tagline, the company line.
const FOOT_TAG = 'Where your real estate ventures find the support they deserve';
const FOOT_CONTACT = '8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015   |   (210) 817-3443   |   info@crecotx.com   |   crecotx.com';

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
  galleryPhotos?: Array<{ bytes: Uint8Array; png: boolean }>;   // page-2 gallery (pre-cropped ~4:3)
  mapBytes?: Uint8Array | null;        // page-1 location map (PNG)
  aerialBytes?: Uint8Array | null;     // page-2 aerial map (PNG)
  floorPlan?: { bytes: Uint8Array; png: boolean } | null;
  fontBold: Uint8Array;          // Oswald-Bold TTF
  logoPng: Uint8Array;           // CRECO letterhead PNG
  iabsPdf?: Uint8Array | null;   // Information About Brokerage Services — appended last (required in TX)
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
type Rect = { x: number; y: number; w: number; h: number };
function drawContain(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number): Rect {
  const scale = Math.min(w / img.width, h / img.height);
  const iw = img.width * scale, ih = img.height * scale;
  const ix = x + (w - iw) / 2, iy = y + (h - ih) / 2;
  page.drawImage(img, { x: ix, y: iy, width: iw, height: ih });
  return { x: ix, y: iy, w: iw, h: ih };
}
// How tall a photo grid wants to be at width w — blocks ask first so they only
// reserve what the grid will really use.
function photoGridHeight(n: number, w: number) {
  if (!n) return 0;
  const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols), g = 6;
  return rows * (((w - (cols - 1) * g) / cols) * 0.75) + (rows - 1) * g;
}
// Draw one line justified to fill maxW (word gaps stretched evenly).
function drawJustified(page: PDFPage, text: string, x: number, y: number, maxW: number, font: PDFFont, size: number, color: RGB) {
  const words = text.split(' ').filter(Boolean);
  if (words.length < 2) { page.drawText(text, { x, y, size, font, color }); return; }
  const wordsW = words.reduce((s, w) => s + font.widthOfTextAtSize(w, size), 0);
  const gap = (maxW - wordsW) / (words.length - 1);
  let cx = x;
  for (const w of words) { page.drawText(w, { x: cx, y, size, font, color }); cx += font.widthOfTextAtSize(w, size) + gap; }
}
// Lay pre-cropped (~4:3) photos into a grid filling the box.
function drawPhotoGrid(page: PDFPage, imgs: PDFImage[], x: number, y: number, w: number, h: number, line: RGB): Rect {
  const n = imgs.length; if (!n) return { x, y: y + h, w: 0, h: 0 };
  const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const g = 6;
  // Cells are held at the photos' own 4:3 so they fill edge to edge instead of
  // letterboxing; the block shrinks to fit the box and is centred in it.
  let cw = (w - (cols - 1) * g) / cols;
  let ch = cw * 0.75;
  const needH = rows * ch + (rows - 1) * g;
  if (needH > h) { const k = (h - (rows - 1) * g) / (rows * ch); cw *= k; ch *= k; }
  const gridW = cols * cw + (cols - 1) * g;
  const x0 = x + (w - gridW) / 2, top = y + h;   // top-aligned: slack falls below, not under the heading
  imgs.forEach((img, i) => {
    const r = Math.floor(i / cols), col = i % cols;
    const cx = x0 + col * (cw + g), cy = top - (r + 1) * ch - r * g;
    drawContain(page, img, cx, cy, cw, ch);
    page.drawRectangle({ x: cx, y: cy, width: cw, height: ch, borderColor: line, borderWidth: 0.75 });
  });
  const usedH = rows * ch + (rows - 1) * g;
  return { x: x0, y: top - usedH, w: gridW, h: usedH };
}

export async function renderFlyer(input: FlyerInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const osw = await pdf.embedFont(input.fontBold, { subset: true });   // condensed header font
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
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
  const gallery = (await Promise.all((input.galleryPhotos || []).map(embed))).filter((g): g is PDFImage => !!g).slice(0, 6);

  // ── PAGE 1 ─────────────────────────────────────────────────────────────────
  const p1 = pdf.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });

  // Hero (full-bleed top) — cover, then paint white below to erase any spill.
  const heroY = 462, heroH = H - heroY;   // 330 tall
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

  // The left column must never reach the footer, so description and highlights share a
  // fixed budget: highlights reserve their space first (they're the scannable part),
  // and whatever is left caps the description.
  const FLOOR = 148;                       // the agent block's divider sits at 128
  const LEAD = 12.4;
  const hl = (input.highlights || []).map(s => sanitize(s).trim()).filter(Boolean);
  const allDesc = wrapText(input.description || 'Contact the listing agent for full property details.', body, 9.3, leftW);

  // Both want the same column. When they both fit, both get everything; when they
  // don't, they split it — neither a one-line description nor a single bullet.
  const availLeft = ly - 17 - FLOOR - 12;
  const hlWant = hl.length ? 18 + Math.min(hl.length, 8) * 16 : 0;
  const descWant = allDesc.length * LEAD;
  const hlNeed = descWant + hlWant <= availLeft
    ? hlWant
    : Math.min(hlWant, Math.max(availLeft - descWant, availLeft * 0.5));

  // Left: PROPERTY DESCRIPTION
  p1.drawText('PROPERTY DESCRIPTION', { x: leftX, y: ly, size: 13, font: osw, color: INK });
  ly -= 17;
  const descRoom = Math.max(0, ly - FLOOR - hlNeed - 12);
  const maxDescLines = Math.max(2, Math.floor(descRoom / LEAD));
  const descLines = allDesc.slice(0, maxDescLines);
  if (descLines.length < allDesc.length && descLines.length) descLines[descLines.length - 1] += '…';
  descLines.forEach((ln, i) => {
    const isLast = i === descLines.length - 1;
    // Justify full lines; leave the last line (and short paragraph-enders) ragged.
    if (!isLast && body.widthOfTextAtSize(ln, 9.3) > leftW * 0.6) drawJustified(p1, ln, leftX, ly, leftW, body, 9.3, BODY);
    else p1.drawText(ln, { x: leftX, y: ly, size: 9.3, font: body, color: BODY });
    ly -= LEAD;
  });
  ly -= 12;

  // Left: HIGHLIGHTS — stop at the floor and say how many didn't fit.
  if (hl.length) {
    p1.drawText('HIGHLIGHTS', { x: leftX, y: ly, size: 13, font: osw, color: INK });
    ly -= 18;
    let shown = 0;
    for (const h of hl) {
      const lines = wrapText(h, body, 10, leftW - 16);
      const rowH = 16 + (lines.length - 1) * 13;
      if (ly - rowH < FLOOR) break;
      p1.drawEllipse({ x: leftX + 3, y: ly + 3, xScale: 2, yScale: 2, color: GOLD });
      lines.forEach((ln, i) => { p1.drawText(ln, { x: leftX + 14, y: ly, size: 10, font: body, color: INK }); if (i < lines.length - 1) ly -= 13; });
      ly -= 16;
      shown++;
    }
    if (shown < hl.length && ly - 12 >= FLOOR - 12) {
      p1.drawText(`+ ${hl.length - shown} more — ask the listing agent`, { x: leftX + 14, y: ly, size: 9, font: body, color: rgb(0.55, 0.57, 0.61) });
    }
  }

  // Right: two stat tiles (black, gold value)
  const tileY = bannerY - 24 - 46, tileH = 46;
  p1.drawRectangle({ x: rightX, y: tileY, width: rightW, height: tileH, color: BLACK });
  const half = rightW / 2;
  p1.drawRectangle({ x: rightX + half - 0.5, y: tileY + 8, width: 1, height: tileH - 16, color: rgb(0.3, 0.31, 0.34) });
  const tile = (cx: number, cw: number, kind: 'price' | 'size', value: string) => {
    // Vector icon (drawSvgPath anchors at the top-left, SVG y points down from there).
    const ix = cx + 12, iyTop = tileY + tileH / 2 + 7.5;
    if (kind === 'price') {
      p1.drawSvgPath('M6 1 L15 1 L15 15 L6 15 L1 8 Z', { x: ix, y: iyTop, color: GOLD });
      p1.drawEllipse({ x: ix + 5, y: iyTop - 8, xScale: 1.5, yScale: 1.5, color: BLACK });
    } else {
      p1.drawSvgPath('M1 1 L15 1 L15 15 L1 15 Z M1 8 L15 8 M8 1 L8 15', { x: ix, y: iyTop, borderColor: GOLD, borderWidth: 1.4 });
    }
    const v = sanitize(value) || '—';
    const vs = fitSize(v, osw, cw - 44, 15, 8);
    p1.drawText(v, { x: cx + 36, y: tileY + tileH / 2 - vs * 0.34, size: vs, font: osw, color: WHITE });
  };
  tile(rightX, half, 'price', input.statPrice);
  tile(rightX + half, half, 'size', input.statSize);

  // Right: location map
  const mapTop = tileY - 12, mapBottom = 116, mapH = mapTop - mapBottom;
  if (map) { const r = drawContain(p1, map, rightX, mapBottom, rightW, mapH); p1.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: LINE, borderWidth: 1 }); }
  else { p1.drawRectangle({ x: rightX, y: mapBottom, width: rightW, height: mapH, color: rgb(0.95, 0.96, 0.97), borderColor: LINE, borderWidth: 1 }); p1.drawText('Location map', { x: rightX + rightW / 2 - 30, y: mapBottom + mapH / 2, size: 10, font: body, color: rgb(0.6, 0.63, 0.67) }); }

  // ── Footer — the LOI letterhead footer, on every page we generate. ──
  const FOOT_RULE_Y = 54;
  const centre = (pg: PDFPage, t: string, y: number, size: number, font: PDFFont, color: RGB) => {
    const txt = sanitize(t);
    pg.drawText(txt, { x: (W - font.widthOfTextAtSize(txt, size)) / 2, y, size, font, color });
  };
  const drawFooter = (pg: PDFPage) => {
    pg.drawLine({ start: { x: M, y: FOOT_RULE_Y }, end: { x: W - M, y: FOOT_RULE_Y }, thickness: 2.4, color: BLACK });
    centre(pg, FOOT_TAG, FOOT_RULE_Y - 13, 8.5, italic, rgb(0.35, 0.37, 0.4));
    centre(pg, FOOT_CONTACT, FOOT_RULE_Y - 24, 7.5, body, rgb(0.45, 0.47, 0.5));
    pg.drawRectangle({ x: 0, y: 0, width: W, height: 8, color: GOLD });
  };

  // Page 1 also names the agent to call, sitting just above that footer.
  const footTop = 128;
  p1.drawLine({ start: { x: M, y: footTop }, end: { x: W - M, y: footTop }, thickness: 1, color: LINE });
  {
    const names = input.agentNames.filter(Boolean);
    let ny = names.length > 1 ? 104 : 96;
    for (const nm of names.slice(0, 3)) { p1.drawText(sanitize(nm).toUpperCase(), { x: M, y: ny, size: 15, font: osw, color: INK }); ny -= 18; }
    p1.drawLine({ start: { x: 188, y: 72 }, end: { x: 188, y: 114 }, thickness: 1, color: LINE });
    let cy = 106;
    for (const c of input.contacts.filter(Boolean).slice(0, 3)) {
      p1.drawEllipse({ x: 206, y: cy + 3, xScale: 2.2, yScale: 2.2, color: GOLD });
      p1.drawText(sanitize(c), { x: 216, y: cy, size: 10.5, font: body, color: INK });
      cy -= 17;
    }
    if (logo) drawContain(p1, logo, W - M - 168, 68, 168, 50);
  }
  drawFooter(p1);

  // ── PAGE 2 — adaptive: only added when there's a gallery / floor plan / aerial ─
  let p2: PDFPage | null = null;
  const p2blocks: Array<{ title: string; weight: number; border: boolean; natural?: (w: number) => number; draw: (x: number, y: number, w: number, h: number) => Rect }> = [];
  if (gallery.length) p2blocks.push({
    title: 'PROPERTY GALLERY', weight: 1.4, border: false,
    // The grid holds the photos' 4:3, so it can't use a taller box — say so up front
    // and the leftover goes to the map instead of becoming a hole in the page.
    natural: (w) => photoGridHeight(gallery.length, w),
    draw: (x, y, w, h) => drawPhotoGrid(p2!, gallery, x, y, w, h, LINE),
  });
  if (floor) p2blocks.push({ title: 'FLOOR PLAN', weight: 1.6, border: true, natural: (w) => w * (floor.height / floor.width), draw: (x, y, w, h) => drawContain(p2!, floor!, x, y, w, h) });
  if (aerial) p2blocks.push({ title: 'AREA MAP', weight: 1.5, border: true, natural: (w) => w * (aerial.height / aerial.width), draw: (x, y, w, h) => drawContain(p2!, aerial!, x, y, w, h) });

  if (p2blocks.length) {
    p2 = pdf.addPage([W, H]);
    p2.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
    const b2H = 72, b2Y = H - b2H;
    p2.drawRectangle({ x: 0, y: b2Y, width: W, height: b2H, color: BLACK });
    p2.drawText(badge, { x: 22, y: b2Y + b2H - 24, size: 13, font: osw, color: WHITE });
    const a2 = fitSize(addr, osw, W - 44, 24, 12);
    p2.drawText(addr, { x: 22, y: b2Y + 14, size: a2, font: osw, color: GOLD });

    const gap = 16, titleH = 18, usableTop = b2Y - gap, usableBottom = FOOT_RULE_Y + 14;
    const totalWt = p2blocks.reduce((s, b) => s + b.weight, 0);
    const boxW = W - 36;
    const avail = (usableTop - usableBottom) - p2blocks.length * titleH - (p2blocks.length - 1) * gap;
    // Pass 1: weighted shares. Any block that can't use its share gives the rest back;
    // pass 2 hands that slack to the blocks that stretch, so the page has no dead space.
    const heights = p2blocks.map(b => avail * (b.weight / totalWt));
    const capped = p2blocks.map(() => false);
    let slack = 0, stretchWt = 0;
    p2blocks.forEach((b, i) => {
      const nat = b.natural?.(boxW);
      if (nat !== undefined && nat < heights[i]) { slack += heights[i] - nat; heights[i] = nat; capped[i] = true; }
      else stretchWt += b.weight;
    });
    if (slack > 0 && stretchWt > 0) p2blocks.forEach((b, i) => {
      if (!capped[i]) heights[i] += slack * (b.weight / stretchWt);
    });
    const leftover = Math.max(0, avail - heights.reduce((a, b) => a + b, 0));
    const pad = Math.min(leftover / Math.max(1, p2blocks.length), 30);
    let cur = usableTop;
    p2blocks.forEach((blk, i) => {
      const bh = heights[i];
      p2!.drawText(blk.title, { x: 20, y: cur - 13, size: 12, font: osw, color: INK });
      cur -= titleH;
      const used = blk.draw(18, cur - bh, boxW, bh);
      // Frame what was drawn, not the slot — a letterboxed border reads as a layout bug.
      if (blk.border && used.w > 0) p2!.drawRectangle({ x: used.x, y: used.y, width: used.w, height: used.h, borderColor: LINE, borderWidth: 1 });
      cur -= bh + gap + pad;
    });
    drawFooter(p2);
  }

  // ── IABS — Texas requires this disclosure accompany the marketing piece, so it
  // always goes last. Copied in as real pages so the filed form stays pixel-exact.
  if (input.iabsPdf?.length) {
    try {
      const iabs = await PDFDocument.load(input.iabsPdf, { ignoreEncryption: true });
      const pages = await pdf.copyPages(iabs, iabs.getPageIndices());
      for (const pg of pages) pdf.addPage(pg);
    } catch (e) { console.error('[flyer] IABS append failed', e); }
  }

  return pdf.save();
}
