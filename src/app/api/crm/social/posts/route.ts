import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { publishToplatform } from '@/lib/social-publish';

export async function GET(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const supabase = adminClient();
  const status = req.nextUrl.searchParams.get('status');

  let q = supabase
    .from('social_posts')
    .select('*')
    .eq('agent_id', user.id)
    .order('scheduled_at', { ascending: true, nullsFirst: false });

  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  return NextResponse.json({ posts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { content, platforms, scheduled_at, status = 'draft', media_urls, link_url } = body;

  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });
  if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
    return NextResponse.json({ error: 'platforms array required' }, { status: 400 });
  }

  const supabase = adminClient();

  const { data: post, error } = await supabase
    .from('social_posts')
    .insert({
      agent_id: user.id,
      content,
      platforms,
      scheduled_at: scheduled_at || null,
      status,
      media_urls: media_urls || [],
      link_url: link_url || null,
    })
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  // If publishing immediately, push to each platform
  if (status === 'published') {
    const publishResults: Record<string, { success: boolean; platform_post_id?: string; error?: string }> = {};

    for (const platform of platforms) {
      const { data: connection } = await supabase
        .from('social_connections')
        .select('*')
        .eq('agent_id', user.id)
        .eq('platform', platform)
        .eq('is_active', true)
        .maybeSingle();

      if (!connection) {
        publishResults[platform] = { success: false, error: 'No active connection for platform' };
        continue;
      }

      publishResults[platform] = await publishToplatform(platform, connection, {
        content,
        media_urls: media_urls || [],
        link_url,
      });
    }

    // Update post with publish results
    await supabase
      .from('social_posts')
      .update({ publish_results: publishResults })
      .eq('id', post.id);

    return NextResponse.json({ post: { ...post, publish_results: publishResults } });
  }

  return NextResponse.json({ post });
}
