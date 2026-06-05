import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { decryptToken } from '@/lib/token-crypto';

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = adminClient();
  const { data: conn } = await supabase
    .from('social_connections')
    .select('access_token, refresh_token, page_id, platform_account_id')
    .eq('platform', 'facebook')
    .eq('is_active', true)
    .eq('account_name', 'Fair Oaks Realty Group')
    .maybeSingle();

  if (!conn) return NextResponse.json({ error: 'No active Facebook connection found' });

  const pageToken = decryptToken(conn.access_token);
  const pageId = conn.page_id;

  const results: Record<string, unknown> = { pageId };

  // Try every possible field combination to find the Instagram account
  const fields = [
    'instagram_business_account',
    'connected_instagram_account',
    'instagram_accounts',
  ];

  for (const field of fields) {
    const r = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}?fields=${field}&access_token=${pageToken}`
    );
    results[field] = await r.json();
  }

  // Try the instagram_accounts edge
  const edgeR = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/instagram_accounts?access_token=${pageToken}`
  );
  results['instagram_accounts_edge'] = await edgeR.json();

  // Try with user token if available
  if (conn.refresh_token) {
    const userToken = decryptToken(conn.refresh_token);
    const userR = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,instagram_business_account&access_token=${userToken}`
    );
    results['me_accounts_with_user_token'] = await userR.json();

    const igR = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${userToken}`
    );
    results['page_ig_with_user_token'] = await igR.json();
  }

  return NextResponse.json(results, { status: 200 });
}
