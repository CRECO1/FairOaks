import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Called by Vercel Cron every 5 minutes: */5 * * * *
export async function GET(req: NextRequest) {
  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Find posts scheduled for now (within the last 5 minutes and up to now)
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

  const { data: duePosts, error } = await supabase
    .from('social_posts')
    .select('*, social_connections!inner(*)')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now.toISOString())
    .gte('scheduled_at', fiveMinutesAgo.toISOString());

  if (error) {
    console.error('Social publish cron error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!duePosts || duePosts.length === 0) {
    return NextResponse.json({ published: 0, message: 'No posts due' });
  }

  const results: Array<{ id: string; status: string; platforms: Record<string, string>; failures: string[] }> = [];

  for (const post of duePosts) {
    const platformPostIds: Record<string, string> = {};
    const failures: string[] = [];

    for (const platform of (post.platforms as string[])) {
      // Find the connection for this platform
      const connection = (post.social_connections as any[])?.find(
        (c: any) => c.platform === platform && c.is_active
      );

      if (!connection) {
        failures.push(`${platform}: no active connection`);
        continue;
      }

      try {
        const result = await publishToPlatform(platform, connection, post);
        if (result.success && result.platform_post_id) {
          platformPostIds[platform] = result.platform_post_id;
        } else {
          failures.push(`${platform}: ${result.error}`);
        }
      } catch (e: unknown) {
        failures.push(`${platform}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Update post status
    const allFailed = failures.length === (post.platforms as string[]).length;
    const newStatus = allFailed ? 'failed' : 'published';
    const failNote = failures.length > 0
      ? `\n[CRON] Partial/full failure: ${failures.join('; ')}`
      : `\n[CRON] Published successfully at ${new Date().toISOString()}`;
    await supabase
      .from('social_posts')
      .update({
        status: newStatus,
        published_at: new Date().toISOString(),
        platform_post_ids: platformPostIds,
        internal_notes: (post.internal_notes ?? '') + failNote,
        updated_at: new Date().toISOString(),
      })
      .eq('id', post.id);

    results.push({ id: post.id, status: newStatus, platforms: platformPostIds, failures });
  }

  return NextResponse.json({
    published: results.filter(r => r.status === 'published').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  });
}

// Platform publish implementations
async function publishToPlatform(
  platform: string,
  connection: any,
  post: any
): Promise<{ success: boolean; platform_post_id?: string; error?: string }> {
  switch (platform) {
    case 'facebook':
      return publishToFacebook(connection, post);
    case 'instagram':
      return publishToInstagram(connection, post);
    case 'linkedin':
      return publishToLinkedIn(connection, post);
    case 'twitter':
      return publishToTwitter(connection, post);
    case 'youtube':
      return { success: false, error: 'YouTube video upload requires direct upload API' };
    default:
      return { success: false, error: 'Unknown platform' };
  }
}

async function publishToFacebook(connection: any, post: any): Promise<{ success: boolean; platform_post_id?: string; error?: string }> {
  const res = await fetch(
    `https://graph.facebook.com/v18.0/${connection.page_id}/feed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: post.content,
        link: post.link_url || undefined,
        access_token: connection.access_token,
      }),
    }
  );
  const data = await res.json();
  if (data.id) return { success: true, platform_post_id: data.id };
  return { success: false, error: data.error?.message || 'Facebook publish failed' };
}

async function publishToInstagram(connection: any, post: any): Promise<{ success: boolean; platform_post_id?: string; error?: string }> {
  if (!post.media_urls?.[0]) {
    return { success: false, error: 'Instagram requires at least one image URL' };
  }
  const containerRes = await fetch(
    `https://graph.facebook.com/v18.0/${connection.platform_account_id}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: post.media_urls[0],
        caption: post.content,
        access_token: connection.access_token,
      }),
    }
  );
  const container = await containerRes.json();
  if (!container.id) return { success: false, error: container.error?.message || 'Container failed' };

  const publishRes = await fetch(
    `https://graph.facebook.com/v18.0/${connection.platform_account_id}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: container.id,
        access_token: connection.access_token,
      }),
    }
  );
  const published = await publishRes.json();
  if (published.id) return { success: true, platform_post_id: published.id };
  return { success: false, error: published.error?.message || 'IG publish failed' };
}

async function publishToLinkedIn(connection: any, post: any): Promise<{ success: boolean; platform_post_id?: string; error?: string }> {
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: `urn:li:person:${connection.platform_account_id}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: post.content },
          shareMediaCategory: post.link_url ? 'ARTICLE' : 'NONE',
          ...(post.link_url && {
            media: [{ status: 'READY', originalUrl: post.link_url }],
          }),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  const data = await res.json();
  if (data.id) return { success: true, platform_post_id: data.id };
  return { success: false, error: data.message || 'LinkedIn failed' };
}

async function publishToTwitter(connection: any, post: any): Promise<{ success: boolean; platform_post_id?: string; error?: string }> {
  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: (post.content as string).substring(0, 280) }),
  });
  const data = await res.json();
  if (data.data?.id) return { success: true, platform_post_id: data.data.id };
  return { success: false, error: data.detail || 'Twitter failed' };
}
