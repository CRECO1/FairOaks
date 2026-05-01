import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

export async function POST(req: NextRequest) {
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

  const steps = (plan.steps ?? []).sort((a: any, b: any) => a.step_order - b.step_order);
  const step = steps[0];
  if (!step) return NextResponse.json({ error: 'No steps in this plan' }, { status: 400 });
  if (step.type !== 'email') return NextResponse.json({ error: 'First step is not an email — nothing to preview' }, { status: 400 });

  // Fetch the agent's profile to use as both sender and recipient for the test
  const { data: agent } = await supabase.from('crm_profiles').select('*').eq('id', agent_id).single();
  if (!agent?.email) return NextResponse.json({ error: 'Agent email not found' }, { status: 400 });

  // Fill merge fields with the agent's own info as sample data
  const BASE_URL = 'https://www.fairoaksrealtygroup.com';
  function fill(template: string) {
    return template
      .replaceAll('{{first_name}}', agent.first_name || 'John')
      .replaceAll('{{last_name}}', agent.last_name || 'Doe')
      .replaceAll('{{full_name}}', `${agent.first_name} ${agent.last_name}`.trim() || 'John Doe')
      .replaceAll('{{email}}', agent.email)
      .replaceAll('{{client_type}}', 'Buyer')
      .replaceAll('{{agent_name}}', `${agent.first_name} ${agent.last_name}`.trim())
      .replaceAll('{{agent_email}}', agent.email)
      .replaceAll('{{agent_phone}}', agent.phone || '(210) 390-9997')
      .replaceAll('{{brokerage}}', 'Fair Oaks Realty Group')
      .replaceAll('{{unsubscribe_url}}', `${BASE_URL}/api/campaigns/unsubscribe?token=TEST_TOKEN`);
  }

  const subject = fill(step.subject || `[TEST] Action Plan: ${plan.name} — Step 1`);
  const body = fill(step.body || '');

  const result = await resend.emails.send({
    from: 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
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

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json({ sent: true, to: agent.email });
}
