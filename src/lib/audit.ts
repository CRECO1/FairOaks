/**
 * Audit logging — records admin actions to the immutable `audit_logs` table.
 * All writes use the service role so they bypass RLS and always succeed.
 * Reads are restricted to admins via RLS policy.
 *
 * SERVER-ONLY: This module uses SUPABASE_SERVICE_ROLE_KEY.
 * Never import this in client components or pages without 'use server'.
 */
import 'server-only';

import { adminClient } from '@/lib/supabase-admin';
import { NextRequest } from 'next/server';

export type AuditAction =
  | 'invite_agent'
  | 'delete_agent'
  | 'reset_password'
  | 'update_profile'
  | 'update_commission'
  | 'delete_deal'
  | 'export_contacts'
  // Retired with the export-approval workflow (2026-09-22): export is now the
  // account owner's alone, so nothing asks and nothing is approved. Kept in the
  // union because historical rows carry these actions and the trail should stay
  // readable — nothing emits them any more.
  | 'export_requested'
  | 'export_approved'
  | 'export_denied'
  // Still emitted, and now more interesting than it was: a non-owner reaching an
  // export endpoint has no button that leads there, so this is someone calling
  // the API directly.
  | 'export_blocked'
  // Copilot oversight: one row per tool the assistant ran, so "what did Brian ask
  // the copilot to do" is answerable. Tool CALLS only — never the chat text; free-text
  // arguments are recorded as field names and lengths, not content.
  | 'copilot_tool'
  // Merging duplicate contacts destroys records, so it's on the audited trail.
  | 'merge_contacts'
  // Anti-scrape: read volume past the alert threshold.
  | 'bulk_read_detected';

interface AuditParams {
  actorId: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  req?: NextRequest;
}

/** Write an audit log entry. Never throws — failures are logged but don't block the response. */
export async function writeAuditLog({
  actorId,
  action,
  targetType,
  targetId,
  metadata = {},
  req,
}: AuditParams): Promise<void> {
  try {
    const ip =
      req?.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req?.headers.get('x-real-ip') ??
      null;

    const supabase = adminClient();
    const { error } = await supabase.from('audit_logs').insert({
      actor_id:    actorId,
      action,
      target_type: targetType ?? null,
      target_id:   targetId   ?? null,
      metadata,
      ip_address:  ip,
    });

    if (error) {
      console.error('[audit] Failed to write audit log:', error.message, { actorId, action });
    }
  } catch (err) {
    console.error('[audit] Unexpected error writing audit log:', err);
  }
}
