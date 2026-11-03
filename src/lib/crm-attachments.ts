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
import { EMAIL_ATTACH_BUCKET, type StoredAttachment } from '@/lib/email-attachments';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { fetchAttachment } from '@/lib/gmail-live';
import { driveDocPdf } from '@/lib/drive-pdf-server';

export type CrmAttachKind = 'deal_doc' | 'form' | 'signed' | 'email_att' | 'gmail_att' | 'upload' | 'drive_doc';
export const CRM_ATTACH_KINDS: CrmAttachKind[] = ['deal_doc', 'form', 'signed', 'email_att', 'gmail_att', 'upload', 'drive_doc'];
/** An 'upload' id is the storage path `pending/<uploader's id>/<uuid>/<file name>` of a big file the sender put in storage straight from the browser. */
export const UPLOAD_ID = /^pending\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/\\]{1,150}$/i;
const MIME_BY_EXT: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv', txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip' };
/** An 'email_att' id is `<crm_deal_emails.id>:<index into its attachments list>` (Forward carries an email's files). */
/** A 'gmail_att' id is `<gmail message id>:<part id>` — a file on a message in the sender's OWN Gmail (Forward from the live mailbox). */
export const GMAIL_ATT_ID = /^[0-9a-f]{8,32}:[\d.]{1,20}$/i;
export const EMAIL_ATT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{1,2}$/i;
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
  const [docs, subs, envs, linked] = await Promise.all([
    db.from('crm_deal_docs').select('id, name, file_size, file_type, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }),
    db.from('crm_form_submissions').select('id, title, status, filled_path, updated_at').eq('deal_id', dealId).not('filled_path', 'is', null).order('updated_at', { ascending: false }),
    db.from('crm_envelopes').select('id, title, executed_path, executed_clean_path, completed_at').eq('deal_id', dealId).eq('status', 'completed').order('completed_at', { ascending: false }),
    db.from('crm_drive_doc_links').select('doc_id, crm_drive_docs(id, title, trashed_at, ystate)').eq('deal_id', dealId).order('created_at', { ascending: false }),
  ]);
  const items: CrmAttachItem[] = [];
  for (const d of docs.data ?? []) items.push({ kind: 'deal_doc', id: d.id as string, name: d.name as string, size: (d.file_size as number | null) ?? null, type: (d.file_type as string) || 'application/octet-stream', sub: 'Uploaded to the deal' });
  for (const s of subs.data ?? []) items.push({ kind: 'form', id: s.id as string, name: `${clean(String(s.title ?? ''), 'Form')}.pdf`, size: null, type: 'application/pdf', sub: 'Form on the deal' });
  for (const e of envs.data ?? []) if (e.executed_clean_path || e.executed_path) items.push({ kind: 'signed', id: e.id as string, name: `${clean(String(e.title ?? ''), 'Document')} (signed).pdf`, size: null, type: 'application/pdf', sub: 'Signed copy' });
  // Live My Drive documents linked to the deal: attached as a PDF of their latest saved text.
  for (const l of linked.data ?? []) {
    const raw = l.crm_drive_docs as unknown as { id: string; title: string; trashed_at: string | null; ystate: string | null } | Array<{ id: string; title: string; trashed_at: string | null; ystate: string | null }> | null;
    const d = Array.isArray(raw) ? raw[0] : raw;
    if (d && !d.trashed_at && d.ystate) items.push({ kind: 'drive_doc', id: d.id, name: `${clean(d.title, 'Document')}.pdf`, size: null, type: 'application/pdf', sub: 'Live document — sent as its latest version' });
  }
  return items;
}

