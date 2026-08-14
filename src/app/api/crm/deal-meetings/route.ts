import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Logged meetings on a deal, each with tagged attendee CONTACTS (crm_clients). Purely
// internal record-keeping — contacts are never notified. Access is gated by the parent
// deal (create/list/edit/delete) or, for the reverse lookup, by the contact.

interface MeetingRow {
  id: string; deal_id: string; agent_id: string | null; meeting_date: string;
  title: string | null; note: string | null; attendee_ids: string[]; created_at: string;
}

// Attach resolved attendee contacts (id → name) to each meeting, scoped to the caller's
// workspace so cross-unit contact names never leak.
async function withAttendees(rows: MeetingRow[], ctx: { role: string | null; businessUnit: string | null }) {
  const ids = Array.from(new Set(rows.flatMap(r => r.attendee_ids || [])));
  const nameById = new Map<string, { id: string; name: string }>();
  if (ids.length) {
    const supabase = adminClient();
    let q = supabase.from('crm_clients').select('id, first_name, last_name, business_name, type').in('id', ids);
    if (!isAdminRole(ctx.role)) q = q.eq('business_unit', ctx.businessUnit);
    const { data } = await q;
    for (const c of data ?? []) {
      const nm = (c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact');
      nameById.set(c.id, { id: c.id, name: nm });
    }
  }
  return rows.map(r => ({
    ...r,
    attendees: (r.attendee_ids || []).map(id => nameById.get(id) || { id, name: 'Unknown contact' }),
  }));
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const dealId = req.nextUrl.searchParams.get('deal_id');
  const clientId = req.nextUrl.searchParams.get('client_id');
  const supabase = adminClient();

  if (dealId) {
    if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
    const { data, error } = await supabase.from('crm_deal_meetings').select('*').eq('deal_id', dealId).order('meeting_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) { console.error('[deal-meetings] GET deal', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
    return NextResponse.json({ meetings: await withAttendees((data ?? []) as MeetingRow[], ctx) });
  }
  if (clientId) {
    // Reverse view: meetings this contact attended.
    if (!(await assertOwnsResource('crm_clients', clientId, ctx))) return notFound('Contact not found');
    let q = supabase.from('crm_deal_meetings').select('*, crm_deals(id, property, client)').contains('attendee_ids', [clientId]).order('meeting_date', { ascending: false });
    if (!isAdminRole(ctx.role)) q = q.eq('business_unit', ctx.businessUnit);
    const { data, error } = await q;
    if (error) { console.error('[deal-meetings] GET client', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
    const meetings = await withAttendees((data ?? []) as MeetingRow[], ctx);
    return NextResponse.json({ meetings: meetings.map((m, i) => ({ ...m, deal: (data as Array<{ crm_deals?: unknown }>)[i]?.crm_deals ?? null })) });
  }
  return NextResponse.json({ error: 'deal_id or client_id required' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const { deal_id, meeting_date, title, note, attendee_ids } = b;
  if (!deal_id) return NextResponse.json({ error: 'deal_id required' }, { status: 400 });
  const deal = await assertOwnsResource('crm_deals', deal_id, ctx);
  if (!deal) return notFound('Deal not found');
  const unit = isAdminRole(ctx.role) ? ((deal.business_unit as string) || ctx.businessUnit || 'commercial') : (ctx.businessUnit ?? 'commercial');
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_deal_meetings').insert({
    deal_id,
    agent_id: ctx.userId,
    business_unit: unit,
    meeting_date: meeting_date || new Date().toISOString().slice(0, 10),
    title: title || null,
    note: note || null,
    attendee_ids: Array.isArray(attendee_ids) ? attendee_ids.filter((x: unknown) => typeof x === 'string') : [],
  }).select('*').single();
  if (error) { console.error('[deal-meetings] POST', error); return NextResponse.json({ error: 'Could not log meeting' }, { status: 500 }); }
  const [withA] = await withAttendees([data as MeetingRow], ctx);
  return NextResponse.json({ meeting: withA });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const supabase = adminClient();
  const { data: existing } = await supabase.from('crm_deal_meetings').select('deal_id').eq('id', id).maybeSingle();
  if (!existing || !(await assertOwnsResource('crm_deals', existing.deal_id, ctx))) return notFound('Meeting not found');
  const patch: Record<string, unknown> = {};
  if (b.meeting_date !== undefined) patch.meeting_date = b.meeting_date;
  if (b.title !== undefined) patch.title = b.title || null;
  if (b.note !== undefined) patch.note = b.note || null;
  if (b.attendee_ids !== undefined) patch.attendee_ids = Array.isArray(b.attendee_ids) ? b.attendee_ids.filter((x: unknown) => typeof x === 'string') : [];
  const { data, error } = await supabase.from('crm_deal_meetings').update(patch).eq('id', id).select('*').single();
  if (error) { console.error('[deal-meetings] PATCH', error); return NextResponse.json({ error: 'Could not update' }, { status: 500 }); }
  const [withA] = await withAttendees([data as MeetingRow], ctx);
  return NextResponse.json({ meeting: withA });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = adminClient();
  const { data: existing } = await supabase.from('crm_deal_meetings').select('deal_id').eq('id', id).maybeSingle();
  if (!existing || !(await assertOwnsResource('crm_deals', existing.deal_id, ctx))) return notFound('Meeting not found');
  const { error } = await supabase.from('crm_deal_meetings').delete().eq('id', id);
  if (error) { console.error('[deal-meetings] DELETE', error); return NextResponse.json({ error: 'Could not delete' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
