import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

/**
 * Property DB shortlist — each agent's own starred properties (crm_property_shortlist).
 *
 *   GET   -> { ids: string[] }          the caller's starred property ids
 *   POST  { property_ids: string[], on: boolean }   star (on) or unstar (off) one or many
 *
 * Strictly personal: every read and write is scoped to the signed-in user's id; nothing here can
 * touch another agent's list. Stars may only be set on properties in the caller's own workspace.
 *
 * If the table has not been created yet (supabase/property-shortlist-2026-10.sql not applied) the GET
 * answers { setup_needed: true } instead of an error, and the page falls back to a list kept on this
 * device until the table exists.
 */
const UUID = /^[0-9a-f-]{36}$/i;
const MISSING_TABLE = '42P01';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const db = adminClient();
  const { data, error } = await db.from('crm_property_shortlist').select('property_id').eq('user_id', ctx.userId).limit(5000);
  if (error) {
    if ((error as { code?: string }).code === MISSING_TABLE || /does not exist|schema cache/i.test(error.message || '')) {
      return NextResponse.json({ ids: [], setup_needed: true });
    }
    return dbError('api/crm/property-shortlist GET', error);
  }
  return NextResponse.json({ ids: (data || []).map(r => r.property_id as string) });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => null) as { property_ids?: unknown; on?: unknown } | null;
  const ids = Array.isArray(body?.property_ids) ? [...new Set(body!.property_ids.map(String))].filter(i => UUID.test(i)).slice(0, 200) : [];
  if (!ids.length || typeof body?.on !== 'boolean') return NextResponse.json({ error: 'property_ids and on required' }, { status: 400 });

  const db = adminClient();
  if (body.on) {
    // Only properties in the caller's workspace can be starred.
    let q = db.from('crm_prospective_properties').select('id').in('id', ids);
    if (ctx.businessUnit) q = q.eq('business_unit', ctx.businessUnit);
    const { data: ok, error: e1 } = await q;
    if (e1) return dbError('api/crm/property-shortlist check', e1);
    const rows = (ok || []).map(r => ({ user_id: ctx.userId, property_id: r.id as string }));
    if (!rows.length) return NextResponse.json({ error: 'Those properties are not in your workspace' }, { status: 404 });
    const { error } = await db.from('crm_property_shortlist').upsert(rows, { onConflict: 'user_id,property_id', ignoreDuplicates: true });
    if (error) return dbError('api/crm/property-shortlist POST', error);
    return NextResponse.json({ ok: true, changed: rows.length });
  }
  const { error } = await db.from('crm_property_shortlist').delete().eq('user_id', ctx.userId).in('property_id', ids);
  if (error) return dbError('api/crm/property-shortlist DELETE', error);
  return NextResponse.json({ ok: true, changed: ids.length });
}
