import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { userRateLimit } from '@/lib/user-ratelimit';
import { canAct, canSee, composeMatchEmail, deliverMatchEmail, loadTenant } from '@/lib/matchmaker/server';

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * POST /api/crm/matchmaker/email   { client_id, audience: 'agent' | 'client', property_ids?: string[], note?: string, send?: boolean }
 *
 * Writes the Matchmaker email for one tenant's saved search. WITHOUT `send` it only returns the email (subject, html, text, to) so the
 * agent can read it first — nothing leaves. WITH `send: true`:
 *   audience 'agent'  — the signed-in agent's own alert, through Resend, to their own inbox.
 *   audience 'client' — the tenant's email, from the agent's own Gmail (their signature, logged on the contact, open-tracked).
 *                       Only for a tenant the agent owns or has been added to.
 * Without property_ids it takes the best matches (strong/good fits); with them, exactly those, in that order.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => null) as { client_id?: unknown; audience?: unknown; property_ids?: unknown; note?: unknown; send?: unknown } | null;
  const clientId = String(b?.client_id ?? '');
  const audience = b?.audience === 'client' ? 'client' : b?.audience === 'agent' ? 'agent' : null;
  if (!UUID.test(clientId) || !audience) return NextResponse.json({ error: 'client_id and audience are required' }, { status: 400 });
  const propertyIds = Array.isArray(b?.property_ids) ? [...new Set(b!.property_ids.map(String))].filter(i => UUID.test(i)).slice(0, 20) : undefined;
  const note = typeof b?.note === 'string' ? b.note.slice(0, 2000) : undefined;
  const send = b?.send === true;

  const db = adminClient();
  const { row, setupMissing } = await loadTenant(db, clientId);
  if (setupMissing) return NextResponse.json({ setup_needed: true, error: 'Matchmaker needs a one-time database update first. Ask an admin to run it.' }, { status: 503 });
  if (!row || !canSee(ctx, row)) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  if (send && audience === 'client' && !canAct(ctx, row)) return NextResponse.json({ error: 'That tenant isn’t assigned to you.' }, { status: 403 });
  if (send && !(await userRateLimit('matchmaker-email', ctx.userId, 40, '1 h')).success) return NextResponse.json({ error: 'Too many Matchmaker emails this hour. Try again later.' }, { status: 429 });

  const composed = await composeMatchEmail(db, row, { brokerId: ctx.userId, audience, propertyIds, note });
  if ('error' in composed) return NextResponse.json({ error: composed.error }, { status: composed.status });

  if (!send) {
    return NextResponse.json({ ok: true, preview: true, subject: composed.email.subject, html: composed.email.html, text: composed.email.text, to: composed.to, count: composed.results.length, total: composed.total, property_ids: composed.results.map(r => r.property.id) });
  }
  const sent = await deliverMatchEmail(db, ctx, row, composed, audience);
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status });
  return NextResponse.json({ ok: true, sent: true, to: sent.to, count: composed.results.length, subject: composed.email.subject });
}
