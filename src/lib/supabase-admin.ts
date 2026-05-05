import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://bnqdzgypesoythpbeujk.supabase.co';
export const REDIRECT_URL = 'https://www.fairoaksrealtygroup.com/crm/setup';

export function adminClient() {
  return createClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
