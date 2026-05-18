export interface SocialConnection {
  id: string;
  agent_id: string;
  platform: string;
  platform_account_id: string;
  account_name: string;
  access_token: string;
  refresh_token?: string | null;
  page_id?: string | null;
  expires_at?: string | null;
  is_active: boolean;
}

export interface PostPayload {
  content: string;
  media_urls: string[];
  link_url?: string;
}

export interface PublishResult {
  success: boolean;
  platform_post_id?: string;
  error?: string;
}

export async function publishToplatform(
  platform: string,
  connection: SocialConnection,
  post: PostPayload
): Promise<PublishResult> {
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
      return { success: false, error: 'YouTube posts require video upload — use YouTube Studio' };
    default:
      return { success: false, error: `Unknown platform: ${platform}` };
  }
}

async function publishToFacebook(connection: SocialConnection, post: PostPayload): Promise<PublishResult> {
  const pageId = connection.page_id || connection.platform_account_id;

  const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: post.content,
      link: post.link_url || undefined,
      access_token: connection.access_token,
    }),
  });

  const data = await res.json();
  if (data.id) return { success: true, platform_post_id: data.id };
  return { success: false, error: data.error?.message || 'Facebook publish failed' };
}

async function publishToInstagram(connection: SocialConnection, post: PostPayload): Promise<PublishResult> {
  if (!post.media_urls?.[0]) {
    return { success: false, error: 'Instagram requires at least one image' };
  }

  // Step 1: Create media container
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
  if (!container.id) {
    return { success: false, error: container.error?.message || 'IG container creation failed' };
  }

  // Step 2: Publish the container
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

async function publishToLinkedIn(connection: SocialConnection, post: PostPayload): Promise<PublishResult> {
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
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });

  const data = await res.json();
  if (data.id) return { success: true, platform_post_id: data.id };
  return { success: false, error: data.message || 'LinkedIn publish failed' };
}

async function publishToTwitter(connection: SocialConnection, post: PostPayload): Promise<PublishResult> {
  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: post.content.substring(0, 280) }),
  });

  const data = await res.json();
  if (data.data?.id) return { success: true, platform_post_id: data.data.id };
  return { success: false, error: data.detail || 'Twitter publish failed' };
}
