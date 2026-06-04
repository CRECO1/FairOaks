import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decryptToken } from '@/lib/token-crypto';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: connections } = await supabase
    .from('social_connections')
    .select('*')
    .eq('is_active', true);

  if (!connections?.length) {
    return NextResponse.json({ synced: 0 });
  }

  const today = new Date().toISOString().split('T')[0];
  let synced = 0;

  for (const conn of connections) {
    try {
      let metrics: Record<string, number> = {};
      // Decrypt token once per connection — used in all platform API calls below
      const token = decryptToken(conn.access_token);

      if (conn.platform === 'facebook') {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/${conn.page_id}?fields=fan_count,followers_count&access_token=${token}`
        );
        const data = await res.json();
        metrics = { followers: data.fan_count || 0 };
      } else if (conn.platform === 'instagram') {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/${conn.platform_account_id}?fields=followers_count,media_count&access_token=${token}`
        );
        const data = await res.json();
        metrics = { followers: data.followers_count || 0, posts_count: data.media_count || 0 };
      } else if (conn.platform === 'linkedin') {
        // LinkedIn follower count via organization stats
        const res = await fetch(
          `https://api.linkedin.com/v2/networkSizes/${conn.platform_account_id}?edgeType=CompanyFollowedByMember`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        metrics = { followers: data.firstDegreeSize || 0 };
      } else if (conn.platform === 'twitter') {
        const res = await fetch(
          `https://api.twitter.com/2/users/${conn.platform_account_id}?user.fields=public_metrics`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        metrics = {
          followers: data.data?.public_metrics?.followers_count || 0,
          following: data.data?.public_metrics?.following_count || 0,
        };
      } else if (conn.platform === 'youtube') {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${conn.page_id}&key=${process.env.GOOGLE_API_KEY}`
        );
        const data = await res.json();
        const stats = data.items?.[0]?.statistics;
        metrics = {
          followers: parseInt(stats?.subscriberCount || '0'),
          posts_count: parseInt(stats?.videoCount || '0'),
          impressions: parseInt(stats?.viewCount || '0'),
        };
      }

      // Upsert analytics record
      await supabase.from('social_analytics').upsert({
        connection_id: conn.id,
        date: today,
        ...metrics,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'connection_id,date' });

      // Update follower count on connection
      if (metrics.followers) {
        await supabase
          .from('social_connections')
          .update({ followers_count: metrics.followers, updated_at: new Date().toISOString() })
          .eq('id', conn.id);
      }

      synced++;
    } catch (e: unknown) {
      console.error(`Analytics sync failed for ${conn.platform} ${conn.account_name}:`, e instanceof Error ? e.message : String(e));
    }
  }

  return NextResponse.json({ synced, date: today });
}
