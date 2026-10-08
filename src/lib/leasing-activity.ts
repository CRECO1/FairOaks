// Leasing Activity report — the owner/developer's weekly sheet (Headwall's template:
// Existing Vacancies · <year> Expiration · <year+1> Expiration · Passed Status) built
// live from the property's rent roll. Suite rows are the vacancies / expirations;
// "backup / prospective tenant" rows (is_backup) are the prospects working a suite.
// Pure — shared by the property-card tab and the .xlsx export.

export const LEASING_STATUSES = ['Prospect', 'Touring', 'Proposal Out', 'LOI Out', 'Lease Out', 'Signed', 'Passed'] as const;

export interface TenantRow {
  id: string; suite?: string | null; building?: string | null; tenant_name?: string | null; size_sf?: number | null;
  lease_expiration?: string | null; rent_psf?: number | null; monthly_rent?: number | null; notes?: string | null;
  is_backup?: boolean | null; renewal_status?: string | null; sort_order?: number | null;
  leasing_status?: string | null; tenant_use?: string | null; activity_date?: string | null; proposed_rent?: number | null;
  proposed_ti?: number | null; is_national?: boolean | null; renewal_type?: string | null; prev_rent_psf?: number | null;
}

/** One line of the report, in the template's column order. */
export interface ReportLine {
  kind: 'vacancy' | 'prospect' | 'expiring' | 'passed';
  rowId: string | null;              // the crm_property_tenants row this line edits (null = an empty vacancy line)
  suiteRowId: string | null;         // the suite it belongs to (for "add prospect")
  occupant: string; status: string; dba: string; use: string; suite: string; sf: number | null;
  date: string | null; proposedRent: number | null; proposedTi: number | null; national: boolean | null;
  expiration: string | null; renewalType: string; notes: string; prevRentPsf: number | null;
}
export interface ReportSection { title: string; tone: 'vacant' | 'expiring' | 'passed'; lines: ReportLine[] }

const isVacant = (r: TenantRow) => !r.tenant_name || /^vacant$/i.test(r.tenant_name.trim());
const normSuite = (s?: string | null) => String(s ?? '').trim().toLowerCase();
const suiteOrder = (a: TenantRow, b: TenantRow) =>
  (a.sort_order ?? 9e9) - (b.sort_order ?? 9e9) ||
  (parseInt(String(a.suite), 10) || 0) - (parseInt(String(b.suite), 10) || 0) || String(a.suite ?? '').localeCompare(String(b.suite ?? ''));

function prospectLine(p: TenantRow, suite: TenantRow | null): ReportLine {
  return {
    kind: p.leasing_status === 'Passed' ? 'passed' : 'prospect', rowId: p.id, suiteRowId: suite?.id ?? null,
    occupant: suite ? 'VACANT' : '', status: p.leasing_status ?? 'Prospect', dba: p.tenant_name ?? '', use: p.tenant_use ?? '',
    suite: p.suite ?? suite?.suite ?? '', sf: p.size_sf ?? suite?.size_sf ?? null, date: p.activity_date ?? null,
    proposedRent: p.proposed_rent ?? null, proposedTi: p.proposed_ti ?? null, national: p.is_national ?? null,
    expiration: null, renewalType: '', notes: p.notes ?? '', prevRentPsf: null,
  };
}

export function buildLeasingActivity(rows: TenantRow[], today = new Date()): ReportSection[] {
  const suites = rows.filter(r => !r.is_backup).sort(suiteOrder);
  const prospects = rows.filter(r => r.is_backup);
  const vacant = suites.filter(isVacant);
  const year = today.getFullYear();

  // Vacancies, each followed by the prospects working it (most advanced first).
  const rank = (s?: string | null) => { const i = LEASING_STATUSES.indexOf((s ?? 'Prospect') as typeof LEASING_STATUSES[number]); return i < 0 ? 0 : i; };
  const active = prospects.filter(p => p.leasing_status !== 'Passed');
  const vacancyLines: ReportLine[] = [];
  const placed = new Set<string>();
  for (const v of vacant) {
    const mine = active.filter(p => normSuite(p.suite) && normSuite(p.suite) === normSuite(v.suite))
      .sort((a, b) => rank(b.leasing_status) - rank(a.leasing_status) || String(b.activity_date ?? '').localeCompare(String(a.activity_date ?? '')));
    if (!mine.length) {
      vacancyLines.push({ kind: 'vacancy', rowId: v.id, suiteRowId: v.id, occupant: 'VACANT', status: '', dba: '', use: '', suite: v.suite ?? '',
        sf: v.size_sf ?? null, date: null, proposedRent: null, proposedTi: null, national: null, expiration: null, renewalType: '', notes: v.notes ?? '', prevRentPsf: null });
    }
    for (const p of mine) { vacancyLines.push(prospectLine(p, v)); placed.add(p.id); }
  }
  // Prospects not tied to a vacant suite yet (space TBD) still belong on the report.
  for (const p of active) if (!placed.has(p.id)) vacancyLines.push({ ...prospectLine(p, null), occupant: 'VACANT — suite TBD' });

  const expiring = (y: number): ReportLine[] => suites
    .filter(r => !isVacant(r) && r.lease_expiration && new Date(r.lease_expiration + 'T00:00:00').getFullYear() === y)
    .sort((a, b) => String(a.lease_expiration).localeCompare(String(b.lease_expiration)))
    .map(r => ({ kind: 'expiring' as const, rowId: r.id, suiteRowId: r.id, occupant: r.tenant_name ?? '', status: r.renewal_status ?? '', dba: r.tenant_name ?? '',
      use: r.tenant_use ?? '', suite: r.suite ?? '', sf: r.size_sf ?? null, date: r.activity_date ?? null, proposedRent: r.proposed_rent ?? null,
      proposedTi: r.proposed_ti ?? null, national: r.is_national ?? null, expiration: r.lease_expiration ?? null, renewalType: r.renewal_type ?? '',
      notes: r.notes ?? '', prevRentPsf: r.prev_rent_psf ?? r.rent_psf ?? null }));

  return [
    { title: 'Existing Vacancies', tone: 'vacant', lines: vacancyLines },
    { title: `${year} Expiration`, tone: 'expiring', lines: expiring(year) },
    { title: `${year + 1} Expiration`, tone: 'expiring', lines: expiring(year + 1) },
    { title: 'Passed Status', tone: 'passed', lines: prospects.filter(p => p.leasing_status === 'Passed').map(p => prospectLine(p, suites.find(s => normSuite(s.suite) === normSuite(p.suite)) ?? null)) },
  ];
}

export const REPORT_COLUMNS = ['Current Occupant', 'Status', 'Tenant DBA', 'Use', 'Suite', 'SF', 'Date', 'Proposed Rent', 'Proposed TI',
  'National (Y/N)', 'Expiration Date', 'Renewal Type', 'Notes', 'Prev. Rent PSF'] as const;
