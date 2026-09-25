import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Resend tells us what happened to each e-sign invite after it left: delivered,
// opened, bounced. Without this we can only ask Resend's API live, and that
// returns the account's last 100 messages — one campaign blast to the contact
// list pushes every signature request out of the window and the history is gone.
// Here it lands in our own tables and stays.

// Resend signs with Svix: HMAC-SHA256 over "<id>.<timestamp>.<body>", secret is
// the base64 part after the whsec_ prefix.
function verify(secret: string, id: string, ts: string, sig: string, body: string): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  // The header carries a space-separated list of "v1,<sig>" — any one may match.
  for (const part of sig.split(' ')) {
    const got = part.split(',')[1];
    if (!got) continue;
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

const EVENT_MAP: Record<string, { status: string; log: string }> = {
  'email.delivered':       { status: 'delivered', log: 'email_delivered' },
  'email.opened':          { status: 'opened',    log: 'email_opened' },
  'email.clicked':         { status: 'clicked',   log: 'email_clicked' },
  'email.bounced':         { status: 'bounced',   log: 'email_bounced' },
  'email.complained':      { status: 'complained', log: 'email_complained' },
  'email.delivery_delayed': { status: 'delayed',  log: 'email_delayed' },
  'email.failed':          { status: 'failed',    log: 'email_failed' },
};

// Once an address has hard-failed, a later "delivered" for the same message must
// not quietly overwrite it, so states only ever move forward.
const RANK: Record<string, number> = { delayed: 1, delivered: 2, opened: 3, clicked: 4, complained: 5, bounced: 6, failed: 7 };

/**
 * Campaign opens/clicks → email_tracking_events.
 *
 * Matches the Resend message id against crm_campaign_sends.provider_id, which
 * the cron already stores on every send, then logs the event against the
 * campaign and contact so the CRM can show click-through rate.
 *
 * Deliberately does NOT touch crm_campaign_sends.opened_at / open_count: those
 * belong to our own tracking pixel. Writing Resend's open there as well would
 * count a single open twice and quietly inflate every open rate in the app.
 *
 * Idempotency rides on the table's UNIQUE(tracking_id). The key is
 * "<send tracking_id>:<event>:<svix id>" — svix keeps the same id across its
 * retries, so a redelivered event collides and is ignored rather than counted
 * again. A genuinely new click carries a new svix id and lands as a new row.
 */
async function recordCampaignEvent(
  supabase: ReturnType<typeof adminClient>,
  payload: { created_at?: string; data?: { click?: { link?: string; ipAddress?: string; userAgent?: string }; link?: string } },
  emailId: string,
  status: string,
  svixId: string,
) {
  // The table's CHECK allows only 'open' and 'click'; delivered/bounced/etc are
  // e-sign-only states and must not be written here.
  const eventType = status === 'clicked' ? 'click' : status === 'opened' ? 'open' : null;
  if (!eventType) return NextResponse.json({ ok: true, ignored: 'not an open/click' });

  const { data: send } = await supabase.from('crm_campaign_sends')
    .select('id, campaign_id, client_id, tracking_id, org_id')
    .eq('provider_id', emailId).maybeSingle();
  if (!send) return NextResponse.json({ ok: true, ignored: 'no matching send' });

  const key = `${send.tracking_id ?? send.id}:${eventType}:${svixId || emailId}`;
  const { error } = await supabase.from('email_tracking_events').insert([{
    tracking_id: key,
    campaign_id: send.campaign_id,
    client_id: send.client_id,
    event_type: eventType,
    url: payload.data?.click?.link ?? payload.data?.link ?? null,
    occurred_at: payload.created_at ?? new Date().toISOString(),
    ip: payload.data?.click?.ipAddress ?? null,
    user_agent: payload.data?.click?.userAgent ?? null,
    org_id: send.org_id ?? null,
  }]);

  // 23505 = unique violation = Resend redelivered an event we already have.
  if (error && (error as { code?: string }).code !== '23505') {
    console.error('[webhooks/resend] campaign event insert failed', error);
    return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, campaign: send.campaign_id, event: eventType, duplicate: !!error });
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const body = await req.text();

  if (secret) {
    const id = req.headers.get('svix-id') ?? '';
    const ts = req.headers.get('svix-timestamp') ?? '';
    const sig = req.headers.get('svix-signature') ?? '';
    if (!id || !ts || !sig || !verify(secret, id, ts, sig, body)) {
      return NextResponse.json({ error: 'bad signature' }, { status: 401 });
    }
    // Reject replays of an old signed payload.
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
      return NextResponse.json({ error: 'stale' }, { status: 401 });
    }
  } else {
    console.warn('[webhooks/resend] RESEND_WEBHOOK_SECRET unset — refusing unverified payload');
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }

  let payload: {
    type?: string; created_at?: string;
    data?: {
      email_id?: string; to?: string[];
      // Resend nests click details; the shape has varied, so read defensively.
      click?: { link?: string; ipAddress?: string; userAgent?: string; timestamp?: string };
      link?: string;
    };
  };
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const mapped = EVENT_MAP[payload.type ?? ''];
  const emailId = payload.data?.email_id;
  if (!mapped || !emailId) return NextResponse.json({ ok: true, ignored: true });

  const supabase = adminClient();
  const { data: signer } = await supabase.from('crm_envelope_signers')
    .select('id, envelope_id, email, email_status, email_opened_at')
    .eq('last_email_id', emailId).maybeSingle();

  // Not an e-sign invite? It may be a campaign send. Falling through here is the
  // whole point: campaign clicks used to hit this endpoint and be dropped, so
  // click-through rate lived only in Resend's dashboard.
  if (!signer) {
    return await recordCampaignEvent(supabase, payload, emailId, mapped.status, req.headers.get('svix-id') ?? '');
  }

  const patch: Record<string, unknown> = {};
  if ((RANK[mapped.status] ?? 0) >= (RANK[signer.email_status ?? ''] ?? 0)) patch.email_status = mapped.status;
  if (mapped.status === 'opened' && !signer.email_opened_at) patch.email_opened_at = payload.created_at ?? new Date().toISOString();
  if (Object.keys(patch).length) await supabase.from('crm_envelope_signers').update(patch).eq('id', signer.id);

  // Resend retries until it gets a 2xx, so the same event can arrive more than
  // once; the log should not grow a duplicate row each time.
  const { data: dupe } = await supabase.from('crm_envelope_events')
    .select('id').eq('signer_id', signer.id).eq('event', mapped.log)
    .contains('meta', { email_id: emailId }).limit(1).maybeSingle();
  if (!dupe) {
    await supabase.from('crm_envelope_events').insert([{
      envelope_id: signer.envelope_id, signer_id: signer.id, event: mapped.log,
      actor: signer.email, meta: { email_id: emailId, via: 'resend' },
    }]);
  }

  return NextResponse.json({ ok: true });
}
