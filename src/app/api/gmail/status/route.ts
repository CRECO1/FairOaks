import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCrmUser, unauthorized, forbidden } from '@/lib/crm-auth';
import { dbError } from '@/lib/crm-auth';
import { gmailRefreshKey } from '@/lib/broker-ingest/gmail';

function makeClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ connected: false, accounts: [] });

  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  if (caller.id !== userId) return forbidden('Cannot access another user\'s Gmail connection');

  const supabase = makeClient();
  const { data, error } = await supabase
    .from('gmail_connections')
    .select('id, gmail_email')
    .eq('user_id', userId);

  if (error) {
    console.error('[gmail/status GET]', error.message);
    return NextResponse.json({ connected: false, accounts: [] });
  }

  if (data && data.length > 0) {
    // Token health, as recorded by the refresh cron / crawl. A connection whose refresh
    // token Google rejects is still a row — "Connected" over it was a false green.
    const { data: health } = await supabase.from('crm_integration_status')
      .select('id, last_status').in('id', data.map((r) => gmailRefreshKey(r.id)));
    const bad = new Set((health ?? []).filter((h) => h.last_status === 'error').map((h) => h.id));
    return NextResponse.json({
      connected: true,
      email: data[0].gmail_email,
      accounts: data.map((r) => ({ id: r.id, email: r.gmail_email, needsReconnect: bad.has(gmailRefreshKey(r.id)) })),
    });
  }
  return NextResponse.json({ connected: false, accounts: [] });
}

// DELETE — disconnect a specific account by id
export async function DELETE(req: NextRequest) {
  const { connectionId, userId } = await req.json();
  if (!connectionId || !userId) {
    return NextResponse.json({ error: 'connectionId and userId required' }, { status: 400 });
  }

  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  if (caller.id !== userId) return forbidden('Cannot access another user\'s Gmail connection');

  const supabase = makeClient();
  const { error } = await supabase
    .from('gmail_connections')
    .delete()
    .eq('id', connectionId)
    .eq('user_id', userId);

  if (error) {
    console.error('[gmail/status DELETE]', error.message);
    return dbError('gmail/status DELETE', error);
  }

  return NextResponse.json({ success: true });
}
