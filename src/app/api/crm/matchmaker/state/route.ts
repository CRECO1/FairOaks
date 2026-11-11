import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { canAct, canSee, isSetupMissing, loadMatchState, loadTenant } from '@/lib/matchmaker/server';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * What the Matchmaker has already done for one tenant (crm_need_matches), so the tab can hide what the agent marked "not a fit" and
 * label what was already emailed.
 *
 *   GET  ?client_id=…                                  -> { dismissed: string[], emailed: { [property_id]: { at, to } } }
 *   POST { client_id, property_ids, action: 'dismiss' | 'restore' }   mark / unmark "not a fit"
 *
 * Until supabase/matchmaker-needs-2026-11.sql is applied, GET answers { setup_needed: true } with empty lists, and the tab keeps working.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const clientId = req.nextUrl.searchParams.get('client_id') ?? '';
  if (!UUID.test(clientId)) return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  const db = adminClient();
  const { row } = await loadTenant(db, clientId);
  if (!row || !canSee(ctx, row)) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  const { byClient, setupMissing } = await loadMatchState(db, [clientId]);
  if (setupMissing) return NextResponse.json({ dismissed: [], emailed: {}, setup_needed: true });
  const s = byClient.get(clientId)!;
  return NextResponse.json({ dismissed: [...s.dismissed], emailed: Object.fromEntries([...s.emailed].map(([id, v]) => [id, v])) });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => null) as { client_id?: unknown; property_ids?: unknown; action?: unknown } | null;
  const clientId = String(b?.client_id ?? '');
  const ids = Array.isArray(b?.property_ids) ? [...new Set(b!.property_ids.map(String))].filter(i => UUID.test(i)).slice(0, 100) : [];
  if (!UUID.test(clientId) || !ids.length || (b?.action !== 'dismiss' && b?.action !== 'restore')) return NextResponse.json({ error: 'client_id, property_ids and action (dismiss | restore) required' }, { status: 400 });
  const db = adminClient();
  const { row } = await loadTenant(db, clientId);
  if (!row || !canAct(ctx, row)) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  if (b.action === 'dismiss') {
    const now = new Date().toISOString();
    const { error } = await db.from('crm_need_matches').upsert(ids.map(property_id => ({ client_id: clientId, property_id, dismissed_at: now, dismissed_by: ctx.userId })), { onConflict: 'client_id,property_id' });
    if (error) return isSetupMissing(error) ? NextResponse.json({ setup_needed: true, error: 'Matchmaker needs a one-time database update first.' }, { status: 503 }) : dbError('api/crm/matchmaker/state dismiss', error);
  } else {
    const { error } = await db.from('crm_need_matches').update({ dismissed_at: null, dismissed_by: null }).eq('client_id', clientId).in('property_id', ids);
    if (error) return isSetupMissing(error) ? NextResponse.json({ setup_needed: true, error: 'Matchmaker needs a one-time database update first.' }, { status: 503 }) : dbError('api/crm/matchmaker/state restore', error);
  }
  return NextResponse.json({ ok: true, changed: ids.length });
}
