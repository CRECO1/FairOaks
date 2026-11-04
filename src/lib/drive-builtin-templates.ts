// Ready-made starting points in the My Drive "Template gallery" (no database rows — they live in code, so every team gets them).
// A spreadsheet template is a header row + a few example rows (+ dropdowns / number formats / totals); a document template is markdown.
// Pure data, safe for the browser; drive-builtin-build.ts turns one into a live sheet / doc on the server.

export interface SheetTplTab {
  name: string;
  header: string[];
  widths?: number[];
  /** example / starter rows (a cell starting with = is a formula) */
  rows?: string[][];
  /** how many empty, formula-ready rows to leave under the header (formula cells come from `formulaCols`) */
  blankRows?: number;
  /** column index -> formula builder given the 1-based sheet row, e.g. r => `=C${r}*D${r}/12` */
  formulaCols?: Record<number, (r: number) => string>;
  /** column index -> dropdown choices */
  lists?: Record<number, string[]>;
  /** column index -> number format */
  formats?: Record<number, { nf: 'num' | 'cur' | 'pct' | 'date'; dp?: number }>;
  /** a bold totals row placed after the blank rows: column index -> text / formula */
  totals?: Record<number, string>;
}
export interface BuiltinTemplate {
  id: string;
  kind: 'sheet' | 'doc';
  title: string;
  desc: string;
  /** short "what's inside" line shown on the card */
  peek: string;
  tabs?: SheetTplTab[];
  markdown?: string;
}

