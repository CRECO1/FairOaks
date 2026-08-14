// Runtime generator for the CRECO "Letter of Intent to Purchase", ported from
// scripts/forms/loi_purchase/gen_loi_purchase.js + scripts/forms/lib/branding.js so
// the SAME branded letterhead and term layout render in the browser at fill time.
//
// Unlike the static template (baked labels + fixed overlay fields), this builds the
// whole document from an editable term list: rows the agent removes simply aren't in
// `data.terms`, so everything below reflows and the signature blocks follow the
// content instead of sitting at fixed coordinates. The seller acceptance blocks emit
// PlacedField coordinates (`sigFields`) in the exact shape crm_form_submissions.values
// stores, so the existing e-sign send/stamp flow works with zero changes.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { parseRich, drawRichText, countRichLines, type RichFonts } from '@/lib/rich-text';

export interface LoiTermRow { label: string; value: string; id?: string }
export interface LoiSeller { entity: string; signatory: string }
export interface LoiPurchaseData {
  loiDate: string;
  addresseeName: string;
  addresseeAddr1: string;
  addresseeAddr2: string;
  reLine: string;
  terms: LoiTermRow[];
  additionalTerms: string;        // free-text "Other Stipulations" block ('' = omit)
  agentName: string;
  agentEmail: string;
  agentPhone: string;
  sellers: LoiSeller[];           // 1–2 acceptance blocks
}
// Matches crm_form_submissions.values entries + esign.ts PlacedField.
export interface LoiSigField { page: number; fx: number; fy: number; fw: number; type: string; signerRole: string }

// The standard starting terms an agent edits from. Deal-specific rows start blank;
// the process/boilerplate rows carry the standard CRECO language. Commission is new.
export const DEFAULT_LOI_TERMS: LoiTermRow[] = [
  { label: 'Seller:', value: '' },
  { label: 'Purchaser:', value: '' },
  { label: 'Property:', value: '' },
  { label: 'Purchase Price:', value: '' },
  { label: 'Earnest Money:', value: 'The earnest money will be ($________) and escrowed within 3 business days of fully executed purchase and sales agreement.' },
  { label: 'Title Company:', value: '' },
  { label: 'Title Policy:', value: 'Seller will pay for all costs associated with the title policy and escrow fees at closing.' },
  { label: 'Survey:', value: 'Seller will pay for an updated survey during the feasibility period if required.' },
  { label: 'Possession:', value: 'Purchaser will take possession of the Property at Closing with funding.' },
  { label: 'Feasibility Period:', value: 'Forty-five (45) days from time of fully executed purchase and sales agreement, with the option to extend feasibility by an additional 20 days by depositing an additional $25,000.00 of hard earnest money (applicable towards the purchase price).' },
  { label: 'Closing Schedule:', value: 'The Property will be closed within thirty (30) days after feasibility.' },
  { label: 'Option Fee:', value: 'Buyer will have the option to cancel contract at any time during the feasibility period with an option fee of $1,000.00. If canceled during feasibility, option fee will be paid to the seller from the earnest money.' },
  { label: 'Environmental:', value: 'Seller to provide any and all recent environmental reports showing the property is in clean condition.' },
  { label: 'Property Expenses:', value: 'The current taxes, interest, rents, and utilities, if any, will be prorated and adjusted as of the date of closing.' },
  { label: "Purchaser's Default:", value: "In the event Purchaser should fail to consummate the purchase of the Property, Seller's sole remedy will be the retention of the Earnest Money." },
  { label: 'Commission:', value: 'Seller shall pay a real estate commission of ____% of the purchase price to CRECO Commercial at closing, pursuant to a separate written agreement.' },
  { label: 'Time is of the essence:', value: 'This proposal expires on ____________ at 5:00 PM Central Time.' },
];

// Two non-agent e-sign roles the send modal already offers, one per seller block.
export const SELLER_ROLES = ['client', 'landlord'] as const;

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
const HEAD_CONTACT = '8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015      •      (210) 817-3443      •      crecotx.com';
const FOOT_TAG = 'Where your real estate ventures find the support they deserve';
const FOOT_CONTACT = '8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015   |   (210) 817-3443   |   info@crecotx.com   |   crecotx.com';

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

export async function renderLoiPurchase(
  data: LoiPurchaseData,
  logoBytes: Uint8Array,
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

  center(page, 'Letter of Intent to Purchase', y, TITLE, bold); y -= TITLE * 1.9;
  spacer(8);

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
  staticBlock('This letter of intent is merely a guide to the preparation of a mutually satisfactory contract and nothing in this letter of intent will be construed to preclude any other provisions from being inserted into the agreement at the request of either party.', 10);
  staticBlock('This letter of intent is non-binding on either party until an actual purchase agreement is drafted, agreed upon and executed by both parties.', 10);
  staticBlock('Should the above be acceptable to you, please indicate your acceptance by execution of this letter of intent in the space provided below.', 16);

  // ── Sign-off ─────────────────────────────────────────────────────────────────
  staticBlock('Sincerely,', 14);
  if (data.agentName) leftBlock(data.agentName, M, 320);
  if (data.agentEmail) leftBlock(data.agentEmail, M, 320);
  if (data.agentPhone) leftBlock(data.agentPhone, M, 320, 20);

  // ── Seller acceptance block(s) — emit signature + date PlacedFields ──────────
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
  page.drawText('Seller:', { x: M, y, size: BODY, font: bold, color: ink });
  y -= 20;
  const sellers = (data.sellers && data.sellers.length ? data.sellers : [{ entity: '', signatory: '' }]).slice(0, 2);
  sellers.forEach((s, i) => { if (i > 0) spacer(14); acceptanceBlock(s, SELLER_ROLES[i] ?? 'client'); });

  const pdfBytes = await doc.save();
  return { pdfBytes, sigFields };
}
