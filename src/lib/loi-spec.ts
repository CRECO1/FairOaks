// LOI / lease-LOI builder SPECS: types, standard term lists and the form-code → spec mapping.
// Split out of loi-doc.ts so the CRM shell can import the specs without pulling pdf-lib
// (~180 KB gzipped) into its critical path. The PDF renderer stays in loi-doc.ts.

export interface LoiTermRow { label: string; value: string; id?: string }
export interface LoiSeller { entity: string; signatory: string }
/** A PDF or image attached INTO a letter as a labelled exhibit (Exhibit A, B, …): a cover sheet, then the file's pages. */
export interface LoiExhibit { id: string; title: string; name: string; /** storage path in the listing-files bucket */ path: string; kind: 'pdf' | 'image'; /** false = merge the file's pages straight in, with no 'EXHIBIT A' cover sheet (default: a cover sheet) */ cover?: boolean }
export const exhibitLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

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
  /** Tenant-rep letters: the "Dear Sir or Madam," opening paragraph ('' / absent = omit). */
  intro?: string;
  /** Line centred under the title (the building address on a tenant-rep letter). */
  subtitle?: string;
  /** Which spec variant this doc was built with, so it re-opens (and re-renders) in
   *  the same layout regardless of which form row it is filed under. */
  variant?: LeaseAsset;
  /** Files stapled onto the end of the letter. Their pages are added after the acceptance block (and after any spec exhibit). */
  exhibits?: LoiExhibit[];
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
  /** Who the letter is addressed to and who countersigns it. Default 'landlord'
   *  (we write to the owner on a tenant's behalf). A landlord-side letter — e.g. the
   *  Elkhorn Point LOI, sent FROM the landlord's broker TO a prospective tenant —
   *  addresses and is accepted by the tenant. */
  addressee?: 'landlord' | 'tenant';
  /** Optional exhibit page appended after the acceptance block (image under /public). */
  exhibit?: { title: string; imagePath: string };
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

export type LeaseAsset = 'office' | 'industrial' | 'generic' | 'shortterm' | 'elkhorn' | 'tenantrep';

