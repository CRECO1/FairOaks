import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET() {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const supabase = adminClient();

  const { data, error } = await supabase
    .from('social_connections')
    .select('*')
    .eq('agent_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  return NextResponse.json({ accounts: data ?? [] });
}

// Manual connection — for platforms (e.g. Instagram) that can't be auto-discovered via OAuth
export async function POST(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const { platform, account_name, page_id } = await req.json();
  if (!platform || !account_name) {
    return NextResponse.json({ error: 'platform and account_name required' }, { status: 400 });
  }

  const supabase = adminClient();
  const handle = account_name.replace(/^@/, '').trim();

  // Reuse the page access token from any connected Facebook page (same page_id if provided)
  let accessToken: string | null = null;
  if (page_id) {
    const { data: fbConn } = await supabase
      .from('social_connections')
      .select('access_token')
      .eq('agent_id', user.id)
      .eq('platform', 'facebook')
      .eq('page_id', page_id)
      .maybeSingle();
    accessToken = fbConn?.access_token ?? null;
  }

  const { error } = await supabase
    .from('social_connections')
    .upsert(
      {
        agent_id: user.id,
        platform,
        platform_account_id: handle,
        account_name: handle,
        access_token: accessToken,
        page_id: page_id ?? null,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'agent_id,platform,platform_account_id' }
    );

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { connection_id } = body;

  if (!connection_id) {
    return NextResponse.json({ error: 'connection_id required' }, { status: 400 });
  }

  const supabase = adminClient();

  const { error } = await supabase
    .from('social_connections')
    .update({ is_active: false })
    .eq('id', connection_id)
    .eq('agent_id', user.id);

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  return NextResponse.json({ success: true });
}
