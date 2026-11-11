/**
 * Matchmaker, server side — shared by the API routes, the daily job and the Copilot so all three load, rank, email and log the same way.
 * Runs with the service role, so every caller must have checked the person first (getCrmContext + canSee/canAct below).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { handleSend } from '@/lib/gmail-send';
import { isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { agentTitle } from '@/lib/agent-title';
import { buildMatchEmail, type EmailBroker, type MatchEmail } from './email';
import { criteriaFromRow, EMAIL_MIN_SCORE, hasCriteria, MATCH_COLUMNS, matchProperties, type MatchProperty, type MatchResult, type NeedCriteria, type NeedRow } from './match';

/** The office line goes in client emails; the broker's own signature (added by the Gmail pipeline) carries anything personal. */
export const OFFICE_PHONE = '(210) 817-3443';
const CRM_BASE = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.fairoaksrealtygroup.com').replace(/\/$/, '');
/** Deep link into the Matchmaker tab, optionally on one tenant. */
export const matchmakerLink = (bu: string | null, clientId?: string) => `${CRM_BASE}/crm/${bu === 'residential' ? 'residential' : 'commercial'}${clientId ? `?mm=${clientId}` : ''}#properties`;
/** Where an agent's alerts really go (the owner's CRM login is the residential info@ address). */
const ALERT_INBOX: Record<string, string> = { 'info@fairoaksrealtygroup.com': 'zack@crecotx.com' };

export const TENANT_SELECT = 'id,first_name,last_name,business_name,email,type,agent_id,assigned_agent_ids,business_unit,lead_hold,asset_types,req_size_min,req_size_max,req_price_min,req_price_max,req_submarkets,req_deal_type,req_rate_max,req_move_in_by,req_must_haves,req_active,req_auto_match,req_last_matched_at';

export interface TenantRow extends NeedRow {
  id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; type: string | null;
  agent_id: string | null; assigned_agent_ids: string[] | null; business_unit: string | null; lead_hold: boolean | null;
  req_active?: boolean | null; req_auto_match?: boolean | null; req_last_matched_at?: string | null;
}

/** Postgres says a column or table is missing: the SQL (supabase/matchmaker-needs-2026-11.sql) has not been applied yet. */
export function isSetupMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === '42703' || err.code === '42P01' || /does not exist|schema cache|could not find the/i.test(err.message ?? '');
}

export const tenantNames = (r: Pick<TenantRow, 'first_name' | 'last_name' | 'business_name'>) => {
  const person = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
  return { name: person || r.business_name || 'Tenant', firstName: r.first_name || null, business: r.business_name || null };
};

/** Can this person see the tenant at all (workspace + new-lead hold)? */
export function canSee(ctx: CrmContext, r: TenantRow): boolean {
  if (r.lead_hold && ctx.role !== 'super_admin') return false;
  return isAdminRole(ctx.role) || r.business_unit === ctx.businessUnit;
}
/** Can this person act for the tenant — email them, change the search? Admins, the owner, or an agent added to the contact. */
export function canAct(ctx: CrmContext, r: TenantRow): boolean {
  if (!canSee(ctx, r)) return false;
  return isAdminRole(ctx.role) || r.agent_id === ctx.userId || (r.assigned_agent_ids ?? []).includes(ctx.userId);
}

const TENANT_SELECT_BASE = 'id,first_name,last_name,business_name,email,type,agent_id,assigned_agent_ids,business_unit,lead_hold,asset_types,req_size_min,req_size_max,req_price_min,req_price_max,req_submarkets';

/**
 * One tenant. If the database update has not been applied (the new req_* columns are missing) the contact still loads with its
 * original search fields and `setupMissing` is true, so reading and ranking keep working and only the new features wait.
 */
