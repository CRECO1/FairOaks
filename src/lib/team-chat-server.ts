import { NextRequest } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { assertOwnsResource, type CrmContext } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';
import { dmOther, isDmRoom } from '@/lib/team-chat';

// Server-side helpers shared by the TeamChat routes.
export const CHAT_BUCKET = 'chat-files';
export const MAX_ATTACH = 5;
export const MAX_LINKS = 5;
export type ChatAttachment = { path: string; name: string; size: number; type: string };
export type ChatLink = { kind: 'deal' | 'contact' | 'doc'; id: string; label: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const roomSlug = (room: string) => room.replace(/[^a-zA-Z0-9]+/g, '_');
export const chatPrefix = (bu: string, room: string) => `${bu}/${roomSlug(room)}/`;

/** May the caller open this room? 'team' = anyone in a workspace; a DM = only its two people (and the other must be in the same workspace). */
export async function roomAllowed(ctx: CrmContext, room: string): Promise<{ ok: boolean; other?: string }> {
  if (room === 'team') return { ok: !!ctx.businessUnit };
  if (!isDmRoom(room)) return { ok: false };
  const other = dmOther(room, ctx.userId);
  if (!other) return { ok: false };
  const { data } = await adminClient().from('crm_profiles').select('id').eq('id', other).eq('business_unit', ctx.businessUnit ?? '').maybeSingle();
  return { ok: !!data, other };
}

/** Attachments as the browser sent them → only ones that really live in this room's folder of the bucket. */
export function cleanAttachments(raw: unknown, ctx: CrmContext, room: string): ChatAttachment[] {
  if (!Array.isArray(raw) || !ctx.businessUnit) return [];
  const prefix = chatPrefix(ctx.businessUnit, room);
  return raw.slice(0, MAX_ATTACH).flatMap(a => {
    const x = a as Partial<ChatAttachment>;
    if (typeof x?.path !== 'string' || !x.path.startsWith(prefix) || x.path.includes('..')) return [];
    return [{ path: x.path, name: String(x.name ?? 'file').slice(0, 255), size: Number(x.size) || 0, type: String(x.type ?? '').slice(0, 100) }];
  });
}

/** Links as the browser sent them → only ones the SENDER may open; the label is read here, never trusted from the browser. */
export async function resolveLinks(req: NextRequest, raw: unknown, ctx: CrmContext): Promise<ChatLink[]> {
  if (!Array.isArray(raw)) return [];
  const out: ChatLink[] = [];
  const admin = adminClient();
  for (const l of raw.slice(0, MAX_LINKS)) {
    const kind = (l as { kind?: string })?.kind, id = (l as { id?: string })?.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) continue;
    if (kind === 'deal') {
      if (!(await assertOwnsResource('crm_deals', id, ctx))) continue;
      const { data } = await admin.from('crm_deals').select('client, property').eq('id', id).maybeSingle();
      if (data) out.push({ kind, id, label: [data.client, data.property].filter(Boolean).join(' — ').slice(0, 120) || 'Deal' });
    } else if (kind === 'contact') {
      if (!(await assertOwnsResource('crm_clients', id, ctx))) continue;
      const { data } = await admin.from('crm_clients').select('first_name, last_name, business_name').eq('id', id).maybeSingle();
      if (data) out.push({ kind, id, label: ([data.first_name, data.last_name].filter(Boolean).join(' ').trim() || data.business_name || 'Contact').slice(0, 120) });
    } else if (kind === 'doc') {
      const dc = await driveContext(req);   // read as the sender, so a document they cannot open cannot be shared by link
      if (!dc) continue;
      const { data } = await dc.userDb.from('crm_drive_docs').select('id,title').eq('id', id).eq('business_unit', dc.bu).is('trashed_at', null).maybeSingle();
      if (data) out.push({ kind, id, label: String(data.title ?? 'Document').slice(0, 120) });
    }
  }
  return out;
}
