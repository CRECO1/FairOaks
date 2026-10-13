import type { SupabaseClient } from '@supabase/supabase-js';

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
  } catch (e) {
    console.error('[notify] assignment notification failed (assignment itself is unaffected):', e);
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
