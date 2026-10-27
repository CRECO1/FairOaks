import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { cleanCategories, DEFAULT_PUSH_CATEGORIES, pushConfigured, sendPushToProfiles } from '@/lib/push';

export const dynamic = 'force-dynamic';

type Sub = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

// This device's phone-alert settings.
//   GET    ?endpoint=…                       → { configured, categories | null }
//   POST   { subscription, categories? }     → save/refresh this device (upsert by endpoint)
//   POST   { action: 'test' }                → send the signed-in agent a test alert on every device
//   PATCH  { endpoint, categories }          → change which alerts this device gets
//   DELETE { endpoint }                      → turn alerts off for this device
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const endpoint = req.nextUrl.searchParams.get('endpoint') ?? '';
  if (!endpoint) return NextResponse.json({ configured: pushConfigured(), categories: null });
  const { data } = await adminClient().from('crm_push_subscriptions').select('categories').eq('endpoint', endpoint).eq('profile_id', ctx.userId).maybeSingle();
  return NextResponse.json({ configured: pushConfigured(), categories: data?.categories ?? null });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!pushConfigured()) return NextResponse.json({ error: 'Phone alerts are not switched on yet.' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { subscription?: Sub; categories?: unknown; action?: string };

  if (body.action === 'test') {
    const r = await sendPushToProfiles([ctx.userId], { title: 'CRM phone alerts are working', body: 'You will get a ping like this for the things you chose.', url: '/crm', tag: 'crm-test', category: 'mentions' }, { ignoreCategory: true });
    return NextResponse.json({ ok: r.sent > 0, sent: r.sent, devices: r.devices });
  }

  const endpoint = typeof body.subscription?.endpoint === 'string' ? body.subscription.endpoint : '';
  const p256dh = typeof body.subscription?.keys?.p256dh === 'string' ? body.subscription.keys.p256dh : '';
  const auth = typeof body.subscription?.keys?.auth === 'string' ? body.subscription.keys.auth : '';
  if (!endpoint.startsWith('https://') || endpoint.length > 1000 || !p256dh || !auth) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });

  const db = adminClient();
  // Keep what this device already chose when it is simply re-registering.
  const { data: existing } = await db.from('crm_push_subscriptions').select('categories, profile_id').eq('endpoint', endpoint).maybeSingle();
  const requested = body.categories === undefined ? null : cleanCategories(body.categories);
  const categories = requested ?? (existing && existing.profile_id === ctx.userId ? existing.categories : DEFAULT_PUSH_CATEGORIES);

  const { error } = await db.from('crm_push_subscriptions').upsert(
    { profile_id: ctx.userId, endpoint, p256dh, auth, categories, user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300) },
    { onConflict: 'endpoint' },
  );
  if (error) return NextResponse.json({ error: error.message.includes('does not exist') ? 'Phone alerts are not set up in the database yet.' : 'Could not save this device.' }, { status: 500 });
  return NextResponse.json({ ok: true, categories });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string; categories?: unknown };
  if (!body.endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  const categories = cleanCategories(body.categories);
  await adminClient().from('crm_push_subscriptions').update({ categories }).eq('endpoint', body.endpoint).eq('profile_id', ctx.userId);
  return NextResponse.json({ ok: true, categories });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await adminClient().from('crm_push_subscriptions').delete().eq('endpoint', body.endpoint).eq('profile_id', ctx.userId);
  return NextResponse.json({ ok: true });
}
