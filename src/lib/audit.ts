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
  | 'export_contacts';

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