// Elkhorn Point (8923 Dietz Elkhorn Rd, Fair Oaks Ranch) — the developer's (Headwall)
// standard retail landlord LOI, adapted 2026-10-12: CRECO is the landlord's broker,
// the landlord entity stays a blank until Headwall confirms it, and delivery is
// shell + work letter because the buildings are ground-up build-to-suit. Written
// FROM the landlord side TO a prospective tenant, so the tenant countersigns.
const ELKHORN_TERMS: LoiTermRow[] = [
  { label: 'Landlord:', value: '________ ("Landlord")' },
  { label: 'Tenant:', value: '________, doing business as ________ ("Tenant")' },
  { label: 'Guaranty:', value: 'Personal guarantee for the full term of the Lease.' },
  { label: 'Leased Premises:', value: 'Approximately ________ rentable square feet, Suite ________, at Elkhorn Point, 8923 Dietz Elkhorn Rd, Fair Oaks Ranch, Texas 78015, as reflected on the preliminary site plan attached hereto as "Exhibit A - Site Plan".' },
  { label: 'Permitted Use:', value: 'Tenant shall open for business and operate continuously in the Leased Premises throughout the Term for the operation of ________, and for no other purpose.' },
  { label: 'Term:', value: 'Five (5) years.' },
  { label: 'Base Rent:', value: 'Year 1: $________ per rentable square foot per year, with three percent (3%) annual increases. Rent shall be paid by ACH unless otherwise designated by Landlord.' },
  { label: 'Percentage Rent:', value: 'Tenant shall pay to Landlord additional rent equal to ____ percent (____%) of a Natural Breakpoint. For the purposes herein, Natural Breakpoint shall be calculated as the annual Minimum Base Rent divided by the stated Percentage Rent.' },
  { label: 'Insurance, Taxes, Management, Association:', value: "The Lease shall be triple net to Tenant. Tenant shall pay its pro-rata share of Taxes, Insurance, General and Common Area Expenses assessed on the Leased Premises calculated based on the enclosed square footage of Tenant's Premises as compared to the enclosed square footage of all other leasable spaces in the property, including separately owned pad sites that are not self-maintaining. Current NNN estimates (subject to change): $________ per rentable square foot per year." },
  { label: 'Prepaid Rental:', value: "First month's Base Rent plus NNN; paid upon execution of the Lease." },
  { label: 'Security Deposit:', value: "Last month's Base Rent plus NNN; paid upon execution of the Lease." },
  { label: 'Delivery Date:', value: 'Within ________ business days of execution of the Lease.' },
  { label: 'Rent Commencement:', value: "Tenant shall commence paying Base Rent plus NNN the earlier of: (i) ________ days from the Delivery Date, or (ii) upon Tenant's opening for business." },
  { label: 'Utilities:', value: 'Tenant shall be responsible for all utility charges for the Leased Premises.' },
  { label: 'Maintenance:', value: 'Tenant shall maintain and repair the Leased Premises, which shall include, but not limited to, the mechanical, HVAC, electrical and plumbing systems from the point of connection to the Leased Premises. Tenant shall maintain all exterior lighting, landscaping, and signage. Landlord shall be responsible for maintenance of the roof, exterior walls, and the structural integrity of the Building.' },
  { label: 'Delivery Condition:', value: "Landlord shall deliver the Leased Premises in shell condition, with Landlord's Work as described in the Work Letter to be attached to the Lease as Exhibit B." },
  { label: "Tenant's Work:", value: "Tenant shall build out the interior of the Leased Premises according to plans and specs approved by Landlord and all applicable governmental authorities and according to all applicable governmental codes and requirements that are necessary for Tenant to open and operate the Leased Premises for the Permitted Use. Tenant shall diligently pursue all governmental permits and approvals for its improvements. All interior and exterior signage, alterations, plans, and specifications shall be subject to Landlord's reasonable approval." },
  { label: 'Tenant Improvement Allowance:', value: "Subject to Landlord's review and approval of Tenant/Guarantor financials, Tenant shall be reimbursed up to $________ per usable square foot (for any approved hard costs associated with interior non-structural permanent improvements, excluding FF&E or the off-set against rent) following Landlord's receipt of Tenant's lien waivers, receipts for all work completed, the passage of all lien filing deadlines under applicable law, Tenant's receipt of final certificate of occupancy, opening of Premises for business, and commencement and payment of rent, all as more specifically described in the Lease Agreement." },
  { label: 'Signage:', value: "Subject to Landlord's and applicable governmental authorities' prior review and approval and municipal code, at Tenant's sole cost and expense, Tenant shall install a sign on the front elevation of the Leased Premises. All signs shall comply with applicable City/County ordinances and Landlord's standard sign criteria for the Building, at Tenant's sole cost and expense. Subject to availability, Tenant shall be entitled to one (1) double-sided panel on the shopping center pylon in a location acceptable to Landlord for a fee of $125/month." },
  { label: 'Radius Restriction:', value: 'Three (3) miles from the Leased Premises.' },
  { label: 'Initial Lease Draft:', value: 'Landlord will draft the initial form of Lease Agreement.' },
  { label: 'Disclosure:', value: "Tenant acknowledges that CRECO LLC (\"CRECO\") will be representing the Landlord in this proposed lease transaction (\"Landlord's Broker\"). Tenant will be represented by ________ (\"Tenant's Broker\"). Tenant's Broker will be paid pursuant to separate written agreement between Landlord and Tenant's Broker." },
  { label: 'Confidentiality:', value: "Landlord and Tenant each agree to keep the terms and conditions of this LOI and any lease negotiations strictly confidential unless mutually agreed to otherwise; provided, however, that the foregoing shall not apply to disclosures which may be required by applicable law, to third party consultants on an \"as needed\" basis (provided such consultants otherwise comply with the confidentiality requirements hereof) or made by Landlord in connection with its financing of the Building." },
];
// The developer's non-binding paragraph, verbatim (it is their form).
const ELKHORN_BOILERPLATE = [
  "THIS LOI IS INTENDED SOLELY AS A PRELIMINARY EXPRESSION OF GENERAL INTENTIONS AND IS TO BE USED FOR DISCUSSION PURPOSES ONLY. THE PARTIES INTEND THAT NEITHER SHALL HAVE ANY CONTRACTUAL OBLIGATIONS TO THE OTHER WITH RESPECT TO THE MATTERS REFERRED HEREIN UNLESS AND UNTIL A DEFINITIVE LEASE AGREEMENT HAS BEEN FULLY EXECUTED AND DELIVERED BY THE PARTIES. THE PARTIES AGREE THAT THIS LOI IS NOT INTENDED TO CREATE ANY AGREEMENT OR OBLIGATION BY EITHER PARTY TO NEGOTIATE A DEFINITIVE LEASE AGREEMENT AND IMPOSES NO DUTY WHATSOEVER ON EITHER PARTY TO CONTINUE NEGOTIATIONS, INCLUDING WITHOUT LIMITATION ANY OBLIGATION TO NEGOTIATE IN GOOD FAITH OR IN ANY WAY OTHER THAN AT ARM'S LENGTH. PRIOR TO DELIVERY OF A DEFINITIVE EXECUTED LEASE AGREEMENT, AND WITHOUT ANY LIABILITY TO THE OTHER PARTY, EITHER PARTY MAY (1) PROPOSE DIFFERENT TERMS FROM THOSE SUMMARIZED HEREIN, (2) ENTER INTO NEGOTIATIONS WITH OTHER PARTIES AND/OR (3) UNILATERALLY TERMINATE ALL NEGOTIATIONS WITH THE OTHER PARTY HERETO.",
];

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

