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
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  // Only the authenticated agent can initiate their own OAuth flow
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  if (caller.id !== userId) return forbidden('Cannot initiate OAuth for another user');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = 'https://www.fairoaksrealtygroup.com/api/gmail/callback';

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId!);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'select_account consent'); // show account picker + consent so user can add a different account
  url.searchParams.set('state', userId); // pass userId through so callback knows who to store for

  return NextResponse.redirect(url.toString());
}
