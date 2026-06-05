import { createClient } from '@supabase/supabase-js';

// Trim any accidental whitespace/newline from the env var (common Vercel paste issue)
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
export const REDIRECT_URL = 'https://www.fairoaksrealtygroup.com/crm/setup';

export function adminClient() {
  return createClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
