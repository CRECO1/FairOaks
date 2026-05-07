import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized, forbidden } from '@/lib/crm-auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ connected: false, accounts: [] });

  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  if (caller.id !== userId) return forbidden('Cannot access another user\'s Gmail connection');

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}&select=id,gmail_email`,
    { headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
  );

  const data = await res.json();
  if (data && data.length > 0) {
    return NextResponse.json({
      connected: true,
      email: data[0].gmail_email, // backward compat
      accounts: data.map((r: any) => ({ id: r.id, email: r.gmail_email })),
    });
  }
  return NextResponse.json({ connected: false, accounts: [] });
}

// DELETE — disconnect a specific account by id
export async function DELETE(req: NextRequest) {
  const { connectionId, userId } = await req.json();
  if (!connectionId || !userId) return NextResponse.json({ error: 'connectionId and userId required' }, { status: 400 });

  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  if (caller.id !== userId) return forbidden('Cannot access another user\'s Gmail connection');

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  await fetch(
    `${SUPABASE_URL}/rest/v1/gmail_connections?id=eq.${connectionId}&user_id=eq.${userId}`,
    {
      method: 'DELETE',
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
    }
  );

  return NextResponse.json({ success: true });
}
