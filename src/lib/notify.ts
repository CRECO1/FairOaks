import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPushToProfiles } from '@/lib/push';

/**
 * In-app notification (the bell) for someone who has just been handed work.
 *
 * Before this, assigning a call list or a task to a teammate was silent: they found out when they
 * next opened the CRM and scrolled. The bell already reads crm_notifications for @mentions; this
 * writes the same table. Best effort — a failed notification must never fail the assignment —
 * and never to yourself.
 */
export async function notifyAssignment(
  db: SupabaseClient,
  opts: { recipientId: string | null | undefined; senderId: string; message: string; entityType: 'calls' | 'task'; entityId?: string | null },
): Promise<void> {
  try {
    if (!opts.recipientId || opts.recipientId === opts.senderId) return;
    await db.from('crm_notifications').insert({
      recipient_id: opts.recipientId,
      sender_id: opts.senderId,
      type: 'assignment',
      message: opts.message.slice(0, 280),
      entity_type: opts.entityType,
      entity_id: opts.entityId ?? null,
    });
    await pushBellNotification(db, { recipientId: opts.recipientId, type: 'assignment', message: opts.message, entityType: opts.entityType });
  } catch (e) {
    console.error('[notify] assignment notification failed (assignment itself is unaffected):', e);
  }
}

/** Which CRM page a bell notification opens (the CRM reads the hash on load). */
const PAGE_FOR_ENTITY: Record<string, string> = { calls: 'tasks', task: 'tasks', contact: 'contacts', deal: 'deals', listing: 'properties', suite: 'properties' };

/**
 * The same notification, as a phone alert. The bell row is the record; this is the tap on the shoulder.
 * Never throws and never to yourself (callers already skip the sender).
 */
export async function pushBellNotification(
  db: SupabaseClient,
  n: { recipientId: string; type: string; message: string; entityType?: string | null; tag?: string },
): Promise<void> {
  try {
    const { data: who } = await db.from('crm_profiles').select('business_unit').eq('id', n.recipientId).maybeSingle();
    const page = PAGE_FOR_ENTITY[n.entityType ?? ''] ?? 'dashboard';
    await sendPushToProfiles([n.recipientId], {
      title: n.type === 'assignment' ? 'Assigned to you' : 'You were tagged',
      body: n.message,
      url: `/crm/commercial#${page}`,
      tag: n.tag,
      category: 'mentions',
      businessUnit: who?.business_unit ?? null,
    }, { db });
  } catch (e) {
    console.error('[notify] push failed (the bell notification is unaffected):', e);
  }
}

/** "Zack" from a profile row, falling back to "A teammate". */
export async function senderName(db: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data } = await db.from('crm_profiles').select('first_name').eq('id', userId).maybeSingle();
    const n = String(data?.first_name ?? '').replace(/\.$/, '').trim();
    return n || 'A teammate';
  } catch { return 'A teammate'; }
}
