import 'server-only';
import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { adminClient } from '@/lib/supabase-admin';

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
      return publishToYouTube(connection, post);
    default:
      return { success: false, error: `Unknown platform: ${platform}` };
  }
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date(Date.now() + 60_000); // 1 min buffer
}

async function refreshGoogleToken(connection: SocialConnection): Promise<string | null> {
  if (!connection.refresh_token) return null;
  try {
    const refreshToken = decryptToken(connection.refresh_token);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await res.json();
    if (!data.access_token) return null;

    // Persist refreshed token
    const supabase = adminClient();
    await supabase.from('social_connections').update({
      access_token: encryptToken(data.access_token),
      expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', connection.id);

    return data.access_token;
  } catch (e) {
    console.error('[social-publish] Google token refresh failed:', e);
    return null;
  }
}

// ── Proactive token refresh (called by cron every 5 min) ─────────────────────

export async function proactiveTokenRefresh(): Promise<void> {
  try {
    const supabase = adminClient();
    const tenDaysFromNow = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    // Find Facebook connections whose user token (refresh_token) expires within 10 days
    // expires_at is null for page tokens (non-expiring), but some older records may have it set
    const { data: fbConns } = await supabase
      .from('social_connections')
      .select('*')
      .eq('platform', 'facebook')
      .eq('is_active', true)
      .not('refresh_token', 'is', null)
      .lte('expires_at', tenDaysFromNow);

    if (fbConns?.length) {
      for (const conn of fbConns) {
        await refreshFacebookUserToken(conn as SocialConnection);
      }
    }
  } catch (e) {
    console.error('[social-publish] proactiveTokenRefresh error:', e);
  }
}

// ── Facebook token refresh ────────────────────────────────────────────────────
// Silently extends the long-lived user token another 60 days.
// Page tokens derived from long-lived user tokens never expire on their own,
// but we keep the user token fresh so we can generate new page tokens if needed.

async function refreshFacebookUserToken(connection: SocialConnection): Promise<void> {
  if (!connection.refresh_token) return;
  try {
    const userToken = decryptToken(connection.refresh_token);
    const res = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&fb_exchange_token=${userToken}`
    );
    const data = await res.json();
    if (!data.access_token) return;

    const supabase = adminClient();
    await supabase.from('social_connections').update({
      refresh_token: encryptToken(data.access_token),
      // Page token never expires — keep expires_at null
      expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', connection.id);
  } catch (e) {
    console.error('[social-publish] Facebook user token refresh failed:', e);
  }
}

// ── Facebook ──────────────────────────────────────────────────────────────────

async function publishToFacebook(connection: SocialConnection, post: PostPayload): Promise<PublishResult> {
  const pageId = connection.page_id || connection.platform_account_id;
  const token = decryptToken(connection.access_token);

  // Any images → upload via Photos API (staged), then attach to feed post
  // This works for both single and multiple images and prevents link_url from overriding the photo
  if (post.media_urls && post.media_urls.length > 0) {
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
    const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: post.content,
        attached_media: photoIds.map(id => ({ media_fbid: id })),
        access_token: token,
      }),
    });
    const data = await res.json();
    if (data.id) return { success: true, platform_post_id: data.id };
    return { success: false, error: data.error?.message || 'Facebook publish failed' };
  }

  // Text-only or link post (no images)
  const body: Record<string, unknown> = { message: post.content, access_token: token };
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

// ── Instagram ─────────────────────────────────────────────────────────────────

async function publishToInstagram(connection: SocialConnection, post: PostPayload): Promise<PublishResult> {
  if (!post.media_urls?.[0]) return { success: false, error: 'Instagram requires at least one image' };

  const token = decryptToken(connection.access_token);
  const igId = connection.platform_account_id;

  if (post.media_urls.length > 1) {
    const childIds: string[] = [];
    for (const url of post.media_urls) {
      const r = await fetch(`https://graph.facebook.com/v18.0/${igId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: token }),
      });
      const d = await r.json();
      if (!d.id) return { success: false, error: d.error?.message || 'IG carousel item failed' };
      childIds.push(d.id);
    }
    const carouselRes = await fetch(`https://graph.facebook.com/v18.0/${igId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds.join(','), caption: post.content, access_token: token }),
    });
    const carousel = await carouselRes.json();
    if (!carousel.id) return { success: false, error: carousel.error?.message || 'IG carousel container failed' };

    const publishRes = await fetch(`https://graph.facebook.com/v18.0/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: carousel.id, access_token: token }),
    });
    const published = await publishRes.json();
    if (published.id) return { success: true, platform_post_id: published.id };
    return { success: false, error: published.error?.message || 'IG carousel publish failed' };
  }

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

