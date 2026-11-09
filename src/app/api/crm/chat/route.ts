import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { sendPushToProfiles } from '@/lib/push';
import { dmOther, MAX_BODY } from '@/lib/team-chat';
import { roomAllowed, cleanAttachments, resolveLinks } from '@/lib/team-chat-server';

export const dynamic = 'force-dynamic';

// TeamChat. Reads and writes go through here (the tables have no browser access). A room is either 'team' (everyone in the
// caller's workspace) or a direct message that only its two people can open.

// GET ?room=…&after=<iso>  → messages (oldest first). Opening a room marks it read.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx || !ctx.businessUnit) return unauthorized();
  const db = adminClient();
  const room = req.nextUrl.searchParams.get('room') ?? '';
  const after = req.nextUrl.searchParams.get('after');
  if (!(await roomAllowed(ctx, room)).ok) return NextResponse.json({ error: 'No such conversation' }, { status: 404 });
  let q = db.from('crm_chat_messages').select('id, sender_id, body, created_at, attachments, links').eq('business_unit', ctx.businessUnit).eq('room', room);
  q = after && !Number.isNaN(Date.parse(after)) ? q.gt('created_at', after).order('created_at', { ascending: true }).limit(200) : q.order('created_at', { ascending: false }).limit(100);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'Could not load messages' }, { status: 500 });
  const messages = after ? (data ?? []) : (data ?? []).reverse();
  const { data: prior } = after ? { data: null } : await db.from('crm_chat_reads').select('last_read_at').eq('user_id', ctx.userId).eq('room', room).maybeSingle();
  await db.from('crm_chat_reads').upsert({ user_id: ctx.userId, room, last_read_at: new Date().toISOString() });
  // In a direct message, when the other person last opened it (drives the "Seen" marker under your last message).
  const other = dmOther(room, ctx.userId);
  const { data: theirs } = other ? await db.from('crm_chat_reads').select('last_read_at').eq('user_id', other).eq('room', room).maybeSingle() : { data: null };
  return NextResponse.json({ messages, otherRead: (theirs?.last_read_at as string | undefined) ?? null, ...(after ? {} : { lastRead: (prior?.last_read_at as string | undefined) ?? null }) });
}

// POST { room, body }  → send. A DM alerts the other person's phone; in the team room only people who are @named get one.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx || !ctx.businessUnit) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { room?: unknown; body?: unknown; attachments?: unknown; links?: unknown };
  const room = typeof body.room === 'string' ? body.room : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (text.length > MAX_BODY) return NextResponse.json({ error: `Message can be at most ${MAX_BODY} characters` }, { status: 400 });
  const db = adminClient();
  const { ok, other } = await roomAllowed(ctx, room);
  if (!ok) return NextResponse.json({ error: 'No such conversation' }, { status: 404 });
  const attachments = cleanAttachments(body.attachments, ctx, room);
  const links = await resolveLinks(req, body.links, ctx);
  if (!text && !attachments.length && !links.length) return NextResponse.json({ error: 'Write a message or add a file or link' }, { status: 400 });
  const { data: msg, error } = await db.from('crm_chat_messages').insert({ business_unit: ctx.businessUnit, room, sender_id: ctx.userId, body: text, attachments, links }).select('id, sender_id, body, created_at, attachments, links').single();
  if (error || !msg) return NextResponse.json({ error: 'Could not send' }, { status: 500 });
  await db.from('crm_chat_reads').upsert({ user_id: ctx.userId, room, last_read_at: msg.created_at });

  try {   // phone alerts: best effort, never fails the send
    const { data: me } = await db.from('crm_profiles').select('first_name, last_name').eq('id', ctx.userId).maybeSingle();
    const who = [me?.first_name, me?.last_name].filter(Boolean).join(' ') || 'A teammate';
    let to: string[] = other ? [other] : [];
    if (room === 'team') {
      const { data: mates } = await db.from('crm_profiles').select('id, first_name').eq('business_unit', ctx.businessUnit).neq('id', ctx.userId);
      to = (mates ?? []).filter(p => p.first_name && new RegExp(`@${String(p.first_name).replace(/[^A-Za-z]/g, '')}\\b`, 'i').test(text)).map(p => p.id as string);
    }
    if (to.length) await sendPushToProfiles(to, { title: room === 'team' ? `${who} in Team chat` : who, body: (text || (attachments.length ? `📎 ${attachments[0].name}` : links[0]?.label ?? '')).slice(0, 140), url: '/crm/commercial#teamchat', tag: `chat-${room}`, category: 'mentions', businessUnit: ctx.businessUnit }, { db });
  } catch (e) { console.error('[chat] push failed (message was sent):', e); }
  return NextResponse.json({ message: msg });
}

// DELETE ?id=…  → remove one of YOUR OWN messages (in a conversation you are allowed to open).
export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx || !ctx.businessUnit) return unauthorized();
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  const { error } = await adminClient().from('crm_chat_messages').delete().eq('id', id).eq('sender_id', ctx.userId).eq('business_unit', ctx.businessUnit);
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
