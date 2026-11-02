import { isAdminRole, type CrmContext } from '@/lib/crm-auth';

/**
 * "Added as an agent on the deal": the owner, or listed in assigned_agent_ids. Admins and the super admin see every deal
 * in their workspace; an ordinary agent sees only deals they are on. This is the same rule the database applies to the
 * crm_deals table itself (deals_scoped_select), for server routes that read deal data with the service key.
 */
export function onDeal(ctx: Pick<CrmContext, 'role' | 'userId'>, d: { agent_id?: string | null; assigned_agent_ids?: string[] | null }): boolean {
  return isAdminRole(ctx.role) || d.agent_id === ctx.userId || (d.assigned_agent_ids ?? []).includes(ctx.userId);
}
