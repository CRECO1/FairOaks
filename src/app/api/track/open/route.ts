import { NextRequest, NextResponse } from 'next/server';
import { escapeLike } from '@/lib/like-escape';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { rateLimit } from '@/lib/ratelimit';
import { pushEmailOpen } from '@/lib/notify';

const AUTO_OPEN_WINDOW_MS = 20_000;
// One "open" = a burst of loads. The pixel is marked no-store, so Gmail's proxy (and phone / desktop clients) re-fetch it every time the
// message is shown — a day of that read as "opened 208×". A load only counts as a new open after this long with no loads at all.
const OPEN_SESSION_GAP_MS = 30 * 60_000;

function classifyAgent(ua: string | null): string {
  if (!ua) return 'other';
  if (/GoogleImageProxy/i.test(ua)) return 'gmail-proxy';
  if (/YahooMailProxy|Yahoo Ad monitoring/i.test(ua)) return 'yahoo-proxy';
  if (/proofpoint|mimecast|barracuda|symantec|forcepoint|trendmicro|bot\b|crawl|spider|scan/i.test(ua)) return 'security-scanner';
  return 'other';
}

/** Logs a campaign / action-plan pixel load and says whether it starts a new "open" (no load of this send in the last 30 minutes). */
async function recordSendHit(
  supabase: SupabaseClient, req: NextRequest, kind: 'campaign' | 'action_plan', sendId: string, lastKnownOpenIso: string | null,
): Promise<boolean> {
  let lastMs: number | null = lastKnownOpenIso ? new Date(lastKnownOpenIso).getTime() : null;
  try {
    const { data, error } = await supabase.from('crm_send_open_hits').select('at').eq('kind', kind).eq('send_id', sendId).order('at', { ascending: false }).limit(1);
    if (!error) lastMs = (data as { at: string }[] | null)?.[0]?.at ? new Date((data as { at: string }[])[0].at).getTime() : lastMs;
  } catch { /* log table missing — fall back to the send's own last-open stamp */ }
  const isNew = lastMs === null || Date.now() - lastMs >= OPEN_SESSION_GAP_MS;
  try {
    const ua = req.headers.get('user-agent')?.slice(0, 300) ?? null;
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    await supabase.from('crm_send_open_hits').insert([{
      kind, send_id: sendId, user_agent: ua, agent_kind: classifyAgent(ua), counted: isNew,
      ip_hash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 12) : null,
    }]);
  } catch { /* non-fatal */ }
  return isNew;
}

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
          // Count a new open only after a gap with no loads (see OPEN_SESSION_GAP_MS); every load is still logged.
          const isNewOpen = await recordSendHit(supabase, req, 'campaign', send.id, null);
          if (isNewOpen || !send.opened_at) {
            await supabase.from('crm_campaign_sends').update({
              open_count: (send.open_count ?? 0) + 1,
              ...(send.opened_at ? {} : { opened_at: now }),
            }).eq('id', send.id);
          }

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
          .select('id, client_id, opened_at, last_opened_at, open_count')
          .eq('tracking_id', trackingId)
          .maybeSingle();

        if (send) {
          const isNewOpen = await recordSendHit(supabase, req, 'action_plan', send.id, (send.last_opened_at as string | null) ?? null);
          if (isNewOpen || !send.opened_at) {
            await supabase.from('crm_action_plan_sends').update({
              open_count: (send.open_count ?? 0) + 1,
              ...(send.opened_at ? {} : { opened_at: now }),
              last_opened_at: now,       // each counted open, so the History tab can order by "latest open"
            }).eq('id', send.id);
          }

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
          .select('id, opened_at, last_opened_at, open_count, created_at, email_at, from_email, to_email, subject, deal_id, client_id')
          .eq('tracking_id', trackingId)
          .limit(1);

        const row = rows?.[0];
        // Mail-security scanners and image prefetchers load every image the instant a message lands, and the sender's
        // own first look at the sent copy does too — none of that is the recipient reading it. A hit within the first
        // 20 seconds is ignored; a person opening it takes longer than that.
        const sentAt = row ? new Date((row.email_at as string | null) ?? (row.created_at as string)).getTime() : 0;
        let isNewOpen = false;
        if (row && Date.now() - sentAt >= AUTO_OPEN_WINDOW_MS) {
          // A new open = no load of this email in the last 30 minutes. (Fall back to last_opened_at if the hit log isn't there yet.)
          let lastHitMs: number | null = row.last_opened_at ? new Date(row.last_opened_at as string).getTime() : null;
          try {
            const { data: lastHit, error } = await supabase.from('crm_email_open_hits').select('at').eq('email_id', row.id).order('at', { ascending: false }).limit(1);
            if (!error) lastHitMs = lastHit?.[0]?.at ? new Date(lastHit[0].at as string).getTime() : lastHitMs;
          } catch { /* log table missing — fall back */ }
          isNewOpen = lastHitMs === null || Date.now() - lastHitMs >= OPEN_SESSION_GAP_MS;
        }
        // Record every load (including the ones ignored as scanner pre-fetches) so people can be told apart from proxies later.
        if (row) {
          try {
            const ua = req.headers.get('user-agent')?.slice(0, 300) ?? null;
            const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
            await supabase.from('crm_email_open_hits').insert([{
              email_id: row.id, user_agent: ua, agent_kind: classifyAgent(ua), counted: isNewOpen,
              ip_hash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 12) : null,
            }]);
          } catch { /* non-fatal */ }
        }
        if (row && isNewOpen) {
          // last_opened_at (2026-10-27) lets the deal card say "opened 3× · last Tue 2:14 PM".
          await supabase.from('crm_deal_emails').update({
            open_count: (row.open_count ?? 0) + 1,
            last_opened_at: now,
            ...(row.opened_at ? {} : { opened_at: now }),
          }).eq('id', row.id);

          // First real open: tell whoever sent it (bell) — "Hina opened BOV for 104 & 106 Main".
          if (!row.opened_at && (row.deal_id || row.client_id)) {
            const sender = String(row.from_email ?? '').match(/<([^>]+)>/)?.[1] ?? String(row.from_email ?? '');
            // Who sent it: the owner of the Gmail account it went out from (a broker's CRM login can differ from the address they
            // send with — Zack logs in as info@… and sends as zack@…), falling back to a profile with that email.
            const addr = escapeLike(sender.trim().toLowerCase().replace(/[,()%]/g, ''));
            const { data: conn } = await supabase.from('gmail_connections').select('user_id').or(`gmail_email.ilike.${addr},email.ilike.${addr}`).limit(1);
            let recipientId: string | null = (conn?.[0]?.user_id as string | undefined) ?? null;
            if (!recipientId) recipientId = ((await supabase.from('crm_profiles').select('id').ilike('email', addr).maybeSingle()).data?.id as string | undefined) ?? null;
            if (recipientId) {
              // Name the person whose copy this is. For an email sent to several people "separately" every copy shares the same deal/contact,
              // so the card's name would credit the wrong person — look the recipient of THIS copy up by address first, then fall back.
              let who = '';
              const toFirst = String(row.to_email ?? '').split(',')[0] ?? '';
              const toAddr = (toFirst.match(/<([^>]+)>/)?.[1] ?? toFirst).trim().toLowerCase();
              if (toAddr.includes('@')) {
                const { data: c } = await supabase.from('crm_clients').select('first_name, last_name').eq('email', toAddr).limit(1);
                who = `${c?.[0]?.first_name ?? ''} ${c?.[0]?.last_name ?? ''}`.trim();
              }
              if (!who) who = (toFirst.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? '').trim();
              if (!who && row.client_id) {
                const { data: c } = await supabase.from('crm_clients').select('first_name, last_name').eq('id', row.client_id).maybeSingle();
                who = `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim();
              }
              if (!who && row.deal_id) who = String(((await supabase.from('crm_deals').select('client').eq('id', row.deal_id).maybeSingle()).data?.client as string | undefined) ?? '').trim();
              if (!who) who = toFirst.split('@')[0].trim();
              who = who || 'Someone';
              await supabase.from('crm_notifications').insert([{
                recipient_id: recipientId, sender_id: null, type: 'email_open',
                message: `👁 ${who} opened your email: ${String(row.subject ?? '').slice(0, 80)}`,
                entity_type: row.deal_id ? 'deal' : 'contact', entity_id: (row.deal_id ?? row.client_id) as string,
              }]);
              await pushEmailOpen(supabase, { recipientId, name: who, subject: String(row.subject ?? ''), tag: `open:${row.id}`, open: { type: row.deal_id ? 'deal' : 'contact', id: (row.deal_id ?? row.client_id) as string | null } });
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
