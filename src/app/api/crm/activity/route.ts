import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { chicagoToday, chicagoLocalToUTC } from '@/lib/chicago-time';

function toUnit(v: string | null) {
  return v === 'residential' ? 'residential' : 'commercial';
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { searchParams } = req.nextUrl;
  // Non-admins are pinned to their own workspace (the auto-stats below aggregate
  // by business_unit only, so a client-supplied ?unit= would leak the other unit's counts).
  const unit      = isAdminRole(ctx.role) ? toUnit(searchParams.get('unit')) : toUnit(ctx.businessUnit);
  const weekStart = searchParams.get('week_start');
  const allTime   = searchParams.get('all') === 'true';
  const agentId   = ctx.userId;

  const supabase = adminClient();

  // ── All-time totals for conversion ratios ──────────────────────────────
  if (allTime) {
    const { data } = await supabase
      .from('crm_activity_logs')
      .select('prospecting_calls,conversations,pitch_appointments,listings_won')
      .eq('agent_id', agentId)
      .eq('business_unit', unit);
    return NextResponse.json({ logs: data ?? [] });
  }

  if (!weekStart) return NextResponse.json({ error: 'week_start required' }, { status: 400 });

  const end = new Date(weekStart + 'T12:00:00Z');
  end.setDate(end.getDate() + 6);
  const weekEnd = end.toISOString().split('T')[0];
  // the week as the team lives it: Central midnight to Central midnight, not UTC
  const weekStartUtc = chicagoLocalToUTC(weekStart, '00:00');
  const weekEndUtc = chicagoLocalToUTC(new Date(end.getTime() + 86_400_000).toISOString().split('T')[0], '00:00');

  // ── Activity logs for the week ─────────────────────────────────────────
  const { data: logs } = await supabase
    .from('crm_activity_logs')
    .select('*')
    .eq('agent_id', agentId)
    .eq('business_unit', unit)
    .gte('log_date', weekStart)
    .lte('log_date', weekEnd);

  // ── Auto-stats from CRM ────────────────────────────────────────────────
  // New contacts added each day this week
  const { data: newContacts } = await supabase
    .from('crm_clients')
    .select('created_at')
    .eq('business_unit', unit)
    .gte('created_at', weekStartUtc)
    .lt('created_at', weekEndUtc);

  // Tasks completed each day this week
  const { data: tasksDone } = await supabase
    .from('crm_tasks')
    .select('updated_at')
    .eq('business_unit', unit)
    .eq('status', 'done')
    .gte('updated_at', weekStartUtc)
    .lt('updated_at', weekEndUtc);

  // Tasks that were overdue (due_date within the week, not yet done)
  const { data: tasksOverdue } = await supabase
    .from('crm_tasks')
    .select('due_date')
    .eq('business_unit', unit)
    .neq('status', 'done')
    .gte('due_date', weekStart)
    .lte('due_date', weekEnd);

  // Build per-day map
  const auto_stats: Record<string, { new_records: number; tasks_done: number; tasks_overdue: number }> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00Z');
    d.setDate(d.getDate() + i);
    auto_stats[d.toISOString().split('T')[0]] = { new_records: 0, tasks_done: 0, tasks_overdue: 0 };
  }
  (newContacts ?? []).forEach(c => {
    const day = c.created_at ? chicagoToday(new Date(c.created_at)) : null;
    if (day && auto_stats[day]) auto_stats[day].new_records++;
  });
  (tasksDone ?? []).forEach(t => {
    const day = t.updated_at ? chicagoToday(new Date(t.updated_at)) : null;
    if (day && auto_stats[day]) auto_stats[day].tasks_done++;
  });
  (tasksOverdue ?? []).forEach(t => {
    const day = t.due_date;
    if (day && auto_stats[day]) auto_stats[day].tasks_overdue++;
  });

  return NextResponse.json({ logs: logs ?? [], auto_stats });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const {
    log_date, business_unit,
    calls_block_protected, prospecting_calls, conversations,
    door_touches, tours_meetings, notes,
    opportunities_created, pitch_appointments, listings_won, deals_closed,
  } = body;

  if (!log_date) return NextResponse.json({ error: 'log_date required' }, { status: 400 });
  // ISO date within a sane window (a year back to a week ahead), and well-formed counters.
  const dMs = typeof log_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(log_date) ? Date.parse(log_date) : NaN;
  if (Number.isNaN(dMs) || dMs < Date.now() - 366 * 86_400_000 || dMs > Date.now() + 7 * 86_400_000) {
    return NextResponse.json({ error: 'log_date must be a valid recent date (YYYY-MM-DD)' }, { status: 400 });
  }
  for (const [k, v] of Object.entries({ prospecting_calls, conversations, door_touches, tours_meetings, opportunities_created, pitch_appointments, listings_won, deals_closed })) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 10000) return NextResponse.json({ error: `${k} must be a number between 0 and 10000` }, { status: 400 });
  }
  if (notes != null && (typeof notes !== 'string' || notes.length > 5000)) return NextResponse.json({ error: 'notes must be text up to 5000 characters' }, { status: 400 });

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_activity_logs')
    .upsert({
      agent_id: ctx.userId,
      log_date,
      business_unit: isAdminRole(ctx.role) ? toUnit(business_unit) : toUnit(ctx.businessUnit),
      calls_block_protected: calls_block_protected ?? false,
      prospecting_calls:     prospecting_calls ?? 0,
      conversations:         conversations ?? 0,
      door_touches:          door_touches ?? 0,
      tours_meetings:        tours_meetings ?? 0,
      notes:                 notes ?? '',
      opportunities_created: opportunities_created ?? null,
      pitch_appointments:    pitch_appointments ?? null,
      listings_won:          listings_won ?? null,
      deals_closed:          deals_closed ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent_id,log_date,business_unit' })
    .select()
    .single();

  if (error) {
    console.error('[activity] upsert error:', error);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }
  return NextResponse.json({ log: data });
}
