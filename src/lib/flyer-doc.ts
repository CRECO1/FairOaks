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

const W = 792, H = 612;   // US Letter, landscape — the Elkhorn Point standard
// Matches the letterhead used on the LOIs — a rule, the tagline, the company line.
const FOOT_COMPANY = 'CRECO — Commercial Real Estate Company   |   8000 Fair Oaks Pkwy, Suite 100, Fair Oaks Ranch, TX 78015   |   crecotx.com';

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
  // Header title + line under it (the property's name and its address). Absent = the address is the title.
  title?: string | null;
  subtitle?: string | null;
  // One footer row per agent. Absent = built from agentNames + contacts.
  agents?: Array<{ name: string; phone?: string; email?: string }> | null;
  hero?: { bytes: Uint8Array; png: boolean } | null;
  galleryPhotos?: Array<{ bytes: Uint8Array; png: boolean }>;   // page-2 gallery (pre-cropped ~4:3)
  mapBytes?: Uint8Array | null;        // page-1 location map (PNG)
  aerialBytes?: Uint8Array | null;     // page-2 aerial map (PNG)
  // Cover overlay (standard look; the `brand` look has its own): a one-line headline + a stat row printed over the bottom of the
  // cover photo, on a dark fade (`coverShade`, a PNG with an alpha ramp the caller builds — a raster fade, because stacked
  // translucent bands show seams in some viewers). All optional; nothing is drawn unless there is a headline or stats.
  headline?: string | null;
  kicker?: string | null;                                       // small gold caps line above the headline
  coverStats?: Array<{ value: string; label: string }> | null;  // up to 4, e.g. traffic / population / income
  coverShade?: Uint8Array | null;
  mapCredit?: string | null;           // credit line to print on the page-1 map (OSM tiles require one)
  aerialCredit?: string | null;        // credit line to print on the page-2 aerial map
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
    headlineAt?: 'top' | 'bottom'; // 'top' tucks kicker + headline under the wordmark, clear of a building low in the frame
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

/** Credit line in a map's bottom-right corner. Printed as PDF text (not baked into the image) so it always has a font. */
function drawMapCredit(page: PDFPage, r: Rect, text: string | null | undefined, font: PDFFont) {
  if (!text) return;
  const size = 5.6, w = font.widthOfTextAtSize(text, size) + 6;
  page.drawRectangle({ x: r.x + r.w - w - 1, y: r.y + 1, width: w, height: size + 4, color: rgb(1, 1, 1), opacity: 0.82 });
  page.drawText(text, { x: r.x + r.w - w + 2, y: r.y + 3.4, size, font, color: rgb(0.29, 0.33, 0.38) });
}

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
/**
 * Height/width for the page-2 area map so it matches the space the other blocks leave in the landscape layout.
 * Mirrors the placement in renderFlyer: one visual fills the page; two sit side by side (a lone 4:3 photo takes
 * 470pt, the map the remaining column); three put the gallery left and the plan + map stacked right. A hand-made
 * site aerial has its own aspect, so the default stands there.
 */
