import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://www.fairoaksrealtygroup.com';

// Allowlist of trusted domains we will redirect to from tracked email links.
// Any URL not on this list falls back to the homepage.
const ALLOWED_HOSTS = new Set([
  'fairoaksrealtygroup.com',
  'www.fairoaksrealtygroup.com',
  'crecotx.com',
  'www.crecotx.com',
]);

function safeRedirectUrl(raw: string | null): string {
  if (!raw) return FALLBACK_URL;
  try {
    const decoded = decodeURIComponent(raw);
    const parsed = new URL(decoded);
    // Only allow https and approved hostnames
    if (parsed.protocol !== 'https:') return FALLBACK_URL;
    if (!ALLOWED_HOSTS.has(parsed.hostname)) return FALLBACK_URL;
    return parsed.toString();
  } catch {
    return FALLBACK_URL;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = safeRedirectUrl(req.nextUrl.searchParams.get('url'));
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    await supabase.from('email_tracking_events').insert({ tracking_id: id, event_type: 'click', url, ip: req.headers.get('x-forwarded-for') ?? '', user_agent: req.headers.get('user-agent') ?? '' });
  } catch {}
  return NextResponse.redirect(url);
}
