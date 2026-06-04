import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

/**
 * Convert a Chicago local date+time string to a UTC ISO string.
 * Uses Intl.DateTimeFormat to detect the correct CDT/CST offset for the given date.
 */
function chicagoLocalToUTC(dateStr: string, timeStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  // Treat as UTC temporarily to query Intl for the Chicago offset at this moment
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(probe).reduce<Record<string, number>>((a, p) => {
    if (p.type !== 'literal') a[p.type] = parseInt(p.value, 10);
    return a;
  }, {});
  const hrNorm = parts.hour === 24 ? 0 : parts.hour;
  const chiAsUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, hrNorm, parts.minute, parts.second ?? 0);
  const offsetMs = probe.getTime() - chiAsUtcMs;
  return new Date(probe.getTime() + offsetMs).toISOString();
}

function computeNextSend(frequency: string, sendDate?: string | null, sendTime?: string | null): string {
  if (frequency === 'one-time' && sendDate) {
    const time = sendTime || '08:00';
    // Convert Chicago local time → UTC using Intl (handles CDT/CST automatically — no library needed)
    return chicagoLocalToUTC(sendDate, time);
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
    .from('crm_campaign_enrollments')
    .select(`*, client:crm_clients(id, first_name, last_name, email, phone, cell_phone, type, unsubscribed_at)`)
    .eq('campaign_id', id)
    .order('enrolled_at', { ascending: false });
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ enrollments: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

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

  const rows = (client_ids as string[]).map((client_id) => ({
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

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ enrolled: data?.length ?? 0 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { id } = await params;
  const { client_id } = await req.json();
  const supabase = adminClient();
  const { error } = await supabase
    .from('crm_campaign_enrollments')
    .update({ active: false })
    .eq('campaign_id', id)
    .eq('client_id', client_id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
