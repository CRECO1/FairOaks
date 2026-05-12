import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    // Only record the first open (unique opens)
    const { data: existing } = await supabase.from('email_tracking_events').select('id').eq('tracking_id', id).eq('event_type', 'open').maybeSingle();
    if (!existing) {
      await supabase.from('email_tracking_events').insert({ tracking_id: id, event_type: 'open', ip: req.headers.get('x-forwarded-for') ?? '', user_agent: req.headers.get('user-agent') ?? '' });
    }
  } catch {}
  return new NextResponse(PIXEL, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' } });
}
