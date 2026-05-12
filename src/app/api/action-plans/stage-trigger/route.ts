import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

function resendClient(bu: string) {
  return new Resend(bu === 'commercial' ? process.env.RESEND_API_KEY_COMMERCIAL! : process.env.RESEND_API_KEY!);
}
function fromAddress(bu: string) {
  return bu === 'commercial' ? 'CRECO <zack@crecotx.com>' : 'Fair Oaks Realty Group <info@fairoaksrealtygroup.com>';
}
function applyMergeFields(t: string, ctx: any): string {
  const BASE_URL = 'https://www.fairoaksrealtygroup.com';
  return t
    .replaceAll('{{first_name}}', ctx.client.first_name || '')
    .replaceAll('{{last_name}}', ctx.client.last_name || '')
    .replaceAll('{{full_name}}', `${ctx.client.first_name} ${ctx.client.last_name}`.trim())
    .replaceAll('{{email}}', ctx.client.email || '')
    .replaceAll('{{agent_name}}', `${ctx.agent.first_name} ${ctx.agent.last_name}`.trim())
    .replaceAll('{{agent_email}}', ctx.agent.email || '')
    .replaceAll('{{agent_phone}}', ctx.agent.phone || '(210) 817-3443')
    .replaceAll('{{brokerage}}', ctx.agent.brokerage || 'CRECO Commercial Real Estate Company')
    .replaceAll('{{unsubscribe_url}}', `${BASE_URL}/api/campaigns/unsubscribe?token=${ctx.client.unsubscribe_token || ''}`);
}

// POST /api/action-plans/stage-trigger
// Called when a deal stage changes — enrolls the contact in any matching stage_change action plans
export async function POST(req: NextRequest) {
  try {
    const { stage, clientId, agentId, businessUnit } = await req.json();
    if (!stage || !clientId) return NextResponse.json({ enrolled: 0 });

    const supabase = db();

    // Find active action plans with trigger_type=stage_change and trigger_value=stage
    const { data: plans } = await supabase
      .from('crm_action_plans')
      .select('id, name, business_unit')
      .eq('trigger_type', 'stage_change')
      .eq('status', 'active')
      .eq('business_unit', businessUnit ?? 'commercial')
      .ilike('trigger_value', stage);

    if (!plans?.length) return NextResponse.json({ enrolled: 0 });

    // Get client + agent
    const [{ data: client }, { data: agent }] = await Promise.all([
      supabase.from('crm_clients').select('id,first_name,last_name,email,type,unsubscribe_token,unsubscribed_at').eq('id', clientId).single(),
      supabase.from('crm_profiles').select('id,first_name,last_name,email,phone').eq('id', agentId).maybeSingle(),
    ]);

    if (!client || client.unsubscribed_at || !client.email) return NextResponse.json({ enrolled: 0 });

    const bu = businessUnit ?? 'commercial';
    const agentCtx = agent ?? { first_name: 'Your', last_name: 'Agent', email: 'info@crecotx.com', phone: '(210) 817-3443' };
    if (bu === 'commercial') { agentCtx.email = 'info@crecotx.com'; agentCtx.phone = '(210) 817-3443'; }

    const ctx = {
      client: { first_name: client.first_name, last_name: client.last_name, email: client.email, type: client.type, unsubscribe_token: client.unsubscribe_token ?? '' },
      agent:  { first_name: agentCtx.first_name, last_name: agentCtx.last_name, email: agentCtx.email, phone: agentCtx.phone, brokerage: bu === 'commercial' ? 'CRECO Commercial Real Estate Company' : 'Fair Oaks Realty Group' },
    };

    let enrolled = 0;
    const now = new Date().toISOString();

    for (const plan of plans) {
      // Upsert enrollment (skip if already enrolled)
      const { data: enrollment, error: enrollErr } = await supabase
        .from('crm_action_plan_enrollments')
        .upsert({ plan_id: plan.id, client_id: clientId, agent_id: agentId, active: true, current_step: 0, next_step_at: now }, { onConflict: 'plan_id,client_id', ignoreDuplicates: true })
        .select('id, current_step').single();

      if (enrollErr || !enrollment) continue;

      // Send step 1 immediately
      const { data: step } = await supabase.from('crm_action_plan_steps').select('*').eq('plan_id', plan.id).eq('step_order', 1).single();
      if (!step) continue;

      if (step.type === 'email') {
        const subject = applyMergeFields(step.subject || `Stage Update: ${stage}`, ctx);
        const body = applyMergeFields(step.body || '', ctx);
        await resendClient(bu).emails.send({ from: fromAddress(bu), to: client.email, subject, html: body }).catch(() => {});
      }

      await supabase.from('crm_activity').insert([{ client_id: clientId, agent_id: agentId, type: 'email', notes: `[Action Plan: ${plan.name} — Stage trigger: ${stage}] Step 1 sent` }]);

      // Advance enrollment
      const { data: nextStep } = await supabase.from('crm_action_plan_steps').select('step_order,delay_days').eq('plan_id', plan.id).eq('step_order', 2).maybeSingle();
      if (nextStep) {
        const nextAt = new Date(); nextAt.setDate(nextAt.getDate() + (nextStep.delay_days ?? 1));
        await supabase.from('crm_action_plan_enrollments').update({ current_step: 1, next_step_at: nextAt.toISOString() }).eq('id', enrollment.id);
      } else {
        await supabase.from('crm_action_plan_enrollments').update({ active: false, completed_at: now, next_step_at: null }).eq('id', enrollment.id);
      }

      enrolled++;
    }

    return NextResponse.json({ enrolled });
  } catch (err) {
    console.error('[stage-trigger]', err);
    return NextResponse.json({ enrolled: 0 });
  }
}
