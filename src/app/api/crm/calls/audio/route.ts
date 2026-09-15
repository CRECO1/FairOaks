import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { fetchRecording, twilioConfigured } from '@/lib/twilio';
import { voicemailAudioUrl, talkrouteConfigured } from '@/lib/talkroute';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crm/calls/audio?id=<call id>
 * Streams a call's recording to the CRM without exposing provider credentials or
 * signed links (and so the browser can fetch it with its Bearer token and play it):
 *   twilio:<RecordingSid>  → fetched with our Twilio auth
 *   Talkroute voicemail    → a fresh short-lived S3 link, fetched server-side
 *   Talkroute call record  → the signed link from the last sync (may have expired → 410)
 */
async function pipe(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, { ...init, cache: 'no-store' });
  if (!r.ok || !r.body) return NextResponse.json({ error: 'Recording unavailable' }, { status: r.status === 403 || r.status === 404 ? 410 : 502 });
  const type = r.headers.get('content-type') || 'audio/mpeg';
  return new Response(r.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' } });
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { data: call } = await adminClient().from('crm_call_log').select('id, business_unit, source, kind, external_id, recording_url').eq('id', id).maybeSingle();
  if (!call || (!isAdminRole(ctx.role) && call.business_unit !== ctx.businessUnit)) return notFound('Call not found');

  if (call.recording_url?.startsWith('twilio:')) {
    if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
    const r = await fetchRecording(call.recording_url.slice(7));
    if (!r.ok || !r.body) return NextResponse.json({ error: 'Recording unavailable' }, { status: 502 });
    return new Response(r.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' } });
  }
  if (call.source === 'talkroute' && call.kind === 'voicemail' && call.external_id?.startsWith('vm:') && talkrouteConfigured()) {
    try {
      const url = await voicemailAudioUrl(call.external_id.slice(3));
      if (url) return pipe(url);
    } catch (e) { console.warn('[calls/audio] voicemail url', e); }
  }
  if (call.recording_url && /^https?:\/\//.test(call.recording_url)) return pipe(call.recording_url);
  return NextResponse.json({ error: 'No recording for this call' }, { status: 410 });
}
