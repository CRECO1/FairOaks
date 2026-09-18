import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmAdmin, isAdminRole, unauthorized, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { tenancies } from '@/lib/rent-roll-tenancy';

const VALID_UNITS = ['residential', 'commercial'] as const;
type BusinessUnit = typeof VALID_UNITS[number];
function toUnit(val: string | null, fallback: BusinessUnit = 'commercial'): BusinessUnit {
  return VALID_UNITS.includes(val as BusinessUnit) ? (val as BusinessUnit) : fallback;
}

const VALID_STATUS = ['occupied', 'vacant', 'reserved'] as const;
type SuiteStatus = typeof VALID_STATUS[number];
function toStatus(val: unknown): SuiteStatus {
  return VALID_STATUS.includes(val as SuiteStatus) ? (val as SuiteStatus) : 'occupied';
}

// GET /api/crm/suites?unit=commercial&building=bldg1
// Returns the saved per-suite overrides. Any authenticated CRM user may read.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const unit = isAdminRole(ctx.role) ? toUnit(req.nextUrl.searchParams.get('unit')) : toUnit(ctx.businessUnit);
  const building = req.nextUrl.searchParams.get('building') || 'bldg1';
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('office_suites')
    .select('*')
    .eq('business_unit', unit)
    .eq('building', building);
  if (error) {
    console.error('[api/crm/suites] db error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
  const suites = data ?? [];
  await applyHandovers(supabase, unit, suites);
  return NextResponse.json({ suites });
}

// Lease handovers on the floor plan. A signed lease entered on the rent roll ahead of
// its start date deliberately doesn't relabel the room (see rent-roll isInEffect), so
// on the start date something has to. Doing it here, when the plan is read, means the
// room flips on the day with no cron and no one remembering.
//
// Deliberately narrow: only a suite that has a replaced tenancy AND still shows that
// outgoing tenant's name. Floor-plan names otherwise differ from the roll on purpose
// (working names, typo-tolerant reconciliation), and those must never be overwritten.
async function applyHandovers(db: ReturnType<typeof adminClient>, unit: string, suites: Array<Record<string, unknown>>) {
  const numbers = Array.from(new Set(suites.map(s => String(s.suite_number ?? '').trim()).filter(Boolean)));
  if (!numbers.length) return;
  try {
    const { data: roll } = await db.from('crm_property_tenants')
      .select('suite, tenant_name, lease_start, lease_expiration, size_sf').eq('business_unit', unit).in('suite', numbers);
    const rows = roll ?? [];
    const st = tenancies(rows);
    for (let i = 0; i < rows.length; i++) {
      const next = st[i].successor;
      if (st[i].status !== 'replaced' || !next) continue;
      const outgoing = String(rows[i].tenant_name ?? '').trim().toLowerCase();
      for (const s of suites) {
        if (String(s.suite_number ?? '').trim() !== String(rows[i].suite ?? '').trim()) continue;
        if (String(s.tenant_name ?? '').trim().toLowerCase() !== outgoing) continue;
        const patch = {
          tenant_name: next.tenant_name, status: 'occupied',
          lease_expiration: (next as { lease_expiration?: string | null }).lease_expiration ?? null,
          updated_at: new Date().toISOString(),
        };
        await db.from('office_suites').update(patch).eq('id', s.id as string);
        Object.assign(s, patch);
      }
    }
  } catch (e) { console.error('[api/crm/suites] handover', e); }
}

// PUT /api/crm/suites
// Upserts one suite's editable fields. Admin-only (mirrors Billing access).
export async function PUT(req: NextRequest) {
  const caller = await getCrmAdmin(req);
  if (!caller) return forbidden();

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const {
    building = 'bldg1',
    business_unit,
    floor,
    suite_key,
    suite_number,
    tenant_name,
    status,
    color,
    sq_ft,
    lease_expiration,
    notes,
  } = body ?? {};

  if (floor == null || !suite_key) {
    return NextResponse.json({ error: 'floor and suite_key are required' }, { status: 400 });
  }

  const supabase = adminClient();

  // Carry the caller's org for defense-in-depth RLS. crm_profiles may or may
  // not have an org_id column depending on whether multitenancy is applied;
  // if the select errors we simply leave org_id null.
  let orgId: string | null = null;
  try {
    const { data: prof } = await supabase
      .from('crm_profiles')
      .select('org_id')
      .eq('id', caller.id)
      .single();
    orgId = (prof as { org_id?: string | null } | null)?.org_id ?? null;
  } catch {
    orgId = null;
  }

  const row = {
    org_id: orgId,
    business_unit: toUnit(business_unit ?? null),
    building: String(building),
    floor: Number(floor),
    suite_key: String(suite_key),
    suite_number: suite_number ?? null,
    tenant_name: tenant_name ?? null,
    status: toStatus(status),
    color: color ?? null,
    sq_ft: sq_ft === '' || sq_ft == null ? null : Number(sq_ft),
    lease_expiration: lease_expiration === '' || lease_expiration == null ? null : lease_expiration,
    notes: notes ?? null,
    updated_by: caller.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('office_suites')
    .upsert(row, { onConflict: 'business_unit,building,floor,suite_key' })
    .select()
    .single();

  if (error) {
    console.error('[api/crm/suites] db error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
  return NextResponse.json({ suite: data });
}
