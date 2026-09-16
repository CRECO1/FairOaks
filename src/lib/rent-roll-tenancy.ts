// Which lease on a suite is in effect on a given day.
//
// The rent roll is one row per tenancy, and a suite can carry two: the tenant in
// place and the one who has signed to take it next. Entering the incoming lease
// early is the whole point — it's signed, it should be on the roll — but on the
// day it's entered it isn't income yet, and the day it starts the outgoing row
// stops being income. This works that out from the dates, so the handover happens
// on its own on the start date instead of someone remembering to edit two rows.
//
//   upcoming  — lease_start is after asOf. Listed, not counted.
//   replaced  — a later-starting lease on the same suite has begun. Listed, not
//               counted; the outgoing tenant's own dates are left untouched.
//   current   — everything else.
//
// Shared by the rent roll UI, the floor-plan handover and CAM billing so the three
// can never disagree about who occupies a suite.

export type Tenancy = 'current' | 'upcoming' | 'replaced';

export interface TenancyRow {
  suite?: string | null;
  tenant_name?: string | null;
  lease_start?: string | null;
}

export interface TenancyStatus<T> { status: Tenancy; successor?: T }

const vacant = (r: TenancyRow) => !r.tenant_name || /^vacant$/i.test(r.tenant_name.trim());

/** Today as YYYY-MM-DD in the office's timezone — a UTC date flips a day early each evening. */
export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

/** One status per row, aligned by index. */
export function tenancies<T extends TenancyRow>(rows: T[], asOf: string = todayISO()): TenancyStatus<T>[] {
  const day = (d?: string | null) => (d ? String(d).slice(0, 10) : '');
  return rows.map((r, i) => {
    const start = day(r.lease_start);
    if (start && start > asOf) return { status: 'upcoming' };
    const suite = String(r.suite ?? '').trim();
    if (!suite) return { status: 'current' };
    let successor: T | undefined;
    let successorStart = '';
    rows.forEach((o, j) => {
      if (j === i || vacant(o) || String(o.suite ?? '').trim() !== suite) return;
      const s = day(o.lease_start);
      // Began on or before asOf, and after this row's own start (a row with no start
      // date is taken as the older tenancy).
      if (!s || s > asOf || (start && s <= start)) return;
      if (s > successorStart) { successor = o; successorStart = s; }
    });
    return successor ? { status: 'replaced', successor } : { status: 'current' };
  });
}

/** Rows in effect on asOf — what counts toward income, occupancy and billing. */
export function inEffect<T extends TenancyRow>(rows: T[], asOf: string = todayISO()): T[] {
  const st = tenancies(rows, asOf);
  return rows.filter((_, i) => st[i].status === 'current');
}

/** "Nov 1, 2026" from a YYYY-MM-DD, without the UTC shift new Date(iso) causes. */
export function shortDate(iso?: string | null): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
