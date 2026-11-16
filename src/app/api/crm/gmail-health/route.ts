import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { gmailRefreshKey } from '@/lib/broker-ingest/gmail';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crm/gmail-health — admins: are the team's connected mailboxes healthy? For each mailbox: whose it is, whether Google has stopped accepting its
 * token (needs reconnect), when its token health was last recorded; plus how many emails were filed to contacts today and when the last one arrived, and
 * when the lead-email import last filed something. A quiet break here used to go unnoticed for days. Reads only; no tokens are returned.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const db = adminClient();
  const { data: conns } = await db.from('gmail_connections').select('id, user_id, gmail_email, updated_at');
  const ids = (conns ?? []).map(c => c.id as string);
  const { data: health } = ids.length ? await db.from('crm_integration_status').select('id, last_status, updated_at').in('id', ids.map(gmailRefreshKey)) : { data: [] };
  const hmap = new Map((health ?? []).map(h => [h.id as string, h]));
  const { data: profs } = (conns ?? []).length ? await db.from('crm_profiles').select('id, first_name, last_name').in('id', (conns ?? []).map(c => c.user_id as string)) : { data: [] };
  const pname = new Map((profs ?? []).map(p => [p.id as string, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()]));
  const mailboxes = (conns ?? []).map(c => {
    const h = hmap.get(gmailRefreshKey(c.id as string));
    return { email: String(c.gmail_email ?? ''), name: pname.get(c.user_id as string) ?? '', needsReconnect: h?.last_status === 'error', checkedAt: (h?.updated_at as string | undefined) ?? (c.updated_at as string | null) ?? null };
  });
  const startOfDayCT = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })}T00:00:00-06:00`).toISOString();
  const { data: today } = await db.from('crm_deal_emails').select('direction, created_at').gte('created_at', startOfDayCT).order('created_at', { ascending: false }).limit(2000);
  const filed = { received: (today ?? []).filter(e => e.direction === 'received').length, sent: (today ?? []).filter(e => e.direction !== 'received').length };
  const { data: lastLead } = await db.from('email_lead_imports').select('created_at').order('created_at', { ascending: false }).limit(1);
  return NextResponse.json({
    mailboxes, filedToday: filed, lastFiledAt: (today ?? [])[0]?.created_at ?? null, lastLeadImportAt: (lastLead ?? [])[0]?.created_at ?? null,
    healthy: mailboxes.length > 0 && mailboxes.every(m => !m.needsReconnect),
  });
}
