import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Fields an agent is allowed to set on a campaign (prevents mass-assignment)
const ALLOWED_PATCH_FIELDS = new Set([
  'name', 'description', 'type', 'frequency', 'send_date', 'send_time',
  'send_day_of_month', 'status', 'email_subject', 'email_body',
  'sms_body', 'sender_agent_id', 'created_by',
]);

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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { id } = await params;
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_campaigns')
    .select('*, sender_agent:crm_profiles!crm_campaigns_sender_agent_id_fkey(id, first_name, last_name, email, phone)')
    .eq('id', id).single();
  if (error) { console.error("[api] not found error:", error); return NextResponse.json({ error: "Resource not found." }, { status: 404 }); }
  return NextResponse.json({ campaign: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { id } = await params;
  const body = await req.json();

  // Validate size of large text fields
  if (typeof body.email_body === 'string' && body.email_body.length > 100_000) {
    return NextResponse.json({ error: 'email_body must be 100,000 characters or fewer' }, { status: 400 });
  }
  if (typeof body.email_subject === 'string' && body.email_subject.length > 500) {
    return NextResponse.json({ error: 'email_subject must be 500 characters or fewer' }, { status: 400 });
  }
  if (body.send_day_of_month !== undefined && body.send_day_of_month !== null) {
    const day = parseInt(body.send_day_of_month, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return NextResponse.json({ error: 'send_day_of_month must be 1–31' }, { status: 400 });
    }
  }

  // Strip any fields not in the allowlist (prevents mass-assignment)
  const safeBody: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_PATCH_FIELDS.has(key)) safeBody[key] = body[key];
  }

  const supabase = adminClient();

  // Fetch current campaign to detect activation
  const { data: existing } = await supabase.from('crm_campaigns').select('status, frequency, send_date, send_time').eq('id', id).single();

  // Coerce send_day_of_month to integer if provided as a string
  const patchPayload = { ...safeBody, updated_at: new Date().toISOString() };
  if ('send_day_of_month' in patchPayload) {
    patchPayload.send_day_of_month = patchPayload.send_day_of_month
      ? parseInt(patchPayload.send_day_of_month as string, 10)
      : null;
  }

  const { data, error } = await supabase
    .from('crm_campaigns')
    .update(patchPayload)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  // If campaign just became active, schedule any enrollments that have no next_send_at
  if (existing?.status !== 'active' && body.status === 'active' && data) {
    const next_send_at = computeNextSend(data.frequency, data.send_date, data.send_time);
    await supabase
      .from('crm_campaign_enrollments')
      .update({ next_send_at })
      .eq('campaign_id', id)
      .eq('active', true)
      .is('next_send_at', null);
  }

  return NextResponse.json({ campaign: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Campaign deletion is admin-only — it de-enrolls all contacts and drops queued sends
  const admin = await getCrmAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  const { id } = await params;
  const supabase = adminClient();
  const { error } = await supabase.from('crm_campaigns').delete().eq('id', id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