// Tenant-representation letter: CRECO writes to the landlord/listing broker ON BEHALF of
// its tenant client. Same two-column label : value layout, with the opening paragraph and
// the building address under the title. Blanks (________) are the values an agent fills.
const TENANTREP_TERMS: LoiTermRow[] = [
  { label: 'Tenant:', value: '________, or its affiliate/assignee.' },
  { label: 'Premises:', value: 'Approximately ________ rentable square feet ("RSF"), subject to final measurement and plans.' },
  { label: 'Permitted Use:', value: '________' },
  { label: 'Lease Type:', value: '________' },
  { label: 'Lease Term:', value: '________' },
  { label: 'Lease Commencement:', value: '________' },
  { label: 'Rent Commencement:', value: '________' },
  { label: 'Base Rental Rate:', value: '________ per RSF per month, with ____% annual escalations.' },
  { label: "First Month's Rent:", value: 'Due upon Lease execution (________).' },
  { label: 'Security Deposit:', value: 'Due upon Lease execution, equal to ________.' },
  { label: 'Operating Expenses:', value: '________' },
  { label: 'Tenant Improvement Allowance:', value: '________' },
  { label: 'HVAC:', value: 'Landlord will turn over all HVAC in good working order. Tenant agrees to maintain and pay for a quarterly service contract and provide receipts to Landlord upon request. If any HVAC unit requires replacement during the Term, Landlord accepts full replacement responsibility and expense.' },
  { label: 'Renewal Option:', value: '________' },
  { label: 'Compliance With Laws:', value: 'Upon commencement, the Building and Premises shall, at Landlord\u2019s sole cost and expense, comply with all applicable laws, ordinances, and regulations then in existence, including but not limited to the Americans with Disabilities Act and the National Electrical Code.' },
  { label: 'Signage:', value: 'Tenant shall have the right to install its name/logo on the Building\u2019s monument and/or facade signage at no cost throughout the Lease Term, subject to municipal code.' },
  { label: 'Broker:', value: 'Landlord shall pay Tenant\u2019s designated Broker, Commercial Real Estate Brokerage, LLC ("CRECO"), a fee equal to ________ of the gross aggregate value of the Lease, pursuant to a separate agreement between Landlord and Broker.' },
];
export const TENANTREP_INTRO = 'On behalf of our client, ________ ("Tenant"), we are pleased to submit this Letter of Intent ("LOI") to lease space in the building known as ________ (the "Building") on the following terms:';

export function leaseTerms(asset: LeaseAsset): LoiTermRow[] {
  if (asset === 'tenantrep') return TENANTREP_TERMS;
  if (asset === 'shortterm') return SHORTTERM_TERMS;   // its own structure, not common + flavour
  if (asset === 'elkhorn') return ELKHORN_TERMS;
  const flavour = asset === 'industrial' ? INDUSTRIAL_ROWS : asset === 'office' ? OFFICE_ROWS : [];
  return [...LEASE_TERMS_COMMON, ...flavour, ...LEASE_TERMS_TAIL];
}

export function leaseSpec(asset: LeaseAsset = 'generic'): LoiSpec {
  if (asset === 'tenantrep') {
    return {
      kind: 'lease',
      title: 'LETTER OF INTENT TO LEASE',
      partyHeading: '',            // the acceptance blocks carry their own party names
      partyNoun: 'Party',
      boilerplate: [
        'This Letter of Intent is merely a guide to the preparation of a mutually satisfactory lease agreement, and nothing herein shall preclude any other provision from being inserted at the request of either party.',
        'This Letter of Intent is non-binding on either party until an actual lease agreement is drafted, agreed upon, and executed by both parties.',
        'Should the foregoing be acceptable, please indicate your acceptance by executing this Letter of Intent in the space provided below.',
      ],
      defaultTerms: TENANTREP_TERMS,
      overlayKeys: {}, overlayFill: 'blanks', overlayMeta: {},
    };
  }
  if (asset === 'elkhorn') {
    return {
      kind: 'lease',
      title: 'Letter of Intent to Lease',
      partyHeading: 'Tenant:',
      partyNoun: 'Tenant',
      boilerplate: ELKHORN_BOILERPLATE,
      defaultTerms: ELKHORN_TERMS,
      addressee: 'tenant',
      exhibit: { title: 'EXHIBIT A - SITE PLAN', imagePath: '/loi/elkhorn-point-site-plan.jpg' },
      overlayKeys: {},
      overlayFill: 'blanks',
      overlayMeta: {},
    };
  }
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
  if (n.includes('elkhorn')) return 'elkhorn';
  if (n.includes('tenant rep')) return 'tenantrep';
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

