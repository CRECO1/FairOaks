import ExcelJS from 'exceljs';
import { REPORT_COLUMNS, type ReportSection } from '@/lib/leasing-activity';
import type { listingProspects, callsForProspects } from '@/lib/listing-prospects';

// The Leasing Activity report as an .xlsx in the owner's own layout (Headwall's
// template: green header band, gold expiration bands, mint vacancy rows, 14 columns),
// plus a Marketing Activity sheet. Used by /api/crm/leasing-activity?format=xlsx.

const GREEN = 'FF1F3D2E', GOLD = 'FFB8972A', MINT = 'FFD6E4D6', WHITE = 'FFFFFFFF', LAVENDER = 'FFB4A7D6';


// The owner's wording for a prospect's stage, and the blue chip it sits in (their sample).
const STATUS_WORDS: Record<string, string> = { Prospect: 'Reviewing', 'Proposal Out': 'Submitted' };
const exportStatus = (st: string) => STATUS_WORDS[st] ?? st;
const STATUS_CHIP: Record<string, { fill: string; text: string }> = {
  Reviewing: { fill: 'FFD0E0F3', text: 'FF1F5FBF' },
  Submitted: { fill: 'FFA9C4E8', text: 'FF1A3E8C' },
  Touring: { fill: 'FFFFF2CC', text: 'FF7F6000' },
  'LOI Out': { fill: 'FFFCE5CD', text: 'FF8A4B08' },
  'Lease Out': { fill: 'FFD9EAD3', text: 'FF274E13' },
  Signed: { fill: 'FF93C47D', text: 'FF1F3D2E' },
  Passed: { fill: 'FFD9D2E9', text: 'FF4C3A7A' },
  Interested: { fill: 'FFB6D7A8', text: 'FF1F3D2E' },
  Contacted: { fill: 'FFEFEFEF', text: 'FF555555' },
  'Not contacted': { fill: 'FFFFFFFF', text: 'FF999999' },
};

export type Marketing = Awaited<ReturnType<typeof listingProspects>>;
export type Calls = Awaited<ReturnType<typeof callsForProspects>>;
export function summarize(m: Marketing) {
  const sent = m.campaigns.reduce((s, c) => s + c.sent, 0);
  const opens = m.campaigns.reduce((s, c) => s + c.opened, 0);
  return {
    sentWeek: m.campaigns.reduce((s, c) => s + c.sentWeek, 0), openedWeek: m.campaigns.reduce((s, c) => s + c.openedWeek, 0),
    emailed: m.prospects.filter(p => p.emailsSent > 0).length, opened: m.prospects.filter(p => p.emailsOpened > 0).length, sent, openRate: sent ? opens / sent : 0,
    campaigns: m.campaigns.map(c => ({ name: c.name, sent: c.sent, opened: c.opened, openRate: c.openRate, lastSent: c.lastSent })),
  };
}

// The two marketing lines that sit in the report's header band (and the tab's top strip).
export function marketingLines(m: Marketing, calls: Calls) {
  const sum = summarize(m);
  const pct = Math.round(sum.openRate * 100);
  return {
    email: `${sum.sent} emails sent to ${sum.emailed} businesses · ${sum.opened} opened · ${pct}% open rate  (this week: ${sum.sentWeek} sent, ${sum.openedWeek} opens)`,
    calls: `${calls.outbound + calls.inbound} calls logged — ${calls.outbound} outbound, ${calls.inbound} inbound  (this week: ${calls.outboundWeek + calls.inboundWeek})`,
  };
}

