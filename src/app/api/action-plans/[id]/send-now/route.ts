import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

function fromAddress(businessUnit?: string) {
  return businessUnit === 'commercial'
    ? 'CRECO <info@crecotx.com>'
    : 'Fair Oaks Realty Group <info@fairoaksrealtygroup.com>';
}

function applyMergeFields(template: string, ctx: {
  client: { first_name: string; last_name: string; email: string; type: string; unsubscribe_token: string };
  agent: { first_name: string; last_name: string; email: string; phone?: string };
}): string {
  const BASE_URL = 'https://www.fairoaksrealtygroup.com';
  const unsubscribeUrl = `${BASE_URL}/api/campaigns/unsubscribe?token=${ctx.client.unsubscribe_token}`;
  return template
    .replaceAll('{{first_name}}', ctx.client.first_name || '')
    .replaceAll('{{last_name}}', ctx.client.last_name || '')
    .replaceAll('{{full_name}}', `${ctx.client.first_name} ${ctx.client.last_name}`.trim())
    .replaceAll('{{email}}', ctx.client.email || '')
    .replaceAll('{{client_type}}', ctx.client.type || '')
    .replaceAll('{{agent_name}}', `${ctx.agent.first_name} ${ctx.agent.last_name}`.trim())
    .replaceAll('{{agent_email}}', ctx.agent.email || '')
    .replaceAll('{{agent_phone}}', ctx.agent.phone || '(210) 390-9997')
    .replaceAll('{{brokerage}}', 'Fair Oaks Realty Group')
    .replaceAll('{{unsubscribe_url}}', unsubscribeUrl);
}

function computeNextStepAt(delayDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delayDays);
  return d.toISOString();
}

// POST /api/action-plans/[id]/send-now
// Immediately processes and sends step 1 for a freshly enrolled client.
// Called right after enrollment so the first email fires instantly rather
// than waiting up to 15 minutes for the cron job.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: planId } = await params;
  const { client_id, agent_id } = await req.json();

  if (!client_id || !agent_id) {
    return NextResponse.json({ error: 'client_id and agent_id are required' }, { status: 400 });
  }

  const supabase = adminClient();
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const now = new Date().toISOString();

  // Fetch the enrollment
  const { data: enrollment } = await supabase
    .from('crm_action_plan_enrollments')
    .select('id, current_step, plan_id, client_id, agent_id')
    .eq('plan_id', planId)
    .eq('client_id', client_id)
    .eq('active', true)
    .single();

  if (!enrollment) {
    return NextResponse.json({ error: 'No active enrollment found' }, { status: 404 });
  }

  // Fetch the plan
  const { data: plan } = await supabase
    .from('crm_action_plans')
    .select('id, name, status, business_unit')
    .eq('id', planId)
    .single();

  if (!plan || plan.status !== 'active') {
    return NextResponse.json({ error: 'Plan not found or not active' }, { status: 400 });
  }

  // Fetch the client
  const { data: client } = await supabase
    .from('crm_clients')
    .select('id, first_name, last_name, email, type, agent_id, unsubscribe_token, unsubscribed_at')
    .eq('id', client_id)
    .single();

  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  if (client.unsubscribed_at) return NextResponse.json({ skipped: true, reason: 'unsubscribed' });
  if (!client.email) return NextResponse.json({ skipped: true, reason: 'no email' });

  // Fetch the agent
  const agentLookupId = client.agent_id || agent_id;
  const { data: agent } = await supabase
    .from('crm_profiles')
    .select('id, first_name, last_name, email, phone')
    .eq('id', agentLookupId)
    .single();

  const agentCtx = agent ?? { first_name: 'Your', last_name: 'Agent', email: 'info@fairoaksrealtygroup.com', phone: '(210) 390-9997' };

  // Fetch step 1
  const stepOrder = (enrollment.current_step ?? 0) + 1;
  const { data: step } = await supabase
    .from('crm_action_plan_steps')
    .select('*')
    .eq('plan_id', planId)
    .eq('step_order', stepOrder)
    .single();

  if (!step) {
    return NextResponse.json({ skipped: true, reason: 'no steps in plan' });
  }

  const ctx = {
    client: {
      first_name: client.first_name,
      last_name: client.last_name,
      email: client.email,
      type: client.type,
      unsubscribe_token: client.unsubscribe_token ?? '',
    },
    agent: {
      first_name: agentCtx.first_name,
      last_name: agentCtx.last_name,
      email: agentCtx.email,
      phone: agentCtx.phone,
    },
  };

  let status: 'sent' | 'skipped' | 'failed' = 'sent';
  let errorMsg: string | null = null;

  try {
    if (step.type === 'email') {
      const subject = applyMergeFields(step.subject || `Step ${stepOrder} from ${plan.name}`, ctx);
      const body = applyMergeFields(step.body || '', ctx);
      const result = await resend.emails.send({
        from: fromAddress(plan.business_unit),
        to: client.email,
        subject,
        html: body,
      });
      if (result.error) throw new Error(result.error.message);
    } else if (step.type === 'sms') {
      status = 'skipped';
      errorMsg = 'SMS not yet configured';
    } else if (step.type === 'task' || step.type === 'note') {
      const activityBody = applyMergeFields(step.body || '', ctx);
      await supabase.from('crm_activity').insert([{
        client_id: client.id,
        agent_id: agentLookupId,
        type: step.type === 'task' ? 'task' : 'note',
        notes: `[Action Plan: ${plan.name}] ${activityBody}`,
      }]);
    }
  } catch (err: any) {
    status = 'failed';
    errorMsg = err?.message ?? String(err);
  }

  // Log execution
  await supabase.from('crm_activity').insert([{
    client_id: client.id,
    agent_id: agentLookupId,
    type: step.type === 'email' ? 'email' : step.type === 'sms' ? 'sms' : 'note',
    notes: `[Action Plan: ${plan.name} — Step ${stepOrder}] ${status === 'failed' ? 'FAILED: ' + errorMsg : status === 'skipped' ? 'Skipped: ' + errorMsg : 'Sent immediately on enrollment'}`,
  }]);

  if (status === 'sent') {
    await supabase.from('crm_clients').update({ last_touched_at: now }).eq('id', client.id);
  }

  // Advance enrollment to next step
  const { data: nextStep } = await supabase
    .from('crm_action_plan_steps')
    .select('step_order, delay_days')
    .eq('plan_id', planId)
    .eq('step_order', stepOrder + 1)
    .single();

  if (nextStep) {
    const next_step_at = computeNextStepAt(nextStep.delay_days ?? 1);
    await supabase.from('crm_action_plan_enrollments')
      .update({ current_step: stepOrder, next_step_at })
      .eq('id', enrollment.id);
  } else {
    // Only one step — mark complete
    await supabase.from('crm_action_plan_enrollments')
      .update({ active: false, completed_at: now, next_step_at: null })
      .eq('id', enrollment.id);
  }

  return NextResponse.json({ sent: status === 'sent', status, step: stepOrder });
}
