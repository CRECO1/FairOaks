// Secure document requests — server helpers shared by the agent routes (/api/crm/secure-requests), the tenant's token
// route (/api/secure-upload/[token]) and the cron. See supabase/secure-upload-2026-11.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { APP_ORIGIN, esc, resendConfig } from '@/lib/esign';
import type { CrmContext } from '@/lib/crm-auth';
import { Resend } from 'resend';
import { sendPushToProfiles, crmLink } from '@/lib/push';

export const SECURE_BUCKET = 'secure-intake';
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 40;
export const LINK_DAYS = 14;
export const KEEP_DAYS = 90;
export const OFFICE_PHONE = '(210) 817-3443';

export const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};
export const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Does the start of the file look like what its extension claims? Catches a renamed .exe/.html and a corrupt upload. */
export function signatureMatches(ext: string, b: Uint8Array): boolean {
  const is = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  switch (ext) {
    case 'pdf': return is(0x25, 0x50, 0x44, 0x46);                                  // %PDF
    case 'png': return is(0x89, 0x50, 0x4e, 0x47);
    case 'jpg': case 'jpeg': return is(0xff, 0xd8, 0xff);
    case 'webp': return is(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;   // RIFF....WEBP
    case 'docx': case 'xlsx': return is(0x50, 0x4b, 0x03, 0x04);                    // zip container
    case 'doc': case 'xls': return is(0xd0, 0xcf, 0x11, 0xe0);                      // OLE2
    case 'csv': return b.length > 0 && !b.includes(0);                              // text: no NUL bytes
    default: return false;
  }
}

/** Reads the first bytes of a stored object (a 32-byte ranged GET on a short signed link) — never the whole file. */
export async function sniffStored(db: SupabaseClient, path: string, ext: string): Promise<boolean> {
  try {
    const { data } = await db.storage.from(SECURE_BUCKET).createSignedUrl(path, 60);
    if (!data?.signedUrl) return false;
    const r = await fetch(data.signedUrl, { headers: { Range: 'bytes=0-31' } });
    if (!r.ok && r.status !== 206) return false;
    return signatureMatches(ext, new Uint8Array((await r.arrayBuffer()).slice(0, 32)));
  } catch { return false; }
}

export interface ChecklistItem { key: string; label: string }

/** Checklists an agent can start from; the agent can tick items off or add their own. */
export const PRESETS: Record<string, { label: string; items: ChecklistItem[] }> = {
  tenant: {
    label: 'Tenant (individual / personal guaranty)',
    items: [
      { key: 'application', label: 'Completed rental application' },
      { key: 'id', label: 'Government photo ID' },
      { key: 'paystubs', label: 'Last 3 pay stubs' },
      { key: 'bank', label: 'Last 3 months of bank statements' },
      { key: 'tax', label: 'Last 2 years of tax returns' },
    ],
  },
  business: {
    label: 'Business tenant',
    items: [
      { key: 'application', label: 'Completed rental application' },
      { key: 'id', label: 'Government photo ID (each owner / guarantor)' },
      { key: 'financials', label: 'Business financial statements (last 2 years)' },
      { key: 'biztax', label: 'Business tax returns (last 2 years)' },
      { key: 'bank', label: 'Last 3 months of business bank statements' },
      { key: 'pfs', label: 'Personal financial statement (guarantor)' },
    ],
  },
  other: { label: 'Blank — I will list what I need', items: [] },
};

export const genToken = () => randomBytes(24).toString('base64url');
export const secureUrl = (token: string) => `${APP_ORIGIN}/secure/${token}`;
export const addDays = (d: number, from = Date.now()) => new Date(from + d * 86_400_000).toISOString();

/** Keeps the checklist small and safe: unique keys, trimmed labels, at most 15 items. */
export function cleanItems(input: unknown): ChecklistItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ChecklistItem[] = [];
  for (const raw of input) {
    const label = typeof raw?.label === 'string' ? raw.label.trim().slice(0, 120) : '';
    let key = typeof raw?.key === 'string' ? raw.key.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : '';
    if (!label) continue;
    if (!key) key = `item${out.length + 1}`;
    while (seen.has(key)) key += '_';
    seen.add(key);
    out.push({ key, label });
    if (out.length >= 15) break;
  }
  return out;
}

