import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { adminClient } from '@/lib/supabase-admin';

// The caller's OWN connected Gmail mailbox(es) with a usable access token (refreshed when it is about to expire).
// Same rule as /api/gmail/sync: a teammate's mailbox is never read through someone else's request.

export type Mailbox = { accessToken: string; email: string | null };

export async function callerMailboxes(userId: string): Promise<Mailbox[]> {
  const db = adminClient();
  const { data: rows } = await db.from('gmail_connections').select('access_token, refresh_token, expires_at, email').eq('user_id', userId).order('created_at', { ascending: false });
  const out: Mailbox[] = [];
  for (const c of rows ?? []) {
    let accessToken = decryptToken(c.access_token as string);
    if (Date.now() >= new Date(c.expires_at as string).getTime() - 120_000) {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: decryptToken(c.refresh_token as string), grant_type: 'refresh_token',
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.access_token) continue;
      accessToken = j.access_token as string;
      await db.from('gmail_connections').update({
        access_token: encryptToken(accessToken), expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(), updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('email', (c.email as string) ?? '');
    }
    out.push({ accessToken, email: (c.email as string | null) ?? null });
  }
  return out;
}
