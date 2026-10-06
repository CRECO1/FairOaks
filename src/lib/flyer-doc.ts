// ─────────────────────────────────────────────────────────────────────────────
// Property flyer generator — reproduces the CRECO 2-page flyer template
// (full-bleed hero + FOR LEASE badge · black address banner in gold · two-column
// description/highlights + stat tiles + location map · agent footer with logo ·
// page 2 aerial + floor plan). Server-side pdf-lib with an embedded Oswald-Bold
// header font (via fontkit) + Helvetica body. All raster inputs (hero, maps, floor
// plan, logo) are passed in as bytes so this stays pure + unit-testable.
// ─────────────────────────────────────────────────────────────────────────────
import { PDFDocument, StandardFonts, rgb, degrees, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
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
const FOOT_CONTACT = '8000 Fair Oaks Pkwy, Suite 100, Fair Oaks Ranch, TX 78015   |   (210) 817-3443   |   info@crecotx.com   |   crecotx.com';

export interface FlyerInput {
  badge: string;                 // "FOR LEASE" / "FOR SALE"
  address: string;               // full one-line address
  description: string;
  highlights: string[];
  statPrice: string;             // "$22.00 /SF/YR" or "$1,200,000"
  statSize: string;              // "2,760 SF" (or lot size)
  // Optional second row of tiles. The facts a reader hunts for first belong in tiles,
  // not in the prose — lot size and zoning are the two that come up on every call.
  statLot?: string | null;       // "1.01 AC"
  statZoning?: string | null;    // "I-1"
  agentNames: string[];
  contacts: string[];            // email / phone lines
  hero?: { bytes: Uint8Array; png: boolean } | null;
  galleryPhotos?: Array<{ bytes: Uint8Array; png: boolean }>;   // page-2 gallery (pre-cropped ~4:3)
  mapBytes?: Uint8Array | null;        // page-1 location map (PNG)
  aerialBytes?: Uint8Array | null;     // page-2 aerial map (PNG)
  // Street names to draw over the aerial (USGS imagery has none). Image pixels from the
  // top-left + the PDF rotation that lays each name along its road — see roadLabels().
  aerialLabels?: Array<{ text: string; x: number; y: number; angle: number }> | null;
  // Hand-made aerials (lot outlined, highways marked). When a listing has one it
  // replaces the generated aerial above: a drawn outline says where the property is
  // at a glance, which a pin on unlabelled imagery with a dozen street names does not.
  siteAerials?: Array<{ bytes: Uint8Array; png: boolean }> | null;
  floorPlan?: { bytes: Uint8Array; png: boolean } | null;
  // Optional page-2 trade-area panel — a dark stat strip (traffic counts, population,
  // daytime jobs; up to 4 tiles + a one-line source caption). Drawn above the aerial.
  tradeArea?: { tiles: Array<{ value: string; label: string }>; caption?: string } | null;
  fontBold: Uint8Array;          // Oswald-Bold TTF
  logoPng: Uint8Array;           // CRECO letterhead PNG
  iabsPdf?: Uint8Array | null;   // Information About Brokerage Services — appended last (required in TX)
  // Page-2 block headings, when the defaults don't describe the image (e.g. a site plan
  // supplied as the "floor plan", or a suite plan in the aerial slot).
  titles?: { photos?: string; floorPlan?: string; siteAerial?: string } | null;
  // Property sub-brand (e.g. Elkhorn Point's campaign-email look): a two-tone wordmark
  // and headline over a darkened cover, in the brand's own gold. Absent = CRECO default.
  brand?: {
    wordmark: [string, string];    // ["ELKHORN", "POINT"] — second word in gold
    tag?: string;                  // top-right of the cover, e.g. "Retail · Fair Oaks Ranch, TX"
    kicker?: string;               // small caps line above the headline (replaces the badge)
    headline?: string;             // large white headline over the cover
    gold?: string;                 // hex accent, e.g. "#C9922C"
    kickerColor?: string;          // hex, e.g. "#F2C879"
  } | null;
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
function hexRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}
// Letter-spaced text (pdf-lib has no tracking): draws glyph by glyph, returns the width.
function spacedWidth(text: string, font: PDFFont, size: number, track: number): number {
  return [...text].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size) + track, 0) - (text ? track : 0);
}
function drawSpaced(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color: RGB, track: number): number {
  let cx = x;
  for (const ch of text) { page.drawText(ch, { x: cx, y, size, font, color }); cx += font.widthOfTextAtSize(ch, size) + track; }
  return cx - x - (text ? track : 0);
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
// Contained, but pinned to the top of the box: on page 2 a block's title sits right
// above it, and a centred image leaves a gap that reads as a missing element.
function drawContainTop(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number): Rect {
  const scale = Math.min(w / img.width, h / img.height);
  const iw = img.width * scale, ih = img.height * scale;
  const ix = x + (w - iw) / 2, iy = y + h - ih;
  page.drawImage(img, { x: ix, y: iy, width: iw, height: ih });
  return { x: ix, y: iy, w: iw, h: ih };
}
// Street names over the aerial. Labels arrive in image pixels; the image was drawn
// contained (one uniform scale), so a single factor maps them onto the page. White
// text over a dark halo reads on any imagery — pdf-lib has no text stroke, so the
// halo is the same text drawn eight times, nudged around, in black.
function drawMapLabels(page: PDFPage, r: Rect, img: PDFImage, labels: FlyerInput['aerialLabels'], font: PDFFont) {
  if (!labels?.length || r.w <= 0) return;
  // Text is sized to the map as drawn, not to the image: a full-width map can carry
  // 9.5pt names, a map sharing the page with a gallery drops to 7.5pt.
  const s = r.w / img.width, fs = Math.max(7.5, Math.min(9.5, r.w / 60)), capH = fs * 0.72;
  for (const l of labels) {
    const text = sanitize(l.text); if (!text) continue;
    const cx = r.x + l.x * s, cy = r.y + r.h - l.y * s;
    const th = (l.angle * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
    const tw = font.widthOfTextAtSize(text, fs);
    // drawText rotates about its baseline-left origin; back that origin off so the
    // text ends up centred on the road point.
    const ox = cx - (tw / 2) * cos + (capH / 2) * sin, oy = cy - (tw / 2) * sin - (capH / 2) * cos;
    for (const [dx, dy] of [[-0.6, 0], [0.6, 0], [0, -0.6], [0, 0.6], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]])
      page.drawText(text, { x: ox + dx, y: oy + dy, size: fs, font, color: BLACK, opacity: 0.8, rotate: degrees(l.angle) });
    page.drawText(text, { x: ox, y: oy, size: fs, font, color: WHITE, rotate: degrees(l.angle) });
  }
}
// How tall a photo grid wants to be at width w — blocks ask first so they only
// reserve what the grid will really use.
function photoGridHeight(n: number, w: number) {
  if (!n) return 0;
  const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols), g = 6;
  return rows * (((w - (cols - 1) * g) / cols) * 0.75) + (rows - 1) * g;
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

// Dark demographics strip: up to 4 gold-value / white-label cells with dividers, plus
// an optional source/value-prop caption underneath. Drawn top-aligned in its box.
function drawTradeArea(
  page: PDFPage, ta: { tiles: Array<{ value: string; label: string }>; caption?: string },
  x: number, y: number, w: number, h: number, osw: PDFFont, body: PDFFont, accent: RGB = GOLD,
): Rect {
  const barH = 60;
  const barY = y + h - barH;                       // top-align the bar within the block box
  page.drawRectangle({ x, y: barY, width: w, height: barH, color: BLACK });
  const tiles = ta.tiles.slice(0, 4);
  const cw = w / Math.max(1, tiles.length);
  tiles.forEach((t, i) => {
    const cx = x + i * cw;
    if (i > 0) page.drawRectangle({ x: cx, y: barY + 11, width: 1, height: barH - 22, color: rgb(0.3, 0.31, 0.34) });
    const val = sanitize(t.value) || '—';
    const vs = fitSize(val, osw, cw - 16, 20, 10);
    page.drawText(val, { x: cx + (cw - osw.widthOfTextAtSize(val, vs)) / 2, y: barY + barH - 27, size: vs, font: osw, color: accent });
    const lab = sanitize(t.label).toUpperCase();
    const ls = fitSize(lab, body, cw - 8, 7.5, 5);
    page.drawText(lab, { x: cx + (cw - body.widthOfTextAtSize(lab, ls)) / 2, y: barY + 11, size: ls, font: body, color: WHITE });
  });
  let usedH = barH;
  if (ta.caption) {
    const cs = 8, cap = sanitize(ta.caption);
    const cw2 = fitSize(cap, body, w, cs, 6);
    page.drawText(cap, { x: x + (w - body.widthOfTextAtSize(cap, cw2)) / 2, y: barY - 13, size: cw2, font: body, color: rgb(0.42, 0.44, 0.47) });
    usedH += 17;
  }
  return { x, y: y + h - usedH, w, h: usedH };
}

export async function renderFlyer(input: FlyerInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const osw = await pdf.embedFont(input.fontBold, { subset: true });   // condensed header font
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const labelFont = await pdf.embedFont(StandardFonts.HelveticaBold);   // map street names
  const logo = await pdf.embedPng(input.logoPng).catch(() => null);
  const brand = input.brand?.wordmark?.length === 2 ? input.brand : null;
  const gold = brand?.gold ? hexRgb(brand.gold) : GOLD;

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

  const badge = sanitize(input.badge).toUpperCase();
  const drawWordmark = (pg: PDFPage, x: number, y: number, size: number, track: number) => {
    const [a, b] = brand!.wordmark.map(t => sanitize(t).toUpperCase());
    const w1 = drawSpaced(pg, a, x, y, size, labelFont, WHITE, track);
    drawSpaced(pg, b, x + w1 + size * 0.55, y, size, labelFont, gold, track);
  };
  if (brand) {
    // The property's campaign-email header: two-tone wordmark + tag across the top,
    // kicker + headline bottom-left, gold rule where the cover meets the banner. The
    // caller supplies the cover already shaded (dark top and foot, lighter middle) —
    // a raster gradient; stacked translucent bands here show seams in some viewers.
    drawWordmark(p1, 30, H - 38, 17, 3.4);
    if (brand.tag) {
      const tag = sanitize(brand.tag).toUpperCase();
      drawSpaced(p1, tag, W - 30 - spacedWidth(tag, labelFont, 8, 1.1), H - 36, 8, labelFont, rgb(0.89, 0.89, 0.89), 1.1);
    }
    // Headline: two lines at most — shrink to fit rather than drop words.
    let hs = 36, hl = wrapText(sanitize(brand.headline || ''), osw, hs, 470);
    while (hl.length > 2 && hs > 18) { hs -= 1; hl = wrapText(sanitize(brand.headline || ''), osw, hs, 470); }
    // Balance a two-line headline: narrow the measure until one more step would need a
    // third line, so it never ends on a single orphaned word.
    if (hl.length === 2) for (let w = 460; w > 160; w -= 10) {
      const t = wrapText(sanitize(brand.headline || ''), osw, hs, w);
      if (t.length > 2) break;
      hl = t;
    }
    const lead = hs * 1.12;
    let hy = heroY + 30 + (hl.length - 1) * lead;
    const kick = sanitize(brand.kicker || badge).toUpperCase();
    drawSpaced(p1, kick, 30, hy + hs + 10, 9.5, labelFont, brand.kickerColor ? hexRgb(brand.kickerColor) : gold, 2.2);
    for (const line of hl) { p1.drawText(line, { x: 30, y: hy, size: hs, font: osw, color: WHITE }); hy -= lead; }
    p1.drawRectangle({ x: 0, y: heroY - 1.5, width: W, height: 3, color: gold });
  } else {
    // FOR LEASE badge (top-left over hero)
    const bSize = 30, bW = osw.widthOfTextAtSize(badge, bSize);
    p1.drawRectangle({ x: 0, y: H - 62, width: bW + 30, height: 62, color: BLACK, opacity: 0.82 });
    p1.drawText(badge, { x: 15, y: H - 45, size: bSize, font: osw, color: WHITE });
  }

  // Address banner (black bar, gold text)
  const bannerY = heroY - 50 - (brand ? 1.5 : 0), bannerH = 50;
  p1.drawRectangle({ x: 0, y: bannerY, width: W, height: bannerH, color: BLACK });
  const addr = sanitize(input.address);
  const aSize = fitSize(addr, osw, W - 44, 27, 13);
  p1.drawText(addr, { x: 22, y: bannerY + bannerH / 2 - aSize * 0.34, size: aSize, font: osw, color: gold });

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
  // A flyer is read in seconds. The column is therefore: one bold sentence that says
  // what this is, a couple of plain sentences under it, and a short list of bullets —
  // set large enough to read at arm's length and never cut off mid-thought. Anything
  // that doesn't fit is left out whole (a sentence, a bullet), not trailed off with "…".
  const DESC_SIZE = 10.2, DESC_LEAD = 14, LEAD_SIZE = 11.2, LEAD_LEAD = 15;
  const HL_SIZE = 10.2, HL_ROW = 17, HL_WRAP = 13, HL_MAX = 6;
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const hl = (input.highlights || []).map(s => sanitize(s).trim()).filter(Boolean).slice(0, HL_MAX);
  const sentences = sanitize(input.description || 'Contact the listing agent for full property details.')
    .replace(/\s*\n+\s*/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9$~"'])/).map(t => t.trim()).filter(Boolean);
  const leadLines = wrapText(sentences[0] || '', bold, LEAD_SIZE, leftW).slice(0, 3);

  // Bullets are the scannable part, so they reserve their room first.
  const hlHeights = hl.map(h => HL_ROW + (wrapText(h, body, HL_SIZE, leftW - 16).length - 1) * HL_WRAP);
  const hlWant = hl.length ? 19 + hlHeights.reduce((a, b) => a + b, 0) : 0;

  p1.drawText('PROPERTY DESCRIPTION', { x: leftX, y: ly, size: 13, font: osw, color: INK });
  ly -= 18;
  for (const ln of leadLines) { p1.drawText(ln, { x: leftX, y: ly, size: LEAD_SIZE, font: bold, color: INK }); ly -= LEAD_LEAD; }
  ly -= 3;
  // Whole sentences only, set as one paragraph, for as long as they fit above the bullets.
  const room = ly - FLOOR - hlWant - 10;
  let para: string[] = [];
  for (let n = 2; n <= sentences.length; n++) {
    const lines = wrapText(sentences.slice(1, n).join(' '), body, DESC_SIZE, leftW);
    if (lines.length * DESC_LEAD > room) break;
    para = lines;
  }
  for (const ln of para) { p1.drawText(ln, { x: leftX, y: ly, size: DESC_SIZE, font: body, color: BODY }); ly -= DESC_LEAD; }
  ly -= 12;

  if (hl.length) {
    p1.drawText('HIGHLIGHTS', { x: leftX, y: ly, size: 13, font: osw, color: INK });
    ly -= 19;
    hl.forEach((h, i) => {
      if (ly - hlHeights[i] < FLOOR - 14) return;
      const lines = wrapText(h, body, HL_SIZE, leftW - 16);
      p1.drawEllipse({ x: leftX + 3, y: ly + 3.2, xScale: 2.2, yScale: 2.2, color: gold });
      lines.forEach((ln, j) => { p1.drawText(ln, { x: leftX + 14, y: ly, size: HL_SIZE, font: body, color: INK }); if (j < lines.length - 1) ly -= HL_WRAP; });
      ly -= HL_ROW;
    });
  }

  // Right: stat tiles (black, white value, gold icon). Price + size always; lot size
  // and zoning make a second row when the listing has them.
  const tileH = 46;
  const half = rightW / 2;
  const extra = [
    { kind: 'lot' as const, value: sanitize(input.statLot || '').trim() },
    { kind: 'zoning' as const, value: sanitize(input.statZoning || '').trim() },
  ].filter(t => t.value);
  const tileRows = extra.length ? 2 : 1;
  const tileTop = bannerY - 24;
  const tileY = tileTop - tileH;                      // first row
  const tilesBottom = tileTop - tileRows * tileH;
  p1.drawRectangle({ x: rightX, y: tilesBottom, width: rightW, height: tileRows * tileH, color: BLACK });
  const hair = rgb(0.3, 0.31, 0.34);
  // A lone second-row tile spans the full width, so that row gets no divider.
  for (let r = 0; r < (extra.length === 1 ? 1 : tileRows); r++) p1.drawRectangle({ x: rightX + half - 0.5, y: tileTop - (r + 1) * tileH + 8, width: 1, height: tileH - 16, color: hair });
  if (tileRows === 2) p1.drawRectangle({ x: rightX + 12, y: tileY - 0.5, width: rightW - 24, height: 1, color: hair });
  const tile = (cx: number, cy: number, cw: number, kind: 'price' | 'size' | 'lot' | 'zoning', value: string) => {
    // Vector icon (drawSvgPath anchors at the top-left, SVG y points down from there).
    const ix = cx + 12, iyTop = cy + tileH / 2 + 7.5;
    if (kind === 'price') {
      p1.drawSvgPath('M6 1 L15 1 L15 15 L6 15 L1 8 Z', { x: ix, y: iyTop, color: gold });
      p1.drawEllipse({ x: ix + 5, y: iyTop - 8, xScale: 1.5, yScale: 1.5, color: BLACK });
    } else if (kind === 'size') {
      p1.drawSvgPath('M1 1 L15 1 L15 15 L1 15 Z M1 8 L15 8 M8 1 L8 15', { x: ix, y: iyTop, borderColor: gold, borderWidth: 1.4 });
    } else if (kind === 'lot') {
      // a parcel: an irregular outline
      p1.drawSvgPath('M2 4 L13 1 L15 12 L5 15 Z', { x: ix, y: iyTop, borderColor: gold, borderWidth: 1.4 });
    } else {
      // zoning: a stacked-layers mark
      p1.drawSvgPath('M8 1 L15 5 L8 9 L1 5 Z M1 9 L8 13 L15 9', { x: ix, y: iyTop, borderColor: gold, borderWidth: 1.4 });
    }
    const v = sanitize(value) || '—';
    const vs = fitSize(v, osw, cw - 44, 15, 8);
    p1.drawText(v, { x: cx + 36, y: cy + tileH / 2 - vs * 0.34, size: vs, font: osw, color: WHITE });
  };
  tile(rightX, tileY, half, 'price', input.statPrice);
  tile(rightX + half, tileY, half, 'size', input.statSize);
  extra.forEach((t, i) => tile(rightX + (extra.length === 1 ? 0 : i * half), tilesBottom, extra.length === 1 ? rightW : half, t.kind, t.value));

  // Right: location map
  const mapTop = tilesBottom - 12, mapBottom = 140, mapH = mapTop - mapBottom;   // divider sits at 128
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
    pg.drawRectangle({ x: 0, y: 0, width: W, height: 8, color: gold });
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
      p1.drawEllipse({ x: 206, y: cy + 3, xScale: 2.2, yScale: 2.2, color: gold });
      p1.drawText(sanitize(c), { x: 216, y: cy, size: 10.5, font: body, color: INK });
      cy -= 17;
    }
    if (logo) drawContain(p1, logo, W - M - 168, 68, 168, 50);
  }
  drawFooter(p1);

  // ── PAGE 2 — adaptive: only added when there's a gallery / floor plan / aerial ─
  let p2: PDFPage | null = null;
  const p2blocks: Array<{ title: string; weight: number; border: boolean; natural?: (w: number) => number; draw: (x: number, y: number, w: number, h: number) => Rect }> = [];
  // Order is deliberate: the numbers a site selector screens on come first, then the
  // photos, then the plan, then where it sits.
  if (input.tradeArea?.tiles?.length) {
    const ta = input.tradeArea;
    p2blocks.push({
      title: 'BY THE NUMBERS', weight: 1.0, border: false,
      natural: () => 60 + (ta.caption ? 17 : 0),
      draw: (x, y, w, h) => drawTradeArea(p2!, ta, x, y, w, h, osw, body, gold),
    });
  }
  if (gallery.length === 1) {
    // A single gallery photo reads far better as a full-width banner (contained at
    // its own aspect) than as a small centred 4:3 cell — so the rendering is legible.
    const g = gallery[0];
    p2blocks.push({
      title: input.titles?.photos || 'PHOTOS', weight: 2.2, border: true,
      natural: (w) => w * (g.height / g.width),
      draw: (x, y, w, h) => drawContainTop(p2!, g, x, y, w, h),
    });
  } else if (gallery.length) p2blocks.push({
    title: input.titles?.photos || 'PHOTOS', weight: 1.9, border: false,
    // The grid holds the photos' 4:3, so it can't use a taller box — say so up front
    // and the leftover goes to the map instead of becoming a hole in the page.
    natural: (w) => photoGridHeight(gallery.length, w),
    draw: (x, y, w, h) => drawPhotoGrid(p2!, gallery, x, y, w, h, LINE),
  });
  // Floor plan is the key page-2 visual — weight it to fill most of the width so the
  // site plan is actually legible rather than a small centred letterbox.
  if (floor) p2blocks.push({ title: input.titles?.floorPlan || 'FLOOR PLAN', weight: 2.6, border: true, natural: (w) => w * (floor.height / floor.width), draw: (x, y, w, h) => drawContainTop(p2!, floor!, x, y, w, h) });
  // Where it sits. A hand-made aerial (lot outlined) wins over the generated one, and
  // there is only ever one: a single aerial at full width reads; two at half size don't.
  const siteAerial = (await Promise.all((input.siteAerials || []).slice(0, 1).map(embed))).find((g): g is PDFImage => !!g);
  if (siteAerial) {
    p2blocks.push({
      title: input.titles?.siteAerial || 'SITE AERIAL', weight: 1.6, border: true,
      natural: (w) => w * (siteAerial.height / siteAerial.width),
      draw: (x, y, w, h) => drawContainTop(p2!, siteAerial, x, y, w, h),
    });
  } else if (aerial) p2blocks.push({ title: 'AREA MAP', weight: 1.4, border: true, natural: (w) => w * (aerial.height / aerial.width), draw: (x, y, w, h) => {
    const r = drawContainTop(p2!, aerial!, x, y, w, h);
    drawMapLabels(p2!, r, aerial!, input.aerialLabels, labelFont);
    return r;
  } });

  if (p2blocks.length) {
    p2 = pdf.addPage([W, H]);
    p2.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
    const b2H = 72, b2Y = H - b2H;
    p2.drawRectangle({ x: 0, y: b2Y, width: W, height: b2H, color: BLACK });
    if (brand) drawWordmark(p2, 22, b2Y + b2H - 26, 12.5, 2.6);
    else p2.drawText(badge, { x: 22, y: b2Y + b2H - 24, size: 13, font: osw, color: WHITE });
    const a2 = fitSize(addr, osw, W - 44, 24, 12);
    p2.drawText(addr, { x: 22, y: b2Y + 14, size: a2, font: osw, color: gold });

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
      // `ignoreEncryption` lets an encrypted PDF LOAD, but the content streams stay
      // encrypted — copyPages then yields a page that is silently, perfectly blank.
      // A blank sheet where the disclosure should be is worse than no sheet, because
      // it looks like the IABS is there. Refuse it and say so.
      if (iabs.isEncrypted) {
        console.error('[flyer] IABS is encrypted — not appending (it would be a blank page). Decrypt it first: qpdf --decrypt in.pdf out.pdf');
      } else {
        const pages = await pdf.copyPages(iabs, iabs.getPageIndices());
        for (const pg of pages) pdf.addPage(pg);
      }
    } catch (e) { console.error('[flyer] IABS append failed', e); }
  }

  return pdf.save();
}
