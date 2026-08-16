import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmAdmin, isAdminRole, unauthorized, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

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
  return NextResponse.json({ suites: data ?? [] });
}

// PUT /api/crm/suites
// Upserts one suite's editable fields. Admin-only (mirrors Billing access).
export async function PUT(req: NextRequest) {
  const caller = await getCrmAdmin(req);
  if (!caller) return forbidden();

  const body = await req.json();
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
