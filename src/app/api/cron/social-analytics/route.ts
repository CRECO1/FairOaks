/**
 * GET /api/cron/social-analytics
 *
 * Daily cron — syncs account-level engagement metrics from each connected
 * social platform and updates per-post engagement on recently published posts.
 *
 * Platform coverage:
 *   Facebook  — page impressions, reach, engaged_users, likes, comments, shares (Page Insights API)
 *   Instagram — followers, media count, per-media likes + comments (instagram_basic scope)
 *   YouTube   — subscribers, views, per-video likes + comments (YouTube Data API)
 *   LinkedIn  — follower count (organization stats)
 *   Twitter   — follower / following counts (public metrics)
 */

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
      const token = decryptToken(conn.access_token);

      // ── Facebook ──────────────────────────────────────────────────────────
      if (conn.platform === 'facebook') {
        // Follower / fan count
        const pageRes = await fetch(
          `https://graph.facebook.com/v18.0/${conn.page_id}?fields=fan_count,followers_count&access_token=${token}`
        );
        const pageData = await pageRes.json();
        const followers = pageData.fan_count || 0;

        // Page Insights — 28-day window for impressions, reach, engaged users
        // period=days_28 gives a single rolling 28-day aggregate value
        const insightMetrics = 'page_impressions,page_impressions_unique,page_engaged_users,page_post_engagements';
        const insightRes = await fetch(
          `https://graph.facebook.com/v18.0/${conn.page_id}/insights` +
          `?metric=${insightMetrics}&period=days_28&access_token=${token}`
        );
        const insightData = await insightRes.json();

        let impressions = 0, reach = 0, engagedUsers = 0, postEngagements = 0;
        if (Array.isArray(insightData.data)) {
          for (const m of insightData.data) {
            const val = m.values?.[m.values.length - 1]?.value ?? 0;
            if (m.name === 'page_impressions')          impressions    = val;
            if (m.name === 'page_impressions_unique')   reach          = val;
            if (m.name === 'page_engaged_users')        engagedUsers   = val;
            if (m.name === 'page_post_engagements')     postEngagements = val;
          }
        }

        // Recent post likes + comments (last 10 posts)
        const postsRes = await fetch(
          `https://graph.facebook.com/v18.0/${conn.page_id}/posts` +
          `?fields=likes.summary(true),comments.summary(true),shares&limit=10&access_token=${token}`
        );
        const postsData = await postsRes.json();
        let totalLikes = 0, totalComments = 0, totalShares = 0;
        if (Array.isArray(postsData.data)) {
          for (const post of postsData.data) {
            totalLikes    += post.likes?.summary?.total_count    ?? 0;
            totalComments += post.comments?.summary?.total_count ?? 0;
            totalShares   += post.shares?.count                  ?? 0;
          }
        }

        // engagement_rate = engaged_users / impressions * 100 (platform standard)
        const engagementRate = impressions > 0
          ? parseFloat(((engagedUsers / impressions) * 100).toFixed(2))
          : (followers > 0 ? parseFloat(((totalLikes + totalComments + totalShares) / followers * 100).toFixed(2)) : 0);

        metrics = { followers, impressions, reach, likes: totalLikes, comments: totalComments, shares: totalShares, engagement_rate: engagementRate };
      }

      // ── Instagram ─────────────────────────────────────────────────────────
      else if (conn.platform === 'instagram') {
        // Account basics
        const igRes = await fetch(
          `https://graph.facebook.com/v18.0/${conn.platform_account_id}` +
          `?fields=followers_count,media_count&access_token=${token}`
        );
        const igData = await igRes.json();
        const followers = igData.followers_count || 0;
        const postsCount = igData.media_count || 0;

        // Recent media — like_count + comments_count (available with instagram_basic)
        const mediaRes = await fetch(
          `https://graph.facebook.com/v18.0/${conn.platform_account_id}/media` +
          `?fields=like_count,comments_count&limit=20&access_token=${token}`
        );
        const mediaData = await mediaRes.json();
        let totalLikes = 0, totalComments = 0;
        if (Array.isArray(mediaData.data)) {
          for (const m of mediaData.data) {
            totalLikes    += m.like_count    ?? 0;
            totalComments += m.comments_count ?? 0;
          }
        }

        const engagementRate = followers > 0
          ? parseFloat(((totalLikes + totalComments) / followers * 100).toFixed(2))
          : 0;

        metrics = { followers, posts_count: postsCount, likes: totalLikes, comments: totalComments, engagement_rate: engagementRate };
      }

      // ── YouTube ───────────────────────────────────────────────────────────
      // Uses the stored OAuth access token — no separate API key needed
      else if (conn.platform === 'youtube') {
        const ytHeaders = { Authorization: `Bearer ${token}` };

        const channelRes = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true`,
          { headers: ytHeaders }
        );
        const channelData = await channelRes.json();
        const stats = channelData.items?.[0]?.statistics ?? {};
        const followers   = parseInt(stats.subscriberCount || '0');
        const postsCount  = parseInt(stats.videoCount      || '0');
        const totalViews  = parseInt(stats.viewCount       || '0');

        // Recent uploads — likes + comments
        const videosRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=id&forMine=true&type=video&order=date&maxResults=10`,
          { headers: ytHeaders }
        );
        const videosData = await videosRes.json();
        const videoIds: string[] = (videosData.items ?? []).map((v: any) => v.id?.videoId).filter(Boolean);

        let totalLikes = 0, totalComments = 0;
        if (videoIds.length > 0) {
          const videoStatsRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds.join(',')}`,
            { headers: ytHeaders }
          );
          const videoStatsData = await videoStatsRes.json();
          for (const item of (videoStatsData.items ?? [])) {
            totalLikes    += parseInt(item.statistics?.likeCount    || '0');
            totalComments += parseInt(item.statistics?.commentCount || '0');
          }
        }

        const engagementRate = followers > 0
          ? parseFloat(((totalLikes + totalComments) / followers * 100).toFixed(2))
          : 0;

        metrics = { followers, posts_count: postsCount, impressions: totalViews, likes: totalLikes, comments: totalComments, engagement_rate: engagementRate };
      }

      // ── LinkedIn ──────────────────────────────────────────────────────────
      else if (conn.platform === 'linkedin') {
        const res = await fetch(
          `https://api.linkedin.com/v2/networkSizes/${conn.platform_account_id}?edgeType=CompanyFollowedByMember`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        metrics = { followers: data.firstDegreeSize || 0 };
      }

      // ── Twitter / X ───────────────────────────────────────────────────────
      else if (conn.platform === 'twitter') {
        const res = await fetch(
          `https://api.twitter.com/2/users/${conn.platform_account_id}?user.fields=public_metrics`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        metrics = {
          followers: data.data?.public_metrics?.followers_count || 0,
          following: data.data?.public_metrics?.following_count || 0,
        };
      }

      // Persist to social_analytics
      await supabase.from('social_analytics').upsert({
        connection_id: conn.id,
        date: today,
        ...metrics,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'connection_id,date' });

      // Keep followers_count on the connection row in sync
      if (metrics.followers) {
        await supabase
          .from('social_connections')
          .update({ followers_count: metrics.followers, updated_at: new Date().toISOString() })
          .eq('id', conn.id);
      }

      synced++;
    } catch (e: unknown) {
      console.error(`[social-analytics] ${conn.platform} ${conn.account_name}:`, e instanceof Error ? e.message : String(e));
    }
  }

  // ── Per-post engagement sync ─────────────────────────────────────────────
  // Refresh engagement counts on posts published in the last 30 days
  await syncPostEngagement(supabase, connections);

  return NextResponse.json({ synced, date: today });
}

