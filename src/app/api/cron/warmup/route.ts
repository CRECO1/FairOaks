import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/warmup
 *
 * Keeps a serverless instance and the Supabase connection pool warm so the first
 * real request after an idle spell doesn't pay a ~15-20s cold start (fresh Lambda
 * boot + a cold DB connection). Vercel pings this every few minutes; it does one
 * trivial, indexed query to exercise the DB path, then returns.
 *
 * Secured by CRON_SECRET, like every other cron. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const t0 = Date.now();
  try {
    // Head-only count: touches the DB + warms the pooled connection without
    // transferring any rows.
    await adminClient().from('crm_forms').select('id', { head: true, count: 'estimated' });
    // The voice bot's webhooks are their own functions; a caller shouldn't pay their cold
    // start mid-sentence. Unsigned POSTs bounce with 401 instantly, which is all we need.
    const origin = (process.env.VOICE_PUBLIC_ORIGIN || 'https://www.fairoaksrealtygroup.com').replace(/\/$/, '');
    await Promise.all(['/api/voice/inbound', '/api/voice/turn', '/api/voice/wait', '/api/voice/status'].map(p => fetch(`${origin}${p}`, { method: 'POST', cache: 'no-store' }).catch(() => null)));
  } catch (e) {
    // A warmup failure is never fatal — report it 200 so the cron isn't marked failed.
    return NextResponse.json({ ok: false, error: (e as Error).message, ms: Date.now() - t0 });
  }
  return NextResponse.json({ ok: true, ms: Date.now() - t0 });
}
