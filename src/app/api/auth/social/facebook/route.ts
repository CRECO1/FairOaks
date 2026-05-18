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
    client_id: process.env.FACEBOOK_APP_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/facebook/callback`,
    scope: 'pages_manage_posts,pages_read_engagement,pages_show_list,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights',
    response_type: 'code',
    state: userId,
  });

  return NextResponse.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params}`);
}
