/**
 * PATCH /api/crm/export-requests/[id] — the owner answers, from inside the CRM.
 *
 * Same decision as the emailed links, reached a different way. Owner only:
 * an admin must not be able to approve their own export request, which is the
 * whole point of the workflow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmSuperAdmin, forbidden, dbError, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';
import { APPROVAL_TTL_MS } from '@/lib/export-approval';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const owner = await getCrmSuperAdmin(req);
  if (!owner) return forbidden('Only the account owner can approve or deny an export.');

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== 'approve' && action !== 'deny') {
    return NextResponse.json({ error: "action must be 'approve' or 'deny'" }, { status: 400 });
  }

  const db = adminClient();
  const { data: reqRow } = await db
    .from('crm_export_requests')
    .select('id, status, requester_name, scope_label, row_count')
    .eq('id', id).single();
  if (!reqRow) return notFound();

  // Only a pending request is still a question. Anything else has been answered,
  // used or has lapsed, and re-answering it would quietly reopen a closed door.
  if (reqRow.status !== 'pending') {
    return NextResponse.json(
      { error: `This request is already ${reqRow.status}.`, status: reqRow.status },
      { status: 409 },
    );
  }

  const now = new Date();
  const patch = action === 'approve'
    ? {
        status: 'approved',
        approved_at: now.toISOString(),
        approved_by: owner.id,
        approval_expires_at: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
      }
    : { status: 'denied', denied_at: now.toISOString(), denied_by: owner.id };

  const { error } = await db.from('crm_export_requests').update(patch).eq('id', id).eq('status', 'pending');
  if (error) return dbError('export-requests:decide', error);

  await writeAuditLog({
    actorId: owner.id,
    action: action === 'approve' ? 'export_approved' : 'export_denied',
    targetType: 'crm_export_requests',
    targetId: id,
    metadata: {
      via: 'crm',
      requester: reqRow.requester_name,
      scope_label: reqRow.scope_label,
      row_count: reqRow.row_count,
    },
    req,
  });

  return NextResponse.json({
    status: action === 'approve' ? 'approved' : 'denied',
    expiresAt: action === 'approve' ? (patch as { approval_expires_at: string }).approval_expires_at : null,
  });
}
