import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCrmContext, isAdminRole, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Master contact list = crm_clients. This route powers contact pickers (e.g. the
// Add-Property "Listing Broker" field) so contacts are LINKED, never duplicated.
const CLIENT_COLS = 'id, first_name, last_name, business_name, brokerage, email, phone, cell_phone, type';

function scopedUnit(req: NextRequest, ctx: { role: string | null; businessUnit: string | null }): string {
  if (isAdminRole(ctx.role)) {
    return req.nextUrl.searchParams.get('business_unit') ?? ctx.businessUnit ?? 'commercial';
  }
  return ctx.businessUnit ?? 'commercial';
}

// GET /api/crm/contacts?q=&limit=  — search the master contact list, scoped to the
// caller's business unit. No q → the most-recently-touched contacts.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const limit = Math.min(50, Number(req.nextUrl.searchParams.get('limit') ?? 20) || 20);

  let query = adminClient().from('crm_clients').select(CLIENT_COLS).eq('business_unit', scopedUnit(req, ctx));
  if (q) {
    // Strip PostgREST filter metacharacters so the search term can't break the or() grammar.
    const like = `%${q.replace(/[%,()*]/g, ' ')}%`;
    query = query.or(
      `first_name.ilike.${like},last_name.ilike.${like},business_name.ilike.${like},brokerage.ilike.${like},email.ilike.${like},phone.ilike.${like},cell_phone.ilike.${like}`,
    );
  }
  const { data, error } = await query
    .order('last_touched_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return dbError('api/crm/contacts GET', error);
  return NextResponse.json({ contacts: data ?? [] });
}

// POST /api/crm/contacts — create a contact in the master list and return it, so a
// broker read off a flyer that isn't already a contact is added ONCE (no dupes).
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const first = str(body.first_name);
  const last = str(body.last_name);
  const business = str(body.business_name);
  if (!first && !last && !business) {
    return NextResponse.json({ error: 'A contact name or company is required.' }, { status: 400 });
  }

  const rec: Record<string, unknown> = {
    first_name: first,
    last_name: last,
    business_name: business,
    email: str(body.email),
    phone: str(body.phone),
    cell_phone: str(body.cell_phone),
    type: str(body.type) || 'Broker',
    business_unit: scopedUnit(req, ctx),
    agent_id: ctx.userId,
    assigned_agent_ids: [],
    lead_source: str(body.lead_source) || 'Property DB',
    unsubscribe_token: randomUUID(),
  };

  const { data, error } = await adminClient().from('crm_clients').insert(rec).select(CLIENT_COLS).single();
  if (error) return dbError('api/crm/contacts POST', error);
  return NextResponse.json({ contact: data }, { status: 201 });
}
