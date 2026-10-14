// Runtime generator for CRECO's letter-style Letters of Intent, ported from
// scripts/forms/loi_purchase/gen_loi_purchase.js + scripts/forms/lib/branding.js so
// the SAME branded letterhead and term layout render in the browser at fill time.
//
// Unlike the static templates (baked labels + fixed overlay fields), this builds the
// whole document from an editable term list: rows the agent removes simply aren't in
// `data.terms`, so everything below reflows and the signature blocks follow the
// content instead of sitting at fixed coordinates. The acceptance blocks emit
// PlacedField coordinates (`sigFields`) in the exact shape crm_form_submissions.values
// stores, so the existing e-sign send/stamp flow works with zero changes.
//
// One renderer, several documents: a LoiSpec supplies the title, the standard term
// list, the closing boilerplate and the acceptance heading. Purchase and Lease share
// everything else.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { parseRich, drawRichText, countRichLines, type RichFonts } from '@/lib/rich-text';
import { LOI_PURCHASE_SPEC, SELLER_ROLES, type LoiSpec, type LoiPurchaseData, type LoiTermRow, type LoiSigField, type LoiSeller } from '@/lib/loi-spec';

// Existing importers keep working: everything that moved is re-exported from here.
export * from '@/lib/loi-spec';

// Times/Helvetica are WinAnsi-only — fold smart punctuation to ASCII so drawText
// never throws on a character outside the encoding.
const sane = (s: unknown): string =>
  String(s ?? '').replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');

const PW = 612, PH = 792, M = 72, RIGHT = PW - M;
const BODY = 10.5, TITLE = 15, lh = BODY * 1.26;
const LABELW = 142, VALX = M + LABELW;
const CONTENT_BOTTOM = 80, FOOTER_RULE_Y = 64, LOGO_W = 240;
const ink = rgb(0.09, 0.09, 0.12);
const lineCol = rgb(0.45, 0.45, 0.5);
const BLACK = rgb(0.11, 0.11, 0.12), GRAY = rgb(0.34, 0.36, 0.40), ITAL = rgb(0.20, 0.20, 0.22);
const HEAD_CONTACT = '8000 Fair Oaks Pkwy, Suite 100, Fair Oaks Ranch, TX 78015      •      (210) 817-3443      •      crecotx.com';
const FOOT_TAG = 'Where your real estate ventures find the support they deserve';
const FOOT_CONTACT = '8000 Fair Oaks Pkwy, Suite 100, Fair Oaks Ranch, TX 78015   |   (210) 817-3443   |   info@crecotx.com   |   crecotx.com';