/**
 * For every published post in the last 30 days that has platform_post_ids,
 * fetch the current like/comment/share counts and write them back to
 * social_posts.engagement.
 */
async function syncPostEngagement(supabase: any, connections: any[]) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: posts } = await supabase
    .from('social_posts')
    .select('id, platforms, platform_post_ids, engagement')
    .eq('status', 'published')
    .gte('published_at', thirtyDaysAgo)
    .not('platform_post_ids', 'is', null);

  if (!posts?.length) return;

  // Build a lookup: platform → connection (decrypted token)
  const connByPlatform: Record<string, { token: string; page_id: string; ig_id: string }> = {};
  for (const conn of connections) {
    if (!connByPlatform[conn.platform]) {
      connByPlatform[conn.platform] = {
        token:   decryptToken(conn.access_token),
        page_id: conn.page_id ?? '',
        ig_id:   conn.platform_account_id ?? '',
      };
    }
  }

  for (const post of posts) {
    try {
      const ids: Record<string, string> = post.platform_post_ids ?? {};
      const eng: Record<string, number> = { likes: 0, comments: 0, shares: 0 };

      // Facebook
      if (ids.facebook && connByPlatform.facebook) {
        const { token } = connByPlatform.facebook;
        const r = await fetch(
          `https://graph.facebook.com/v18.0/${ids.facebook}` +
          `?fields=likes.summary(true),comments.summary(true),shares&access_token=${token}`
        );
        const d = await r.json();
        eng.likes    += d.likes?.summary?.total_count    ?? 0;
        eng.comments += d.comments?.summary?.total_count ?? 0;
        eng.shares   += d.shares?.count                  ?? 0;
      }

      // Instagram
      if (ids.instagram && connByPlatform.instagram) {
        const { token } = connByPlatform.instagram;
        const r = await fetch(
          `https://graph.facebook.com/v18.0/${ids.instagram}` +
          `?fields=like_count,comments_count&access_token=${token}`
        );
        const d = await r.json();
        eng.likes    += d.like_count     ?? 0;
        eng.comments += d.comments_count ?? 0;
      }

      // YouTube
      if (ids.youtube && connByPlatform.youtube) {
        const r = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.youtube}`,
          { headers: { Authorization: `Bearer ${connByPlatform.youtube.token}` } }
        );
        const d = await r.json();
        const stats = d.items?.[0]?.statistics ?? {};
        eng.likes    += parseInt(stats.likeCount    || '0');
        eng.comments += parseInt(stats.commentCount || '0');
      }

      // Only write if something changed
      const prev = post.engagement ?? {};
      if (eng.likes !== (prev.likes ?? 0) || eng.comments !== (prev.comments ?? 0) || eng.shares !== (prev.shares ?? 0)) {
        await supabase
          .from('social_posts')
          .update({ engagement: eng, updated_at: new Date().toISOString() })
          .eq('id', post.id);
      }
    } catch (e: unknown) {
      console.error(`[post-engagement] post ${post.id}:`, e instanceof Error ? e.message : String(e));
    }
  }
}
