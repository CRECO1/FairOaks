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

// Everything that differs between the Purchase LOI and the Lease LOI.
export interface LoiSpec {
  kind: 'purchase' | 'lease';
  title: string;                 // centred document title + saved submission title
  partyHeading: string;          // heading above the acceptance blocks ("Seller:" / "Landlord:")
  partyNoun: string;             // used in placeholders ("Seller 1 — entity / name")
  boilerplate: string[];
  defaultTerms: LoiTermRow[];
  // Recovering a doc that was filled in the OLD overlay editor: term label → the
  // template field_key(s) that carried its value. 'replace' swaps the whole row
  // value; 'blanks' drops each key's value into the row's successive ____ blanks
  // (the lease template embedded its blanks inside standard sentences).
  overlayKeys: Record<string, string[]>;
  overlayFill: 'replace' | 'blanks';
  overlayMeta: {
    date?: string; addresseeName?: string; addresseeAddr1?: string; addresseeAddr2?: string;
    reLine?: string; agentName?: string; agentEmail?: string; agentPhone?: string;
    party1Entity?: string; party1Signatory?: string; party2Entity?: string; party2Signatory?: string;
  };
}

// ── Purchase ────────────────────────────────────────────────────────────────
// The standard starting terms an agent edits from. Deal-specific rows start blank;
// the process/boilerplate rows carry the standard CRECO language.
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

export const LOI_PURCHASE_SPEC: LoiSpec = {
  kind: 'purchase',
  title: 'Letter of Intent to Purchase',
  partyHeading: 'Seller:',
  partyNoun: 'Seller',
  boilerplate: [
    'This letter of intent is merely a guide to the preparation of a mutually satisfactory contract and nothing in this letter of intent will be construed to preclude any other provisions from being inserted into the agreement at the request of either party.',
    'This letter of intent is non-binding on either party until an actual purchase agreement is drafted, agreed upon and executed by both parties.',
    'Should the above be acceptable to you, please indicate your acceptance by execution of this letter of intent in the space provided below.',
  ],
  defaultTerms: DEFAULT_LOI_TERMS,
  // The old purchase template had NO Commission row — recovered docs still get it.
  overlayKeys: {
    'Seller:': ['seller'], 'Purchaser:': ['purchaser'], 'Property:': ['property'], 'Purchase Price:': ['purchase_price'],
    'Earnest Money:': ['earnest_money'], 'Title Company:': ['title_company'], 'Title Policy:': ['title_policy'], 'Survey:': ['survey'],
    'Possession:': ['possession'], 'Feasibility Period:': ['feasibility_period'], 'Closing Schedule:': ['closing_schedule'],
    'Option Fee:': ['option_fee'], 'Environmental:': ['environmental'], 'Property Expenses:': ['property_expenses'],
    "Purchaser's Default:": ['purchasers_default'], 'Time is of the essence:': ['time_of_essence'],
  },
  overlayFill: 'replace',
  overlayMeta: {
    date: 'loi_date', addresseeName: 'addressee_name', addresseeAddr1: 'addressee_addr1', addresseeAddr2: 'addressee_addr2',
    reLine: 're_line', agentName: 'agent_name', agentEmail: 'agent_email', agentPhone: 'agent_phone',
    party1Entity: 'seller_1_name', party1Signatory: 'seller_1_its', party2Entity: 'seller_2_name', party2Signatory: 'seller_2_its',
  },
};

// ── Lease ───────────────────────────────────────────────────────────────────
// Mirrors the Office/Industrial letter LOI the team already sends: the same rows,
// with the standard CRECO language kept as the row's starting value so an agent
// only fills the blanks (or deletes the row).
// NB: the ________ blanks mirror exactly what the old overlay template captured —
// e.g. rental_rate held "$22/sf" and lease_term held "99 month lease term.", so those
// blanks stand alone rather than sitting inside "$__/sf" or "__ month" scaffolding.
// Getting this wrong doubles the text when an old doc is recovered into the builder.
const LEASE_TERMS_COMMON: LoiTermRow[] = [
  { label: 'Premises:', value: 'Approximately ________ rentable square feet ("RSF"), subject to final architectural plans.' },
  { label: 'Lease Term:', value: '________' },
  { label: 'Lease Commencement:', value: '________' },
  { label: 'Rent Commencement:', value: '________' },
  { label: 'Rental Rate:', value: '________ with ________ annual escalations.' },
  { label: "First Month's Rent:", value: 'Due upon Lease execution (________).' },
  { label: 'Security Deposit:', value: "Due upon Lease execution, equal to the last month's rent (________)." },
  { label: 'Operating Expenses:', value: 'NNN, estimated to be ________.' },
  { label: 'Parking:', value: '________' },
  { label: 'Tenant Improvement Allowance:', value: '________' },
  { label: 'HVAC:', value: 'Landlord will turn over the HVAC in good working order. Tenant agrees to maintain and pay for a quarterly service contract on the HVAC units and will provide receipts to Landlord upon request. However, if an HVAC unit requires replacement at any time during the Lease term, Landlord accepts full replacement responsibility and expense.' },
];
const LEASE_TERMS_TAIL: LoiTermRow[] = [
  { label: 'Space Planning:', value: 'Landlord shall, in addition to the TIA, pay an amount equal to $0.15 per RSF for space planning, or the amount necessary for space planning and pricing notes.' },
  { label: 'Fair Market Rental Rate:', value: '"FMRR" shall mean the rental rate charged by landlords for space comparable to the Premises in size, condition, and building quality, and as further defined in the Lease. Should Tenant and Landlord not agree on the FMRR, it will be submitted to a third party for binding arbitration.' },
  { label: 'CAM (NNN) Reconciliation:', value: 'Landlord shall reconcile actual operating expenses annually and provide Tenant with a written statement.' },
  { label: 'Broker Fee:', value: 'Landlord shall pay a real estate commission of ________ to CRECO Commercial pursuant to a separate written agreement.' },
  { label: 'Time is of the essence:', value: 'This proposal expires on ____________ at 5:00 PM Central Time.' },
];
// Asset-type flavour: the rows that only make sense for one building type.
const OFFICE_ROWS: LoiTermRow[] = [
  { label: 'Office Furniture:', value: 'Existing office furniture will remain in the space.' },
];
const INDUSTRIAL_ROWS: LoiTermRow[] = [
  { label: 'Loading:', value: '________ dock-high door(s) and ________ grade-level door(s).' },
  { label: 'Clear Height:', value: '________ feet clear.' },
];

