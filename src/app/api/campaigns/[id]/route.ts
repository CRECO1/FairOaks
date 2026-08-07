import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmAdmin, unauthorized, forbidden, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Fields an agent is allowed to set on a campaign (prevents mass-assignment)
const ALLOWED_PATCH_FIELDS = new Set([
  'name', 'description', 'type', 'frequency', 'send_date', 'send_time',
  'send_day_of_month', 'status', 'email_subject', 'email_body',
  'sms_body', 'project_id',
]);

// Ownership/identity fields. Reassigning an owner or spoofing the "send as" agent is an
// admin action (both dropdowns are already admin-only in the UI) — an agent PATCHing a
// campaign must never be able to set them, so they stay out of ALLOWED_PATCH_FIELDS.
const ADMIN_ONLY_PATCH_FIELDS = new Set(['created_by', 'sender_agent_id']);

function computeNextSend(frequency: string, sendDate?: string | null, sendTime?: string | null): string {
  if (frequency === 'one-time' && sendDate) {
    const time = sendTime || '08:00';
    return new Date(`${sendDate}T${time}:00-05:00`).toISOString();
  }
  const now = new Date();
  switch (frequency) {
    case 'monthly':     now.setMonth(now.getMonth() + 1); break;
    case 'quarterly':   now.setMonth(now.getMonth() + 3); break;
    case 'semi-annual': now.setMonth(now.getMonth() + 6); break;
    case 'annual':      now.setFullYear(now.getFullYear() + 1); break;
  }
  return now.toISOString();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_campaigns')
    .select('*, sender_agent:crm_profiles!crm_campaigns_sender_agent_id_fkey(id, first_name, last_name, email, phone)')
    .eq('id', id).single();
  if (error || !data) { console.error("[api] not found error:", error); return NextResponse.json({ error: "Resource not found." }, { status: 404 }); }
  if (!isAdminRole(ctx.role) && data.business_unit !== ctx.businessUnit) return notFound('Resource not found.');
  return NextResponse.json({ campaign: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const body = await req.json();

  // Validate size of large text fields
  if (typeof body.email_body === 'string' && body.email_body.length > 100_000) {
    return NextResponse.json({ error: 'email_body must be 100,000 characters or fewer' }, { status: 400 });
  }
  if (typeof body.email_subject === 'string' && body.email_subject.length > 500) {
    return NextResponse.json({ error: 'email_subject must be 500 characters or fewer' }, { status: 400 });
  }
  if (body.send_day_of_month !== undefined && body.send_day_of_month !== null && body.send_day_of_month !== '') {
    const day = parseInt(body.send_day_of_month, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return NextResponse.json({ error: 'send_day_of_month must be 1–31' }, { status: 400 });
    }
  }

  const supabase = adminClient();

  // Fetch current campaign to detect activation + enforce workspace isolation
  const { data: existing } = await supabase
    .from('crm_campaigns')
    .select('status, frequency, send_date, send_time, business_unit, created_by')
    .eq('id', id)
    .single();
  if (!existing) return notFound('Resource not found.');
  const isAdmin = isAdminRole(ctx.role);
  if (!isAdmin && existing.business_unit !== ctx.businessUnit) return notFound('Resource not found.');

  // Activating a campaign starts real sends to real contacts — admins or the campaign's
  // own owner only.
  const isOwner = existing.created_by === ctx.userId;
  if (body.status === 'active' && existing.status !== 'active' && !isAdmin && !isOwner) {
    return forbidden('Forbidden — only the campaign owner or an admin can activate a campaign');
  }

  // Strip any fields not in the allowlist (prevents mass-assignment)
  const safeBody: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_PATCH_FIELDS.has(key)) safeBody[key] = body[key];
    else if (isAdmin && ADMIN_ONLY_PATCH_FIELDS.has(key)) safeBody[key] = body[key];
  }

  // Coerce empty strings to null for date/numeric fields before hitting Postgres
  const patchPayload = { ...safeBody, updated_at: new Date().toISOString() };
  if ('send_day_of_month' in patchPayload) {
    const raw = patchPayload.send_day_of_month;
    const parsed = raw !== null && raw !== undefined && raw !== '' ? parseInt(raw as string, 10) : null;
    patchPayload.send_day_of_month = (parsed !== null && !isNaN(parsed)) ? parsed : null;
  }
  if ('send_date' in patchPayload && (patchPayload.send_date === '' || patchPayload.send_date === undefined)) {
    patchPayload.send_date = null;
  }
  if ('send_time' in patchPayload && (patchPayload.send_time === '' || patchPayload.send_time === undefined)) {
    patchPayload.send_time = null;
  }

  const { data, error } = await supabase
    .from('crm_campaigns')
    .update(patchPayload)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  // Reschedule enrollments when:
  // (a) campaign just became active, OR
  // (b) campaign is already active and send_date / send_time changed
  const justActivated = existing?.status !== 'active' && data?.status === 'active';
  const dateChanged = data?.status === 'active' && (
    'send_date' in body || 'send_time' in body
  );
  if ((justActivated || dateChanged) && data) {
    const next_send_at = computeNextSend(data.frequency, data.send_date, data.send_time);
    if (next_send_at) {
      await supabase
        .from('crm_campaign_enrollments')
        .update({ next_send_at })
        .eq('campaign_id', id)
        .eq('active', true);
    }
  }

  return NextResponse.json({ campaign: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Campaign deletion is admin-only — it de-enrolls all contacts and drops queued sends
  const admin = await getCrmAdmin(req);
  if (!admin) return forbidden();

  const { id } = await params;
  const supabase = adminClient();
  const { error } = await supabase.from('crm_campaigns').delete().eq('id', id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