export function areaMapAspect(o: { gallery: number; trade: boolean; floorAspect: number; siteAerial: boolean }): number {
  const DEFAULT = 540 / 700;
  if (o.siteAerial) return DEFAULT;
  const AW = W - 56, G = 16, CAP = 30, AH = 444, IH = AH - CAP;
  const n = (o.gallery ? 1 : 0) + (o.floorAspect > 0 ? 1 : 0) + 1;
  let wMap: number, hMap: number;
  if (n === 1) { wMap = AW; hMap = IH; }
  else if (n === 2) {
    if (o.gallery === 1) { wMap = AW - G - 470; hMap = 470 * 0.75; }
    else if (o.gallery > 1) { wMap = (AW - G) / 2; hMap = IH; }
    else { wMap = (AW - G) / 2; hMap = Math.min(IH, wMap * o.floorAspect); }
  } else { wMap = (AW - G) / 2; hMap = (AH - G) / 2 - CAP; }
  return Math.max(0.3, Math.min(1.5, hMap / wMap));
}
// Lay pre-cropped (~4:3) photos into a grid filling the box.
function drawPhotoGrid(page: PDFPage, imgs: PDFImage[], x: number, y: number, w: number, h: number, line: RGB): Rect {
  const n = imgs.length; if (!n) return { x, y: y + h, w: 0, h: 0 };
  const cols = n <= 2 ? 1 : 2;
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

  // ── Landscape layout — the Elkhorn Point standard ───────────────────────────
  // Letter, landscape. Page 1: a white header (two-tone tracked title, address, gold kicker), a full-width photo with a
  // dark label chip and headline band, three columns of facts, and a dark contact footer with the logo on a white
  // block. Later pages carry the photos / plan / map, each under a dark caption bar. Same bones as the hand-built
  // Elkhorn Point flyer, so every listing reads at that level.
  const M = 28, HEAD_H = 66, FOOT_H = 68;
  const GREY = rgb(0.45, 0.47, 0.5), HAIR = rgb(0.84, 0.85, 0.87), SOFT = rgb(0.74, 0.76, 0.79);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const badge = sanitize(input.badge).toUpperCase();
  const kickParts = sanitize(input.kicker || '').split(/\s*·\s*/).map(s => s.trim()).filter(Boolean);
  const propType = kickParts[0] || '', propPlace = kickParts.slice(1).join(', ');

  // Title: the property's name, last word in gold (a brand wordmark overrides). Falls back to the address.
  const titleText = sanitize(input.title || input.address).toUpperCase();
  const tw = titleText.split(/\s+/);
  const [t1, t2] = brand ? brand.wordmark.map(t => sanitize(t).toUpperCase())
    : tw.length > 1 ? [tw.slice(0, -1).join(' '), tw[tw.length - 1]] : [titleText, ''];
  const subtitle = sanitize(input.subtitle ?? (input.title ? input.address : ''));

  const drawHeader = (pg: PDFPage, right: string) => {
    const maxW = W - 2 * M - 240;
    let ts = 25;
    const width = () => spacedWidth(t1, body, ts, ts * 0.17) + (t2 ? ts * 0.5 + spacedWidth(t2, body, ts, ts * 0.17) : 0);
    while (width() > maxW && ts > 12) ts -= 0.5;
    const w1 = drawSpaced(pg, t1, M, H - 40, ts, body, INK, ts * 0.17);
    if (t2) drawSpaced(pg, t2, M + w1 + ts * 0.5, H - 40, ts, body, gold, ts * 0.17);
    if (subtitle) pg.drawText(subtitle, { x: M, y: H - 56, size: 9.5, font: body, color: GREY });
    const r = sanitize(right).toUpperCase();
    if (r) { let rs = 8.5; while (spacedWidth(r, body, rs, 2.2) > 300 && rs > 6) rs -= 0.5; drawSpaced(pg, r, W - M - spacedWidth(r, body, rs, 2.2), H - 33, rs, body, gold, 2.2); }
    pg.drawLine({ start: { x: M, y: H - HEAD_H }, end: { x: W - M, y: H - HEAD_H }, thickness: 0.75, color: HAIR });
  };

  // Footer: dark bar, thin gold rule above, one row per agent (name | phone | email), the company line, and the logo
  // on a white block at the right.
  const emails = input.contacts.filter(c => c.includes('@'));
  const phone = input.contacts.find(c => !c.includes('@') && /\d{3}\D*\d{4}/.test(c)) || '';
  const agents = (input.agents?.length ? input.agents : input.agentNames.map((n, i) => ({ name: n, phone, email: emails[i] || '' }))).slice(0, 3);
  const drawFooter = (pg: PDFPage) => {
    pg.drawRectangle({ x: 0, y: 0, width: W, height: FOOT_H, color: BLACK });
    pg.drawRectangle({ x: 0, y: FOOT_H, width: W, height: 2.2, color: gold });
    const lw = 176;
    pg.drawRectangle({ x: W - lw, y: 0, width: lw, height: FOOT_H, color: WHITE });
    if (logo) drawContain(pg, logo, W - lw + 10, 6, lw - 20, FOOT_H - 10);
    const rows = agents.length >= 3 ? [51, 38, 25] : agents.length === 2 ? [49, 33] : [44];
    agents.forEach((a, i) => {
      const y = rows[i];
      drawSpaced(pg, sanitize(a.name).toUpperCase(), M, y, 10, body, WHITE, 2.2);
      if (a.phone) { pg.drawText('|', { x: 236, y, size: 10, font: body, color: gold }); pg.drawText(sanitize(a.phone), { x: 250, y, size: 10, font: body, color: WHITE }); }
      if (a.email) { pg.drawText('|', { x: 346, y, size: 10, font: body, color: gold }); pg.drawText(sanitize(a.email), { x: 360, y, size: 10, font: body, color: WHITE }); }
    });
    if (agents.length < 3) pg.drawText(FOOT_COMPANY, { x: M, y: 13, size: 7.3, font: body, color: SOFT });
  };

  // ── PAGE 1 ───────────────────────────────────────────────────────────────────
  const p1 = pdf.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
  const heroTop = H - HEAD_H, heroH = 236, heroY = heroTop - heroH;
  if (hero) drawCover(p1, hero, 0, heroY, W, heroH);
  else { p1.drawRectangle({ x: 0, y: heroY, width: W, height: heroH, color: rgb(0.9, 0.91, 0.93) }); p1.drawText('Add a property photo', { x: W / 2 - 60, y: heroY + heroH / 2, size: 12, font: body, color: rgb(0.6, 0.63, 0.67) }); }
  // drawCover can spill past its box: paint the header and body areas back to white before anything else lands on them.
  p1.drawRectangle({ x: 0, y: heroTop, width: W, height: HEAD_H, color: WHITE });
  p1.drawRectangle({ x: 0, y: 0, width: W, height: heroY, color: WHITE });
  drawHeader(p1, [propType, badge].filter(Boolean).join(' · '));

  // Dark label chip, top-left of the photo, and the headline band across its foot.
  const chip = sanitize(brand?.kicker || badge).toUpperCase();
  const chipW = spacedWidth(chip, body, 14, 4.2) + 44;
  p1.drawRectangle({ x: M, y: heroTop - 50, width: chipW, height: 38, color: BLACK, opacity: 0.9 });
  drawSpaced(p1, chip, M + 22, heroTop - 50 + 13, 14, body, gold, 4.2);
  const headline = sanitize(brand?.headline || input.headline || '').trim().toUpperCase();
  if (headline) {
    p1.drawRectangle({ x: 0, y: heroY, width: W, height: 46, color: BLACK, opacity: 0.88 });
    const hs = fitSize(headline, osw, W - 2 * M, 25, 14);
    p1.drawText(headline, { x: M, y: heroY + 15, size: hs, font: osw, color: WHITE });
  }

  // Three columns under the photo.
  const colTop = heroY - 22, colBottom = FOOT_H + 20;
  const c1x = M, c1w = 300, c2x = M + 326, c2w = 190, c3x = c2x + 216, c3w = W - M - c3x;
  const secTitle = (t: string, x: number) => drawSpaced(p1, t, x, colTop - 10, 11, body, gold, 2.6);

  // Column 1 — the one bold sentence that says what this is, a short paragraph if there is room, then the bullets.
  // Whole sentences and whole bullets only: anything that doesn't fit is left out, never trailed off.
  const DESC_SIZE = 9, DESC_LEAD = 12.4, LEAD_SIZE = 10.2, LEAD_LEAD = 13.4;
  const HL_SIZE = 9.2, HL_ROW = 14.5, HL_WRAP = 11.5, HL_MAX = 6;
  const hl = (input.highlights || []).map(s => sanitize(s).trim()).filter(Boolean).slice(0, HL_MAX);
  const sentences = sanitize(input.description || 'Contact the listing agent for full property details.')
    .replace(/\s*\n+\s*/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9$~"'])/).map(t => t.trim()).filter(Boolean);
  const leadLines = wrapText(sentences[0] || '', bold, LEAD_SIZE, c1w).slice(0, 2);
  const hlHeights = hl.map(h => HL_ROW + (wrapText(h, body, HL_SIZE, c1w - 14).length - 1) * HL_WRAP);
  const hlWant = hlHeights.reduce((a, b) => a + b, 0);
  secTitle(hl.length ? 'PROPERTY HIGHLIGHTS' : 'OVERVIEW', c1x);
  let ly = colTop - 33;
  for (const ln of leadLines) { p1.drawText(ln, { x: c1x, y: ly, size: LEAD_SIZE, font: bold, color: INK }); ly -= LEAD_LEAD; }
  ly -= 4;
  const room = ly - colBottom - hlWant - 6;
  let para: string[] = [];
  for (let n = 2; n <= sentences.length; n++) {
    const lines = wrapText(sentences.slice(1, n).join(' '), body, DESC_SIZE, c1w);
    if (lines.length * DESC_LEAD > room) break;
    para = lines;
  }
  for (const ln of para) { p1.drawText(ln, { x: c1x, y: ly, size: DESC_SIZE, font: body, color: BODY }); ly -= DESC_LEAD; }
  if (para.length) ly -= 6;
  hl.forEach((h, i) => {
    if (ly - hlHeights[i] + HL_ROW < colBottom) return;
    const lines = wrapText(h, body, HL_SIZE, c1w - 14);
    p1.drawEllipse({ x: c1x + 3, y: ly + 3, xScale: 2, yScale: 2, color: gold });
    lines.forEach((ln, j) => { p1.drawText(ln, { x: c1x + 13, y: ly, size: HL_SIZE, font: body, color: INK }); if (j < lines.length - 1) ly -= HL_WRAP; });
    ly -= HL_ROW;
  });

  // A label / value table with a hairline under each row (Elkhorn's "Available" and "Demographics" columns).
  const table = (rows: Array<[string, string]>, x: number, w: number, top: number) => {
    let y = top;
    for (const [label, value] of rows) {
      const lab = sanitize(label), val = sanitize(value) || '—';
      p1.drawText(lab, { x, y, size: 9, font: body, color: GREY });
      const vs = fitSize(val, body, w - body.widthOfTextAtSize(lab, 9) - 12, 9.6, 6.5);
      p1.drawText(val, { x: x + w - body.widthOfTextAtSize(val, vs), y, size: vs, font: body, color: INK });
      p1.drawLine({ start: { x, y: y - 7 }, end: { x: x + w, y: y - 7 }, thickness: 0.6, color: HAIR });
      y -= 23;
    }
    return y;
  };

  // Column 2 — the facts.
  const facts: Array<[string, string]> = [['Type', propType], ['Location', propPlace], ['Size', input.statSize], ['Lot', input.statLot || ''], ['Zoning', input.statZoning || ''], ['Pricing', input.statPrice]]
    .filter(([, v]) => v && v !== '—') as Array<[string, string]>;
  secTitle('AVAILABLE', c2x);
  table(facts, c2x, c2w, colTop - 34);

  // Column 3 — trade-area numbers when the listing has them, otherwise the location map.
  const tiles = (input.tradeArea?.tiles?.length ? input.tradeArea.tiles : input.coverStats || []).filter(t => t && t.value && t.label).slice(0, 4);
  if (tiles.length) {
    secTitle('TRADE AREA', c3x);
    const endY = table(tiles.map(t => [t.label, t.value] as [string, string]), c3x, c3w, colTop - 34);
    if (input.tradeArea?.caption) wrapText(sanitize(input.tradeArea.caption), body, 7, c3w).slice(0, 3).forEach((ln, i) => p1.drawText(ln, { x: c3x, y: endY + 10 - i * 9, size: 7, font: body, color: GREY }));
  } else {
    secTitle('LOCATION', c3x);
    const mTop = colTop - 24, mH = mTop - colBottom;
    if (map) { const r = drawContainTop(p1, map, c3x, colBottom, c3w, mH); p1.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: HAIR, borderWidth: 0.75 }); drawMapCredit(p1, r, input.mapCredit, body); }
    else p1.drawRectangle({ x: c3x, y: colBottom, width: c3w, height: mH, color: rgb(0.95, 0.96, 0.97), borderColor: HAIR, borderWidth: 0.75 });
  }
  drawFooter(p1);

  // ── PAGE 2 — adaptive: only added when there's a gallery / floor plan / aerial ─
  const siteAerial = (await Promise.all((input.siteAerials || []).slice(0, 1).map(embed))).find((g): g is PDFImage => !!g);
  let p2: PDFPage | null = null;
  const visuals: Array<{ title: string; kind: 'gallery' | 'floor' | 'map'; draw: (x: number, y: number, w: number, h: number) => Rect }> = [];
  if (gallery.length) visuals.push({ title: input.titles?.photos || 'PHOTOS', kind: 'gallery', draw: (x, y, w, h) => drawPhotoGrid(p2!, gallery, x, y, w, h, HAIR) });
  if (floor) visuals.push({ title: input.titles?.floorPlan || 'FLOOR PLAN', kind: 'floor', draw: (x, y, w, h) => drawContainTop(p2!, floor, x, y, w, h) });
  // Where it sits. A hand-made aerial (lot outlined) wins over the generated one, and there is only ever one.
  if (siteAerial) visuals.push({ title: input.titles?.siteAerial || 'SITE AERIAL', kind: 'map', draw: (x, y, w, h) => drawContainTop(p2!, siteAerial, x, y, w, h) });
  else if (aerial) visuals.push({ title: 'AREA MAP', kind: 'map', draw: (x, y, w, h) => {
    const r = drawContainTop(p2!, aerial, x, y, w, h);
    drawMapLabels(p2!, r, aerial, input.aerialLabels, labelFont);
    drawMapCredit(p2!, r, input.aerialCredit, body);
    return r;
  } });

  if (visuals.length) {
    p2 = pdf.addPage([W, H]);
    p2.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
    drawHeader(p2, visuals.map(v => v.title).join(' · '));
    const top = H - HEAD_H - 16, areaH = top - (FOOT_H + 18), areaW = W - 2 * M, CAP = 30, G = 16;
    // Each visual is drawn in a box CAP shorter than its slot; the dark caption bar sits right under what was drawn.
    const place = (v: (typeof visuals)[number], x: number, w: number, yTop: number, h: number) => {
      const r = v.draw(x, yTop - (h - CAP), w, h - CAP);
      if (r.w <= 0) return;
      p2!.drawRectangle({ x: r.x, y: r.y - CAP, width: r.w, height: CAP, color: BLACK });
      drawSpaced(p2!, sanitize(v.title).toUpperCase(), r.x + 14, r.y - CAP + 11, 10, body, gold, 2.6);
    };
    if (visuals.length === 1) place(visuals[0], M, areaW, top, areaH);
    else if (visuals.length === 2) {
      // A lone photo is a 4:3 that fills most of the page height at 470pt wide; the map takes the rest.
      const leftW = visuals[0].kind === 'gallery' && gallery.length === 1 ? 470 : (areaW - G) / 2;
      place(visuals[0], M, leftW, top, areaH);
      place(visuals[1], M + leftW + G, areaW - G - leftW, top, areaH);
    } else {
      const leftW = (areaW - G) / 2, half = (areaH - G) / 2;
      place(visuals[0], M, leftW, top, areaH);
      place(visuals[1], M + leftW + G, areaW - G - leftW, top, half);
      place(visuals[2], M + leftW + G, areaW - G - leftW, top - half - G, half);
    }
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
