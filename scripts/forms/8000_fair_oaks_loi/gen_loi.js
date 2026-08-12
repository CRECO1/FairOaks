// Generate the CRECO "Letter of Intent to Lease" as a BLANK fillable template.
// Mirrors gen_lease.js: as each blank is drawn it records the field's page +
// fractional x/y/w and a shared field_key so repeated values (property address,
// storage-period rent) fill together in the CRM Transaction Doc editor. The
// broker block reuses agent_name/agent_phone/agent_email so it auto-fills from
// the logged-in agent (see CRMApp agentPrefill).
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { loadBranding, drawHeader, drawFooter, CONTENT_BOTTOM } = require('../lib/branding');

(async () => {
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const bold  = await doc.embedFont(StandardFonts.TimesRomanBold);
  const { logo, italic } = await loadBranding(doc);

  const PW = 612, PH = 792;         // US Letter
  const M = 72;                     // 1" margins
  const RIGHT = PW - M;             // 540
  const BODY = 10.5, HEAD = 11, TITLE = 15;
  const ink = rgb(0.09, 0.09, 0.12);
  const lineCol = rgb(0.45, 0.45, 0.5);
  const GOLD = rgb(0.79, 0.57, 0.17);
  const GRAY = rgb(0.40, 0.42, 0.46);

  let page, y, pageIndex = -1;
  const fields = [];

  const LABELS = {
    property_address: 'Property / premises address', loi_date: 'LOI date',
    rentable_sf: 'Rentable SF', rear_sf: 'Rear (limited-use) SF',
    storage_term: 'Storage-period term', lease_term: 'Primary lease term',
    storage_rent: 'Storage-period base rent', lease_rent: 'Long-term base rent',
    escalation: 'Annual escalation', expiration_date: 'Offer expiration date',
    agent_name: 'Your name (submitting broker)', agent_phone: 'Your phone',
    agent_email: 'Your email', landlord_name: 'Landlord name / title',
  };
  const FW = {
    property_address: 250, loi_date: 96, rentable_sf: 58, rear_sf: 52,
    storage_term: 140, lease_term: 140, storage_rent: 96, lease_rent: 96,
    escalation: 46, expiration_date: 100,
    agent_name: 210, agent_phone: 104, agent_email: 168, landlord_name: 220,
  };

  function newPage() {
    page = doc.addPage([PW, PH]); pageIndex++;
    drawFooter(page, { times, italic, PW, M });
    y = pageIndex === 0 ? drawHeader(page, { logo, times, PW, M }) : PH - M;
  }
  function ensure(h) { if (y - h < CONTENT_BOTTOM) newPage(); }

  // record a field at draw-time; convert to the CRM's top-left fractions,
  // matching TransactionDocEditor's stamp math (x = fx*W + 2 ; y = H - fy*H + 2).
  function recordField(key, x, baselineY, w) {
    fields.push({
      page: pageIndex + 1,
      fx: (x - 2) / PW,
      fy: (PH + 2 - baselineY) / PH,
      fw: w / PW,
      type: 'text',
      field_key: key,
      label: LABELS[key] || key,
    });
  }

  function drawFieldInline(key, x, baselineY, font, size) {
    const w = FW[key];
    page.drawLine({ start: { x, y: baselineY - 1.5 }, end: { x: x + w, y: baselineY - 1.5 }, thickness: 0.6, color: lineCol });
    recordField(key, x, baselineY, w);
    return x + w;
  }

  // Paragraph with inline fields and bold runs.
  // parts = array of: string | {f:'key'} (field) | {b:'text'} (bold run).
  function para(parts, opts = {}) {
    const size = opts.size || BODY;
    const font = opts.font || times;
    const indent = opts.indent || 0;
    const lh = size * 1.34;
    const startX = M + indent;
    const maxX = RIGHT;
    const toks = [];
    const pushWords = (str, isBold) => {
      for (const c of str.split(/(\s+)/)) {
        if (c === '') continue;
        if (/^\s+$/.test(c)) toks.push({ t: 'sp' });
        else toks.push({ t: 'w', s: c, bold: isBold });
      }
    };
    for (const part of parts) {
      if (typeof part === 'string') pushWords(part, false);
      else if (part.b != null) pushWords(part.b, true);
      else toks.push({ t: 'f', key: part.f, w: FW[part.f] });
    }
    ensure(lh);
    let x = startX, lineStart = true;
    for (const tk of toks) {
      const f = tk.bold ? bold : font;
      if (tk.t === 'sp') { if (!lineStart) x += f.widthOfTextAtSize(' ', size); continue; }
      const w = tk.t === 'w' ? f.widthOfTextAtSize(tk.s, size) : tk.w;
      if (!lineStart && x + w > maxX) { y -= lh; ensure(lh); x = startX; lineStart = true; }
      if (tk.t === 'w') { page.drawText(tk.s, { x, y, size, font: f, color: ink }); x += w; }
      else { x = drawFieldInline(tk.key, x, y, font, size); }
      lineStart = false;
    }
    y -= lh + (opts.gapAfter != null ? opts.gapAfter : 5);
  }

  function heading(text) {
    ensure(HEAD * 1.6);
    y -= 3;
    page.drawText(text, { x: M, y, size: HEAD, font: bold, color: ink });
    y -= HEAD * 1.5;
  }
  // bullet that accepts para-parts (strings, {f:}, {b:})
  function bullet(parts, opts = {}) {
    const size = BODY, lh = size * 1.34, indent = 22;
    ensure(lh);
    page.drawText('•', { x: M + 8, y, size, font: times, color: ink });
    para(Array.isArray(parts) ? parts : [parts], { indent, gapAfter: opts.gapAfter != null ? opts.gapAfter : 3 });
  }
  function spacer(h) { ensure(h); y -= h; }
  function centered(text, size, font, color) {
    const w = font.widthOfTextAtSize(text, size);
    ensure(size * 1.6);
    page.drawText(text, { x: (PW - w) / 2, y, size, font, color: color || ink });
    y -= size * 1.7;
  }
  function centeredField(key, size) {
    const w = FW[key], x = (PW - w) / 2;
    ensure(size * 1.7);
    page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + w, y: y - 1.5 }, thickness: 0.6, color: lineCol });
    recordField(key, x, y, w);
    y -= size * 1.9;
  }
  function section(title, ...paras) {
    heading(title);
    for (const p of paras) para(p);
  }
  // wet-ink label + rule (no field — signed by hand)
  function sigLine(labelX, label, lineFrom, lineTo, rowY) {
    page.drawText(label, { x: labelX, y: rowY, size: BODY, font: times, color: ink });
    page.drawLine({ start: { x: lineFrom, y: rowY - 1.5 }, end: { x: lineTo, y: rowY - 1.5 }, thickness: 0.7, color: lineCol });
  }

  // ── Page 1: branded logo header (drawn by newPage) + title ──────────────────
  newPage();
  centered('LETTER OF INTENT TO LEASE', TITLE, bold);
  spacer(2);
  centeredField('property_address', BODY + 1);
  spacer(6);

  para([{ b: 'Date:  ' }, { f: 'loi_date' }], { gapAfter: 8 });
  para([
    { b: 'Premises:  ' }, { f: 'property_address' }, ' (the “Premises” or the “Property”).',
  ]);
  para([
    'This Letter of Intent (“LOI”) sets forth the principal business terms under which Tenant proposes to lease the Premises. It is intended as an outline for discussion and to facilitate preparation of a definitive lease agreement (the “Lease”). This LOI is non-binding, as more fully described in Section 11 below.',
  ]);

  // ── 1. Premises ─────────────────────────────────────────────────────────────
  section('1.  Premises',
    ['The Premises consist of approximately ', { f: 'rentable_sf' }, ' rentable square feet located at ', { f: 'property_address' },
      ', including approximately ', { f: 'rear_sf' }, ' square feet in the rear portion of the Premises that has limited utility for Tenant’s operations.']);

  // ── 2. Term ─────────────────────────────────────────────────────────────────
  heading('2.  Term');
  para(['The Lease shall consist of two consecutive periods:'], { gapAfter: 3 });
  bullet([{ b: 'Short-Term Storage Period:  ' }, 'An initial period of ', { f: 'storage_term' }, ' during which Tenant’s use of the Premises will be limited to storage; followed by']);
  bullet([{ b: 'Long-Term Lease Period:  ' }, 'A primary term of ', { f: 'lease_term' }, ' for Tenant’s full intended operation.']);
  spacer(5);

  // ── 3. Base Rent ────────────────────────────────────────────────────────────
  heading('3.  Base Rent');
  bullet([{ b: 'Short-Term Storage Period:  ' }, 'Base Rent of ', { f: 'storage_rent' }]);
  bullet([{ b: 'Long-Term Lease Period:  ' }, 'Base Rent of ', { f: 'lease_rent' }, ' with ', { f: 'escalation' }, ' annual base rent escalations.']);
  spacer(4);
  para(['Although the short-term lease will be limited to storage use, Tenant is not requesting a lower rental rate during that period. Accordingly, Tenant requests an overall Base Rent of ', { f: 'storage_rent' }, ' for both the short-term storage period and the long-term lease.']);

  // ── 4. Governmental Approval Contingency ────────────────────────────────────
  section('4.  Governmental Approval Contingency',
    ['The Lease shall be contingent upon Tenant obtaining all governmental approvals necessary for Tenant’s intended operation, including, but not limited to, zoning approvals, permits, and a Certificate of Occupancy.'],
    ['Tenant shall diligently pursue such approvals within the timelines reasonably required by the applicable governmental authorities.'],
    ['If such approvals cannot be obtained despite Tenant’s diligent efforts, Tenant shall have the right to terminate the Lease without penalty, and any security deposit and unused prepaid rent shall be refunded.']);

  // ── 5. Right of First Refusal to Purchase ───────────────────────────────────
  section('5.  Right of First Refusal to Purchase',
    ['If the Landlord receives a bona fide third-party offer that the Landlord intends to accept, Tenant shall have the right to purchase the Property on the same material terms and conditions.'],
    ['The Landlord will give the Tenant early notice prior to formally listing the Property for sale to provide the Tenant the ability to purchase before formally taking offers.']);

  // ── 6. Purchase During the Lease Term ───────────────────────────────────────
  heading('6.  Purchase During the Lease Term');
  para(['If Tenant purchases the Property during the lease term:'], { gapAfter: 3 });
  bullet(['The Lease shall automatically terminate at closing;']);
  bullet(['No early termination penalty shall apply; and']);
  bullet(['Any unused security deposit and prepaid rent shall be credited to Tenant at closing.']);
  spacer(5);

  // ── 7. Adjacent Space Expansion Rights ──────────────────────────────────────
  heading('7.  Adjacent Space Expansion Rights');
  para(['Tenant requests the following expansion rights with respect to the adjacent spaces:'], { gapAfter: 3 });
  bullet(['Advance written notice if either adjacent tenant’s lease will expire, terminate, or not be renewed;']);
  bullet(['A Right of First Offer (ROFO) to lease either adjacent space before it is offered to another tenant; and']);
  bullet(['Reasonable access to information necessary to evaluate the adjacent space.']);
  spacer(5);

  // ── 8. Due Diligence ────────────────────────────────────────────────────────
  section('8.  Due Diligence',
    ['Tenant is continuing to coordinate with the City of San Antonio, TCEQ, and other applicable governmental authorities regarding zoning, permitting, and regulatory requirements for the proposed operation.'],
    ['Additional site visits may be required with contractors and consultants for remaining due diligence.'],
    ['If upgrades to the electrical service, sprinkler system, or other building systems are required to support Tenant’s intended operation, the parties shall discuss an appropriate allocation of those improvement costs, including potential tenant improvement allowances, rent concessions, and/or rent abatement.']);

  // ── 9. Brokerage & Expenses ─────────────────────────────────────────────────
  section('9.  Brokerage & Expenses',
    ['Except as otherwise agreed in the definitive Lease, each party shall bear its own costs and expenses (including attorneys’ fees) incurred in connection with the negotiation and documentation of the Lease. Any real estate brokerage commissions shall be paid pursuant to a separate written agreement and disclosed to the parties.']);

  // ── 10. Confidentiality ─────────────────────────────────────────────────────
  section('10.  Confidentiality',
    ['The parties shall keep the terms of this LOI and the negotiations between them confidential and shall not disclose such information to any third party, except to their respective attorneys, accountants, lenders, and advisors on a need-to-know basis, or as otherwise required by law.']);

  // ── 11. Non-Binding Effect ──────────────────────────────────────────────────
  section('11.  Non-Binding Effect',
    ['This LOI is intended solely to summarize the principal terms currently proposed and to facilitate preparation of a definitive Lease. It is not intended to be, and shall not be construed as, a binding or enforceable agreement or an offer capable of acceptance. Neither party shall have any obligation or liability to the other with respect to the proposed transaction unless and until a definitive written Lease is negotiated, approved, executed, and delivered by both parties. Either party may terminate discussions at any time, for any reason, without liability.']);

  // ── 12. Expiration of Offer ─────────────────────────────────────────────────
  section('12.  Expiration of Offer',
    ['Unless the parties commence good-faith negotiation of a definitive Lease, or Landlord delivers a countersigned copy of this LOI, on or before ', { f: 'expiration_date' },
      ' the terms set forth in this LOI shall automatically expire and be of no further force or effect.']);

  // ── Signature blocks ────────────────────────────────────────────────────────
  spacer(10);
  ensure(150);
  para([{ b: 'Submitted on behalf of Tenant by:' }], { gapAfter: 10 });
  { const lh = BODY * 1.34; ensure(lh); drawFieldInline('agent_name', M, y, times, BODY); y -= lh + 4; }
  para([{ f: 'agent_phone' }, '      |      ', { f: 'agent_email' }], { gapAfter: 12 });
  sigLine(M, 'By:  ', M + 26, M + 320, y); y -= 22;
  sigLine(M, 'Date:  ', M + 34, M + 220, y); y -= 26;

  para([{ b: 'Acknowledged and Agreed — Landlord:' }], { gapAfter: 12 });
  sigLine(M, 'By:  ', M + 26, M + 320, y); y -= 22;
  para(['Name / Title:  ', { f: 'landlord_name' }], { gapAfter: 10 });
  sigLine(M, 'Date:  ', M + 34, M + 220, y); y -= 10;

  // ── save ────────────────────────────────────────────────────────────────────
  const bytes = await doc.save();
  const out = __dirname;
  fs.writeFileSync(out + '/8000_fair_oaks_loi.pdf', bytes);
  fs.writeFileSync(out + '/fields.json', JSON.stringify(fields, null, 2));

  const byKey = {};
  for (const f of fields) byKey[f.field_key] = (byKey[f.field_key] || 0) + 1;
  console.log('pages:', doc.getPageCount());
  console.log('total field boxes:', fields.length);
  console.log('distinct keys:', Object.keys(byKey).length);
  console.log('per key:', JSON.stringify(byKey));
})().catch(e => { console.error(e); process.exit(1); });