const STAGES = ['Prospect', 'Active', 'In Contract', 'Closed', 'Lost'];
const CALL_STATUS = ['Not called', 'Left voicemail', 'Reached', 'Interested', 'Tour set', 'Not interested'];

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'tenant-call-tracker', kind: 'sheet', title: 'Tenant call tracker', desc: 'Who you have called, what happened and what is next.',
    peek: 'Business · Contact · Phone · Status ▾ · Last contact · Next step · Notes',
    tabs: [{
      name: 'Calls', header: ['Business', 'Contact', 'Phone', 'Email', 'Status', 'Last contact', 'Next step', 'Notes'], widths: [190, 150, 130, 190, 130, 110, 190, 320],
      rows: [['Example Dental', 'Dr. Jane Smith', '(210) 555-0123', 'jane@example.com', 'Left voicemail', '', 'Call back Thursday', 'Looking for 2,000 SF']], blankRows: 40,
      lists: { 4: CALL_STATUS }, formats: { 5: { nf: 'date' } },
    }],
  },
  {
    id: 'rent-roll', kind: 'sheet', title: 'Rent roll', desc: 'Suites, tenants, rent and lease dates with live totals.',
    peek: 'Suite · Tenant · SF · $/SF/yr · Monthly rent (formula) · Lease end · Status ▾',
    tabs: [{
      name: 'Rent roll', header: ['Suite', 'Tenant', 'SF', 'Rent $/SF/yr', 'Monthly rent', 'Lease start', 'Lease end', 'Status'], widths: [80, 200, 90, 110, 120, 110, 110, 120],
      rows: [['100', 'Example Tenant LLC', '2000', '24', '', '', '', 'Leased']], blankRows: 30,
      formulaCols: { 4: r => `=IF(C${r}="","",C${r}*D${r}/12)` }, lists: { 7: ['Leased', 'Vacant', 'Notice given', 'Holdover'] },
      formats: { 2: { nf: 'num', dp: 0 }, 3: { nf: 'cur', dp: 2 }, 4: { nf: 'cur', dp: 0 }, 5: { nf: 'date' }, 6: { nf: 'date' } },
      totals: { 1: 'Total', 2: '=SUM(C2:C32)', 4: '=SUM(E2:E32)' },
    }],
  },
  {
    id: 'deal-pipeline', kind: 'sheet', title: 'Deal pipeline', desc: 'Every deal by stage, with value and estimated commission.',
    peek: 'Deal · Client · Stage ▾ · Value · Commission % · Est. commission (formula) · Close date',
    tabs: [{
      name: 'Pipeline', header: ['Deal', 'Client', 'Property', 'Stage', 'Value', 'Commission %', 'Est. commission', 'Next step', 'Close date'], widths: [180, 160, 200, 120, 110, 110, 120, 200, 110],
      rows: [['Example lease', 'Acme Co', '123 Main St', 'Active', '240000', '0.06', '', 'Send LOI', '']], blankRows: 30,
      formulaCols: { 6: r => `=IF(E${r}="","",E${r}*F${r})` }, lists: { 3: STAGES },
      formats: { 4: { nf: 'cur', dp: 0 }, 5: { nf: 'pct', dp: 1 }, 6: { nf: 'cur', dp: 0 }, 8: { nf: 'date' } },
      totals: { 0: 'Total', 4: '=SUM(E2:E32)', 6: '=SUM(G2:G32)' },
    }],
  },
  {
    id: 'lease-comparison', kind: 'sheet', title: 'Lease comparison', desc: 'Compare spaces side by side — rent, NNN, term, concessions.',
    peek: 'Term rows × Space A / B / C, with total occupancy cost',
    tabs: [{
      name: 'Compare', header: ['', 'Space A', 'Space B', 'Space C'], widths: [200, 170, 170, 170],
      rows: [
        ['Address', '', '', ''], ['Square feet', '', '', ''], ['Base rent $/SF/yr', '', '', ''], ['NNN $/SF/yr', '', '', ''],
        ['Total $/SF/yr', '=IF(B4="","",B4+B5)', '=IF(C4="","",C4+C5)', '=IF(D4="","",D4+D5)'],
        ['Monthly cost', '=IF(B3="","",B3*B6/12)', '=IF(C3="","",C3*C6/12)', '=IF(D3="","",D3*D6/12)'],
        ['Term (years)', '', '', ''], ['Free rent (months)', '', '', ''], ['TI allowance $/SF', '', '', ''], ['Annual escalation', '', '', ''], ['Notes', '', '', ''],
      ],
    }],
  },
  {
    id: 'budget', kind: 'sheet', title: 'Budget tracker', desc: 'Budget vs. actual by category, with the variance worked out.',
    peek: 'Category · Budget · Actual · Variance (formula) · Notes',
    tabs: [{
      name: 'Budget', header: ['Category', 'Budget', 'Actual', 'Variance', 'Notes'], widths: [200, 120, 120, 120, 300],
      rows: [['Marketing', '5000', '3800', '', '']], blankRows: 20,
      formulaCols: { 3: r => `=IF(B${r}="","",B${r}-C${r})` }, formats: { 1: { nf: 'cur', dp: 0 }, 2: { nf: 'cur', dp: 0 }, 3: { nf: 'cur', dp: 0 } },
      totals: { 0: 'Total', 1: '=SUM(B2:B22)', 2: '=SUM(C2:C22)', 3: '=SUM(D2:D22)' },
    }],
  },
  {
    id: 'meeting-notes', kind: 'doc', title: 'Meeting notes', desc: 'Date, attendees, decisions and who owns each next step.', peek: 'Attendees · Agenda · Decisions · Action items table',
    markdown: `# Meeting notes\n\n**Date:** [date]  \n**Attendees:** [names]  \n**Related deal / property:** [name]\n\n## Agenda\n\n- [topic]\n- [topic]\n\n## Notes\n\n[what was discussed]\n\n## Decisions\n\n- [decision]\n\n## Action items\n\n| Owner | Task | Due |\n| --- | --- | --- |\n| [name] | [task] | [date] |\n`,
  },
  {
    id: 'property-brief', kind: 'doc', title: 'Property brief', desc: 'A one-page summary of a property to share internally or with an owner.', peek: 'Overview · Highlights · Market notes · Next steps',
    markdown: `# [Property name]\n\n**Address:** [address]  \n**Type:** [retail / office / industrial / land]  \n**Size:** [SF or acres]  \n**Owner:** [owner]\n\n## Overview\n\n[two or three sentences on the property and why it matters]\n\n## Highlights\n\n- [highlight]\n- [highlight]\n- [highlight]\n\n## Market notes\n\n[comparable rents, nearby tenants, traffic counts]\n\n## Next steps\n\n- [step]\n`,
  },
  {
    id: 'loi-outline', kind: 'doc', title: 'Letter of intent (outline)', desc: 'The standard lease LOI terms laid out as a table, ready to fill in.', peek: 'Parties · Premises · Rent · Term · TI · Contingencies',
    markdown: `# Letter of Intent — [Property]\n\n[date]\n\n[Landlord / Landlord's agent]  \n[address]\n\nRe: Proposed lease of [suite] at [property address]\n\nThis letter outlines the principal terms on which [Tenant] is prepared to lease the premises. It is a non-binding expression of intent.\n\n| Term | Proposal |\n| --- | --- |\n| Tenant | [tenant legal name] |\n| Premises | [suite, approximate SF] |\n| Use | [permitted use] |\n| Lease term | [years] |\n| Base rent | [$ per SF per year, annual escalation] |\n| Operating expenses | [NNN / modified gross, estimated $ per SF] |\n| Tenant improvements | [allowance or as-is] |\n| Free rent | [months] |\n| Security deposit | [amount] |\n| Contingencies | [permits, financing, board approval] |\n\nPlease let me know if these terms are acceptable and we will prepare a lease for review.\n\nSincerely,  \n[name]\n`,
  },
  {
    id: 'outreach-email', kind: 'doc', title: 'Tenant outreach email', desc: 'A short, personal first email to a prospective tenant.', peek: 'Subject · 3 short paragraphs · call to action',
    markdown: `**Subject:** [business name] — space at [property]\n\nHi [first name],\n\nI came across [business name] and thought of [property], a [size] space in [area] that could suit what you are doing.\n\n[one personal sentence about why this fits them]\n\nWould a quick call this week work? Happy to send a flyer first if that is easier.\n\nThanks,  \n[name]\n`,
  },
];
export const builtinById = (id: string) => BUILTIN_TEMPLATES.find(t => t.id === id);
