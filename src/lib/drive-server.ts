import { NextRequest } from 'next/server';
import { createClient as createSbClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { getCrmContext, isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export interface DriveContext {
  ctx: CrmContext;
  bu: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** Runs AS THE SIGNED-IN USER, so the read policies on crm_drive_* (crm_drive_can) decide what comes back. */
  userDb: SupabaseClient;
  /** Service role — used for writes only, and only after the caller was shown to be able to see the row via userDb. */
  admin: SupabaseClient;
}

/**
 * Who is calling, plus a client that sees exactly what they may see. Visibility is enforced in the database (one rule,
 * crm_drive_can) instead of being re-implemented here: every read goes through `userDb`, and a write first re-reads its
 * target through `userDb` and answers 404 when the row isn't visible.
 */
export async function driveContext(req: NextRequest): Promise<DriveContext | null> {
  const ctx = await getCrmContext(req);
  if (!ctx) return null;
  const auth = req.headers.get('authorization');
  const userDb = auth?.startsWith('Bearer ')
    ? createSbClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
    : await createSsrClient();
  const isSuperAdmin = ctx.role === 'super_admin';
  return { ctx, bu: ctx.businessUnit ?? 'commercial', isAdmin: isAdminRole(ctx.role), isSuperAdmin, userDb, admin: adminClient() };
}

/** Escape a user's search text for use inside an ilike pattern. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;

// ── Yjs state helpers (documents are stored as one merged Yjs update, base64) ─────────────

const b64ToBytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const bytesToB64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

/** Plain text of a TipTap document (the "default" XmlFragment) — block elements become line breaks. Used for search + previews. */
function fragmentText(frag: Y.XmlFragment): string {
  const out: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlFragment | Y.XmlText | Y.XmlHook) => {
    if (node instanceof Y.XmlText) {
      for (const op of node.toDelta() as Array<{ insert?: unknown }>) if (typeof op.insert === 'string') out.push(op.insert);
      return;
    }
    if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
      node.forEach(child => walk(child as Y.XmlElement));
      if (node instanceof Y.XmlElement && !/^(text|hardBreak)$/.test(node.nodeName)) out.push('\n');
    }
  };
  walk(frag);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** Merge an incoming Yjs update into the stored state. Updates commute, so concurrent savers never lose each other's edits. */
export function mergeYState(existingB64: string | null, updateB64: string): { state: string; text: string } {
  const doc = new Y.Doc();
  try {
    if (existingB64) Y.applyUpdate(doc, b64ToBytes(existingB64));
    Y.applyUpdate(doc, b64ToBytes(updateB64));
    return { state: bytesToB64(Y.encodeStateAsUpdate(doc)), text: fragmentText(doc.getXmlFragment('default')).slice(0, 200_000) };
  } finally {
    doc.destroy();
  }
}

/** Ids of every folder under `rootId` (not including it), from a flat list. */
export function descendantFolderIds(all: Array<{ id: string; parent_id: string | null }>, rootId: string): string[] {
  const kids = new Map<string, string[]>();
  for (const f of all) if (f.parent_id) kids.set(f.parent_id, [...(kids.get(f.parent_id) ?? []), f.id]);
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) { out.push(k); stack.push(k); }
  return out;
}
