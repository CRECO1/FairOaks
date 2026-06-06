import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized, forbidden } from '@/lib/crm-auth';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  const hint   = req.nextUrl.searchParams.get('hint') ?? ''; // specific Gmail address to connect
  const bu     = req.nextUrl.searchParams.get('bu') ?? '';   // business unit to return to
  const retry  = req.nextUrl.searchParams.get('retry') === '1'; // auto-retry after no_refresh_token
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  // Only the authenticated agent can initiate their own OAuth flow
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  if (caller.id !== userId) return forbidden('Cannot initiate OAuth for another user');

  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = 'https://crm.vultstack.com/api/gmail/callback';

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId!);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  // When a hint is provided (adding a second account), force account picker + full consent
  // so Google always issues a fresh refresh_token for the new account.
  // Without select_account, Google may silently pick the already-signed-in account.
  url.searchParams.set('prompt', hint ? 'select_account consent' : 'consent');
  // Encode userId + business unit + retry flag into state
  const state = bu ? `${userId}|${bu}${retry ? '|retry' : ''}` : userId;
  url.searchParams.set('state', state);
  // login_hint pre-selects the target account in the picker
  if (hint) url.searchParams.set('login_hint', hint);

  return NextResponse.redirect(url.toString());
}
