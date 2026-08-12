// Generate the CRECO letter-style "Letter of Intent to Lease" as a BLANK fillable
// template (the Office/Industrial layout the user likes — a two-column label:value
// letter). Rebranded from the original Caisson LOI into the CRECO gold format.
// Records each blank's page + fractional x/y/w + field_key so values fill in the
// Transaction Doc editor; the sign-off block reuses agent_name/phone/email so it
// auto-fills from the logged-in agent (CRMApp agentPrefill).
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

(async () => {
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const bold  = await doc.embedFont(StandardFonts.TimesRomanBold);

  const PW = 612, PH = 792, M = 72, RIGHT = PW - M;
  const BODY = 10.5, TITLE = 15;
  const lh = BODY * 1.34;
  const LABELW = 138, VALX = M + LABELW;      // label column | value column
  const ink = rgb(0.09, 0.09, 0.12);
  const lineCol = rgb(0.45, 0.45, 0.5);
  const GOLD = rgb(0.79, 0.57, 0.17);
  const GRAY = rgb(0.40, 0.42, 0.46);

  let page, y, pageIndex = -1;
  const fields = [];

  const LABELS = {
    loi_date: 'LOI date', landlord_name: 'Recipient / landlord name',
    property_address: 'Property address', building_name: 'Building name',
    rentable_sf: 'Rentable SF', lease_term: 'Lease term',
    commencement_date: 'Lease commencement', rent_commencement_date: 'Rent commencement',
    rental_rate: 'Rental rate ($/SF)', escalation: 'Annual escalation',
    first_month_rent: 'First month’s rent', security_deposit: 'Security deposit',
    opex: 'Operating expenses (NNN)', parking: 'Parking', ti_allowance: 'TI allowance',
    broker_fee: 'Broker fee', agent_name: 'Your name (broker)',
    agent_phone: 'Your phone', agent_email: 'Your email',
  };
  const FW = {
    loi_date: 130, landlord_name: 150, property_address: 250, building_name: 175,
    rentable_sf: 56, lease_term: 200, commencement_date: 120, rent_commencement_date: 120,
    rental_rate: 86, escalation: 46, first_month_rent: 80, security_deposit: 80,
    opex: 70, parking: 120, ti_allowance: 300, broker_fee: 120,
    agent_name: 210, agent_phone: 110, agent_email: 170,
  };

  function newPage() { page = doc.addPage([PW, PH]); pageIndex++; y = PH - M; }
  function ensure(h) { if (y - h < M) newPage(); }
  function recordField(key, x, baselineY, w) {
    fields.push({ page: pageIndex + 1, fx: (x - 2) / PW, fy: (PH + 2 - baselineY) / PH, fw: w / PW, type: 'text', field_key: key, label: LABELS[key] || key });
  }
  function drawFieldInline(key, x, baselineY, w) {
    page.drawLine({ start: { x, y: baselineY - 1.5 }, end: { x: x + w, y: baselineY - 1.5 }, thickness: 0.6, color: lineCol });
    recordField(key, x, baselineY, w);
    return x + w;
  }

  // Tokenize parts (strings | {f:key} | {b:text}) into word/space/field tokens.
  function tokenize(parts, boldAll) {
    const toks = [];
    const words = (str, b) => { for (const c of str.split(/(\s+)/)) { if (c === '') continue; toks.push(/^\s+$/.test(c) ? { t: 'sp' } : { t: 'w', s: c, bold: b }); } };
    for (const part of parts) {
      if (typeof part === 'string') words(part, boldAll);
      else if (part.b != null) words(part.b, true);
      else toks.push({ t: 'f', key: part.f, w: FW[part.f] });
    }
    return toks;
  }
  // Flow tokens within column [x0,x1] starting at baseline topY. Wraps; in dry mode
  // it only counts lines (no draw, no field record). Returns { lines, endY }.
  function flowCol(parts, x0, x1, topY, opts = {}) {
    const size = opts.size || BODY, boldAll = !!opts.boldAll, dry = !!opts.dry;
    const toks = tokenize(parts, boldAll);
    let x = x0, yy = topY, lines = 1, lineStart = true;
    // Accumulate consecutive same-font words into ONE run, spaces inside the
    // string, so intra-line spacing is font-native. (pdf-lib draws each drawText
    // as a separate positioned op; poppler can drop the gap between two ops after
    // all-caps tokens like "HVAC". One string per run avoids that entirely.)
    let run = '', runX = x0, runFont = times;
    const flush = () => { if (run && !dry) page.drawText(run, { x: runX, y: yy, size, font: runFont, color: ink }); run = ''; };
    for (const tk of toks) {
      const f = tk.bold ? bold : times;
      if (tk.t === 'sp') { if (!lineStart) { x += (run ? runFont : times).widthOfTextAtSize(' ', size); if (run) run += ' '; } continue; }
      const w = tk.t === 'w' ? f.widthOfTextAtSize(tk.s, size) : tk.w;
      if (!lineStart && x + w > x1) { flush(); yy -= lh; lines++; x = x0; lineStart = true; }
      if (tk.t === 'w') {
        if (!run) { runX = x; runFont = f; }
        else if (f !== runFont) { flush(); runX = x; runFont = f; }
        run += tk.s; x += w;
      } else {
        flush(); if (!dry) drawFieldInline(tk.key, x, yy, w); x += w; runX = x;
      }
      lineStart = false;
    }
    flush();
    return { lines, endY: yy };
  }

  // Full-width flowed block (M..RIGHT).
  function block(parts, gap = 6, opts = {}) {
    const n = flowCol(parts, M, RIGHT, y, { ...opts, dry: true }).lines;
    ensure(n * lh + gap);
    flowCol(parts, M, RIGHT, y, opts);
    y -= n * lh + gap;
  }
  // Label:value row — label wraps in the left column, value in the right; the row
  // is as tall as the taller side, and never splits across a page.
  function row(label, valueParts, gap = 8) {
    const lblN = flowCol([{ b: label }], M, VALX - 8, y, { dry: true }).lines;
    const valN = flowCol(valueParts, VALX, RIGHT, y, { dry: true }).lines;
    const n = Math.max(lblN, valN);
    ensure(n * lh + gap);
    flowCol([{ b: label }], M, VALX - 8, y, { boldAll: true });
    flowCol(valueParts, VALX, RIGHT, y, {});
    y -= n * lh + gap;
  }
  function spacer(h) { ensure(h); y -= h; }
  function centered(text, size, font, color) {
    const w = font.widthOfTextAtSize(text, size);
    ensure(size * 1.6);
    page.drawText(text, { x: (PW - w) / 2, y, size, font, color: color || ink });
    y -= size * 1.7;
  }
  function sigLine(labelX, label, from, to, rowY) {
    page.drawText(label, { x: labelX, y: rowY, size: BODY, font: times, color: ink });
    page.drawLine({ start: { x: from, y: rowY - 1.5 }, end: { x: to, y: rowY - 1.5 }, thickness: 0.7, color: lineCol });
  }

  // ── Letterhead ──────────────────────────────────────────────────────────────
  newPage();
  {
    const brand = 'CRECO';
    const bw = bold.widthOfTextAtSize(brand, 17);
    page.drawText(brand, { x: (PW - bw) / 2, y, size: 17, font: bold, color: GOLD });
    y -= 15;
    const info = '8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015   •   (210) 817-3443   •   crecotx.com';
    const iw = times.widthOfTextAtSize(info, 8.5);
    page.drawText(info, { x: (PW - iw) / 2, y, size: 8.5, font: times, color: GRAY });
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 1.2, color: GOLD });
    y -= 22;
  }
  centered('LETTER OF INTENT TO LEASE', TITLE, bold);
  spacer(10);

  block([{ f: 'loi_date' }], 12);
  block([{ b: 'RE:  Letter of Intent to Lease — ' }, { f: 'property_address' }], 14);
  block(['Dear ', { f: 'landlord_name' }, ','], 12);
  block(['We are pleased to issue this Letter of Intent (“LOI”) on behalf of our client for lease space in the building known as ', { f: 'building_name' }, ' (the “Building”) on the following terms:'], 14);

  // ── Terms (label : value) ─────────────────────────────────────────────────────
  row('Premises:', ['Approximately ', { f: 'rentable_sf' }, ' rentable square feet (“RSF”), subject to final architectural plans.']);
  row('Lease Term:', [{ f: 'lease_term' }]);
  row('Lease Commencement:', [{ f: 'commencement_date' }]);
  row('Rent Commencement:', [{ f: 'rent_commencement_date' }]);
  row('Rental Rate:', [{ f: 'rental_rate' }, ' with ', { f: 'escalation' }, ' annual escalations.']);
  row('First Month’s Rent:', ['Due upon Lease execution (', { f: 'first_month_rent' }, ').']);
  row('Security Deposit:', ['Due upon Lease execution, equal to the last month’s rent (', { f: 'security_deposit' }, ').']);
  row('Operating Expenses:', ['NNN, estimated to be ', { f: 'opex' }, '.']);
  row('Parking:', [{ f: 'parking' }]);
  row('Tenant Improvement Allowance:', [{ f: 'ti_allowance' }]);
  row('HVAC:', ['Landlord will turn over the HVAC in good working order. Tenant agrees to maintain and pay for a quarterly service contract on the HVAC units and will provide receipts to Landlord upon request. However, if an HVAC unit requires replacement at any time during the Lease term, Landlord accepts full replacement responsibility and expense.']);
  row('Office Furniture:', ['Existing office furniture will remain in the space.']);
  row('Space Planning:', ['Landlord shall, in addition to the TIA, pay an amount equal to $0.15 per RSF for space planning, or the amount necessary for space planning and pricing notes.']);
  row('Fair Market Rental Rate:', ['“FMRR” shall mean the rental rate charged by landlords for space comparable to the Premises in size, condition, and building quality, and as further defined in the Lease. Should Landlord and Tenant not agree on the FMRR, it shall be submitted to a third party for binding arbitration.']);
  row('Right of First Refusal:', ['Tenant shall have a recurring Right of First Refusal (to be further defined in the Lease) on any contiguous space that becomes available during the Term. Tenant shall have ten (10) business days following receipt of written notice from Landlord of the terms of any bona fide offer on such space in which to notify Landlord of its desire to exercise such right on substantially the same terms and conditions.']);
  row('Cancellation Option:', ['Tenant shall have the option to cancel this Lease at the end of the thirty-sixth (36th) month with not less than six (6) months’ prior written notice to Landlord. The cancellation penalty shall be mutually agreeable between Landlord and Tenant.']);
  row('Renewal Option:', ['Tenant shall have the option to renew at 90% of the FMRR for two additional terms of three (3) years each.']);
  row('Compliance With Laws:', ['Upon commencement, the Building and Premises shall, at Landlord’s sole cost and expense, comply with all applicable laws, ordinances, and regulations then in existence, including but not limited to the Americans with Disabilities Act and the National Electrical Code.']);
  row('Signage:', ['Tenant shall have the right to install its name/logo on the Building’s monument sign at no cost throughout the Lease Term.']);
  row('Broker:', ['Landlord shall pay Tenant’s designated Broker, Commercial Real Estate Brokerage, LLC (“CRECO”), a real estate fee equal to ', { f: 'broker_fee' }, ' of the gross aggregate value of the Lease, in accordance with a separate agreement between Landlord and Broker.']);

  // ── Closing ───────────────────────────────────────────────────────────────────
  spacer(6);
  block(['This Letter of Intent is merely a guide to the preparation of a mutually satisfactory contract, and nothing in it will be construed to preclude any other provision from being inserted into the agreement at the request of either party.'], 8);
  block(['This Letter of Intent is non-binding on either party until an actual lease agreement is drafted, agreed upon, and executed by both parties.'], 8);
  block(['Should the above be acceptable to you, please indicate your acceptance by executing this Letter of Intent in the space provided below.'], 14);

  block(['Sincerely,'], 4);
  spacer(16);
  ensure(lh);
  drawFieldInline('agent_name', M, y, FW.agent_name); y -= lh + 3;
  block([{ f: 'agent_phone' }, '        ', { f: 'agent_email' }], 8);

  // ── Two-column signature block ───────────────────────────────────────────────
  spacer(10);
  ensure(110);
  const colR = M + 250;
  page.drawText('AGREED TO & ACCEPTED BY TENANT:', { x: M, y, size: 9.5, font: bold, color: ink });
  page.drawText('AGREED TO & ACCEPTED BY LANDLORD:', { x: colR, y, size: 9.5, font: bold, color: ink });
  y -= 28;
  for (const lab of ['By:', 'Its:', 'Date:']) {
    sigLine(M, lab, M + 34, colR - 22, y);
    sigLine(colR, lab, colR + 34, RIGHT, y);
    y -= 26;
  }

  // ── save ──────────────────────────────────────────────────────────────────────
  const bytes = await doc.save();
  const out = __dirname;
  fs.writeFileSync(out + '/loi_letter.pdf', bytes);
  fs.writeFileSync(out + '/loi_letter.fields.json', JSON.stringify(fields, null, 2));
  const byKey = {};
  for (const f of fields) byKey[f.field_key] = (byKey[f.field_key] || 0) + 1;
  console.log('pages:', doc.getPageCount(), '· boxes:', fields.length, '· keys:', Object.keys(byKey).length);
  console.log('per key:', JSON.stringify(byKey));
})().catch(e => { console.error(e); process.exit(1); });
