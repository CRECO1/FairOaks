import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_KEY = process.env.RESEND_API_KEY!;
const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL ?? 'https://crm.vultstack.com';

function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

/**
 * GET /api/cron/task-reminders
 * Runs daily (weekdays 8 AM CT). Sends each agent an email digest of their
 * overdue + due-today open tasks. Secured by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const supabase = adminClient();
  const resend = new Resend(RESEND_KEY);

  // Fetch all open/in-progress tasks due today or earlier, with assignee + client joins
  const { data: tasks, error: taskErr } = await supabase
    .from('crm_tasks')
    .select(`
      id, title, due_date, priority, status, business_unit,
      client:crm_clients(first_name, last_name),
      assignee:crm_profiles!assigned_to(id, first_name, last_name, email)
    `)
    .in('status', ['open', 'in_progress'])
    .lte('due_date', todayStr)
    .not('due_date', 'is', null);

  if (taskErr || !tasks) {
    console.error('[task-reminders] fetch error:', taskErr);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }

  // Group tasks by assigned agent
  const byAgent: Record<string, { email: string; name: string; firstName: string; tasks: any[]; callbacks: any[] }> = {};
  for (const task of tasks) {
    const assignee = (task as any).assignee;
    if (!assignee?.email) continue;
    if (!byAgent[assignee.id]) {
      byAgent[assignee.id] = {
        email: assignee.email,
        name: `${assignee.first_name} ${assignee.last_name}`.trim(),
        firstName: assignee.first_name,
        tasks: [],
        callbacks: [],
      };
    }
    byAgent[assignee.id].tasks.push(task);
  }

  // Overdue call-backs from the Calling Log go into the same digest. The call row is
  // the single source of truth — assigned ones nag their owner, unassigned ones nag
  // every super-admin so nothing sits unclaimed. A failure here must not stop the
  // task digest, so it degrades to "no call-backs".
  try {
    const now = Date.now();
    const GRACE_MS = 12 * 3600_000;   // an undated call-back starts nagging once it's ~half a day old
    const { data: openCbs } = await supabase
      .from('crm_call_log')
      .select('id, caller_name, from_number, callback_number, summary, follow_up_due, follow_up_assignee, business_unit, contact_id, started_at')
      .eq('needs_follow_up', true).is('handled_at', null);

    // A call-back nags once its due time passes — or, if none was set, once the call
    // itself is older than the grace window. Auto-captured voicemails and missed calls
    // carry no due time, so without this branch they would never reach the digest.
    const callbacks = (openCbs ?? []).flatMap((cb) => {
      const due = cb.follow_up_due ? new Date(cb.follow_up_due).getTime() : null;
      if (due != null) return due <= now ? [{ ...cb, sinceMs: now - due, dated: true }] : [];
      const age = now - new Date(cb.started_at).getTime();
      return age >= GRACE_MS ? [{ ...cb, sinceMs: age, dated: false }] : [];
    }).sort((a, b) => b.sinceMs - a.sinceMs);   // most overdue / longest-waiting first

    if (callbacks.length) {
      const assigneeIds = Array.from(new Set(callbacks.map(c => c.follow_up_assignee).filter(Boolean))) as string[];
      const contactIds = Array.from(new Set(callbacks.map(c => c.contact_id).filter(Boolean))) as string[];
      const [assigneeProfiles, superAdmins, contacts] = await Promise.all([
        assigneeIds.length ? supabase.from('crm_profiles').select('id, first_name, last_name, email').in('id', assigneeIds) : Promise.resolve({ data: [] as any[] }),
        supabase.from('crm_profiles').select('id, first_name, last_name, email').eq('role', 'super_admin'),
        contactIds.length ? supabase.from('crm_clients').select('id, first_name, last_name, business_name').in('id', contactIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const profById = new Map((assigneeProfiles.data ?? []).map(p => [p.id, p]));
      const contactById = new Map((contacts.data ?? []).map(c => [c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || '']));
      const admins = (superAdmins.data ?? []).filter(a => a.email);

      const attach = (p: { id: string; first_name?: string | null; last_name?: string | null; email: string }, cb: any) => {
        if (!byAgent[p.id]) byAgent[p.id] = { email: p.email, name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(), firstName: p.first_name ?? 'there', tasks: [], callbacks: [] };
        byAgent[p.id].callbacks.push({ ...cb, who: contactById.get(cb.contact_id) || cb.caller_name || cb.callback_number || cb.from_number || 'Unknown caller' });
      };
      for (const cb of callbacks) {
        const owner = cb.follow_up_assignee ? profById.get(cb.follow_up_assignee) : null;
        if (owner?.email) attach(owner as any, cb);
        else if (!cb.follow_up_assignee) admins.forEach(a => attach(a as any, cb));   // unassigned → every super-admin
      }
    }
  } catch (cbErr) {
    console.error('[task-reminders] callbacks fetch error:', cbErr);
  }

  const PRIORITY_BADGE: Record<string, string> = {
    urgent: 'background:#fee2e2;color:#dc2626',
    high: 'background:#fed7aa;color:#c2410c',
    normal: 'background:#e5e7eb;color:#374151',
    low: 'background:#f3f4f6;color:#9ca3af',
  };

  let sent = 0;
  const errors: string[] = [];

  for (const [, agent] of Object.entries(byAgent)) {
    try {
      const overdueTasks = agent.tasks.filter((t: any) => t.due_date < todayStr);
      const dueTodayTasks = agent.tasks.filter((t: any) => t.due_date === todayStr);
      const overdueCallbacks = agent.callbacks;
      const total = agent.tasks.length + overdueCallbacks.length;
      if (total === 0) continue;
      const summary = [
        agent.tasks.length ? `${agent.tasks.length} task${agent.tasks.length !== 1 ? 's' : ''}` : '',
        overdueCallbacks.length ? `${overdueCallbacks.length} call-back${overdueCallbacks.length !== 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(agent.tasks.length && overdueCallbacks.length ? ' and ' : '');

      const renderRow = (t: any) => {
        const client = (t.client as any);
        const clientName = client ? `${client.first_name} ${client.last_name}`.trim() : '';
        const isOverdue = t.due_date < todayStr;
        const daysOverdue = isOverdue
          ? Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000)
          : 0;
        const dueLabel = isOverdue
          ? `${daysOverdue}d overdue`
          : 'Due today';
        const dueColor = isOverdue ? '#dc2626' : '#c9922c';
        const priorityStyle = PRIORITY_BADGE[t.priority] ?? PRIORITY_BADGE.normal;

        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;vertical-align:top;">
              <div style="font-size:14px;font-weight:600;color:#111;">${t.title}</div>
              ${clientName ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px;">${clientName}</div>` : ''}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;white-space:nowrap;text-align:right;vertical-align:top;">
              <span style="font-size:12px;font-weight:700;color:${dueColor};">${dueLabel}</span><br/>
              <span style="font-size:11px;padding:2px 6px;border-radius:4px;${priorityStyle};margin-top:3px;display:inline-block;">${t.priority}</span>
            </td>
          </tr>`;
      };

      const overdueRows = overdueTasks.map(renderRow).join('');
      const todayRows = dueTodayTasks.map(renderRow).join('');

      const renderCallback = (c: any) => {
        const mins = Math.max(1, Math.round(c.sinceMs / 60000));
        const h = Math.floor(mins / 60), d = Math.floor(h / 24);
        const ago = d >= 1 ? `${d}d` : h >= 1 ? `${h}h` : `${mins}m`;
        const label = c.dated ? `${ago} overdue` : `waiting ${ago}`;
        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;vertical-align:top;">
              <div style="font-size:14px;font-weight:600;color:#111;">📞 ${c.who}</div>
              ${c.summary ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px;">${String(c.summary).slice(0, 120)}</div>` : ''}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;white-space:nowrap;text-align:right;vertical-align:top;">
              <span style="font-size:12px;font-weight:700;color:#dc2626;">${label}</span>
            </td>
          </tr>`;
      };
      // Keep the email digestible when a backlog exists; the rest live in the Calling Log.
      const CALLBACK_CAP = 12;
      const callbackRows = overdueCallbacks.slice(0, CALLBACK_CAP).map(renderCallback).join('')
        + (overdueCallbacks.length > CALLBACK_CAP ? `<tr><td colspan="2" style="padding:9px 12px;font-size:12px;color:#6b7280;">+ ${overdueCallbacks.length - CALLBACK_CAP} more waiting — open the Calling Log</td></tr>` : '');

      const html = `
<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'DM Sans',Arial,sans-serif;">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <!-- Header -->
    <div style="background:#111;color:#fff;padding:20px 28px;">
      <div style="font-size:20px;font-weight:700;color:#c9922c;">📋 Daily Task Digest</div>
      <div style="font-size:13px;color:rgba(255,255,255,.5);margin-top:4px;">
        ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
    </div>

    <!-- Body -->
    <div style="padding:24px 28px;">
      <p style="margin:0 0 20px;font-size:15px;color:#374151;">
        Hi <strong>${agent.firstName}</strong>, you have
        <strong style="color:#111;">${summary}</strong> needing attention today.
      </p>

      ${overdueTasks.length > 0 ? `
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#dc2626;margin-bottom:8px;">
        ⚠️ Overdue (${overdueTasks.length})
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;border:1px solid #fee2e2;border-radius:8px;overflow:hidden;">
        ${overdueRows}
      </table>` : ''}

      ${dueTodayTasks.length > 0 ? `
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#c9922c;margin-bottom:8px;">
        📅 Due Today (${dueTodayTasks.length})
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;border:1px solid #fde68a;border-radius:8px;overflow:hidden;">
        ${todayRows}
      </table>` : ''}

      ${overdueCallbacks.length > 0 ? `
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#dc2626;margin-bottom:8px;">
        📞 Call-backs to return (${overdueCallbacks.length})
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;border:1px solid #fee2e2;border-radius:8px;overflow:hidden;">
        ${callbackRows}
      </table>` : ''}

      <div style="text-align:center;margin-top:24px;">
        ${agent.tasks.length ? `<a href="${CRM_URL}#tasks"
           style="background:#c9922c;color:#111;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;margin:0 4px 8px;">
          Open Task Board →
        </a>` : ''}
        ${overdueCallbacks.length ? `<a href="${CRM_URL}#calls"
           style="background:#111;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;margin:0 4px 8px;">
          Open Calling Log →
        </a>` : ''}
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">VultStack CRM · This digest runs automatically every weekday morning</p>
    </div>
  </div>
</body>
</html>`;

      await resend.emails.send({
        from: 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
        to: agent.email,
        subject: `📋 ${summary} need your attention today`,
        html,
      });
      sent++;
    } catch (err) {
      console.error('[task-reminders] send error for', agent.email, err);
      errors.push(agent.email);
    }
  }

  console.log(`[task-reminders] sent=${sent} agents=${Object.keys(byAgent).length} errors=${errors.length}`);
  return NextResponse.json({ sent, total_agents: Object.keys(byAgent).length, errors });
}
