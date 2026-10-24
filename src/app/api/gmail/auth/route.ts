import { NextRequest, NextResponse } from 'next/server';
import { getCrmProfileUser, unauthorized, forbidden } from '@/lib/crm-auth';
import { signOAuthState } from '@/lib/oauth-state';

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
  const buRaw  = req.nextUrl.searchParams.get('bu') ?? '';   // business unit to return to
  const bu     = buRaw === 'commercial' || buRaw === 'residential' ? buRaw : ''; // allow-listed: it becomes part of a redirect path
  const retry  = req.nextUrl.searchParams.get('retry') === '1'; // auto-retry after no_refresh_token
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  // Only the authenticated agent can initiate their own OAuth flow
  const caller = await getCrmProfileUser();
  if (!caller) return unauthorized();
  if (caller.id !== userId) return forbidden('Cannot initiate OAuth for another user');

  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const baseUrl     = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.fairoaksrealtygroup.com').replace(/[\r\n\s]+$/, '');
  const redirectUri = `${baseUrl}/api/gmail/callback`;

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId!);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  // Always force the account picker so the user can choose which Gmail to connect.
  // 'select_account consent' shows the chooser AND ensures a refresh_token is issued.
  url.searchParams.set('prompt', 'select_account consent');
  // CSRF / account-linking: `state` is an HMAC-signed, expiring blob carrying the initiating user's id, and the
  // callback additionally requires the logged-in session to be that same user. (The old "nonce also in a cookie"
  // check proved nothing: both values came from the requester's own browser, so a forged callback passed.)
  const { state, nonce } = signOAuthState({ uid: userId, bu, retry });
  url.searchParams.set('state', state);
  // login_hint pre-selects the target account in the picker
  if (hint) url.searchParams.set('login_hint', hint);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set('gmail_oauth_nonce', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/gmail',
    maxAge: 600, // 10 minutes to complete the flow
  });
  return res;
}
