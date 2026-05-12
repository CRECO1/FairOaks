import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = req.nextUrl.searchParams.get('url') ?? 'https://www.fairoaksrealtygroup.com';
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    await supabase.from('email_tracking_events').insert({ tracking_id: id, event_type: 'click', url, ip: req.headers.get('x-forwarded-for') ?? '', user_agent: req.headers.get('user-agent') ?? '' });
  } catch {}
  return NextResponse.redirect(decodeURIComponent(url));
}
