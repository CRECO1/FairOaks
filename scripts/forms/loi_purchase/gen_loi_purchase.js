// Generate the CRECO "Letter of Intent to Purchase" as a BLANK fillable template,
// in the same gold letterhead as the Lease LOIs (../lib/branding). Transcribed from
// the 8000 Fair Oaks Plaza LOI so the blank template and its fillable-field
// coordinates come from a single source of truth.
//
// Unlike the Lease LOIs — whose term text is static and whose blanks are short —
// EVERY value here is a field: the term paragraphs themselves are editable. Each
// field carries a `default` (this deal's language), seeded into the Transaction Doc
// editor via crm_form_fields.default_value so an agent starts from the standard
// terms and edits any of them.
//
// Long values are recorded as ONE FIELD PER WRAPPED LINE (`feasibility_period_l2`,
// …). The editor renders each field as a single-line input and the filled-PDF
// builder draws it as a single unwrapped line, so per-line fields keep what the
// agent sees pinned to what actually prints. Retyping a line longer than the
// column will run past the right margin rather than re-flowing.
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { loadBranding, drawHeader, drawFooter, CONTENT_BOTTOM } = require('../lib/branding');

(async () => {
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const bold  = await doc.embedFont(StandardFonts.TimesRomanBold);
  const { logo, italic } = await loadBranding(doc);

  const PW = 612, PH = 792, M = 72, RIGHT = PW - M;
  const BODY = 10.5, TITLE = 15;
  const lh = BODY * 1.26;
  const LABELW = 142, VALX = M + LABELW;      // label column | value column
  const ink = rgb(0.09, 0.09, 0.12);
  const lineCol = rgb(0.45, 0.45, 0.5);

  let page, y, pageIndex = -1;
  const fields = [];

  // ── The terms: label : default value. Every one is an editable field. ──
  // Purchase Price and Earnest Money are deliberately ILLUSTRATIVE, not the real
  // figures from the deal this was transcribed from — this template is visible to
  // every commercial agent. Don't restore the original numbers.
  const TERMS = [
    ['seller', 'Seller:', 'Fair Oaks Executive Plaza LLC'],
    ['purchaser', 'Purchaser:', 'Partners Holdings – Legacy Founder LLC /or assigns'],
    ['property', 'Property:', 'CB 4709C BLK LOT 8000 8000 FAIR OAKS PKWY AT FAIR OAKS RANCH'],
    ['purchase_price', 'Purchase Price:', '$6,000,000. Six million'],
    ['earnest_money', 'Earnest Money:', 'The earnest money will be ($60,000.00) and escrowed within 3 business days of fully executed purchase and sales agreement.'],
    ['title_company', 'Title Company:', 'Alamo Title Company, Closing Agent Nefi Miramontes'],
    ['title_policy', 'Title Policy:', 'Seller will pay for all costs associated with the title policy and escrow fees at closing.'],
    ['survey', 'Survey:', 'Sellers will pay for an updated survey during the feasibility period if required'],
    ['possession', 'Possession:', 'Purchaser will take possession of the Property at Closing with funding.'],
    ['feasibility_period', 'Feasibility Period:', 'forty-five (45) days from time of fully executed purchase and sales agreement, with the option to extend feasibility by an additional 20 days by depositing an additional $25,000.00 of hard earnest money (applicable towards the purchase price).'],
    ['closing_schedule', 'Closing Schedule:', 'The Property will be closed within thirty (30) days after feasibility'],
    ['option_fee', 'Option Fee:', 'Buyer will have the option to cancel contract at any time during the feasibility period with an option fee of $1,000.00. If canceled during feasibility, option fee will be paid to the seller from the earnest money.'],
    ['environmental', 'Environmental:', 'Seller to provide any and all recent environmental reports showing the property is in clean condition.'],
    ['property_expenses', 'Property Expenses:', 'The current taxes, interest, rents, and utilities, if any, will be prorated and adjusted as of the date of closing.'],
    ['purchasers_default', 'Purchaser’s Default:', 'In the event Purchaser should fail to consummate the purchase of the Property, Seller’s sole remedy will be the retention of the Earnest Money.'],
    ['time_of_essence', 'Time is of the essence:', 'This proposal expires on February 3rd, 2026 at 5:00 PM Central Time.'],
  ];

  // Human labels for the non-term fields (shown as the input's placeholder).
  const LABELS = {
    loi_date: 'Letter date',
    addressee_name: 'Addressee — name', addressee_addr1: 'Addressee — street',
    addressee_addr2: 'Addressee — city, state ZIP', re_line: 'Re: line',
    agent_name: 'Your name (broker)', agent_email: 'Your email', agent_phone: 'Your phone',
    seller_1_name: 'Seller signatory 1 — name', seller_1_by: 'Seller 1 — BY',
    seller_1_its: 'Seller 1 — Its', seller_1_date: 'Seller 1 — Date',
    seller_2_name: 'Seller signatory 2 — name', seller_2_by: 'Seller 2 — BY',
    seller_2_its: 'Seller 2 — Its', seller_2_date: 'Seller 2 — Date',
  };

  function newPage() {
    page = doc.addPage([PW, PH]); pageIndex++;
    drawFooter(page, { times, italic, PW, M });
    y = pageIndex === 0 ? drawHeader(page, { logo, times, PW, M }) : PH - M;
  }
  function ensure(h) { if (y - h < CONTENT_BOTTOM) newPage(); }

  // Record a fillable box. `def` becomes crm_form_fields.default_value, which the
  // editor seeds as the field's starting text (an agent prefill still wins).
  function recordField(key, x, baselineY, w, label, def) {
    fields.push({
      page: pageIndex + 1, fx: (x - 2) / PW, fy: (PH + 2 - baselineY) / PH, fw: w / PW,
      type: 'text', field_key: key, label: label || LABELS[key] || key, default: def || '',
    });
  }
  // A blank to be filled in by hand (signature lines) — underlined, no default.
  function blankField(key, x, baselineY, w) {
    page.drawLine({ start: { x, y: baselineY - 1.5 }, end: { x: x + w, y: baselineY - 1.5 }, thickness: 0.7, color: lineCol });
    recordField(key, x, baselineY, w, LABELS[key], '');
  }

  // Greedy wrap of `str` to `maxW` at `size`. Long unbreakable tokens get their own
  // line rather than being split mid-word.
  function wrapText(str, font, size, maxW) {
    const words = String(str).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && font.widthOfTextAtSize(next, size) > maxW) { lines.push(cur); cur = w; }
      else cur = next;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  // Static (non-editable) paragraph flowed across the full column width.
  function staticBlock(str, gap = 8, font = times, size = BODY) {
    const lines = wrapText(str, font, size, RIGHT - M);
    ensure(lines.length * lh + gap);
    lines.forEach((l, i) => page.drawText(l, { x: M, y: y - i * lh, size, font, color: ink }));
    y -= lines.length * lh + gap;
  }
  function centered(text, size, font) {
    const w = font.widthOfTextAtSize(text, size);
    ensure(size * 1.8);
    page.drawText(text, { x: (PW - w) / 2, y, size, font, color: ink });
    y -= size * 1.9;
  }
  function spacer(h) { ensure(h); y -= h; }

  // A field occupying its own line(s), left-aligned at `x` — used for the date,
  // addressee and sign-off. Multi-line values are split one field per line.
  function fieldBlock(key, x, w, def, gap = 0) {
    const lines = wrapText(def, times, BODY, w);
    ensure(lines.length * lh + gap);
    lines.forEach((l, i) => recordField(
      lines.length > 1 ? `${key}_l${i + 1}` : key, x, y - i * lh, w,
      (LABELS[key] || key) + (lines.length > 1 ? ` (line ${i + 1})` : ''), l));
    y -= lines.length * lh + gap;
  }

  // Term row: bold label in the left column, the value as one editable field per
  // wrapped line in the right column. The row never splits across a page.
  function termRow(key, label, value, gap = 5) {
    const lblLines = wrapText(label, bold, BODY, LABELW - 8);
    const valLines = wrapText(value, times, BODY, RIGHT - VALX);
    const n = Math.max(lblLines.length, valLines.length);
    ensure(n * lh + gap);
    lblLines.forEach((l, i) => page.drawText(l, { x: M, y: y - i * lh, size: BODY, font: bold, color: ink }));
    valLines.forEach((l, i) => recordField(
      valLines.length > 1 ? `${key}_l${i + 1}` : key, VALX, y - i * lh, RIGHT - VALX,
      label.replace(/:$/, '') + (valLines.length > 1 ? ` (line ${i + 1})` : ''), l));
    y -= n * lh + gap;
  }

  // ── Page 1: branded letterhead ──────────────────────────────────────────────
  newPage();

  fieldBlock('loi_date', M, 170, 'January 28, 2026', 16);
  fieldBlock('addressee_name', M, 320, 'FAIR OAKS EXECUTIVE PLAZA LLC');
  fieldBlock('addressee_addr1', M, 320, '8000 FAIR OAKS PKWY STE 102');
  fieldBlock('addressee_addr2', M, 320, 'FAIR OAKS RANCH, TX 78015-4742', 14);

  page.drawText('Re:', { x: M, y, size: BODY, font: bold, color: ink });
  fieldBlock('re_line', M + 30, RIGHT - (M + 30),
    'Letter of Intent to Purchase – 8000 Fair Oaks Pkwy, Fair Oaks Ranch, TX 78015', 16);

  centered('Letter of Intent to Purchase', TITLE, bold);
  spacer(8);

  // ── Terms ───────────────────────────────────────────────────────────────────
  for (const [key, label, value] of TERMS) termRow(key, label, value);

  // ── Closing boilerplate (static — the standard non-binding language) ─────────
  spacer(8);
  staticBlock('This letter of intent is merely a guide to the preparation of a mutually satisfactory contract and nothing in this letter of intent will be construed to preclude any other provisions from being inserted into the agreement at the request of either party.', 10);
  staticBlock('This letter of intent is non-binding on either party until an actual purchase agreement is drafted, agreed upon and executed by both parties.', 10);
  staticBlock('Should the above be acceptable to you, please indicate your acceptance by execution of this letter of intent in the space provided below.', 16);

  // ── Sign-off — reuses agent_* so it auto-fills from the logged-in agent ──────
  ensure(4 * lh + 16);
  staticBlock('Sincerely,', 14);
  fieldBlock('agent_name', M, 260, 'Zachary A. Stovall');
  fieldBlock('agent_email', M, 260, 'zack@crecotx.com');
  fieldBlock('agent_phone', M, 260, '(210) 355-8683', 20);

  // ── Two seller acceptance blocks — blank, kept together on one page ──────────
  const SIGW = 250, LABX = M + 44;
  function acceptanceBlock(n) {
    ensure(5 * 24 + 16);
    page.drawText('AGREED TO & ACCEPTED BY:', { x: M, y, size: 9.5, font: bold, color: ink });
    y -= 26;
    blankField(`seller_${n}_name`, M, y, SIGW + 44); y -= 24;
    for (const [lab, key] of [['BY:', `seller_${n}_by`], ['Its:', `seller_${n}_its`], ['Date:', `seller_${n}_date`]]) {
      page.drawText(lab, { x: M, y, size: BODY, font: times, color: ink });
      blankField(key, LABX, y, SIGW);
      y -= 24;
    }
  }
  page.drawText('Seller:', { x: M, y, size: BODY, font: bold, color: ink });
  y -= 20;
  acceptanceBlock(1);
  spacer(14);
  acceptanceBlock(2);

  // ── save ────────────────────────────────────────────────────────────────────
  const bytes = await doc.save();
  const out = __dirname;
  fs.writeFileSync(out + '/loi_purchase.pdf', bytes);
  fs.writeFileSync(out + '/fields.json', JSON.stringify(fields, null, 2));
  const withDefaults = fields.filter(f => f.default).length;
  console.log('pages:', doc.getPageCount(), '· boxes:', fields.length,
    '· with defaults:', withDefaults, '· blank:', fields.length - withDefaults);
  console.log('pages used:', JSON.stringify(fields.reduce((a, f) => (a[f.page] = (a[f.page] || 0) + 1, a), {})));
})().catch(e => { console.error(e); process.exit(1); });
