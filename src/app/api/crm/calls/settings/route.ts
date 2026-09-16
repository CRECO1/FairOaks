import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, forbidden, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { createSubscription, deleteSubscription, ensureForwardingNumber, getAccount, getPlanInfo, listSubscriptions, talkrouteConfigured, TalkrouteError } from '@/lib/talkroute';
import { twilioConfigured, voiceOrigin } from '@/lib/twilio';
import { loadSettings } from '@/lib/voicebot';
import { toE164 } from '@/lib/phone';
import { fetchListings, fetchOurHomes, listingSourceConfigured } from '@/lib/listing-knowledge';

export const maxDuration = 30;

// Voice bot settings + "is everything plugged in" status for the Calling Log's setup panel.

function unitFor(req: NextRequest, ctx: { role: string | null; businessUnit: string | null }): string {
  if (isAdminRole(ctx.role)) return req.nextUrl.searchParams.get('business_unit') ?? ctx.businessUnit ?? 'commercial';
  return ctx.businessUnit ?? 'commercial';
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const unit = unitFor(req, ctx);
  const settings = await loadSettings(adminClient(), unit);
  const origin = voiceOrigin();
  const webhookSecret = process.env.TALKROUTE_WEBHOOK_SECRET;
  // What the bot can talk about: the live website listings for this unit.
  const titles: string[] = unit === 'residential'
    ? (await fetchOurHomes()).map(h => `${h.address}, ${h.city}`)
    : listingSourceConfigured(unit) ? (await fetchListings(unit)).map(l => l.title) : [];
  return NextResponse.json({
    settings,
    listings: { configured: listingSourceConfigured(unit), count: titles.length, titles: titles.slice(0, 12), mls_lookup: unit === 'residential' },
    connection: {
      talkroute: talkrouteConfigured(),
      talkroute_webhook_secret: !!webhookSecret,
      twilio: twilioConfigured(),
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      // What to paste into the Twilio console for the bot number.
      twilio_voice_url: `${origin}/api/voice/inbound`,
      twilio_status_url: `${origin}/api/voice/status`,
      // What Talkroute should push to (the secret is only shown to admins).
      talkroute_webhook_url: isAdminRole(ctx.role) && webhookSecret ? `${origin}/api/webhooks/talkroute?key=${webhookSecret}` : `${origin}/api/webhooks/talkroute?key=…`,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return forbidden();
  const unit = unitFor(req, ctx);
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { business_unit: unit, updated_at: new Date().toISOString() };
  if (b.enabled !== undefined) patch.enabled = !!b.enabled;
  if (b.bot_name !== undefined) patch.bot_name = String(b.bot_name || 'Ava').slice(0, 40);
  if (b.company_name !== undefined) patch.company_name = b.company_name ? String(b.company_name).slice(0, 120) : null;
  if (b.greeting !== undefined) patch.greeting = b.greeting ? String(b.greeting).slice(0, 600) : null;
  if (b.instructions !== undefined) patch.instructions = b.instructions ? String(b.instructions).slice(0, 4000) : null;
  if (b.transfer_number !== undefined) patch.transfer_number = toE164(b.transfer_number);
  if (b.twilio_number !== undefined) patch.twilio_number = toE164(b.twilio_number);
  if (b.notify_emails !== undefined) patch.notify_emails = String(Array.isArray(b.notify_emails) ? b.notify_emails.join(',') : b.notify_emails).split(/[,\s]+/).map((s: string) => s.trim()).filter((s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)).slice(0, 10);
  if (b.talkroute_numbers !== undefined) patch.talkroute_numbers = String(Array.isArray(b.talkroute_numbers) ? b.talkroute_numbers.join(',') : b.talkroute_numbers).split(/[,\s]+/).map((s: string) => toE164(s)).filter(Boolean).slice(0, 20);
  const { data, error } = await adminClient().from('crm_voicebot_settings').upsert(patch, { onConflict: 'business_unit' }).select('*').single();
  if (error) return dbError('api/crm/calls/settings PATCH', error);
  return NextResponse.json({ settings: data });
}

// POST /api/crm/calls/settings  { action: 'test_talkroute' | 'register_webhooks' }
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!talkrouteConfigured()) return NextResponse.json({ error: 'Add TALKROUTE_API_KEY to the Vercel environment first.' }, { status: 503 });
  try {
    if (b.action === 'test_talkroute') {
      const acct = await getAccount();
      return NextResponse.json({ ok: true, account: { name: acct.name ?? acct.companyName ?? acct.company ?? null, id: acct.id ?? null } });
    }
    if (b.action === 'diagnose') {
      // Which Talkroute endpoints the plan actually permits — 402 means "not on your plan".
      return NextResponse.json({ ok: true, ...(await getPlanInfo()) });
    }
    if (b.action === 'add_forwarding_number') {
      // Make the bot line a Talkroute forwarding destination so it can be picked in Hours / no-answer / menu routing.
      const settings = await loadSettings(adminClient(), unitFor(req, ctx));
      const number = toE164(b.number) || settings.twilio_number;
      if (!number) return NextResponse.json({ error: 'Set the bot line (Twilio number) first.' }, { status: 400 });
      const r = await ensureForwardingNumber(number, String(b.description || 'AI receptionist').slice(0, 40));
      return NextResponse.json({ ok: true, ...r });
    }
    if (b.action === 'register_webhooks') {
      const secret = process.env.TALKROUTE_WEBHOOK_SECRET;
      if (!secret) return NextResponse.json({ error: 'Set TALKROUTE_WEBHOOK_SECRET in Vercel first (any long random string).' }, { status: 503 });
      const hookUrl = `${voiceOrigin()}/api/webhooks/talkroute?key=${secret}`;
      const wanted: Array<'new_call_record' | 'new_voicemail' | 'call_completed' | 'new_text_message'> = ['new_call_record', 'new_voicemail', 'call_completed', 'new_text_message'];
      const existing = await listSubscriptions();
      // Replace stale hooks pointing at us with the current URL; leave anyone else's alone.
      for (const s of existing) if (s.id && s.hookUrl.includes('/api/webhooks/talkroute') && s.hookUrl !== hookUrl) await deleteSubscription(s.id);
      const have = new Set(existing.filter(s => s.hookUrl === hookUrl).map(s => s.type));
      const created: string[] = [];
      for (const type of wanted) if (!have.has(type)) { await createSubscription({ hookUrl, type }); created.push(type); }
      return NextResponse.json({ ok: true, created, already: wanted.filter(t => have.has(t)) });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    console.error('[api/crm/calls/settings POST]', e);
    const msg = e instanceof TalkrouteError ? (e.status === 401 || e.status === 403 ? 'Talkroute rejected the API key.' : e.message) : 'Talkroute request failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
