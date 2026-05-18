import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';

export async function GET(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const userId = req.nextUrl.searchParams.get('userId') ?? user.id;
  if (userId !== user.id) {
    return NextResponse.json({ error: 'Cannot initiate OAuth for another user' }, { status: 403 });
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/youtube/callback`,
    scope: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    state: userId,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
