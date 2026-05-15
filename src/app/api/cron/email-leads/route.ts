import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Require CRON_SECRET — same pattern as all other cron routes
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.fairoaksrealtygroup.com';
  const syncSecret = process.env.INTERNAL_SYNC_SECRET ?? '';
  const res = await fetch(`${base}/api/email-leads/sync`, {
    method: 'POST',
    headers: { 'x-internal-key': syncSecret },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json({ ok: res.ok, ...data });
}
