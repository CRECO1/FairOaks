'use client';

import { useEffect, useState, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
type SocialPlatform = 'facebook' | 'instagram' | 'linkedin' | 'twitter' | 'youtube';
type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'cancelled';
type InboxStatus = 'open' | 'resolved' | 'spam' | 'pending';

interface SocialConnection {
  id: string;
  platform: SocialPlatform;
  account_name: string;
  account_handle: string;
  account_avatar: string;
  account_type: string;
  page_id: string;
  is_active: boolean;
  followers_count: number;
  expires_at: string;
}

interface SocialPost {
  id: string;
  content: string;
  media_urls: string[];
  platforms: SocialPlatform[];
  connection_ids: string[];
  scheduled_at: string | null;
  published_at: string | null;
  status: PostStatus;
  platform_post_ids: Record<string, string>;
  engagement: Record<string, number>;
  link_url: string;
  hashtags: string[];
  first_comment: string;
  tags: string[];
  approval_status: string;
  internal_notes: string;
  agent_id: string;
  created_at: string;
}

interface SocialInboxItem {
  id: string;
  platform: SocialPlatform;
  type: 'comment' | 'dm' | 'mention' | 'reply';
  from_name: string;
  from_handle: string;
  from_avatar: string;
  content: string;
  post_content_preview: string;
  status: InboxStatus;
  sentiment: 'positive' | 'neutral' | 'negative';
  assigned_to: string | null;
  replied_at: string | null;
  reply_content: string;
  created_at: string;
}

interface SocialAnalyticsData {
  connection_id: string;
  platform: SocialPlatform;
  account_name: string;
  followers: number;
  engagement_rate: number;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  date: string;
}

interface SavedReply {
  id: string;
  name: string;
  content: string;
}

interface Props {
  agentId: string;
  isAdmin: boolean;
  toast: (msg: string) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const PLATFORM_CONFIG: Record<SocialPlatform, { label: string; emoji: string; color: string; charLimit: number; bgClass: string }> = {
  facebook:  { label: 'Facebook',  emoji: '📘', color: '#1877F2', charLimit: 63206, bgClass: '' },
  instagram: { label: 'Instagram', emoji: '📸', color: '#E1306C', charLimit: 2200,  bgClass: '' },
  linkedin:  { label: 'LinkedIn',  emoji: '💼', color: '#0A66C2', charLimit: 3000,  bgClass: '' },
  twitter:   { label: 'Twitter/X', emoji: '🐦', color: '#1DA1F2', charLimit: 280,   bgClass: '' },
  youtube:   { label: 'YouTube',   emoji: '▶️', color: '#FF0000', charLimit: 5000,  bgClass: '' },
};

const ALL_PLATFORMS: SocialPlatform[] = ['facebook', 'instagram', 'linkedin', 'twitter', 'youtube'];

// ── New Office Campaign Posts ──────────────────────────────────────────────────
const CAMPAIGN_POSTS: Array<{ label: string; emoji: string; platform: SocialPlatform; content: string; hashtags: string; scheduledDaysOut: number }> = [
  {
    label: 'Post 1 — Teaser',
    emoji: '👀',
    platform: 'instagram',
    scheduledDaysOut: 0,
    content: `Something big is coming to Fair Oaks. 👀\n\nWe've been building something special for our clients, our agents, and our community — and we can't wait to share it with you.\n\nStay tuned. 🗝️`,
    hashtags: '#FairOaksRealty #ComingSoon #FairOaks #RealEstateTexas #NewBeginnings',
  },
  {
    label: 'Post 2 — Grand Announcement',
    emoji: '🎉',
    platform: 'instagram',
    scheduledDaysOut: 3,
    content: `🎉 WE'VE MOVED — and we love our new home.\n\nFair Oaks Realty Group has officially opened its doors at our brand-new location:\n\n📍 8000 Fair Oaks Pkwy\n\nThis move is more than a new address — it's a reflection of how far we've come and our commitment to serving you at the highest level. Bigger space. Better tools. Same team that's always had your back.\n\nCome see us. We'd love to have you stop by. 🤝`,
    hashtags: '#FairOaksRealtyGroup #NewOffice #FairOaksPkwy #RealEstate #SanAntonio #GrandOpening #WeveMovedHome',
  },
  {
    label: 'Post 3 — Inside Look',
    emoji: '🏠',
    platform: 'instagram',
    scheduledDaysOut: 4,
    content: `Take a look inside our new home. 🏠✨\n\nWe designed this space with one goal in mind — giving our clients and agents the best possible experience. Swipe to see where the magic happens. ➡️\n\nWhether you're buying, selling, or just curious about the market — our door is always open.\n\n📍 8000 Fair Oaks Pkwy\n🌐 fairoaksrealtygroup.com`,
    hashtags: '#OfficeTour #FairOaksRealty #RealEstateLife #NewSpace #RealEstateAgents #FairOaksTexas',
  },
  {
    label: 'Post 4 — Meet the Team',
    emoji: '💛',
    platform: 'instagram',
    scheduledDaysOut: 5,
    content: `The people make the place. 💛\n\nMeet the team behind Fair Oaks Realty Group — now settled into our new office at 8000 Fair Oaks Pkwy and ready to help you make your next move.\n\nBuying? Selling? Relocating? We've got an expert for every situation.\n\nDrop a 👋 in the comments and we'll make sure you're connected with the right agent.`,
    hashtags: '#MeetTheTeam #FairOaksRealtyGroup #RealEstateAgents #FairOaks #NewOffice #YourRealtors',
  },
  {
    label: 'Post 5 — Community CTA',
    emoji: '🏡',
    platform: 'instagram',
    scheduledDaysOut: 7,
    content: `Home isn't just where you live — it's where you belong. 🏡\n\nAt Fair Oaks Realty Group, we've planted our roots right here in the community we love. Our new office at 8000 Fair Oaks Pkwy is our home base, but your dream home is what drives us.\n\nIf you're thinking about buying or selling in 2025 — let's talk. No pressure, just a conversation.\n\n🔗 Link in bio to connect with an agent.`,
    hashtags: '#FairOaksRealty #DreamHome #TexasRealEstate #BuyingAHome #SellingYourHome #FairOaksCommunity #RealEstateTips',
  },
];

function platformEmoji(p: SocialPlatform) { return PLATFORM_CONFIG[p].emoji; }
function platformColor(p: SocialPlatform) { return PLATFORM_CONFIG[p].color; }
function platformLabel(p: SocialPlatform) { return PLATFORM_CONFIG[p].label; }

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// Status badge styles
function statusBadge(status: PostStatus) {
  const map: Record<PostStatus, { bg: string; color: string }> = {
    draft:      { bg: '#f3f4f6', color: '#6b7280' },
    scheduled:  { bg: '#dbeafe', color: '#1d4ed8' },
    published:  { bg: '#dcfce7', color: '#15803d' },
    failed:     { bg: '#fee2e2', color: '#dc2626' },
    cancelled:  { bg: '#fef3c7', color: '#92400e' },
  };
  return map[status] || { bg: '#f3f4f6', color: '#6b7280' };
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function SocialMediaSection({ agentId, isAdmin, toast }: Props) {
  const [activeTab, setActiveTab] = useState<'publisher' | 'calendar' | 'inbox' | 'analytics'>('publisher');

  // Connections
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  // Posts
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postQueueTab, setPostQueueTab] = useState<'all' | 'scheduled' | 'drafts' | 'published' | 'failed'>('all');
  const [publisherView, setPublisherView] = useState<'list' | 'detail' | 'builder'>('list');
  const [activePost, setActivePost] = useState<SocialPost | null>(null);

  // Inbox
  const [inboxItems, setInboxItems] = useState<SocialInboxItem[]>([]);
  const [inboxFilter, setInboxFilter] = useState<InboxStatus | 'all'>('open');
  const [inboxTypeFilter, setInboxTypeFilter] = useState<'all' | 'comment' | 'dm' | 'mention'>('all');
  const [inboxPlatformFilter, setInboxPlatformFilter] = useState<SocialPlatform | 'all'>('all');
  const [inboxSearch, setInboxSearch] = useState('');
  const [selectedInboxItem, setSelectedInboxItem] = useState<SocialInboxItem | null>(null);
  const [replyText, setReplyText] = useState('');
  const [savedReplies, setSavedReplies] = useState<SavedReply[]>([
    { id: '1', name: 'Thank you!', content: 'Thank you so much for your interest! Please feel free to reach out anytime.' },
    { id: '2', name: 'Schedule a call', content: 'Great question! I\'d love to connect. Feel free to book a call at your convenience.' },
    { id: '3', name: 'Property inquiry', content: 'Thank you for your inquiry! This property is still available. Would you like to schedule a showing?' },
  ]);
  const [savedRepliesOpen, setSavedRepliesOpen] = useState(false);
  const [newReplyName, setNewReplyName] = useState('');
  const [newReplyContent, setNewReplyContent] = useState('');

  // Analytics
  const [analytics, setAnalytics] = useState<SocialAnalyticsData[]>([]);

  // Composer state
  const [composerOpen, setComposerOpen] = useState(true);
  const [composerContent, setComposerContent] = useState('');
  const [composerPlatforms, setComposerPlatforms] = useState<SocialPlatform[]>([]);
  const [composerMediaUrls, setComposerMediaUrls] = useState<string[]>([]);
  const [composerScheduledAt, setComposerScheduledAt] = useState('');
  const [composerLinkUrl, setComposerLinkUrl] = useState('');
  const [composerHashtags, setComposerHashtags] = useState('');
  const [composerFirstComment, setComposerFirstComment] = useState('');
  const [composerNotes, setComposerNotes] = useState('');
  const [composerLoading, setComposerLoading] = useState(false);
  const [captionLoading, setCaptionLoading] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [showFirstComment, setShowFirstComment] = useState(false);
  const [showInternalNotes, setShowInternalNotes] = useState(false);
  const [showAICaption, setShowAICaption] = useState(false);
  const [captionTopic, setCaptionTopic] = useState('');
  const [captionTone, setCaptionTone] = useState('Professional');
  const [postMode, setPostMode] = useState<'schedule' | 'now'>('schedule');

  // Calendar
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<'month' | 'week'>('month');

  // Campaign
  const [campaignImporting, setCampaignImporting] = useState(false);
  const [previewPostId, setPreviewPostId] = useState<string | null>(null);

  // Media upload ref
  const mediaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadConnections();
    loadPosts();
    loadInbox();
    loadAnalytics();

    // Handle OAuth callback result from URL params
    const params = new URLSearchParams(window.location.search);
    const socialResult = params.get('social');
    const platform = params.get('platform');
    const reason = params.get('reason');
    if (socialResult === 'connected') {
      toast(`✅ ${platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Account'} connected successfully!`);
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('social');
      url.searchParams.delete('platform');
      url.searchParams.delete('count');
      window.history.replaceState({}, '', url);
    } else if (socialResult === 'error') {
      const messages: Record<string, string> = {
        oauth_denied: 'Connection cancelled.',
        invalid_state: 'Security check failed — please try again.',
        token_exchange: 'Failed to get access token from Facebook.',
        no_pages: 'No Facebook Pages found. Make sure you manage at least one Page.',
        invalid_user: 'User not found — please log in again.',
      };
      toast(`❌ ${messages[reason ?? ''] ?? `Connection failed: ${reason}`}`);
      const url = new URL(window.location.href);
      url.searchParams.delete('social');
      url.searchParams.delete('platform');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url);
    }
  }, []);

  // ── Load functions ────────────────────────────────────────────────────────────
  async function loadConnections() {
    setConnectionsLoading(true);
    try {
      const res = await fetch('/api/crm/social/accounts');
      const data = await res.json();
      setConnections(data.accounts || []);
    } catch {
      toast('Failed to load social accounts');
    } finally {
      setConnectionsLoading(false);
    }
  }

  async function loadPosts() {
    setPostsLoading(true);
    try {
      const res = await fetch('/api/crm/social/posts');
      const data = await res.json();
      setPosts(data.posts || []);
    } catch {
      toast('Failed to load posts');
    } finally {
      setPostsLoading(false);
    }
  }

  async function loadInbox() {
    try {
      const res = await fetch('/api/crm/social/inbox');
      const data = await res.json();
      setInboxItems(data.items || []);
    } catch {
      // silent
    }
  }

  async function loadAnalytics() {
    try {
      const res = await fetch('/api/crm/social/analytics');
      const data = await res.json();
      setAnalytics(data.analytics || []);
    } catch {
      // silent
    }
  }

  async function importCampaignAsDrafts() {
    setCampaignImporting(true);
    try {
      await Promise.all(
        CAMPAIGN_POSTS.map(cp =>
          fetch('/api/crm/social/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: cp.content,
              platforms: [cp.platform],
              connection_ids: [],
              scheduled_at: null,
              status: 'draft',
              link_url: 'https://fairoaksrealtygroup.com',
              hashtags: cp.hashtags.split(' ').filter(Boolean),
              first_comment: '',
              internal_notes: `New Office Campaign — ${cp.label}`,
            }),
          })
        )
      );
      toast('📢 5 campaign posts saved to Drafts!');
      setPostQueueTab('drafts');
      loadPosts();
    } catch {
      toast('Failed to import campaign');
    } finally {
      setCampaignImporting(false);
    }
  }

  async function savePost(status: 'draft' | 'scheduled' | 'published') {
    setComposerLoading(true);
    try {
      const body = {
        content: composerContent,
        platforms: composerPlatforms,
        connection_ids: connections.filter(c => composerPlatforms.includes(c.platform)).map(c => c.id),
        scheduled_at: status === 'scheduled' ? composerScheduledAt : null,
        status,
        link_url: composerLinkUrl,
        hashtags: composerHashtags.split(' ').filter(Boolean),
        first_comment: composerFirstComment,
        internal_notes: composerNotes,
      };
      const url = editingPost ? `/api/crm/social/posts/${editingPost.id}` : '/api/crm/social/posts';
      const method = editingPost ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      toast(status === 'published' ? 'Post published!' : status === 'scheduled' ? 'Post scheduled!' : 'Draft saved!');
      resetComposer();
      loadPosts();
    } catch {
      toast('Failed to save post');
    } finally {
      setComposerLoading(false);
    }
  }

  async function generateCaption(topic: string, tone: string) {
    setCaptionLoading(true);
    try {
      const res = await fetch('/api/crm/social/caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: composerPlatforms, topic, tone }),
      });
      const data = await res.json();
      setComposerContent(data.caption || '');
      if (data.hashtags) setComposerHashtags(data.hashtags.join(' '));
      setShowAICaption(false);
      toast('Caption generated!');
    } catch {
      toast('Failed to generate caption');
    } finally {
      setCaptionLoading(false);
    }
  }

  async function sendReply(itemId: string, reply: string) {
    const res = await fetch(`/api/crm/social/inbox/${itemId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: reply }),
    });
    if (res.ok) {
      toast('Reply sent!');
      setReplyText('');
      loadInbox();
    } else {
      toast('Failed to send reply');
    }
  }

  async function updateInboxStatus(itemId: string, status: InboxStatus) {
    try {
      await fetch(`/api/crm/social/inbox/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setInboxItems(prev => prev.map(i => i.id === itemId ? { ...i, status } : i));
      if (selectedInboxItem?.id === itemId) setSelectedInboxItem(prev => prev ? { ...prev, status } : null);
      toast('Status updated');
    } catch {
      toast('Failed to update status');
    }
  }

  async function deletePost(postId: string) {
    try {
      await fetch(`/api/crm/social/posts/${postId}`, { method: 'DELETE' });
      setPosts(prev => prev.filter(p => p.id !== postId));
      toast('Post deleted');
    } catch {
      toast('Failed to delete post');
    }
  }

  function resetComposer() {
    setComposerContent('');
    setComposerPlatforms([]);
    setComposerMediaUrls([]);
    setComposerScheduledAt('');
    setComposerLinkUrl('');
    setComposerHashtags('');
    setComposerFirstComment('');
    setComposerNotes('');
    setEditingPost(null);
    setActivePost(null);
    setShowAICaption(false);
    setShowFirstComment(false);
    setShowInternalNotes(false);
    setPublisherView('list');
  }

  function openDetailPost(post: SocialPost) {
    setActivePost(post);
    setPublisherView('detail');
    // Pre-load composer state so editing from detail is instant
    setEditingPost(post);
    setComposerContent(post.content);
    setComposerPlatforms(post.platforms);
    setComposerScheduledAt(post.scheduled_at || '');
    setComposerLinkUrl(post.link_url || '');
    setComposerHashtags(post.hashtags.join(' '));
    setComposerFirstComment(post.first_comment || '');
    setComposerNotes(post.internal_notes || '');
  }

  function openEditPost(post: SocialPost) {
    setEditingPost(post);
    setComposerContent(post.content);
    setComposerPlatforms(post.platforms);
    setComposerScheduledAt(post.scheduled_at || '');
    setComposerLinkUrl(post.link_url || '');
    setComposerHashtags(post.hashtags.join(' '));
    setComposerFirstComment(post.first_comment || '');
    setComposerNotes(post.internal_notes || '');
    setComposerOpen(true);
    setPublisherView('builder');
  }

  function togglePlatform(p: SocialPlatform) {
    setComposerPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  }

  // Character limit for most restrictive selected platform
  function charLimit(): number {
    if (composerPlatforms.length === 0) return 63206;
    return Math.min(...composerPlatforms.map(p => PLATFORM_CONFIG[p].charLimit));
  }

  function charsRemaining(): number {
    return charLimit() - composerContent.length;
  }

  // ── Render helpers ─────────────────────────────────────────────────────────────

  function renderPlatformBadge(platform: SocialPlatform, size: 'sm' | 'md' = 'sm') {
    const sz = size === 'sm' ? { width: 24, height: 24, fontSize: 12 } : { width: 32, height: 32, fontSize: 16 };
    return (
      <span
        key={platform}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          ...sz,
          borderRadius: '50%',
          background: platformColor(platform),
          color: '#fff',
          fontSize: sz.fontSize,
          flexShrink: 0,
        }}
        title={platformLabel(platform)}
      >
        {platformEmoji(platform)}
      </span>
    );
  }

  // ── TAB 1: PUBLISHER ──────────────────────────────────────────────────────────
  function renderPublisher() {
    const queuePosts = posts.filter(p => {
      if (postQueueTab === 'scheduled') return p.status === 'scheduled';
      if (postQueueTab === 'drafts') return p.status === 'draft';
      if (postQueueTab === 'published') return p.status === 'published';
      if (postQueueTab === 'failed') return p.status === 'failed';
      return false;
    });

    return (
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* ── Left: Composer ── */}
        <div style={{ flex: '0 0 520px', maxWidth: 520 }}>
          {/* Connected accounts strip */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9ca3af' }}>Connected Accounts</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  onClick={importCampaignAsDrafts}
                  disabled={campaignImporting}
                  style={{ fontSize: 11, color: '#92400e', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px', cursor: campaignImporting ? 'not-allowed' : 'pointer', fontWeight: 700 }}
                >
                  {campaignImporting ? '⏳ Importing…' : '📢 Import Campaign'}
                </button>
                <button
                  onClick={() => window.open(`/api/auth/social/facebook?userId=${agentId}`, '_blank')}
                  style={{ fontSize: 11, color: '#C9A84C', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                >
                  + Connect Account
                </button>
              </div>
            </div>
            {connectionsLoading ? (
              <div style={{ fontSize: 12, color: '#9ca3af' }}>Loading...</div>
            ) : connections.length === 0 ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ALL_PLATFORMS.map(p => (
                  <button
                    key={p}
                    onClick={() => window.open(`/api/auth/social/${p === 'instagram' ? 'facebook' : p}?userId=${agentId}`, '_blank')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '7px 12px', borderRadius: 8,
                      border: '1px dashed #d1d5db',
                      background: '#f9fafb', cursor: 'pointer',
                      fontSize: 12, color: '#9ca3af',
                    }}
                  >
                    <span>{platformEmoji(p)}</span>
                    <span>Connect {platformLabel(p)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ALL_PLATFORMS.map(p => {
                  const conn = connections.find(c => c.platform === p);
                  if (conn) {
                    return (
                      <div
                        key={p}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '7px 12px', borderRadius: 8,
                          border: `1px solid ${platformColor(p)}30`,
                          background: `${platformColor(p)}0d`,
                        }}
                      >
                        <span style={{ fontSize: 16 }}>{platformEmoji(p)}</span>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#1a1a2e' }}>{conn.account_name}</div>
                          <div style={{ fontSize: 10, color: '#9ca3af' }}>{fmtNum(conn.followers_count)} followers</div>
                        </div>
                        <button
                          onClick={() => { /* disconnect */ }}
                          style={{ background: 'none', border: 'none', fontSize: 10, color: '#9ca3af', cursor: 'pointer', marginLeft: 4 }}
                          title="Disconnect"
                        >✕</button>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={p}
                      onClick={() => window.open(`/api/auth/social/${p === 'instagram' ? 'facebook' : p}?userId=${agentId}`, '_blank')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 12px', borderRadius: 8,
                        border: '1px dashed #d1d5db',
                        background: '#f9fafb', cursor: 'pointer',
                        fontSize: 12, color: '#9ca3af',
                      }}
                    >
                      <span style={{ opacity: 0.4 }}>{platformEmoji(p)}</span>
                      <span>Connect</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Composer card */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
            {editingPost && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>✏️ Editing post</span>
                <button onClick={resetComposer} style={{ background: 'none', border: 'none', fontSize: 11, color: '#92400e', cursor: 'pointer' }}>Cancel Edit</button>
              </div>
            )}

            {/* Platform selector */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Post To</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ALL_PLATFORMS.map(p => {
                  const selected = composerPlatforms.includes(p);
                  const connected = connections.some(c => c.platform === p);
                  return (
                    <button
                      key={p}
                      onClick={() => connected && togglePlatform(p)}
                      title={connected ? platformLabel(p) : `Connect ${platformLabel(p)} first`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 13px', borderRadius: 8, cursor: connected ? 'pointer' : 'not-allowed',
                        border: `1.5px solid ${selected ? platformColor(p) : '#e5e7eb'}`,
                        background: selected ? `${platformColor(p)}15` : '#f9fafb',
                        opacity: connected ? 1 : 0.4,
                        transition: 'all .15s',
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{platformEmoji(p)}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: selected ? platformColor(p) : '#6b7280' }}>
                        {platformLabel(p)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {composerPlatforms.includes('youtube') && (
                <div style={{ fontSize: 11, color: '#d97706', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px', marginTop: 8 }}>
                  ⚠️ YouTube video upload is not yet supported — text posts only
                </div>
              )}
            </div>

            {/* AI Caption */}
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={() => setShowAICaption(!showAICaption)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 8,
                  border: '1.5px solid #C9A84C40',
                  background: '#fffbeb', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, color: '#92400e',
                }}
              >
                ✨ Generate Caption with AI
              </button>
              {showAICaption && (
                <div style={{ marginTop: 10, padding: '14px', background: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a' }}>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#92400e', display: 'block', marginBottom: 4 }}>Topic / Property</label>
                    <input
                      value={captionTopic}
                      onChange={e => setCaptionTopic(e.target.value)}
                      placeholder="e.g. Property listing at 123 Main St"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #fde68a', fontSize: 12, background: '#fff', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#92400e', display: 'block', marginBottom: 4 }}>Tone</label>
                    <select
                      value={captionTone}
                      onChange={e => setCaptionTone(e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #fde68a', fontSize: 12, background: '#fff', boxSizing: 'border-box' }}
                    >
                      {['Professional', 'Friendly', 'Exciting', 'Informative'].map(t => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => generateCaption(captionTopic, captionTone)}
                    disabled={captionLoading || !captionTopic.trim()}
                    style={{
                      padding: '8px 18px', borderRadius: 8, border: 'none',
                      background: captionLoading || !captionTopic.trim() ? '#d1d5db' : '#C9A84C',
                      color: '#fff', fontSize: 12, fontWeight: 700, cursor: captionLoading || !captionTopic.trim() ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {captionLoading ? '⏳ Generating...' : '✨ Generate'}
                  </button>
                </div>
              )}
            </div>

            {/* Textarea */}
            <div style={{ marginBottom: 8 }}>
              <textarea
                value={composerContent}
                onChange={e => setComposerContent(e.target.value)}
                placeholder="Write your post..."
                rows={7}
                style={{
                  width: '100%', padding: '12px', borderRadius: 10,
                  border: '1.5px solid #e5e7eb', fontSize: 13, lineHeight: 1.6,
                  resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: charsRemaining() < 0 ? '#dc2626' : charsRemaining() < 50 ? '#d97706' : '#9ca3af',
                }}>
                  {charsRemaining() < 0 ? `${Math.abs(charsRemaining())} over limit` : `${charsRemaining()} chars remaining`}
                  {composerPlatforms.length > 0 && (
                    <span style={{ color: '#d1d5db', marginLeft: 4 }}>
                      (limit: {fmtNum(charLimit())} — {composerPlatforms.map(p => platformLabel(p)).join(', ')})
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Media upload */}
            <div style={{ marginBottom: 14 }}>
              <div
                onClick={() => mediaInputRef.current?.click()}
                style={{
                  border: '2px dashed #e5e7eb', borderRadius: 10, padding: '16px',
                  textAlign: 'center', cursor: 'pointer',
                  background: composerMediaUrls.length > 0 ? '#f0fdf4' : '#fafafa',
                  transition: 'all .15s',
                }}
              >
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    const newUrls = files.map(f => URL.createObjectURL(f));
                    setComposerMediaUrls(prev => [...prev, ...newUrls].slice(0, 10));
                  }}
                />
                {composerMediaUrls.length === 0 ? (
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🖼️</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>Click or drag to upload images/videos</div>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>Max 10 files</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {composerMediaUrls.map((url, i) => (
                      <div key={i} style={{ position: 'relative' }}>
                        <img src={url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '2px solid #e5e7eb' }} />
                        <button
                          onClick={e => { e.stopPropagation(); setComposerMediaUrls(prev => prev.filter((_, idx) => idx !== i)); }}
                          style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >✕</button>
                      </div>
                    ))}
                    <div style={{ width: 64, height: 64, border: '2px dashed #d1d5db', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#9ca3af' }}>+</div>
                  </div>
                )}
              </div>
            </div>

            {/* Link URL */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 }}>Add Link</label>
              <input
                value={composerLinkUrl}
                onChange={e => setComposerLinkUrl(e.target.value)}
                placeholder="https://..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: 12, boxSizing: 'border-box' }}
              />
            </div>

            {/* Hashtags */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}># Hashtags</label>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/crm/social/hashtags', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: composerContent, platforms: composerPlatforms }),
                      });
                      const data = await res.json();
                      if (data.hashtags) setComposerHashtags(data.hashtags.join(' '));
                    } catch {
                      toast('Failed to suggest hashtags');
                    }
                  }}
                  style={{ fontSize: 11, color: '#C9A84C', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                >
                  ✨ Suggest
                </button>
              </div>
              <input
                value={composerHashtags}
                onChange={e => setComposerHashtags(e.target.value)}
                placeholder="#realestate #fairoak #property"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: 12, boxSizing: 'border-box' }}
              />
            </div>

            {/* First comment (collapsible) */}
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={() => setShowFirstComment(!showFirstComment)}
                style={{ background: 'none', border: 'none', fontSize: 12, color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span style={{ fontSize: 10 }}>{showFirstComment ? '▼' : '▶'}</span>
                💬 First Comment (Instagram strategy)
              </button>
              {showFirstComment && (
                <textarea
                  value={composerFirstComment}
                  onChange={e => setComposerFirstComment(e.target.value)}
                  placeholder="Add a first comment (great for hiding hashtags on Instagram)..."
                  rows={3}
                  style={{ width: '100%', marginTop: 8, padding: '8px 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              )}
            </div>

            {/* Internal notes (collapsible) */}
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={() => setShowInternalNotes(!showInternalNotes)}
                style={{ background: 'none', border: 'none', fontSize: 12, color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span style={{ fontSize: 10 }}>{showInternalNotes ? '▼' : '▶'}</span>
                📝 Internal Notes
              </button>
              {showInternalNotes && (
                <textarea
                  value={composerNotes}
                  onChange={e => setComposerNotes(e.target.value)}
                  placeholder="Internal notes (not published)..."
                  rows={2}
                  style={{ width: '100%', marginTop: 8, padding: '8px 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              )}
            </div>

            {/* Schedule / Post Now */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {(['schedule', 'now'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setPostMode(m)}
                    style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                      border: `1.5px solid ${postMode === m ? '#1a1a2e' : '#e5e7eb'}`,
                      background: postMode === m ? '#1a1a2e' : '#f9fafb',
                      color: postMode === m ? '#fff' : '#6b7280',
                      fontWeight: 600,
                    }}
                  >
                    {m === 'schedule' ? '📅 Schedule' : '⚡ Post Now'}
                  </button>
                ))}
              </div>
              {postMode === 'schedule' && (
                <input
                  type="datetime-local"
                  value={composerScheduledAt}
                  onChange={e => setComposerScheduledAt(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: 12, boxSizing: 'border-box' }}
                />
              )}
            </div>

            {/* Submit buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => savePost('draft')}
                disabled={composerLoading}
                style={{ flex: 1, padding: '10px', borderRadius: 9, border: '1.5px solid #e5e7eb', background: '#f9fafb', fontSize: 13, fontWeight: 700, color: '#6b7280', cursor: composerLoading ? 'not-allowed' : 'pointer' }}
              >
                Save Draft
              </button>
              {postMode === 'schedule' ? (
                <button
                  onClick={() => savePost('scheduled')}
                  disabled={composerLoading || !composerScheduledAt || composerPlatforms.length === 0}
                  style={{
                    flex: 2, padding: '10px', borderRadius: 9, border: 'none',
                    background: (composerLoading || !composerScheduledAt || composerPlatforms.length === 0) ? '#d1d5db' : '#1a1a2e',
                    fontSize: 13, fontWeight: 700, color: '#fff',
                    cursor: (composerLoading || !composerScheduledAt || composerPlatforms.length === 0) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {composerLoading ? '⏳ Saving...' : '📅 Schedule Post'}
                </button>
              ) : (
                <button
                  onClick={() => savePost('published')}
                  disabled={composerLoading || composerPlatforms.length === 0}
                  style={{
                    flex: 2, padding: '10px', borderRadius: 9, border: 'none',
                    background: (composerLoading || composerPlatforms.length === 0) ? '#d1d5db' : '#C9A84C',
                    fontSize: 13, fontWeight: 700, color: '#fff',
                    cursor: (composerLoading || composerPlatforms.length === 0) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {composerLoading ? '⏳ Posting...' : '⚡ Post Now'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Post Queue ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #f0f0f0' }}>
              {(['scheduled', 'drafts', 'published', 'failed'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setPostQueueTab(tab)}
                  style={{
                    flex: 1, padding: '12px 8px', border: 'none',
                    borderBottom: `2px solid ${postQueueTab === tab ? '#1a1a2e' : 'transparent'}`,
                    background: 'none', fontSize: 12, fontWeight: 700,
                    color: postQueueTab === tab ? '#1a1a2e' : '#9ca3af',
                    cursor: 'pointer', textTransform: 'capitalize',
                  }}
                >
                  {tab === 'scheduled' ? '📅' : tab === 'drafts' ? '✏️' : tab === 'published' ? '✅' : '❌'} {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  <span style={{ marginLeft: 5, background: '#f3f4f6', color: '#6b7280', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
                    {posts.filter(p => {
                      if (tab === 'scheduled') return p.status === 'scheduled';
                      if (tab === 'drafts') return p.status === 'draft';
                      if (tab === 'published') return p.status === 'published';
                      return p.status === 'failed';
                    }).length}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ padding: '16px', maxHeight: 600, overflowY: 'auto' }}>
              {postsLoading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af', fontSize: 13 }}>Loading posts...</div>
              ) : queuePosts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>
                    {postQueueTab === 'scheduled' ? '📅' : postQueueTab === 'drafts' ? '✏️' : postQueueTab === 'published' ? '✅' : '❌'}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 }}>
                    No {postQueueTab} posts yet
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>
                    {postQueueTab === 'scheduled' ? 'Create your first post and schedule it →' : `No ${postQueueTab} posts to show.`}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {queuePosts.map(post => {
                    const badge = statusBadge(post.status);
                    const timeStr = post.scheduled_at
                      ? new Date(post.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                      : post.published_at
                      ? new Date(post.published_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                      : null;
                    const isPreviewing = previewPostId === post.id;

                    return (
                      <div key={post.id} style={{ borderRadius: 10, border: `1px solid ${isPreviewing ? '#E1306C40' : '#f0f0f0'}`, background: '#fafafa', overflow: 'hidden', transition: 'border-color .2s' }}>
                        {/* Card header */}
                        <div style={{ padding: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                            <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                              {post.platforms.map(p => renderPlatformBadge(p))}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: 13, color: '#1a1a2e', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                                {post.content}
                              </p>
                            </div>
                            <span style={{ padding: '3px 9px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: badge.bg, color: badge.color, flexShrink: 0 }}>
                              {post.status}
                            </span>
                          </div>

                          {timeStr && (
                            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
                              {post.status === 'scheduled' ? '📅' : '✅'} {timeStr}
                            </div>
                          )}

                          {post.status === 'published' && (
                            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>👍 {post.engagement?.likes || 0}</span>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>💬 {post.engagement?.comments || 0}</span>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>🔁 {post.engagement?.shares || 0}</span>
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => setPreviewPostId(isPreviewing ? null : post.id)}
                              style={{ padding: '4px 12px', borderRadius: 7, border: `1px solid ${isPreviewing ? '#E1306C' : '#e5e7eb'}`, background: isPreviewing ? '#fff0f5' : '#fff', fontSize: 11, color: isPreviewing ? '#E1306C' : '#374151', cursor: 'pointer', fontWeight: 600 }}
                            >
                              {isPreviewing ? '✕ Hide Preview' : '📸 Preview'}
                            </button>
                            <button
                              onClick={() => openEditPost(post)}
                              style={{ padding: '4px 12px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', fontSize: 11, color: '#374151', cursor: 'pointer', fontWeight: 600 }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              onClick={() => deletePost(post.id)}
                              style={{ padding: '4px 12px', borderRadius: 7, border: '1px solid #fee2e2', background: '#fff', fontSize: 11, color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </div>

                        {/* Inline Instagram Preview */}
                        {isPreviewing && (
                          <div style={{ borderTop: '1px solid #E1306C20', background: '#fff8fa', padding: '16px', display: 'flex', justifyContent: 'center' }}>
                            <div style={{
                              width: '100%', maxWidth: 320, background: '#fff', borderRadius: 12,
                              border: '1px solid #dbdbdb', boxShadow: '0 2px 12px rgba(0,0,0,.07)',
                              overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                            }}>
                              {/* IG header */}
                              <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 8 }}>
                                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>FO</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: '#000' }}>fairoaksrealtygroup</div>
                                  <div style={{ fontSize: 10, color: '#8e8e8e' }}>{timeStr || 'Draft'}</div>
                                </div>
                                <span style={{ fontSize: 16, color: '#000' }}>···</span>
                              </div>
                              {/* Image area */}
                              <div style={{ width: '100%', aspectRatio: '1 / 1', background: 'linear-gradient(135deg, #1a1a2e 0%, #C9A84C 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                <div style={{ fontSize: 30 }}>🏡</div>
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Add photo when editing</div>
                              </div>
                              {/* Actions + caption */}
                              <div style={{ padding: '8px 12px 10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <div style={{ display: 'flex', gap: 12 }}>
                                    <span style={{ fontSize: 20 }}>🤍</span>
                                    <span style={{ fontSize: 20 }}>💬</span>
                                    <span style={{ fontSize: 20 }}>📤</span>
                                  </div>
                                  <span style={{ fontSize: 20 }}>🔖</span>
                                </div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#000', marginBottom: 4 }}>243 likes</div>
                                <div style={{ fontSize: 12, color: '#000', lineHeight: 1.5 }}>
                                  <span style={{ fontWeight: 700 }}>fairoaksrealtygroup </span>
                                  <span style={{ whiteSpace: 'pre-wrap' }}>
                                    {post.content.split(' ').map((word, wi) => (
                                      <span key={wi} style={{ color: word.startsWith('#') || word.startsWith('@') ? '#00376b' : 'inherit' }}>{word} </span>
                                    ))}
                                  </span>
                                </div>
                                {post.hashtags?.length > 0 && (
                                  <div style={{ fontSize: 12, color: '#00376b', marginTop: 4, lineHeight: 1.5 }}>
                                    {post.hashtags.join(' ')}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── TAB 2: CALENDAR ───────────────────────────────────────────────────────────
  function renderCalendar() {
    const today = new Date();
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    function prevPeriod() {
      const d = new Date(calendarDate);
      if (calendarView === 'month') d.setMonth(d.getMonth() - 1);
      else d.setDate(d.getDate() - 7);
      setCalendarDate(d);
    }

    function nextPeriod() {
      const d = new Date(calendarDate);
      if (calendarView === 'month') d.setMonth(d.getMonth() + 1);
      else d.setDate(d.getDate() + 7);
      setCalendarDate(d);
    }

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build month grid
    function buildMonthGrid() {
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrev = new Date(year, month, 0).getDate();
      const cells: Array<{ date: Date; isCurrentMonth: boolean }> = [];

      for (let i = firstDay - 1; i >= 0; i--) {
        cells.push({ date: new Date(year, month - 1, daysInPrev - i), isCurrentMonth: false });
      }
      for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ date: new Date(year, month, d), isCurrentMonth: true });
      }
      const remaining = 42 - cells.length;
      for (let d = 1; d <= remaining; d++) {
        cells.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
      }
      return cells;
    }

    // Get posts for a specific date
    function getPostsForDate(date: Date): SocialPost[] {
      return posts.filter(p => {
        const dateStr = p.scheduled_at || p.published_at;
        if (!dateStr) return false;
        const postDate = new Date(dateStr);
        return postDate.getFullYear() === date.getFullYear() &&
          postDate.getMonth() === date.getMonth() &&
          postDate.getDate() === date.getDate();
      });
    }

    // Build week days
    function buildWeekDays(): Date[] {
      const startOfWeek = new Date(calendarDate);
      const day = startOfWeek.getDay();
      startOfWeek.setDate(startOfWeek.getDate() - day);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() + i);
        return d;
      });
    }

    const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6am to 10pm

    return (
      <div>
        {/* Calendar header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={prevPeriod}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}
            >←</button>
            <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>
              {calendarView === 'month'
                ? `${monthNames[month]} ${year}`
                : `Week of ${buildWeekDays()[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
              }
            </h3>
            <button
              onClick={nextPeriod}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}
            >→</button>
            <button
              onClick={() => setCalendarDate(new Date())}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}
            >Today</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Platform legend */}
            <div style={{ display: 'flex', gap: 8 }}>
              {ALL_PLATFORMS.map(p => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: platformColor(p), display: 'inline-block' }} />
                  {platformLabel(p).split('/')[0]}
                </div>
              ))}
            </div>
            {/* View toggle */}
            <div style={{ display: 'flex', gap: 4, background: '#f3f4f6', borderRadius: 8, padding: 3 }}>
              {(['month', 'week'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setCalendarView(v)}
                  style={{
                    padding: '5px 14px', borderRadius: 6, border: 'none',
                    background: calendarView === v ? '#fff' : 'none',
                    fontSize: 12, fontWeight: 700, color: calendarView === v ? '#1a1a2e' : '#9ca3af',
                    cursor: 'pointer', boxShadow: calendarView === v ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                  }}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setActiveTab('publisher'); setComposerOpen(true); }}
              style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: '#C9A84C', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              + New Post
            </button>
          </div>
        </div>

        {calendarView === 'month' ? (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', overflow: 'hidden' }}>
            {/* Day headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #f0f0f0' }}>
              {dayNames.map(d => (
                <div key={d} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
                  {d}
                </div>
              ))}
            </div>
            {/* Days grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {buildMonthGrid().map((cell, i) => {
                const dayPosts = getPostsForDate(cell.date);
                const isToday = cell.date.toDateString() === today.toDateString();
                const isBorder = i % 7 !== 6;
                const isBottomBorder = i < 35;

                return (
                  <div
                    key={i}
                    onClick={() => {
                      if (cell.isCurrentMonth) {
                        const dt = new Date(cell.date);
                        dt.setHours(9, 0, 0, 0);
                        setComposerScheduledAt(dt.toISOString().slice(0, 16));
                        setActiveTab('publisher');
                        setPostMode('schedule');
                      }
                    }}
                    style={{
                      minHeight: 100, padding: '8px',
                      borderRight: isBorder ? '1px solid #f0f0f0' : 'none',
                      borderBottom: isBottomBorder ? '1px solid #f0f0f0' : 'none',
                      background: isToday ? '#fffbeb' : cell.isCurrentMonth ? '#fff' : '#fafafa',
                      cursor: cell.isCurrentMonth ? 'pointer' : 'default',
                      transition: 'background .1s',
                    }}
                    onMouseEnter={e => { if (cell.isCurrentMonth) (e.currentTarget as HTMLDivElement).style.background = '#f9fafb'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isToday ? '#fffbeb' : cell.isCurrentMonth ? '#fff' : '#fafafa'; }}
                  >
                    <div style={{
                      fontSize: 12, fontWeight: 700,
                      color: isToday ? '#fff' : cell.isCurrentMonth ? '#1a1a2e' : '#d1d5db',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: isToday ? 24 : 'auto', height: isToday ? 24 : 'auto',
                      background: isToday ? '#C9A84C' : 'none',
                      borderRadius: isToday ? '50%' : 0,
                      marginBottom: 4,
                    } as React.CSSProperties}>
                      {cell.date.getDate()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {dayPosts.slice(0, 3).map((post, pi) => (
                        <button
                          key={post.id}
                          onClick={e => { e.stopPropagation(); openEditPost(post); setActiveTab('publisher'); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 3,
                            padding: '2px 5px', borderRadius: 4, border: 'none',
                            background: platformColor(post.platforms[0] || 'facebook') + '20',
                            color: platformColor(post.platforms[0] || 'facebook'),
                            fontSize: 10, fontWeight: 600, cursor: 'pointer',
                            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                            maxWidth: '100%',
                          }}
                        >
                          <span style={{ flexShrink: 0 }}>{platformEmoji(post.platforms[0] || 'facebook')}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{post.content.slice(0, 20)}</span>
                        </button>
                      ))}
                      {dayPosts.length > 3 && (
                        <div style={{ fontSize: 10, color: '#9ca3af', paddingLeft: 5 }}>+{dayPosts.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // Week view
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', overflow: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '48px repeat(7, 1fr)', minWidth: 700 }}>
              {/* Header row */}
              <div style={{ borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0' }} />
              {buildWeekDays().map((d, i) => {
                const isToday = d.toDateString() === today.toDateString();
                return (
                  <div key={i} style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0', borderRight: i < 6 ? '1px solid #f0f0f0' : 'none', background: isToday ? '#fffbeb' : '#fff' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>{dayNames[d.getDay()]}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: isToday ? '#C9A84C' : '#1a1a2e', marginTop: 2 }}>{d.getDate()}</div>
                  </div>
                );
              })}

              {/* Hour rows */}
              {HOURS.map(hour => {
                const label = hour === 12 ? '12pm' : hour < 12 ? `${hour}am` : `${hour - 12}pm`;
                const weekDays = buildWeekDays();
                return (
                  <>
                    <div key={`h-${hour}`} style={{ padding: '4px 8px', fontSize: 10, color: '#9ca3af', textAlign: 'right', borderRight: '1px solid #f0f0f0', borderBottom: '1px solid #f5f5f5', minHeight: 48, display: 'flex', alignItems: 'flex-start', paddingTop: 4 }}>
                      {label}
                    </div>
                    {weekDays.map((d, di) => {
                      const dayPosts = getPostsForDate(d).filter(p => {
                        const dt = new Date(p.scheduled_at || p.published_at || '');
                        return dt.getHours() === hour;
                      });
                      return (
                        <div key={`${hour}-${di}`} style={{ minHeight: 48, borderBottom: '1px solid #f5f5f5', borderRight: di < 6 ? '1px solid #f0f0f0' : 'none', padding: 2, position: 'relative' }}>
                          {dayPosts.map(post => (
                            <button
                              key={post.id}
                              onClick={() => { openEditPost(post); setActiveTab('publisher'); }}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                padding: '3px 6px', borderRadius: 4, border: 'none',
                                background: platformColor(post.platforms[0] || 'facebook') + '20',
                                color: platformColor(post.platforms[0] || 'facebook'),
                                fontSize: 10, fontWeight: 600, cursor: 'pointer', marginBottom: 2,
                                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                              }}
                            >
                              {platformEmoji(post.platforms[0] || 'facebook')} {post.content.slice(0, 20)}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── TAB 3: INBOX ──────────────────────────────────────────────────────────────
  function renderInbox() {
    const filteredItems = inboxItems.filter(item => {
      if (inboxFilter !== 'all' && item.status !== inboxFilter) return false;
      if (inboxTypeFilter !== 'all' && item.type !== inboxTypeFilter) return false;
      if (inboxPlatformFilter !== 'all' && item.platform !== inboxPlatformFilter) return false;
      if (inboxSearch && !item.content.toLowerCase().includes(inboxSearch.toLowerCase()) && !item.from_name.toLowerCase().includes(inboxSearch.toLowerCase())) return false;
      return true;
    });

    function sentimentDot(s: SocialInboxItem['sentiment']) {
      return s === 'positive' ? '🟢' : s === 'negative' ? '🔴' : '🟡';
    }

    return (
      <div>
        {/* Saved Replies Modal */}
        {savedRepliesOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 480, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>Saved Replies</h3>
                <button onClick={() => setSavedRepliesOpen(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9ca3af' }}>✕</button>
              </div>
              <div style={{ marginBottom: 16 }}>
                {savedReplies.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #f0f0f0', marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e' }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{r.content.slice(0, 60)}...</div>
                    </div>
                    <button
                      onClick={() => { setReplyText(r.content); setSavedRepliesOpen(false); }}
                      style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                    >Use</button>
                    <button
                      onClick={() => setSavedReplies(prev => prev.filter(x => x.id !== r.id))}
                      style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #fee2e2', background: '#fff', fontSize: 11, cursor: 'pointer', color: '#dc2626' }}
                    >✕</button>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e', marginBottom: 10 }}>Add New Reply</div>
                <input
                  value={newReplyName}
                  onChange={e => setNewReplyName(e.target.value)}
                  placeholder="Reply name"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}
                />
                <textarea
                  value={newReplyContent}
                  onChange={e => setNewReplyContent(e.target.value)}
                  placeholder="Reply content..."
                  rows={3}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, marginBottom: 10, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                />
                <button
                  onClick={() => {
                    if (newReplyName.trim() && newReplyContent.trim()) {
                      setSavedReplies(prev => [...prev, { id: Date.now().toString(), name: newReplyName, content: newReplyContent }]);
                      setNewReplyName('');
                      setNewReplyContent('');
                    }
                  }}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#1a1a2e', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Save Reply
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          {/* Left: message list */}
          <div style={{ flex: '0 0 360px', background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', overflow: 'hidden' }}>
            {/* Filters */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f0f0f0' }}>
              <input
                value={inboxSearch}
                onChange={e => setInboxSearch(e.target.value)}
                placeholder="🔍 Search messages..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, marginBottom: 10, boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {(['all', 'open', 'resolved', 'spam'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setInboxFilter(f)}
                    style={{
                      padding: '4px 10px', borderRadius: 7, border: `1px solid ${inboxFilter === f ? '#1a1a2e' : '#e5e7eb'}`,
                      background: inboxFilter === f ? '#1a1a2e' : '#fff',
                      color: inboxFilter === f ? '#fff' : '#6b7280',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(['all', 'dm', 'comment', 'mention'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setInboxTypeFilter(f)}
                    style={{
                      padding: '3px 8px', borderRadius: 6, border: `1px solid ${inboxTypeFilter === f ? '#C9A84C' : '#e5e7eb'}`,
                      background: inboxTypeFilter === f ? '#fffbeb' : '#fff',
                      color: inboxTypeFilter === f ? '#92400e' : '#9ca3af',
                      fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
                    }}
                  >
                    {f === 'all' ? 'All Types' : f.toUpperCase()}
                  </button>
                ))}
                <select
                  value={inboxPlatformFilter}
                  onChange={e => setInboxPlatformFilter(e.target.value as SocialPlatform | 'all')}
                  style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 10, color: '#6b7280', background: '#fff' }}
                >
                  <option value="all">All Platforms</option>
                  {ALL_PLATFORMS.map(p => <option key={p} value={p}>{platformLabel(p)}</option>)}
                </select>
              </div>
            </div>

            {/* Message list */}
            <div style={{ overflowY: 'auto', maxHeight: 560 }}>
              {filteredItems.length === 0 ? (
                <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📥</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 }}>No messages yet</div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>Connect your social accounts to start seeing engagement here.</div>
                </div>
              ) : (
                filteredItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedInboxItem(item)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '14px 16px',
                      borderBottom: '1px solid #f5f5f5', background: selectedInboxItem?.id === item.id ? '#f0f9ff' : '#fff',
                      border: 'none', cursor: 'pointer', display: 'block',
                      borderLeft: selectedInboxItem?.id === item.id ? '3px solid #1DA1F2' : '3px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: platformColor(item.platform) + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                          {platformEmoji(item.platform)}
                        </div>
                        {item.status === 'open' && (
                          <div style={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: '50%', background: '#3b82f6', border: '2px solid #fff' }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.from_name}</span>
                          <span style={{ fontSize: 10, color: '#9ca3af' }}>@{item.from_handle}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ padding: '1px 6px', borderRadius: 4, background: item.type === 'dm' ? '#dbeafe' : item.type === 'comment' ? '#dcfce7' : '#f3e8ff', color: item.type === 'dm' ? '#1d4ed8' : item.type === 'comment' ? '#15803d' : '#7e22ce', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{item.type}</span>
                          <span style={{ fontSize: 10 }}>{sentimentDot(item.sentiment)}</span>
                          <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>{timeAgo(item.created_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 46 }}>
                      {item.content}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: message detail */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!selectedInboxItem ? (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '60px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 }}>Select a message</div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>Click a message from the left to view and reply.</div>
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: platformColor(selectedInboxItem.platform) + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                      {platformEmoji(selectedInboxItem.platform)}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{selectedInboxItem.from_name}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>
                        @{selectedInboxItem.from_handle} · {platformLabel(selectedInboxItem.platform)} {selectedInboxItem.type.toUpperCase()} · {timeAgo(selectedInboxItem.created_at)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => updateInboxStatus(selectedInboxItem.id, selectedInboxItem.status === 'resolved' ? 'open' : 'resolved')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #bbf7d0', background: '#f0fdf4', fontSize: 12, color: '#15803d', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {selectedInboxItem.status === 'resolved' ? '↩ Reopen' : '✓ Resolve'}
                    </button>
                    <button
                      onClick={() => updateInboxStatus(selectedInboxItem.id, 'spam')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', fontSize: 12, color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
                    >
                      🚫 Spam
                    </button>
                  </div>
                </div>

                <div style={{ padding: '20px' }}>
                  {/* Original post preview */}
                  {selectedInboxItem.post_content_preview && (
                    <div style={{ padding: '10px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #f0f0f0', marginBottom: 14 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Original Post</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{selectedInboxItem.post_content_preview}</div>
                    </div>
                  )}

                  {/* Message content */}
                  <div style={{ padding: '14px 16px', background: platformColor(selectedInboxItem.platform) + '08', borderRadius: 10, border: `1px solid ${platformColor(selectedInboxItem.platform)}20`, marginBottom: 20 }}>
                    <div style={{ fontSize: 13, color: '#1a1a2e', lineHeight: 1.6 }}>{selectedInboxItem.content}</div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10 }}>
                        {selectedInboxItem.sentiment === 'positive' ? '🟢 Positive' : selectedInboxItem.sentiment === 'negative' ? '🔴 Negative' : '🟡 Neutral'}
                      </span>
                    </div>
                  </div>

                  {/* Reply area */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e' }}>Reply</div>
                      <button
                        onClick={() => setSavedRepliesOpen(true)}
                        style={{ fontSize: 11, color: '#C9A84C', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                      >
                        📑 Saved Replies
                      </button>
                    </div>
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Type your reply..."
                      rows={4}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', marginBottom: 10, boxSizing: 'border-box', lineHeight: 1.5 }}
                    />
                    <button
                      onClick={() => sendReply(selectedInboxItem.id, replyText)}
                      disabled={!replyText.trim()}
                      style={{ padding: '9px 22px', borderRadius: 9, border: 'none', background: replyText.trim() ? '#1a1a2e' : '#d1d5db', color: '#fff', fontSize: 13, fontWeight: 700, cursor: replyText.trim() ? 'pointer' : 'not-allowed' }}
                    >
                      Send Reply →
                    </button>
                  </div>

                  {/* Previous reply */}
                  {selectedInboxItem.replied_at && (
                    <div style={{ marginTop: 20, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Previous Reply</div>
                      <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                        <div style={{ fontSize: 12, color: '#15803d' }}>{selectedInboxItem.reply_content}</div>
                        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>{timeAgo(selectedInboxItem.replied_at)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── TAB 4: ANALYTICS ─────────────────────────────────────────────────────────
  function renderAnalytics() {
    const totalFollowers = analytics.reduce((sum, a) => sum + a.followers, 0) ||
      connections.reduce((sum, c) => sum + c.followers_count, 0);
    const avgEngagement = analytics.length > 0
      ? analytics.reduce((sum, a) => sum + a.engagement_rate, 0) / analytics.length
      : 0;
    const totalImpressions = analytics.reduce((sum, a) => sum + a.impressions, 0);
    const publishedCount = posts.filter(p => p.status === 'published').length;

    // Best time heatmap data (real estate best practices)
    // 0 = poor, 1 = ok, 2 = warm, 3 = hot
    function heatmapScore(day: number, hour: number): 0 | 1 | 2 | 3 {
      const isWeekend = day === 0 || day === 6;
      if (isWeekend) {
        if (hour >= 10 && hour <= 14) return 2;
        if (hour >= 9 && hour <= 16) return 1;
        return 0;
      }
      if (hour >= 7 && hour <= 9) return 3;
      if (hour >= 12 && hour <= 13) return 3;
      if (hour >= 17 && hour <= 19) return 3;
      if (hour >= 10 && hour <= 11) return 2;
      if (hour >= 14 && hour <= 16) return 2;
      if (hour >= 6 || hour <= 20) return 1;
      return 0;
    }

    const heatmapColors: Record<number, string> = { 0: '#f3f4f6', 1: '#bfdbfe', 2: '#60a5fa', 3: '#1d4ed8' };
    const heatmapDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const heatmapHours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

    // Top 5 posts by engagement
    const topPosts = [...posts]
      .filter(p => p.status === 'published')
      .sort((a, b) => {
        const aEng = (a.engagement?.likes || 0) + (a.engagement?.comments || 0) + (a.engagement?.shares || 0);
        const bEng = (b.engagement?.likes || 0) + (b.engagement?.comments || 0) + (b.engagement?.shares || 0);
        return bEng - aEng;
      })
      .slice(0, 5);

    const statCard = (label: string, value: string, emoji: string, sub: string) => (
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '20px 24px', flex: 1, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>{emoji}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#1a1a2e', fontFamily: "'Cormorant Garamond', serif", lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e', marginTop: 6 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>
      </div>
    );

    return (
      <div>
        {/* CTA for connecting more */}
        {connections.length < 3 && (
          <div style={{ background: '#fffbeb', borderRadius: 12, border: '1px solid #fde68a', padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e' }}>Connect more accounts to see richer analytics</div>
              <div style={{ fontSize: 11, color: '#a16207' }}>You have {connections.length} of 5 platforms connected.</div>
            </div>
            <button
              onClick={() => setActiveTab('publisher')}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C9A84C', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              Connect Accounts →
            </button>
          </div>
        )}

        {/* Top stats */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          {statCard('Total Followers', fmtNum(totalFollowers), '👥', 'Across all accounts')}
          {statCard('Avg Engagement Rate', `${avgEngagement.toFixed(2)}%`, '📊', 'Last 30 days')}
          {statCard('Total Impressions', fmtNum(totalImpressions), '👁️', 'Last 30 days')}
          {statCard('Posts Published', String(publishedCount), '✅', 'Last 30 days')}
        </div>

        {/* Per-platform breakdown */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '20px 24px', marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Platform Breakdown</h3>
          {connections.length === 0 && analytics.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#9ca3af', fontSize: 13 }}>
              No connected accounts. Connect your social accounts to see analytics.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #f0f0f0' }}>
                    {['Account', 'Followers', 'Eng. Rate', 'Impressions', 'Reach', 'Likes', 'Comments', 'Shares'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Account' ? 'left' : 'right', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analytics.length > 0 ? analytics.map((a, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{platformEmoji(a.platform)}</span>
                        <div>
                          <div style={{ fontWeight: 700, color: '#1a1a2e' }}>{a.account_name}</div>
                          <div style={{ fontSize: 10, color: '#9ca3af' }}>{platformLabel(a.platform)}</div>
                        </div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: '#1a1a2e' }}>{fmtNum(a.followers)}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <span style={{ color: a.engagement_rate > 3 ? '#15803d' : a.engagement_rate > 1 ? '#d97706' : '#dc2626', fontWeight: 700 }}>
                          {a.engagement_rate.toFixed(2)}%
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#374151' }}>{fmtNum(a.impressions)}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#374151' }}>{fmtNum(a.reach)}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#374151' }}>👍 {fmtNum(a.likes)}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#374151' }}>💬 {fmtNum(a.comments)}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#374151' }}>🔁 {fmtNum(a.shares)}</td>
                    </tr>
                  )) : connections.map(conn => (
                    <tr key={conn.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 18 }}>{platformEmoji(conn.platform)}</span>
                          <div>
                            <div style={{ fontWeight: 700, color: '#1a1a2e' }}>{conn.account_name}</div>
                            <div style={{ fontSize: 10, color: '#9ca3af' }}>{conn.account_handle}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: '#1a1a2e' }}>{fmtNum(conn.followers_count)}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#9ca3af' }}>—</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#9ca3af' }}>—</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#9ca3af' }}>—</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#9ca3af' }}>—</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#9ca3af' }}>—</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#9ca3af' }}>—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
          {/* Best time to post heatmap */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Best Times to Post</h3>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>Based on real estate audience data</div>
            </div>
            {/* Legend */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
              {([['Poor', 0], ['OK', 1], ['Warm', 2], ['Hot', 3]] as const).map(([label, score]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#6b7280' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: heatmapColors[score] }} />
                  {label}
                </div>
              ))}
            </div>
            {/* Grid */}
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `32px repeat(${heatmapHours.length}, 1fr)`, gap: 2, minWidth: 400 }}>
                <div />
                {heatmapHours.map(h => (
                  <div key={h} style={{ fontSize: 9, color: '#9ca3af', textAlign: 'center' }}>
                    {h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
                  </div>
                ))}
                {heatmapDays.map((day, di) => (
                  <>
                    <div key={`d-${di}`} style={{ fontSize: 10, color: '#6b7280', display: 'flex', alignItems: 'center' }}>{day}</div>
                    {heatmapHours.map(h => {
                      const score = heatmapScore(di, h);
                      return (
                        <div
                          key={`${di}-${h}`}
                          title={`${day} ${h}:00 — ${['Poor', 'OK', 'Warm', 'Hot'][score]}`}
                          style={{
                            height: 18, borderRadius: 3,
                            background: heatmapColors[score],
                            cursor: 'default',
                          }}
                        />
                      );
                    })}
                  </>
                ))}
              </div>
            </div>
          </div>

          {/* Top Posts */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '20px 24px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Top Posts by Engagement</h3>
            {topPosts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: '#9ca3af', fontSize: 12 }}>
                No published posts yet. Start publishing to see your top performers!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {topPosts.map((post, i) => {
                  const totalEng = (post.engagement?.likes || 0) + (post.engagement?.comments || 0) + (post.engagement?.shares || 0);
                  return (
                    <div key={post.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: '#fafafa', border: '1px solid #f0f0f0' }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: i === 0 ? '#C9A84C' : '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: i === 0 ? '#fff' : '#9ca3af', flexShrink: 0 }}>
                        {i + 1}
                      </div>
                      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                        {post.platforms.slice(0, 2).map(p => renderPlatformBadge(p))}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.content}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>👍 {post.engagement?.likes || 0}</span>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>💬 {post.engagement?.comments || 0}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#1a1a2e' }}>= {totalEng}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 32px', minHeight: '100vh', background: '#f8f8f8' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, fontWeight: 700, color: '#1a1a2e', margin: 0, marginBottom: 4 }}>
            Social Media
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
            Manage all your social platforms from one place
          </p>
        </div>
        {activeTab === 'publisher' && (
          <button
            onClick={() => { resetComposer(); setComposerOpen(true); }}
            style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#1a1a2e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            ✏️ Compose Post
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #f0f0f0', marginBottom: 28, gap: 0 }}>
        {([
          { id: 'publisher', label: 'Publisher', emoji: '✏️' },
          { id: 'calendar', label: 'Calendar', emoji: '📅' },
          { id: 'inbox', label: 'Inbox', emoji: '📥', badge: inboxItems.filter(i => i.status === 'open').length },
          { id: 'analytics', label: 'Analytics', emoji: '📊' },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 20px', border: 'none', background: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? '#1a1a2e' : 'transparent'}`,
              marginBottom: -2, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              color: activeTab === tab.id ? '#1a1a2e' : '#9ca3af',
              display: 'flex', alignItems: 'center', gap: 7,
              transition: 'color .15s',
            }}
          >
            <span>{tab.emoji}</span>
            <span>{tab.label}</span>
            {'badge' in tab && tab.badge > 0 && (
              <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'publisher' && renderPublisher()}
      {activeTab === 'calendar' && renderCalendar()}
      {activeTab === 'inbox' && renderInbox()}
      {activeTab === 'analytics' && renderAnalytics()}
    </div>
  );
}