export interface SecureRequestRow {
  id: string; client_id: string; deal_id: string | null; business_unit: string; created_by: string | null; shared_with: string[] | null;
  recipient_name: string | null; recipient_email: string | null; note: string | null; items: ChecklistItem[]; token: string;
  status: 'open' | 'revoked'; expires_at: string; purge_after: string; keep_files: boolean; purged_at: string | null;
  sent_at: string | null; reminded_at: string | null; reminder_count: number; first_viewed_at: string | null; view_count: number;
  last_upload_at: string | null; submitted_at: string | null; notified_at: string | null; created_at: string;
}

/**
 * Who may open a request's files. Deliberately narrower than "anyone who can see the contact": the broker (super_admin),
 * whoever created the request, the contact's owner, and agents the creator added. An admin who is none of those
 * (Brian) does not see it unless added — the same stance as private deals and trackers.
 */
/** The rule itself, given the rows it depends on. `canSeeRequest` fetches them one request at a time; the My Drive index loads them in bulk. */
export function canSeeGiven(
  ctx: Pick<CrmContext, 'userId' | 'role'>, r: Pick<SecureRequestRow, 'created_by' | 'shared_with' | 'deal_id'>,
  contactOwnerId: string | null | undefined, deal: { agent_id?: string | null; assigned_agent_ids?: string[] | null } | null | undefined,
): boolean {
  if (ctx.role === 'super_admin') return true;
  if (r.created_by === ctx.userId || (r.shared_with ?? []).includes(ctx.userId)) return true;
  if (contactOwnerId && contactOwnerId === ctx.userId) return true;
  // A request made on a deal is also visible to everyone on that deal: its owner and the agents added to it
  // (the same people who can open the deal itself). Agents NOT on the deal still need the creator to add them.
  if (r.deal_id && deal && (deal.agent_id === ctx.userId || (deal.assigned_agent_ids ?? []).includes(ctx.userId))) return true;
  return false;
}
/**
 * May this request appear in the caller's My Drive index? Everything `/api/crm/secure-requests` checks one row at a time, on rows
 * loaded in bulk: the contact must exist in this workspace, a lead still on hold is the broker's alone, a deal the caller may not
 * see hides its folder, and then the folder's own access rule.
 */
export function indexVisible(
  ctx: Pick<CrmContext, 'userId' | 'role'>, unit: string, r: Pick<SecureRequestRow, 'created_by' | 'shared_with' | 'deal_id'>,
  contact: { agent_id?: string | null; lead_hold?: boolean | null; business_unit?: string | null } | null | undefined,
  deal: { agent_id?: string | null; assigned_agent_ids?: string[] | null } | null | undefined, hiddenDeals: Set<string>,
): boolean {
  if (!contact || contact.business_unit !== unit) return false;
  if (contact.lead_hold && ctx.role !== 'super_admin') return false;
  if (r.deal_id && (hiddenDeals.has(r.deal_id) || !deal)) return false;
  return canSeeGiven(ctx, r, contact.agent_id, r.deal_id ? deal : null);
}
export async function canSeeRequest(db: SupabaseClient, ctx: CrmContext, r: SecureRequestRow): Promise<boolean> {
  if (canSeeGiven(ctx, r, null, null)) return true;
  const { data: c } = await db.from('crm_clients').select('agent_id').eq('id', r.client_id).maybeSingle();
  const { data: d } = r.deal_id ? await db.from('crm_deals').select('agent_id, assigned_agent_ids').eq('id', r.deal_id).maybeSingle() : { data: null };
  return canSeeGiven(ctx, r, c?.agent_id as string | null | undefined, d as { agent_id?: string | null; assigned_agent_ids?: string[] | null } | null);
}

export async function logSecure(db: SupabaseClient, requestId: string, actor: { id?: string | null; label: string }, action: string, detail?: string | null, ip?: string | null) {
  const { error } = await db.from('crm_secure_log').insert({ request_id: requestId, actor_id: actor.id ?? null, actor_label: actor.label, action, detail: detail ?? null, ip: ip ?? null });
  if (error) console.error('[secure-upload] log failed', action, error.message);
}

