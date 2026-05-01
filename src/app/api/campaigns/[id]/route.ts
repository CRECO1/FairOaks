import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

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
  const { id } = await params;
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_campaigns').select('*').eq('id', id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ campaign: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const supabase = adminClient();

  // Fetch current campaign to detect activation
  const { data: existing } = await supabase.from('crm_campaigns').select('status, frequency, send_date, send_time').eq('id', id).single();

  const { data, error } = await supabase
    .from('crm_campaigns')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
  const { id } = await params;
  const supabase = adminClient();
  const { error } = await supabase.from('crm_campaigns').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
