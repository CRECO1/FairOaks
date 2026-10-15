import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { pruneOld, fitForSend, STORE_LIMIT_CHARS, PENDING_KEEP_MS, type ChatMsg } from '@/lib/copilot-chat';

export const runtime = 'nodejs';

// The Copilot chat log, one row per agent, so a conversation follows them from phone to desktop.
// GET prunes anything older than 24h before returning it. The row is only ever the caller's own:
// the key is the authenticated user id, never something the client names.

const TABLE = 'crm_copilot_chats';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const db = adminClient();
  const { data } = await db.from(TABLE).select('messages, stamps, pending, pending_at, updated_at').eq('user_id', ctx.userId).maybeSingle();
  if (!data) return NextResponse.json({ messages: [], stamps: [], pending: [], updatedAt: null });
  const msgs = (Array.isArray(data.messages) ? data.messages : []) as ChatMsg[];
  const stamps = (Array.isArray(data.stamps) ? data.stamps : []) as number[];
  const pruned = pruneOld(msgs, stamps);
  if (pruned.messages.length !== msgs.length) {
    if (!pruned.messages.length) await db.from(TABLE).delete().eq('user_id', ctx.userId);
    else await db.from(TABLE).update({ messages: pruned.messages, stamps: pruned.stamps }).eq('user_id', ctx.userId);
  }
  const pendingAt = data.pending_at ? Date.parse(data.pending_at as string) : 0;
  const pendingFresh = Array.isArray(data.pending) && data.pending.length && pendingAt && Date.now() - pendingAt < PENDING_KEEP_MS;
  return NextResponse.json({
    messages: pruned.messages, stamps: pruned.stamps,
    pending: pendingFresh ? data.pending : [], pendingAt: pendingFresh ? pendingAt : null,
    updatedAt: pruned.messages.length ? (data.updated_at as string) : null,
  });
}

export async function PUT(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => null) as { messages?: unknown; stamps?: unknown; pending?: unknown; pendingAt?: unknown } | null;
  if (!body || !Array.isArray(body.messages) || !Array.isArray(body.stamps)) return NextResponse.json({ error: 'messages and stamps required' }, { status: 400 });
  let messages = body.messages as ChatMsg[];
  let stamps = (body.stamps as unknown[]).map(n => Number(n) || Date.now());
  const shape = (m: unknown) => !!m && typeof m === 'object' && ((m as ChatMsg).role === 'user' || (m as ChatMsg).role === 'assistant')
    && (typeof (m as ChatMsg).content === 'string' || Array.isArray((m as ChatMsg).content));
  if (!messages.every(shape)) return NextResponse.json({ error: 'bad message shape' }, { status: 400 });
  if (messages.length > 500) return NextResponse.json({ error: 'too many messages' }, { status: 413 });
  const pruned = pruneOld(messages, stamps);
  messages = pruned.messages; stamps = pruned.stamps;
  if (JSON.stringify(messages).length > STORE_LIMIT_CHARS) {
    // Too big to keep whole: keep the most recent exchanges.
    const fit = fitForSend(messages);
    stamps = stamps.slice(messages.length - fit.length);
    messages = fit;
  }
  const db = adminClient();
  if (!messages.length) { await db.from(TABLE).delete().eq('user_id', ctx.userId); return NextResponse.json({ ok: true, updatedAt: null }); }
  // Only a plausible approval list is stored, and only its text — the ticket itself is what authorises it.
  const pending = Array.isArray(body.pending)
    ? (body.pending as { id?: unknown; name?: unknown; summary?: unknown }[]).slice(0, 5)
        .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.summary === 'string')
        .map(p => ({ id: p.id, name: p.name, summary: String(p.summary).slice(0, 2000) }))
    : [];
  const pendingAt = pending.length && Number(body.pendingAt) ? new Date(Number(body.pendingAt)).toISOString() : null;
  const updatedAt = new Date().toISOString();
  const { error } = await db.from(TABLE).upsert({
    user_id: ctx.userId, messages, stamps, pending: pending.length ? pending : null, pending_at: pendingAt, updated_at: updatedAt,
  }, { onConflict: 'user_id' });
  if (error) { console.error('[assistant/chat] save', error.message); return NextResponse.json({ error: 'Could not save the chat' }, { status: 500 }); }
  return NextResponse.json({ ok: true, updatedAt });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  await adminClient().from(TABLE).delete().eq('user_id', ctx.userId);
  return NextResponse.json({ ok: true });
}
