'use client';

import { useEffect, useState, useRef } from 'react';
import VideoEditorModal from './VideoEditorModal';

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

const ALL_PLATFORMS: SocialPlatform[] = ['facebook', 'instagram', 'youtube'];
const POSTABLE_PLATFORMS: SocialPlatform[] = ['facebook', 'instagram', 'youtube'];

// ── New Office Campaign Posts ──────────────────────────────────────────────────
const CAMPAIGN_POSTS: Array<{ label: string; emoji: string; platform: SocialPlatform; content: string; hashtags: string; scheduledDaysOut: number; mediaUrls: string[] }> = [
  {
    label: 'Post 1 — Teaser',
    emoji: '👀',
    platform: 'instagram',
    scheduledDaysOut: 0,
    content: `Something big is coming to Fair Oaks. 👀\n\nWe've been building something special for our clients, our agents, and our community — and we can't wait to share it with you.\n\nStay tuned. 🗝️`,
    hashtags: '#FairOaksRealty #ComingSoon #FairOaks #RealEstateTexas #NewBeginnings',
    mediaUrls: ['https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1080&h=1080&fit=crop'],
  },
  {
    label: 'Post 2 — Grand Announcement',
    emoji: '🎉',
    platform: 'instagram',
    scheduledDaysOut: 3,
    content: `🎉 WE'VE MOVED — and we love our new home.\n\nFair Oaks Realty Group has officially opened its doors at our brand-new location:\n\n📍 8000 Fair Oaks Pkwy\n\nThis move is more than a new address — it's a reflection of how far we've come and our commitment to serving you at the highest level. Bigger space. Better tools. Same team that's always had your back.\n\nCome see us. We'd love to have you stop by. 🤝`,
    hashtags: '#FairOaksRealtyGroup #NewOffice #FairOaksPkwy #RealEstate #SanAntonio #GrandOpening #WeveMovedHome',
    mediaUrls: ['https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1080&h=1080&fit=crop'],
  },
  {
    label: 'Post 3 — Inside Look',
    emoji: '🏠',
    platform: 'instagram',
    scheduledDaysOut: 4,
    content: `Take a look inside our new home. 🏠✨\n\nWe designed this space with one goal in mind — giving our clients and agents the best possible experience. Swipe to see where the magic happens. ➡️\n\nWhether you're buying, selling, or just curious about the market — our door is always open.\n\n📍 8000 Fair Oaks Pkwy\n🌐 fairoaksrealtygroup.com`,
    hashtags: '#OfficeTour #FairOaksRealty #RealEstateLife #NewSpace #RealEstateAgents #FairOaksTexas',
    mediaUrls: ['https://images.unsplash.com/photo-1497366216548-37526070297c?w=1080&h=1080&fit=crop'],
  },
  {
    label: 'Post 4 — Meet the Team',
    emoji: '💛',
    platform: 'instagram',
    scheduledDaysOut: 5,
    content: `The people make the place. 💛\n\nMeet the team behind Fair Oaks Realty Group — now settled into our new office at 8000 Fair Oaks Pkwy and ready to help you make your next move.\n\nBuying? Selling? Relocating? We've got an expert for every situation.\n\nDrop a 👋 in the comments and we'll make sure you're connected with the right agent.`,
    hashtags: '#MeetTheTeam #FairOaksRealtyGroup #RealEstateAgents #FairOaks #NewOffice #YourRealtors',
    mediaUrls: ['https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1080&h=1080&fit=crop'],
  },
  {
    label: 'Post 5 — Community CTA',
    emoji: '🏡',
    platform: 'instagram',
    scheduledDaysOut: 7,
    content: `Home isn't just where you live — it's where you belong. 🏡\n\nAt Fair Oaks Realty Group, we've planted our roots right here in the community we love. Our new office at 8000 Fair Oaks Pkwy is our home base, but your dream home is what drives us.\n\nIf you're thinking about buying or selling in 2025 — let's talk. No pressure, just a conversation.\n\n🔗 Link in bio to connect with an agent.`,
    hashtags: '#FairOaksRealty #DreamHome #TexasRealEstate #BuyingAHome #SellingYourHome #FairOaksCommunity #RealEstateTips',
    mediaUrls: ['https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1080&h=1080&fit=crop'],
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
  const [postQueueTab, setPostQueueTab] = useState<'all' | 'scheduled' | 'drafts' | 'published' | 'failed'>('drafts');
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
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [captionLoading, setCaptionLoading] = useState(false);

  // Video editor
  const [videoEditorOpen, setVideoEditorOpen] = useState(false);
  const [videoEditorIndex, setVideoEditorIndex] = useState(0);

  // Image editor
  const [imgEditorOpen, setImgEditorOpen] = useState(false);
  const [imgEditorIndex, setImgEditorIndex] = useState(0);
  const [imgEditorAspect, setImgEditorAspect] = useState<'1:1'|'4:5'|'16:9'|'9:16'>('1:1');
  const [imgEditorOffsetX, setImgEditorOffsetX] = useState(0);
  const [imgEditorOffsetY, setImgEditorOffsetY] = useState(0);
  const [imgEditorScale, setImgEditorScale] = useState(1);
  const [imgEditorSaving, setImgEditorSaving] = useState(false);
  const imgEditorDragRef = useRef<{ startX: number; startY: number; offX: number; offY: number } | null>(null);
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

  // Schedule from draft card
  const [schedulingPostId, setSchedulingPostId] = useState<string | null>(null);
  const [schedulingDate, setSchedulingDate] = useState('');

  // Manual Instagram connect modal
  const [showIgModal, setShowIgModal] = useState(false);
  const [igHandle, setIgHandle] = useState('');
  const [igSaving, setIgSaving] = useState(false);

  // Media upload ref
  const mediaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadConnections();
    loadPosts(true);
    loadInbox();
    loadAnalytics();

    // Handle OAuth result via localStorage (works for both popup and new-tab flows)
    function handleStorage(e: StorageEvent) {
      if (e.key !== '_social_oauth' || !e.newValue) return;
      try {
        const { qs } = JSON.parse(e.newValue);
        handleOAuthResult(qs);
        localStorage.removeItem('_social_oauth');
      } catch {}
    }
    window.addEventListener('storage', handleStorage);

    // Also handle postMessage fallback from popup
    function handleOAuthMessage(e: MessageEvent) {
      if (!e.data || e.data.type !== 'social_oauth_done') return;
      handleOAuthResult(e.data.qs ?? '');
    }
    window.addEventListener('message', handleOAuthMessage);

    // Also handle legacy full-page redirect callback (non-popup fallback)
    const params = new URLSearchParams(window.location.search);
    const socialResult = params.get('social');
    const platform = params.get('platform');
    const reason = params.get('reason');
    if (socialResult === 'connected') {
      toast(`✅ ${platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Account'} connected successfully!`);
      const url = new URL(window.location.href);
      url.searchParams.delete('social');
      url.searchParams.delete('platform');
      url.searchParams.delete('count');
      window.history.replaceState({}, '', url);
      loadConnections();
    } else if (socialResult === 'error') {
      const fbError = params.get('fb_error');
      const messages: Record<string, string> = {
        oauth_denied: fbError ? `Facebook error: ${fbError}` : 'Connection cancelled.',
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
      url.searchParams.delete('fb_error');
      window.history.replaceState({}, '', url);
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('message', handleOAuthMessage);
    };
  }, []);

  // ── OAuth result handler (shared between localStorage + postMessage paths) ────
  function handleOAuthResult(qs: string) {
    const params = new URLSearchParams(qs);
    const socialResult = params.get('social');
    const platform = params.get('platform');
    const reason = params.get('reason');
    const label = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Account';
    if (socialResult === 'connected') {
      toast(`✅ ${label} connected!`);
      loadConnections();
    } else if (socialResult === 'error') {
      const messages: Record<string, string> = {
        oauth_denied: 'Connection cancelled.',
        invalid_state: 'Security check failed — please try again.',
        token_exchange: 'Failed to get access token.',
        no_pages: 'No Facebook Pages found. Make sure you manage at least one Page.',
        no_channel: 'No YouTube channel found on that Google account.',
        invalid_user: 'User not found — please log in again.',
      };
      toast(`❌ ${messages[reason ?? ''] ?? `Connection failed: ${reason}`}`);
    }
  }

  // ── OAuth connect — simple same-tab redirect, no popup complexity ────────────
  function openOAuthPopup(platform: string) {
    window.location.href = `/api/auth/social/${platform}?userId=${agentId}`;
  }

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

  async function loadPosts(seedIfEmpty = false) {
    setPostsLoading(true);
    try {
      const res = await fetch('/api/crm/social/posts');
      const data = await res.json();
      const loaded: SocialPost[] = data.posts || [];
      setPosts(loaded);
      // Auto-seed campaign drafts on first load if the queue is empty
      if (seedIfEmpty && loaded.length === 0) {
        await importCampaignAsDrafts(true);
      }
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

  async function importCampaignAsDrafts(silent = false) {
    setCampaignImporting(true);
    try {
      const today = new Date();
      today.setHours(9, 0, 0, 0); // Schedule at 9am each day
      // Seed sequentially so created_at order matches campaign order
      for (const cp of CAMPAIGN_POSTS) {
        const scheduledDate = new Date(today);
        scheduledDate.setDate(today.getDate() + cp.scheduledDaysOut);
        await fetch('/api/crm/social/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: cp.content,
            platforms: [cp.platform],
            connection_ids: [],
            scheduled_at: scheduledDate.toISOString(),
            status: 'draft',
            media_urls: cp.mediaUrls,
            link_url: 'https://fairoaksrealtygroup.com',
            hashtags: cp.hashtags.split(' ').filter(Boolean),
            first_comment: '',
            internal_notes: `New Office Campaign — ${cp.label}`,
          }),
        });
      }
      if (!silent) toast('📢 5 campaign posts saved to Drafts!');
      setPostQueueTab('drafts');
      const res = await fetch('/api/crm/social/posts');
      const data = await res.json();
      setPosts(data.posts || []);
    } catch {
      if (!silent) toast('Failed to import campaign');
    } finally {
      setCampaignImporting(false);
    }
  }

  async function saveManualInstagram() {
    const handle = igHandle.replace(/^@/, '').trim();
    if (!handle) return;
    setIgSaving(true);
    try {
      // Pass the Facebook page_id so the endpoint can link the page token
      const fbConn = connections.find(c => c.platform === 'facebook');
      const res = await fetch('/api/crm/social/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'instagram', account_name: handle, page_id: fbConn?.page_id ?? null }),
      });
      if (!res.ok) throw new Error();
      toast(`✅ Instagram @${handle} connected!`);
      setShowIgModal(false);
      setIgHandle('');
      loadConnections();
    } catch {
      toast('Failed to connect Instagram');
    } finally {
      setIgSaving(false);
    }
  }

  async function savePost(status: 'draft' | 'scheduled' | 'published') {
    setComposerLoading(true);
    try {
      const body = {
        content: composerContent,
        platforms: composerPlatforms,
        connection_ids: connections.filter(c => composerPlatforms.includes(c.platform)).map(c => c.id),
        scheduled_at: status === 'scheduled' && composerScheduledAt
          ? new Date(composerScheduledAt).toISOString()
          : null,
        status,
        media_urls: composerMediaUrls,
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

  async function schedulePost(postId: string, scheduledAt: string) {
    try {
      const res = await fetch(`/api/crm/social/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'scheduled', scheduled_at: scheduledAt }),
      });
      if (!res.ok) throw new Error();
      toast('📅 Post scheduled!');
      setSchedulingPostId(null);
      setSchedulingDate('');
      loadPosts();
    } catch {
      toast('Failed to schedule post');
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

  function isVideoUrl(url: string): boolean {
    return /\.(mp4|mov|webm|avi|mkv)(\?|$)/i.test(url);
  }

  function openImgEditor(index: number) {
    setImgEditorIndex(index);
    setImgEditorAspect('1:1');
    setImgEditorOffsetX(0);
    setImgEditorOffsetY(0);
    setImgEditorScale(1);
    setImgEditorOpen(true);
  }

  async function applyImageCrop() {
    const url = composerMediaUrls[imgEditorIndex];
    if (!url) return;
    setImgEditorSaving(true);
    try {
      const ASPECT_DIMS: Record<string, [number, number]> = {
        '1:1':  [1080, 1080],
        '4:5':  [1080, 1350],
        '16:9': [1920, 1080],
        '9:16': [1080, 1920],
      };
      const [outW, outH] = ASPECT_DIMS[imgEditorAspect];
      const aspectRatio = outW / outH;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = url; });

      // Preview container dimensions (matches modal preview)
      const MAX_PREVIEW = 360;
      let previewW = MAX_PREVIEW;
      let previewH = MAX_PREVIEW / aspectRatio;
      if (previewH > MAX_PREVIEW) { previewH = MAX_PREVIEW; previewW = MAX_PREVIEW * aspectRatio; }

      // Image is centered in preview at scale, offset applied on top
      const imageDisplayW = previewW * imgEditorScale;
      const imageDisplayH = (previewW / img.naturalWidth * img.naturalHeight) * imgEditorScale;
      const imgLeft = (previewW - imageDisplayW) / 2 + imgEditorOffsetX;
      const imgTop  = (previewH - imageDisplayH) / 2 + imgEditorOffsetY;

      // Convert preview coords to natural image coords
      const scaleX = img.naturalWidth  / imageDisplayW;
      const scaleY = img.naturalHeight / imageDisplayH;
      const srcX = Math.max(0, -imgLeft  * scaleX);
      const srcY = Math.max(0, -imgTop   * scaleY);
      const srcW = Math.min(img.naturalWidth  - srcX, previewW  * scaleX);
      const srcH = Math.min(img.naturalHeight - srcY, previewH  * scaleY);

      const canvas = document.createElement('canvas');
      canvas.width  = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Canvas export failed');

      // Get signed URL then PUT directly to Supabase
      const signRes = await fetch('/api/crm/social/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'cropped.jpg', contentType: 'image/jpeg', size: blob.size }),
      });
      const signData = await signRes.json();
      if (!signRes.ok || !signData.signedUrl) throw new Error(signData.error || 'Upload failed');
      const putRes = await fetch(signData.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      if (!putRes.ok) throw new Error('Storage upload failed');
      const data = { url: signData.publicUrl };

      setComposerMediaUrls(prev => prev.map((u, i) => i === imgEditorIndex ? data.url : u));
      setImgEditorOpen(false);
      toast('Photo updated!');
    } catch (e) {
      alert('Failed to save crop. Please try again.');
      console.error(e);
    } finally {
      setImgEditorSaving(false);
    }
  }

  function openDetailPost(post: SocialPost) {
    setActivePost(post);
    setPublisherView('detail');
    // Pre-load composer state so editing from detail is instant
    setEditingPost(post);
    setComposerContent(post.content);
    setComposerPlatforms(post.platforms);
    setComposerScheduledAt(toDatetimeLocal(post.scheduled_at));
    setPostMode(post.scheduled_at ? 'schedule' : 'now');
    setComposerLinkUrl(post.link_url || '');
    setComposerHashtags(post.hashtags.join(' '));
    setComposerFirstComment(post.first_comment || '');
    setComposerNotes(post.internal_notes || '');
  }

  /** Convert an ISO timestamp to the YYYY-MM-DDTHH:MM format datetime-local inputs require */
  function toDatetimeLocal(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openEditPost(post: SocialPost) {
    setEditingPost(post);
    setComposerContent(post.content);
    setComposerPlatforms(post.platforms);
    setComposerScheduledAt(toDatetimeLocal(post.scheduled_at));
    setComposerLinkUrl(post.link_url || '');
    setComposerHashtags(post.hashtags.join(' '));
    setComposerFirstComment(post.first_comment || '');
    setComposerNotes(post.internal_notes || '');
    setComposerMediaUrls(post.media_urls || []);
    // Ensure schedule mode is active so the datetime picker is visible
    setPostMode(post.scheduled_at ? 'schedule' : 'now');
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

    const tabConfig: Array<{ key: 'drafts' | 'scheduled' | 'published' | 'failed'; label: string; icon: string; activeColor: string }> = [
      { key: 'drafts',    label: 'Drafts',    icon: '✏️', activeColor: '#1a1a2e' },
      { key: 'scheduled', label: 'Scheduled', icon: '📅', activeColor: '#1a1a2e' },
      { key: 'published', label: 'Published', icon: '✅', activeColor: '#1a1a2e' },
      { key: 'failed',    label: 'Failed',    icon: '❌', activeColor: '#dc2626' },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* ── Two-column layout ── */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

          {/* ── LEFT: Composer ── */}
          <div style={{ flex: '0 0 460px', maxWidth: 460 }}>
            <div style={{
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #f0f0f0',
              padding: '24px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
            }}>

              {/* Editing banner */}
              {editingPost && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 18, padding: '10px 14px',
                  background: 'linear-gradient(90deg, #fffbeb, #fef3c7)',
                  border: '1px solid #fde68a', borderRadius: 10,
                }}>
                  <span style={{ fontSize: 12, color: '#92400e', fontWeight: 700 }}>✏️ Editing post</span>
                  <button
                    onClick={resetComposer}
                    style={{ background: 'none', border: 'none', fontSize: 11, color: '#92400e', cursor: 'pointer', fontWeight: 600, opacity: 0.8 }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* POST TO */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 10 }}>
                  Post To
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {POSTABLE_PLATFORMS.map(p => {
                    const selected = composerPlatforms.includes(p);
                    const connected = connections.some(c => c.platform === p);
                    return (
                      <button
                        key={p}
                        onClick={() => connected && togglePlatform(p)}
                        title={connected ? platformLabel(p) : `Connect ${platformLabel(p)} first`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7,
                          padding: '8px 14px', borderRadius: 10, cursor: connected ? 'pointer' : 'not-allowed',
                          border: `1.5px solid ${selected ? platformColor(p) : '#e5e7eb'}`,
                          background: selected ? platformColor(p) : '#f9fafb',
                          opacity: connected ? 1 : 0.38,
                          transition: 'all .15s',
                          boxShadow: selected ? `0 2px 8px ${platformColor(p)}40` : 'none',
                        }}
                      >
                        <span style={{ fontSize: 15 }}>{platformEmoji(p)}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: selected ? '#fff' : '#6b7280' }}>
                          {platformLabel(p)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {composerPlatforms.includes('youtube') && (
                  <div style={{ fontSize: 11, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '6px 12px', marginTop: 10 }}>
                    ▶️ YouTube Shorts — upload a short vertical video (≤ 60 sec, 9:16) below
                  </div>
                )}
              </div>

              {/* AI Caption */}
              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={() => setShowAICaption(!showAICaption)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '8px 16px', borderRadius: 10,
                    border: '1.5px solid #C9A84C',
                    background: showAICaption ? '#C9A84C' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 12, fontWeight: 700,
                    color: showAICaption ? '#fff' : '#92400e',
                    transition: 'all .15s',
                  }}
                >
                  ✨ AI Caption
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{showAICaption ? '▲' : '▼'}</span>
                </button>

                {showAICaption && (
                  <div style={{
                    marginTop: 12, padding: '16px',
                    background: '#fffbeb', borderRadius: 12,
                    border: '1px solid #fde68a',
                  }}>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: '#92400e', display: 'block', marginBottom: 5 }}>Topic / Property</label>
                      <input
                        value={captionTopic}
                        onChange={e => setCaptionTopic(e.target.value)}
                        placeholder="e.g. Property listing at 123 Main St"
                        style={{
                          width: '100%', padding: '8px 11px', borderRadius: 8,
                          border: '1.5px solid #fde68a', fontSize: 12,
                          background: '#fff', boxSizing: 'border-box', outline: 'none',
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: '#92400e', display: 'block', marginBottom: 5 }}>Tone</label>
                      <select
                        value={captionTone}
                        onChange={e => setCaptionTone(e.target.value)}
                        style={{
                          width: '100%', padding: '8px 11px', borderRadius: 8,
                          border: '1.5px solid #fde68a', fontSize: 12,
                          background: '#fff', boxSizing: 'border-box',
                        }}
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
                        padding: '8px 20px', borderRadius: 8, border: 'none',
                        background: captionLoading || !captionTopic.trim() ? '#d1d5db' : '#C9A84C',
                        color: '#fff', fontSize: 12, fontWeight: 700,
                        cursor: captionLoading || !captionTopic.trim() ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {captionLoading ? '⏳ Generating…' : '✨ Generate Caption'}
                    </button>
                  </div>
                )}
              </div>

              {/* Textarea */}
              <div style={{ marginBottom: 16 }}>
                <textarea
                  value={composerContent}
                  onChange={e => setComposerContent(e.target.value)}
                  placeholder="Write your post…"
                  rows={7}
                  style={{
                    width: '100%', padding: '13px 14px', borderRadius: 12,
                    border: '1.5px solid #e5e7eb', fontSize: 13, lineHeight: 1.65,
                    resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                    outline: 'none', transition: 'border-color .15s',
                    color: '#1a1a2e',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#C9A84C'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 5 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: charsRemaining() < 0 ? '#dc2626' : charsRemaining() < 50 ? '#d97706' : '#9ca3af',
                  }}>
                    {charsRemaining() < 0
                      ? `${Math.abs(charsRemaining())} over limit`
                      : `${charsRemaining()} chars remaining`}
                    {composerPlatforms.length > 0 && (
                      <span style={{ color: '#d1d5db', marginLeft: 5 }}>
                        · limit {fmtNum(charLimit())} ({composerPlatforms.map(p => platformLabel(p)).join(', ')})
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Media upload */}
              <div style={{ marginBottom: 16 }}>
                <div
                  onClick={() => !uploadingMedia && mediaInputRef.current?.click()}
                  style={{
                    border: '2px dashed #e5e7eb', borderRadius: 12, padding: composerMediaUrls.length > 0 ? '12px' : '20px',
                    textAlign: 'center', cursor: uploadingMedia ? 'default' : 'pointer',
                    background: composerMediaUrls.length > 0 ? '#f8fff9' : '#fafafa',
                    opacity: uploadingMedia ? 0.7 : 1,
                    transition: 'all .15s',
                  }}
                >
                  <input
                    ref={mediaInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={async e => {
                      const files = Array.from(e.target.files || []);
                      if (!files.length) return;
                      e.target.value = '';
                      setUploadingMedia(true);
                      try {
                        const MAX_MB = 12;
                        const uploaded: string[] = [];
                        for (const file of files) {
                          if (file.size > MAX_MB * 1024 * 1024) {
                            alert(`${file.name} is too large. Maximum file size is ${MAX_MB} MB.`);
                            continue;
                          }
                          // Step 1: get a signed upload URL (avoids 4.5 MB Next.js body limit)
                          const signRes = await fetch('/api/crm/social/upload', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
                          });
                          const signData = await signRes.json();
                          if (!signRes.ok || !signData.signedUrl) {
                            alert(`Failed to prepare upload for ${file.name}: ${signData.error ?? 'Unknown error'}`);
                            continue;
                          }
                          // Step 2: PUT file directly to Supabase — no size limit through our server
                          const putRes = await fetch(signData.signedUrl, {
                            method: 'PUT',
                            headers: { 'Content-Type': file.type },
                            body: file,
                          });
                          if (!putRes.ok) {
                            alert(`Failed to upload ${file.name}. Please try again.`);
                            continue;
                          }
                          uploaded.push(signData.publicUrl);
                        }
                        if (uploaded.length) {
                          setComposerMediaUrls(prev => [...prev, ...uploaded].slice(0, 10));
                        }
                      } catch {
                        alert('Upload failed. Please try again.');
                      } finally {
                        setUploadingMedia(false);
                      }
                    }}
                  />
                  {uploadingMedia ? (
                    <div>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>Uploading…</div>
                    </div>
                  ) : composerMediaUrls.length === 0 ? (
                    <div>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🖼️</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 3 }}>Add Photos or Videos</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>Click to browse · Max 10 files</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {composerMediaUrls.map((url, i) => (
                        <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                          {isVideoUrl(url) ? (
                            <div style={{ width: 72, height: 72, borderRadius: 10, border: '2px solid #e5e7eb', background: '#000', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <video src={url} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.75 }} muted playsInline />
                              <span style={{ position: 'relative', zIndex: 1, fontSize: 20, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.6))' }}>▶️</span>
                              <button
                                onClick={e => { e.stopPropagation(); setVideoEditorIndex(i); setVideoEditorOpen(true); }}
                                title="Edit video"
                                style={{ position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)', width: 22, height: 22, borderRadius: '50%', background: '#fff', border: '1.5px solid #d1d5db', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.15)', zIndex: 2 }}
                              >✂️</button>
                            </div>
                          ) : (
                            <>
                              <img src={url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '2px solid #e5e7eb', display: 'block' }} />
                              <button
                                onClick={e => { e.stopPropagation(); openImgEditor(i); }}
                                title="Edit photo"
                                style={{
                                  position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)',
                                  width: 22, height: 22, borderRadius: '50%',
                                  background: '#fff', border: '1.5px solid #d1d5db',
                                  cursor: 'pointer', fontSize: 11,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)', zIndex: 1,
                                }}
                              >✏️</button>
                            </>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); setComposerMediaUrls(prev => prev.filter((_, idx) => idx !== i)); }}
                            style={{
                              position: 'absolute', top: -6, right: -6, width: 20, height: 20,
                              borderRadius: '50%', background: '#1a1a2e', color: '#fff',
                              border: 'none', cursor: 'pointer', fontSize: 10,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 700,
                            }}
                          >✕</button>
                        </div>
                      ))}
                      <div style={{
                        width: 72, height: 72, border: '2px dashed #d1d5db', borderRadius: 10,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 24, color: '#9ca3af', flexShrink: 0,
                      }}>+</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Link + Hashtags grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9ca3af', display: 'block', marginBottom: 6 }}>Link URL</label>
                  <input
                    value={composerLinkUrl}
                    onChange={e => setComposerLinkUrl(e.target.value)}
                    placeholder="https://…"
                    style={{
                      width: '100%', padding: '8px 11px', borderRadius: 9,
                      border: '1.5px solid #e5e7eb', fontSize: 12,
                      boxSizing: 'border-box', outline: 'none',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#C9A84C'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9ca3af' }}>Hashtags</label>
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
                      style={{ fontSize: 10, color: '#C9A84C', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                    >
                      ✨ Suggest
                    </button>
                  </div>
                  <input
                    value={composerHashtags}
                    onChange={e => setComposerHashtags(e.target.value)}
                    placeholder="#realestate #fairoak"
                    style={{
                      width: '100%', padding: '8px 11px', borderRadius: 9,
                      border: '1.5px solid #e5e7eb', fontSize: 12,
                      boxSizing: 'border-box', outline: 'none',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#C9A84C'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
                  />
                </div>
              </div>

              {/* First Comment (collapsible) */}
              <div style={{ marginBottom: 10, borderTop: '1px solid #f5f5f5', paddingTop: 12 }}>
                <button
                  onClick={() => setShowFirstComment(!showFirstComment)}
                  style={{
                    background: 'none', border: 'none', fontSize: 12, color: '#6b7280',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                    fontWeight: 600, padding: 0,
                  }}
                >
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18, borderRadius: 4, background: '#f3f4f6',
                    fontSize: 9, color: '#9ca3af', fontWeight: 700,
                  }}>
                    {showFirstComment ? '▲' : '▼'}
                  </span>
                  💬 First Comment
                  <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 400 }}>(Instagram strategy)</span>
                </button>
                {showFirstComment && (
                  <textarea
                    value={composerFirstComment}
                    onChange={e => setComposerFirstComment(e.target.value)}
                    placeholder="Add a first comment to hide hashtags on Instagram…"
                    rows={3}
                    style={{
                      width: '100%', marginTop: 10, padding: '9px 12px', borderRadius: 10,
                      border: '1.5px solid #e5e7eb', fontSize: 12, resize: 'vertical',
                      fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#C9A84C'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
                  />
                )}
              </div>

              {/* Internal Notes (collapsible) */}
              <div style={{ marginBottom: 20, borderTop: '1px solid #f5f5f5', paddingTop: 12 }}>
                <button
                  onClick={() => setShowInternalNotes(!showInternalNotes)}
                  style={{
                    background: 'none', border: 'none', fontSize: 12, color: '#6b7280',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                    fontWeight: 600, padding: 0,
                  }}
                >
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18, borderRadius: 4, background: '#f3f4f6',
                    fontSize: 9, color: '#9ca3af', fontWeight: 700,
                  }}>
                    {showInternalNotes ? '▲' : '▼'}
                  </span>
                  📝 Internal Notes
                  <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 400 }}>(not published)</span>
                </button>
                {showInternalNotes && (
                  <textarea
                    value={composerNotes}
                    onChange={e => setComposerNotes(e.target.value)}
                    placeholder="Private notes for this post…"
                    rows={2}
                    style={{
                      width: '100%', marginTop: 10, padding: '9px 12px', borderRadius: 10,
                      border: '1.5px solid #e5e7eb', fontSize: 12, resize: 'vertical',
                      fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#C9A84C'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
                  />
                )}
              </div>

              {/* Schedule / Post Now toggle */}
              <div style={{ marginBottom: 18 }}>
                <div style={{
                  display: 'inline-flex', borderRadius: 10, border: '1.5px solid #e5e7eb',
                  overflow: 'hidden', marginBottom: 12,
                }}>
                  {(['schedule', 'now'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setPostMode(m)}
                      style={{
                        padding: '8px 18px', border: 'none',
                        background: postMode === m ? '#1a1a2e' : 'transparent',
                        fontSize: 12, fontWeight: 700,
                        color: postMode === m ? '#fff' : '#9ca3af',
                        cursor: 'pointer', transition: 'all .15s',
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
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 10,
                      border: '1.5px solid #e5e7eb', fontSize: 12,
                      boxSizing: 'border-box', outline: 'none', color: '#1a1a2e',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#C9A84C'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
                  />
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => savePost('draft')}
                  disabled={composerLoading}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10,
                    border: '1.5px solid #e5e7eb', background: '#f9fafb',
                    fontSize: 13, fontWeight: 700, color: '#6b7280',
                    cursor: composerLoading ? 'not-allowed' : 'pointer',
                    transition: 'all .15s',
                  }}
                >
                  Save Draft
                </button>
                {postMode === 'schedule' ? (
                  <button
                    onClick={() => savePost('scheduled')}
                    disabled={composerLoading || !composerScheduledAt || composerPlatforms.length === 0}
                    style={{
                      flex: 2, padding: '11px 0', borderRadius: 10, border: 'none',
                      background: (composerLoading || !composerScheduledAt || composerPlatforms.length === 0)
                        ? '#d1d5db' : '#1a1a2e',
                      fontSize: 13, fontWeight: 700, color: '#fff',
                      cursor: (composerLoading || !composerScheduledAt || composerPlatforms.length === 0) ? 'not-allowed' : 'pointer',
                      boxShadow: (!composerLoading && composerScheduledAt && composerPlatforms.length > 0)
                        ? '0 4px 14px rgba(26,26,46,0.3)' : 'none',
                      transition: 'all .15s',
                    }}
                  >
                    {composerLoading ? '⏳ Saving…' : '📅 Schedule Post'}
                  </button>
                ) : (
                  <button
                    onClick={() => savePost('published')}
                    disabled={composerLoading || composerPlatforms.length === 0}
                    style={{
                      flex: 2, padding: '11px 0', borderRadius: 10, border: 'none',
                      background: (composerLoading || composerPlatforms.length === 0) ? '#d1d5db' : '#C9A84C',
                      fontSize: 13, fontWeight: 700, color: '#fff',
                      cursor: (composerLoading || composerPlatforms.length === 0) ? 'not-allowed' : 'pointer',
                      boxShadow: (!composerLoading && composerPlatforms.length > 0)
                        ? '0 4px 14px rgba(201,168,76,0.4)' : 'none',
                      transition: 'all .15s',
                    }}
                  >
                    {composerLoading ? '⏳ Posting…' : '⚡ Post Now'}
                  </button>
                )}
              </div>

            </div>
          </div>

          {/* ── RIGHT: Post Queue ── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #f0f0f0',
              overflow: 'hidden',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
            }}>

              {/* Pill tab bar */}
              <div style={{
                display: 'flex', gap: 6, padding: '16px 16px 0',
                borderBottom: '1px solid #f0f0f0', paddingBottom: 16,
              }}>
                {tabConfig.map(({ key, label, icon }) => {
                  const count = posts.filter(p => {
                    if (key === 'scheduled') return p.status === 'scheduled';
                    if (key === 'drafts') return p.status === 'draft';
                    if (key === 'published') return p.status === 'published';
                    return p.status === 'failed';
                  }).length;
                  const active = postQueueTab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setPostQueueTab(key)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px', borderRadius: 100, border: 'none',
                        background: active ? '#1a1a2e' : 'transparent',
                        fontSize: 12, fontWeight: 700,
                        color: active ? '#fff' : '#9ca3af',
                        cursor: 'pointer', transition: 'all .15s',
                      }}
                    >
                      <span>{icon}</span>
                      <span>{label}</span>
                      <span style={{
                        padding: '1px 7px', borderRadius: 100, fontSize: 10, fontWeight: 800,
                        background: active ? 'rgba(255,255,255,0.2)' : '#f3f4f6',
                        color: active ? '#fff' : '#6b7280',
                      }}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Queue content */}
              <div style={{ padding: '16px', maxHeight: 680, overflowY: 'auto' }}>
                {postsLoading ? (
                  <div style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af' }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Loading posts…</div>
                  </div>
                ) : queuePosts.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 24px' }}>
                    <div style={{ fontSize: 40, marginBottom: 14 }}>
                      {postQueueTab === 'scheduled' ? '📅' : postQueueTab === 'drafts' ? '✏️' : postQueueTab === 'published' ? '✅' : '❌'}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 8 }}>
                      No {postQueueTab} posts yet
                    </div>
                    <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.5 }}>
                      {postQueueTab === 'scheduled'
                        ? 'Use the composer to schedule your first post.'
                        : `No ${postQueueTab} posts to show.`}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {queuePosts.map(post => {
                      const badge = statusBadge(post.status);
                      const timeStr = post.scheduled_at
                        ? new Date(post.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                        : post.published_at
                        ? new Date(post.published_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                        : null;
                      const isPreviewing = previewPostId === post.id;
                      const isScheduling = schedulingPostId === post.id;
                      const thumbUrl = post.media_urls?.[0] || null;
                      const primaryPlatform: SocialPlatform | null = post.platforms?.[0] || null;

                      return (
                        <div
                          key={post.id}
                          style={{
                            borderRadius: 12,
                            border: `1px solid ${isPreviewing ? '#C9A84C50' : '#f0f0f0'}`,
                            background: '#fff',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                            overflow: 'hidden',
                            transition: 'border-color .2s, box-shadow .2s',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e0e0e0'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 3px 10px rgba(0,0,0,0.08)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = isPreviewing ? '#C9A84C50' : '#f0f0f0'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}
                        >
                          {/* Card body */}
                          <div style={{ padding: '14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                            {/* Thumbnail */}
                            {thumbUrl ? (
                              <img
                                src={thumbUrl}
                                alt=""
                                style={{
                                  width: 72, height: 72, flexShrink: 0,
                                  objectFit: 'cover', borderRadius: 10,
                                  border: '1px solid #f0f0f0',
                                }}
                              />
                            ) : (
                              <div style={{
                                width: 72, height: 72, flexShrink: 0, borderRadius: 10,
                                background: primaryPlatform ? `${platformColor(primaryPlatform)}18` : '#f3f4f6',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 26,
                                border: `1px solid ${primaryPlatform ? `${platformColor(primaryPlatform)}30` : '#e5e7eb'}`,
                              }}>
                                {primaryPlatform ? platformEmoji(primaryPlatform) : '📄'}
                              </div>
                            )}

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {/* Text preview */}
                              <p style={{
                                margin: '0 0 8px', fontSize: 13, color: '#1a1a2e',
                                lineHeight: 1.5, overflow: 'hidden',
                                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                              }}>
                                {post.content || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No caption</span>}
                              </p>

                              {/* Platform badges + status + time */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                <span style={{
                                  padding: '2px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700,
                                  background: badge.bg, color: badge.color,
                                }}>
                                  {post.status}
                                </span>
                                <span style={{ color: '#d1d5db', fontSize: 10 }}>·</span>
                                {post.platforms.map(p => (
                                  <span
                                    key={p}
                                    title={platformLabel(p)}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 3,
                                      padding: '2px 7px', borderRadius: 100, fontSize: 10, fontWeight: 700,
                                      background: `${platformColor(p)}18`,
                                      color: platformColor(p),
                                      border: `1px solid ${platformColor(p)}40`,
                                    }}
                                  >
                                    {platformEmoji(p)} {platformLabel(p)}
                                  </span>
                                ))}
                                {timeStr && (
                                  <span style={{
                                    fontSize: post.status === 'scheduled' ? 12 : 11,
                                    fontWeight: post.status === 'scheduled' ? 700 : 400,
                                    color: post.status === 'scheduled' ? '#1a1a2e' : '#9ca3af',
                                  }}>
                                    {post.status === 'scheduled' ? '📅' : '✅'} {timeStr}
                                  </span>
                                )}
                              </div>

                              {/* Engagement for published */}
                              {post.status === 'published' && (
                                <div style={{ display: 'flex', gap: 10, marginTop: 7 }}>
                                  <span style={{ fontSize: 11, color: '#6b7280' }}>👍 {post.engagement?.likes || 0}</span>
                                  <span style={{ fontSize: 11, color: '#6b7280' }}>💬 {post.engagement?.comments || 0}</span>
                                  <span style={{ fontSize: 11, color: '#6b7280' }}>🔁 {post.engagement?.shares || 0}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Card action row */}
                          <div style={{
                            padding: '10px 14px',
                            borderTop: '1px solid #f5f5f5',
                            display: 'flex', gap: 6, flexWrap: 'wrap',
                            background: '#fafafa',
                          }}>
                            <button
                              onClick={() => setPreviewPostId(isPreviewing ? null : post.id)}
                              style={{
                                padding: '5px 12px', borderRadius: 8,
                                border: `1px solid ${isPreviewing ? '#C9A84C' : '#e5e7eb'}`,
                                background: isPreviewing ? '#fffbeb' : '#fff',
                                fontSize: 11, fontWeight: 700,
                                color: isPreviewing ? '#92400e' : '#374151',
                                cursor: 'pointer',
                              }}
                            >
                              {isPreviewing ? '✕ Hide' : '👁 Preview'}
                            </button>
                            {(post.status === 'draft' || post.status === 'scheduled') && (
                              <button
                                onClick={() => {
                                  setSchedulingPostId(isScheduling ? null : post.id);
                                  if (!isScheduling) {
                                    const base = post.scheduled_at
                                      ? new Date(post.scheduled_at)
                                      : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })();
                                    setSchedulingDate(toDatetimeLocal(base.toISOString()));
                                  }
                                }}
                                style={{
                                  padding: '5px 12px', borderRadius: 8,
                                  border: `1px solid ${isScheduling ? '#1a1a2e' : '#dbeafe'}`,
                                  background: isScheduling ? '#1a1a2e' : '#eff6ff',
                                  fontSize: 11, fontWeight: 700,
                                  color: isScheduling ? '#fff' : '#1d4ed8',
                                  cursor: 'pointer',
                                }}
                              >
                                {post.status === 'scheduled' ? '🕐 Reschedule' : '📅 Schedule'}
                              </button>
                            )}
                            <button
                              onClick={() => openEditPost(post)}
                              style={{
                                padding: '5px 12px', borderRadius: 8,
                                border: '1px solid #e5e7eb', background: '#fff',
                                fontSize: 11, fontWeight: 700, color: '#374151',
                                cursor: 'pointer',
                              }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              onClick={() => deletePost(post.id)}
                              style={{
                                padding: '5px 12px', borderRadius: 8,
                                border: '1px solid #fee2e2', background: '#fff',
                                fontSize: 11, fontWeight: 700, color: '#dc2626',
                                cursor: 'pointer',
                              }}
                            >
                              🗑 Delete
                            </button>
                          </div>

                          {/* Inline scheduler */}
                          {isScheduling && (
                            <div style={{
                              padding: '12px 14px',
                              borderTop: '1px solid #dbeafe',
                              background: '#f0f7ff',
                              display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                            }}>
                              <input
                                type="datetime-local"
                                value={schedulingDate}
                                onChange={e => setSchedulingDate(e.target.value)}
                                style={{
                                  flex: 1, minWidth: 180, padding: '7px 10px', borderRadius: 8,
                                  border: '1.5px solid #93c5fd', fontSize: 12, outline: 'none',
                                }}
                                onFocus={e => { e.currentTarget.style.borderColor = '#1a1a2e'; }}
                                onBlur={e => { e.currentTarget.style.borderColor = '#93c5fd'; }}
                              />
                              <button
                                onClick={() => schedulePost(post.id, new Date(schedulingDate).toISOString())}
                                disabled={!schedulingDate}
                                style={{
                                  padding: '7px 16px', borderRadius: 8, border: 'none',
                                  background: '#1a1a2e', color: '#fff', fontSize: 12, fontWeight: 700,
                                  cursor: schedulingDate ? 'pointer' : 'not-allowed',
                                  opacity: schedulingDate ? 1 : 0.5,
                                }}
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setSchedulingPostId(null)}
                                style={{
                                  padding: '7px 12px', borderRadius: 8,
                                  border: '1px solid #bfdbfe', background: '#fff',
                                  fontSize: 12, color: '#6b7280', cursor: 'pointer',
                                }}
                              >
                                Cancel
                              </button>
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

        {/* ── Connected Accounts Bar ── */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          border: '1px solid #f0f0f0',
          padding: '14px 20px',
          marginTop: 20,
          boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: '#9ca3af', marginRight: 4, whiteSpace: 'nowrap' }}>
            Accounts
          </span>

          {connectionsLoading ? (
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Loading...</span>
          ) : (
            <>
              {ALL_PLATFORMS.map(p => {
                const conn = connections.find(c => c.platform === p);
                if (conn) {
                  return (
                    <div
                      key={p}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '6px 12px 6px 8px',
                        borderRadius: 100,
                        border: `2px solid ${platformColor(p)}`,
                        background: `${platformColor(p)}0d`,
                      }}
                    >
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: platformColor(p),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15, flexShrink: 0,
                      }}>
                        {platformEmoji(p)}
                      </div>
                      <div style={{ lineHeight: 1.2 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e' }}>{conn.account_name}</div>
                        <div style={{ fontSize: 10, color: '#9ca3af' }}>{fmtNum(conn.followers_count)} followers</div>
                      </div>
                      <button
                        onClick={async () => {
                          const warning = (p === 'facebook' || p === 'instagram')
                            ? `Disconnect ${conn.account_name}?\n\nNote: To reconnect Facebook or Instagram, you must use Chrome or Safari (not DuckDuckGo).`
                            : `Disconnect ${conn.account_name}?`;
                          if (!confirm(warning)) return;
                          await fetch('/api/crm/social/accounts', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ connection_id: conn.id }),
                          });
                          setConnections(prev => prev.filter(c => c.id !== conn.id));
                          toast(`Disconnected ${conn.account_name}`);
                        }}
                        title="Disconnect"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: '#9ca3af', fontSize: 13, lineHeight: 1,
                          padding: '0 0 0 4px', display: 'flex', alignItems: 'center',
                        }}
                      >✕</button>
                    </div>
                  );
                }
                return (
                  <button
                    key={p}
                    onClick={() => {
                      if (p === 'instagram') setShowIgModal(true);
                      else openOAuthPopup(p);
                    }}
                    title={`Connect ${platformLabel(p)}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', borderRadius: 100,
                      border: '1.5px dashed #d1d5db',
                      background: '#f9fafb', cursor: 'pointer',
                      fontSize: 12, color: '#9ca3af', fontWeight: 600,
                    }}
                  >
                    <span style={{ opacity: 0.5, fontSize: 14 }}>{platformEmoji(p)}</span>
                    <span>Connect {platformLabel(p)}</span>
                  </button>
                );
              })}
            </>
          )}

          <button
            onClick={() => openOAuthPopup('facebook')}
            style={{
              marginLeft: 'auto',
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '7px 14px', borderRadius: 100,
              border: '1.5px solid #C9A84C',
              background: 'transparent', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, color: '#C9A84C',
              whiteSpace: 'nowrap',
            }}
          >
            + Connect Account
          </button>
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

      {/* Instagram Post Preview Modal */}
      {previewPostId && (() => {
        const post = posts.find(p => p.id === previewPostId);
        if (!post) return null;
        const timeStr = post.scheduled_at
          ? new Date(post.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : post.published_at
          ? new Date(post.published_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : 'Draft';
        return (
          <div
            onClick={() => setPreviewPostId(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 540, maxHeight: '92vh', overflowY: 'auto',
                background: '#fff', borderRadius: 16,
                border: '1px solid #dbdbdb', boxShadow: '0 24px 80px rgba(0,0,0,.4)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', gap: 12, borderBottom: '1px solid #efefef' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, border: '2px solid transparent', background: 'linear-gradient(white,white) padding-box, linear-gradient(45deg,#f09433,#bc1888) border-box' }}>
                  <img src="/fair-oaks-logo.png" alt="Fair Oaks Realty Group" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#000' }}>fairoaksrealtygroup</div>
                  <div style={{ fontSize: 12, color: '#8e8e8e' }}>{timeStr}</div>
                </div>
                <button onClick={() => setPreviewPostId(null)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#8e8e8e', cursor: 'pointer', lineHeight: 1 }}>✕</button>
              </div>
              {/* Image */}
              {post.media_urls?.[0] ? (
                <div style={{ width: '100%', aspectRatio: '1 / 1', overflow: 'hidden' }}>
                  <img src={post.media_urls[0]} alt="Post image" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              ) : (
                <div style={{ width: '100%', aspectRatio: '1 / 1', background: 'linear-gradient(135deg, #1a1a2e 0%, #C9A84C 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <div style={{ fontSize: 48 }}>🏡</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>No image uploaded</div>
                </div>
              )}
              {/* Actions */}
              <div style={{ padding: '12px 16px 4px', display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  <span style={{ fontSize: 26 }}>🤍</span>
                  <span style={{ fontSize: 26 }}>💬</span>
                  <span style={{ fontSize: 26 }}>📤</span>
                </div>
                <span style={{ fontSize: 26 }}>🔖</span>
              </div>
              {/* Caption */}
              <div style={{ padding: '4px 16px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#000', marginBottom: 6 }}>243 likes</div>
                <div style={{ fontSize: 14, color: '#000', lineHeight: 1.65 }}>
                  <span style={{ fontWeight: 700 }}>fairoaksrealtygroup </span>
                  <span style={{ whiteSpace: 'pre-wrap' }}>
                    {post.content.split(' ').map((word, wi) => (
                      <span key={wi} style={{ color: word.startsWith('#') || word.startsWith('@') ? '#00376b' : 'inherit' }}>{word} </span>
                    ))}
                  </span>
                </div>
                {post.hashtags?.length > 0 && (
                  <div style={{ fontSize: 14, color: '#00376b', marginTop: 6, lineHeight: 1.65 }}>
                    {post.hashtags.join(' ')}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Video Editor Modal ── */}
      {videoEditorOpen && composerMediaUrls[videoEditorIndex] && (
        <VideoEditorModal
          url={composerMediaUrls[videoEditorIndex]}
          onSave={newUrl => {
            setComposerMediaUrls(prev => prev.map((u, i) => i === videoEditorIndex ? newUrl : u));
            setVideoEditorOpen(false);
            toast('Video updated!');
          }}
          onClose={() => setVideoEditorOpen(false)}
        />
      )}

      {/* ── Image Editor Modal ── */}
      {imgEditorOpen && (() => {
        const ASPECT_OPTIONS = [
          { key: '1:1'  as const, label: 'Square',   sub: '1:1',  pw: 360, ph: 360 },
          { key: '4:5'  as const, label: 'Portrait',  sub: '4:5',  pw: 288, ph: 360 },
          { key: '16:9' as const, label: 'Landscape', sub: '16:9', pw: 360, ph: 203 },
          { key: '9:16' as const, label: 'Story',     sub: '9:16', pw: 203, ph: 360 },
        ];
        const chosen = ASPECT_OPTIONS.find(a => a.key === imgEditorAspect) || ASPECT_OPTIONS[0];
        const url = composerMediaUrls[imgEditorIndex] || '';

        return (
          <div
            onClick={() => setImgEditorOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 18, padding: 24, width: 440, maxWidth: '95vw', boxShadow: '0 24px 80px rgba(0,0,0,.5)' }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>Edit Photo</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Drag to reposition · Scroll to zoom</div>
                </div>
                <button onClick={() => setImgEditorOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
              </div>

              {/* Aspect ratio selector */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {ASPECT_OPTIONS.map(a => (
                  <button
                    key={a.key}
                    onClick={() => { setImgEditorAspect(a.key); setImgEditorOffsetX(0); setImgEditorOffsetY(0); }}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 9, fontSize: 10, fontWeight: 700,
                      border: imgEditorAspect === a.key ? '2px solid #1a1a2e' : '1.5px solid #e5e7eb',
                      background: imgEditorAspect === a.key ? '#1a1a2e' : '#f9fafb',
                      color: imgEditorAspect === a.key ? '#fff' : '#6b7280',
                      cursor: 'pointer', lineHeight: 1.4,
                    }}
                  >
                    <div>{a.label}</div>
                    <div style={{ fontSize: 9, opacity: 0.65 }}>{a.sub}</div>
                  </button>
                ))}
              </div>

              {/* Preview / drag area */}
              <div
                style={{
                  width: chosen.pw, height: chosen.ph,
                  overflow: 'hidden', borderRadius: 10,
                  margin: '0 auto 16px',
                  position: 'relative',
                  cursor: 'grab',
                  background: '#111',
                  userSelect: 'none',
                  touchAction: 'none',
                }}
                onPointerDown={e => {
                  (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                  imgEditorDragRef.current = { startX: e.clientX, startY: e.clientY, offX: imgEditorOffsetX, offY: imgEditorOffsetY };
                }}
                onPointerMove={e => {
                  if (!imgEditorDragRef.current) return;
                  setImgEditorOffsetX(imgEditorDragRef.current.offX + (e.clientX - imgEditorDragRef.current.startX));
                  setImgEditorOffsetY(imgEditorDragRef.current.offY + (e.clientY - imgEditorDragRef.current.startY));
                }}
                onPointerUp={() => { imgEditorDragRef.current = null; }}
                onWheel={e => {
                  e.preventDefault();
                  setImgEditorScale(prev => Math.min(3, Math.max(0.3, prev - e.deltaY * 0.001)));
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  style={{
                    position: 'absolute',
                    width: `${chosen.pw * imgEditorScale}px`,
                    top: '50%', left: '50%',
                    transform: `translate(calc(-50% + ${imgEditorOffsetX}px), calc(-50% + ${imgEditorOffsetY}px))`,
                    pointerEvents: 'none',
                    maxWidth: 'none',
                    display: 'block',
                  }}
                />
              </div>

              {/* Zoom slider */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8 }}>Zoom</label>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>{Math.round(imgEditorScale * 100)}%</span>
                </div>
                <input
                  type="range" min={30} max={300} value={Math.round(imgEditorScale * 100)}
                  onChange={e => setImgEditorScale(Number(e.target.value) / 100)}
                  style={{ width: '100%', accentColor: '#1a1a2e' }}
                />
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => { setImgEditorOffsetX(0); setImgEditorOffsetY(0); setImgEditorScale(1); }}
                  style={{ flex: 1, padding: '10px', borderRadius: 9, border: '1.5px solid #e5e7eb', background: '#f9fafb', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#6b7280' }}
                >
                  Reset
                </button>
                <button
                  onClick={applyImageCrop}
                  disabled={imgEditorSaving}
                  style={{ flex: 2, padding: '10px', borderRadius: 9, border: 'none', background: '#1a1a2e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: imgEditorSaving ? 'default' : 'pointer', opacity: imgEditorSaving ? 0.7 : 1 }}
                >
                  {imgEditorSaving ? 'Saving…' : '✅ Save Changes'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Manual Instagram connect modal */}
      {showIgModal && (
        <div
          onClick={() => setShowIgModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: 32, width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 28 }}>📸</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>Connect Instagram</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Enter your Instagram username to link it to your Facebook Page</div>
              </div>
            </div>

            <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#92400e' }}>
              💡 Full Instagram OAuth requires Meta App Review. This manually links your handle using your connected Facebook Page token.
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Instagram Username</label>
            <input
              autoFocus
              value={igHandle}
              onChange={e => setIgHandle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveManualInstagram()}
              placeholder="@fairoaksrealty_group"
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 20 }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowIgModal(false)}
                style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 13, cursor: 'pointer', color: '#6b7280' }}
              >
                Cancel
              </button>
              <button
                onClick={saveManualInstagram}
                disabled={igSaving || !igHandle.trim()}
                style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: '#E1306C', color: '#fff', fontSize: 13, fontWeight: 700, cursor: igSaving || !igHandle.trim() ? 'not-allowed' : 'pointer', opacity: igSaving || !igHandle.trim() ? 0.6 : 1 }}
              >
                {igSaving ? 'Connecting…' : 'Connect Instagram'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
