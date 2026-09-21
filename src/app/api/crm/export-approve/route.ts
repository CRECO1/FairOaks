/**
 * GET /api/crm/export-approve?token=…&action=approve|deny
 *
 * The approve/deny links in the notification email. Authentication here IS the
 * token: it is 32 random bytes, only its SHA-256 is stored, and it dies on
 * first use — so it is the one path into this workflow that does not need the
 * owner to be signed in on whatever device the email opened on.
 *
 * That is a deliberate trade. It is why the token is single-use, why it
 * expires, and why approving only opens a 30-minute window on one download
 * rather than granting anything standing.
 */
import { NextRequest } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';
import { hashToken, decisionPage, APPROVAL_TTL_MS } from '@/lib/export-approval';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const action = req.nextUrl.searchParams.get('action');

  if (!token || (action !== 'approve' && action !== 'deny')) {
    return decisionPage('Link not valid', 'That link is missing part of itself. Open the CRM and answer the request there.', 'bad');
  }

  const db = adminClient();
  const { data: row } = await db
    .from('crm_export_requests')
    .select('id, status, requester_name, requester_email, scope_label, row_count, token_expires_at, requester_id')
    .eq('token_hash', hashToken(token))
    .single();

  // Unknown hash — a guessed, altered or already-rotated token. Same answer
  // either way; we do not tell the holder which.
  if (!row) {
    return decisionPage('Link not valid', 'This approval link is not recognised. It may have already been used. Open the CRM to see the request.', 'bad');
  }

  if (new Date(row.token_expires_at).getTime() < Date.now()) {
    if (row.status === 'pending') await db.from('crm_export_requests').update({ status: 'expired' }).eq('id', row.id);
    return decisionPage('Link expired', `This link has expired. ${esc(row.requester_name)} will need to request the export again.`, 'bad');
  }

  if (row.status !== 'pending') {
    return decisionPage(
      'Already answered',
      `This request is already <strong>${esc(row.status)}</strong>. Nothing has changed.`,
      'bad',
    );
  }

  const now = new Date();
  const patch = action === 'approve'
    ? {
        status: 'approved',
        approved_at: now.toISOString(),
        approval_expires_at: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
        token_used_at: now.toISOString(),
      }
    : { status: 'denied', denied_at: now.toISOString(), token_used_at: now.toISOString() };

  // Guarded on status so two clicks on the same link cannot both land.
  const { data: updated, error } = await db
    .from('crm_export_requests').update(patch).eq('id', row.id).eq('status', 'pending').select('id');
  if (error || !updated?.length) {
    return decisionPage('Already answered', 'This request was answered a moment ago. Nothing has changed.', 'bad');
  }

  await writeAuditLog({
    actorId: row.requester_id,           // no signed-in actor on this path
    action: action === 'approve' ? 'export_approved' : 'export_denied',
    targetType: 'crm_export_requests',
    targetId: row.id,
    metadata: {
      via: 'email_token',
      requester: row.requester_name,
      scope_label: row.scope_label,
      row_count: row.row_count,
    },
    req,
  });

  return action === 'approve'
    ? decisionPage(
        'Export approved',
        `${esc(row.requester_name)} can now download ${esc(row.scope_label)}. The approval is good for one download in the next 30 minutes, then closes on its own.`,
        'ok',
      )
    : decisionPage(
        'Export denied',
        `${esc(row.requester_name)} has not been sent anything, and cannot download this export.`,
        'bad',
      );
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
