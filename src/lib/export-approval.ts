/**
 * Export-approval workflow — shared pieces.
 *
 * The rule, in one line: nobody but the account owner exports the contact
 * database without the owner saying yes to that specific export, right now.
 *
 * Three things make that hold rather than merely be stated:
 *   - the approval is bound to a SCOPE, so "yes to these 12" cannot be
 *     redeemed as "all four thousand";
 *   - it is bound to a CLOCK, so an approval left sitting overnight is no
 *     longer an approval;
 *   - it is bound to ONE download, so approval is never standing.
 *
 * SERVER-ONLY: uses the service role.
 */
import 'server-only';

import crypto from 'crypto';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';

/** How long the approve/deny link in the email stays actionable. */
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** How long an approval stays redeemable once granted. */
export const APPROVAL_TTL_MS = 30 * 60 * 1000;

/** Where approval notifications go. The owner is the approver. */
export const APPROVER_EMAIL = process.env.EXPORT_APPROVER_EMAIL ?? 'zack@crecotx.com';

const SITE = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.fairoaksrealtygroup.com').replace(/\/$/, '');

export type ExportStatus = 'pending' | 'approved' | 'denied' | 'consumed' | 'expired';

/**
 * Which body of data is being handed over. The approval is bound to this, so a
 * "yes" to the contact list can never be redeemed as a commissions export — the
 * datasets would otherwise collide on an identical scope_key.
 */
export type ExportDataset = 'contacts' | 'commissions' | 'commissions_1099';

export interface ExportScope {
  /** Defaults to 'contacts', which keeps the original key format byte-for-byte. */
  dataset?: ExportDataset;
  businessUnit: string;
  /** Explicit contact ids when the requester selected a subset; null means "everything in the unit". */
  ids: string[] | null;
  /** Dataset filters that narrow what is handed over (year, agent, status). */
  filters?: Record<string, string | undefined>;
}

const DATASET_NOUN: Record<ExportDataset, { one: string; many: string; what: string }> = {
  contacts:           { one: 'contact',            many: 'contacts',            what: 'contact list' },
  commissions:        { one: 'commission record',  many: 'commission records',  what: 'commission ledger' },
  commissions_1099:   { one: '1099 recipient',     many: '1099 recipients',     what: '1099-NEC summary' },
};

