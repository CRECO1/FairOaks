import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { cleanIdList } from '@/lib/clean-id-list';
import { pushBellNotification } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/**
 * The browser writes @mention rows straight into crm_notifications (RLS lets an agent insert but only the
 * RECIPIENT can read them), so there is no server step to hang a phone alert on. After inserting, the browser
 * posts who the rows were for.
 *
 * The alert text is read back from the database, never from the request, and only rows the caller wrote
 * as themselves in the last 30 seconds qualify — so this can't be used to buzz someone with arbitrary text.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { recipients?: unknown };
  const recipients = cleanIdList(body.recipients, 25).filter(id => id !== ctx.userId);
  if (!recipients.length) return NextResponse.json({ ok: true, pushed: 0 });

  const db = adminClient();
  const since = new Date(Date.now() - 30_000).toISOString();
  const { data: rows } = await db.from('crm_notifications')
    .select('id, recipient_id, type, message, entity_type')
    .in('recipient_id', recipients).eq('sender_id', ctx.userId).eq('type', 'mention').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(25);

  let pushed = 0;
  for (const r of rows ?? []) {
    if (!r.recipient_id || r.recipient_id === ctx.userId) continue;
    await pushBellNotification(db, { recipientId: r.recipient_id, type: r.type, message: r.message, entityType: r.entity_type, tag: `crm-n-${r.id}` });
    pushed++;
  }
  return NextResponse.json({ ok: true, pushed });
}
