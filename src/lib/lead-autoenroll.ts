import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Enroll a brand-new website lead into its brand's "new contact" action plan.
 *
 * OFF until LEAD_AUTOENROLL_UNITS names a business unit ("commercial",
 * "residential", or both, comma-separated). Unset — the default — means website
 * leads are never enrolled and no client email is ever sent by this path, so
 * the copy can be reviewed before anything goes out.
 *
 * When enabled it only writes the enrollment row; the existing action-plan cron
 * sends step 1 on its next run. Nothing is emailed from the request itself.
 */
export async function maybeAutoEnrollLead(supabase: SupabaseClient, opts: {
  clientId: string;
  agentId: string | null;
  businessUnit: 'commercial' | 'residential';
}): Promise<{ enrolled: boolean; reason?: string }> {
  const enabled = (process.env.LEAD_AUTOENROLL_UNITS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!enabled.includes(opts.businessUnit)) return { enrolled: false, reason: 'disabled' };

  const { data: client } = await supabase
    .from('crm_clients')
    .select('id, email, unsubscribed_at')
    .eq('id', opts.clientId)
    .maybeSingle();
  if (!client?.email || client.unsubscribed_at) return { enrolled: false, reason: 'no email or unsubscribed' };

  // The generic welcome plan for this brand: a plan with a trigger_value is
  // scoped to one property, and is left to the import path that matches it.
  const { data: plans } = await supabase
    .from('crm_action_plans')
    .select('id, name, trigger_value')
    .eq('trigger_type', 'new_contact')
    .eq('status', 'active')
    .eq('business_unit', opts.businessUnit);
  const plan = (plans ?? []).find(p => !p.trigger_value);
  if (!plan) return { enrolled: false, reason: 'no generic new_contact plan' };

  const { data: existing } = await supabase
    .from('crm_action_plan_enrollments')
    .select('id')
    .eq('plan_id', plan.id)
    .eq('client_id', opts.clientId)
    .maybeSingle();
  if (existing) return { enrolled: false, reason: 'already enrolled' };

  const { data: firstStep } = await supabase
    .from('crm_action_plan_steps')
    .select('delay_days')
    .eq('plan_id', plan.id)
    .order('step_order')
    .limit(1)
    .maybeSingle();
  if (!firstStep) return { enrolled: false, reason: 'plan has no steps' };

  const nextStepAt = new Date(Date.now() + (firstStep.delay_days ?? 0) * 86_400_000).toISOString();
  const { error } = await supabase.from('crm_action_plan_enrollments').insert([{
    plan_id: plan.id,
    client_id: opts.clientId,
    agent_id: opts.agentId,
    current_step: 0,
    next_step_at: nextStepAt,
    active: true,
  }]);
  if (error) {
    console.error('[lead-autoenroll] enrollment failed:', error.message);
    return { enrolled: false, reason: error.message };
  }
  return { enrolled: true };
}
