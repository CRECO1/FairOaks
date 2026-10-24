import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * Listing-alert opt-in / opt-out, driven by an unguessable per-row token mailed to the subscriber.
 *
 *   GET  ?action=confirm|unsubscribe&token=<uuid>  → a small page with ONE button (nothing changes yet)
 *   POST ?action=confirm|unsubscribe&token=<uuid>  → does it (also the RFC 8058 one-click List-Unsubscribe target)
 *
 * Why GET only renders: mail scanners and link-preview bots fetch every URL in an email. If GET changed state, a scanner
 * would "confirm" an address its owner never saw, or unsubscribe someone who wanted the mail. Tokens are 122-bit UUIDs, so
 * they can't be guessed or enumerated, and nothing user-supplied is reflected into the page.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">`
    + `<title>${title}</title><div style="font-family:Georgia,serif;max-width:32rem;margin:12vh auto;padding:0 1.25rem;line-height:1.55;color:#1a1a2e">`
    + `<p style="font-size:1.3rem;font-weight:bold;margin:0 0 1rem">Fair Oaks <span style="color:#c9a84c">Realty Group</span></p>${body}</div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
  );
}

function parse(req: NextRequest): { action: 'confirm' | 'unsubscribe'; token: string } | null {
  const action = req.nextUrl.searchParams.get('action');
  const token = req.nextUrl.searchParams.get('token') ?? '';
  if ((action !== 'confirm' && action !== 'unsubscribe') || !UUID.test(token)) return null;
  return { action, token };
}

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

export async function GET(req: NextRequest) {
  const p = parse(req);
  if (!p) return page('Link not valid', '<p>This link is not valid or has expired.</p>', 400);
  const confirm = p.action === 'confirm';
  return page(confirm ? 'Confirm your listing alert' : 'Unsubscribe',
    `<p>${confirm ? 'Confirm that you want new-listing emails from Fair Oaks Realty Group.' : 'Stop receiving new-listing emails from Fair Oaks Realty Group?'}</p>`
    + `<form method="POST" action="/api/listing-alerts/manage?action=${p.action}&token=${p.token}">`
    + `<button style="background:#1a1a2e;color:#fff;border:0;border-radius:8px;padding:12px 24px;font-weight:bold;font-size:1rem;cursor:pointer">${confirm ? 'Yes, send me new listings' : 'Unsubscribe me'}</button></form>`);
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, 'unsubscribe');
  if (!rl.success) return page('Please wait', '<p>Too many requests. Please try again in a little while.</p>', 429);
  const p = parse(req);
  if (!p) return page('Link not valid', '<p>This link is not valid or has expired.</p>', 400);
  const supabase = db();
  if (p.action === 'confirm') {
    const { data, error } = await supabase.from('listing_alerts').update({ confirmed_at: new Date().toISOString() }).eq('confirm_token', p.token).is('confirmed_at', null).select('id');
    if (error) { console.error('[listing-alerts/manage] confirm', error.message); return page('Something went wrong', '<p>Please try the link again in a moment.</p>', 500); }
    // Already confirmed counts as success: a second click or a scanner's POST must not look like a failure.
    if (!data?.length) {
      const { data: row } = await supabase.from('listing_alerts').select('id').eq('confirm_token', p.token).maybeSingle();
      if (!row) return page('Link not valid', '<p>This link is not valid or has expired.</p>', 400);
    }
    return page('You’re all set', '<p>Thanks &mdash; you’ll get an email when a new listing matches your search.</p>');
  }
  const { error } = await supabase.from('listing_alerts').delete().eq('unsubscribe_token', p.token);
  if (error) { console.error('[listing-alerts/manage] unsubscribe', error.message); return page('Something went wrong', '<p>Please try the link again in a moment.</p>', 500); }
  return page('Unsubscribed', '<p>You’re unsubscribed. You won’t receive any more listing alerts.</p>');
}
