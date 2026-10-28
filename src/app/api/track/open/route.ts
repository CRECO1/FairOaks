import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/ratelimit';

const AUTO_OPEN_WINDOW_MS = 20_000;

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
      } else if (type === 'action_plan') {
        // Action-plan email tracking (welcome sequence, nurture, closed-deal congrats)
        const { data: send } = await supabase
          .from('crm_action_plan_sends')
          .select('id, client_id, opened_at, open_count')
          .eq('tracking_id', trackingId)
          .maybeSingle();

        if (send) {
          await supabase.from('crm_action_plan_sends').update({
            open_count: (send.open_count ?? 0) + 1,
            ...(send.opened_at ? {} : { opened_at: now }),
            last_opened_at: now,       // every open, so the History tab can order by "latest open"
          }).eq('id', send.id);

          // First open only: tag the contact
          if (!send.opened_at && send.client_id) {
            const { data: client } = await supabase
              .from('crm_clients').select('id, tags').eq('id', send.client_id).maybeSingle();
            if (client) {
              const existingTags: string[] = client.tags ?? [];
              if (!existingTags.includes('Opened Email')) {
                await supabase.from('crm_clients').update({ tags: [...existingTags, 'Opened Email'] }).eq('id', send.client_id);
              }
            }
          }
        }
      } else {
        // Original deal email tracking
        const { data: rows } = await supabase
          .from('crm_deal_emails')
          .select('id, opened_at, open_count, created_at, email_at, from_email, to_email, subject, deal_id, client_id')
          .eq('tracking_id', trackingId)
          .limit(1);

        const row = rows?.[0];
        // Mail-security scanners and image prefetchers load every image the instant a message lands, and the sender's
        // own first look at the sent copy does too — none of that is the recipient reading it. A hit within the first
        // 20 seconds is ignored; a person opening it takes longer than that.
        const sentAt = row ? new Date((row.email_at as string | null) ?? (row.created_at as string)).getTime() : 0;
        if (row && Date.now() - sentAt >= AUTO_OPEN_WINDOW_MS) {
          // last_opened_at (2026-10-27) lets the deal card say "opened 3× · last Tue 2:14 PM".
          await supabase.from('crm_deal_emails').update({
            open_count: (row.open_count ?? 0) + 1,
            last_opened_at: now,
            ...(row.opened_at ? {} : { opened_at: now }),
          }).eq('id', row.id);

          // First real open: tell whoever sent it (bell) — "Hina opened BOV for 104 & 106 Main".
          if (!row.opened_at && (row.deal_id || row.client_id)) {
            const sender = String(row.from_email ?? '').match(/<([^>]+)>/)?.[1] ?? String(row.from_email ?? '');
            const { data: prof } = await supabase.from('crm_profiles').select('id').ilike('email', sender.trim()).maybeSingle();
            if (prof?.id) {
              const first = String(row.to_email ?? '').split(',')[0] ?? '';
              const who = (first.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? first.split('@')[0]).trim() || 'Someone';
              await supabase.from('crm_notifications').insert([{
                recipient_id: prof.id, sender_id: null, type: 'email_open',
                message: `👁 ${who} opened your email: ${String(row.subject ?? '').slice(0, 80)}`,
                entity_type: row.deal_id ? 'deal' : 'contact', entity_id: (row.deal_id ?? row.client_id) as string,
              }]);
            }
          }
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
