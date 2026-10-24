import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { Resend } from 'resend';
import { resolveSignature, withSignature } from '@/lib/agent-signature';
import { userRateLimit } from '@/lib/user-ratelimit';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  // The preview goes out from the brand domain, so it is throttled per user.
  const rl = await userRateLimit('action-plan-test', ctx.userId, 10, '10 m');
  if (!rl.success) return NextResponse.json({ error: 'Too many test sends. Try again in a few minutes.' }, { status: 429 });

  const { plan_id } = await req.json().catch(() => ({}));
  // agent_id is still accepted from older clients but ignored: the preview only ever goes to the caller.
  const agent_id = ctx.userId;
  if (!plan_id) return NextResponse.json({ error: 'plan_id and agent_id required' }, { status: 400 });

  const supabase = adminClient();

  if (!(await assertOwnsResource('crm_action_plans', String(plan_id), ctx))) return notFound('Plan not found');

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

  // Fetch the caller's profile to use as both sender and recipient for the test
  const { data: agent } = await supabase.from('crm_profiles').select('*').eq('id', agent_id).single();
  if (!agent?.email) return NextResponse.json({ error: 'Agent email not found' }, { status: 400 });

  // Fill merge fields with the agent's own info as sample data
  const BASE_URL = 'https://www.fairoaksrealtygroup.com';
  const isCommercial = plan.business_unit === 'commercial';
  const agentEmail = isCommercial ? 'info@crecotx.com' : (agent.email || 'info@fairoaksrealtygroup.com');
  const agentPhone = isCommercial ? '210-817-3443' : (agent.phone || '210-390-9997');
  const brokerage  = isCommercial ? 'CRECO Commercial Real Estate Company' : 'Fair Oaks Realty Group';
  const fromAddr   = isCommercial ? 'CRECO <zack@crecotx.com>' : 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>';
  // Commercial test-sends go from crecotx.com — use the commercial Resend key (the
  // account with that domain verified), matching the real send path.
  const resend = new Resend(((isCommercial ? process.env.RESEND_API_KEY_COMMERCIAL : process.env.RESEND_API_KEY) ?? '').replace(/[\r\n\s]+$/, ''));

  // `esc` HTML-escapes the merge values (body); the subject is plain text and is not escaped.
  function fill(template: string, esc = false) {
    const v = (s: string) => (esc ? escapeHtml(s) : s);
    return template
      .replaceAll('{{first_name}}', v(agent.first_name || 'John'))
      .replaceAll('{{last_name}}', v(agent.last_name || 'Doe'))
      .replaceAll('{{full_name}}', v(`${agent.first_name} ${agent.last_name}`.trim() || 'John Doe'))
      .replaceAll('{{email}}', v(agent.email))
      .replaceAll('{{client_type}}', isCommercial ? 'Tenant' : 'Buyer')
      .replaceAll('{{agent_name}}', v(`${agent.first_name} ${agent.last_name}`.trim()))
      .replaceAll('{{agent_email}}', v(agentEmail))
      .replaceAll('{{agent_phone}}', v(agentPhone))
      .replaceAll('{{brokerage}}', brokerage)
      .replaceAll('{{unsubscribe_url}}', `${BASE_URL}/api/campaigns/unsubscribe?token=TEST_TOKEN`);
  }

  const subject = fill(step.subject || `[TEST] Action Plan: ${plan.name} — Step 1`).replace(/[\r\n]+/g, ' ');
  const body = withSignature(fill(step.body || '', true), await resolveSignature(supabase, { fromEmail: plan.from_email, agentId: agent_id }));

  const result = await resend.emails.send({
    from: fromAddr,
    to: agent.email,
    subject: `[TEST PREVIEW] ${subject}`,
    html: `
      <div style="background:#fef3c7;border:2px dashed #f59e0b;border-radius:8px;padding:12px 18px;margin-bottom:24px;font-family:sans-serif">
        <strong>⚠️ This is a test preview</strong> of Action Plan "<strong>${escapeHtml(String(plan.name ?? ''))}</strong>" — Step 1.
        Merge fields are filled with your own profile info as sample data.
      </div>
      ${body}
    `,
  });

  if (result.error) { console.error('[action-plans/test] Send error:', result.error); return NextResponse.json({ error: 'Failed to send test email.' }, { status: 500 }); }
  return NextResponse.json({ sent: true, to: agent.email });
}
