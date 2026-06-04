import { NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { decryptToken, encryptToken } from '@/lib/token-crypto';

/**
 * GET /api/crm/social/fix-instagram
 * One-time fix: uses the stored Facebook page token to discover the correct
 * numeric Instagram Business Account ID and updates the instagram connection.
 */
export async function GET() {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const supabase = adminClient();

  // Get the Facebook connection to get the page token + page ID
  const { data: fbConn } = await supabase
    .from('social_connections')
    .select('*')
    .eq('agent_id', user.id)
    .eq('platform', 'facebook')
    .eq('is_active', true)
    .maybeSingle();

  if (!fbConn) return NextResponse.json({ error: 'No active Facebook connection found' }, { status: 404 });

  const pageToken = decryptToken(fbConn.access_token);
  const pageId = fbConn.page_id || fbConn.platform_account_id;

  const logs: string[] = [`Using Facebook page ID: ${pageId}`];
  let igAccountId: string | undefined;
  let igUsername: string | undefined;

  // Attempt 1: instagram_business_account from page fields
  const r1 = await fetch(`https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`);
  const d1 = await r1.json();
  igAccountId = d1.instagram_business_account?.id;
  logs.push(`Attempt 1 (instagram_business_account): ${JSON.stringify(d1)}`);

  // Attempt 2: connected_instagram_account
  if (!igAccountId) {
    const r2 = await fetch(`https://graph.facebook.com/v18.0/${pageId}?fields=connected_instagram_account&access_token=${pageToken}`);
    const d2 = await r2.json();
    igAccountId = d2.connected_instagram_account?.id;
    logs.push(`Attempt 2 (connected_instagram_account): ${JSON.stringify(d2)}`);
  }

  // Attempt 3: /instagram_accounts edge
  if (!igAccountId) {
    const r3 = await fetch(`https://graph.facebook.com/v18.0/${pageId}/instagram_accounts?access_token=${pageToken}`);
    const d3 = await r3.json();
    igAccountId = d3.data?.[0]?.id;
    logs.push(`Attempt 3 (instagram_accounts edge): ${JSON.stringify(d3)}`);
  }

  // Attempt 4: /me/accounts with instagram_business_account field using refresh_token (user token)
  if (!igAccountId && fbConn.refresh_token) {
    const userToken = decryptToken(fbConn.refresh_token);
    const r4 = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,instagram_business_account&access_token=${userToken}`);
    const d4 = await r4.json();
    const page = d4.data?.find((p: { id: string }) => p.id === pageId);
    igAccountId = page?.instagram_business_account?.id;
    logs.push(`Attempt 4 (user token /me/accounts): ${JSON.stringify(d4)}`);
  }

  if (!igAccountId) {
    return NextResponse.json({
      error: 'Could not find Instagram Business Account ID connected to this Facebook Page.',
      hint: 'Make sure your Instagram account is connected as a Business Account in Facebook Business Suite → Settings → Instagram.',
      logs,
    }, { status: 404 });
  }

  // Get Instagram account details
  const igInfoRes = await fetch(`https://graph.facebook.com/v18.0/${igAccountId}?fields=name,username&access_token=${pageToken}`);
  const igInfo = await igInfoRes.json();
  igUsername = igInfo.username || igInfo.name;
  logs.push(`Instagram account: ${JSON.stringify(igInfo)}`);

  // Update the instagram connection with the correct numeric ID
  const { error: updateError } = await supabase
    .from('social_connections')
    .update({
      platform_account_id: igAccountId,
      account_name: igUsername || igAccountId,
      access_token: encryptToken(pageToken), // re-encrypt with current key
      updated_at: new Date().toISOString(),
    })
    .eq('agent_id', user.id)
    .eq('platform', 'instagram');

  if (updateError) {
    return NextResponse.json({ error: updateError.message, logs }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    instagram_account_id: igAccountId,
    username: igUsername,
    logs,
  });
}