export async function loadTenant(db: SupabaseClient, id: string): Promise<{ row: TenantRow | null; setupMissing: boolean }> {
  const { data, error } = await db.from('crm_clients').select(TENANT_SELECT).eq('id', id).maybeSingle();
  if (error && isSetupMissing(error)) {
    const base = await db.from('crm_clients').select(TENANT_SELECT_BASE).eq('id', id).maybeSingle();
    return { row: (base.data as unknown as TenantRow | null) ?? null, setupMissing: true };
  }
  if (error) return { row: null, setupMissing: false };
  return { row: (data as unknown as TenantRow | null) ?? null, setupMissing: false };
}

/** Every Property DB row a tenant could take: available, or not marked anything else. Paged: PostgREST stops at 1,000 a response. */
export async function loadCandidates(db: SupabaseClient, businessUnit: string | null): Promise<MatchProperty[]> {
  const out: MatchProperty[] = [];
  for (let from = 0; from < 8000; from += 1000) {
    let q = db.from('crm_prospective_properties').select(MATCH_COLUMNS).or('transaction_status.is.null,transaction_status.eq.Available').order('id').range(from, from + 999);
    if (businessUnit) q = q.eq('business_unit', businessUnit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as MatchProperty[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface MatchState { dismissed: Set<string>; emailed: Map<string, { at: string; to: string | null }>; seen: Set<string> }
/** What the log says about one or more tenants. Missing table = nothing logged yet (the SQL has not been applied). */
export async function loadMatchState(db: SupabaseClient, clientIds: string[]): Promise<{ byClient: Map<string, MatchState>; setupMissing: boolean }> {
  const byClient = new Map<string, MatchState>();
  for (const id of clientIds) byClient.set(id, { dismissed: new Set(), emailed: new Map(), seen: new Set() });
  if (!clientIds.length) return { byClient, setupMissing: false };
  const { data, error } = await db.from('crm_need_matches').select('client_id,property_id,emailed_at,emailed_to,dismissed_at').in('client_id', clientIds).limit(20000);
  if (error) return { byClient, setupMissing: isSetupMissing(error) };
  for (const r of data ?? []) {
    const s = byClient.get(r.client_id as string); if (!s) continue;
    s.seen.add(r.property_id as string);
    if (r.dismissed_at) s.dismissed.add(r.property_id as string);
    if (r.emailed_at) s.emailed.set(r.property_id as string, { at: r.emailed_at as string, to: (r.emailed_to as string | null) ?? null });
  }
  return { byClient, setupMissing: false };
}

export async function loadBroker(db: SupabaseClient, userId: string): Promise<(EmailBroker & { id: string; role: string | null; inbox: string | null }) | null> {
  const { data } = await db.from('crm_profiles').select('first_name,last_name,email,role').eq('id', userId).maybeSingle();
  if (!data) return null;
  const email = (data.email as string | null) ?? null;
  return {
    id: userId, name: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || 'Your broker', email, phone: OFFICE_PHONE,
    title: agentTitle(data.role as string | null), role: (data.role as string | null) ?? null,
    inbox: email ? ALERT_INBOX[email.toLowerCase()] ?? email : null,
  };
}

export interface Composed {
  email: MatchEmail; results: MatchResult[]; total: number; to: string | null; criteria: NeedCriteria;
  tenant: ReturnType<typeof tenantNames>; broker: EmailBroker & { id: string; inbox: string | null };
}

/**
 * Rank the Property DB for a tenant and write the email — no sending. `brokerId` is whose name is on it: for the broker's own alert
 * that is who gets it (the person who clicked, or the tenant's owner for the daily job); for a client email it is the sender.
 */
export async function composeMatchEmail(db: SupabaseClient, row: TenantRow, o: { brokerId: string; audience: 'agent' | 'client'; propertyIds?: string[]; note?: string; max?: number }): Promise<Composed | { error: string; status: number }> {
  const criteria = criteriaFromRow(row);
  if (!hasCriteria(criteria)) return { error: 'Save this tenant’s search first — there is nothing to match yet.', status: 400 };
  const broker = await loadBroker(db, o.brokerId);
  if (!broker) return { error: 'Could not find the agent’s profile.', status: 404 };
  const [props, state] = await Promise.all([loadCandidates(db, row.business_unit), loadMatchState(db, [row.id])]);
  const dismissed = state.byClient.get(row.id)!.dismissed;
  const ranked = matchProperties(criteria, props).filter(r => !dismissed.has(r.property.id));
  let picked: MatchResult[];
  if (o.propertyIds?.length) { const by = new Map(ranked.map(r => [r.property.id, r])); picked = o.propertyIds.map(id => by.get(id)).filter((r): r is MatchResult => !!r); }
  else picked = ranked.filter(r => r.score >= EMAIL_MIN_SCORE).slice(0, o.max ?? (o.audience === 'agent' ? 8 : 6));
  if (!picked.length) return { error: 'There are no matches to email yet. Try widening the search.', status: 404 };
  const tenant = tenantNames(row);
  const email = buildMatchEmail({
    audience: o.audience, broker, tenant, criteria, results: picked, note: o.note,
    crmUrl: matchmakerLink(row.business_unit, row.id), moreCount: Math.max(0, ranked.filter(r => r.score >= EMAIL_MIN_SCORE).length - picked.length),
  });
  return { email, results: picked, total: ranked.length, to: o.audience === 'agent' ? broker.inbox : row.email, criteria, tenant, broker };
}

/** Stamp what was emailed so the same listing is never offered twice (and "NEW" means new). */
export async function recordMatches(db: SupabaseClient, clientId: string, results: MatchResult[], emailedTo: 'agent' | 'client' | null): Promise<void> {
  if (!results.length) return;
  const now = new Date().toISOString();
  const rows = results.map(r => ({
    client_id: clientId, property_id: r.property.id, score: r.score, fit: r.fit, reasons: r.reasons, caveats: r.caveats,
    ...(emailedTo ? { emailed_at: now, emailed_to: emailedTo } : {}),
  }));
  // new rows get first_seen_at from the default; existing rows keep theirs and only gain the email stamp / fresh score
  const { error } = await db.from('crm_need_matches').upsert(rows, { onConflict: 'client_id,property_id' });
  if (error) console.error('[matchmaker] could not log matches:', error.message);
}

export async function sendViaResend(businessUnit: string | null, to: string, e: MatchEmail, replyTo?: string | null): Promise<void> {
  const commercial = businessUnit !== 'residential';
  const key = ((commercial ? process.env.RESEND_API_KEY_COMMERCIAL : process.env.RESEND_API_KEY) ?? '').replace(/[\r\n\s]+$/, '');
  if (!key) throw new Error('Email is not set up on the server.');
  const from = commercial ? 'CRECO Matchmaker <noreply@crecotx.com>' : 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>';
  const { error } = await new Resend(key).emails.send({ from, to, subject: e.subject, html: e.html, text: e.text, ...(replyTo ? { replyTo } : {}) });
  if (error) throw new Error(error.message);
}

/** Send a composed email: the broker's own alert through Resend, or the tenant's email from the broker's own Gmail (signature, logging and open tracking come with that pipeline). */
export async function deliverMatchEmail(db: SupabaseClient, ctx: CrmContext, row: TenantRow, c: Composed, audience: 'agent' | 'client'): Promise<{ ok: true; to: string } | { ok: false; error: string; status: number }> {
  if (!c.to) return { ok: false, error: audience === 'client' ? 'This contact has no email address on file.' : 'The agent has no email address on file.', status: 400 };
  try {
    if (audience === 'agent') {
      await sendViaResend(row.business_unit, c.to, c.email, c.broker.email);
    } else {
      const res = await handleSend(new Request('http://internal/api/gmail/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: ctx.userId, clientId: row.id, to: c.to, subject: c.email.subject, body: c.email.html }) }), ctx);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: (data as { error?: string }).error || 'Could not send — the agent may need to connect Gmail in Settings.', status: res.status === 401 ? 401 : 502 };
    }
  } catch (e) { return { ok: false, error: (e as Error).message || 'Could not send the email.', status: 502 }; }
  await recordMatches(db, row.id, c.results, audience);
  return { ok: true, to: c.to };
}
