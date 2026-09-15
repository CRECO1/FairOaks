import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { syncTalkroute, talkrouteConfigured, TalkrouteError } from '@/lib/talkroute';

export const maxDuration = 60;

// POST /api/crm/calls/sync?days=  — "Sync now" from the Calling Log.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!talkrouteConfigured()) return NextResponse.json({ error: 'Talkroute is not connected yet — add TALKROUTE_API_KEY in Vercel.' }, { status: 503 });
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? 2) || 2));
  try {
    const r = await syncTalkroute(adminClient(), { sinceHours: days * 24, maxPages: 10 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error('[api/crm/calls/sync]', e);
    const msg = e instanceof TalkrouteError ? (e.status === 401 || e.status === 403 ? 'Talkroute rejected the API key.' : e.message) : 'Sync failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
