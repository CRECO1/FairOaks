import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

// ── 8000 Fair Oaks Plaza — Building Lease Agreement ─────────────────────────
// The lease used to be a fixed PDF that we stamped values onto, which meant a
// clause could never be added or removed: the text couldn't reflow and every
// following clause kept its printed number. Here the lease is data, so removing
// a clause renumbers the rest on its own, and the fill-in blanks are laid out
// INLINE — they size themselves to their value instead of having to be squeezed
// into a pre-printed rule.
//
// Blanks are written {{key}} inside the clause text. buildLease returns their
// page-relative positions in the same normalized shape the transaction-doc
// editor and the e-sign stamper already use (fx/fy/fw, y measured from the top).

export interface Clause {
  title: string;
  blocks: Array<
    | { t: 'p'; text: string }
    | { t: 'ul'; items: string[] }
    | { t: 'notices' }
  >;
}

export interface LeaseValues {
  effective_date?: string; tenant_name?: string; building?: string; suite?: string;
  term_months?: string; end_date?: string; monthly_rent?: string; security_deposit?: string;
  tenant_phone?: string; tenant_email?: string; exec_day?: string; exec_month?: string;
}

/** A fill-in blank, positioned the way crm_form_fields records one. */
export interface LeaseBlank {
  page: number; fx: number; fy: number; fw: number;
  type: 'text' | 'signature' | 'date';
  field_key: string | null; label: string; signer_role?: 'landlord' | 'client';
}

const LANDLORD = {
  name: '8000 Fair Oaks Plaza LLC',
  addr: '8000 Fair Oaks Parkway, Ste. 102',
  city: 'Fair Oaks Ranch, TX 78015',
  attn: 'Zachary A. Stovall',
  phone: '210-817-3443',
  email: 'zack@crecotx.com',
};

const PAGE_W = 612, PAGE_H = 792;
const ML = 72, MR = 72, MT = 72, MB = 66;
const COL = PAGE_W - ML - MR;
const BODY = 10.5, LEAD = 13.2, HEAD = 11.5;
const INK = rgb(0.08, 0.08, 0.11);
const RULE = rgb(0.35, 0.35, 0.4);
// An empty blank has to read as something to fill in, so it keeps a generous rule.
// A filled one shrinks to its value — otherwise "12" trails 60pt of empty line.
const EMPTY_BLANK = 96, FILLED_MIN = 34, BLANK_PAD = 5;

const blankWidth = (f: PDFFont, val: string) =>
  val ? Math.max(FILLED_MIN, f.widthOfTextAtSize(val, BODY) + BLANK_PAD * 2) : EMPTY_BLANK;

const LABELS: Record<string, string> = {
  effective_date: 'Effective / start date', tenant_name: 'Tenant name', building: 'Bldg #',
  suite: 'Suite #', term_months: 'Term (months)', end_date: 'Lease end date',
  monthly_rent: 'Monthly rent ($)', security_deposit: 'Security deposit ($)',
  tenant_phone: 'Tenant phone', tenant_email: 'Tenant email', exec_day: 'Day', exec_month: 'Month',
};

type Tok = { kind: 'w'; s: string } | { kind: 'b'; key: string };

/** Resolve {{ref:Clause Title}} to that clause's current number. */
function resolveRefs(text: string): string {
  return text.replace(/\{\{ref:([^}]+)\}\}/g, (_, title: string) => {
    const i = LEASE_CLAUSES.findIndex(c => c.title === title);
    if (i < 0) throw new Error(`lease-doc: cross-reference to unknown clause "${title}"`);
    return String(i + 1);
  });
}

/** Split "…on {{effective_date}}, and…" into words and blank tokens. */
function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const chunk of text.split(/(\{\{[a-z_]+\}\})/)) {
    if (!chunk) continue;
    const m = chunk.match(/^\{\{([a-z_]+)\}\}$/);
    if (m) { out.push({ kind: 'b', key: m[1] }); continue; }
    for (const w of chunk.split(/\s+/)) if (w) out.push({ kind: 'w', s: w });
  }
  return out;
}