/** Live My Drive documents linked straight to a CONTACT's card (as the latest PDF), as one group. Empty when there are none. */
async function clientLiveGroup(clientId: string): Promise<CrmAttachGroup[]> {
  const db = adminClient();
  const [{ data: links }, { data: c }] = await Promise.all([
    db.from('crm_drive_doc_links').select('doc_id, crm_drive_docs(id, title, trashed_at, ystate)').eq('client_id', clientId).order('created_at', { ascending: false }),
    db.from('crm_clients').select('first_name, last_name, business_name').eq('id', clientId).maybeSingle(),
  ]);
  const items: CrmAttachItem[] = [];
  for (const l of links ?? []) {
    const raw = l.crm_drive_docs as unknown as { id: string; title: string; trashed_at: string | null; ystate: string | null } | Array<{ id: string; title: string; trashed_at: string | null; ystate: string | null }> | null;
    const d = Array.isArray(raw) ? raw[0] : raw;
    if (d && !d.trashed_at && d.ystate) items.push({ kind: 'drive_doc', id: d.id, name: `${clean(d.title, 'Document')}.pdf`, size: null, type: 'application/pdf', sub: 'Live document — sent as its latest version' });
  }
  if (!items.length) return [];
  const who = [[c?.first_name, c?.last_name].filter(Boolean).join(' '), c?.business_name].filter(Boolean).join(' · ') || 'This contact';
  return [{ dealId: `client:${clientId}`, title: `${who} — live documents`, items }];
}

/** May this caller open the contact's card? (workspace rule, and a held lead only for its owner and the super admin) */
async function canOpenClient(ctx: CrmContext, clientId: string): Promise<boolean> {
  if (!(await assertOwnsResource('crm_clients', clientId, ctx))) return false;
  if (ctx.role === 'super_admin') return true;
  const { data: c } = await adminClient().from('crm_clients').select('lead_hold, agent_id').eq('id', clientId).maybeSingle();
  return !(c?.lead_hold && c.agent_id !== ctx.userId);
}

/** Groups of attachable documents for these deals (hidden/Restricted ones left out, deals with nothing on them skipped). */
async function groupsFor(ctx: CrmContext, deals: Array<{ id: unknown; client: unknown; property: unknown }>): Promise<CrmAttachGroup[]> {
  const hidden = new Set(await hiddenDealIds(ctx));
  const groups: CrmAttachGroup[] = [];
  for (const d of deals.filter(x => !hidden.has(x.id as string))) {
    const items = await dealItems(d.id as string);
    if (items.length) groups.push({ dealId: d.id as string, title: [d.client, d.property].filter(Boolean).join(' — ') || 'Deal', items });
  }
  return groups;
}

/**
 * The deal(s) to offer: one deal, a contact's deals, the deals of whoever an address belongs to (the Compose window,
 * which has no deal open), or a search over deals by client/property.
 */
