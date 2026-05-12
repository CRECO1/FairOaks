import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();

  const [activity, campaigns, plans, deals, imports] = await Promise.all([
    supabase.from('crm_activity').select('id,type,notes,created_at,agent:crm_profiles(first_name,last_name)').eq('client_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('crm_campaign_enrollments').select('id,active,enrolled_at,campaign:crm_campaigns(name)').eq('client_id', id).order('enrolled_at', { ascending: false }),
    supabase.from('crm_action_plan_enrollments').select('id,active,created_at,plan:crm_action_plans(name)').eq('client_id', id).order('created_at', { ascending: false }),
    supabase.from('crm_deals').select('id,stage,property,created_at,last_touch').eq('client_id', id).order('created_at', { ascending: false }),
    supabase.from('email_lead_imports').select('id,raw_subject,raw_from,parsed_source,created_at').eq('client_id', id).order('created_at', { ascending: false }),
  ]);

  const events: { id: string; type: string; label: string; detail?: string; date: string; agent?: string }[] = [];

  for (const a of (activity.data ?? [])) {
    const agent = (a.agent as any);
    events.push({ id: a.id, type: a.type, label: a.type.charAt(0).toUpperCase()+a.type.slice(1), detail: a.notes, date: a.created_at, agent: agent ? `${agent.first_name} ${agent.last_name}` : undefined });
  }
  for (const e of (campaigns.data ?? [])) {
    const camp = (e.campaign as any);
    events.push({ id: e.id, type: 'campaign', label: `Enrolled in campaign`, detail: camp?.name, date: e.enrolled_at });
  }
  for (const e of (plans.data ?? [])) {
    const plan = (e.plan as any);
    events.push({ id: e.id, type: 'action_plan', label: `Enrolled in action plan`, detail: plan?.name, date: e.created_at });
  }
  for (const d of (deals.data ?? [])) {
    events.push({ id: d.id, type: 'deal', label: `Deal — ${d.stage}`, detail: d.property, date: d.created_at });
  }
  for (const i of (imports.data ?? [])) {
    events.push({ id: i.id, type: 'lead_import', label: `Lead imported from ${i.parsed_source ?? 'unknown'}`, detail: i.raw_subject, date: i.created_at });
  }

  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return NextResponse.json({ events });
}