export async function toXlsx(header: { property: string; fund: string; agent: string }, sections: ReportSection[], m: Marketing, calls: Calls, websiteLine?: string | null) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRECO';
  const ws = wb.addWorksheet(header.property.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const widths = [31.9, 19.9, 40, 22, 8.6, 8, 11, 12, 11, 11, 12, 13, 56, 14];
  ws.columns = widths.map(w => ({ width: w }));
  const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Arial', size: 10, ...o });
  const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFBFBFBF' } };

  ws.getRow(1).height = 6;
  for (let c = 1; c <= 14; c++) ws.getCell(1, c).fill = fill(GREEN);
  ws.mergeCells('A2:N2');
  ws.getCell('A2').value = header.property;
  ws.getCell('A2').font = font({ size: 14, bold: true, color: { argb: WHITE } });
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 30;
  const meta: [string, string | Date][] = [['Fund', header.fund], ['Leasing Agent', header.agent], ['Date', new Date()]];
  meta.forEach(([k, v], i) => {
    const r = 3 + i;
    ws.getCell(r, 1).value = k; ws.getCell(r, 1).font = font({ size: 9, bold: true, color: { argb: GOLD } });
    ws.getCell(r, 2).value = v; ws.getCell(r, 2).font = font({ size: 9, color: { argb: WHITE } });
    if (v instanceof Date) ws.getCell(r, 2).numFmt = 'mm/dd/yyyy';
    ws.getRow(r).height = 14.1;
  });
  for (let r = 2; r <= 5; r++) for (let c = 1; c <= 14; c++) ws.getCell(r, c).fill = fill(GREEN);
  // Marketing effort, two lines in the header band beside Fund / Agent / Date.
  const ml = marketingLines(m, calls);
  const lines: [string, string, number][] = [['Email marketing', ml.email, 3], ['Calls', ml.calls, 4]];
  if (websiteLine) lines.push(['Website', websiteLine, 5]);
  lines.forEach(([k, v, row]) => {
    ws.getCell(row, 4).value = k; ws.getCell(row, 4).font = font({ size: 9, bold: true, color: { argb: GOLD } });
    ws.mergeCells(row, 5, row, 14);
    ws.getCell(row, 5).value = v; ws.getCell(row, 5).font = font({ size: 9, color: { argb: WHITE } });
    ws.getCell(row, 5).alignment = { horizontal: 'left', vertical: 'middle' };
  });

  const head = ws.getRow(6);
  REPORT_COLUMNS.forEach((t, i) => {
    const cell = head.getCell(i + 1);
    cell.value = t; cell.font = font({ bold: true, color: { argb: WHITE } }); cell.fill = fill(GREEN);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  head.height = 30;

  let r = 7;
  for (const s of sections) {
    // Section band, as in the owner's sheet: title centred in column A, colour across.
    const tone = s.tone === 'expiring' ? GOLD : s.tone === 'passed' ? LAVENDER : GREEN;
    for (let c = 1; c <= 14; c++) { const x = ws.getCell(r, c); x.fill = fill(tone); x.border = { top: thin, bottom: thin }; }
    ws.mergeCells(r, 1, r, 14);
    const band = ws.getCell(r, 1);
    band.value = s.title; band.font = font({ size: 11, bold: true, color: { argb: WHITE } });
    band.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(r).height = 22;
    r++;
    const lines = s.lines.length ? s.lines : [null];
    // Owner's layout: one mint VACANT row per suite (suite + SF in bold), the prospects working
    // it listed beneath with a coloured status chip. Other sections stay one line per row.
    let lastSuite: string | null = null;
    for (const l of lines) {
      if (l && s.tone === 'vacant' && l.kind === 'prospect') {
        const key = l.suiteRowId ?? `tbd:${l.suite}`;
        if (key !== lastSuite) {
          lastSuite = key;
          const h = ws.getRow(r);
          h.getCell(1).value = l.occupant || 'VACANT';
          h.getCell(5).value = l.suite; h.getCell(6).value = l.sf;
          for (let c = 1; c <= 14; c++) {
            const cell = h.getCell(c);
            cell.fill = fill(MINT); cell.font = font({ bold: true, color: { argb: GREEN } });
            cell.alignment = { vertical: 'middle', horizontal: c === 1 || c === 5 || c === 6 ? 'center' : 'left' };
          }
          h.getCell(6).numFmt = '#,##0';
          r++;
        }
      } else lastSuite = null;
      const row = ws.getRow(r);
      const asProspect = !!l && s.tone === 'vacant' && l.kind === 'prospect';
      const vals = l ? [asProspect ? '' : l.occupant, exportStatus(l.status), l.dba, l.use, asProspect ? '' : l.suite, asProspect ? null : l.sf,
        l.date ? new Date(l.date + 'T12:00:00') : null, l.proposedRent, l.proposedTi, l.national === null ? '' : l.national ? 'Yes' : 'No',
        l.expiration ? new Date(l.expiration + 'T12:00:00') : null, l.renewalType, l.notes, l.prevRentPsf]
        : ['', '', '', '', '', null, null, null, null, '', null, '', '', null];
      vals.forEach((v, i) => { row.getCell(i + 1).value = v as ExcelJS.CellValue; });
      const plain = asProspect || (!!l && l.kind === 'passed');
      for (let c = 1; c <= 14; c++) {
        const cell = row.getCell(c);
        cell.font = font({ bold: c === 1 && s.tone === 'vacant', color: { argb: plain ? 'FF000000' : GREEN } });
        if (s.tone === 'vacant' && !asProspect) cell.fill = fill(MINT);
        if (plain) cell.border = { bottom: thin };
        const centre = c === 1 || c === 2 || (c >= 5 && c <= 12);
        cell.alignment = { vertical: 'middle', wrapText: c === 13, horizontal: centre ? 'center' : 'left' };
      }
      if (l && l.status) {
        const chip = STATUS_CHIP[exportStatus(l.status)];
        if (chip) {
          const sc = row.getCell(2);
          sc.fill = fill(chip.fill); sc.font = font({ bold: true, color: { argb: chip.text } });
        }
      }
      row.getCell(6).numFmt = '#,##0';
      row.getCell(7).numFmt = 'm.d.yy'; row.getCell(11).numFmt = 'mm/dd/yyyy';
      for (const c of [8, 9, 14]) row.getCell(c).numFmt = '"$"#,##0.00';
      r++;
    }
    r++; // spacer
  }


  // Every prospective tenant, broken out by industry with where they stand — the owner's
  // "who are we talking to" view. Built from the property's campaign list + cold list
  // (dead and unsubscribed addresses left off).
  const people = m.prospects.filter(p => !p.dead && !p.unsubscribed);
  if (people.length) {
    const stageOf = (p: (typeof people)[number]) => p.clicks > 0 ? 'Interested' : p.emailsOpened > 0 ? 'Reviewing' : p.emailsSent > 0 ? 'Contacted' : 'Not contacted';
    const stageRank: Record<string, number> = { Interested: 0, Reviewing: 1, Contacted: 2, 'Not contacted': 3 };
    // Industry = the tenant-category tag when the contact has one (not a corridor or the property's own
    // prospect-list name); otherwise a best guess from the business name.
    const GUESS: [RegExp, string][] = [
      [/\b(bank|bancorp|credit union|financial|savings)\b/i, 'Banking & Financial'],
      [/\b(vet|veterinar|animal|pet|paws)\b/i, 'Veterinary & Pet'],
      [/\b(dental|dentist|orthodont|smiles|oral surgery|endodont)\b/i, 'Dental'],
      [/\b(urgent care|emergency|\bER\b|hospital|medical|clinic|health|kidney|dialysis|physician|pediatric|dermatolog|therapy|rehab|imaging|optometr|eye|vision|chiropract)\b/i, 'Medical'],
      [/\b(school|academy|learning|cheer|gymnastic|dance|tutor|montessori|daycare|child|kids|prep)\b/i, 'Kids & Enrichment'],
      [/\b(fitness|gym|pilates|yoga|barre|crossfit|boxing|cycle|training|athletic)\b/i, 'Fitness & Studio'],
      [/\b(car wash|tire|collision|automotive|auto|lube|oil change)\b/i, 'Automotive'],
      [/\b(coffee|brew|bakery|cafe|café|donut|tea|smoothie|ice cream|dutch bros|starbucks)\b/i, 'Coffee & Bakery'],
      [/\b(restaurant|grill|burger|pizza|taco|bbq|barbecue|kitchen|bistro|chick-fil-a|chipotle|wings|sushi|diner|eatery|first watch|bar\b)/i, 'Restaurant/F&B'],
      [/\b(salon|spa|nails|barber|beauty|massage|wellness|med ?spa)\b/i, 'Personal Care'],
      [/\b(insurance|realty|real estate|title|law|attorney|cpa|accounting|tax)\b/i, 'Business Services'],
    ];
    const industryOf = (p: (typeof people)[number]) => {
      const tags = p.category.split(',').map(t => t.trim()).filter(t => t && !/corridor|^elkhorn/i.test(t));
      if (tags[0]) return tags[0];
      const hit = GUESS.find(([re]) => re.test(p.business || p.name));
      return hit ? hit[1] : 'Other / Uncategorized';
    };
    const groups = new Map<string, (typeof people)>();
    for (const p of people) { const k = industryOf(p); groups.set(k, [...(groups.get(k) ?? []), p]); }
    const ordered = [...groups.entries()].sort((a, b) => (a[0].startsWith('Other') ? 1 : 0) - (b[0].startsWith('Other') ? 1 : 0) || b[1].length - a[1].length || a[0].localeCompare(b[0]));

    for (let c = 1; c <= 14; c++) { const x = ws.getCell(r, c); x.fill = fill(GREEN); x.border = { top: thin, bottom: thin }; }
    ws.mergeCells(r, 1, r, 14);
    const pb = ws.getCell(r, 1);
    pb.value = `Prospective Tenants by Industry — ${people.length} businesses`;
    pb.font = font({ size: 11, bold: true, color: { argb: WHITE } });
    pb.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(r).height = 22;
    r++;
    const fmtDay = (iso: string | null) => iso ? new Date(iso) : null;
    for (const [industry, list] of ordered) {
      const counts = (['Interested', 'Reviewing', 'Contacted', 'Not contacted'] as const)
        .map(k => [k, list.filter(p => stageOf(p) === k).length] as const).filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k.toLowerCase()}`).join(' · ');
      const h = ws.getRow(r);
      h.getCell(1).value = industry.toUpperCase();
      h.getCell(3).value = `${list.length} ${list.length === 1 ? 'business' : 'businesses'} — ${counts}`;
      for (let c = 1; c <= 14; c++) {
        const cell = h.getCell(c);
        cell.fill = fill(MINT); cell.font = font({ bold: true, color: { argb: GREEN } });
        cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'center' : 'left' };
      }
      r++;
      const sorted = [...list].sort((a, b) => stageRank[stageOf(a)] - stageRank[stageOf(b)]
        || String(b.lastOpen ?? b.lastSent ?? '').localeCompare(String(a.lastOpen ?? a.lastSent ?? ''))
        || (a.business || a.name).localeCompare(b.business || b.name));
      for (const p of sorted) {
        const st = stageOf(p);
        const row = ws.getRow(r);
        const when = p.lastOpen ?? p.lastSent;
        const notes = [
          p.emailsOpened > 0 ? `Opened ${p.opens}×` : p.emailsSent > 0 ? `Emailed ${p.emailsSent}×, no open yet` : 'Not emailed yet',
          p.clicks > 0 ? `${p.clicks} click${p.clicks === 1 ? '' : 's'}` : '',
          p.primaryCampaign ? p.primaryCampaign.replace(/^.*?—\s*/, '') : '',
          p.askFor ? `Ask for ${p.askFor}` : '',
          p.locations,
        ].filter(Boolean).join(' · ');
        const vals: ExcelJS.CellValue[] = ['', st, p.business || p.name || p.email, industry.startsWith('Other') ? '' : industry, '', null,
          fmtDay(when), null, null, '', null, '', notes, null];
        vals.forEach((v, i) => { row.getCell(i + 1).value = v; });
        for (let c = 1; c <= 14; c++) {
          const cell = row.getCell(c);
          cell.font = font({ color: { argb: 'FF000000' } });
          cell.border = { bottom: thin };
          cell.alignment = { vertical: 'middle', wrapText: c === 13, horizontal: c === 2 || c === 7 ? 'center' : 'left' };
        }
        const chip = STATUS_CHIP[st];
        const sc = row.getCell(2);
        sc.fill = fill(chip.fill); sc.font = font({ bold: true, color: { argb: chip.text } });
        row.getCell(7).numFmt = 'm.d.yy';
        r++;
      }
    }
    r++;
  }

  // Marketing Activity — who the property's campaigns reached and opened.
  const mk = wb.addWorksheet('Marketing Activity', { views: [{ state: 'frozen', ySplit: 1 }] });
  mk.columns = [{ width: 58 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 13 }];
  const sum = summarize(m);
  const top = mk.addRow([`${header.property} — email outreach`, 'Sent', 'Opened', 'Open rate', 'Last sent']);
  top.eachCell(c => { c.font = font({ bold: true, color: { argb: WHITE } }); c.fill = fill(GREEN); });
  for (const c of sum.campaigns) {
    const row = mk.addRow([c.name, c.sent, c.opened, c.sent ? c.openRate : null, c.lastSent ? new Date(c.lastSent) : null]);
    row.getCell(4).numFmt = '0%'; row.getCell(5).numFmt = 'mm/dd/yyyy'; row.eachCell(x => { x.font = font(); });
  }
  const tot = mk.addRow([`Total — ${sum.emailed} businesses emailed, ${sum.opened} opened`, sum.sent, null, sum.openRate, null]);
  tot.getCell(4).numFmt = '0%'; tot.eachCell(x => { x.font = font({ bold: true }); x.fill = fill(MINT); });
  mk.addRow([]);
  const ph = mk.addRow(['Prospects who opened (most recent first)', 'Opens', 'Last open', 'Category', '']);
  ph.eachCell(c => { c.font = font({ bold: true, color: { argb: WHITE } }); c.fill = fill(GOLD); });
  for (const p of m.prospects.filter(x => x.emailsOpened > 0 && !x.dead && !x.unsubscribed)) {
    const row = mk.addRow([p.business || p.name || p.email, p.opens, p.lastOpen ? new Date(p.lastOpen) : null, p.category, '']);
    row.getCell(3).numFmt = 'mm/dd/yyyy'; row.eachCell(x => { x.font = font(); });
  }
  return wb.xlsx.writeBuffer();
}
