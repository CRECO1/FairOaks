import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { decryptToken, encryptToken } from '@/lib/token-crypto';

async function getValidToken(conn: { id: string; access_token: string; refresh_token: string; expires_at: string }): Promise<string | null> {
  if (Date.now() < new Date(conn.expires_at).getTime() - 120_000) return decryptToken(conn.access_token);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: decryptToken(conn.refresh_token), grant_type: 'refresh_token' }),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) return null;
  const supabase = adminClient();
  await supabase.from('gmail_connections').update({ access_token: encryptToken(data.access_token), expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('id', conn.id);
  return data.access_token;
}

export async function GET(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  const contactEmail = req.nextUrl.searchParams.get('contactEmail');
  if (!contactEmail) return NextResponse.json({ threads: [] });

  const supabase = adminClient();
  const { data: conn } = await supabase.from('gmail_connections').select('*').eq('user_id', caller.id).limit(1).maybeSingle();
  if (!conn) return NextResponse.json({ threads: [], error: 'No Gmail connected' });

  const token = await getValidToken(conn as any);
  if (!token) return NextResponse.json({ threads: [], error: 'Token refresh failed' });

  // Search for emails to or from this contact
  const query = `(from:${contactEmail} OR to:${contactEmail})`;
  const searchRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=20`, { headers: { Authorization: `Bearer ${token}` } });
  if (!searchRes.ok) return NextResponse.json({ threads: [] });
  const searchData = await searchRes.json();
  const threadIds: string[] = (searchData.threads ?? []).map((t: { id: string }) => t.id);
  if (!threadIds.length) return NextResponse.json({ threads: [] });

  // Fetch thread metadata
  const threads = await Promise.all(threadIds.slice(0, 10).map(async (tid) => {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${tid}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const t = await r.json();
    const firstMsg = t.messages?.[0];
    const lastMsg = t.messages?.[t.messages.length - 1];
    const getHeader = (msg: any, name: string) => msg?.payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
    return {
      id: t.id,
      subject: getHeader(firstMsg, 'subject') || '(no subject)',
      from: getHeader(lastMsg, 'from'),
      date: getHeader(lastMsg, 'date'),
      messageCount: t.messages?.length ?? 1,
      snippet: lastMsg?.snippet ?? '',
    };
  }));

  return NextResponse.json({ threads: threads.filter(Boolean) });
}
