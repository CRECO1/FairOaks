import { NextRequest } from 'next/server';
import { createClient as createSbClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { getCrmContext, isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { FORM_LINK_COLS, type DriveFormItem } from '@/lib/drive-types';
import { sheetText } from '@/lib/drive-sheet';

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
    if (node instanceof Y.XmlElement && node.nodeName === 'crmRef') { out.push(`@${String(node.getAttribute('label') ?? '')}`); return; }
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
    // A spreadsheet keeps its cells in the 'tabs' map instead of the text fragment; search needs their text.
    const text = doc.share.has('tabs') ? sheetText(doc) : fragmentText(doc.getXmlFragment('default')).slice(0, 200_000);
    return { state: bytesToB64(Y.encodeStateAsUpdate(doc)), text };
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

/**
 * A copy of a document's Yjs state with every comment highlight taken off. Used when a document becomes a template or a template is
 * used: the copy has no comments, so a leftover yellow highlight would point at nothing. (A comment mark is stored by y-prosemirror
 * as a text attribute named `comment` or `comment--<hash>`.)
 */
export function stripCommentMarks(stateB64: string): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, b64ToBytes(stateB64));
    doc.transact(() => {
      const walk = (n: Y.XmlElement | Y.XmlFragment | Y.XmlText | Y.XmlHook) => {
        if (n instanceof Y.XmlText) {
          let idx = 0;
          for (const op of n.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>) {
            const len = typeof op.insert === 'string' ? op.insert.length : 1;
            const marks = Object.keys(op.attributes ?? {}).filter(k => k === 'comment' || k.startsWith('comment--'));
            if (marks.length) n.format(idx, len, Object.fromEntries(marks.map(k => [k, null])));
            idx += len;
          }
        } else if (n instanceof Y.XmlElement || n instanceof Y.XmlFragment) {
          n.forEach(child => walk(child as Y.XmlElement));
        }
      };
      walk(doc.getXmlFragment('default'));
    });
    return bytesToB64(Y.encodeStateAsUpdate(doc));
  } finally { doc.destroy(); }
}

/**
 * Fill in the form details behind Drive form links (title, which form, status, whether a PDF is saved). The saved forms are read with the
 * service role, so each one is first checked with the same access rule the forms API uses (crm_form_can): a form that has since been put
 * on a deal the person can't see simply isn't listed.
 */
export async function hydrateDriveForms(dc: DriveContext, links: Array<Record<string, unknown>>, titleLike?: string): Promise<DriveFormItem[]> {
  if (!links.length) return [];
  const ids = links.map(l => l.submission_id as string);
  const { data } = await dc.admin.from('crm_form_submissions').select('id,title,form_id,status,filled_path,crm_forms(name,form_code)').in('id', ids);
  const bySub = new Map((data ?? []).map(r => [r.id as string, r]));
  const out: DriveFormItem[] = [];
  await Promise.all(links.map(async l => {
    const sub = bySub.get(l.submission_id as string);
    if (!sub) return;
    if (titleLike && !String(sub.title ?? '').toLowerCase().includes(titleLike.toLowerCase())) return;
    const { data: ok } = await dc.admin.rpc('crm_form_can', { p_uid: dc.ctx.userId, p_sub: sub.id });
    if (ok !== true) return;
    const cf = sub.crm_forms as unknown as { name?: string; form_code?: string | null } | { name?: string; form_code?: string | null }[] | null;
    const f = Array.isArray(cf) ? cf[0] : cf;
    out.push({
      ...(l as unknown as DriveFormItem), title: (sub.title as string) || f?.name || 'Form', form_id: (sub.form_id as string | null) ?? null,
      form_name: f?.name ?? null, form_code: f?.form_code ?? null, status: (sub.status as string | null) ?? null, has_pdf: !!sub.filled_path,
      visibility: 'team', shared_with: [], deal_id: null,
    });
  }));
  return out;
}
export { FORM_LINK_COLS };
