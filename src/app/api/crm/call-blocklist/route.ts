import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { addBlock, belongsToContact, blockKey, isOurNumber } from '@/lib/call-blocklist';

// The call block list (supabase/20261022_call_blocklist.sql): numbers the inbound voice flow turns away.
// Admins and agents manage it; an agent is confined to their own workspace plus the all-lines rows.

const STAFF = ['agent', 'admin', 'super_admin'];
const UNITS = ['all', 'commercial', 'residential'];

// Who may change which rows:
//  - admins: any line, including the all-lines rows;
//  - agents: only rows for THEIR OWN line. An 'all lines' block (and the other brokerage's rows) is admin-only, so one
//    agent can't silence a number across the whole company or undo a colleague's block on the other line.
function mayTouch(ctx: { role: string | null; businessUnit: string | null }, unit: string): boolean {
  return isAdminRole(ctx.role) || unit === ctx.businessUnit;
}

// GET /api/crm/call-blocklist → { blocked: [...] }
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx || !STAFF.includes(ctx.role ?? '')) return unauthorized();
  const db = adminClient();
  let q = db.from('crm_blocked_numbers').select('*').order('created_at', { ascending: false }).limit(1000);
  if (!isAdminRole(ctx.role)) q = q.in('business_unit', ['all', ctx.businessUnit ?? 'commercial']);
  const { data, error } = await q;
  if (error) return dbError('api/crm/call-blocklist GET', error);
  return NextResponse.json({ blocked: data ?? [] });
}

// POST { number, business_unit?, reason? }  or  { call_id, reason? } (block the number on that call)
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx || !STAFF.includes(ctx.role ?? '')) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  let number = typeof b.number === 'string' ? b.number : '';
  // Agents always block on their own line; only admins may choose 'all' or the other line.
  let unit = isAdminRole(ctx.role) ? (typeof b.business_unit === 'string' && UNITS.includes(b.business_unit) ? b.business_unit : 'all') : (ctx.businessUnit ?? 'commercial');
  let callId: string | null = null;

  if (b.call_id) {
    const { data: call } = await db.from('crm_call_log').select('id, business_unit, direction, from_number, to_number, contact_id').eq('id', b.call_id).maybeSingle();
    if (!call || !mayTouch(ctx, call.business_unit as string)) return notFound('Call not found');
    if (call.contact_id) return NextResponse.json({ error: 'That caller is a saved contact — remove or edit the contact instead of blocking them.' }, { status: 409 });
    number = (call.direction === 'outbound' ? call.to_number : call.from_number) as string;
    unit = call.business_unit as string; // a block from a call row is for that line
    callId = call.id as string;
  }
  if (!blockKey(number)) return NextResponse.json({ error: 'Enter a valid phone number (10 digits, or + and the country code).' }, { status: 400 });
  if (!mayTouch(ctx, unit)) return NextResponse.json({ error: 'Not your workspace' }, { status: 403 });
  if (await isOurNumber(db, number)) return NextResponse.json({ error: 'That is one of our own or a team number — blocking it would cut us off.' }, { status: 409 });
  // Never block a saved contact's number — on ANY path (the call_id path above already refuses a call linked to a
  // contact, but a typed-in number could still be a client's cell). If the lookup itself fails, refuse rather than guess.
  try {
    if (await belongsToContact(db, blockKey(number)!)) return NextResponse.json({ error: 'That number belongs to a saved contact — remove or edit the contact instead of blocking them.' }, { status: 409 });
  } catch (e) {
    console.error('[call-blocklist] contact check failed', e);
    return NextResponse.json({ error: 'Could not verify the number is not a saved contact. Try again.' }, { status: 503 });
  }

  const r = await addBlock(db, { number, unit, reason: typeof b.reason === 'string' ? b.reason : null, source: 'manual', createdBy: ctx.userId, callId });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 });   // generic text only (addBlock logs the detail)
  return NextResponse.json({ blocked: r.row, created: r.created });
}

// DELETE /api/crm/call-blocklist?id=<row id>   or   ?number=<number>&business_unit=
export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx || !STAFF.includes(ctx.role ?? '')) return unauthorized();
  const db = adminClient();
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  const key = blockKey(sp.get('number'));
  if (!id && !key) return NextResponse.json({ error: 'id or number required' }, { status: 400 });
  let q = db.from('crm_blocked_numbers').select('id, business_unit');
  q = id ? q.eq('id', id) : q.eq('phone_key', key!);
  const { data: rows, error } = await q;
  if (error) return dbError('api/crm/call-blocklist DELETE', error);
  const mine = (rows ?? []).filter(r => mayTouch(ctx, r.business_unit as string));
  if (!mine.length) return notFound('Not on the block list');
  const { error: delErr } = await db.from('crm_blocked_numbers').delete().in('id', mine.map(r => r.id as string));
  if (delErr) return dbError('api/crm/call-blocklist DELETE', delErr);
  return NextResponse.json({ ok: true, removed: mine.length });
}
