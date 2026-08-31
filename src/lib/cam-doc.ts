import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

// ── Expense reconciliation billing packets ──────────────────────────────────
// Four pages per tenant, mirroring the packets Fair Oaks Plaza has sent by hand:
//   1. cover letter — what they owe, what next year looks like
//   2. the year's reconciliation — actual expenses, allocated down to this tenant
//   3. next year's projection — same cascade, forward looking
//   4. next year's rent schedule — base + estimated expenses, month by month
//
// The allocation is a cascade, and it is the part worth getting exactly right:
//
//   total property expenses (excluding trash)
//     × building's share of the property's leasable SF
//     + the building's share of the property trash bill
//     = expenses for the building
//     × tenant's share of the building's leasable SF
//     = what the tenant owes for the year
//     − what the tenant actually paid in estimates
//     = the balance billed (or credited)
//
// Trash is pulled out of the pro-rata pool and split by its own percentages
// because the bins are not shared evenly between the buildings.

export interface CamExpenses {
  trash?: number; water?: number; landscaping?: number; repairs?: number;
  professional?: number; insurance?: number; taxes?: number; management?: number;
}

export interface CamBuilding { sf?: number; trashPct?: number }

export interface CamTenant {
  suite: string; name: string; sf?: number; building?: string;
  paid?: number;            // estimates actually collected during the year
  paidNote?: string;        // e.g. "$462 x 11 months + $440 paid in Jan 2025"
  baseRentNext?: number;    // monthly base rent for next year
  baseRentJan?: number;     // January often still sits at the old rate
  contactName?: string; addressLine?: string;
}

export interface CamData {
  propertyName?: string; propertyAddress?: string; propertyPhone?: string;
  propertySf?: number;
  /**
   * How the cascade rounds.
   *
   * 'packet' reproduces the packets Fair Oaks Plaza has sent by hand: the
   * building's share of leasable SF is rounded to a whole percent before it is
   * applied, and the tenant totals land on whole dollars. Building 2 is really
   * 3200/13021 = 24.58%, and the packets bill it at 25% — so this rounding is
   * worth ~$87/year MORE per Bldg 2 tenant than the exact figure. It is kept as
   * the default only because prior years were billed this way and tenants compare.
   *
   * 'exact' uses the true percentage and cents throughout.
   */
  rounding?: 'packet' | 'exact';
  buildings?: Record<string, CamBuilding>;
  expenses?: CamExpenses;
  projected?: CamExpenses;
  letter?: { from?: string; phone?: string; date?: string; increaseMonth?: string };
  tenants?: Record<string, CamTenant>;
}

const ORDER: Array<[keyof CamExpenses, string]> = [
  ['trash', 'Trash Removal'], ['water', 'Water'], ['landscaping', 'Landscaping'],
  ['repairs', 'Repairs & Maintenance'], ['professional', 'Professional Fees'],
  ['insurance', 'Insurance'], ['taxes', 'Real Estate Taxes'], ['management', 'Management & Operation'],
];

const n = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => (v * 100).toFixed(Math.abs(v * 100 % 1) < 0.005 ? 0 : 2) + '%';

/** The allocation cascade, kept separate from drawing so it can be checked on its own. */
export function allocate(data: CamData, t: CamTenant, which: 'expenses' | 'projected') {
  const ex = (which === 'expenses' ? data.expenses : data.projected) ?? {};
  const bKey = t.building ?? '';
  const b = data.buildings?.[bKey] ?? {};
  const propertySf = n(data.propertySf);
  const bldgSf = n(b.sf);
  const tenantSf = n(t.sf);

  // Trash is allocated by its own percentage, so it is held out of the pro-rata pool.
  const trash = n(ex.trash);
  const exclTrash = ORDER.reduce((s, [k]) => s + (k === 'trash' ? 0 : n(ex[k])), 0);
  const totalAll = exclTrash + trash;

  const packetRounding = (data.rounding ?? 'packet') === 'packet';
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const dollars = (v: number) => (packetRounding ? Math.round(v) : round2(v));

  const rawBldgShare = propertySf > 0 ? bldgSf / propertySf : 0;
  const bldgShare = packetRounding ? Math.round(rawBldgShare * 100) / 100 : rawBldgShare;
  const bldgSubtotal = round2(exclTrash * bldgShare);
  const trashPct = n(b.trashPct) / 100;
  const bldgTrash = round2(trash * trashPct);
  const bldgTotal = round2(bldgSubtotal + bldgTrash);

  const rawTenantShare = bldgSf > 0 ? tenantSf / bldgSf : 0;
  const tenantShare = packetRounding ? Math.round(rawTenantShare * 100) / 100 : rawTenantShare;
  const tenantTotal = dollars(bldgTotal * tenantShare);
  const paid = n(t.paid);

  return {
    ex, totalAll, exclTrash, trash, bldgShare, bldgSubtotal, trashPct, bldgTrash, bldgTotal,
    tenantShare, tenantTotal, paid, due: round2(tenantTotal - paid),
    monthly: dollars(tenantTotal / 12), propertySf, bldgSf, tenantSf,
    rawBldgShare, rawTenantShare, rounded: packetRounding,
  };
}

