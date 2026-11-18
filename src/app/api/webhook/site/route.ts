/**
 * Narrow server-to-server actions for the crecotx.com public site, so that site holds NO CRM database key.
 * POST /api/webhook/site   Authorization: Bearer <CRM_LEAD_WEBHOOK_SECRET>   { action, ... }
 *
 *   unsubscribe   { token }                      stop marketing email for the contact that owns this unsubscribe token
 *   report.get    { token }                      read one personalized owner report (+ the contact's email/phone for the alert)
 *   report.view   { token, note }                count a view; the FIRST view also logs the note + tag on the contact
 *   report.bov    { token, interest, phone, note, taskTitle, taskNotes }   record a Broker Opinion of Value request
 *
 * Each action does exactly the writes the public site used to make itself, and nothing else; the token is the only key.
 * No rate limit here on purpose: an unsubscribe must never be dropped, and the public site rate-limits its own visitors.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeEqual } from '@/lib/secret-compare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const INTERESTS = new Set(['Selling', 'Leasing up space', '1031 / refinancing', 'Just keeping tabs']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const todayCentral = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

export async function POST(req: NextRequest) {
  const secret = process.env.CRM_LEAD_WEBHOOK_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || !safeEqual(auth?.startsWith('Bearer ') ? auth.slice(7) : null, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const token = str(body.token, 200);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  if (body.action === 'unsubscribe') {
    if (!token) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const { data: client } = await db.from('crm_clients').select('id').eq('unsubscribe_token', token).maybeSingle();
    if (!client) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await db.from('crm_clients').update({ unsubscribed_at: new Date().toISOString() }).eq('id', client.id);
    await db.from('crm_campaign_enrollments').update({ active: false }).eq('client_id', client.id);
    await db.from('crm_action_plan_enrollments').update({ active: false }).eq('client_id', client.id);
    return NextResponse.json({ ok: true });
  }

  if (typeof body.action === 'string' && body.action.startsWith('report.')) {
    if (!REPORT_TOKEN_RE.test(token)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const { data: report } = await db.from('crm_owner_reports')
      .select('id, token, client_id, owner_entity, contact_name, county, roll_year, properties, benchmark, bov_requested_at, view_count, first_viewed_at')
      .eq('token', token).maybeSingle();
    if (!report) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { data: client } = report.client_id
      ? await db.from('crm_clients').select('id, email, phone, agent_id, tags').eq('id', report.client_id).maybeSingle()
      : { data: null };
    const { view_count: _vc, first_viewed_at: _fv, ...publicReport } = report;
    const contact = client ? { email: client.email ?? null, phone: client.phone ?? null } : null;

    const logNote = async (note: string, tag: string) => {
      if (!client || !note) return;
      await db.from('crm_client_activities').insert([{ client_id: client.id, agent_id: client.agent_id, type: 'note', note }]);
      await db.from('crm_clients').update({ tags: Array.from(new Set([...(client.tags ?? []), tag])) }).eq('id', client.id);
    };
    const now = new Date().toISOString();

    if (body.action === 'report.get') return NextResponse.json({ report: publicReport, contact });

    if (body.action === 'report.view') {
      const first = !report.first_viewed_at;
      await db.from('crm_owner_reports').update({
        view_count: (report.view_count ?? 0) + 1, last_viewed_at: now, ...(first ? { first_viewed_at: now } : {}),
      }).eq('id', report.id);
      if (first) await logNote(str(body.note, 500), 'Viewed Owner Report');
      return NextResponse.json({ ok: true, first, report: publicReport, contact });
    }

    if (body.action === 'report.bov') {
      if (report.bov_requested_at && Date.now() - new Date(report.bov_requested_at).getTime() < 24 * 3600_000) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      const interest = typeof body.interest === 'string' && INTERESTS.has(body.interest) ? body.interest : null;
      const phone = str(body.phone, 40);
      await db.from('crm_owner_reports').update({ bov_requested_at: now, interest, bov_phone: phone || null }).eq('id', report.id);
      if (client) {
        if (phone && !client.phone) await db.from('crm_clients').update({ phone }).eq('id', client.id);
        if (client.agent_id) {
          await db.from('crm_tasks').insert([{
            client_id: client.id, title: str(body.taskTitle, 200), type: 'call', notes: str(body.taskNotes, 1000),
            status: 'open', priority: 'urgent', due_date: todayCentral(),
            agent_id: client.agent_id, assigned_to: client.agent_id, created_by: client.agent_id, business_unit: 'commercial',
          }]);
        }
        await logNote(str(body.note, 500), 'Requested BOV');
      }
      return NextResponse.json({ ok: true, report: publicReport, contact, agentId: client?.agent_id ?? null });
    }
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
