import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { Resend } from 'resend';
import { getBrand, fromLine } from '@/lib/branding';

export async function POST(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { plan_id, agent_id } = await req.json();
  if (!plan_id || !agent_id) return NextResponse.json({ error: 'plan_id and agent_id required' }, { status: 400 });

  const supabase = adminClient();
  const resend = new Resend(process.env.RESEND_API_KEY!);

  // Fetch plan + first step
  const { data: plan } = await supabase
    .from('crm_action_plans')
    .select('*, steps:crm_action_plan_steps(*)')
    .eq('id', plan_id)
    .single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const steps = (plan.steps ?? []).sort(
    (a: { step_order: number }, b: { step_order: number }) => a.step_order - b.step_order
  );
  const step = steps[0];
  if (!step) return NextResponse.json({ error: 'No steps in this plan' }, { status: 400 });
  if (step.type !== 'email') return NextResponse.json({ error: 'First step is not an email — nothing to preview' }, { status: 400 });

  // Fetch the agent's profile to use as both sender and recipient for the test
  const { data: agent } = await supabase.from('crm_profiles').select('*').eq('id', agent_id).single();
  if (!agent?.email) return NextResponse.json({ error: 'Agent email not found' }, { status: 400 });

  // Fill merge fields with the agent's own info as sample data
  const brand = getBrand(plan.business_unit);
  const BASE_URL = brand.unsubscribeBaseUrl;
  const isCommercial = plan.business_unit === 'commercial';
  const agentEmail = isCommercial ? brand.fromEmail : (agent.email || brand.fromEmail);
  const agentPhone = isCommercial ? brand.phone : (agent.phone || brand.phone);
  const brokerage  = brand.legalName;
  const fromAddr   = fromLine(plan.business_unit);

  function fill(template: string) {
    return template
      .replaceAll('{{first_name}}', agent.first_name || 'John')
      .replaceAll('{{last_name}}', agent.last_name || 'Doe')
      .replaceAll('{{full_name}}', `${agent.first_name} ${agent.last_name}`.trim() || 'John Doe')
      .replaceAll('{{email}}', agent.email)
      .replaceAll('{{client_type}}', isCommercial ? 'Tenant' : 'Buyer')
      .replaceAll('{{agent_name}}', `${agent.first_name} ${agent.last_name}`.trim())
      .replaceAll('{{agent_email}}', agentEmail)
      .replaceAll('{{agent_phone}}', agentPhone)
      .replaceAll('{{brokerage}}', brokerage)
      .replaceAll('{{unsubscribe_url}}', `${BASE_URL}/api/campaigns/unsubscribe?token=TEST_TOKEN`);
  }

  const subject = fill(step.subject || `[TEST] Action Plan: ${plan.name} — Step 1`);
  const body = fill(step.body || '');

  const result = await resend.emails.send({
    from: fromAddr,
    to: agent.email,
    subject: `[TEST PREVIEW] ${subject}`,
    html: `
      <div style="background:#fef3c7;border:2px dashed #f59e0b;border-radius:8px;padding:12px 18px;margin-bottom:24px;font-family:sans-serif">
        <strong>⚠️ This is a test preview</strong> of Action Plan "<strong>${plan.name}</strong>" — Step 1.
        Merge fields are filled with your own profile info as sample data.
      </div>
      ${body}
    `,
  });

  if (result.error) { console.error('[action-plans/test] Send error:', result.error); return NextResponse.json({ error: 'Failed to send test email.' }, { status: 500 }); }
  return NextResponse.json({ sent: true, to: agent.email });
}