/** Stable, readable rendering of the filters that narrowed an export. */
function filterPart(filters?: Record<string, string | undefined>): string {
  const live = Object.entries(filters ?? {}).filter(([, v]) => v != null && v !== '') as [string, string][];
  if (!live.length) return '';
  return live.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`).join('|');
}

/* ── token ──────────────────────────────────────────────────────────────── */

/** A fresh approve/deny token. The raw value is returned once and never stored. */
export function mintToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/* ── scope ──────────────────────────────────────────────────────────────── */

/**
 * Canonical fingerprint of what was asked for.
 *
 * Sorted so the same selection always fingerprints identically regardless of
 * click order, and hashed so a long id list stays a short column. The export
 * route recomputes this from the live request and compares — that comparison
 * is what stops an approval being reused for a bigger export.
 */
export function scopeKey(scope: ExportScope): string {
  const dataset = scope.dataset ?? 'contacts';
  // 'contacts' keeps the original format so approvals issued before datasets
  // existed still match. Everything else is namespaced, which is also what stops
  // an approval for one dataset being redeemed against another.
  const base = dataset === 'contacts' ? '' : `ds:${dataset}|`;
  const filters = filterPart(scope.filters);
  const tail = filters ? `|${filters}` : '';
  if (!scope.ids || scope.ids.length === 0) return `${base}unit:${scope.businessUnit}|all${tail}`;
  const digest = crypto.createHash('sha256').update([...scope.ids].sort().join(',')).digest('hex').slice(0, 32);
  return `${base}unit:${scope.businessUnit}|ids:${scope.ids.length}:${digest}${tail}`;
}

export function scopeLabel(scope: ExportScope, rowCount: number): string {
  const unit = scope.businessUnit === 'commercial' ? 'Commercial' : 'Residential';
  const noun = DATASET_NOUN[scope.dataset ?? 'contacts'];
  const n = `${rowCount} ${rowCount === 1 ? noun.one : noun.many}`;
  // Say what narrowed it, so the owner is approving a described thing rather
  // than a number — "2026, unpaid" reads very differently from "everything".
  const live = Object.entries(scope.filters ?? {}).filter(([, v]) => v != null && v !== '') as [string, string][];
  const narrowed = live.length ? ` (${live.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(', ')})` : '';
  if (scope.ids && scope.ids.length > 0) return `${n} selected (${unit})${narrowed}`;
  return `the full ${unit} ${noun.what} — ${n}${narrowed}`;
}

/* ── redemption ─────────────────────────────────────────────────────────── */

export interface RedeemResult {
  ok: boolean;
  /** Set when ok — the row id to mark consumed. */
  requestId?: string;
  /** Why the caller cannot download, in words meant for them. */
  reason?: string;
  status?: ExportStatus;
}

/**
 * Find a live approval for this requester and this exact scope.
 *
 * Deliberately narrow: the newest matching row only, and every disqualifying
 * state gets its own message so the requester is never left guessing whether
 * to wait, ask again, or stop asking.
 */
export async function findRedeemableApproval(
  requesterId: string,
  key: string,
): Promise<RedeemResult> {
  const db = adminClient();
  const { data } = await db
    .from('crm_export_requests')
    .select('id, status, approval_expires_at')
    .eq('requester_id', requesterId)
    .eq('scope_key', key)
    .order('created_at', { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row) {
    return { ok: false, reason: 'No export request on file for this selection. Request approval first.' };
  }

  switch (row.status as ExportStatus) {
    case 'approved': {
      if (row.approval_expires_at && new Date(row.approval_expires_at).getTime() < Date.now()) {
        // Reflect the lapse in the row so the CRM stops showing it as live.
        await db.from('crm_export_requests').update({ status: 'expired' }).eq('id', row.id);
        return { ok: false, status: 'expired', reason: 'That approval has expired. Request approval again.' };
      }
      return { ok: true, requestId: row.id, status: 'approved' };
    }
    case 'pending':
      return { ok: false, status: 'pending', reason: 'Your export request is awaiting owner approval.' };
    case 'denied':
      return { ok: false, status: 'denied', reason: 'The owner denied this export request.' };
    case 'consumed':
      return { ok: false, status: 'consumed', reason: 'That approval has already been used. Each export needs its own approval.' };
    case 'expired':
      return { ok: false, status: 'expired', reason: 'That approval has expired. Request approval again.' };
    default:
      return { ok: false, reason: 'Export request is not in a usable state.' };
  }
}

/* ── notification ───────────────────────────────────────────────────────── */

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Tell the owner someone wants to export, and let him answer from the email.
 *
 * Brand tokens are the ones the sites actually use — ink #1A1A1A, gold
 * #C9A962, cream #F5F0E6 — and gold-dark #A68B4B wherever gold would sit on
 * a light ground, which is the contrast rule from the brand kit. Never throws:
 * a mail outage must not take down the request itself, because the request is
 * what is holding the export shut.
 */
export async function sendApprovalRequestEmail(opts: {
  requesterName: string;
  requesterEmail: string | null;
  scopeText: string;
  rowCount: number;
  businessUnit: string;
  rawToken: string;
  requestedAt: Date;
}): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[export-approval] RESEND_API_KEY unset — approval email not sent');
    return { sent: false };
  }

  const approveUrl = `${SITE}/api/crm/export-approve?token=${encodeURIComponent(opts.rawToken)}&action=approve`;
  const denyUrl = `${SITE}/api/crm/export-approve?token=${encodeURIComponent(opts.rawToken)}&action=deny`;
  const when = opts.requestedAt.toLocaleString('en-US', {
    timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short',
  });
  const crm = opts.businessUnit === 'commercial' ? 'Commercial CRM' : 'Residential CRM';

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #E8E5E0;color:#6B6B6B;font-size:13px;width:150px">${esc(label)}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #E8E5E0;color:#1A1A1A;font-size:15px;font-weight:600">${value}</td>
    </tr>`;

  const html = `
<div style="background:#FAF8F5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #E8E5E0;border-radius:4px;overflow:hidden">

    <div style="background:#1A1A1A;padding:28px 32px">
      <p style="margin:0 0 6px;color:#C9A962;font-size:12px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">Approval needed</p>
      <h1 style="margin:0;color:#FFFFFF;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700">Contact export request</h1>
    </div>

    <div style="padding:28px 32px 8px">
      <p style="margin:0 0 20px;color:#525252;font-size:15px;line-height:1.6">
        <strong style="color:#1A1A1A">${esc(opts.requesterName)}</strong> is asking to export
        ${esc(opts.scopeText)}. Nothing has been sent to them — the export stays blocked until you approve it below.
      </p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #E8E5E0;border-radius:4px">
        ${row('Requested by', esc(opts.requesterName))}
        ${row('Email', opts.requesterEmail ? `<a href="mailto:${esc(opts.requesterEmail)}" style="color:#A68B4B;text-decoration:none">${esc(opts.requesterEmail)}</a>` : '&mdash;')}
        ${row('CRM', esc(crm))}
        ${row('Scope', esc(opts.scopeText))}
        ${row('Rows', esc(String(opts.rowCount)))}
        ${row('Requested', esc(when) + ' CT')}
      </table>
    </div>

    <div style="padding:24px 32px 8px;text-align:center">
      <a href="${approveUrl}" style="display:inline-block;background:#C9A962;color:#1A1A1A;padding:14px 34px;border-radius:4px;text-decoration:none;font-size:15px;font-weight:700;margin:0 6px 10px">Approve this export</a>
      <a href="${denyUrl}" style="display:inline-block;background:#FFFFFF;color:#1A1A1A;border:1px solid #1A1A1A;padding:13px 34px;border-radius:4px;text-decoration:none;font-size:15px;font-weight:700;margin:0 6px 10px">Deny</a>
    </div>

    <div style="padding:8px 32px 28px">
      <p style="margin:0;color:#6B6B6B;font-size:13px;line-height:1.6;text-align:center">
        Approving opens a single download for 30 minutes. It cannot be used twice, and the next
        export needs asking again. These links work once and expire in 24 hours.
      </p>
    </div>

    <div style="background:#F5F0E6;padding:18px 32px;border-top:1px solid #E8E5E0">
      <p style="margin:0;color:#6B6B6B;font-size:12px;line-height:1.6">
        You can also approve or deny from the CRM &mdash;
        <a href="${SITE}/crm" style="color:#A68B4B;font-weight:600;text-decoration:none">open the CRM</a>.
        If you did not expect this request, deny it and check with ${esc(opts.requesterName)}.
      </p>
    </div>
  </div>
</div>`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
      to: APPROVER_EMAIL,
      replyTo: opts.requesterEmail ?? undefined,
      subject: `Approval needed — ${opts.requesterName} wants to export ${opts.rowCount} contact${opts.rowCount === 1 ? '' : 's'}`,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error('[export-approval] approval email failed', err);
    return { sent: false };
  }
}

/** Minimal branded page for the approve/deny link to land on. */
export function decisionPage(title: string, body: string, tone: 'ok' | 'bad' = 'ok'): Response {
  const accent = tone === 'ok' ? '#A68B4B' : '#B91C1C';
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;background:#FAF8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:540px;margin:16vh auto;padding:40px 32px;background:#fff;border:1px solid #E8E5E0;border-radius:4px;text-align:center">
    <div style="width:44px;height:3px;background:${accent};margin:0 auto 22px"></div>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#1A1A1A">${esc(title)}</h1>
    <p style="margin:0 0 26px;color:#525252;font-size:15px;line-height:1.6">${body}</p>
    <a href="${SITE}/crm" style="display:inline-block;background:#1A1A1A;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:700">Open the CRM</a>
  </div>
</body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}
