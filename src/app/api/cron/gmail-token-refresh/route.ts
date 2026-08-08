/**
 * GET /api/cron/gmail-token-refresh
 *
 * Runs every 30 minutes. Proactively refreshes every Gmail connection whose
 * access_token expires within the next 45 minutes (Google tokens last 1 hour).
 * This keeps tokens perpetually fresh so users never hit an "expired" state
 * even if they haven't used the CRM in a while.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decryptToken, encryptToken } from '@/lib/token-crypto';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch all connections expiring within the next 45 minutes (or already expired)
  const cutoff = new Date(Date.now() + 45 * 60 * 1000).toISOString();

  const { data: connections, error } = await supabase
    .from('gmail_connections')
    .select('id, user_id, access_token, refresh_token, expires_at, gmail_email')
    .lt('expires_at', cutoff);

  if (error) {
    console.error('[gmail-token-refresh] Failed to fetch connections:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!connections?.length) {
    return NextResponse.json({ refreshed: 0, message: 'All tokens are fresh' });
  }

  let refreshed = 0;
  let failed = 0;

  for (const conn of connections) {
    try {
      if (!conn.refresh_token) {
        console.warn(`[gmail-token-refresh] No refresh_token for ${conn.gmail_email} — skipping`);
        continue;
      }

      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: decryptToken(conn.refresh_token),
          grant_type:    'refresh_token',
        }),
      });

      const data = await refreshRes.json();

      if (!refreshRes.ok || !data.access_token) {
        console.error(`[gmail-token-refresh] Failed for ${conn.gmail_email}:`, data.error, data.error_description);
        failed++;
        continue;
      }

      const newExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();

      await supabase
        .from('gmail_connections')
        .update({
          access_token: encryptToken(data.access_token),
          expires_at:   newExpiry,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', conn.id);

      refreshed++;
    } catch (e: unknown) {
      console.error(`[gmail-token-refresh] Exception for ${conn.gmail_email}:`, e instanceof Error ? e.message : String(e));
      failed++;
    }
  }

  return NextResponse.json({ refreshed, failed, total: connections.length });
}
