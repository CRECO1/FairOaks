import { decryptToken } from '@/lib/token-crypto';

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
  const token = decryptToken(connection.access_token);

  // Multi-photo post: stage each photo unpublished, then attach all in one feed post
  if (post.media_urls && post.media_urls.length > 1) {
    const photoIds: string[] = [];
    for (const url of post.media_urls) {
      const r = await fetch(`https://graph.facebook.com/v18.0/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, published: false, access_token: token }),
      });
      const d = await r.json();
      if (!d.id) return { success: false, error: d.error?.message || 'Photo staging failed' };
      photoIds.push(d.id);
    }
    const attached_media = photoIds.map(id => ({ media_fbid: id }));
    const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: post.content, attached_media, access_token: token }),
    });
    const data = await res.json();
    if (data.id) return { success: true, platform_post_id: data.id };
    return { success: false, error: data.error?.message || 'Facebook publish failed' };
  }

  // Single image or text-only post
  const body: Record<string, unknown> = { message: post.content, access_token: token };
  if (post.media_urls?.[0]) body.link = post.media_urls[0];
  if (post.link_url) body.link = post.link_url;

  const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.id) return { success: true, platform_post_id: data.id };
  return { success: false, error: data.error?.message || 'Facebook publish failed' };
}

async function publishToInstagram(connection: SocialConnection, post: PostPayload): Promise<PublishResult> {
  if (!post.media_urls?.[0]) {
    return { success: false, error: 'Instagram requires at least one image' };
  }

  const token = decryptToken(connection.access_token);
  const igId = connection.platform_account_id;

  // Carousel post (2–10 images)
  if (post.media_urls.length > 1) {
    // Step 1: Create a carousel item container for each image
    const childIds: string[] = [];
    for (const url of post.media_urls) {
      const r = await fetch(`https://graph.facebook.com/v18.0/${igId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: token }),
      });
      const d = await r.json();
      if (!d.id) return { success: false, error: d.error?.message || 'IG carousel item creation failed' };
      childIds.push(d.id);
    }

    // Step 2: Create the carousel container
    const carouselRes = await fetch(`https://graph.facebook.com/v18.0/${igId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption: post.content,
        access_token: token,
      }),
    });
    const carousel = await carouselRes.json();
    if (!carousel.id) return { success: false, error: carousel.error?.message || 'IG carousel container creation failed' };

    // Step 3: Publish the carousel
    const publishRes = await fetch(`https://graph.facebook.com/v18.0/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: carousel.id, access_token: token }),
    });
    const published = await publishRes.json();
    if (published.id) return { success: true, platform_post_id: published.id };
    return { success: false, error: published.error?.message || 'IG carousel publish failed' };
  }

  // Single image post
  const containerRes = await fetch(`https://graph.facebook.com/v18.0/${igId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: post.media_urls[0], caption: post.content, access_token: token }),
  });
  const container = await containerRes.json();
  if (!container.id) return { success: false, error: container.error?.message || 'IG container creation failed' };

  const publishRes = await fetch(`https://graph.facebook.com/v18.0/${igId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: token }),
  });
  const published = await publishRes.json();
  if (published.id) return { success: true, platform_post_id: published.id };
  return { success: false, error: published.error?.message || 'IG publish failed' };
}

async function publishToLinkedIn(connection: SocialConnection, post: PostPayload): Promise<PublishResult> {
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${decryptToken(connection.access_token)}`,
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
      Authorization: `Bearer ${decryptToken(connection.access_token)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: post.content.substring(0, 280) }),
  });

  const data = await res.json();
  if (data.data?.id) return { success: true, platform_post_id: data.data.id };
  return { success: false, error: data.detail || 'Twitter publish failed' };
}
