// Generate the 8000 Fair Oaks Plaza Building Lease as a BLANK fillable template.
// Records every field's page + fractional x/y/w and a shared field_key so repeated
// values (tenant name, suite, effective date, ...) fill together in the CRM editor.
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

(async () => {
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const bold  = await doc.embedFont(StandardFonts.TimesRomanBold);

  const PW = 612, PH = 792;         // US Letter
  const M = 72;                     // 1" margins
  const RIGHT = PW - M;             // 540
  const BODY = 10.5, HEAD = 11, TITLE = 15;
  const ink = rgb(0.09, 0.09, 0.12);
  const lineCol = rgb(0.45, 0.45, 0.5);

  let page, y, pageIndex = -1;
  const fields = [];

  const LABELS = {
    effective_date: 'Effective / start date', end_date: 'Lease end date',
    term_months: 'Term (months)', tenant_name: 'Tenant name',
    building: 'Bldg #', suite: 'Suite #', floor: 'Floor',
    rentable_area: 'Rentable area (sf)', monthly_rent: 'Monthly rent ($)',
    security_deposit: 'Security deposit ($)', tenant_phone: 'Tenant phone',
    tenant_email: 'Tenant email', exec_day: 'Day', exec_month: 'Month',
  };
  const FW = {
    effective_date: 100, end_date: 100, term_months: 26, tenant_name: 165,
    building: 24, suite: 38, floor: 52, rentable_area: 42, monthly_rent: 58,
    security_deposit: 58, tenant_phone: 92, tenant_email: 135, exec_day: 64, exec_month: 150,
  };

  function newPage() { page = doc.addPage([PW, PH]); pageIndex++; y = PH - M; }
  function ensure(h) { if (y - h < M) newPage(); }

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

  // Paragraph with inline fields. parts = array of strings and {f:'key'} objects.
  function para(parts, opts = {}) {
    const size = opts.size || BODY;
    const font = opts.font || times;
    const indent = opts.indent || 0;
    const lh = size * 1.34;
    const startX = M + indent;
    const maxX = RIGHT;
    // tokenize
    const toks = [];
    for (const part of parts) {
      if (typeof part === 'string') {
        for (const c of part.split(/(\s+)/)) {
          if (c === '') continue;
          if (/^\s+$/.test(c)) toks.push({ t: 'sp' });
          else toks.push({ t: 'w', s: c });
        }
      } else {
        toks.push({ t: 'f', key: part.f, w: FW[part.f] });
      }
    }
    ensure(lh);
    let x = startX, lineStart = true;
    const spaceW = font.widthOfTextAtSize(' ', size);
    for (const tk of toks) {
      if (tk.t === 'sp') { if (!lineStart) x += spaceW; continue; }
      const w = tk.t === 'w' ? font.widthOfTextAtSize(tk.s, size) : tk.w;
      if (!lineStart && x + w > maxX) { y -= lh; ensure(lh); x = startX; lineStart = true; }
      if (tk.t === 'w') { page.drawText(tk.s, { x, y, size, font, color: ink }); x += w; }
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
  function bullet(text) {
    const size = BODY, lh = size * 1.34, indent = 22;
    ensure(lh);
    page.drawText('•', { x: M + 8, y, size, font: times, color: ink });
    para([text], { indent, gapAfter: 1 });
  }
  function spacer(h) { ensure(h); y -= h; }
  function centered(text, size, font) {
    const w = font.widthOfTextAtSize(text, size);
    ensure(size * 1.6);
    page.drawText(text, { x: (PW - w) / 2, y, size, font, color: ink });
    y -= size * 1.7;
  }
  function section(title, ...paras) {
    heading(title);
    for (const p of paras) para(p);
  }

  // ── Page 1: title + intro ──────────────────────────────────────────────────
  newPage();
  centered('Building Lease Agreement', TITLE, bold);
  spacer(6);
  para([
    'This lease is effective ', { f: 'effective_date' }, ' (the “Effective Date”) by and between 8000 Fair Oaks Plaza, LLC whose address is 8000 Fair Oaks Parkway, Ste. 102, Fair Oaks Ranch, Texas 78015 (“Landlord”) and ',
    { f: 'tenant_name' }, ' whose address is 8000 Fair Oaks Parkway, Bldg. ', { f: 'building' }, ', Suite ', { f: 'suite' },
    ', Fair Oaks Ranch, TX 78015 (“Tenant”). Landlord leases to Tenant and Tenant leases from Landlord the Leased Premises (the “Leased Premises” or the “Premises”), known and described as:',
  ]);
  para(['A legal description of the property is attached as Exhibit A.']);

  section('1.  Term',
    ['The lease term will begin on ', { f: 'effective_date' }, ', and will continue for a period of ', { f: 'term_months' },
      ' months, ending ', { f: 'end_date' }, '. In the event of a change of ownership of the Lease Premises, the purchaser, or designee, may have the right to terminate this Lease Agreement with a sixty (60) day written notice.']);

  section('2.  Rentable Area',
    ['The Total Rentable Area of the “Leased Premises” comprises ', { f: 'rentable_area' }, ' square feet +/- and is located on the ',
      { f: 'floor' }, ' Floor, Building ', { f: 'building' }, ', Suite ', { f: 'suite' }, '.']);

  section('3.  Basic Rent',
    ['The monthly rental amount for Suite ', { f: 'suite' }, ' is $', { f: 'monthly_rent' }, ' per month for the term of the Lease. Lease includes shared use of conference room with all Tenants.']);

  section('4.  Security Deposit',
    ['Tenant has paid $', { f: 'security_deposit' }, ' as a security deposit and Landlord acknowledges receipt from Tenant in the amount stated above to be held by Landlord without interest as security for the performances by Tenant of Tenant’s covenants and obligations under this lease, it being expressly understood that such deposit is not an advance payment of rental or a measure of Landlord’s damages in case of default by Tenant.']);

  section('5.  Personal Property Taxes',
    ['Tenant must pay - not later than fifteen (15) days before they become delinquent – all taxes and assessments of any kind levied or assessed during the lease term on the fixtures, furniture, appliances, or other personal property located on the Premises. Tenant must furnish Landlord proof of payment not later that five (5) days before the tax or assessment becomes delinquent.']);

  section('6.  Space Cleaning',
    ['Tenant will be responsible for cleaning of the interior of the Leased Premises throughout the term of the lease. Landlord will be responsible for cleaning of common area spaces such as the lobby, restrooms and other areas of the building not occupied by the Tenant.']);

  section('7.  Use of Premises',
    ['Tenant may use the Premises only for general office purposes and for no other use. Tenant will not make or permit any use of the Premises – or do or permit any act – including keeping anything, in or about the Premises, that, directly or indirectly, will tend to injure the reputation of the Leased Premises; disturb any resident of the neighborhood; violate any law, ordinance, or regulation; or violate the terms of, or cause any increase in the rate under, any insurance policy covering or relating to the Premises.'],
    ['Tenant will comply with all laws, ordinances, and governmental regulations and with any direction of any public officer, under law that imposes any duty on Tenant with respect to the Premises or the occupation of the Leased Premises.']);

  section('8.  Inspection by Landlord',
    ['Tenant will permit Landlord and Landlord’s agents to enter the Premises at all reasonable times for inspection purposes.']);

  section('9.  Right of Entry for Repairs',
    ['Landlord reserves the right to enter the Premises at all reasonable hours (and if, in Landlord’s opinion, an emergency exists requiring immediate action, at any time) to make replacements, repairs, and restorations and to carry out any work or activities in connection with the improvement, safety, protection, or preservation of the Leased Premises. In the event of the termination of this lease by Landlord or Tenant, Landlord may, at any reasonable time during the last 15 days of the term, enter the Premises to exhibit them to prospective Tenants.']);

  section('10.  Condition of Premises',
    ['Tenant’s possession of the Premises is conclusive evidence that the Premises, including equipment, fixtures and furnishings, and the building is clean, sanitary, and in good order and condition.  Tenant will, throughout the lease term, keep, maintain and repair the Premises, fixtures and furnishings in good, clean, and sanitary order on condition.']);

  section('11.  Altering and Maintaining Premises',
    ['Tenant will make no alterations (including painting and decorating) in, or additions of any kind to, the Premises or its fixtures, or equipment without Landlord’s prior written consent, which Landlord may refuse, or condition in any manner, in accordance with Landlord’s sole determination, which is conclusive. All alterations completed or additions or installed equipment in place, at the time this Lease is signed are approved by Landlord. All such alterations or additions that Landlord approve are at Tenant’s sole expense, and Tenant will hold Landlord harmless from all liabilities in any way connected with them.'],
    ['All additions, hardware, fixtures, and improvement placed in the Premises by Tenant are Tenant’s property and may be removed by Tenant on any termination of the lease term except the following:']);
  bullet('HVAC equipment');
  bullet('Electrical and lighting equipment');
  bullet('Plumbing');
  bullet('Bathroom fixtures');
  spacer(4);
  para(['If Tenant alters or improves the Premises or paints or redecorates without Landlord’s prior written consent, Tenant will bear and must promptly pay Landlord – on written demand – the full cost of restoring the Premises to their prior condition. Notwithstanding the foregoing, Tenant must continue to maintain the Leased Premises in good condition for its use as set forth in Section 6. This will require maintenance of the Leased Premises. Such maintenance is not considered to be alteration or improvement of the Premises.']);

  section('12.  Responsibility',
    ['Landlord is not liable – and Tenant waives all claims – for injury to or death of persons or damage to or loss of property sustained by Tenant or Tenant’s customers, invites or guests resulting from the Leased Premises or any part of it or any of its equipment or appurtenances being out of repair, or resulting directly or indirectly from any act or neglect of any Tenant or occupant of the Leased Premises or of any other person, or from any other cause except Landlord’s gross negligence.']);

  section('13.  Condemnation',
    ['If, during the lease term or any extension or renewal of this lease, all of the Premises are taken for any public or quasi-public use under any governmental law, ordinance, or regulation, or by right of eminent domain, or are sold to the condemning authority under threat of condemnation, this lease will terminate, and the rent will be abated during the unexpired portion of this lease, effective as of the date the condemning authority takes the Premises.'],
    ['If less than all of the Premises is taken for any public or quasi-public use under any governmental law, ordinance, or regulation, or by right of eminent domain, or is sold to the condemning authority under threat of condemnation this lease will not terminate, but Landlord will restore and reconstruct the building and other improvements situated on the Premises at Landlord’s sole expense, if restoration and reconstruction will make the Premises reasonably tenantable and suitable for use as an office. The rent payable during the unexpired potion of this lease will be adjusted equitably.'],
    ['Tenant is not entitled to receive, and Tenant hereby waives, any portion of a lump-sum award related to Tenant’s leased interest in the property in any condemnation proceedings. The termination of this lease ceases Tenant’s rights to such awards.']);

  section('14.  End of Term',
    ['Before the lease term expires or otherwise terminates, Tenant is required to give a sixty (60) day notice of its intent to vacate, Tenant will quit and surrender Landlord the Premises in good, clean condition and, to the extent required by Landlord, all improvements and alterations made by Tenant will become part of the leased property and will revert to Landlord. If, in order to comply with Tenant’s obligations, any repairs, restoration, or cleaning is required, Tenant or Tenant heirs, assigns, successors or estate will bear the costs. Tenant’s obligation under this paragraph will survive the expiration or other termination of the lease term.']);

  section('15.  Holding Over',
    ['If Tenant remains in possession of the Premises after the lease expires or otherwise terminates, then, if Landlord elects by written notice to Tenant, but not otherwise, Tenant will be considered a Tenant from month-to-month and subject to all of the terms of this lease, except for (a) the lease term, and (b) the monthly rental, which, unless Landlord and Tenant both agree in writing, will be (a) monthly and (b) 110% of the prior month’s rent under this lease. The inclusion of the preceding sentence shall not be construed as Landlord’s consent for Tenant to hold over.']);

  section('16.  Remedies',
    ['All Landlord’s rights and remedies under this lease are cumulative, and none will exclude any other right or remedy allowed Landlord by law or provided for in any other section of this lease.']);

  section('17.  Objectionable Conduct; Right to Terminate',
    ['If Landlord deems objectionable or improper any conduct in or about the Premises on Tenant’s part or that of Tenant’s family, agents, employees, visitors, guests, licensees, or customers, Landlord may give Tenant thirty (30) day notice of intention to terminate this lease and tender any rent already paid on account of the then-unexpired term, and when that thirty (30) day period expires, this lease will terminate, and Tenant will then surrender the Premises to Landlord as this lease provides.']);

  section('18.  Insolvency, Default, Late Fees, Other Grounds; Right to Terminate',
    ['Landlord may, if Landlord so elects, with or without notice, immediately terminate this lease or, without terminating it, immediately terminate Tenant’s right to possess the Premises, under the following circumstances:']);
  bullet('Tenant defaults in paying Basic Rent or in promptly and fully performing any provision of this lease;');
  bullet('Tenant’s leasehold interest is levied on or attached by process of law;');
  bullet('Tenant makes an assignment for the benefit of creditors;');
  bullet('A receiver is appointed for any of Tenant’s property; or');
  bullet('Tenant abandons the Premises');
  spacer(4);
  para(['Rent is due on the 1st day of every month, without offset or deduction of any nature. In the event that any rental is not received within five (5) days after its due date for any reason whatsoever, then in addition to the past due amount, Tenant shall pay to Landlord a $30.00 late fee. In the event Tenant pays any rent or other charge by check or draft, and said check or draft is not honored by the bank on which it is drawn, an additional charge of $50.00 shall be immediately due and payable from Tenant to Landlord.  If, in any such case, Landlord terminates the lease, Landlord is entitled to recover from Tenant an amount equal to the rent currently in effect under this lease for the balance of the stated lease term, less the then fair rental value of the Premises for the balance of the term.  In addition, Landlord shall have a lien as security for the basic Rent and upon all goods, wares, chattels, implements, fixtures, furniture, tools and other personal property which are or may be put on the demised Premises.']);

  section('19.  Repossessing Leased Premises',
    ['On any termination of this lease, or on any termination of Tenant’s right to possession without termination of the lease, Landlord may enter and repossess the Leased Premises and remove any property from them, without being considered guilty of trespass, eviction, forcible entry, or detainer.']);

  section('20.  Re-letting for Tenant’s Account',
    ['If, under the foregoing provisions, Landlord is entitled to – and elects to – terminate Tenant’s right to possession only, without terminating the lease, then Landlord’s exercise of such right will not terminate the lease, and on and after entry into possession without terminating this lease, Landlord may, but need not, re-let the Premises or any part of them for Tenant’s account for such rent, for such time, and on such terms as Landlord determines its sole discretion. In any such case, Landlord may redecorate and make repairs, alterations, and additions in or to the Premises of them, together with Landlord re-letting expenses. If the consideration Landlord collects on re-letting for Tenant’s account is not enough to pay monthly the full amount of the rent reserved in this lease, together with the costs of repairs, alterations, additions, redecoration, and rent-collection expenses, Tenant will pay Landlord the amount of each monthly deficiency on demand.']);

  section('21.  Abandoned Property',
    ['Landlord may handle, dispose of, or remove - at Tenant’s risk and expense - any of Tenant’s property left in the Leased Premises after this lease or Tenant’s right of possession terminates for any reason, and Landlord will in no event be responsible for any property Tenant leaves in the Premises.']);

  section('22.  Reimbursement of Landlord’s Expenses',
    ['Tenant will pay, on demand, all Landlord’s expenses, including attorney’s fees, incurred in enforcing Tenant’s lease obligations.']);

  section('23.  No Waiver',
    ['Landlord’s waiving any default or breach of any term or covenant of this Lease by Tenant will not be considered a waiver of any other breach by Tenant of the same or any other term or covenant of this lease.']);

  section('24.  Subordination',
    ['This lease is subordinate to all recorded covenants and conditions that now affect – and to all ground or underlying leases, mortgages, or deeds of trust that may now or in the future affect – the real property of which the building forms a part, including leases, mortgages, ad deeds of trust that cover this real property and other Premises as a blanket lien or otherwise, and to all renewal, extensions, modifications, consolidations, and replacement of them. This clause is self-operative; no further instrument or act is required to effectuate this subordination, but, in confirmation of this subordination, Tenant will execute promptly, and will not withhold approval of, any certificate or other document that Landlord request.']);

  section('25.  Interest',
    ['All amounts (other than rent) that Tenant or Landlord owes under this lease must be paid within thirty (30) days from the date either party delivers statements of account and will bear interest at the rate of eighteen (18) percent annually after that date until paid (which shall be reduced to the lower legal rate if  required under Texas Law). Rent shall be considered late if not received by Landlord on or before the fifth (5th) day of each month.']);

  section('26.  Assignment of Subletting by Tenant',
    ['Tenant may not assign this lease or any interest under it, or sublet the Premises or any part of them, or permit the use or occupancy of the Premises or any part of them by anyone other than Tenant. An assignment to a corporation, limited liability company or limited partnership of which Tenant is a principal owner is not a prohibited transfer of the lease, so long as Tenant agrees to personally and individually guarantee the performance of this lease obligation.']);

  section('27.  Assignment by Landlord',
    ['Landlord may assign or otherwise transfer any or all of its interest under the terms of this lease.']);

  section('28.  Insurance',
    ['Tenant, shall, at its own expense, provide and maintain in force during the term of this lease, bodily injury liability insurance in the aggregate amount of Three Hundred Thousand ($300,000) and property damage liability insurance in the amount of One Hundred Thousand ($100,000) with one or more responsible insurance companies duly authorized to transact business in Texas, protecting Landlord and Tenant against any claim arising from or incidental to Tenant’s use of the Premises included in this lease. Tenant shall furnish Landlord with certificates of all insurance required by this section. If Tenant does not maintain such insurance if effect, Landlord may, at its option, take out the necessary insurance to comply with the provisions hereof and Tenant covenants to reimburse and pay Landlord upon demand any amounts paid or expended by landlord for premiums on said bodily injury and property damage liability insurance policy or policies, with interest thereon at the rate of eighteen (18) percent per annum from the date of such payment until repaid by Tenant.']);

  section('29.  Indemnity',
    ['Tenant will not permit any mechanic’s lien or liens to be placed on the Premises or building or improvements there on during the term hereof, and in case of the filing of any such lien Tenant will promptly pay same. If default in payment thereof shall continue for twenty (20) days after written notice thereof from Landlord, the Landlord shall have the right and privilege at Landlord’s option of paying the same or any portion thereof without inquiry as to the validity indebtedness hereunder due from Tenant to Landlord and shall be repaid to Landlord immediately on rendition of bill therefore, together with interest thereon at the rate of eighteen (18) percent per annum from the date of such payment until repaid by Tenant (which shall be reduced to the lower legal rate if so required under Texas Law).']);

  section('30.  Assignment by Landlord',
    ['Landlord may assign or otherwise transfer any or all of its interest under the terms of this lease.']);

  spacer(6);
  centered('Miscellaneous', HEAD + 1, bold);
  spacer(2);

  section('31.  Notices and Addresses',
    ['All notices must be given in writing to the proper party as follows:']);

  // ── two-column notices block ──────────────────────────────────────────────
  {
    const cs = 9;                 // column font size
    const lh = 14;
    const lx = M + 6;             // left column
    const rx = 312;              // right column
    ensure(lh * 8);
    const rowStart = y;
    const L = [
      [{ b: 'LANDLORD:' }],
      [{ s: '8000 Fair Oaks Plaza LLC' }],
      [{ s: '8000 Fair Oaks Parkway, Ste. 102' }],
      [{ s: 'Fair Oaks Ranch, TX 78015' }],
      [{ s: 'Attn:  Zachary A. Stovall' }],
      [{ s: 'Phone:  210-817-3443' }],
      [{ s: 'Email:  zack@crecotx.com' }],
    ];
    const R = [
      [{ b: 'TENANT:' }],
      [{ f: 'tenant_name' }],
      [{ s: '8000 Fair Oaks Parkway, Bldg. ' }, { f: 'building' }, { s: ', Ste ' }, { f: 'suite' }],
      [{ s: 'Fair Oaks Ranch, TX 78015' }],
      [{ s: 'Attn:  ' }, { f: 'tenant_name' }],
      [{ s: 'Phone:  ' }, { f: 'tenant_phone' }],
      [{ s: 'Email:  ' }, { f: 'tenant_email' }],
    ];
    const drawCol = (segs, colX, rowY) => {
      let x = colX;
      for (const seg of segs) {
        if (seg.s) { page.drawText(seg.s, { x, y: rowY, size: cs, font: times, color: ink }); x += times.widthOfTextAtSize(seg.s, cs); }
        else if (seg.b) { page.drawText(seg.b, { x, y: rowY, size: cs, font: bold, color: ink }); x += bold.widthOfTextAtSize(seg.b, cs); }
        else if (seg.f) { const w = FW[seg.f]; page.drawLine({ start: { x, y: rowY - 1.5 }, end: { x: x + w, y: rowY - 1.5 }, thickness: 0.6, color: lineCol }); recordField(seg.f, x, rowY, w); x += w; }
      }
    };
    for (let i = 0; i < L.length; i++) {
      const rowY = rowStart - i * lh;
      drawCol(L[i], lx, rowY);
      drawCol(R[i], rx, rowY);
    }
    y = rowStart - L.length * lh - 6;
  }

  section('32.  Parties Bound',
    ['This lease agreement will bind and inure to the benefit of the parties and their respective heirs, executors, administrators, legal representatives, successors, and assigns when this lease agreement permits.']);
  section('33.  Texas Law to Apply',
    ['This lease agreement is to be construed under Texas Law.']);
  section('34.  Legal Construction',
    ['If any one or more of the lease provisions are for any reason held invalid, illegal, or unenforceable in any respect, such invalidity, illegality, or unenforceability will not affect any other provision of this lease, which will be construed as if it had never included the invalid, illegal, or unenforceable provision.']);
  section('35.  Prior Agreements Superseded',
    ['This lease agreement constitutes the sole agreement between the parties and superseded any prior understanding or written or oral agreements between the parties respecting the subject matter.']);
  section('36.  Amendment',
    ['No amendment, modification, or alteration of this lease is binding unless in writing, dated subsequent to the date of this lease, and duly executed by the parties.']);
  section('37.  Rights and Remedies Cumulative',
    ['The rights and remedies of this lease are cumulative, and either party’s using any one right or remedy will not preclude or waive that party’s right to use any other remedy. These rights and remedies are in addition to any other rights the parties may have by law, statue, ordinance, or otherwise.']);

  spacer(8);
  para(['IN WITNESS OF THIS AGREEMENT, Landlord and Tenant execute this agreement on this the ', { f: 'exec_day' }, ' Day of ', { f: 'exec_month' }, ', 2026, but effective as of the Effective Date.']);

  // ── signature block ───────────────────────────────────────────────────────
  const sigLine = (labelX, label, lineFrom, lineTo, rowY) => {
    page.drawText(label, { x: labelX, y: rowY, size: BODY, font: times, color: ink });
    page.drawLine({ start: { x: lineFrom, y: rowY - 1.5 }, end: { x: lineTo, y: rowY - 1.5 }, thickness: 0.7, color: lineCol });
  };
  ensure(150);
  spacer(6);
  para(['LANDLORD:'], { gapAfter: 2 });
  para(['8000 FAIR OAKS PLAZA, LLC'], { gapAfter: 14 });
  sigLine(M, 'By:  ', M + 26, M + 300, y);
  y -= 14;
  page.drawText('Zachary A. Stovall', { x: M + 26, y, size: BODY, font: times, color: ink });
  y -= 28;
  para(['TENANT:'], { gapAfter: 10 });
  { // printed tenant name (field)
    const lh = BODY * 1.34; ensure(lh);
    drawFieldInline('tenant_name', M, y, times, BODY); y -= lh + 12;
  }
  sigLine(M, 'By:  ', M + 26, M + 300, y);
  y -= 14;
  { const lh = BODY * 1.34; ensure(lh); drawFieldInline('tenant_name', M + 26, y, times, BODY); y -= lh; }

  // ── Exhibit A (own page) ───────────────────────────────────────────────────
  newPage();
  spacer(10);
  centered('EXHIBIT “A”', TITLE, bold);
  spacer(10);
  para(['LEGAL DESCRIPTION:'], { font: bold });
  spacer(2);
  para(['Lot 8000, Fair Oaks Parkway at Fair Oaks Ranch, City of Fair Oaks Ranch, Bexar County, Texas, according to plat recorded in Volume 9561, Page 164, Deed and Plat Records, Bexar County, Texas. Building ', { f: 'building' }, ', Suite ', { f: 'suite' }, '.']);

  // ── save ──────────────────────────────────────────────────────────────────
  const bytes = await doc.save();
  const out = __dirname;
  fs.writeFileSync(out + '/8000_fair_oaks_building_lease.pdf', bytes);
  fs.writeFileSync(out + '/fields.json', JSON.stringify(fields, null, 2));

  const byKey = {};
  for (const f of fields) byKey[f.field_key] = (byKey[f.field_key] || 0) + 1;
  console.log('pages:', doc.getPageCount());
  console.log('total field boxes:', fields.length);
  console.log('distinct keys:', Object.keys(byKey).length);
  console.log('per key:', JSON.stringify(byKey));
})().catch(e => { console.error(e); process.exit(1); });