export type LeaseAsset = 'office' | 'industrial' | 'generic' | 'shortterm';

// A staged lease: a short storage-only period rolling into the full term. Written
// from the TENANT's side (Tenant proposes; Landlord countersigns), and the numbered
// sections of that letter map to term rows — the label carries the section heading.
const SHORTTERM_TERMS: LoiTermRow[] = [
  { label: 'Premises:', value: 'Approximately ________ rentable square feet located at ________, including approximately ________ square feet in the rear portion of the Premises that has limited utility for Tenant\u2019s operations.' },
  { label: 'Term \u2014 Short-Term Storage Period:', value: 'An initial period of ________ during which Tenant\u2019s use of the Premises will be limited to storage.' },
  { label: 'Term \u2014 Long-Term Lease Period:', value: 'A primary term of ________ for Tenant\u2019s full intended operation, commencing at the end of the short-term storage period.' },
  { label: 'Base Rent \u2014 Short Term:', value: 'Base Rent of $________/SF/year during the short-term storage period.' },
  { label: 'Base Rent \u2014 Long Term:', value: 'Base Rent of $________/SF/year with ____% annual base rent escalations.' },
  { label: 'Governmental Approval Contingency:', value: 'The Lease shall be contingent upon Tenant obtaining all governmental approvals necessary for Tenant\u2019s intended operation, including, but not limited to, zoning approvals, permits, and a Certificate of Occupancy. Tenant shall diligently pursue such approvals within the timelines reasonably required by the applicable governmental authorities. If such approvals cannot be obtained despite Tenant\u2019s diligent efforts, Tenant shall have the right to terminate the Lease without penalty, and any security deposit and unused prepaid rent shall be refunded.' },
  { label: 'Right of First Refusal to Purchase:', value: 'If Landlord receives a bona fide third-party offer that Landlord intends to accept, Tenant shall have the right to purchase the Property on the same material terms and conditions. Landlord will give Tenant early notice prior to formally listing the Property for sale, to provide Tenant the ability to purchase before offers are formally taken.' },
  { label: 'Purchase During the Lease Term:', value: 'If Tenant purchases the Property during the lease term: the Lease shall automatically terminate at closing; no early termination penalty shall apply; and any unused security deposit and prepaid rent shall be credited to Tenant at closing.' },
  { label: 'Adjacent Space Expansion Rights:', value: 'Tenant requests advance written notice if either adjacent tenant\u2019s lease will expire, terminate, or not be renewed; a Right of First Offer (ROFO) to lease either adjacent space before it is offered to another tenant; and reasonable access to the information necessary to evaluate the adjacent space.' },
  { label: 'Due Diligence:', value: 'Tenant is continuing to coordinate with the applicable governmental authorities regarding zoning, permitting, and regulatory requirements for the proposed operation. Additional site visits may be required with contractors and consultants. If upgrades to the electrical service, sprinkler system, or other building systems are required to support Tenant\u2019s intended operation, the parties shall discuss an appropriate allocation of those improvement costs, including potential tenant improvement allowances, rent concessions, and/or rent abatement.' },
  { label: 'Brokerage & Expenses:', value: 'Except as otherwise agreed in the definitive Lease, each party shall bear its own costs and expenses (including attorneys\u2019 fees) incurred in connection with the negotiation and documentation of the Lease. Any real estate brokerage commissions shall be paid pursuant to a separate written agreement and disclosed to the parties.' },
  { label: 'Confidentiality:', value: 'The parties shall keep the terms of this letter of intent and the negotiations between them confidential and shall not disclose such information to any third party, except to their respective attorneys, accountants, lenders, and advisors on a need-to-know basis, or as otherwise required by law.' },
  { label: 'Expiration of Offer:', value: 'Unless the parties commence good-faith negotiation of a definitive Lease, or Landlord delivers a countersigned copy of this letter of intent, on or before ____________ the terms set forth herein shall automatically expire and be of no further force or effect.' },
];