// ── drawing helpers ─────────────────────────────────────────────────────────
const W = 612, H = 792, ML = 72, MR = 72;

function packetPage(doc: PDFDocument) {
  const page = doc.addPage([W, H]);
  return { page, y: H - 78 };
}

export async function buildCamPackets(data: CamData, tenants: CamTenant[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.08, 0.11);
  const grey = rgb(0.42, 0.44, 0.48);

  const text = (p: PDFPage, s: string, x: number, y: number, size = 10.5, f: PDFFont = reg, color = ink) =>
    p.drawText(s, { x, y, size, font: f, color });
  const right = (p: PDFPage, s: string, xRight: number, y: number, size = 10.5, f: PDFFont = reg, color = ink) =>
    p.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  const centre = (p: PDFPage, s: string, y: number, size: number, f: PDFFont = bold) =>
    p.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y, size, font: f, color: ink });
  const rule = (p: PDFPage, y: number, x1 = 330, x2 = 470) =>
    p.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.7, color: ink });

  // Wraps the letter body, which is the only prose in the packet.
  const para = (p: PDFPage, s: string, y: number, size = 10.5, lead = 15.5) => {
    const max = W - ML - MR;
    let line = '';
    for (const word of s.split(/\s+/)) {
      const probe = line ? line + ' ' + word : word;
      if (reg.widthOfTextAtSize(probe, size) > max && line) { text(p, line, ML, y, size); y -= lead; line = word; }
      else line = probe;
    }
    if (line) { text(p, line, ML, y, size); y -= lead; }
    return y;
  };

  const propName = data.propertyName || 'the property';
  const year = data.letter?.date ? new Date(data.letter.date + 'T12:00:00').getFullYear() - 1 : new Date().getFullYear() - 1;
  const nextYear = year + 1;
  const dateStr = data.letter?.date
    ? new Date(data.letter.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  for (const t of tenants) {
    const a = allocate(data, t, 'expenses');
    const pr = allocate(data, t, 'projected');

    // ── 1. Cover letter ──────────────────────────────────────────────────────
    {
      const { page } = packetPage(doc);
      let y = H - 78;
      text(page, dateStr, ML, y); y -= 46;
      text(page, t.name, ML, y); y -= 14;
      if (t.contactName) { text(page, t.contactName, ML, y); y -= 14; }
      text(page, `${data.propertyAddress || ''}${t.suite ? `, #${t.suite}` : ''}`, ML, y); y -= 14;
      text(page, 'Fair Oaks Ranch, TX 78015', ML, y); y -= 34;
      text(page, `${(t.contactName || t.name).split(' ')[0]}:`, ML, y); y -= 28;

      const owed = a.due;
      y = para(page,
        `Enclosed you will find the ${year} Expense Reconciliation for ${propName}. The total ${year} expense ` +
        (owed >= 0
          ? `reimbursement due to ${propName} from ${t.name} is ${money(owed)}.`
          : `overpayment to be credited to ${t.name} is ${money(Math.abs(owed))}.`) +
        ' If you would like to review property invoices or receipts for any expense listed in the reconciliation, copies will be provided upon request.', y);
      y -= 10;
      y = para(page,
        `Expense projections for ${nextYear} are also attached for your review. Your total monthly projected expense will ` +
        `be ${money(pr.monthly)}. The new monthly expense estimate will be due with your ${data.letter?.increaseMonth || 'February'} rent payment.`, y);
      y -= 10;
      if (t.baseRentNext) {
        y = para(page,
          `Lastly, your monthly rent increase will begin ${data.letter?.increaseMonth || 'February'} 1, ${nextYear}. For your convenience, ` +
          `I have attached a rent schedule for ${nextYear}. Please contact me with any questions that you may have.`, y);
        y -= 10;
      }
      y -= 12;
      text(page, 'Sincerely,', ML, y); y -= 52;
      text(page, data.letter?.from || '', ML, y); y -= 14;
      text(page, propName, ML, y); y -= 14;
      text(page, data.letter?.phone || '', ML, y);

      const foot = `${data.propertyAddress || ''} • ${data.propertyPhone || ''}`;
      centre(page, foot, 60, 8.5, reg);
    }

    // ── 2. The year's reconciliation ─────────────────────────────────────────
    {
      const { page } = packetPage(doc);
      let y = H - 92;
      centre(page, `${propName} Expense Reconciliation ${year}`, y, 15); y -= 24;
      centre(page, `${t.name}, #${t.suite}`, y, 14); y -= 40;

      text(page, 'Expense', ML, y, 11, bold);
      right(page, `${year} Total`, 470, y, 11, bold); y -= 26;
      for (const [k, label] of ORDER) {
        text(page, label, ML, y);
        if (k === 'trash') right(page, 'Entered Below', 470, y, 10, reg, grey);
        else right(page, money(n(a.ex[k])), 470, y);
        y -= 20;
      }
      rule(page, y + 14); y -= 12;

      const row = (label: string, value: string, opts: { b?: boolean; note?: string; line?: boolean } = {}) => {
        text(page, label, ML, y, 10.5, opts.b ? bold : reg);
        right(page, value, 470, y, 10.5, opts.b ? bold : reg);
        if (opts.line) rule(page, y - 4);
        // The paid-note explains how the estimates add up and can be long; it sits
        // beside the figure when it fits and drops to its own line when it doesn't,
        // rather than running off the edge of the page.
        if (opts.note) {
          const fits = 478 + reg.widthOfTextAtSize(opts.note, 8.5) <= W - 40;
          if (fits) text(page, opts.note, 478, y, 8.5, reg, grey);
          else { y -= 12; text(page, opts.note, ML + 18, y, 8.5, reg, grey); }
        }
        y -= 17;
      };
      row('Total Property Expenses', money(a.exclTrash));
      row(`Bldg ${t.building} Percent of Total Leasable Sq Ft — See Below**`, `x ${pct(a.bldgShare)}`, { line: true });
      row(`Sub Total Expenses Bldg ${t.building}`, money(a.bldgSubtotal));
      row(`Trash (${pct(a.trashPct)} of Total Property Trash Removal Cost)`, money(a.bldgTrash), { line: true });
      row(`Total Expenses Bldg ${t.building}`, money(a.bldgTotal));
      row(`Tenant Sq Ft Percent of Bldg ${t.building} — See Below***`, `x ${pct(a.tenantShare)}`, { line: true });
      row(`Total Expenses For Tenant ${year}`, money(a.tenantTotal));
      row(`Total Paid by Tenant ${year}`, `(${money(a.paid)})`, { note: t.paidNote, line: true });
      row(a.due >= 0 ? 'Total Amount Due From Tenant' : 'Total Credit Due To Tenant', money(Math.abs(a.due)), { b: true });

      y -= 26;
      text(page, `**% of Leasable Sq Ft for Building ${t.building} — ${a.bldgSf.toLocaleString()}/${a.propertySf.toLocaleString()} = ${pct(a.bldgShare)}`, ML, y, 9.5); y -= 14;
      text(page, `${a.propertySf.toLocaleString()} = Total Property Leasable Sq Ft`, ML + 40, y, 9.5, reg, grey); y -= 13;
      text(page, `${a.bldgSf.toLocaleString()} = Total Bldg ${t.building} Leasable Sq Ft`, ML + 40, y, 9.5, reg, grey); y -= 24;
      text(page, `***% of Leasable Sq Ft for Tenant — ${a.tenantSf.toLocaleString()}/${a.bldgSf.toLocaleString()} = ${pct(a.tenantShare)}`, ML, y, 9.5); y -= 14;
      text(page, `${a.bldgSf.toLocaleString()} = Total Bldg ${t.building} Leasable Sq Ft`, ML + 40, y, 9.5, reg, grey); y -= 13;
      text(page, `${a.tenantSf.toLocaleString()} = Total Tenant Leasable Sq Ft`, ML + 40, y, 9.5, reg, grey);
    }

    // ── 3. Next year's projection ────────────────────────────────────────────
    {
      const { page } = packetPage(doc);
      let y = H - 92;
      centre(page, `${propName} Projected Expenses ${nextYear}`, y, 15); y -= 24;
      centre(page, `${t.name}, #${t.suite}`, y, 14); y -= 40;

      text(page, 'Expense', ML, y, 11, bold);
      right(page, `${nextYear} Projected`, 470, y, 11, bold); y -= 26;
      for (const [k, label] of ORDER) {
        text(page, k === 'trash' ? 'Trash' : label, ML, y);
        if (k === 'trash') right(page, 'See Below', 470, y, 10, reg, grey);
        else right(page, money(n(pr.ex[k])), 470, y);
        y -= 20;
      }
      rule(page, y + 14); y -= 12;

      const row = (label: string, value: string, opts: { b?: boolean; line?: boolean } = {}) => {
        text(page, label, ML, y, 10.5, opts.b ? bold : reg);
        right(page, value, 470, y, 10.5, opts.b ? bold : reg);
        if (opts.line) rule(page, y - 4);
        y -= 17;
      };
      row('Total Projected Property Expenses', money(pr.exclTrash));
      row(`Bldg ${t.building} Percent of Total Leasable Sq Ft — See Below*`, `x ${pct(pr.bldgShare)}`, { line: true });
      row(`Sub Total of Projected Expenses Bldg ${t.building}`, money(pr.bldgSubtotal));
      row(`Trash Removal — ${pct(pr.trashPct)} of Total Property Trash Expense`, money(pr.bldgTrash), { line: true });
      row(`Total Projected Expenses Bldg ${t.building}`, money(pr.bldgTotal));
      row(`Tenant Sq Ft Percent of Bldg ${t.building} — See Below**`, `x ${pct(pr.tenantShare)}`, { line: true });
      row(`Total Projected Tenant Expenses Bldg ${t.building}`, money(pr.tenantTotal));
      row('', '÷ 12', { line: true });
      row(`Total Projected Monthly Expenses For Tenant ${nextYear}`, money(pr.monthly), { b: true });

      y -= 26;
      text(page, `*% of Leasable Sq Ft for Building ${t.building} — ${pr.bldgSf.toLocaleString()}/${pr.propertySf.toLocaleString()} = ${pct(pr.bldgShare)}`, ML, y, 9.5); y -= 14;
      text(page, `${pr.propertySf.toLocaleString()} = Total Property Leasable Sq Ft`, ML + 40, y, 9.5, reg, grey); y -= 13;
      text(page, `${pr.bldgSf.toLocaleString()} = Total Bldg ${t.building} Leasable Sq Ft`, ML + 40, y, 9.5, reg, grey); y -= 24;
      text(page, `**% of Leasable Sq Ft for Tenant — ${pr.tenantSf.toLocaleString()}/${pr.bldgSf.toLocaleString()} = ${pct(pr.tenantShare)}`, ML, y, 9.5); y -= 14;
      text(page, `${pr.bldgSf.toLocaleString()} = Total Bldg ${t.building} Leasable Sq Ft`, ML + 40, y, 9.5, reg, grey); y -= 13;
      text(page, `${pr.tenantSf.toLocaleString()} = Total Tenant Leasable Sq Ft`, ML + 40, y, 9.5, reg, grey);
    }

    // ── 4. Next year's rent schedule ─────────────────────────────────────────
    if (t.baseRentNext) {
      const { page } = packetPage(doc);
      let y = H - 92;
      centre(page, `${nextYear} Rent Schedule`, y, 15); y -= 24;
      centre(page, `${t.name}, #${t.suite}`, y, 14); y -= 44;

      const cols = [ML + 6, 214, 330, 470];
      text(page, 'Date', cols[0], y, 11, bold);
      right(page, 'Base Rent', cols[1], y, 11, bold);
      right(page, 'Projected Expenses', cols[2], y, 11, bold);
      right(page, 'Total Monthly', cols[3], y, 11, bold);
      y -= 24;

      // The increase starts partway through the year, so January usually still
      // carries the old base rent and the old expense estimate.
      const startIdx = ['January','February','March','April','May','June','July','August','September','October','November','December']
        .indexOf(data.letter?.increaseMonth || 'February');
      const oldEstimate = n(t.paid) && t.paidNote ? null : null;
      for (let m = 0; m < 12; m++) {
        const label = ['January','February','March','April','May','June','July','August','September','October','November','December'][m];
        const base = m < startIdx ? n(t.baseRentJan || t.baseRentNext) : n(t.baseRentNext);
        const est = m < startIdx ? n(a.tenantTotal) / 12 : pr.monthly;
        text(page, label, cols[0], y);
        right(page, money(base), cols[1], y);
        right(page, money(est), cols[2], y);
        right(page, money(base + est), cols[3], y);
        y -= 18;
      }
      void oldEstimate;
    }
  }

  return doc.save();
}
