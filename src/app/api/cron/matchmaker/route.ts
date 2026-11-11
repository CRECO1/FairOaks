import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { buildMatchEmail } from '@/lib/matchmaker/email';
import { criteriaFromRow, EMAIL_MIN_SCORE, hasCriteria, matchProperties } from '@/lib/matchmaker/match';
import { isSetupMissing, loadBroker, loadCandidates, loadMatchState, matchmakerLink, recordMatches, sendViaResend, tenantNames, TENANT_SELECT, type TenantRow } from '@/lib/matchmaker/server';

export const maxDuration = 120;

const PER_EMAIL = 8;      // listings in one alert; the rest are logged as seen and counted ("+ 5 more in Matchmaker")
const MAX_EMAILS = 60;    // a guard, not a target

/**
 * GET /api/cron/matchmaker      (daily, 12:30 UTC ≈ 7:30 AM Central; secured by CRON_SECRET)
 *
 * For every tenant who is actively searching AND whose agent switched on "Email me new matches", rank the Property DB against the saved
 * search and email the OWNING AGENT only the listings that are good fits and that the tenant has not been offered before. The tenant
 * is never emailed from here — sending to a client is always the agent's own click (or the Copilot's confirm card).
 *
 *   ?dry=1          work out what would be sent and return it; send nothing, log nothing
 *   ?client=<id>    only that tenant (handy with dry=1)
 *
 * Opt-in by design: req_auto_match defaults to false, so this does nothing until someone turns it on for a tenant. If the database
 * update (supabase/matchmaker-needs-2026-11.sql) has not been applied yet it answers { setup_needed: true } and exits quietly.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const only = req.nextUrl.searchParams.get('client');
  const db = adminClient();

  let q = db.from('crm_clients').select(TENANT_SELECT).eq('req_active', true).eq('req_auto_match', true).not('agent_id', 'is', null).limit(500);
  if (only) q = q.eq('id', only);
  const { data, error } = await q;
  if (error) return isSetupMissing(error) ? NextResponse.json({ setup_needed: true, sent: 0 }) : NextResponse.json({ error: 'Could not load tenants' }, { status: 500 });
  const tenants = ((data ?? []) as unknown as TenantRow[]).filter(t => !t.lead_hold && hasCriteria(criteriaFromRow(t)));
  if (!tenants.length) return NextResponse.json({ tenants: 0, sent: 0, dry });

  const state = await loadMatchState(db, tenants.map(t => t.id));
  if (state.setupMissing) return NextResponse.json({ setup_needed: true, sent: 0 });
  const candidates = new Map<string, Awaited<ReturnType<typeof loadCandidates>>>();
  const report: Array<{ tenant: string; to: string | null; fresh: number; sent: boolean; note?: string }> = [];
  let sent = 0;

  for (const t of tenants) {
    if (sent >= MAX_EMAILS) break;
    const label = tenantNames(t).name;
    try {
      const bu = t.business_unit ?? 'commercial';
      if (!candidates.has(bu)) candidates.set(bu, await loadCandidates(db, bu));
      const st = state.byClient.get(t.id)!;
      const all = matchProperties(criteriaFromRow(t), candidates.get(bu)!).filter(r => r.score >= EMAIL_MIN_SCORE && !st.dismissed.has(r.property.id));
      const fresh = all.filter(r => !st.seen.has(r.property.id));
      if (!dry) await db.from('crm_clients').update({ req_last_matched_at: new Date().toISOString() }).eq('id', t.id);
      if (!fresh.length) continue;
      const broker = await loadBroker(db, t.agent_id!);
      if (!broker?.inbox) { report.push({ tenant: label, to: null, fresh: fresh.length, sent: false, note: 'agent has no email' }); continue; }
      const shown = fresh.slice(0, PER_EMAIL);
      const email = buildMatchEmail({ audience: 'agent', broker, tenant: tenantNames(t), criteria: criteriaFromRow(t), results: shown, crmUrl: matchmakerLink(t.business_unit, t.id), moreCount: fresh.length - shown.length, isNew: true });
      if (dry) { report.push({ tenant: label, to: broker.inbox, fresh: fresh.length, sent: false, note: 'dry run' }); continue; }
      await sendViaResend(t.business_unit, broker.inbox, email, broker.email);
      // log what was emailed, and quietly log the overflow as seen so tomorrow's alert is only about what is new then
      await recordMatches(db, t.id, shown, 'agent');
      await recordMatches(db, t.id, fresh.slice(PER_EMAIL), null);
      sent++;
      report.push({ tenant: label, to: broker.inbox, fresh: fresh.length, sent: true });
    } catch (e) {
      console.error('[cron/matchmaker]', t.id, (e as Error).message);
      report.push({ tenant: label, to: null, fresh: 0, sent: false, note: 'error' });
    }
  }
  return NextResponse.json({ tenants: tenants.length, sent, dry, report });
}