export async function listAttachables(ctx: CrmContext, opts: { dealId?: string; clientId?: string; email?: string; q?: string }): Promise<CrmAttachGroup[] | null> {
  const db = adminClient();
  if (opts.dealId) {
    if (!(await assertOwnsResource('crm_deals', opts.dealId, ctx))) return null;
    const { data: d } = await db.from('crm_deals').select('id, client, property').eq('id', opts.dealId).maybeSingle();
    const items = await dealItems(opts.dealId);
    return items.length ? [{ dealId: opts.dealId, title: [d?.client, d?.property].filter(Boolean).join(' — ') || 'This deal', items }] : [];
  }
  if (opts.clientId) {
    if (!(await assertOwnsResource('crm_clients', opts.clientId, ctx))) return null;
    const { data: deals } = await db.from('crm_deals').select('id, client, property').eq('client_id', opts.clientId).limit(10);
    const live = (await canOpenClient(ctx, opts.clientId)) ? await clientLiveGroup(opts.clientId) : [];
    return [...live, ...(await groupsFor(ctx, deals ?? []))];
  }
  if (opts.email) {
    const { data: clients } = await db.from('crm_clients').select('id').ilike('email', opts.email.trim().replace(/[%_\\]/g, m => '\\' + m)).limit(5);
    const ids: string[] = [];
    for (const c of clients ?? []) if (await assertOwnsResource('crm_clients', c.id as string, ctx)) ids.push(c.id as string);
    if (!ids.length) return [];
    const { data: deals } = await db.from('crm_deals').select('id, client, property').in('client_id', ids).order('updated_at', { ascending: false }).limit(10);
    const live: CrmAttachGroup[] = [];
    for (const id of ids) if (await canOpenClient(ctx, id)) live.push(...(await clientLiveGroup(id)));
    return [...live, ...(await groupsFor(ctx, deals ?? []))];
  }
  if (opts.q && opts.q.trim().length >= 2) {
    const term = opts.q.trim().replace(/[%_\\,()]/g, ' ').slice(0, 60);
    const { data: found } = await db.from('crm_deals').select('id, client, property').or(`client.ilike.%${term}%,property.ilike.%${term}%`).order('updated_at', { ascending: false }).limit(15);
    const allowed: typeof found = [];
    for (const d of found ?? []) if (await assertOwnsResource('crm_deals', d.id as string, ctx)) allowed.push(d);
    return groupsFor(ctx, allowed);
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
    } else if (ref.kind === 'drive_doc') {
      // A live My Drive document, authorized by a deal or contact it is linked to (the same card rule as opening it there).
      const { data: links } = await db.from('crm_drive_doc_links').select('deal_id, client_id').eq('doc_id', ref.id);
      let ok = false;
      for (const l of links ?? []) {
        if (l.deal_id ? await assertOwnsResource('crm_deals', l.deal_id as string, ctx) : l.client_id ? await canOpenClient(ctx, l.client_id as string) : false) { ok = true; break; }
      }
      const pdf = ok ? await driveDocPdf(ref.id) : null;
      if (!pdf) return { ok: false, status: 404, error: 'A live document you picked is no longer available' };
      name = pdf.name; bytes = Buffer.from(pdf.bytes);
    } else if (ref.kind === 'form') {
      const { data: s } = await db.from('crm_form_submissions').select('id, title, filled_path, deal_id, listing_id, business_unit').eq('id', ref.id).maybeSingle();
      if (!s || !s.deal_id || !s.filled_path
        || !(await assertOwnsResource('crm_form_submissions', ref.id, ctx))
        || !(await assertOwnsResource('crm_deals', s.deal_id as string, ctx))
        || !(await canAccessLinked(ctx, s as { business_unit?: string | null; deal_id?: string | null; listing_id?: string | null }))) return { ok: false, status: 404, error: 'A form you picked is no longer available' };
      name = `${clean(String(s.title ?? ''), 'Form')}.pdf`;
      bytes = await fetchBytes(FORMS, s.filled_path as string);
    } else if (ref.kind === 'upload') {
      // A big file the sender uploaded straight to storage: only its uploader can attach it (their id is in the path).
      const [, uploader, , fileName] = ref.id.split('/');
      if (!UPLOAD_ID.test(ref.id) || uploader !== ctx.userId) return { ok: false, status: 404, error: 'A file you uploaded is no longer available — attach it again' };
      name = fileName; mimeType = MIME_BY_EXT[(fileName.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream';
      bytes = await fetchBytes(EMAIL_ATTACH_BUCKET, ref.id);
    } else if (ref.kind === 'gmail_att') {
      // Only the caller's own mailbox can supply it.
      const [messageId, partId] = ref.id.split(':');
      let got: Awaited<ReturnType<typeof fetchAttachment>> = null;
      for (const box of await callerMailboxes(ctx.userId)) { got = await fetchAttachment(box.accessToken, messageId, partId); if (got) break; }
      if (!got) return { ok: false, status: 404, error: 'A file from that message is no longer available' };
      name = got.name; mimeType = got.mime; bytes = got.bytes;
    } else if (ref.kind === 'email_att') {
      // A file from a logged email (Forward): authorized by the email's deal/contact, like opening it in the thread.
      const [emailId, idxStr] = ref.id.split(':');
      const { data: m } = await db.from('crm_deal_emails').select('deal_id, client_id, attachments').eq('id', emailId).maybeSingle();
      const owned = m?.deal_id ? await assertOwnsResource('crm_deals', m.deal_id as string, ctx)
        : m?.client_id ? await assertOwnsResource('crm_clients', m.client_id as string, ctx) : null;
      const item = Array.isArray(m?.attachments) ? (m!.attachments as StoredAttachment[])[Number(idxStr)] : undefined;
      if (!m || !owned || !item?.path) return { ok: false, status: 404, error: 'A file from that email is no longer available' };
      name = item.name; mimeType = item.mime || 'application/octet-stream';
      bytes = await fetchBytes(EMAIL_ATTACH_BUCKET, item.path);
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
