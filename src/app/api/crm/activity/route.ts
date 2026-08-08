import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

function toUnit(v: string | null) {
  return v === 'residential' ? 'residential' : 'commercial';
}

export async function GET(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { searchParams } = req.nextUrl;
  const unit      = toUnit(searchParams.get('unit'));
  const weekStart = searchParams.get('week_start');
  const allTime   = searchParams.get('all') === 'true';
  const agentId   = caller.id;

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
    .gte('created_at', weekStart + 'T00:00:00Z')
    .lte('created_at', weekEnd + 'T23:59:59Z');

  // Tasks completed each day this week
  const { data: tasksDone } = await supabase
    .from('crm_tasks')
    .select('updated_at')
    .eq('business_unit', unit)
    .eq('status', 'done')
    .gte('updated_at', weekStart + 'T00:00:00Z')
    .lte('updated_at', weekEnd + 'T23:59:59Z');

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
    const day = c.created_at?.split('T')[0];
    if (day && auto_stats[day]) auto_stats[day].new_records++;
  });
  (tasksDone ?? []).forEach(t => {
    const day = t.updated_at?.split('T')[0];
    if (day && auto_stats[day]) auto_stats[day].tasks_done++;
  });
  (tasksOverdue ?? []).forEach(t => {
    const day = t.due_date;
    if (day && auto_stats[day]) auto_stats[day].tasks_overdue++;
  });

  return NextResponse.json({ logs: logs ?? [], auto_stats });
}

export async function POST(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const body = await req.json();
  const {
    log_date, business_unit,
    calls_block_protected, prospecting_calls, conversations,
    door_touches, tours_meetings, notes,
    opportunities_created, pitch_appointments, listings_won, deals_closed,
  } = body;

  if (!log_date) return NextResponse.json({ error: 'log_date required' }, { status: 400 });

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_activity_logs')
    .upsert({
      agent_id: caller.id,
      log_date,
      business_unit: toUnit(business_unit),
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
