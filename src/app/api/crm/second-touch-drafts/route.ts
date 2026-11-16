import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, assertOwnsResource } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { prepareSecondTouchDrafts } from '@/lib/second-touch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/crm/second-touch-drafts { contact_id? } — prepares second-touch email DRAFTS (saved to the listing agent's Drafts; nothing is sent) for the people we
 * reached out to 30+ days ago on the caller's listings (admins: all), up to 25. With contact_id: just that contact, now (no 30-day wait).
 */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => null);
  const only = typeof b?.contact_id === 'string' ? b.contact_id : undefined;
  if (only && !(await assertOwnsResource('crm_clients', only, ctx))) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  const r = await prepareSecondTouchDrafts(adminClient(), { unit: ctx.businessUnit ?? 'commercial', only, limit: 25, agent: { id: ctx.userId, role: ctx.role } });
  return NextResponse.json({ ok: true, ...r });
}
