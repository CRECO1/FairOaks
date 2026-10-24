import { isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

/**
 * True when `userId` is a real crm_profiles id the caller may assign work to: yourself, or (for
 * non-admins) a profile in the caller's own business_unit. Admins may assign to any profile.
 */
export async function validAssignee(userId: string, ctx: CrmContext): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return false;
  const { data } = await adminClient().from('crm_profiles').select('id, business_unit').eq('id', userId).maybeSingle();
  if (!data) return false;
  if (isAdminRole(ctx.role) || data.id === ctx.userId) return true;
  return data.business_unit === ctx.businessUnit;
}