// ── LinkedIn ──────────────────────────────────────────────────────────────────

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
          shareMediaCategory: post.link_url ? 'ARTICLE' : 'NONE',
          ...(post.link_url && { media: [{ status: 'READY', originalUrl: post.link_url }] }),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  const data = await res.json();
  if (data.id) return { success: true, platform_post_id: data.id };
  return { success: false, error: data.message || 'LinkedIn publish failed' };
}

// ── Twitter ───────────────────────────────────────────────────────────────────

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

// ── YouTube Shorts ────────────────────────────────────────────────────────────

async function publishToYouTube(connection: SocialConnection, post: PostPayload): Promise<PublishResult> {
  const videoUrl = post.media_urls?.[0];
  if (!videoUrl) {
    return { success: false, error: 'YouTube Shorts require a video file' };
  }

  // Refresh token if expired
  let accessToken = decryptToken(connection.access_token);
  if (isExpired(connection.expires_at)) {
    const refreshed = await refreshGoogleToken(connection);
    if (!refreshed) return { success: false, error: 'YouTube token expired — please reconnect your YouTube account' };
    accessToken = refreshed;
  }

  // Fetch the video from Supabase storage
  let videoBuffer: ArrayBuffer;
  let contentType: string;
  try {
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) return { success: false, error: 'Failed to fetch video from storage' };
    contentType = videoRes.headers.get('content-type') || 'video/mp4';
    videoBuffer = await videoRes.arrayBuffer();
  } catch (e) {
    return { success: false, error: `Failed to fetch video: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Build title: first line of content, max 100 chars, append #Shorts for discoverability
  const firstLine = post.content.split('\n')[0].trim();
  const title = (firstLine.length > 90 ? firstLine.substring(0, 90) + '…' : firstLine) + ' #Shorts';

  // Step 1: Initiate resumable upload session
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': contentType,
        'X-Upload-Content-Length': String(videoBuffer.byteLength),
      },
      body: JSON.stringify({
        snippet: {
          title,
          description: post.content,
          tags: ['Shorts', 'RealEstate', 'FairOaksRealty', 'FairOaks', 'TexasRealEstate'],
          categoryId: '22', // People & Blogs
          defaultLanguage: 'en',
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
          madeForKids: false,
        },
      }),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    return { success: false, error: err.error?.message || `YouTube session init failed (${initRes.status})` };
  }

  const sessionUri = initRes.headers.get('Location');
  if (!sessionUri) return { success: false, error: 'YouTube did not return an upload session URI' };

  // Step 2: Upload video bytes directly to session URI
  const uploadRes = await fetch(sessionUri, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(videoBuffer.byteLength),
    },
    body: videoBuffer,
  });

  if (!uploadRes.ok && uploadRes.status !== 200 && uploadRes.status !== 201) {
    const err = await uploadRes.json().catch(() => ({}));
    return { success: false, error: err.error?.message || `YouTube upload failed (${uploadRes.status})` };
  }

  const uploadData = await uploadRes.json().catch(() => ({}));
  if (uploadData.id) {
    return { success: true, platform_post_id: uploadData.id };
  }
  return { success: false, error: 'YouTube upload failed — no video ID returned' };
}
