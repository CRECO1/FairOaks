import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { sendPushToProfiles, crmLink, superAdminIds } from '@/lib/push';
import { chicagoHourDow, chicagoToday } from '@/lib/chicago-time';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/attention-digest — Mon–Fri at 13:10/14:10 UTC and 21:10/22:10 UTC; only the run that lands on
 * 8 am (morning) or 4 pm (evening) Central does anything, so it is right in both CDT and CST. Secured with CRON_SECRET.
 *
 * Built from the Nov 2026 usage read (85% of alerts unread; 41 held leads; one agent with 33 overdue tasks):
 *  MORNING  • tags / assignments still unread after 20 h are re-sent (daily, up to 5 days) — the "very important" ones
 *           • what is due today / overdue, per agent
 *           • held leads waiting more than a day → account owner
 *           • Mondays: open deals untouched 14+ days → their owner; overdue-by-agent roll-up → account owner
 *  EVENING  • ONE "who opened your emails today" alert (instant open alerts were turned off — they buried replies)
 * Phone alerts only; every row it reads already exists. Never throws on a single person's failure.
 */
const BU = 'commercial';
const iso = (ms: number) => new Date(ms).toISOString();

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { hour, dow } = chicagoHourDow(new Date());
  const mode = hour === 8 ? 'morning' : hour === 16 ? 'evening' : null;
  const force = req.nextUrl.searchParams.get('force');   // lets the owner test it by hand: ?force=morning|evening
  const run = force === 'morning' || force === 'evening' ? force : mode;
  if (!run) return NextResponse.json({ ok: true, skipped: `not 8 am or 4 pm Central (hour ${hour})` });

  const db = adminClient();
  const { data: profs } = await db.from('crm_profiles').select('id, first_name, role').eq('business_unit', BU);
  const people = profs ?? [];
  const out: Record<string, number> = {};
  const push = async (ids: string[], title: string, body: string, page: string, category: 'mentions' | 'leads' | 'opens', tag: string) => {
    const r = await sendPushToProfiles(ids, { title, body, url: crmLink(page), tag, category, businessUnit: BU }, { db });
    out[tag] = (out[tag] ?? 0) + r.sent;
  };

  try {
    if (run === 'evening') {
      const since = iso(Date.now() - 10 * 3600_000);
      const { data: opens } = await db.from('crm_notifications').select('recipient_id, message').eq('type', 'email_open').gte('created_at', since);
      const by = new Map<string, string[]>();
      for (const o of opens ?? []) by.set(o.recipient_id as string, [...(by.get(o.recipient_id as string) ?? []), String(o.message).replace(/^👁\s*/, '').replace(/ opened your email.*$/, '')]);
      for (const [id, names] of by) {
        const uniq = [...new Set(names)];
        await push([id], `${uniq.length} ${uniq.length === 1 ? 'person' : 'people'} opened your emails today`, `${uniq.slice(0, 4).join(', ')}${uniq.length > 4 ? ` +${uniq.length - 4} more` : ''}`, 'dashboard', 'opens', 'digest-opens');
      }
      return NextResponse.json({ ok: true, run, ...out });
    }

    // ── Morning ──
    // 1) Tags / assignments / shares still unread: re-send (they ask someone to do something).
    const { data: unread } = await db.from('crm_notifications').select('recipient_id, message, created_at')
      .in('type', ['mention', 'assignment', 'share']).is('read_at', null)
      .lt('created_at', iso(Date.now() - 20 * 3600_000)).gt('created_at', iso(Date.now() - 5 * 86400_000)).order('created_at', { ascending: false });
    const mine = new Map<string, string[]>();
    for (const n of unread ?? []) mine.set(n.recipient_id as string, [...(mine.get(n.recipient_id as string) ?? []), String(n.message)]);
    for (const [id, msgs] of mine) {
      if (!people.some(p => p.id === id)) continue;
      await push([id], `${msgs.length} tag${msgs.length === 1 ? '' : 's'} & assignment${msgs.length === 1 ? '' : 's'} still waiting on you`, msgs[0], 'dashboard', 'mentions', 'digest-tags');
    }

    // 2) Due today / overdue, per agent.
    const today = chicagoToday();
    const todayIso = today;
    const { data: tasks } = await db.from('crm_tasks').select('assigned_to, due_date, status').not('status', 'in', '(done,completed)').lte('due_date', todayIso).limit(5000);
    const due = new Map<string, { today: number; over: number }>();
    for (const t of tasks ?? []) {
      if (!t.assigned_to) continue;
      const c = due.get(t.assigned_to as string) ?? { today: 0, over: 0 };
      if (String(t.due_date).slice(0, 10) === todayIso) c.today++; else c.over++;
      due.set(t.assigned_to as string, c);
    }
    for (const [id, c] of due) {
      if (!people.some(p => p.id === id) || c.today + c.over === 0) continue;
      await push([id], 'Your day', `${c.today} due today${c.over ? `, ${c.over} overdue` : ''}`, 'tasks', 'mentions', 'digest-day');
    }

    // 3) Held leads waiting over a day → the account owner.
    const owners = await superAdminIds(db);
    const { count: held } = await db.from('crm_clients').select('id', { count: 'exact', head: true }).eq('lead_hold', true).eq('business_unit', BU).lt('created_at', iso(Date.now() - 86400_000));
    if (held) await push(owners, `${held} held lead${held === 1 ? '' : 's'} waiting for you`, 'Release them to an agent from the contact card, or work them yourself.', 'contacts', 'leads', 'digest-held');

    // 4) Mondays: stale deals to their owner, overdue roll-up to the owner.
    if (dow === 1) {
      const { data: deals } = await db.from('crm_deals').select('agent_id, stage, last_touch').eq('business_unit', BU).not('stage', 'in', '(Closed,Lost)');
      const stale = new Map<string, number>();
      for (const d of deals ?? []) if (d.last_touch && Date.now() - new Date(String(d.last_touch) + 'T12:00:00').getTime() >= 14 * 86400_000) stale.set(d.agent_id as string, (stale.get(d.agent_id as string) ?? 0) + 1);
      for (const [id, n] of stale) await push([id], `${n} deal${n === 1 ? '' : 's'} gone quiet`, 'Open deals not touched in two weeks — see the dashboard.', 'dashboard', 'mentions', 'digest-stale');
      const parts = [...due].filter(([, c]) => c.over >= 5).map(([id, c]) => `${people.find(p => p.id === id)?.first_name ?? '?'} ${c.over}`);
      if (parts.length) await push(owners, 'Overdue tasks this week', parts.join(' · '), 'tasks', 'mentions', 'digest-overdue');
    }
    return NextResponse.json({ ok: true, run, ...out });
  } catch (e) {
    console.error('[attention-digest]', e);
    return NextResponse.json({ error: 'Digest failed' }, { status: 500 });
  }
}
