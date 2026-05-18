import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

async function sendFacebookReply(connection: Record<string, string>, item: Record<string, string>, content: string) {
  // Reply to a comment on a FB page post
  const commentId = item.platform_message_id;
  const res = await fetch(`https://graph.facebook.com/v18.0/${commentId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: content, access_token: connection.access_token }),
  });
  const data = await res.json();
  if (data.id) return { success: true };
  return { success: false, error: data.error?.message || 'Facebook reply failed' };
}

async function sendInstagramReply(connection: Record<string, string>, item: Record<string, string>, content: string) {
  const commentId = item.platform_message_id;
  const res = await fetch(`https://graph.facebook.com/v18.0/${commentId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: content, access_token: connection.access_token }),
  });
  const data = await res.json();
  if (data.id) return { success: true };
  return { success: false, error: data.error?.message || 'Instagram reply failed' };
}

async function sendLinkedInReply(connection: Record<string, string>, item: Record<string, string>, content: string) {
  const commentUrn = item.platform_message_id;
  const res = await fetch(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(commentUrn)}/comments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      actor: `urn:li:person:${connection.platform_account_id}`,
      message: { text: content },
    }),
  });
  const data = await res.json();
  if (data.id) return { success: true };
  return { success: false, error: data.message || 'LinkedIn reply failed' };
}

async function sendTwitterReply(connection: Record<string, string>, item: Record<string, string>, content: string) {
  const tweetId = item.platform_message_id;
  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: content.substring(0, 280), reply: { in_reply_to_tweet_id: tweetId } }),
  });
  const data = await res.json();
  if (data.data?.id) return { success: true };
  return { success: false, error: data.detail || 'Twitter reply failed' };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const body = await req.json();
  const { content } = body;

  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });

  const supabase = adminClient();

  // Get inbox item
  const { data: item, error: itemErr } = await supabase
    .from('social_inbox')
    .select('*')
    .eq('id', id)
    .eq('agent_id', user.id)
    .maybeSingle();

  if (itemErr || !item) {
    return NextResponse.json({ error: 'Inbox item not found' }, { status: 404 });
  }

  // Get active connection for this platform
  const { data: connection } = await supabase
    .from('social_connections')
    .select('*')
    .eq('agent_id', user.id)
    .eq('platform', item.platform)
    .eq('is_active', true)
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: `No active ${item.platform} connection` }, { status: 400 });
  }

  // Send reply via platform API
  let result: { success: boolean; error?: string } = { success: false, error: 'Unsupported platform' };

  switch (item.platform) {
    case 'facebook':
      result = await sendFacebookReply(connection, item, content);
      break;
    case 'instagram':
      result = await sendInstagramReply(connection, item, content);
      break;
    case 'linkedin':
      result = await sendLinkedInReply(connection, item, content);
      break;
    case 'twitter':
      result = await sendTwitterReply(connection, item, content);
      break;
  }

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Update inbox item
  await supabase
    .from('social_inbox')
    .update({
      replied_at: new Date().toISOString(),
      reply_content: content,
      status: 'resolved',
    })
    .eq('id', id);

  return NextResponse.json({ success: true });
}
