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
};

// Once an address has hard-failed, a later "delivered" for the same message must
// not quietly overwrite it, so states only ever move forward.
const RANK: Record<string, number> = { delayed: 1, delivered: 2, opened: 3, clicked: 4, complained: 5, bounced: 6 };

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

  let payload: { type?: string; created_at?: string; data?: { email_id?: string; to?: string[] } };
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const mapped = EVENT_MAP[payload.type ?? ''];
  const emailId = payload.data?.email_id;
  // Anything else on the account (campaigns, action plans) is not ours to record.
  if (!mapped || !emailId) return NextResponse.json({ ok: true, ignored: true });

  const supabase = adminClient();
  const { data: signer } = await supabase.from('crm_envelope_signers')
    .select('id, envelope_id, email, email_status, email_opened_at')
    .eq('last_email_id', emailId).maybeSingle();
  if (!signer) return NextResponse.json({ ok: true, ignored: true });

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