function wrapText(str: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = sane(str).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && font.widthOfTextAtSize(next, size) > maxW) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export async function renderLoi(
  data: LoiPurchaseData,
  logoBytes: Uint8Array,
  spec: LoiSpec = LOI_PURCHASE_SPEC,
  /** Image for spec.exhibit (JPEG or PNG). Omitted → no exhibit page. */
  exhibitBytes?: Uint8Array,
): Promise<{ pdfBytes: Uint8Array; sigFields: LoiSigField[] }> {
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const boldItalic = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const rich: RichFonts = { reg: times, bold, ital: italic, boldItal: boldItalic };
  // Editable values carry inline **bold**/*italic* markup; sanitize then parse to runs.
  const runs = (s: string) => parseRich(sane(s));
  const logo = await doc.embedPng(logoBytes);

  let page!: PDFPage, y = 0, pageIndex = -1;
  const sigFields: LoiSigField[] = [];

  const center = (pg: PDFPage, text: string, cy: number, size: number, font: PDFFont, color = ink) =>
    pg.drawText(sane(text), { x: (PW - font.widthOfTextAtSize(sane(text), size)) / 2, y: cy, size, font, color });

  function drawFooter(pg: PDFPage) {
    pg.drawLine({ start: { x: M, y: FOOTER_RULE_Y }, end: { x: PW - M, y: FOOTER_RULE_Y }, thickness: 2.4, color: BLACK });
    center(pg, FOOT_TAG, FOOTER_RULE_Y - 13, 8.5, italic, ITAL);
    center(pg, FOOT_CONTACT, FOOTER_RULE_Y - 24, 7.5, times, GRAY);
  }
  function drawHeader(pg: PDFPage): number {
    const h = LOGO_W * (logo.height / logo.width);
    const logoY = PH - 30 - h;
    pg.drawImage(logo, { x: (PW - LOGO_W) / 2, y: logoY, width: LOGO_W, height: h });
    let hy = logoY - 13;
    center(pg, HEAD_CONTACT, hy, 8, times, GRAY);
    hy -= 9;
    pg.drawLine({ start: { x: M, y: hy }, end: { x: PW - M, y: hy }, thickness: 2.4, color: BLACK });
    return hy - 20;
  }
  function newPage() {
    page = doc.addPage([PW, PH]); pageIndex++;
    drawFooter(page);
    y = pageIndex === 0 ? drawHeader(page) : PH - M;
  }
  function ensure(h: number) { if (y - h < CONTENT_BOTTOM) newPage(); }
  function spacer(h: number) { ensure(h); y -= h; }

  function staticBlock(str: string, gap = 8, font: PDFFont = times, size = BODY) {
    const lines = wrapText(str, font, size, RIGHT - M);
    ensure(lines.length * lh + gap);
    lines.forEach((l, i) => page.drawText(l, { x: M, y: y - i * lh, size, font, color: ink }));
    y -= lines.length * lh + gap;
  }
  // A left-aligned editable line (date, addressee, sign-off) — rich, one drawn line per wrap.
  function leftBlock(str: string, x: number, w: number, gap = 0) {
    const r = runs(str);
    const n = countRichLines(r, rich, BODY, w);
    ensure(n * lh + gap);
    drawRichText({ page, runs: r, x, y, size: BODY, lineHeight: lh, maxW: w, fonts: rich, color: ink });
    y -= n * lh + gap;
  }
  // Term row: bold label (left column) + rich value flowed in the right column. Never splits.
  function termRow(label: string, value: string, gap = 5) {
    const lblLines = wrapText(label, bold, BODY, LABELW - 8);
    const valRuns = runs(value);
    const valCount = countRichLines(valRuns, rich, BODY, RIGHT - VALX);
    const n = Math.max(lblLines.length, valCount);
    ensure(n * lh + gap);
    lblLines.forEach((l, i) => page.drawText(l, { x: M, y: y - i * lh, size: BODY, font: bold, color: ink }));
    drawRichText({ page, runs: valRuns, x: VALX, y, size: BODY, lineHeight: lh, maxW: RIGHT - VALX, fonts: rich, color: ink });
    y -= n * lh + gap;
  }

  // ── Page 1 ──────────────────────────────────────────────────────────────────
  newPage();

  leftBlock(data.loiDate, M, 200, 16);
  if (data.addresseeName) leftBlock(data.addresseeName, M, 340);
  if (data.addresseeAddr1) leftBlock(data.addresseeAddr1, M, 340);
  if (data.addresseeAddr2) leftBlock(data.addresseeAddr2, M, 340, 14);

  if (data.reLine) {
    page.drawText('Re:', { x: M, y, size: BODY, font: bold, color: ink });
    leftBlock(data.reLine, M + 30, RIGHT - (M + 30), 16);
  } else { spacer(6); }

  center(page, spec.title, y, TITLE, bold); y -= TITLE * 1.9;
  if (data.subtitle?.trim()) { center(page, data.subtitle.trim(), y + TITLE * 0.55, BODY, times); y -= BODY * 1.2; }
  spacer(8);
  // Tenant-rep letters open with a salutation + the "on behalf of our client" paragraph.
  if (data.intro?.trim()) {
    staticBlock('Dear Sir or Madam,', 10);
    leftBlock(data.intro.trim(), M, RIGHT - M, 12);
  }

  // ── Terms (dynamic — removed rows simply aren't here) ────────────────────────
  for (const t of data.terms) {
    if (!t.label && !t.value) continue;
    termRow(t.label || '', t.value || '');
  }

  // ── Other Stipulations (free text) ───────────────────────────────────────────
  if (data.additionalTerms && data.additionalTerms.trim()) {
    spacer(4);
    ensure(lh + 6);
    page.drawText('Other Stipulations:', { x: M, y, size: BODY, font: bold, color: ink });
    y -= lh + 2;
    for (const para of data.additionalTerms.split(/\n+/).map(s => s.trim()).filter(Boolean)) {
      const r = runs(para);
      const n = countRichLines(r, rich, BODY, RIGHT - M);
      ensure(n * lh + 6);
      drawRichText({ page, runs: r, x: M, y, size: BODY, lineHeight: lh, maxW: RIGHT - M, fonts: rich, color: ink });
      y -= n * lh + 6;
    }
  }

  // ── Closing boilerplate (standard non-binding language) ──────────────────────
  spacer(8);
  spec.boilerplate.forEach((p, i) => staticBlock(p, i === spec.boilerplate.length - 1 ? 16 : 10));

  // ── Sign-off ─────────────────────────────────────────────────────────────────
  staticBlock('Sincerely,', 14);
  if (data.agentName) leftBlock(data.agentName, M, 320);
  if (data.agentEmail) leftBlock(data.agentEmail, M, 320);
  if (data.agentPhone) leftBlock(data.agentPhone, M, 320, 20);

  // ── Acceptance block(s) — emit signature + date PlacedFields ─────────────────
  const SIGW = 250, LABX = M + 64;
  function recordSig(x: number, baselineY: number, w: number, type: string, role: string) {
    sigFields.push({ page: pageIndex + 1, fx: x / PW, fy: (PH - baselineY) / PH, fw: w / PW, type, signerRole: role });
  }
  function acceptanceBlock(seller: LoiSeller, role: string) {
    ensure(5 * 24 + 16);
    page.drawText('AGREED TO & ACCEPTED BY:', { x: M, y, size: 9.5, font: bold, color: ink });
    y -= 26;
    // Entity / name line (baked)
    page.drawLine({ start: { x: M, y: y - 1.5 }, end: { x: M + SIGW + 44, y: y - 1.5 }, thickness: 0.7, color: lineCol });
    if (seller.entity) drawRichText({ page, runs: runs(seller.entity), x: M + 2, y, size: BODY, lineHeight: lh, maxW: Infinity, fonts: rich, color: ink });
    y -= 24;
    const rows: Array<[string, 'signature' | 'name' | 'date']> = [['Signature:', 'signature'], ['Name:', 'name'], ['Date:', 'date']];
    for (const [lab, kind] of rows) {
      page.drawText(lab, { x: M, y, size: BODY, font: times, color: ink });
      page.drawLine({ start: { x: LABX, y: y - 1.5 }, end: { x: LABX + SIGW, y: y - 1.5 }, thickness: 0.7, color: lineCol });
      if (kind === 'signature') recordSig(LABX, y, SIGW, 'signature', role);
      else if (kind === 'date') recordSig(LABX, y, SIGW, 'date', role);
      else if (seller.signatory) drawRichText({ page, runs: runs(seller.signatory), x: LABX + 2, y, size: BODY, lineHeight: lh, maxW: Infinity, fonts: rich, color: ink });
      y -= 24;
    }
  }
  spacer(6);
  if (spec.partyHeading) {
    page.drawText(spec.partyHeading, { x: M, y, size: BODY, font: bold, color: ink });
    y -= 20;
  }
  const sellers = (data.sellers && data.sellers.length ? data.sellers : [{ entity: '', signatory: '' }]).slice(0, 2);
  sellers.forEach((s, i) => { if (i > 0) spacer(14); acceptanceBlock(s, SELLER_ROLES[i] ?? 'client'); });

  // ── Exhibit page (e.g. Elkhorn Point "Exhibit A - Site Plan") ────────────────
  // Its own page after the acceptance block, image scaled to fit inside the margins.
  if (spec.exhibit && exhibitBytes && exhibitBytes.length) {
    const isPng = exhibitBytes[0] === 0x89 && exhibitBytes[1] === 0x50;
    const img = isPng ? await doc.embedPng(exhibitBytes) : await doc.embedJpg(exhibitBytes);
    newPage();
    center(page, spec.exhibit.title, y, TITLE, bold); y -= TITLE * 1.6;
    const maxW = RIGHT - M, maxH = y - CONTENT_BOTTOM - 8;
    const k = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * k, h = img.height * k;
    page.drawImage(img, { x: (PW - w) / 2, y: y - h, width: w, height: h });
    y -= h;
  }

  const pdfBytes = await doc.save();
  return { pdfBytes, sigFields };
}
