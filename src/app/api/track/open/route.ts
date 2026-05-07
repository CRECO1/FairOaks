import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/ratelimit';

// 1×1 transparent GIF
const TRANSPARENT_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export async function GET(req: NextRequest) {
  // Rate-limit to prevent pixel flooding — fail silently (still return the GIF)
  const rl = await rateLimit(req, 'track');
  if (!rl.success) {
    return new NextResponse(Buffer.from(TRANSPARENT_GIF, 'base64'), {
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
    });
  }
  const trackingId = req.nextUrl.searchParams.get('id');
  const type = req.nextUrl.searchParams.get('type') ?? 'deal'; // 'deal' | 'campaign'

  if (trackingId) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const now = new Date().toISOString();

      if (type === 'campaign') {
        // Look up the campaign send
        const { data: send } = await supabase
          .from('crm_campaign_sends')
          .select('id, client_id, campaign_id, opened_at, open_count')
          .eq('tracking_id', trackingId)
          .maybeSingle();

        if (send) {
          // Update open stats on the send record
          await supabase.from('crm_campaign_sends').update({
            open_count: (send.open_count ?? 0) + 1,
            ...(send.opened_at ? {} : { opened_at: now }),
          }).eq('id', send.id);

          // First open only: add "Opened Email" tag to the contact
          if (!send.opened_at && send.client_id) {
            const { data: client } = await supabase
              .from('crm_clients')
              .select('id, tags')
              .eq('id', send.client_id)
              .maybeSingle();

            if (client) {
              const existingTags: string[] = client.tags ?? [];
              if (!existingTags.includes('Opened Email')) {
                await supabase.from('crm_clients').update({
                  tags: [...existingTags, 'Opened Email'],
                }).eq('id', send.client_id);
              }
            }
          }
        }
      } else {
        // Original deal email tracking
        const { data: rows } = await supabase
          .from('crm_deal_emails')
          .select('id, opened_at, open_count')
          .eq('tracking_id', trackingId)
          .limit(1);

        const row = rows?.[0];
        if (row) {
          await supabase.from('crm_deal_emails').update({
            open_count: (row.open_count ?? 0) + 1,
            ...(row.opened_at ? {} : { opened_at: now }),
          }).eq('id', row.id);
        }
      }
    } catch {
      // Non-fatal — always return the pixel
    }
  }

  const gif = Buffer.from(TRANSPARENT_GIF, 'base64');
  return new NextResponse(gif, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
