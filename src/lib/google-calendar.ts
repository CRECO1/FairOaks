import { SUPABASE_URL } from '@/lib/supabase-admin';
import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { safeJson } from '@/lib/safe-json';

type GmailConn = { id: string; access_token: string; refresh_token: string; expires_at: string; gmail_email: string };

/** A working Google access token for this agent's connected account, or why there isn't one. */
export async function calendarAccessToken(userId: string): Promise<{ token: string } | { error: 'none' | 'refresh' }> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}&limit=1`, { headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` } });
  const conns = await safeJson<GmailConn[]>(res, 'google-calendar connections');
  if (!Array.isArray(conns) || !conns.length) return { error: 'none' };
  const conn = conns[0];
  if (Date.now() < new Date(conn.expires_at).getTime() - 120_000) return { token: decryptToken(conn.access_token) };
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: decryptToken(conn.refresh_token), grant_type: 'refresh_token' }),
  });
  const refreshed = await safeJson<{ access_token?: string; expires_in?: number }>(refreshRes, 'google-calendar refresh');
  if (!refreshed?.access_token) return { error: 'refresh' };
  await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?id=eq.${conn.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` },
    body: JSON.stringify({ access_token: encryptToken(refreshed.access_token), expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString() }),
  });
  return { token: refreshed.access_token };
}
