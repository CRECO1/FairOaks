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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ accounts: data ?? [] });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