const LEASE_OVERLAY_KEYS: Record<string, string[]> = {
  // Each row's blanks fill in order from these template field_keys.
  'Premises:': ['rentable_sf'],
  'Lease Term:': ['lease_term'],
  'Lease Commencement:': ['commencement_date'],
  'Rent Commencement:': ['rent_commencement_date'],
  'Rental Rate:': ['rental_rate', 'escalation'],
  "First Month's Rent:": ['first_month_rent'],
  'Security Deposit:': ['security_deposit'],
  'Operating Expenses:': ['opex'],
  'Parking:': ['parking'],
  'Tenant Improvement Allowance:': ['ti_allowance'],
  'Broker Fee:': ['broker_fee'],
};

export function leaseTerms(asset: LeaseAsset): LoiTermRow[] {
  if (asset === 'shortterm') return SHORTTERM_TERMS;   // its own structure, not common + flavour
  const flavour = asset === 'industrial' ? INDUSTRIAL_ROWS : asset === 'office' ? OFFICE_ROWS : [];
  return [...LEASE_TERMS_COMMON, ...flavour, ...LEASE_TERMS_TAIL];
}

export function leaseSpec(asset: LeaseAsset = 'generic'): LoiSpec {
  return {
    kind: 'lease',
    title: 'Letter of Intent to Lease',
    partyHeading: 'Landlord:',
    partyNoun: 'Landlord',
    // The staged letter states its own non-binding effect as a numbered term, so it
    // only needs the closing acceptance line here.
    boilerplate: asset === 'shortterm'
      ? [
        'This letter of intent is intended solely to summarize the principal terms currently proposed and to facilitate preparation of a definitive Lease. It is not a binding or enforceable agreement, and neither party shall have any obligation to the other unless and until a definitive written Lease is executed and delivered by both parties.',
        'Should the above be acceptable to you, please indicate your acceptance by execution of this letter of intent in the space provided below.',
      ]
      : [
        'This letter of intent is merely a guide to the preparation of a mutually satisfactory contract and nothing in this letter of intent will be construed to preclude any other provisions from being inserted into the agreement at the request of either party.',
        'This letter of intent is non-binding on either party until an actual lease agreement is drafted, agreed upon and executed by both parties.',
        'Should the above be acceptable to you, please indicate your acceptance by execution of this letter of intent in the space provided below.',
      ],
    defaultTerms: leaseTerms(asset),
    overlayKeys: LEASE_OVERLAY_KEYS,
    overlayFill: 'blanks',
    overlayMeta: {
      date: 'loi_date', addresseeName: 'landlord_name',
      reLine: 'property_address', agentName: 'agent_name', agentEmail: 'agent_email', agentPhone: 'agent_phone',
      party1Entity: 'landlord_name',
    },
  };
}

// Which spec a form uses. The three lease templates (generic / Office / Industrial)
// all share the LOI-LEASE code and differ only in their starting term list.
export const LOI_PURCHASE_CODE = 'LOI-PURCHASE';
export const LOI_LEASE_CODE = 'LOI-LEASE';

export function assetFromFormName(name: string): LeaseAsset {
  const n = (name || '').toLowerCase();
  if (n.includes('short')) return 'shortterm';      // check first — "Short-Term Industrial" is still staged
  if (n.includes('industrial')) return 'industrial';
  if (n.includes('office')) return 'office';
  return 'generic';
}

// Pick the builder spec for a form, or null when the form isn't a builder doc.
export function specForForm(formCode: string | null | undefined, formName = ''): LoiSpec | null {
  if (formCode === LOI_PURCHASE_CODE) return LOI_PURCHASE_SPEC;
  if (formCode === LOI_LEASE_CODE) return leaseSpec(assetFromFormName(formName));
  return null;
}

// Two non-agent e-sign roles the send modal already offers, one per acceptance block.
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

export async function renderLoi(
  data: LoiPurchaseData,
  logoBytes: Uint8Array,
  spec: LoiSpec = LOI_PURCHASE_SPEC,
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
  page.drawText(spec.partyHeading, { x: M, y, size: BODY, font: bold, color: ink });
  y -= 20;
  const sellers = (data.sellers && data.sellers.length ? data.sellers : [{ entity: '', signatory: '' }]).slice(0, 2);
  sellers.forEach((s, i) => { if (i > 0) spacer(14); acceptanceBlock(s, SELLER_ROLES[i] ?? 'client'); });

  const pdfBytes = await doc.save();
  return { pdfBytes, sigFields };
}
