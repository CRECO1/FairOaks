import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { normalizeAddress } from '@/lib/broker-ingest/upsert';

// Read-side for the broker-ingested Property DB (crm_prospective_properties).
// The write-side is src/lib/broker-ingest/* (the 4x/day Gmail → CRM pipeline).
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const unit = isAdminRole(ctx.role) ? (req.nextUrl.searchParams.get('business_unit') ?? ctx.businessUnit ?? 'commercial') : (ctx.businessUnit ?? 'commercial');
  const supabase = adminClient();
  // PostgREST caps a single response at 1000 rows, so page through until the
  // whole table is fetched — the Property DB is well past 1000 listings now.
  const PAGE = 1000;
  const all: unknown[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await supabase
      .from('crm_prospective_properties')
      .select('*')
      .eq('business_unit', unit)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[api/property-db] db error:', error);
      return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return NextResponse.json({ properties: all });
}

// Columns an agent may set from the Add-Property form. Everything else
// (ids, timestamps, source, geocode, ownership) is server-controlled below.
const WRITABLE_TEXT = [
  'name', 'address', 'suite', 'city', 'state', 'zip', 'asset_type', 'property_subtype',
  'building_class', 'listing_type', 'vacancy_status', 'transaction_status', 'asking_rate',
  'lease_type', 'zoning', 'listing_company', 'listing_agent_name', 'listing_agent_phone', 'contact_id',
  'submarket', 'county', 'owner_name', 'owner_phone', 'highlights', 'description', 'notes',
  'brochure_url', 'flyer_url', 'listing_url', 'floorplan_url', 'virtual_tour_url',
] as const;
const WRITABLE_NUM = [
  'size_sf', 'available_sf', 'sale_price', 'price_per_sf', 'cap_rate', 'year_built',
  'clear_height_ft', 'dock_doors', 'grade_doors', 'parking_spaces',
] as const;

// Write-side: create a Property DB record from the agent-facing Add-Property form.
// Any authenticated CRM user (agent tier included) may add to their own workspace.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const rec: Record<string, unknown> = {};
  for (const k of WRITABLE_TEXT) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) rec[k] = v.trim();
  }
  for (const k of WRITABLE_NUM) {
    const raw = body[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(String(raw).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n)) rec[k] = n;
  }

  const displayName = (rec.name as string | undefined) ?? (rec.address as string | undefined) ?? null;
  if (!displayName) {
    return NextResponse.json({ error: 'A property name or address is required.' }, { status: 400 });
  }
  rec.name = displayName;

  // Admins may target any unit; agents are pinned to their own workspace.
  rec.business_unit = isAdminRole(ctx.role)
    ? ((typeof body.business_unit === 'string' && body.business_unit) || ctx.businessUnit || 'commercial')
    : (ctx.businessUnit || 'commercial');
  rec.created_by = ctx.userId;
  rec.source = 'agent_manual';
  if (!rec.vacancy_status) rec.vacancy_status = 'vacant';
  if (!rec.transaction_status) rec.transaction_status = 'Available';
  rec.last_status_at = new Date().toISOString();
  rec.address_key =
    normalizeAddress((rec.address as string | undefined) ?? null) ||
    normalizeAddress(displayName) ||
    null;

  const { data, error } = await adminClient()
    .from('crm_prospective_properties')
    .insert(rec)
    .select('*')
    .single();
  if (error) return dbError('api/property-db POST', error);

  return NextResponse.json({ property: data }, { status: 201 });
}
