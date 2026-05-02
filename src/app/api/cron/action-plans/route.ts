import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

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

function fromAddress(businessUnit?: string) {
  return businessUnit === 'commercial'
    ? 'CRECO <info@crecotx.com>'
    : 'Fair Oaks Realty Group <info@fairoaksrealtygroup.com>';
}

function resendClient(businessUnit?: string) {
  const key = businessUnit === 'commercial'
    ? process.env.RESEND_API_KEY_COMMERCIAL!
    : process.env.RESEND_API_KEY!;
  return new Resend(key);
}

function computeNextStepAt(delayDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delayDays);
  return d.toISOString();
}

export async function GET(req: NextRequest) {
  // Secure the cron endpoint
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = adminClient();
  const now = new Date().toISOString();

  // Get active enrollments with a step due to run
  const { data: enrollments, error: fetchErr } = await supabase
    .from('crm_action_plan_enrollments')
    .select(`
      id, plan_id, client_id, agent_id, current_step, next_step_at,
      plan:crm_action_plans!inner(id, name, status, business_unit, completion_campaign_id),
      client:crm_clients!inner(id, first_name, last_name, email, phone, cell_phone, type, agent_id, unsubscribe_token, unsubscribed_at)
    `)
    .eq('active', true)
    .eq('plan.status', 'active')
    .not('next_step_at', 'is', null)
    .lte('next_step_at', now)
    .limit(50);

  if (fetchErr) {
    console.error('Action plan cron fetch error:', fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!enrollments?.length) return NextResponse.json({ processed: 0, executed: 0, completed: 0 });

  // Get agent profiles
  const agentIds = [...new Set((enrollments as any[]).map((e: any) => e.client?.agent_id || e.agent_id).filter(Boolean))];
  const { data: agents } = await supabase.from('crm_profiles').select('id, first_name, last_name, email, phone').in('id', agentIds);
  const agentMap = Object.fromEntries((agents ?? []).map((a: any) => [a.id, a]));

  let executed = 0;
  let completed = 0;

  for (const enrollment of (enrollments as any[])) {
    const plan = enrollment.plan;
    const client = enrollment.client;
    if (!plan || !client) continue;
    if (client.unsubscribed_at) continue; // skip unsubscribed

    const agentId = client.agent_id || enrollment.agent_id;
    const agent = agentMap[agentId] ?? { first_name: 'Your', last_name: 'Agent', email: 'info@fairoaksrealtygroup.com', phone: '(210) 390-9997' };

    // Fetch the current step to execute
    const stepOrder = (enrollment.current_step ?? 0) + 1;
    const { data: step } = await supabase
      .from('crm_action_plan_steps')
      .select('*')
      .eq('plan_id', plan.id)
      .eq('step_order', stepOrder)
      .single();

    if (!step) {
      // No step found at this order — plan is complete
      await completePlan(supabase, enrollment, plan);
      completed++;
      continue;
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
        first_name: agent.first_name,
        last_name: agent.last_name,
        email: agent.email,
        phone: agent.phone,
      },
    };

    let stepStatus: 'sent' | 'failed' | 'skipped' = 'sent';
    let errorMessage: string | null = null;

    try {
      if (step.type === 'email') {
        if (!client.email) {
          stepStatus = 'skipped';
          errorMessage = 'No email address';
        } else {
          const subject = applyMergeFields(step.subject || `Step ${stepOrder} from ${plan.name}`, ctx);
          const body = applyMergeFields(step.body || '', ctx);
          await resendClient(plan.business_unit).emails.send({
            from: fromAddress(plan.business_unit),
            to: client.email,
            subject,
            html: body,
          });
        }
      } else if (step.type === 'sms') {
        // SMS — skipped until Twilio is configured
        stepStatus = 'skipped';
        errorMessage = 'SMS not yet configured';
      } else if (step.type === 'task' || step.type === 'note') {
        // Log to crm_activity for agent visibility
        const activityBody = applyMergeFields(step.body || '', ctx);
        await supabase.from('crm_activity').insert([{
          client_id: client.id,
          agent_id: agentId,
          type: step.type === 'task' ? 'task' : 'note',
          notes: `[Action Plan: ${plan.name}] ${activityBody}`,
        }]);
      }
    } catch (err: any) {
      stepStatus = 'failed';
      errorMessage = err?.message ?? String(err);
    }

    // Log the step execution
    await supabase.from('crm_activity').insert([{
      client_id: client.id,
      agent_id: agentId,
      type: step.type === 'email' ? 'email' : step.type === 'sms' ? 'sms' : 'note',
      notes: `[Action Plan: ${plan.name} — Step ${stepOrder}] ${stepStatus === 'failed' ? 'FAILED: ' + errorMessage : stepStatus === 'skipped' ? 'Skipped: ' + errorMessage : 'Executed'}`,
    }]).then(() => {});

    // Stamp last_touched_at on the client for any successfully executed step
    if (stepStatus === 'sent') {
      await supabase.from('crm_clients').update({ last_touched_at: now }).eq('id', client.id);
    }

    // Check if there's a next step
    const { data: nextStep } = await supabase
      .from('crm_action_plan_steps')
      .select('step_order, delay_days')
      .eq('plan_id', plan.id)
      .eq('step_order', stepOrder + 1)
      .single();

    if (nextStep) {
      // Advance to next step
      const next_step_at = computeNextStepAt(nextStep.delay_days ?? 1);
      await supabase.from('crm_action_plan_enrollments')
        .update({ current_step: stepOrder, next_step_at })
        .eq('id', enrollment.id);
    } else {
      // No more steps — plan complete
      await completePlan(supabase, enrollment, plan);
      completed++;
    }

    executed++;
  }

  return NextResponse.json({ processed: enrollments.length, executed, completed });
}

async function completePlan(supabase: ReturnType<typeof adminClient>, enrollment: any, plan: any) {
  const completedAt = new Date().toISOString();

  // Mark enrollment complete
  await supabase.from('crm_action_plan_enrollments')
    .update({ active: false, completed_at: completedAt, next_step_at: null })
    .eq('id', enrollment.id);

  // If plan has a completion campaign, auto-enroll the client
  if (plan.completion_campaign_id) {
    const { data: campaign } = await supabase
      .from('crm_campaigns')
      .select('id, status, frequency, send_date, send_time')
      .eq('id', plan.completion_campaign_id)
      .single();

    if (campaign) {
      let next_send_at: string | null = null;
      if (campaign.status === 'active') {
        if (campaign.frequency === 'one-time' && campaign.send_date) {
          const time = campaign.send_time || '08:00';
          next_send_at = new Date(`${campaign.send_date}T${time}:00-05:00`).toISOString();
        } else {
          const d = new Date();
          if (campaign.frequency === 'monthly') d.setMonth(d.getMonth() + 1);
          else if (campaign.frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
          else if (campaign.frequency === 'semi-annual') d.setMonth(d.getMonth() + 6);
          else if (campaign.frequency === 'annual') d.setFullYear(d.getFullYear() + 1);
          next_send_at = d.toISOString();
        }
      }

      await supabase.from('crm_campaign_enrollments').upsert([{
        campaign_id: plan.completion_campaign_id,
        client_id: enrollment.client_id,
        enrolled_by: enrollment.agent_id ?? null,
        next_send_at,
        active: true,
      }], { onConflict: 'campaign_id,client_id', ignoreDuplicates: false });
    }
  }
}
