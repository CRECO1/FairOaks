/**
 * "Attach from the CRM" (Zack, 2026-10-28): an agent picks documents that are already on a DEAL's Docs tab and the
 * server attaches them to the email itself, so nothing is downloaded and re-uploaded through the browser (which also
 * sidesteps Vercel's 4.5 MB request cap). Only deal documents are offered — files an agent pulled into the deal
 * (uploads, forms) and the signed copies of those forms — never other properties' flyers or listing files.
 *
 * Every reference is authorized server-side by its parent deal (workspace + Restricted-deal rules), exactly like
 * opening the document from the deal's Docs tab.
 */
import { adminClient } from '@/lib/supabase-admin';
import { assertOwnsResource, hiddenDealIds, type CrmContext } from '@/lib/crm-auth';
import { canAccessLinked } from '@/lib/crm-linked-access';

export type CrmAttachKind = 'deal_doc' | 'form' | 'signed';
export const CRM_ATTACH_KINDS: CrmAttachKind[] = ['deal_doc', 'form', 'signed'];
export interface CrmAttachRef { kind: CrmAttachKind; id: string }
export interface CrmAttachItem extends CrmAttachRef { name: string; size: number | null; type: string; sub?: string }
export interface CrmAttachGroup { dealId: string; title: string; items: CrmAttachItem[] }

const DEAL_DOCS = 'deal-docs';
const FORMS = 'transaction-forms';
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const clean = (s: string, fallback: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || fallback;

/** Everything on one deal's Docs tab that can be emailed. */
async function dealItems(dealId: string): Promise<CrmAttachItem[]> {
  const db = adminClient();
  const [docs, subs, envs] = await Promise.all([
    db.from('crm_deal_docs').select('id, name, file_size, file_type, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }),
    db.from('crm_form_submissions').select('id, title, status, filled_path, updated_at').eq('deal_id', dealId).not('filled_path', 'is', null).order('updated_at', { ascending: false }),
    db.from('crm_envelopes').select('id, title, executed_path, executed_clean_path, completed_at').eq('deal_id', dealId).eq('status', 'completed').order('completed_at', { ascending: false }),
  ]);
  const items: CrmAttachItem[] = [];
  for (const d of docs.data ?? []) items.push({ kind: 'deal_doc', id: d.id as string, name: d.name as string, size: (d.file_size as number | null) ?? null, type: (d.file_type as string) || 'application/octet-stream', sub: 'Uploaded to the deal' });
  for (const s of subs.data ?? []) items.push({ kind: 'form', id: s.id as string, name: `${clean(String(s.title ?? ''), 'Form')}.pdf`, size: null, type: 'application/pdf', sub: 'Form on the deal' });
  for (const e of envs.data ?? []) if (e.executed_clean_path || e.executed_path) items.push({ kind: 'signed', id: e.id as string, name: `${clean(String(e.title ?? ''), 'Document')} (signed).pdf`, size: null, type: 'application/pdf', sub: 'Signed copy' });
  return items;
}

/** The deal(s) to offer: one deal, or a contact's deals (hidden/Restricted ones left out). */
export async function listAttachables(ctx: CrmContext, opts: { dealId?: string; clientId?: string }): Promise<CrmAttachGroup[] | null> {
  const db = adminClient();
  if (opts.dealId) {
    if (!(await assertOwnsResource('crm_deals', opts.dealId, ctx))) return null;
    const { data: d } = await db.from('crm_deals').select('id, client, property').eq('id', opts.dealId).maybeSingle();
    const items = await dealItems(opts.dealId);
    return items.length ? [{ dealId: opts.dealId, title: [d?.client, d?.property].filter(Boolean).join(' — ') || 'This deal', items }] : [];
  }
  if (opts.clientId) {
    if (!(await assertOwnsResource('crm_clients', opts.clientId, ctx))) return null;
    const hidden = new Set(await hiddenDealIds(ctx));
    const { data: deals } = await db.from('crm_deals').select('id, client, property').eq('client_id', opts.clientId).limit(10);
    const groups: CrmAttachGroup[] = [];
    for (const d of (deals ?? []).filter(x => !hidden.has(x.id as string))) {
      const items = await dealItems(d.id as string);
      if (items.length) groups.push({ dealId: d.id as string, title: [d.client, d.property].filter(Boolean).join(' — ') || 'Deal', items });
    }
    return groups;
  }
  return [];
}

export type ResolvedAttachment = { name: string; mimeType: string; data: string };

async function fetchBytes(bucket: string, path: string): Promise<Buffer | null> {
  const { data } = await adminClient().storage.from(bucket).download(path);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

/** Turns picked references into base64 attachments, authorizing each one. */
export async function resolveCrmAttachments(refs: CrmAttachRef[], ctx: CrmContext): Promise<{ ok: true; files: ResolvedAttachment[] } | { ok: false; status: number; error: string }> {
  const db = adminClient();
  const files: ResolvedAttachment[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue; seen.add(key);
    let name = '', mimeType = 'application/pdf', bytes: Buffer | null = null;

    if (ref.kind === 'deal_doc') {
      const { data: d } = await db.from('crm_deal_docs').select('deal_id, name, storage_path, file_type').eq('id', ref.id).maybeSingle();
      if (!d || !(await assertOwnsResource('crm_deals', d.deal_id as string, ctx))) return { ok: false, status: 404, error: 'A deal document you picked is no longer available' };
      name = d.name as string; mimeType = (d.file_type as string) || 'application/octet-stream';
      bytes = await fetchBytes(DEAL_DOCS, d.storage_path as string);
    } else if (ref.kind === 'form') {
      const { data: s } = await db.from('crm_form_submissions').select('id, title, filled_path, deal_id, listing_id, business_unit').eq('id', ref.id).maybeSingle();
      if (!s || !s.deal_id || !s.filled_path
        || !(await assertOwnsResource('crm_form_submissions', ref.id, ctx))
        || !(await assertOwnsResource('crm_deals', s.deal_id as string, ctx))
        || !(await canAccessLinked(ctx, s as { business_unit?: string | null; deal_id?: string | null; listing_id?: string | null }))) return { ok: false, status: 404, error: 'A form you picked is no longer available' };
      name = `${clean(String(s.title ?? ''), 'Form')}.pdf`;
      bytes = await fetchBytes(FORMS, s.filled_path as string);
    } else {
      const { data: e } = await db.from('crm_envelopes').select('id, title, status, executed_path, executed_clean_path, business_unit, deal_id, listing_id').eq('id', ref.id).maybeSingle();
      const path = (e?.executed_clean_path || e?.executed_path) as string | undefined;
      if (!e || !e.deal_id || e.status !== 'completed' || !path
        || !(await assertOwnsResource('crm_deals', e.deal_id as string, ctx))
        || !(await canAccessLinked(ctx, e as { business_unit?: string | null; deal_id?: string | null; listing_id?: string | null }))) return { ok: false, status: 404, error: 'A signed copy you picked is no longer available' };
      name = `${clean(String(e.title ?? ''), 'Document')} (signed).pdf`;
      bytes = await fetchBytes(FORMS, path);
    }
    if (!bytes) return { ok: false, status: 404, error: `Couldn’t read “${name}” from storage — try again` };
    if (bytes.length > MAX_FILE_BYTES) return { ok: false, status: 413, error: `“${name}” is too large to email (15 MB max per file)` };
    files.push({ name, mimeType, data: bytes.toString('base64') });
  }
  return { ok: true, files };
}