export async function buildLease(v: LeaseValues): Promise<{ pdf: Uint8Array; blanks: LeaseBlank[] }> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const blanks: LeaseBlank[] = [];

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MT;
  const pageNo = () => doc.getPages().length;

  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MT; };
  const need = (h: number) => { if (y - h < MB) newPage(); };

  const w = (f: PDFFont, s: string, size = BODY) => f.widthOfTextAtSize(s, size);

  /** Draw a blank: its value over a rule, and record where it landed. */
  function drawBlank(key: string, x: number, baseline: number, type: LeaseBlank['type'] = 'text', role?: 'landlord' | 'client', width?: number) {
    const val = (v as Record<string, string | undefined>)[key] ?? '';
    // Never let a rule run past the right margin, whatever width was asked for.
    const bw = Math.min(width ?? blankWidth(reg, val), PAGE_W - MR - x);
    if (val) page.drawText(val, { x: x + BLANK_PAD, y: baseline, size: BODY, font: reg, color: INK });
    page.drawLine({ start: { x, y: baseline - 2.5 }, end: { x: x + bw, y: baseline - 2.5 }, thickness: 0.6, color: RULE });
    // Recorded so the transaction-doc editor's overlay lands exactly on this rule:
    // it draws at (fx*W + 2, H - fy*H + 2), and the value sits at x + BLANK_PAD.
    blanks.push({
      page: pageNo(), fx: (x + BLANK_PAD - 2) / PAGE_W, fy: (PAGE_H - baseline + 2) / PAGE_H, fw: bw / PAGE_W,
      type, field_key: type === 'text' ? key : null, label: type === 'text' ? (LABELS[key] ?? key) : key,
      ...(role ? { signer_role: role } : {}),
    });
    return bw;
  }

  /** Flow a paragraph, breaking pages as it goes, with inline blanks. */
  function para(text: string, opts: { indent?: number; gap?: number } = {}) {
    const indent = opts.indent ?? 0;
    const toks = tokenize(resolveRefs(text));
    let line: Tok[] = [];
    let lineW = 0;
    const flush = (last: boolean) => {
      if (!line.length) return;
      need(LEAD);
      let x = ML + indent;
      for (let i = 0; i < line.length; i++) {
        const t = line[i];
        if (t.kind === 'b') { x += drawBlank(t.key, x, y) + w(reg, ' '); continue; }
        page.drawText(t.s, { x, y, size: BODY, font: reg, color: INK });
        x += w(reg, t.s) + w(reg, ' ');
      }
      y -= LEAD;
      line = []; lineW = 0;
      void last;
    };
    for (const t of toks) {
      const tw = t.kind === 'b'
        ? blankWidth(reg, (v as Record<string, string | undefined>)[t.key] ?? '')
        : w(reg, t.s);
      if (lineW && lineW + w(reg, ' ') + tw > COL - indent) flush(false);
      line.push(t);
      lineW += (lineW ? w(reg, ' ') : 0) + tw;
    }
    flush(true);
    y -= opts.gap ?? 5;
  }

  function heading(text: string) {
    need(LEAD * 2.4);
    y -= 5;
    page.drawText(text, { x: ML, y, size: HEAD, font: bold, color: INK });
    y -= LEAD + 1.5;
  }

  // Per-blank widths inside the notice block: the tenant column is narrow, so the
  // generous default rules would push the suite clean off the right edge.
  const NOTICE_BLANK: Record<string, number> = {
    tenant_name: 150, building: 34, suite: 82, tenant_phone: 110, tenant_email: 150,
  };

  function noticesBlock() {
    const rows: Array<[string, string]> = [
      ['LANDLORD:', 'TENANT:'],
      [LANDLORD.name, '{{tenant_name}}'],
      [LANDLORD.addr, '8000 Fair Oaks Parkway'],
      [LANDLORD.city, 'Bldg. {{building}}, Ste {{suite}}'],
      ['', 'Fair Oaks Ranch, TX 78015'],
      [`Attn: ${LANDLORD.attn}`, 'Attn: {{tenant_name}}'],
      [`Phone: ${LANDLORD.phone}`, 'Phone: {{tenant_phone}}'],
      [`Email: ${LANDLORD.email}`, 'Email: {{tenant_email}}'],
    ];
    const LX = ML + 10, RX = ML + 236;
    const RW = PAGE_W - MR - RX;
    need(LEAD * rows.length + 10);
    for (const [l, r] of rows) {
      const top = y;
      if (l) page.drawText(l, { x: LX, y, size: BODY, font: l === 'LANDLORD:' ? bold : reg, color: INK });
      // The tenant side wraps inside its column, so no value can run off the page.
      let x = RX;
      for (const t of tokenize(r)) {
        const bw = t.kind === 'b' ? Math.min(NOTICE_BLANK[t.key] ?? 110, RW) : 0;
        const tw = t.kind === 'b' ? bw : w(reg, t.s);
        if (x > RX && x + tw > RX + RW) { y -= LEAD; x = RX; }
        if (t.kind === 'b') { drawBlank(t.key, x, y, 'text', undefined, bw); x += bw + 3; continue; }
        page.drawText(t.s, { x, y, size: BODY, font: r === 'TENANT:' ? bold : reg, color: INK });
        x += tw + w(reg, ' ');
      }
      y = Math.min(y, top) - LEAD;
    }
    y -= 6;
  }

  // ── Title page header ──────────────────────────────────────────────────────
  const title = 'Building Lease Agreement';
  page.drawText(title, { x: (PAGE_W - bold.widthOfTextAtSize(title, 17)) / 2, y, size: 17, font: bold, color: INK });
  y -= 34;

  para('This lease is effective {{effective_date}} (the “Effective Date”) by and between 8000 Fair Oaks Plaza, LLC whose address is 8000 Fair Oaks Parkway, Ste. 102, Fair Oaks Ranch, Texas 78015 (“Landlord”) and {{tenant_name}} whose address is 8000 Fair Oaks Parkway, Bldg. {{building}}, Suite {{suite}}, Fair Oaks Ranch, TX 78015 (“Tenant”). Landlord leases to Tenant and Tenant leases from Landlord the Leased Premises (the “Leased Premises” or the “Premises”), known and described as:');
  para('A legal description of the property is attached as Exhibit A.');

  // ── Numbered clauses ───────────────────────────────────────────────────────
  // The number comes from position in the list, never from the data, so dropping
  // a clause renumbers everything below it automatically.
  LEASE_CLAUSES.forEach((c, i) => {
    if (c.title === 'Notices and Addresses') {
      need(LEAD * 4); y -= 8;
      const m = 'Miscellaneous';
      page.drawText(m, { x: (PAGE_W - bold.widthOfTextAtSize(m, 13)) / 2, y, size: 13, font: bold, color: INK });
      y -= LEAD + 6;
    }
    heading(`${i + 1}. ${c.title}`);
    for (const b of c.blocks) {
      if (b.t === 'p') para(b.text);
      else if (b.t === 'notices') noticesBlock();
      else for (const item of b.items) {
        need(LEAD);
        page.drawText('•', { x: ML + 14, y, size: BODY, font: reg, color: INK });
        page.drawText(item, { x: ML + 30, y, size: BODY, font: reg, color: INK });
        y -= LEAD;
      }
    }
  });

  // ── Execution ──────────────────────────────────────────────────────────────
  y -= 8;
  para('IN WITNESS OF THIS AGREEMENT, Landlord and Tenant execute this agreement on this the {{exec_day}} Day of {{exec_month}}, 2026, but effective as of the Effective Date.');

  // Keep the signature blocks whole on one page — a lease that splits a signature
  // line across a page break is a lease somebody will sign in the wrong place.
  if (y < MB + 250) newPage(); else y -= 24;

  const sigBlock = (heading2: string, entity: string, who: string, role: 'landlord' | 'client', keyed: boolean) => {
    page.drawText(heading2, { x: ML, y, size: BODY, font: bold, color: INK }); y -= LEAD;
    if (entity) { page.drawText(entity, { x: ML, y, size: BODY, font: bold, color: INK }); y -= LEAD; }
    else { drawBlank('tenant_name', ML, y, 'text', undefined, 240); y -= LEAD; }
    y -= 18;
    page.drawText('By:', { x: ML, y, size: BODY, font: reg, color: INK });
    drawBlank(`${role}_signature`, ML + 26, y, 'signature', role, 210);
    page.drawText('Date:', { x: ML + 268, y, size: BODY, font: reg, color: INK });
    drawBlank(`${role}_date`, ML + 300, y, 'date', role, 110);
    y -= LEAD;
    if (keyed) { page.drawText(who, { x: ML + 26, y, size: BODY, font: reg, color: INK }); y -= LEAD; }
    else { drawBlank('tenant_name', ML + 26, y, 'text', undefined, 210); y -= LEAD; }
    y -= 26;
  };
  sigBlock('LANDLORD:', '8000 FAIR OAKS PLAZA, LLC', LANDLORD.attn, 'landlord', true);
  sigBlock('TENANT:', '', '', 'client', false);

  // ── Exhibit A ──────────────────────────────────────────────────────────────
  newPage();
  const ex = 'EXHIBIT “A”';
  page.drawText(ex, { x: (PAGE_W - bold.widthOfTextAtSize(ex, 14)) / 2, y, size: 14, font: bold, color: INK });
  y -= 34;
  page.drawText('LEGAL DESCRIPTION:', { x: ML, y, size: BODY, font: bold, color: INK });
  y -= LEAD * 2;
  para('Lot 8000, Fair Oaks Parkway at Fair Oaks Ranch, City of Fair Oaks Ranch, Bexar County, Texas, according to plat recorded in Volume 9561, Page 164, Deed and Plat Records, Bexar County, Texas. Building {{building}}, Suite {{suite}}.');

  // Nothing may sit outside the printable column — a blank that runs off the page
  // is invisible in the PDF and silently loses whatever was typed into it.
  for (const b of blanks) {
    const right = (b.fx + b.fw) * PAGE_W;
    if (right > PAGE_W - MR + 1 || b.fx * PAGE_W < ML - 1) {
      throw new Error(`lease-doc: blank "${b.label}" on p${b.page} runs outside the margins (${Math.round(b.fx * PAGE_W)}–${Math.round(right)}pt)`);
    }
  }

  return { pdf: await doc.save(), blanks };
}

