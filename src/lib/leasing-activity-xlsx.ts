import ExcelJS from 'exceljs';
import { REPORT_COLUMNS, type ReportSection } from '@/lib/leasing-activity';
import type { listingProspects, callsForProspects } from '@/lib/listing-prospects';

// The Leasing Activity report as an .xlsx in the owner's own layout (Headwall's
// template: green header band, gold expiration bands, mint vacancy rows, 14 columns),
// plus a Marketing Activity sheet. Used by /api/crm/leasing-activity?format=xlsx.

const GREEN = 'FF1F3D2E', GOLD = 'FFB8972A', MINT = 'FFD6E4D6', WHITE = 'FFFFFFFF', LAVENDER = 'FFB4A7D6';

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

export async function toXlsx(header: { property: string; fund: string; agent: string }, sections: ReportSection[], m: Marketing, calls: Calls) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRECO';
  const ws = wb.addWorksheet(header.property.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const widths = [31.9, 19.9, 26, 18, 8.6, 8, 11, 12, 11, 11, 12, 13, 48, 14];
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
  ([['Email marketing', ml.email, 3], ['Calls', ml.calls, 4]] as const).forEach(([k, v, row]) => {
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
    const band = ws.getCell(r, 1);
    band.value = s.title; band.font = font({ size: s.tone === 'vacant' ? 10 : 11, bold: true, color: { argb: WHITE } });
    band.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(r).height = 22;
    r++;
    const lines = s.lines.length ? s.lines : [null];
    for (const l of lines) {
      const row = ws.getRow(r);
      const vals = l ? [l.occupant, l.status, l.dba, l.use, l.suite, l.sf, l.date ? new Date(l.date + 'T12:00:00') : null,
        l.proposedRent, l.proposedTi, l.national === null ? '' : l.national ? 'Y' : 'N',
        l.expiration ? new Date(l.expiration + 'T12:00:00') : null, l.renewalType, l.notes, l.prevRentPsf]
        : ['', '', '', '', '', null, null, null, null, '', null, '', '', null];
      vals.forEach((v, i) => { row.getCell(i + 1).value = v as ExcelJS.CellValue; });
      for (let c = 1; c <= 14; c++) {
        const cell = row.getCell(c);
        cell.font = font({ bold: c === 1 && s.tone === 'vacant', color: { argb: GREEN } });
        if (s.tone === 'vacant') cell.fill = fill(MINT);
        cell.alignment = { vertical: 'top', wrapText: c === 13, horizontal: c === 1 || (c >= 5 && c <= 12) ? 'center' : 'left' };
      }
      row.getCell(6).numFmt = '#,##0';
      row.getCell(7).numFmt = 'mm/dd/yyyy'; row.getCell(11).numFmt = 'mm/dd/yyyy';
      for (const c of [8, 9, 14]) row.getCell(c).numFmt = '"$"#,##0.00';
      r++;
    }
    r++; // spacer
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