/** Deletes every stored object + row for a request's files (the log stays). */
export async function removeRequestFiles(db: SupabaseClient, requestId: string): Promise<number> {
  const { data: files } = await db.from('crm_secure_files').select('id, storage_path').eq('request_id', requestId);
  const paths = (files ?? []).map(f => f.storage_path as string);
  if (paths.length) await db.storage.from(SECURE_BUCKET).remove(paths);
  if (files?.length) await db.from('crm_secure_files').delete().eq('request_id', requestId);
  return paths.length;
}

// ── Email ────────────────────────────────────────────────────────────────────
function shell(brand: string, bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="border-bottom:3px solid #c9922c;padding:14px 0 10px"><span style="font-size:20px;font-weight:800;letter-spacing:.5px;color:#c9922c">${esc(brand)}</span></div>
    <div style="padding:20px 2px;font-size:15px;line-height:1.55">${bodyHtml}<!--agent-signature--></div>
    <div style="border-top:1px solid #eee;margin-top:18px;padding-top:12px;font-size:11px;color:#9ca3af">
      This is a private upload link made just for you. If you weren’t expecting it, you can ignore this email — nothing is shared unless you upload.
    </div>
  </div>`;
}
const brandName = (unit: string) => (unit === 'residential' ? 'Fair Oaks Realty Group' : 'CRECO');

export function requestEmail(unit: string, o: { name: string; senderName: string; url: string; items: ChecklistItem[]; note?: string | null; expiresAt: string; reminder?: boolean }) {
  const first = (o.name || '').trim().split(/\s+/)[0] || 'there';
  const exp = new Date(o.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
  const list = o.items.length ? `<ul style="margin:8px 0 14px;padding-left:20px">${o.items.map(i => `<li>${esc(i.label)}</li>`).join('')}</ul>` : '';
  const body = `<p>Hi ${esc(first)},</p>
    <p>${o.reminder ? `A quick reminder — ${esc(o.senderName)} is still waiting on` : `${esc(o.senderName)} asked for`} a few documents to keep your application moving. Please upload them through the private link below — <strong>please don’t email them</strong>, since email isn’t a safe place for bank statements or IDs.</p>
    ${list}
    ${o.note ? `<p style="background:#faf7ef;border-left:3px solid #c9922c;padding:10px 12px;border-radius:4px;white-space:pre-line">${esc(o.note)}</p>` : ''}
    <p style="margin:22px 0"><a href="${esc(o.url)}" style="background:#c9922c;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;display:inline-block">🔒 Upload securely</a></p>
    <p style="font-size:12px;color:#6b7280">Only your CRECO broker can see what you upload. The link works until ${esc(exp)}. Or paste this into your browser:<br>${esc(o.url)}</p>
    <p style="font-size:12px;color:#6b7280">Questions? Call us at ${OFFICE_PHONE}.</p>`;
  return { subject: o.reminder ? 'Reminder — your secure document upload' : 'Your secure document upload', html: shell(brandName(unit), body) };
}

export function uploadedEmail(unit: string, o: { agentName: string; recipientName: string; count: number; contactUrl: string; submitted: boolean }) {
  const body = `<p>Hi ${esc(o.agentName)},</p>
    <p><strong>${esc(o.recipientName || 'Your contact')}</strong> ${o.submitted ? 'finished uploading' : 'uploaded'} ${o.count} file${o.count === 1 ? '' : 's'} to the secure folder.</p>
    <p style="margin:20px 0"><a href="${esc(o.contactUrl)}" style="background:#111;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;display:inline-block">Open in the CRM</a></p>
    <p style="font-size:12px;color:#6b7280">The files stay inside the CRM — open the contact card → Secure documents.</p>`;
  return { subject: `Secure files received from ${o.recipientName || 'a contact'}`, html: shell(brandName(unit), body) };
}

export async function sendSecureEmail(unit: string, to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { from, apiKey } = resendConfig(unit);
  if (!apiKey) return { ok: false, error: 'RESEND API key not configured' };
  try {
    const { data, error } = await new Resend(apiKey).emails.send({ from, to, subject, html });
    return error ? { ok: false, error: error.message } : { ok: true, id: data?.id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

// ── Telling the agent ────────────────────────────────────────────────────────
/**
 * Who gets a PHONE alert about a request: its creator, the contact's owner, and — for a request made on a deal — the deal's
 * owner and every agent added to that deal (the same people who can open the folder). Emails still go only to the creator
 * and the contact's owner.
 */
export async function pushRecipients(db: SupabaseClient, r: SecureRequestRow): Promise<string[]> {
  const { data: c } = await db.from('crm_clients').select('agent_id').eq('id', r.client_id).maybeSingle();
  const { data: d } = r.deal_id ? await db.from('crm_deals').select('agent_id, assigned_agent_ids').eq('id', r.deal_id).maybeSingle() : { data: null };
  const ids = [r.created_by, c?.agent_id as string | null | undefined, d?.agent_id as string | null | undefined, ...(((d?.assigned_agent_ids as string[] | null) ?? []))];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

/**
 * Tells the request's creator and the contact's owner that files arrived: a phone alert plus one email each.
 * Marks notified_at so the cron does not repeat it. `submitted` = the tenant pressed "I'm done".
 */
export async function notifyUploads(db: SupabaseClient, r: SecureRequestRow, submitted: boolean): Promise<void> {
  try {
    const { count } = await db.from('crm_secure_files').select('id', { count: 'exact', head: true }).eq('request_id', r.id);
    const n = count ?? 0;
    if (!n) return;
    const { data: c } = await db.from('crm_clients').select('agent_id').eq('id', r.client_id).maybeSingle();
    const ids = [...new Set([r.created_by, c?.agent_id as string | null | undefined].filter((x): x is string => !!x))];
    const { data: profs } = ids.length ? await db.from('crm_profiles').select('id, first_name, email').in('id', ids) : { data: [] };
    const who = r.recipient_name || 'A contact';
    const link = `${APP_ORIGIN}${crmLink('contacts', { type: 'contact', id: r.client_id })}`;
    await sendPushToProfiles(await pushRecipients(db, r), {
      title: submitted ? `${who} finished their secure upload` : `${who} uploaded secure files`,
      body: `${n} file${n === 1 ? '' : 's'} waiting in Secure documents`,
      url: crmLink('contacts', { type: 'contact', id: r.client_id }), tag: `secure-${r.id}`, category: 'signatures', businessUnit: r.business_unit,
    }, { db });
    for (const p of profs ?? []) {
      if (!p.email) continue;
      const { subject, html } = uploadedEmail(r.business_unit, { agentName: (p.first_name as string) || 'there', recipientName: who, count: n, contactUrl: link, submitted });
      await sendSecureEmail(r.business_unit, p.email as string, subject, html);
    }
    await db.from('crm_secure_requests').update({ notified_at: new Date().toISOString() }).eq('id', r.id);
  } catch (e) { console.error('[secure-upload] notify failed', e); }
}

/** First time a real person opens the link: a quiet phone alert to the creator + contact owner (no email). */
export async function notifyOpened(db: SupabaseClient, r: SecureRequestRow): Promise<void> {
  try {
    await sendPushToProfiles(await pushRecipients(db, r), {
      title: `${r.recipient_name || 'A contact'} opened their secure upload link`,
      body: 'They haven’t uploaded anything yet', url: crmLink('contacts', { type: 'contact', id: r.client_id }),
      tag: `secure-open-${r.id}`, category: 'signatures', businessUnit: r.business_unit,
    }, { db });
  } catch (e) { console.error('[secure-upload] opened alert failed', e); }
}

/**
 * A file was refused by the safety scan: a phone alert to the request's creator, the contact's owner and the deal's owner
 * (no email, and the filename is shortened). One alert per request — a second block replaces the first instead of stacking.
 */
export async function notifyBlocked(db: SupabaseClient, r: SecureRequestRow, filename: string, reason: string): Promise<void> {
  try {
    const name = filename.length > 50 ? `${filename.slice(0, 47)}…` : filename;
    await sendPushToProfiles(await pushRecipients(db, r), {
      title: `⚠️ A file from ${r.recipient_name || 'a contact'} was blocked`,
      body: `${name} — looks like ${reason}. It was not saved.`,
      url: crmLink('contacts', { type: 'contact', id: r.client_id }), tag: `secure-blocked-${r.id}`, category: 'signatures', businessUnit: r.business_unit,
    }, { db });
  } catch (e) { console.error('[secure-upload] blocked alert failed', e); }
}