export const LEASE_CLAUSES: Clause[] = [
  {
    title: 'Term',
    blocks: [
      { t: 'p', text: 'The lease term will begin on {{effective_date}}, and will continue for a period of {{term_months}} months, ending {{end_date}}. In the event of a change of ownership of the Lease Premises, the purchaser, or designee, may have the right to terminate this Lease Agreement with a sixty (60) day written notice.' },
    ],
  },
  {
    title: 'Rentable Area',
    blocks: [
      { t: 'p', text: 'The “Leased Premises” are located in Building {{building}}, Suite {{suite}}.' },
    ],
  },
  {
    title: 'Basic Rent',
    blocks: [
      { t: 'p', text: 'The monthly rental amount for Suite {{suite}} is ${{monthly_rent}} per month for the term of the Lease. Lease includes shared use of conference room with all Tenants.' },
    ],
  },
  {
    title: 'Security Deposit',
    blocks: [
      { t: 'p', text: 'Tenant has paid ${{security_deposit}} as a security deposit and Landlord acknowledges receipt from Tenant in the amount stated above to be held by Landlord without interest as security for the performances by Tenant of Tenant’s covenants and obligations under this lease, it being expressly understood that such deposit is not an advance payment of rental or a measure of Landlord’s damages in case of default by Tenant.' },
    ],
  },
  {
    title: 'Space Cleaning',
    blocks: [
      { t: 'p', text: 'Tenant will be responsible for cleaning of the interior of the Leased Premises throughout the term of the lease. Landlord will be responsible for cleaning of common area spaces such as the lobby, restrooms and other areas of the building not occupied by the Tenant.' },
    ],
  },
  {
    title: 'Use of Premises',
    blocks: [
      { t: 'p', text: 'Tenant may use the Premises only for general office purposes and for no other use. Tenant will not make or permit any use of the Premises – or do or permit any act – including keeping anything, in or about the Premises, that, directly or indirectly, will tend to injure the reputation of the Leased Premises; disturb any resident of the neighborhood; violate any law, ordinance, or regulation; or violate the terms of, or cause any increase in the rate under, any insurance policy covering or relating to the Premises.' },
      { t: 'p', text: 'Tenant will comply with all laws, ordinances, and governmental regulations and with any direction of any public officer, under law that imposes any duty on Tenant with respect to the Premises or the occupation of the Leased Premises.' },
    ],
  },
  {
    title: 'Inspection by Landlord',
    blocks: [
      { t: 'p', text: 'Tenant will permit Landlord and Landlord’s agents to enter the Premises at all reasonable times for inspection purposes.' },
    ],
  },
  {
    title: 'Right of Entry for Repairs',
    blocks: [
      { t: 'p', text: 'Landlord reserves the right to enter the Premises at all reasonable hours (and if, in Landlord’s opinion, an emergency exists requiring immediate action, at any time) to make replacements, repairs, and restorations and to carry out any work or activities in connection with the improvement, safety, protection, or preservation of the Leased Premises. In the event of the termination of this lease by Landlord or Tenant, Landlord may, at any reasonable time during the last 15 days of the term, enter the Premises to exhibit them to prospective Tenants.' },
    ],
  },
  {
    title: 'Condition of Premises',
    blocks: [
      { t: 'p', text: 'Tenant’s possession of the Premises is conclusive evidence that the Premises, including equipment, fixtures and furnishings, and the building is clean, sanitary, and in good order and condition. Tenant will, throughout the lease term, keep, maintain and repair the Premises, fixtures and furnishings in good, clean, and sanitary order on condition.' },
    ],
  },
  {
    title: 'Altering and Maintaining Premises',
    blocks: [
      { t: 'p', text: 'Tenant will make no alterations (including painting and decorating) in, or additions of any kind to, the Premises or its fixtures, or equipment without Landlord’s prior written consent, which Landlord may refuse, or condition in any manner, in accordance with Landlord’s sole determination, which is conclusive. All alterations completed or additions or installed equipment in place, at the time this Lease is signed are approved by Landlord. All such alterations or additions that Landlord approve are at Tenant’s sole expense, and Tenant will hold Landlord harmless from all liabilities in any way connected with them.' },
      { t: 'p', text: 'All additions, hardware, fixtures, and improvement placed in the Premises by Tenant are Tenant’s property and may be removed by Tenant on any termination of the lease term except the following:' },
      { t: 'ul', items: ['HVACequipment', 'Electrical and lighting equipment', 'Plumbing', 'Bathroom fixtures'] },
      { t: 'p', text: 'If Tenant alters or improves the Premises or paints or redecorates without Landlord’s prior written consent, Tenant will bear and must promptly pay Landlord – on written demand – the full cost of restoring the Premises to their prior condition. Notwithstanding the foregoing, Tenant must continue to maintain the Leased Premises in good condition for its use as set forth in Section {{ref:Use of Premises}}. This will require maintenance of the Leased Premises. Such maintenance is not considered to be alteration or improvement of the Premises.' },
    ],
  },
  {
    title: 'Responsibility',
    blocks: [
      { t: 'p', text: 'Landlord is not liable – and Tenant waives all claims – for injury to or death of persons or damage to or loss of property sustained by Tenant or Tenant’s customers, invites or guests resulting from the Leased Premises or any part of it or any of its equipment or appurtenances being out of repair, or resulting directly or indirectly from any act or neglect of any Tenant or occupant of the Leased Premises or of any other person, or from any other cause except Landlord’s gross negligence.' },
    ],
  },
  {
    title: 'Condemnation',
    blocks: [
      { t: 'p', text: 'If, during the lease term or any extension or renewal of this lease, all of the Premises are taken for any public or quasi-public use under any governmental law, ordinance, or regulation, or by right of eminent domain, or are sold to the condemning authority under threat of condemnation, this lease will terminate, and the rent will be abated during the unexpired portion of this lease, effective as of the date the condemning authority takes the Premises.' },
      { t: 'p', text: 'If less than all of the Premises is taken for any public or quasi-public use under any governmental law, ordinance, or regulation, or by right of eminent domain, or is sold to the condemning authority under threat of condemnation this lease will not terminate, but Landlord will restore and reconstruct the building and other improvements situated on the Premises at Landlord’s sole expense, if restoration and reconstruction will make the Premises reasonably tenantable and suitable for use as an office. The rent payable during the unexpired potion of this lease will be adjusted equitably.' },
      { t: 'p', text: 'Tenant is not entitled to receive, and Tenant hereby waives, any portion of a lump-sum award related to Tenant’s leased interest in the property in any condemnation proceedings. The termination of this lease ceases Tenant’s rights to such awards.' },
    ],
  },
  {
    title: 'End of Term',
    blocks: [
      { t: 'p', text: 'Before the lease term expires or otherwise terminates, Tenant is required to give a sixty (60) day notice of its intent to vacate, Tenant will quit and surrender Landlord the Premises in good, clean condition and, to the extent required by Landlord, all improvements and alterations made by Tenant will become part of the leased property and will revert to Landlord. If, in order to comply with Tenant’s obligations, any repairs, restoration, or cleaning is required, Tenant or Tenant heirs, assigns, successors or estate will bear the costs. Tenant’s obligation under this paragraph will survive the expiration or other termination of the lease term.' },
    ],
  },
  {
    title: 'Holding Over',
    blocks: [
      { t: 'p', text: 'If Tenant remains in possession of the Premises after the lease expires or otherwise terminates, then, if Landlord elects by written notice to Tenant, but not otherwise, Tenant will be considered a Tenant from month-to-month and subject to all of the terms of this lease, except for (a) the lease term, and (b) the monthly rental, which, unless Landlord and Tenant both agree in writing, will be (a) monthly and (b) 110% of the prior month’s rent under this lease. The inclusion of the preceding sentence shall not be construed as Landlord’s consent for Tenant to hold over.' },
    ],
  },
  {
    title: 'Remedies',
    blocks: [
      { t: 'p', text: 'All Landlord’s rights and remedies under this lease are cumulative, and none will exclude any other right or remedy allowed Landlord by law or provided for in any other section of this lease.' },
    ],
  },
  {
    title: 'Objectionable Conduct; Right to Terminate',
    blocks: [
      { t: 'p', text: 'If Landlord deems objectionable or improper any conduct in or about the Premises on Tenant’s part or that of Tenant’s family, agents, employees, visitors, guests, licensees, or customers, Landlord may give Tenant thirty (30) day notice of intention to terminate this lease and tender any rent already paid on account of the then-unexpired term, and when that thirty (30) day period expires, this lease will terminate, and Tenant will then surrender the Premises to Landlord as this lease provides.' },
    ],
  },
  {
    title: 'Insolvency, Default, Late Fees, Other Grounds; Right to Terminate',
    blocks: [
      { t: 'p', text: 'Landlord may, if Landlord so elects, with or without notice, immediately terminate this lease or, without terminating it, immediately terminate Tenant’s right to possess the Premises, under the following circumstances:' },
      { t: 'ul', items: ['Tenant defaults in paying Basic Rent or in promptly and fully performing any provision of this lease;', 'Tenant’s leasehold interest is levied on or attached by process of law;', 'Tenant makes an assignment for the benefit of creditors;', 'A receiver is appointed for any of Tenant’s property; or', 'Tenant abandons the Premises'] },
      { t: 'p', text: 'Rent is due on the 1st day of every month, without offset or deduction of any nature. In the event that any rental is not received within five (5) days after its due date for any reason whatsoever, then in addition to the past due amount, Tenant shall pay to Landlord a $30.00 late fee. In the event Tenant pays any rent or other charge by check or draft, and said check or draft is not honored by the bank on which it is drawn, an additional charge of $50.00 shall be immediately due and payable from Tenant to Landlord. If, in any such case, Landlord terminates the lease, Landlord is entitled to recover from Tenant an amount equal to the rent currently in effect under this lease for the balance of the stated lease term, less the then fair rental value of the Premises for the balance of the term. In addition, Landlord shall have a lien as security for the basic Rent and upon all goods, wares, chattels, implements, fixtures, furniture, tools and other personal property which are or may be put on the demised Premises.' },
    ],
  },
  {
    title: 'Repossessing Leased Premises',
    blocks: [
      { t: 'p', text: 'On any termination of this lease, or on any termination of Tenant’s right to possession without termination of the lease, Landlord may enter and repossess the Leased Premises and remove any property from them, without being considered guilty of trespass, eviction, forcible entry, or detainer.' },
    ],
  },
  {
    title: 'Re-letting for Tenant’s Account',
    blocks: [
      { t: 'p', text: 'If, under the foregoing provisions, Landlord is entitled to – and elects to – terminate Tenant’s right to possession only, without terminating the lease, then Landlord’s exercise of such right will not terminate the lease, and on and after entry into possession without terminating this lease, Landlord may, but need not, re-let the Premises or any part of them for Tenant’s account for such rent, for such time, and on such terms as Landlord determines its sole discretion. In any such case, Landlord may redecorate and make repairs, alterations, and additions in or to the Premises of them, together with Landlord re-letting expenses. If the consideration Landlord collects on re-letting for Tenant’s account is not enough to pay monthly the full amount of the rent reserved in this lease, together with the costs of repairs, alterations, additions, redecoration, and rent-collection expenses, Tenant will pay Landlord the amount of each monthly deficiency on demand.' },
    ],
  },
  {
    title: 'Abandoned Property',
    blocks: [
      { t: 'p', text: 'Landlord may handle, dispose of, or remove - at Tenant’s risk and expense - any of Tenant’s property left in the Leased Premises after this lease or Tenant’s right of possession terminates for any reason, and Landlord will in no event be responsible for any property Tenant leaves in the Premises.' },
    ],
  },
  {
    title: 'Reimbursement of Landlord’s Expenses',
    blocks: [
      { t: 'p', text: 'Tenant will pay, on demand, all Landlord’s expenses, including attorney’s fees, incurred in enforcing Tenant’s lease obligations.' },
    ],
  },
  {
    title: 'No Waiver',
    blocks: [
      { t: 'p', text: 'Landlord’s waiving any default or breach of any term or covenant of this Lease by Tenant will not be considered a waiver of any other breach by Tenant of the same or any other term or covenant of this lease.' },
    ],
  },
  {
    title: 'Subordination',
    blocks: [
      { t: 'p', text: 'This lease is subordinate to all recorded covenants and conditions that now affect – and to all ground or underlying leases, mortgages, or deeds of trust that may now or in the future affect – the real property of which the building forms a part, including leases, mortgages, ad deeds of trust that cover this real property and other Premises as a blanket lien or otherwise, and to all renewal, extensions, modifications, consolidations, and replacement of them. This clause is self-operative; no further instrument or act is required to effectuate this subordination, but, in confirmation of this subordination, Tenant will execute promptly, and will not withhold approval of, any certificate or other document that Landlord request.' },
    ],
  },
  {
    title: 'Interest',
    blocks: [
      { t: 'p', text: 'All amounts (other than rent) that Tenant or Landlord owes under this lease must be paid within thirty (30) days from the date either party delivers statements of account and will bear interest at the rate of eighteen (18) percent annually after that date until paid (which shall be reduced to the lower legal rate if required under Texas Law). Rent shall be considered late if not received by Landlord on or before the fifth (5th) day of each month.' },
    ],
  },
  {
    title: 'Assignment of Subletting by Tenant',
    blocks: [
      { t: 'p', text: 'Tenant may not assign this lease or any interest under it, or sublet the Premises or any part of them, or permit the use or occupancy of the Premises or any part of them by anyone other than Tenant. An assignment to a corporation, limited liability company or limited partnership of which Tenant is a principal owner is not a prohibited transfer of the lease, so long as Tenant agrees to personally and individually guarantee the performance of this lease obligation.' },
    ],
  },
  {
    title: 'Assignment by Landlord',
    blocks: [
      { t: 'p', text: 'Landlord may assign or otherwise transfer any or all of its interest under the terms of this lease.' },
    ],
  },
  {
    title: 'Insurance',
    blocks: [
      { t: 'p', text: 'Tenant, shall, at its own expense, provide and maintain in force during the term of this lease, bodily injury liability insurance in the aggregate amount of Three Hundred Thousand ($300,000) and property damage liability insurance in the amount of One Hundred Thousand ($100,000) with one or more responsible insurance companies duly authorized to transact business in Texas, protecting Landlord and Tenant against any claim arising from or incidental to Tenant’s use of the Premises included in this lease. Tenant shall furnish Landlord with certificates of all insurance required by this section. If Tenant does not maintain such insurance if effect, Landlord may, at its option, take out the necessary insurance to comply with the provisions hereof and Tenant covenants to reimburse and pay Landlord upon demand any amounts paid or expended by landlord for premiums on said bodily injury and property damage liability insurance policy or policies, with interest thereon at the rate of eighteen (18) percent per annum from the date of such payment until repaid by Tenant.' },
    ],
  },
  {
    title: 'Indemnity',
    blocks: [
      { t: 'p', text: 'Tenant will not permit any mechanic’s lien or liens to be placed on the Premises or building or improvements there on during the term hereof, and in case of the filing of any such lien Tenant will promptly pay same. If default in payment thereof shall continue for twenty (20) days after written notice thereof from Landlord, the Landlord shall have the right and privilege at Landlord’s option of paying the same or any portion thereof without inquiry as to the validity indebtedness hereunder due from Tenant to Landlord and shall be repaid to Landlord immediately on rendition of bill therefore, together with interest thereon at the rate of eighteen (18) percent per annum from the date of such payment until repaid by Tenant (which shall be reduced to the lower legal rate if so required under Texas Law).' },
    ],
  },
  {
    title: 'Notices and Addresses',
    blocks: [
      { t: 'p', text: 'All notices must be given in writing to the proper party as follows:' },
      { t: 'notices' },
    ],
  },
  {
    title: 'Parties Bound',
    blocks: [
      { t: 'p', text: 'This lease agreement will bind and inure to the benefit of the parties and their respective heirs, executors, administrators, legal representatives, successors, and assigns when this lease agreement permits.' },
    ],
  },
  {
    title: 'Texas Law to Apply',
    blocks: [
      { t: 'p', text: 'This lease agreement is to be construed under Texas Law.' },
    ],
  },
  {
    title: 'Legal Construction',
    blocks: [
      { t: 'p', text: 'If any one or more of the lease provisions are for any reason held invalid, illegal, or unenforceable in any respect, such invalidity, illegality, or unenforceability will not affect any other provision of this lease, which will be construed as if it had never included the invalid, illegal, or unenforceable provision.' },
    ],
  },
  {
    title: 'Prior Agreements Superseded',
    blocks: [
      { t: 'p', text: 'This lease agreement constitutes the sole agreement between the parties and superseded any prior understanding or written or oral agreements between the parties respecting the subject matter.' },
    ],
  },
  {
    title: 'Amendment',
    blocks: [
      { t: 'p', text: 'No amendment, modification, or alteration of this lease is binding unless in writing, dated subsequent to the date of this lease, and duly executed by the parties.' },
    ],
  },
  {
    title: 'Rights and Remedies Cumulative',
    blocks: [
      { t: 'p', text: 'The rights and remedies of this lease are cumulative, and either party’s using any one right or remedy will not preclude or waive that party’s right to use any other remedy. These rights and remedies are in addition to any other rights the parties may have by law, statue, ordinance, or otherwise.' },
    ],
  },
];
