import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const supabase = adminClient();
  const status = req.nextUrl.searchParams.get('status');
  const platform = req.nextUrl.searchParams.get('platform');
  const type = req.nextUrl.searchParams.get('type');

  let q = supabase
    .from('social_inbox')
    .select('*')
    .eq('agent_id', user.id)
    .order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);
  if (platform) q = q.eq('platform', platform);
  if (type) q = q.eq('type', type);

  const { data, error } = await q;
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  return NextResponse.json({ items: data ?? [] });
}
