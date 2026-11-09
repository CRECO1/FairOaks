import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { dmOther } from '@/lib/team-chat';

export const dynamic = 'force-dynamic';

// The conversation list: for 'team' and every DM the caller is in, the last message and how many are unread (messages from
// others after the caller last opened the room). `unread` is the total for the sidebar badge.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx || !ctx.businessUnit) return unauthorized();
  const db = adminClient();
  const me = ctx.userId.toLowerCase();
  const [{ data: reads }, { data: recent }] = await Promise.all([
    db.from('crm_chat_reads').select('room, last_read_at').eq('user_id', ctx.userId),
    db.from('crm_chat_messages').select('room, sender_id, body, created_at').eq('business_unit', ctx.businessUnit)
      .or(`room.eq.team,room.like.dm:%${me}%`).order('created_at', { ascending: false }).limit(400),
  ]);
  const seen = new Map((reads ?? []).map(r => [r.room as string, r.last_read_at as string]));
  const rooms = new Map<string, { room: string; other: string | null; last: { sender_id: string; body: string; created_at: string } | null; unread: number }>();
  rooms.set('team', { room: 'team', other: null, last: null, unread: 0 });
  for (const m of recent ?? []) {
    const room = m.room as string;
    const other = room === 'team' ? null : dmOther(room, ctx.userId);
    if (room !== 'team' && !other) continue;   // a DM the caller is not in
    const r = rooms.get(room) ?? { room, other, last: null, unread: 0 };
    if (!r.last) r.last = { sender_id: m.sender_id as string, body: m.body as string, created_at: m.created_at as string };
    if (m.sender_id !== ctx.userId && (!seen.has(room) || (m.created_at as string) > seen.get(room)!)) r.unread++;
    rooms.set(room, r);
  }
  const list = [...rooms.values()];
  return NextResponse.json({ rooms: list, unread: list.reduce((n, r) => n + r.unread, 0) });
}
