import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const body = await req.json();
  const { content, scheduled_at, status, platforms, media_urls, link_url } = body;

  const supabase = adminClient();

  // Verify ownership
  const { data: existing } = await supabase
    .from('social_posts')
    .select('id')
    .eq('id', id)
    .eq('agent_id', user.id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (content !== undefined) updates.content = content;
  if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at;
  if (status !== undefined) updates.status = status;
  if (platforms !== undefined) updates.platforms = platforms;
  if (media_urls !== undefined) updates.media_urls = media_urls;
  if (link_url !== undefined) updates.link_url = link_url;

  const { data, error } = await supabase
    .from('social_posts')
    .update(updates)
    .eq('id', id)
    .eq('agent_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ post: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const supabase = adminClient();

  const { error } = await supabase
    .from('social_posts')
    .delete()
    .eq('id', id)
    .eq('agent_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
