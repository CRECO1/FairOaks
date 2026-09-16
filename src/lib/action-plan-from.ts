// Resolve the From header for an action-plan email.
//
// A plan may send as a specific person (from_name / from_email on crm_action_plans)
// instead of the brand address — e.g. a broker's own name and address. We honor that
// override ONLY when the address is on the business unit's own verified Resend domain,
// so a stray or misconfigured value can never make Resend reject the send. In every
// other case the caller's brand fallback is used, unchanged.
export function resolveActionPlanFrom(
  businessUnit: string | undefined,
  fromName: string | null | undefined,
  fromEmail: string | null | undefined,
  brandFallback: string,
): string {
  const domain = businessUnit === 'commercial' ? 'crecotx.com' : 'fairoaksrealtygroup.com';
  const email = (fromEmail || '').trim().toLowerCase();
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.endsWith('@' + domain);
  if (!valid) return brandFallback;
  const name = (fromName || '').replace(/[<>\r\n"]/g, '').trim(); // keep the From header well-formed
  return name ? `${name} <${email}>` : email;
}
