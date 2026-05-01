import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

// CT = UTC-5 (CDT summer) / UTC-6 (CST winter). Using -05:00 as default (CDT).
// The Date constructor with an explicit offset handles the UTC conversion correctly.
function computeNextSend(frequency: string, sendDate?: string | null, sendTime?: string | null): string {
  if (frequency === 'one-time' && sendDate) {
    const time = sendTime || '08:00';
    // Parse as Central Time (CDT = -05:00). JS Date will convert to UTC automatically.
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
  const { data, error } = await supabase
    .from('crm_campaign_enrollments')
    .select(`*, client:crm_clients(id, first_name, last_name, email, phone, cell_phone, type, unsubscribed_at)`)
    .eq('campaign_id', id)
    .order('enrolled_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enrollments: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { client_ids, enrolled_by } = await req.json();
  if (!client_ids?.length) return NextResponse.json({ error: 'client_ids required' }, { status: 400 });

  const supabase = adminClient();
  // Get campaign details including send_date and send_time for one-time campaigns
  const { data: campaign } = await supabase.from('crm_campaigns').select('frequency, status, send_date, send_time').eq('id', id).single();
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const next_send_at = campaign.status === 'active'
    ? computeNextSend(campaign.frequency, campaign.send_date, campaign.send_time)
    : null;

  const rows = client_ids.map((client_id: string) => ({
    campaign_id: id,
    client_id,
    enrolled_by: enrolled_by ?? null,
    next_send_at,
    active: true,
  }));

  const { data, error } = await supabase
    .from('crm_campaign_enrollments')
    .upsert(rows, { onConflict: 'campaign_id,client_id', ignoreDuplicates: false })
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enrolled: data?.length ?? 0 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { client_id } = await req.json();
  const supabase = adminClient();
  const { error } = await supabase
    .from('crm_campaign_enrollments')
    .update({ active: false })
    .eq('campaign_id', id)
    .eq('client_id', client_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
