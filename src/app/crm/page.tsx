'use client';

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { createClient, Session } from '@supabase/supabase-js';

// Invite flow is now handled by /crm/setup — this page is login only.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

// ── Types ─────────────────────────────────────────────────────────────────────
type Role = 'admin' | 'agent';
interface Profile { id: string; email: string; first_name: string; last_name: string; phone?: string; license?: string; role: Role; last_sign_in_at?: string; }
interface Client { id: string; agent_id: string; assigned_agent_ids: string[]; first_name: string; last_name: string; business_name: string; email: string; extra_emails: string[]; phone: string; cell_phone: string; address: string; city: string; state: string; zip: string; brokerage: string; license: string; budget: string; size_range: string; asset_types: string[]; type: 'Buyer' | 'Seller' | 'Tenant' | 'Landlord/Investor' | 'Agent' | 'Broker'; notes: string; created_at: string; last_touched_at?: string; unsubscribed_at?: string | null; unsubscribe_token?: string; }
interface Deal { id: string; client_id?: string; client: string; client_email: string; client_phone: string; type: string; property: string; value: number; agent_id: string; assigned_agent_ids: string[]; stage: string; notes: string; created_at: string; last_touch: string; emails?: DealEmail[]; }
interface DealEmail { id: string; deal_id: string; direction: 'sent' | 'received'; from_email: string; to_email: string; subject: string; body: string; email_date: string; }
interface DealDoc { id: string; deal_id: string; name: string; storage_path: string; file_size: number; file_type: string; uploaded_by: string; created_at: string; url?: string; }
interface CalendarEvent { id: string; title: string; description: string | null; location: string | null; start: string | null; end: string | null; allDay: boolean; attendees: { email: string; name: string | null; self: boolean }[]; htmlLink: string | null; status: string; }
interface CRMActivity { id: string; client_id: string; agent_id: string; type: 'call' | 'email' | 'meeting' | 'note' | 'deal_update'; note: string; created_at: string; }
interface Campaign { id: string; created_by: string; name: string; description: string; type: 'email' | 'sms'; frequency: 'monthly' | 'quarterly' | 'semi-annual' | 'annual' | 'one-time'; send_date?: string; status: 'draft' | 'active' | 'paused'; email_subject?: string; email_body?: string; sms_body?: string; created_at: string; updated_at: string; enrollment_count?: number; }
interface CampaignEnrollment { id: string; campaign_id: string; client_id: string; enrolled_at: string; next_send_at: string | null; active: boolean; client?: Client; }
interface CampaignSend { id: string; campaign_id: string; client_id: string; type: 'email' | 'sms'; status: 'sent' | 'failed' | 'skipped'; sent_at: string; subject?: string; body_preview?: string; }

const STAGES = ['Prospect', 'Active', 'In Contract', 'Closed', 'Lost'];
const DEAL_TYPES = ['Buyer Purchase', 'Tenant Lease', 'Seller Listing', 'Landlord Listing'];
const CLIENT_TYPES = ['Buyer', 'Seller', 'Tenant', 'Landlord/Investor', 'Agent', 'Broker'] as const;
const ASSET_TYPES = ['Home', 'Condo', 'Multi-Family', 'Land', 'Industrial', 'Flex/Warehouse', 'Retail', 'Office', 'Storage'] as const;
const CLIENT_TYPE_TO_DEAL: Record<string, string> = {
  'Buyer': 'Buyer Purchase',
  'Seller': 'Seller Listing',
  'Tenant': 'Tenant Lease',
  'Landlord/Investor': 'Landlord Listing',
};
const TYPE_COLORS: Record<string, string> = {
  'Buyer Purchase': 'background:#dbeafe;color:#1e4d8c',
  'Tenant Lease': 'background:#d1fae5;color:#2d5a3d',
  'Seller Listing': 'background:#fed7aa;color:#7c3d11',
  'Landlord Listing': 'background:#ede9fe;color:#4a1d6e',
};
const CLIENT_TYPE_COLORS: Record<string, string> = {
  'Buyer':    'background:#dbeafe;color:#1e4d8c',
  'Seller':   'background:#fed7aa;color:#7c3d11',
  'Tenant':            'background:#d1fae5;color:#2d5a3d',
  'Landlord/Investor': 'background:#ede9fe;color:#4a1d6e',
  'Agent':    'background:#e0f2fe;color:#075985',
  'Broker':   'background:#f1f5f9;color:#334155',
};
const STAGE_CLS: Record<string, string> = {
  'Prospect': 'bg-gray-100 text-gray-600',
  'Active': 'bg-blue-100 text-blue-700',
  'In Contract': 'bg-amber-100 text-amber-700',
  'Closed': 'bg-green-100 text-green-700',
  'Lost': 'bg-red-100 text-red-700',
};

function today() { return new Date().toISOString().slice(0, 10); }

function timeAgo(dateStr: string | undefined | null): { label: string; color: string } {
  if (!dateStr) return { label: 'Never', color: '#9ca3af' };
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return { label: 'Today', color: '#16a34a' };
  if (days === 1) return { label: 'Yesterday', color: '#16a34a' };
  if (days < 14) return { label: `${days}d ago`, color: '#16a34a' };
  if (days < 30) return { label: `${days}d ago`, color: '#d97706' };
  return { label: `${days}d ago`, color: '#dc2626' };
}

function activityIcon(type: CRMActivity['type']): string {
  return type === 'call' ? '📞' : type === 'email' ? '✉️' : type === 'meeting' ? '🤝' : type === 'note' ? '📝' : '🔄';
}

function fmtVal(deal: Deal) {
  return deal.type === 'Tenant Lease'
    ? `$${Number(deal.value).toLocaleString()}/mo`
    : `$${Number(deal.value).toLocaleString()}`;
}

// ── Kanban Board ──────────────────────────────────────────────────────────────
const STAGE_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  'Prospect':    { bg: '#f9fafb', border: '#d1d5db', dot: '#9ca3af' },
  'Active':      { bg: '#eff6ff', border: '#bfdbfe', dot: '#3b82f6' },
  'In Contract': { bg: '#fffbeb', border: '#fde68a', dot: '#f59e0b' },
  'Closed':      { bg: '#f0fdf4', border: '#bbf7d0', dot: '#22c55e' },
  'Lost':        { bg: '#fef2f2', border: '#fecaca', dot: '#ef4444' },
};

function KanbanBoard({ deals, isAdmin, agentName, draggedDealId, dragOverStage, setDraggedDealId, setDragOverStage, handleDrop, openDeal }: {
  deals: Deal[]; isAdmin: boolean; agentName: (id: string) => string;
  draggedDealId: string | null; dragOverStage: string | null;
  setDraggedDealId: (id: string | null) => void; setDragOverStage: (s: string | null) => void;
  handleDrop: (stage: string) => void; openDeal: (deal: Deal) => void;
}) {
  const STAGES = ['Prospect', 'Active', 'In Contract', 'Closed', 'Lost'];

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start', minHeight: 500 }}>
      {STAGES.map(stage => {
        const col = STAGE_COLORS[stage];
        const stageDeals = deals.filter(d => d.stage === stage);
        const totalVal = stageDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
        const isDragOver = dragOverStage === stage;

        return (
          <div
            key={stage}
            onDragOver={e => { e.preventDefault(); setDragOverStage(stage); }}
            onDragLeave={() => setDragOverStage(null)}
            onDrop={() => handleDrop(stage)}
            style={{
              minWidth: 240, width: 240, flexShrink: 0,
              background: isDragOver ? col.bg : '#f3f4f6',
              border: `2px solid ${isDragOver ? col.dot : '#e5e7eb'}`,
              borderRadius: 10,
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            {/* Column header */}
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: col.dot, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#111' }}>{stage}</span>
                <span style={{ marginLeft: 'auto', background: '#e5e7eb', borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280' }}>{stageDeals.length}</span>
              </div>
              {totalVal > 0 && (
                <div style={{ fontSize: 11, color: '#6b7280', paddingLeft: 18 }}>
                  ${totalVal.toLocaleString()} total
                </div>
              )}
            </div>

            {/* Cards */}
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80 }}>
              {stageDeals.map(deal => (
                <div
                  key={deal.id}
                  draggable
                  onDragStart={() => setDraggedDealId(deal.id)}
                  onDragEnd={() => { setDraggedDealId(null); setDragOverStage(null); }}
                  onClick={() => openDeal(deal)}
                  style={{
                    background: '#fff',
                    border: `1px solid ${draggedDealId === deal.id ? col.dot : '#e5e7eb'}`,
                    borderRadius: 8,
                    padding: '10px 12px',
                    cursor: 'grab',
                    opacity: draggedDealId === deal.id ? 0.5 : 1,
                    boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                    transition: 'opacity 0.15s, box-shadow 0.15s',
                    userSelect: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.12)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.06)')}
                >
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#111', marginBottom: 5 }}>{deal.client}</div>
                  {deal.property && (
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.property}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ ...Object.fromEntries((TYPE_COLORS[deal.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 } as React.CSSProperties}>
                      {deal.type.split(' ')[0]}
                    </span>
                    {deal.value > 0 && (
                      <span style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>{fmtVal(deal)}</span>
                    )}
                  </div>
                  {isAdmin && (
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 5 }}>👤 {agentName(deal.agent_id)}</div>
                  )}
                </div>
              ))}
              {stageDeals.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#d1d5db', fontSize: 12 }}>
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        onLogin(session);
      } else if (event === 'INITIAL_SESSION') {
        if (session) onLogin(session);
        else setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    if (data.session) onLogin(data.session);
  }

  const cardStyle = { fontFamily: "'DM Sans',sans-serif", background: '#111', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const boxStyle = { background: '#fff', borderRadius: 12, padding: '40px 36px', width: 400, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,.4)' };
  const labelStyle: React.CSSProperties = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, marginTop: 4, marginBottom: 14, boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" };

  if (loading) return (
    <div style={cardStyle}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 36, height: 36, border: '4px solid #c9922c', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ color: '#c9922c', fontFamily: 'sans-serif' }}>Loading…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );

  return (
    <div style={cardStyle}>
      <div style={boxStyle}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: '#c9922c', marginBottom: 4 }}>CRECO / Fair Oaks Realty Group</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>Agent CRM — Sign In</div>
        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <form onSubmit={handleLogin}>
          <label style={labelStyle}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@fairoaksrealtygroup.com" required style={inputStyle} />
          <label style={labelStyle}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required style={{ ...inputStyle, marginBottom: 20 }} />
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '10px', background: '#111', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main CRM ──────────────────────────────────────────────────────────────────
export default function CRMPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const VALID_PAGES = ['dashboard', 'deals', 'contacts', 'agents', 'calendar', 'invite', 'campaigns'] as const;
  type PageType = typeof VALID_PAGES[number];
  const [page, setPage] = useState<PageType>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const hash = window.location.hash.slice(1) as PageType;
    return VALID_PAGES.includes(hash) ? hash : 'dashboard';
  });
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [dealEmails, setDealEmails] = useState<DealEmail[]>([]);
  const [dealDocs, setDealDocs] = useState<DealDoc[]>([]);
  const [docUploading, setDocUploading] = useState(false);
  const [dealTab, setDealTab] = useState<'overview' | 'client' | 'emails' | 'docs'>('overview');
  const emailEditorRef = useRef<HTMLDivElement>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [tagClientId, setTagClientId] = useState<string | null>(null);
  const [showDealAgentPicker, setShowDealAgentPicker] = useState(false);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState('');
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [ec, setEc] = useState({ first_name: '', last_name: '', business_name: '', email: '', extra_emails: [] as string[], phone: '', cell_phone: '', address: '', city: '', state: '', zip: '', brokerage: '', license: '', budget: '', size_range: '', asset_types: [] as string[], type: 'Buyer' as Client['type'], notes: '' });
  const [assetDropdownOpen, setAssetDropdownOpen] = useState<'nc' | 'ec' | null>(null);
  const [saving, setSaving] = useState(false);

  // Kanban drag state
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // Gmail connection state
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');
  const [gmailAccounts, setGmailAccounts] = useState<{ id: string; email: string }[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Responsive
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);

  // Calendar state
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState<'week' | 'month' | 'all'>('month');
  const [calendarScopeError, setCalendarScopeError] = useState(false);
  const [calViewMonth, setCalViewMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [calSelectedDate, setCalSelectedDate] = useState<string | null>(new Date().toDateString());

  // Campaigns
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [campaignView, setCampaignView] = useState<'list' | 'builder' | 'detail'>('list');
  const [campaignTab, setCampaignTab] = useState<'enrolled' | 'history' | 'settings'>('enrolled');
  const [campaignEnrollments, setCampaignEnrollments] = useState<CampaignEnrollment[]>([]);
  const [campaignSends, setCampaignSends] = useState<CampaignSend[]>([]);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [newCampaign, setNewCampaign] = useState<{ name: string; description: string; type: 'email' | 'sms'; frequency: string; send_date: string; status: string; email_subject: string; email_body: string; sms_body: string }>({ name: '', description: '', type: 'email', frequency: 'monthly', send_date: '', status: 'draft', email_subject: '', email_body: '', sms_body: '' });
  const [enrollClientSearch, setEnrollClientSearch] = useState('');
  const [selectedEnrollIds, setSelectedEnrollIds] = useState<string[]>([]);

  // New deal form
  const [nd, setNd] = useState({ client_id: '', client: '', client_email: '', client_phone: '', type: 'Buyer Purchase', property: '', value: 0, notes: '' });
  // New client form
  const [nc, setNc] = useState({ first_name: '', last_name: '', business_name: '', email: '', phone: '', cell_phone: '', address: '', city: '', state: '', zip: '', brokerage: '', license: '', budget: '', size_range: '', asset_types: [] as string[], type: 'Buyer' as Client['type'], notes: '' });
  // Invite form
  const [inv, setInv] = useState({ email: '', first_name: '', last_name: '', phone: '', license: '' });
  // New email form
  const [ne, setNe] = useState({ direction: 'sent' as 'sent' | 'received', subject: '', body: '', email_date: today() });

  // Activity tracking
  const [clientActivities, setClientActivities] = useState<CRMActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [newActivity, setNewActivity] = useState<{ type: CRMActivity['type']; note: string }>({ type: 'call', note: '' });

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // Load activities whenever profile modal opens/closes
  useEffect(() => {
    if (activeClient) {
      loadClientActivities(activeClient.id);
      setNewActivity({ type: 'call', note: '' });
    } else {
      setClientActivities([]);
    }
  }, [activeClient?.id]); // eslint-disable-line

  // Sync email editor content when switching to builder view
  useLayoutEffect(() => {
    if (campaignView === 'builder' && emailEditorRef.current) {
      emailEditorRef.current.innerHTML = newCampaign.email_body || '';
    }
  }, [campaignView]); // eslint-disable-line

  // Sync URL hash → page state on browser back/forward
  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.slice(1) as PageType;
      if (VALID_PAGES.includes(hash)) setPage(hash);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []); // eslint-disable-line

  // Sync page state → URL hash on navigation
  useEffect(() => {
    if (typeof window !== 'undefined') window.location.hash = page;
  }, [page]);

  // Responsive resize listener
  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Auth init
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load profile + data once session is set
  useEffect(() => {
    if (!session) return;
    loadProfile();
    // Check Gmail connection status
    fetch(`/api/gmail/status?userId=${session.user.id}`)
      .then(r => r.json())
      .then(d => {
        if (d.connected) {
          setGmailConnected(true);
          setGmailEmail(d.email);
          setGmailAccounts(d.accounts ?? []);
        }
      });
    // Handle OAuth redirect result
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail') === 'connected') {
      setGmailConnected(true);
      window.history.replaceState({}, '', '/crm');
    }
  }, [session]); // eslint-disable-line

  const loadProfile = useCallback(async () => {
    if (!session) return;
    // Stamp last_sign_in_at from Supabase Auth into crm_profiles so Agents tab shows real data
    const authLastSignIn = session.user.last_sign_in_at ?? new Date().toISOString();
    const { data } = await supabase.from('crm_profiles').select('*').eq('id', session.user.id).single();
    if (data) {
      // Update last_sign_in_at on every authenticated page load
      await supabase.from('crm_profiles').update({ last_sign_in_at: authLastSignIn }).eq('id', session.user.id);
      const updated = { ...data, last_sign_in_at: authLastSignIn } as Profile;
      setProfile(updated);
      loadDeals(updated);
      loadClients(updated);
      loadProfiles();
    } else {
      // First login for admin — auto-create profile
      const isAdmin = session.user.email === 'info@fairoaksrealtygroup.com' ||
        session.user.user_metadata?.role === 'admin';
      const newProfile: Profile = {
        id: session.user.id,
        email: session.user.email!,
        first_name: session.user.user_metadata?.firstName ?? session.user.email!.split('@')[0],
        last_name: session.user.user_metadata?.lastName ?? '',
        role: isAdmin ? 'admin' : 'agent',
        last_sign_in_at: authLastSignIn,
      };
      await supabase.from('crm_profiles').insert([newProfile]);
      setProfile(newProfile);
      loadDeals(newProfile);
      loadClients(newProfile);
      loadProfiles();
    }
    setLoading(false);
  }, [session]);

  const loadDeals = useCallback(async (p: Profile) => {
    let q = supabase.from('crm_deals').select('*').order('last_touch', { ascending: false });
    if (p.role === 'agent') q = q.eq('agent_id', p.id);
    const { data } = await q;
    setDeals((data ?? []) as Deal[]);
  }, []);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from('crm_profiles').select('*').order('last_name');
    setProfiles((data ?? []) as Profile[]);
  }, []);

  const loadDealEmails = useCallback(async (dealId: string) => {
    const { data } = await supabase.from('crm_deal_emails').select('*').eq('deal_id', dealId).order('email_date', { ascending: false });
    setDealEmails((data ?? []) as DealEmail[]);
  }, []);

  const loadDealDocs = useCallback(async (dealId: string) => {
    const res = await fetch(`/api/crm/docs?dealId=${dealId}`);
    const json = await res.json();
    setDealDocs((json.docs ?? []) as DealDoc[]);
  }, []);

  async function uploadDoc(deal: Deal, file: File) {
    setDocUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('dealId', deal.id);
    form.append('uploadedBy', profile!.id);
    const res = await fetch('/api/crm/docs', { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok) { showToast('Upload failed: ' + json.error); }
    else { showToast(`${file.name} uploaded`); loadDealDocs(deal.id); }
    setDocUploading(false);
  }

  async function deleteDoc(doc: DealDoc, dealId: string) {
    if (!confirm(`Remove "${doc.name}"? This cannot be undone.`)) return;
    const res = await fetch('/api/crm/docs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId: doc.id }) });
    if (res.ok) { showToast(`${doc.name} removed`); loadDealDocs(dealId); }
    else showToast('Delete failed');
  }

  const loadClients = useCallback(async (p?: Profile) => {
    const prof = p ?? profile;
    if (!prof) return;
    const { data, error } = await supabase
      .from('crm_clients')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('loadClients error:', error.message); return; }
    setClients((data ?? []) as Client[]);
  }, [profile]);


  const loadCalendarEvents = useCallback(async (days = 30) => {
    if (!session || !gmailConnected) return;
    setCalendarLoading(true);
    try {
      const res = await fetch(`/api/calendar/events?userId=${session.user.id}&days=${days}`);
      const json = await res.json();
      if (json.scopeError) { setCalendarScopeError(true); setCalendarEvents([]); }
      else { setCalendarEvents(json.events ?? []); setCalendarScopeError(false); }
    } catch { setCalendarEvents([]); }
    setCalendarLoading(false);
  }, [session, gmailConnected]);

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null); setProfile(null);
  }

  // ── Client CRUD ───────────────────────────────────────────────────────────────
  async function createClient() {
    if (!nc.first_name.trim()) { showToast('First name required.'); return; }
    setSaving(true);
    const { error } = await supabase.from('crm_clients').insert([{
      ...nc, agent_id: profile!.id,
    }]);
    if (error) { showToast('Error: ' + error.message); } else {
      showToast(`${nc.first_name} ${nc.last_name} added`);
      setNc({ first_name: '', last_name: '', business_name: '', email: '', phone: '', cell_phone: '', address: '', city: '', state: '', zip: '', brokerage: '', license: '', budget: '', size_range: '', asset_types: [], type: 'Buyer', notes: '' });
      setShowAddClient(false);
      loadClients(profile!);
    }
    setSaving(false);
  }

  async function deleteClient(id: string, name: string) {
    if (!confirm(`Remove ${name}? This cannot be undone.`)) return;
    await supabase.from('crm_clients').delete().eq('id', id);
    setClients(prev => prev.filter(c => c.id !== id));
    showToast(`${name} removed.`);
  }

  function openEditClient(c: Client) {
    setEc({
      first_name: c.first_name ?? '',
      last_name: c.last_name ?? '',
      business_name: c.business_name ?? '',
      email: c.email ?? '',
      extra_emails: c.extra_emails ?? [],
      phone: c.phone ?? '',
      cell_phone: c.cell_phone ?? '',
      address: c.address ?? '',
      city: c.city ?? '',
      state: c.state ?? '',
      zip: c.zip ?? '',
      brokerage: c.brokerage ?? '',
      license: c.license ?? '',
      budget: c.budget ?? '',
      size_range: c.size_range ?? '',
      asset_types: c.asset_types ?? [],
      type: c.type,
      notes: c.notes ?? '',
    });
    setEditClient(c);
    setActiveClient(null); // close profile modal when opening edit
  }

  async function saveEditClient() {
    if (!editClient) return;
    if (!ec.first_name.trim()) { showToast('First name required.'); return; }
    setSaving(true);
    const { error } = await supabase.from('crm_clients').update({
      first_name: ec.first_name,
      last_name: ec.last_name,
      business_name: ec.business_name,
      email: ec.email,
      extra_emails: ec.extra_emails.filter(e => e.trim()),
      phone: ec.phone,
      cell_phone: ec.cell_phone,
      address: ec.address,
      city: ec.city,
      state: ec.state,
      zip: ec.zip,
      brokerage: ec.brokerage,
      license: ec.license,
      budget: ec.budget,
      size_range: ec.size_range,
      asset_types: ec.asset_types,
      type: ec.type,
      notes: ec.notes,
    }).eq('id', editClient.id);
    if (error) {
      showToast('Error: ' + error.message);
    } else {
      showToast(`${ec.first_name} ${ec.last_name} updated`);
      setClients(prev => prev.map(c => c.id === editClient.id ? { ...c, ...ec } : c));
      setEditClient(null);
    }
    setSaving(false);
  }

  // ── Activity Tracking ─────────────────────────────────────────────────────────
  async function loadClientActivities(clientId: string) {
    setActivityLoading(true);
    const { data } = await supabase
      .from('crm_client_activities')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    setClientActivities((data ?? []) as CRMActivity[]);
    setActivityLoading(false);
  }

  async function logActivity(clientId: string, type: CRMActivity['type'], note: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('crm_client_activities').insert([{
      client_id: clientId,
      agent_id: profile!.id,
      type,
      note,
    }]);
    if (error) { console.error('Activity log error:', error.message); return; }
    // Stamp last_touched_at on client
    await supabase.from('crm_clients').update({ last_touched_at: now }).eq('id', clientId);
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, last_touched_at: now } : c));
    // Refresh feed if profile modal is open
    if (activeClient?.id === clientId) {
      loadClientActivities(clientId);
      setActiveClient(prev => prev ? { ...prev, last_touched_at: now } : prev);
    }
  }

  async function toggleAgentTag(clientId: string, agentId: string) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    const current = client.assigned_agent_ids ?? [];
    const updated = current.includes(agentId)
      ? current.filter(id => id !== agentId)
      : [...current, agentId];
    const { error } = await supabase
      .from('crm_clients')
      .update({ assigned_agent_ids: updated })
      .eq('id', clientId);
    if (error) { showToast('Error: ' + error.message); return; }
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, assigned_agent_ids: updated } : c));
    const agentP = profiles.find(p => p.id === agentId);
    const agentLabel = agentP ? `${agentP.first_name} ${agentP.last_name}` : 'Agent';
    showToast(updated.includes(agentId) ? `${agentLabel} tagged on client` : `${agentLabel} removed from client`);
  }

  async function toggleDealAgentTag(dealId: string, agentId: string) {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;
    const current = deal.assigned_agent_ids ?? [];
    const updated = current.includes(agentId)
      ? current.filter(id => id !== agentId)
      : [...current, agentId];
    const { error } = await supabase.from('crm_deals').update({ assigned_agent_ids: updated }).eq('id', dealId);
    if (error) { showToast('Error: ' + error.message); return; }
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, assigned_agent_ids: updated } : d));
    if (activeDeal?.id === dealId) setActiveDeal(prev => prev ? { ...prev, assigned_agent_ids: updated } : prev);
    const agentP = profiles.find(p => p.id === agentId);
    const label = agentP ? `${agentP.first_name} ${agentP.last_name}` : 'Agent';
    showToast(updated.includes(agentId) ? `${label} added to deal` : `${label} removed from deal`);
  }

  // ── Client Export / Import ────────────────────────────────────────────────────
  async function exportClients() {
    const toExport = selectedClientIds.size > 0
      ? clients.filter(c => selectedClientIds.has(c.id))
      : clients;
    const headers = ['First Name', 'Last Name', 'Business Name', 'Type', 'Email', 'Phone', 'Cell Phone', 'Budget', 'Size Range', 'Asset Types', 'Address', 'City', 'State', 'ZIP', 'Brokerage', 'License', 'Notes', 'Date Added'];
    const rows = toExport.map(c => [
      c.first_name, c.last_name, c.business_name ?? '', c.type, c.email ?? '', c.phone ?? '', c.cell_phone ?? '', c.budget ?? '', c.size_range ?? '', (c.asset_types ?? []).join(', '), c.address ?? '', c.city ?? '', c.state ?? '', c.zip ?? '', c.brokerage ?? '', c.license ?? '', c.notes ?? '', c.created_at?.slice(0, 10) ?? '',
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const filename = `contacts-${today()}.csv`;
    const label = `${toExport.length} contact${toExport.length !== 1 ? 's' : ''}`;

    // Use native Save As dialog if browser supports it (Chrome / Edge)
    if ('showSaveFilePicker' in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'CSV Spreadsheet', accept: { 'text/csv': ['.csv'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(csv);
        await writable.close();
        showToast(`Exported ${label}`);
        return;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return; // user cancelled
        // fall through to standard download
      }
    }

    // Fallback: automatic download (Firefox / Safari)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${label}`);
  }

  async function importClients(file: File) {
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
      let added = 0, errors = 0;
      for (const row of rows) {
        const first_name = (row['first_name'] ?? row['First Name'] ?? row['firstname'] ?? '').toString().trim();
        const last_name = (row['last_name'] ?? row['Last Name'] ?? row['lastname'] ?? '').toString().trim();
        const business_name = (row['business_name'] ?? row['Business Name'] ?? row['business'] ?? '').toString().trim();
        const email = (row['email'] ?? row['Email'] ?? '').toString().trim();
        const phone = (row['phone'] ?? row['Phone'] ?? '').toString().trim();
        const cell_phone = (row['cell_phone'] ?? row['Cell Phone'] ?? row['cell'] ?? row['Cell'] ?? '').toString().trim();
        const address = (row['address'] ?? row['Address'] ?? '').toString().trim();
        const city = (row['city'] ?? row['City'] ?? '').toString().trim();
        const state = (row['state'] ?? row['State'] ?? '').toString().trim();
        const zip = (row['zip'] ?? row['ZIP'] ?? row['Zip'] ?? row['postal_code'] ?? '').toString().trim();
        const rawType = (row['type'] ?? row['Type'] ?? 'Buyer').toString().trim();
        const type: Client['type'] = (['Buyer','Seller','Tenant','Landlord/Investor','Agent','Broker'] as string[]).includes(rawType)
          ? rawType as Client['type'] : 'Buyer';
        const brokerage = (row['brokerage'] ?? row['Brokerage'] ?? '').toString().trim();
        const license = (row['license'] ?? row['License'] ?? row['License #'] ?? '').toString().trim();
        const notes = (row['notes'] ?? row['Notes'] ?? '').toString().trim();
        if (!first_name) { errors++; continue; }
        const { error } = await supabase.from('crm_clients').insert([{
          first_name, last_name, business_name, email, phone, cell_phone, address, city, state, zip, type, brokerage, license, notes, agent_id: profile!.id,
        }]);
        if (error) errors++; else added++;
      }
      await loadClients(profile!);
      showToast(`Imported ${added} client${added !== 1 ? 's' : ''}${errors > 0 ? ` · ${errors} skipped` : ''}`);
    } catch (err) {
      showToast('Import failed — check file format');
      console.error(err);
    }
    if (importFileRef.current) importFileRef.current.value = '';
  }

  // ── Deal CRUD ────────────────────────────────────────────────────────────────
  async function createDeal() {
    if (!nd.client_id) { showToast('Please select a client first.'); return; }
    setSaving(true);
    const { error } = await supabase.from('crm_deals').insert([{
      client_id: nd.client_id,
      client: nd.client,
      client_email: nd.client_email,
      client_phone: nd.client_phone,
      type: nd.type,
      property: nd.property,
      value: nd.value,
      notes: nd.notes,
      agent_id: profile!.id,
      stage: 'Prospect',
      last_touch: today(),
    }]);
    if (error) { showToast('Error: ' + error.message); } else {
      showToast('Deal created: ' + nd.client);
      setNd({ client_id: '', client: '', client_email: '', client_phone: '', type: 'Buyer Purchase', property: '', value: 0, notes: '' });
      setShowAddDeal(false);
      loadDeals(profile!);
    }
    setSaving(false);
  }

  async function updateDeal(id: string, fields: Partial<Deal>) {
    await supabase.from('crm_deals').update({ ...fields, last_touch: today() }).eq('id', id);
    setDeals(prev => prev.map(d => d.id === id ? { ...d, ...fields, last_touch: today() } : d));
    if (activeDeal?.id === id) setActiveDeal(prev => prev ? { ...prev, ...fields } : prev);
  }

  async function setStage(deal: Deal, stage: string) {
    await updateDeal(deal.id, { stage });
    showToast('Stage → ' + stage);
    if (deal.client_id) {
      logActivity(deal.client_id, 'deal_update', `Stage moved to "${stage}"${deal.property ? ` — ${deal.property}` : ''}`);
    }
  }

  async function deleteDeal(id: string) {
    if (!confirm('Delete this deal? This cannot be undone.')) return;
    await supabase.from('crm_deals').delete().eq('id', id);
    setDeals(prev => prev.filter(d => d.id !== id));
    setActiveDeal(null);
    showToast('Deal deleted.');
  }

  // ── Email log ────────────────────────────────────────────────────────────────
  async function logEmail(deal: Deal) {
    if (!ne.subject.trim()) { showToast('Subject required.'); return; }
    const ag = profile!;
    const entry = {
      deal_id: deal.id,
      direction: ne.direction,
      from_email: ne.direction === 'sent' ? ag.email : deal.client_email,
      to_email: ne.direction === 'sent' ? deal.client_email : ag.email,
      subject: ne.subject,
      body: ne.body,
      email_date: ne.email_date,
    };
    const { error } = await supabase.from('crm_deal_emails').insert([entry]);
    if (error) { showToast('Error: ' + error.message); return; }
    await updateDeal(deal.id, { last_touch: today() });
    setNe({ direction: 'sent', subject: '', body: '', email_date: today() });
    loadDealEmails(deal.id);
    showToast('Email logged.');
    if (deal.client_id) {
      logActivity(deal.client_id, 'email', `${ne.direction === 'sent' ? 'Sent' : 'Received'} email: ${ne.subject}`);
    }
  }

  // ── Invite agent ─────────────────────────────────────────────────────────────
  async function inviteAgent() {
    if (!inv.email || !inv.first_name || !inv.last_name) { showToast('Email and name required.'); return; }
    setSaving(true);
    const res = await fetch('/api/crm/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...inv, firstName: inv.first_name, lastName: inv.last_name }),
    });
    const json = await res.json();
    if (!res.ok) { showToast('Error: ' + json.error); } else {
      showToast(`Invite sent to ${inv.email}`);
      setInv({ email: '', first_name: '', last_name: '', phone: '', license: '' });
      setShowInvite(false);
      loadProfiles();
    }
    setSaving(false);
  }

  // ── Reset agent password ──────────────────────────────────────────────────────
  async function resetAgentPassword(email: string, firstName: string) {
    const res = await fetch('/api/crm/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, firstName }),
    });
    const json = await res.json();
    if (!res.ok) showToast('Error: ' + json.error);
    else showToast(`Password reset sent to ${email}`);
  }

  // ── Delete agent ──────────────────────────────────────────────────────────────
  async function updateAgentRole(userId: string, firstName: string, newRole: 'admin' | 'agent') {
    const action = newRole === 'admin' ? `Make ${firstName} an admin?` : `Remove admin access from ${firstName}?`;
    if (!confirm(action)) return;
    const { error } = await supabase.from('crm_profiles').update({ role: newRole }).eq('id', userId);
    if (error) showToast('Error: ' + error.message);
    else { showToast(`${firstName} is now ${newRole === 'admin' ? 'an Admin' : 'an Agent'}`); loadProfiles(); }
  }

  async function deleteAgent(userId: string, firstName: string, lastName: string) {
    if (!confirm(`Remove ${firstName} ${lastName} from the CRM? This cannot be undone.`)) return;
    const res = await fetch('/api/crm/delete-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const json = await res.json();
    if (!res.ok) showToast('Error: ' + json.error);
    else { showToast(`${firstName} ${lastName} removed`); loadProfiles(); }
  }

  // ── Disconnect Gmail account ──────────────────────────────────────────────────
  async function disconnectGmailAccount(connectionId: string) {
    await fetch('/api/gmail/status', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId, userId: session!.user.id }),
    });
    const updated = gmailAccounts.filter(a => a.id !== connectionId);
    setGmailAccounts(updated);
    if (updated.length === 0) { setGmailConnected(false); setGmailEmail(''); }
    else setGmailEmail(updated[0].email);
    showToast('Account disconnected');
  }

  // ── Gmail sync ───────────────────────────────────────────────────────────────
  async function syncGmail(deal: Deal) {
    if (!deal.client_email) { showToast('No client email on this deal'); return; }
    setSyncing(true);
    const res = await fetch('/api/gmail/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: session!.user.id, dealId: deal.id, clientEmail: deal.client_email }),
    });
    const json = await res.json();
    if (!res.ok) showToast('Sync error: ' + json.error);
    else { showToast(`Synced ${json.synced} new email${json.synced !== 1 ? 's' : ''} from Gmail`); loadDealEmails(deal.id); }
    setSyncing(false);
  }

  // Clear Gmail-synced emails for a deal and re-sync from scratch
  async function clearAndResync(deal: Deal) {
    if (!deal.client_email) { showToast('No client email on this deal'); return; }
    if (!confirm('This will remove all Gmail-synced emails for this deal and re-sync. Manually logged emails are kept. Continue?')) return;
    setSyncing(true);
    // Delete only Gmail-synced rows (gmail_message_id is set), keep manual logs
    await supabase
      .from('crm_deal_emails')
      .delete()
      .eq('deal_id', deal.id)
      .not('gmail_message_id', 'is', null);

    // Now re-sync with the corrected query
    const res = await fetch('/api/gmail/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: session!.user.id, dealId: deal.id, clientEmail: deal.client_email }),
    });
    const json = await res.json();
    if (!res.ok) showToast('Sync error: ' + json.error);
    else { showToast(`Re-synced ${json.synced} email${json.synced !== 1 ? 's' : ''} between you and ${deal.client_email}`); loadDealEmails(deal.id); }
    setSyncing(false);
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────────
  async function loadCampaigns() {
    setCampaignLoading(true);
    const res = await fetch('/api/campaigns');
    if (res.ok) { const j = await res.json(); setCampaigns(j.campaigns ?? []); }
    setCampaignLoading(false);
  }

  async function saveCampaign() {
    setSaving(true);
    const payload = { ...newCampaign, created_by: session!.user.id };
    const url = activeCampaign ? `/api/campaigns/${activeCampaign.id}` : '/api/campaigns';
    const method = activeCampaign ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await res.json();
    if (!res.ok) { showToast('Error: ' + j.error); }
    else {
      showToast(activeCampaign ? 'Campaign updated' : 'Campaign created');
      setCampaignView('list');
      setActiveCampaign(null);
      setNewCampaign({ name: '', description: '', type: 'email', frequency: 'monthly', send_date: '', status: 'draft', email_subject: '', email_body: '', sms_body: '' });
      loadCampaigns();
    }
    setSaving(false);
  }

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this campaign? This cannot be undone.')) return;
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    showToast('Campaign deleted');
    setActiveCampaign(null);
    setCampaignView('list');
    loadCampaigns();
  }

  async function loadCampaignEnrollments(campaignId: string) {
    const res = await fetch(`/api/campaigns/${campaignId}/enrollments`);
    if (res.ok) { const j = await res.json(); setCampaignEnrollments(j.enrollments ?? []); }
  }

  async function loadCampaignSends(campaignId: string) {
    const { data } = await supabase.from('crm_campaign_sends').select('*').eq('campaign_id', campaignId).order('sent_at', { ascending: false }).limit(100);
    setCampaignSends(data ?? []);
  }

  async function enrollClients(campaignId: string) {
    if (!selectedEnrollIds.length) { showToast('Select at least one client'); return; }
    const res = await fetch(`/api/campaigns/${campaignId}/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_ids: selectedEnrollIds, enrolled_by: session!.user.id }),
    });
    const j = await res.json();
    if (!res.ok) showToast('Error: ' + j.error);
    else { showToast(`Enrolled ${j.enrolled} client${j.enrolled !== 1 ? 's' : ''}`); setSelectedEnrollIds([]); loadCampaignEnrollments(campaignId); }
  }

  async function unenrollClient(campaignId: string, clientId: string) {
    await fetch(`/api/campaigns/${campaignId}/enrollments`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId }) });
    showToast('Client unenrolled');
    loadCampaignEnrollments(campaignId);
  }

  // ── Kanban drag & drop ────────────────────────────────────────────────────────
  async function updateDealStage(dealId: string, newStage: string) {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage, last_touch: today() } : d));
    await supabase.from('crm_deals').update({ stage: newStage, last_touch: today() }).eq('id', dealId);
  }

  function handleDrop(stage: string) {
    if (draggedDealId) {
      const deal = deals.find(d => d.id === draggedDealId);
      if (deal && deal.stage !== stage) updateDealStage(draggedDealId, stage);
    }
    setDraggedDealId(null);
    setDragOverStage(null);
  }

  // ── Open deal modal ───────────────────────────────────────────────────────────
  function openDeal(deal: Deal) {
    setActiveDeal(deal);
    setDealTab('overview');
    setShowDealAgentPicker(false);
    loadDealEmails(deal.id);
    loadDealDocs(deal.id);
  }

  // ── Filtered deals ────────────────────────────────────────────────────────────
  const filteredDeals = deals.filter(d => {
    if (filter && d.type !== filter) return false;
    if (search && !d.client.toLowerCase().includes(search.toLowerCase()) && !d.property?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function getDefaultEmailBody(): string {
    return `<p>Hi {{first_name}},</p><p>I wanted to reach out and check in with you. Whether you're actively looking or just keeping an eye on the market, I'm here to help with any questions you may have.</p><p>Feel free to reply or call me directly at {{agent_phone}}.</p><p>Best regards,<br><strong>{{agent_name}}</strong><br>{{brokerage}}</p><p><small><a href="{{unsubscribe_url}}">Unsubscribe</a> · 7510 FM 1560 N, Suite 101, Fair Oaks Ranch, TX 78015</small></p>`;
  }

  // ── Render guards ─────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#111', fontFamily: 'sans-serif', color: '#fff' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '4px solid #c9922c', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ color: '#c9922c' }}>Loading CRM…</p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if (!session) return <LoginScreen onLogin={s => { setSession(s); setLoading(true); }} />;
  if (!profile) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#111', color: '#fff', fontFamily: 'sans-serif' }}>Setting up your profile…</div>;

  const isAdmin = profile.role === 'admin';
  const isMobile = windowWidth < 768;
  const initials = (profile.first_name[0] ?? '') + (profile.last_name[0] ?? '');
  const agentName = (id: string) => { const p = profiles.find(x => x.id === id); return p ? `${p.first_name} ${p.last_name}` : profile.id === id ? `${profile.first_name} ${profile.last_name}` : '—'; };

  const mobileNavItems: { id: typeof page; icon: string; label: string }[] = [
    { id: 'dashboard', icon: '🏠', label: 'Home' },
    { id: 'deals', icon: '📋', label: 'Deals' },
    { id: 'contacts', icon: '👥', label: 'Contacts' },
    { id: 'calendar', icon: '📅', label: 'Calendar' },
    ...(isAdmin ? [{ id: 'agents' as typeof page, icon: '🤝', label: 'Team' }] : []),
    { id: 'campaigns' as typeof page, icon: '📣', label: 'Campaigns' },
  ];

  const pageLabel: Record<typeof page, string> = {
    dashboard: 'Dashboard', deals: filter || 'Deal Flow', contacts: 'Contacts',
    agents: 'Team', calendar: 'Calendar', invite: 'Invite', campaigns: 'Campaigns',
  };

  // ── UI ────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100vh', overflow: 'hidden', background: '#f2f2f2' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .crm-input{padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:'DM Sans',sans-serif;width:100%;}
        .crm-input:focus{outline:none;border-color:#c9922c;}
        .crm-btn{padding:8px 18px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all .15s;}
        .crm-btn-gold{background:#c9922c;color:#111;font-weight:600;}
        .crm-btn-ghost{background:transparent;border:1px solid #ccc;color:#6b7280;}
        .crm-btn-sm{padding:5px 12px;font-size:12px;}
        .crm-nav{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:6px;cursor:pointer;color:rgba(255,255,255,.65);font-size:13px;border:none;background:none;width:100%;font-family:'DM Sans',sans-serif;text-align:left;transition:all .15s;}
        .crm-nav:hover{background:rgba(255,255,255,.07);color:#fff;}
        .crm-nav.active{background:rgba(201,168,76,.15);color:#c9922c;}
        table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e8e8e8;}
        thead{background:#111;color:#fff;}
        th{padding:10px 14px;text-align:left;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;font-weight:500;}
        td{padding:11px 14px;font-size:13px;border-bottom:1px solid #efefef;vertical-align:middle;}
        tr:last-child td{border-bottom:none;}
        tr:hover td{background:#fafafa;}
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:36px 20px;overflow-y:auto;}
        .modal{background:#fff;border-radius:12px;width:760px;max-width:96vw;box-shadow:0 20px 60px rgba(0,0,0,.3);flex-shrink:0;}
        .pill{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:500;}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media(max-width:767px){
          .overlay{padding:0!important;align-items:flex-end!important;overflow:hidden!important;}
          .modal{width:100%!important;max-width:100%!important;border-radius:20px 20px 0 0!important;max-height:92vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;}
          .crm-btn{padding:10px 18px;font-size:14px;}
          .crm-input{padding:10px 12px;font-size:14px;}
        }
      `}</style>

      {/* Sidebar — desktop only */}
      {!isMobile && <nav style={{ width: 248, background: '#111', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
        <div style={{ padding: '22px 20px 16px', borderBottom: '1px solid rgba(201,146,44,.3)' }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 700, color: '#c9922c', lineHeight: 1.2 }}>CRECO / Fair Oaks<br />Realty Group</div>
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.4)', letterSpacing: 2, textTransform: 'uppercase', marginTop: 4 }}>Brokerage CRM</div>
        </div>
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', padding: '0 8px', marginBottom: 6 }}>Overview</div>
          <button className={`crm-nav${page === 'dashboard' ? ' active' : ''}`} onClick={() => setPage('dashboard')}>🏠 &nbsp;Dashboard</button>
        </div>
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', padding: '0 8px', marginBottom: 6 }}>Deal Flow</div>
          <button className={`crm-nav${page === 'deals' && !filter ? ' active' : ''}`} onClick={() => { setPage('deals'); setFilter(''); }}>📋 &nbsp;All Deals <span style={{ marginLeft: 'auto', background: '#c9922c', color: '#111', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>{deals.length}</span></button>
          {DEAL_TYPES.map(t => (
            <button key={t} className={`crm-nav${page === 'deals' && filter === t ? ' active' : ''}`} onClick={() => { setPage('deals'); setFilter(t); }}>
              {t === 'Buyer Purchase' ? '🏡' : t === 'Tenant Lease' ? '🔑' : t === 'Seller Listing' ? '🪧' : '🏢'} &nbsp;{t.split(' ')[0]}s
            </button>
          ))}
        </div>
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', padding: '0 8px', marginBottom: 6 }}>People</div>
          <button className={`crm-nav${page === 'contacts' ? ' active' : ''}`} onClick={() => { setPage('contacts'); loadClients(); }}>👥 &nbsp;Contacts <span style={{ marginLeft: 'auto', background: clients.length > 0 ? '#c9922c' : 'rgba(255,255,255,.12)', color: clients.length > 0 ? '#111' : 'rgba(255,255,255,.4)', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>{clients.length}</span></button>
          {isAdmin && <button className={`crm-nav${page === 'agents' ? ' active' : ''}`} onClick={() => { setPage('agents'); loadProfiles(); }}>🤝 &nbsp;Broker / Agents</button>}
        </div>
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', padding: '0 8px', marginBottom: 6 }}>Tools</div>
          <button className={`crm-nav${page === 'calendar' ? ' active' : ''}`} onClick={() => { setPage('calendar'); loadCalendarEvents(calendarFilter === 'week' ? 7 : calendarFilter === 'month' ? 30 : 90); }}>📅 &nbsp;Calendar</button>
          <button className={`crm-nav${page === 'campaigns' ? ' active' : ''}`} onClick={() => { setPage('campaigns'); setCampaignView('list'); loadCampaigns(); }}>📣 &nbsp;Campaigns</button>
        </div>
        <div style={{ marginTop: 'auto', padding: '14px 12px', borderTop: '1px solid rgba(255,255,255,.07)' }}>
          {/* Gmail / Calendar accounts */}
          <div style={{ marginBottom: 10 }}>
            {gmailAccounts.map(acct => (
              <div key={acct.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)', borderRadius: 7, marginBottom: 5 }}>
                <span style={{ fontSize: 12 }}>✉️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: '#4ade80', fontWeight: 600, letterSpacing: .5 }}>Connected</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acct.email}</div>
                </div>
                <button onClick={() => disconnectGmailAccount(acct.id)} title="Disconnect" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.25)', cursor: 'pointer', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <a href={`/api/gmail/auth?userId=${session!.user.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.15)', borderRadius: 7, textDecoration: 'none', cursor: 'pointer' }}>
              <span style={{ fontSize: 12 }}>＋</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', fontWeight: 500 }}>{gmailAccounts.length === 0 ? 'Connect Google Account' : 'Add Another Account'}</span>
            </a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: 'rgba(255,255,255,.05)', borderRadius: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#111', flexShrink: 0 }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.first_name} {profile.last_name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>{isAdmin ? 'Broker · Admin' : 'Agent'}</div>
            </div>
            <button onClick={signOut} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', cursor: 'pointer', fontSize: 16 }} title="Sign out">⏻</button>
          </div>
        </div>
      </nav>}

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Mobile top header */}
        {isMobile && (
          <div style={{ background: '#111', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: '1px solid rgba(201,146,44,.2)' }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 15, fontWeight: 700, color: '#c9922c' }}>CRECO</div>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,.15)' }} />
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 600, color: '#fff', flex: 1 }}>{pageLabel[page]}</div>
            {page === 'contacts' && <button className="crm-btn crm-btn-gold crm-btn-sm" onClick={() => setShowAddClient(true)} style={{ flexShrink: 0, padding: '6px 14px', fontSize: 13 }}>+ Add</button>}
            {page === 'deals' && <button className="crm-btn crm-btn-gold crm-btn-sm" onClick={() => setShowAddDeal(true)} style={{ flexShrink: 0, padding: '6px 14px', fontSize: 13 }}>+ Deal</button>}
            <button onClick={signOut} style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 20, color: 'rgba(255,255,255,.7)', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '5px 12px', flexShrink: 0, fontFamily: "'DM Sans',sans-serif", letterSpacing: .3 }}>Sign Out</button>
          </div>
        )}

        {/* Desktop topbar */}
        {!isMobile && <div style={{ background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '13px 26px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, flex: 1 }}>
            {pageLabel[page]}
          </h2>
          {page === 'deals' && <button className="crm-btn crm-btn-gold" onClick={() => setShowAddDeal(true)}>+ New Deal</button>}
          {page === 'contacts' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {selectedClientIds.size > 0 && (
                <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20, padding: '3px 10px', fontWeight: 500 }}>
                  {selectedClientIds.size} selected
                </span>
              )}
              <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={exportClients} title={selectedClientIds.size > 0 ? `Export ${selectedClientIds.size} selected` : 'Export all clients to CSV'} style={{ fontSize: 12 }}>
                ⬇ Export{selectedClientIds.size > 0 ? ` (${selectedClientIds.size})` : ' All'}
              </button>
              <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => importFileRef.current?.click()} title="Import from XLSX or CSV" style={{ fontSize: 12 }}>⬆ Import</button>
              <button className="crm-btn crm-btn-gold" onClick={() => setShowAddClient(true)}>+ Add Client</button>
            </div>
          )}
          {page === 'agents' && isAdmin && <button className="crm-btn crm-btn-gold" onClick={() => setShowInvite(true)}>+ Invite Agent</button>}
        </div>}

        {/* Content */}
        <div style={{ flex: 1, overflowY: page === 'calendar' ? 'hidden' : 'auto', padding: page === 'calendar' || page === 'campaigns' ? 0 : isMobile ? 14 : 26 }} onClick={() => { setTagClientId(null); setAssetDropdownOpen(null); }}>

          {/* ── Dashboard ── */}
          {page === 'dashboard' && (
            <div>
              {/* Deal stat cards */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: isMobile ? 10 : 14, marginBottom: 14 }}>
                {[
                  { label: 'Active Deals', val: deals.filter(d => d.stage === 'Active').length, sub: 'in pipeline' },
                  { label: 'In Contract', val: deals.filter(d => d.stage === 'In Contract').length, sub: 'pending close' },
                  { label: 'Closed YTD', val: deals.filter(d => d.stage === 'Closed').length, sub: 'this year' },
                  { label: isAdmin ? 'Agents' : 'My Deals', val: isAdmin ? profiles.filter(p => p.role === 'agent').length : deals.length, sub: isAdmin ? 'active agents' : 'total' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: '18px 20px', border: '1px solid #e0e0e0', borderLeft: '4px solid #c9922c' }}>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, fontWeight: 700, color: '#111', lineHeight: 1 }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Contact type breakdown */}
              {clients.length > 0 && (() => {
                const typeBreakdown = CLIENT_TYPES.map(t => ({ type: t, count: clients.filter(c => c.type === t).length })).filter(x => x.count > 0);
                const total = clients.length;
                return (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: '16px 20px', marginBottom: 26 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600 }}>Contacts by Type</div>
                      <button onClick={() => setPage('contacts')} style={{ background: 'none', border: 'none', fontSize: 11, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>View all {total} →</button>
                    </div>
                    {/* Bar */}
                    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 14, gap: 1 }}>
                      {typeBreakdown.map(({ type, count }) => {
                        const colors: Record<string, string> = { 'Buyer': '#3b82f6', 'Seller': '#f97316', 'Tenant': '#22c55e', 'Landlord/Investor': '#a855f7', 'Agent': '#0ea5e9', 'Broker': '#64748b' };
                        return <div key={type} style={{ flex: count, background: colors[type] ?? '#c9922c', minWidth: 4 }} title={`${type}: ${count}`} />;
                      })}
                    </div>
                    {/* Legend */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
                      {typeBreakdown.map(({ type, count }) => {
                        const colors: Record<string, string> = { 'Buyer': '#3b82f6', 'Seller': '#f97316', 'Tenant': '#22c55e', 'Landlord/Investor': '#a855f7', 'Agent': '#0ea5e9', 'Broker': '#64748b' };
                        const emoji = type === 'Buyer' ? '🏡' : type === 'Seller' ? '🪧' : type === 'Tenant' ? '🔑' : type === 'Landlord/Investor' ? '🏢' : type === 'Agent' ? '🤝' : '🏛';
                        return (
                          <button key={type} onClick={() => setPage('contacts')}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'DM Sans',sans-serif" }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: colors[type] ?? '#c9922c', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: '#374151' }}>{emoji} {type}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>{count}</span>
                            <span style={{ fontSize: 11, color: '#9ca3af' }}>({Math.round(count / total * 100)}%)</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Needs Attention widget */}
              {(() => {
                const needsAttention = clients
                  .filter(c => {
                    if (!c.last_touched_at) return true;
                    const days = Math.floor((Date.now() - new Date(c.last_touched_at).getTime()) / (1000 * 60 * 60 * 24));
                    return days >= 30;
                  })
                  .sort((a, b) => {
                    if (!a.last_touched_at) return -1;
                    if (!b.last_touched_at) return 1;
                    return new Date(a.last_touched_at).getTime() - new Date(b.last_touched_at).getTime();
                  })
                  .slice(0, 5);
                if (needsAttention.length === 0) return null;
                return (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #fee2e2', padding: '16px 20px', marginBottom: 26 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#dc2626', fontWeight: 600 }}>⚠️ Needs Attention</div>
                      <button onClick={() => setPage('contacts')} style={{ background: 'none', border: 'none', fontSize: 11, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>View all contacts →</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                      {needsAttention.map(c => {
                        const ta = timeAgo(c.last_touched_at);
                        return (
                          <button key={c.id}
                            onClick={() => { setPage('contacts'); setActiveClient(c); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                            <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                              {(c.first_name[0] ?? '') + (c.last_name[0] ?? '')}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.first_name} {c.last_name}</div>
                              <div style={{ fontSize: 10, color: '#6b7280' }}>{c.type}</div>
                            </div>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: ta.color + '18', color: ta.color, fontWeight: 700, flexShrink: 0 }}>{ta.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <KanbanBoard deals={deals} isAdmin={isAdmin} agentName={agentName} draggedDealId={draggedDealId} dragOverStage={dragOverStage} setDraggedDealId={setDraggedDealId} setDragOverStage={setDragOverStage} handleDrop={handleDrop} openDeal={openDeal} />
            </div>
          )}

          {/* ── Deals ── */}
          {page === 'deals' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                {['', ...DEAL_TYPES].map(t => (
                  <button key={t} onClick={() => setFilter(t)}
                    style={{ padding: '5px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid', background: filter === t ? '#111' : '#fff', color: filter === t ? '#fff' : '#6b7280', borderColor: filter === t ? '#111' : '#ddd', fontFamily: "'DM Sans',sans-serif" }}>
                    {t || 'All'}
                  </button>
                ))}
                <input className="crm-input" placeholder="🔍  Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginLeft: 'auto', width: 200 }} />
              </div>
              <KanbanBoard deals={filteredDeals} isAdmin={isAdmin} agentName={agentName} draggedDealId={draggedDealId} dragOverStage={dragOverStage} setDraggedDealId={setDraggedDealId} setDragOverStage={setDragOverStage} handleDrop={handleDrop} openDeal={openDeal} />
            </div>
          )}

          {/* ── Clients ── */}
          {page === 'contacts' && (
            <div>
              {clients.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0' }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600, color: '#111', marginBottom: 8 }}>No clients yet</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Add buyers, sellers, tenants, landlords, and outside brokers/agents — all in one place.</div>
                  <button className="crm-btn crm-btn-gold" onClick={() => setShowAddClient(true)}>+ Add First Client</button>
                </div>
              ) : isMobile ? (
              /* ── Mobile Contact Cards ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {clients.map(c => {
                  const ta = timeAgo(c.last_touched_at);
                  const clientDeals = deals.filter(d => d.client_id === c.id);
                  const activeDeals = clientDeals.filter(d => ['Active', 'In Contract'].includes(d.stage));
                  return (
                    <div key={c.id} onClick={() => setActiveClient(c)}
                      style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                        <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                          {(c.first_name[0] ?? '') + (c.last_name[0] ?? '')}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 2 }}>{c.first_name} {c.last_name}</div>
                          {c.business_name && <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>{c.business_name}</div>}
                          <span style={{ ...Object.fromEntries((CLIENT_TYPE_COLORS[c.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '1px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 } as React.CSSProperties}>{c.type}</span>
                        </div>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: ta.color + '18', color: ta.color, fontWeight: 700, flexShrink: 0, alignSelf: 'flex-start' }}>{ta.label}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {c.email && (
                          <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()}
                            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#c9922c', textDecoration: 'none', padding: '5px 0' }}>
                            <span>✉️</span> {c.email}
                          </a>
                        )}
                        {(c.phone || c.cell_phone) && (
                          <a href={`tel:${c.cell_phone || c.phone}`} onClick={e => e.stopPropagation()}
                            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151', textDecoration: 'none', padding: '5px 0' }}>
                            <span>📞</span> {c.cell_phone || c.phone}
                          </a>
                        )}
                      </div>
                      {(activeDeals.length > 0 || c.budget || (c.asset_types ?? []).length > 0) && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {activeDeals.length > 0 && (
                            <span style={{ fontSize: 11, background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                              {activeDeals.length} active deal{activeDeals.length > 1 ? 's' : ''}
                            </span>
                          )}
                          {c.budget && <span style={{ fontSize: 11, background: '#f0fdf4', color: '#166534', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>💰 {c.budget}</span>}
                          {(c.asset_types ?? []).slice(0, 2).map(at => (
                            <span key={at} style={{ fontSize: 11, background: '#fef3e2', color: '#92400e', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{at}</span>
                          ))}
                          {(c.asset_types ?? []).length > 2 && <span style={{ fontSize: 11, color: '#9ca3af' }}>+{(c.asset_types ?? []).length - 2} more</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 36, paddingRight: 0 }}>
                          <input
                            type="checkbox"
                            title={selectedClientIds.size === clients.length ? 'Deselect all' : 'Select all'}
                            checked={clients.length > 0 && selectedClientIds.size === clients.length}
                            ref={el => { if (el) el.indeterminate = selectedClientIds.size > 0 && selectedClientIds.size < clients.length; }}
                            onChange={e => {
                              if (e.target.checked) setSelectedClientIds(new Set(clients.map(c => c.id)));
                              else setSelectedClientIds(new Set());
                            }}
                            style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#c9922c' }}
                          />
                        </th>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Business / Brokerage</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Cell</th>
                        <th>Address</th>
                        <th>Active Deals</th>
                        <th>Tagged Agents</th>
                        {isAdmin && <th>Owner</th>}
                        <th>Added</th>
                        <th>Last Contact</th>
                        {isAdmin && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map(c => {
                        const clientDeals = deals.filter(d => d.client_id === c.id);
                        const activeDeals = clientDeals.filter(d => ['Active', 'In Contract'].includes(d.stage));
                        const taggedAgents = (c.assigned_agent_ids ?? []).map(aid => profiles.find(p => p.id === aid)).filter(Boolean) as Profile[];
                        const canTag = isAdmin || c.agent_id === profile!.id;
                        const isTagPickerOpen = tagClientId === c.id;
                        // Agents available to tag (exclude creator and already tagged)
                        const taggableAgents = profiles.filter(p => p.id !== c.agent_id && p.id !== profile!.id || isAdmin);

                        return (
                          <tr key={c.id} style={{ background: selectedClientIds.has(c.id) ? '#fef9f0' : undefined }}>
                            {/* Checkbox */}
                            <td style={{ paddingRight: 0, width: 36 }} onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedClientIds.has(c.id)}
                                onChange={e => {
                                  const next = new Set(selectedClientIds);
                                  e.target.checked ? next.add(c.id) : next.delete(c.id);
                                  setSelectedClientIds(next);
                                }}
                                style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#c9922c' }}
                              />
                            </td>
                            {/* Name — clickable to open profile */}
                            <td>
                              <button
                                onClick={e => { e.stopPropagation(); setActiveClient(c); }}
                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                                <div style={{ fontWeight: 600, color: '#c9922c', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                                  {c.first_name} {c.last_name}
                                </div>
                                {c.business_name && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{c.business_name}</div>}
                              </button>
                            </td>

                            {/* Type badge */}
                            <td>
                              <span style={{ ...Object.fromEntries((CLIENT_TYPE_COLORS[c.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 } as React.CSSProperties}>
                                {c.type}
                              </span>
                            </td>

                            {/* Business / Brokerage */}
                            <td style={{ fontSize: 12, color: '#374151' }}>
                              {c.business_name || c.brokerage
                                ? <div><div style={{ fontWeight: 500 }}>{c.business_name || ''}</div>{c.brokerage && <div style={{ color: '#9ca3af', fontSize: 11 }}>{c.brokerage}</div>}</div>
                                : <span style={{ color: '#d1d5db' }}>—</span>}
                            </td>

                            {/* Email */}
                            <td style={{ fontSize: 12 }}>
                              {c.email ? <a href={`mailto:${c.email}`} style={{ color: '#c9922c', textDecoration: 'none' }}>{c.email}</a> : '—'}
                            </td>

                            {/* Phone */}
                            <td style={{ fontSize: 12 }}>
                              {c.phone ? <a href={`tel:${c.phone}`} style={{ color: '#374151', textDecoration: 'none' }}>{c.phone}</a> : '—'}
                            </td>

                            {/* Cell */}
                            <td style={{ fontSize: 12 }}>
                              {c.cell_phone ? <a href={`tel:${c.cell_phone}`} style={{ color: '#374151', textDecoration: 'none' }}>{c.cell_phone}</a> : <span style={{ color: '#d1d5db' }}>—</span>}
                            </td>

                            {/* Address */}
                            <td style={{ fontSize: 11, color: '#6b7280', minWidth: 140 }}>
                              {c.address ? (
                                <div>
                                  <div>{c.address}</div>
                                  {(c.city || c.state || c.zip) && (
                                    <div style={{ color: '#9ca3af' }}>{[c.city, c.state, c.zip].filter(Boolean).join(', ')}</div>
                                  )}
                                </div>
                              ) : <span style={{ color: '#d1d5db' }}>—</span>}
                            </td>

                            {/* Active deals */}
                            <td style={{ fontSize: 12 }}>
                              {activeDeals.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  {activeDeals.map(d => (
                                    <button key={d.id} onClick={() => openDeal(d)}
                                      style={{ background: 'none', border: 'none', color: '#c9922c', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline' }}>
                                      {d.property || d.type.split(' ')[0]}
                                    </button>
                                  ))}
                                </div>
                              ) : clientDeals.length > 0 ? (
                                <span style={{ color: '#9ca3af' }}>{clientDeals.length} deal{clientDeals.length !== 1 ? 's' : ''}</span>
                              ) : (
                                <button onClick={() => { setNd({ client_id: c.id, client: `${c.first_name} ${c.last_name}`, client_email: c.email, client_phone: c.phone, type: CLIENT_TYPE_TO_DEAL[c.type] || 'Buyer Purchase', property: '', value: 0, notes: '' }); setShowAddDeal(true); }}
                                  style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 4, color: '#6b7280', fontSize: 11, cursor: 'pointer', padding: '2px 8px' }}>
                                  + New Deal
                                </button>
                              )}
                            </td>

                            {/* Tagged agents column */}
                            <td style={{ position: 'relative' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                                {taggedAgents.map(a => (
                                  <span key={a.id} title={`${a.first_name} ${a.last_name}`}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20, padding: '2px 8px 2px 6px', fontSize: 11, color: '#374151' }}>
                                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                                      {(a.first_name[0] ?? '') + (a.last_name[0] ?? '')}
                                    </span>
                                    {a.first_name}
                                    {canTag && (
                                      <button onClick={e => { e.stopPropagation(); toggleAgentTag(c.id, a.id); }}
                                        style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }} title="Remove">✕</button>
                                    )}
                                  </span>
                                ))}

                                {/* Tag button — only for creator or admin */}
                                {canTag && (
                                  <button
                                    onClick={e => { e.stopPropagation(); setTagClientId(isTagPickerOpen ? null : c.id); }}
                                    style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 20, padding: '2px 8px', fontSize: 11, color: '#6b7280', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                    {taggedAgents.length === 0 ? '＋ Tag Agent' : '＋'}
                                  </button>
                                )}

                                {/* Agent picker dropdown */}
                                {isTagPickerOpen && (
                                  <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 220, padding: '6px 0' }}
                                    onClick={e => e.stopPropagation()}>
                                    <div style={{ padding: '6px 12px 4px', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500 }}>Tag an Agent</div>
                                    {taggableAgents.length === 0 ? (
                                      <div style={{ padding: '8px 12px', fontSize: 12, color: '#9ca3af' }}>No other agents available</div>
                                    ) : taggableAgents.map(a => {
                                      const isTagged = (c.assigned_agent_ids ?? []).includes(a.id);
                                      return (
                                        <button key={a.id} onClick={e => { e.stopPropagation(); toggleAgentTag(c.id, a.id); }}
                                          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: isTagged ? '#f0fdf4' : 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#111', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                                          <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                                            {(a.first_name[0] ?? '') + (a.last_name[0] ?? '')}
                                          </span>
                                          <span style={{ flex: 1 }}>{a.first_name} {a.last_name}<br /><span style={{ fontSize: 11, color: '#9ca3af' }}>{a.role}</span></span>
                                          {isTagged && <span style={{ fontSize: 12, color: '#16a34a' }}>✓</span>}
                                        </button>
                                      );
                                    })}
                                    <div style={{ borderTop: '1px solid #f0f0f0', padding: '6px 12px 2px' }}>
                                      <button onClick={e => { e.stopPropagation(); setTagClientId(null); }} style={{ background: 'none', border: 'none', fontSize: 11, color: '#9ca3af', cursor: 'pointer', padding: 0 }}>Close</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Owner agent (admin only) */}
                            {isAdmin && <td style={{ fontSize: 12, color: '#6b7280' }}>{agentName(c.agent_id)}</td>}

                            {/* Date added */}
                            <td style={{ fontSize: 11, color: '#9ca3af' }}>{c.created_at?.slice(0, 10)}</td>

                            {/* Last Contact */}
                            <td>
                              {(() => {
                                const ta = timeAgo(c.last_touched_at);
                                return (
                                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: ta.color + '18', color: ta.color, whiteSpace: 'nowrap' }}>
                                    {ta.label}
                                  </span>
                                );
                              })()}
                            </td>

                            {/* Edit / Delete actions */}
                            {isAdmin && (
                              <td>
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                  <button onClick={() => openEditClient(c)}
                                    style={{ background: 'none', border: 'none', color: '#c9922c', fontSize: 13, cursor: 'pointer', padding: '2px 4px' }} title="Edit contact">
                                    ✏️
                                  </button>
                                  <button onClick={() => deleteClient(c.id, `${c.first_name} ${c.last_name}`)}
                                    style={{ background: 'none', border: 'none', color: '#fca5a5', fontSize: 13, cursor: 'pointer', padding: '2px 4px' }} title="Remove client (admin only)">
                                    🗑
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Calendar ── */}
          {page === 'calendar' && (
            <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
              {!gmailConnected ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 40 }}>
                  <div style={{ fontSize: 56 }}>📅</div>
                  <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, color: '#111' }}>Connect Google to See Your Calendar</h3>
                  <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 380, textAlign: 'center' }}>Link your Google account to sync your calendar events and Gmail directly in the CRM.</p>
                  <a href={`/api/gmail/auth?userId=${session!.user.id}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', background: '#111', color: '#fff', borderRadius: 7, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
                    📧 Connect Google Account
                  </a>
                </div>
              ) : calendarScopeError ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 40 }}>
                  <div style={{ fontSize: 56 }}>🔑</div>
                  <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, color: '#111' }}>Calendar Permission Needed</h3>
                  <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 400, textAlign: 'center' }}>Your Google account is connected but calendar access wasn't granted. Reconnect to enable it.</p>
                  <a href={`/api/gmail/auth?userId=${session!.user.id}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', background: '#c9922c', color: '#111', borderRadius: 7, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
                    🔄 Reconnect Google Account
                  </a>
                </div>
              ) : (() => {
                // Build month grid
                const year = calViewMonth.getFullYear();
                const month = calViewMonth.getMonth();
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const today = new Date();
                const monthName = calViewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

                // Map events to date keys
                const eventsByDate: Record<string, CalendarEvent[]> = {};
                calendarEvents.forEach(ev => {
                  if (!ev.start) return;
                  const key = new Date(ev.start).toDateString();
                  if (!eventsByDate[key]) eventsByDate[key] = [];
                  eventsByDate[key].push(ev);
                });

                const selectedEvents = calSelectedDate ? (eventsByDate[calSelectedDate] ?? []) : [];
                const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

                return (
                  <>
                    {/* Left: Month Grid */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', overflow: 'hidden' }}>
                      {/* Month header */}
                      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #e5e7eb', background: '#fff', gap: 12 }}>
                        <button onClick={() => setCalViewMonth(new Date(year, month - 1, 1))}
                          style={{ width: 32, height: 32, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                        <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: '#111', flex: 1, textAlign: 'center' }}>{monthName}</span>
                        <button onClick={() => setCalViewMonth(new Date(year, month + 1, 1))}
                          style={{ width: 32, height: 32, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                        <button onClick={() => { setCalViewMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setCalSelectedDate(today.toDateString()); }}
                          style={{ padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 11, color: '#374151', fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>Today</button>
                        <button onClick={() => loadCalendarEvents(90)}
                          style={{ padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 11, color: '#374151', fontFamily: "'DM Sans',sans-serif" }}>↻ Refresh</button>
                      </div>

                      {/* Day headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                        {DAYS.map(d => (
                          <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af' }}>{d}</div>
                        ))}
                      </div>

                      {/* Calendar grid */}
                      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridAutoRows: '1fr', overflow: 'hidden' }}>
                        {/* Empty cells before first day */}
                        {Array.from({ length: firstDay }).map((_, i) => (
                          <div key={`empty-${i}`} style={{ borderRight: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }} />
                        ))}
                        {/* Day cells */}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                          const dayNum = i + 1;
                          const cellDate = new Date(year, month, dayNum);
                          const dateKey = cellDate.toDateString();
                          const isToday = dateKey === today.toDateString();
                          const isSelected = dateKey === calSelectedDate;
                          const dayEvents = eventsByDate[dateKey] ?? [];

                          return (
                            <div key={dayNum} onClick={() => setCalSelectedDate(dateKey)}
                              style={{ borderRight: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0', padding: '6px 8px', cursor: 'pointer', background: isSelected ? '#fef9f0' : '#fff', transition: 'background 0.1s', overflow: 'hidden' }}
                              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#fafafa'; }}
                              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff'; }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontSize: 12, fontWeight: isToday ? 700 : 400, background: isToday ? '#c9922c' : 'transparent', color: isToday ? '#fff' : isSelected ? '#c9922c' : '#374151' }}>
                                  {dayNum}
                                </span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {dayEvents.slice(0, 3).map(ev => (
                                  <div key={ev.id} style={{ fontSize: 10, background: '#1a365d', color: '#fff', borderRadius: 3, padding: '1px 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {ev.allDay ? '● ' : `${new Date(ev.start!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} `}{ev.title}
                                  </div>
                                ))}
                                {dayEvents.length > 3 && (
                                  <div style={{ fontSize: 9, color: '#9ca3af', paddingLeft: 4 }}>+{dayEvents.length - 3} more</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {calendarLoading && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 32, height: 32, border: '3px solid #c9922c', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        </div>
                      )}
                    </div>

                    {/* Right: Event Detail Panel */}
                    <div style={{ width: 320, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
                      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
                        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 700, color: '#111' }}>
                          {calSelectedDate ? (() => {
                            const d = new Date(calSelectedDate);
                            const isToday = d.toDateString() === today.toDateString();
                            return isToday ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                          })() : 'Select a day'}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                          {selectedEvents.length === 0 ? 'No events' : `${selectedEvents.length} event${selectedEvents.length !== 1 ? 's' : ''}`}
                        </div>
                      </div>
                      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {selectedEvents.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '40px 0', color: '#d1d5db' }}>
                            <div style={{ fontSize: 32, marginBottom: 8 }}>🗓️</div>
                            <div style={{ fontSize: 12 }}>No events this day</div>
                          </div>
                        ) : selectedEvents.map(ev => {
                          const startTime = ev.allDay ? 'All day' : ev.start ? new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                          const endTime = ev.allDay ? '' : ev.end ? new Date(ev.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                          const matchedDeal = deals.find(d => d.client_email && ev.attendees.some(a => a.email.toLowerCase() === d.client_email?.toLowerCase()));
                          return (
                            <div key={ev.id} style={{ background: '#f9fafb', borderRadius: 10, padding: '13px 14px', border: '1px solid #e5e7eb', borderLeft: '4px solid #1a365d' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#111', lineHeight: 1.3 }}>{ev.title}</div>
                                {ev.htmlLink && (
                                  <a href={ev.htmlLink} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#c9922c', textDecoration: 'none', flexShrink: 0 }}>Open ↗</a>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>🕐 {startTime}{endTime ? ` – ${endTime}` : ''}</div>
                              {ev.location && <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>📍 {ev.location}</div>}
                              {ev.description && <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5, marginBottom: 6 }}>{ev.description.slice(0, 140)}{ev.description.length > 140 ? '…' : ''}</div>}
                              {matchedDeal && (
                                <div style={{ marginTop: 6 }}>
                                  <span onClick={() => openDeal(matchedDeal)} style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '3px 9px', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }}>
                                    🏡 {matchedDeal.client}
                                  </span>
                                </div>
                              )}
                              {ev.attendees.filter(a => !a.self).length > 0 && (
                                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {ev.attendees.filter(a => !a.self).slice(0, 4).map(a => (
                                    <span key={a.email} style={{ fontSize: 9, background: '#e0f2fe', color: '#0369a1', padding: '2px 7px', borderRadius: 8 }}>{a.name ?? a.email}</span>
                                  ))}
                                  {ev.attendees.filter(a => !a.self).length > 4 && <span style={{ fontSize: 9, color: '#9ca3af' }}>+{ev.attendees.filter(a => !a.self).length - 4}</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* ── Agents (admin only) ── */}
          {page === 'agents' && isAdmin && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
              {profiles.map(a => {
                const agDeals = deals.filter(d => d.agent_id === a.id);
                const active = agDeals.filter(d => ['Active', 'In Contract'].includes(d.stage)).length;
                const closed = agDeals.filter(d => d.stage === 'Closed').length;
                return (
                  <div key={a.id} style={{ background: '#fff', borderRadius: 10, padding: 20, border: '1px solid #e0e0e0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 700, flexShrink: 0 }}>{(a.first_name[0] ?? '') + (a.last_name[0] ?? '')}</div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{a.first_name} {a.last_name} <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: a.role === 'admin' ? '#fef3c7' : '#e0f2fe', color: a.role === 'admin' ? '#92400e' : '#0369a1' }}>{a.role}</span></div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>{a.email}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                      {[{ n: agDeals.length, l: 'Total' }, { n: active, l: 'Active' }, { n: closed, l: 'Closed' }].map(s => (
                        <div key={s.l} style={{ flex: 1, textAlign: 'center', background: '#f9fafb', borderRadius: 6, padding: '8px 4px' }}>
                          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 700, color: '#111' }}>{s.n}</div>
                          <div style={{ fontSize: 10, color: '#6b7280' }}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>📞 {a.phone || '—'} &nbsp;·&nbsp; Lic: {a.license || '—'}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>
                      🕐 Last login: {a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* Role toggle — only for other users */}
                      {a.id !== profile.id && (
                        <button
                          onClick={() => updateAgentRole(a.id, a.first_name, a.role === 'admin' ? 'agent' : 'admin')}
                          style={{ width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600, background: a.role === 'admin' ? '#fef3c7' : '#f0fdf4', color: a.role === 'admin' ? '#92400e' : '#166534', border: `1px solid ${a.role === 'admin' ? '#fde68a' : '#bbf7d0'}`, borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                          {a.role === 'admin' ? '⬇️ Remove Admin' : '⬆️ Make Admin'}
                        </button>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => resetAgentPassword(a.email, a.first_name)}
                          style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                          🔑 Reset Password
                        </button>
                        {a.id !== profile.id && a.role !== 'admin' && (
                          <button
                            onClick={() => deleteAgent(a.id, a.first_name, a.last_name)}
                            style={{ padding: '7px 10px', fontSize: 12, fontWeight: 600, background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                            🗑
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {profiles.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: '#9ca3af' }}>No agents yet. Invite one above.</div>}
            </div>
          )}

          {/* ── Campaigns Page ── */}
          {page === 'campaigns' && (
            <div style={{ padding: isMobile ? '16px' : '28px', flex: 1, overflowY: 'auto' }}>

              {/* List view */}
              {campaignView === 'list' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                    <div>
                      <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 4 }}>Campaigns</h2>
                      <p style={{ fontSize: 13, color: '#6b7280' }}>Automated email & SMS drip campaigns to keep clients engaged</p>
                    </div>
                    <button className="crm-btn crm-btn-gold" onClick={() => { setActiveCampaign(null); setNewCampaign({ name: '', description: '', type: 'email', frequency: 'monthly', send_date: '', status: 'draft', email_subject: '', email_body: getDefaultEmailBody(), sms_body: '' }); setCampaignView('builder'); }}>
                      + New Campaign
                    </button>
                  </div>

                  {campaignLoading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading campaigns…</div>
                  ) : campaigns.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 60, background: '#f9fafb', borderRadius: 12, border: '2px dashed #e5e7eb' }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>📣</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 6 }}>No campaigns yet</div>
                      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Create your first drip campaign to automatically stay in touch with clients</div>
                      <button className="crm-btn crm-btn-gold" onClick={() => { setActiveCampaign(null); setNewCampaign({ name: '', description: '', type: 'email', frequency: 'monthly', send_date: '', status: 'draft', email_subject: '', email_body: getDefaultEmailBody(), sms_body: '' }); setCampaignView('builder'); }}>+ Create First Campaign</button>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {campaigns.map(camp => (
                        <div key={camp.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
                          <div style={{ width: 44, height: 44, borderRadius: 10, background: camp.type === 'email' ? '#dbeafe' : '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                            {camp.type === 'email' ? '✉️' : '💬'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                              <span style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>{camp.name}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: .5, padding: '2px 8px', borderRadius: 10, background: camp.status === 'active' ? '#dcfce7' : camp.status === 'paused' ? '#fef3c7' : '#f3f4f6', color: camp.status === 'active' ? '#166534' : camp.status === 'paused' ? '#92400e' : '#6b7280', textTransform: 'uppercase' }}>{camp.status}</span>
                              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: camp.type === 'email' ? '#dbeafe' : '#d1fae5', color: camp.type === 'email' ? '#1e40af' : '#065f46' }}>{camp.type.toUpperCase()}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#6b7280' }}>
                              {camp.frequency.charAt(0).toUpperCase() + camp.frequency.slice(1)} · {camp.enrollment_count ?? 0} enrolled
                              {camp.description && ` · ${camp.description}`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                            <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => { setActiveCampaign(camp); loadCampaignEnrollments(camp.id); loadCampaignSends(camp.id); setCampaignTab('enrolled'); setCampaignView('detail'); }}>Manage</button>
                            {isAdmin && <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => { setActiveCampaign(camp); setNewCampaign({ name: camp.name, description: camp.description, type: camp.type, frequency: camp.frequency, send_date: camp.send_date ?? '', status: camp.status, email_subject: camp.email_subject ?? '', email_body: camp.email_body ?? '', sms_body: camp.sms_body ?? '' }); setCampaignView('builder'); }}>Edit</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Detail view */}
              {campaignView === 'detail' && activeCampaign && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                    <button onClick={() => { setCampaignView('list'); setActiveCampaign(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', padding: 0 }}>←</button>
                    <div style={{ flex: 1 }}>
                      <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 700, color: '#111' }}>{activeCampaign.name}</h2>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{activeCampaign.type.toUpperCase()} · {activeCampaign.frequency} · <span style={{ color: activeCampaign.status === 'active' ? '#16a34a' : activeCampaign.status === 'paused' ? '#d97706' : '#6b7280', fontWeight: 600 }}>{activeCampaign.status}</span></div>
                    </div>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => { setNewCampaign({ name: activeCampaign.name, description: activeCampaign.description, type: activeCampaign.type, frequency: activeCampaign.frequency, send_date: activeCampaign.send_date ?? '', status: activeCampaign.status, email_subject: activeCampaign.email_subject ?? '', email_body: activeCampaign.email_body ?? '', sms_body: activeCampaign.sms_body ?? '' }); setCampaignView('builder'); }}>Edit</button>
                        {activeCampaign.status !== 'active' && <button className="crm-btn crm-btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, cursor: 'pointer' }} onClick={async () => { await fetch(`/api/campaigns/${activeCampaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) }); showToast('Campaign activated'); loadCampaigns(); setActiveCampaign({ ...activeCampaign, status: 'active' }); }}>▶ Activate</button>}
                        {activeCampaign.status === 'active' && <button className="crm-btn crm-btn-sm" style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, cursor: 'pointer' }} onClick={async () => { await fetch(`/api/campaigns/${activeCampaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paused' }) }); showToast('Campaign paused'); loadCampaigns(); setActiveCampaign({ ...activeCampaign, status: 'paused' }); }}>⏸ Pause</button>}
                        <button className="crm-btn crm-btn-ghost crm-btn-sm" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={() => deleteCampaign(activeCampaign.id)}>🗑 Delete</button>
                      </div>
                    )}
                  </div>

                  {/* Tabs */}
                  <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #f0f0f0', marginBottom: 20 }}>
                    {(['enrolled', 'history', 'settings'] as const).map(t => (
                      <button key={t} onClick={() => setCampaignTab(t)} style={{ padding: '10px 18px', fontSize: 13, fontWeight: campaignTab === t ? 700 : 400, color: campaignTab === t ? '#c9922c' : '#6b7280', background: 'none', border: 'none', borderBottom: campaignTab === t ? '2px solid #c9922c' : '2px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textTransform: 'capitalize' }}>
                        {t === 'enrolled' ? `Enrolled (${campaignEnrollments.filter(e => e.active).length})` : t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>

                  {/* Enrolled tab */}
                  {campaignTab === 'enrolled' && (
                    <div>
                      {/* Enroll new clients */}
                      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 10 }}>Enroll Clients</div>
                        <input className="crm-input" placeholder="Search contacts…" value={enrollClientSearch} onChange={e => setEnrollClientSearch(e.target.value)} style={{ marginBottom: 10 }} />
                        <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {clients.filter(c => {
                            const q = enrollClientSearch.toLowerCase();
                            const enrolled = campaignEnrollments.some(e => e.client_id === c.id && e.active);
                            return !enrolled && (`${c.first_name} ${c.last_name}`.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
                          }).slice(0, 30).map(c => (
                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', background: selectedEnrollIds.includes(c.id) ? '#fef3e2' : 'transparent' }}>
                              <input type="checkbox" checked={selectedEnrollIds.includes(c.id)} onChange={() => setSelectedEnrollIds(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])} style={{ accentColor: '#c9922c' }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                                <div style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || 'No email'}</div>
                              </div>
                            </label>
                          ))}
                        </div>
                        {selectedEnrollIds.length > 0 && (
                          <button className="crm-btn crm-btn-gold" style={{ marginTop: 10, width: '100%' }} onClick={() => enrollClients(activeCampaign.id)}>
                            Enroll {selectedEnrollIds.length} Client{selectedEnrollIds.length !== 1 ? 's' : ''}
                          </button>
                        )}
                      </div>

                      {/* Currently enrolled list */}
                      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>Currently Enrolled ({campaignEnrollments.filter(e => e.active).length})</div>
                      {campaignEnrollments.filter(e => e.active).length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af', fontSize: 13 }}>No clients enrolled yet</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {campaignEnrollments.filter(e => e.active).map(en => (
                            <div key={en.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#111', flexShrink: 0 }}>
                                {(en.client?.first_name?.[0] ?? '') + (en.client?.last_name?.[0] ?? '')}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 500 }}>{en.client?.first_name} {en.client?.last_name}</div>
                                <div style={{ fontSize: 11, color: '#9ca3af' }}>
                                  Next send: {en.next_send_at ? new Date(en.next_send_at).toLocaleDateString() : 'On activation'}
                                  {en.client?.unsubscribed_at && <span style={{ marginLeft: 8, color: '#ef4444', fontWeight: 600 }}>· Unsubscribed</span>}
                                </div>
                              </div>
                              <button onClick={() => unenrollClient(activeCampaign.id, en.client_id)} style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 5, color: '#ef4444', fontSize: 11, cursor: 'pointer', padding: '3px 10px', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Remove</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* History tab */}
                  {campaignTab === 'history' && (
                    <div>
                      {campaignSends.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No sends yet — activate the campaign to start sending.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {campaignSends.map(s => {
                            const client = clients.find(c => c.id === s.client_id);
                            return (
                              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: s.status === 'sent' ? '#dcfce7' : s.status === 'failed' ? '#fee2e2' : '#f3f4f6', color: s.status === 'sent' ? '#166534' : s.status === 'failed' ? '#991b1b' : '#6b7280' }}>{s.status.toUpperCase()}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 500 }}>{client ? `${client.first_name} ${client.last_name}` : 'Unknown client'}</div>
                                  {s.subject && <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subject}</div>}
                                </div>
                                <div style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{new Date(s.sent_at).toLocaleDateString()}</div>
                                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: s.type === 'email' ? '#dbeafe' : '#d1fae5', color: s.type === 'email' ? '#1e40af' : '#065f46' }}>{s.type.toUpperCase()}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Settings tab */}
                  {campaignTab === 'settings' && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {[
                        ['Type', activeCampaign.type.toUpperCase()],
                        ['Frequency', activeCampaign.frequency.charAt(0).toUpperCase() + activeCampaign.frequency.slice(1)],
                        ['Status', activeCampaign.status.charAt(0).toUpperCase() + activeCampaign.status.slice(1)],
                        ['Created', new Date(activeCampaign.created_at).toLocaleDateString()],
                      ].map(([label, val]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: '#f9fafb', borderRadius: 8, fontSize: 13 }}>
                          <span style={{ color: '#6b7280', fontWeight: 500 }}>{label}</span>
                          <span style={{ color: '#111', fontWeight: 600 }}>{val}</span>
                        </div>
                      ))}
                      {activeCampaign.type === 'email' && activeCampaign.email_subject && (
                        <div style={{ padding: '12px 14px', background: '#f9fafb', borderRadius: 8 }}>
                          <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Subject Line</div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{activeCampaign.email_subject}</div>
                        </div>
                      )}
                      {isAdmin && <button className="crm-btn crm-btn-ghost crm-btn-sm" style={{ color: '#ef4444', borderColor: '#fecaca', marginTop: 8 }} onClick={() => deleteCampaign(activeCampaign.id)}>🗑 Delete Campaign</button>}
                    </div>
                  )}
                </div>
              )}

              {/* Builder view */}
              {campaignView === 'builder' && (
                <div style={{ maxWidth: 680 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                    <button onClick={() => { setCampaignView(activeCampaign ? 'detail' : 'list'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', padding: 0 }}>←</button>
                    <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 700, color: '#111' }}>{activeCampaign ? 'Edit Campaign' : 'New Campaign'}</h2>
                  </div>

                  {/* Basics */}
                  <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 14 }}>Campaign Details</div>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Campaign Name *</label><input className="crm-input" style={{ marginTop: 4 }} placeholder="Monthly Market Update" value={newCampaign.name} onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })} /></div>
                      <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Description</label><input className="crm-input" style={{ marginTop: 4 }} placeholder="Brief description of the campaign purpose" value={newCampaign.description} onChange={e => setNewCampaign({ ...newCampaign, description: e.target.value })} /></div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Channel</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newCampaign.type} onChange={e => setNewCampaign({ ...newCampaign, type: e.target.value as 'email' | 'sms' })}>
                            <option value="email">✉️ Email</option>
                            <option value="sms">💬 SMS / Text</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Frequency</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newCampaign.frequency} onChange={e => setNewCampaign({ ...newCampaign, frequency: e.target.value, send_date: '' })}>
                            <option value="one-time">One-Time (specific date)</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="semi-annual">Semi-Annual</option>
                            <option value="annual">Annual</option>
                          </select>
                        </div>
                        {newCampaign.frequency === 'one-time' && (
                          <div style={{ gridColumn: '1/-1' }}>
                            <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Send Date *</label>
                            <input className="crm-input" type="date" style={{ marginTop: 4 }} value={newCampaign.send_date} min={new Date().toISOString().slice(0, 10)} onChange={e => setNewCampaign({ ...newCampaign, send_date: e.target.value })} />
                            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>The campaign will send on this date and then deactivate automatically.</div>
                          </div>
                        )}
                        <div>
                          <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Status</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newCampaign.status} onChange={e => setNewCampaign({ ...newCampaign, status: e.target.value })}>
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Email fields */}
                  {newCampaign.type === 'email' && (
                    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 14 }}>Email Content</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Subject Line *</label><input className="crm-input" style={{ marginTop: 4 }} placeholder="Hi {{first_name}}, here's your market update!" value={newCampaign.email_subject} onChange={e => setNewCampaign({ ...newCampaign, email_subject: e.target.value })} /></div>
                        <div>
                          <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Email Body *</label>
                          {/* Rich text toolbar */}
                          <div style={{ marginTop: 4, border: '1px solid #d1d5db', borderRadius: '6px 6px 0 0', background: '#f9fafb', padding: '6px 10px', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            {[
                              { label: 'B', cmd: 'bold', title: 'Bold', style: { fontWeight: 700 } },
                              { label: 'I', cmd: 'italic', title: 'Italic', style: { fontStyle: 'italic' } },
                              { label: 'U', cmd: 'underline', title: 'Underline', style: { textDecoration: 'underline' } },
                            ].map(btn => (
                              <button key={btn.cmd} type="button" title={btn.title}
                                onMouseDown={e => { e.preventDefault(); document.execCommand(btn.cmd, false); emailEditorRef.current?.focus(); setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? prev.email_body })); }}
                                style={{ ...btn.style, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, width: 28, height: 26, cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {btn.label}
                              </button>
                            ))}
                            <div style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 2px' }} />
                            <button type="button" title="Heading"
                              onMouseDown={e => { e.preventDefault(); document.execCommand('formatBlock', false, 'h3'); emailEditorRef.current?.focus(); setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? prev.email_body })); }}
                              style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, height: 26, padding: '0 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>H</button>
                            <button type="button" title="Bullet List"
                              onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList', false); emailEditorRef.current?.focus(); setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? prev.email_body })); }}
                              style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, width: 28, height: 26, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>•</button>
                            <button type="button" title="Insert Link"
                              onMouseDown={e => {
                                e.preventDefault();
                                const url = window.prompt('Enter URL (e.g. https://fairoaksrealtygroup.com):');
                                if (url) { document.execCommand('createLink', false, url); const links = emailEditorRef.current?.querySelectorAll('a'); links?.forEach(a => { a.target = '_blank'; a.rel = 'noopener'; }); }
                                emailEditorRef.current?.focus();
                                setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? prev.email_body }));
                              }}
                              style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, height: 26, padding: '0 8px', cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans',sans-serif", display: 'flex', alignItems: 'center', gap: 4 }}>🔗 Link</button>
                            <div style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 2px' }} />
                            {/* Merge field chips */}
                            {['{{first_name}}','{{full_name}}','{{agent_name}}','{{agent_phone}}','{{unsubscribe_url}}'].map(f => (
                              <button key={f} type="button" title={`Insert ${f}`}
                                onMouseDown={e => {
                                  e.preventDefault();
                                  document.execCommand('insertText', false, f);
                                  emailEditorRef.current?.focus();
                                  setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? prev.email_body }));
                                }}
                                style={{ background: '#fef3e2', border: '1px solid #fde68a', borderRadius: 4, padding: '2px 7px', fontSize: 10, color: '#92400e', cursor: 'pointer', fontFamily: 'monospace', height: 26, display: 'flex', alignItems: 'center' }}>
                                {f.replace(/[{}]/g, '')}
                              </button>
                            ))}
                          </div>
                          {/* Editable body */}
                          <div
                            key={`editor-${activeCampaign?.id ?? 'new'}`}
                            ref={emailEditorRef}
                            contentEditable
                            suppressContentEditableWarning
                            onInput={() => setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? '' }))}
                            style={{ minHeight: 240, border: '1px solid #d1d5db', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: '14px 16px', fontSize: 14, lineHeight: 1.7, color: '#111', outline: 'none', fontFamily: "'DM Sans',sans-serif", background: '#fff', overflowY: 'auto' }}
                          />
                          {!newCampaign.email_body.includes('{{unsubscribe_url}}') && newCampaign.email_body.replace(/<[^>]*>/g, '').length > 0 && (
                            <div style={{ marginTop: 6, fontSize: 11, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '5px 10px' }}>
                              ⚠️ Include the <strong>unsubscribe_url</strong> merge field for CAN-SPAM compliance (click it above to insert)
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SMS fields */}
                  {newCampaign.type === 'sms' && (
                    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 14 }}>SMS Content</div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Message *</label>
                          <span style={{ fontSize: 11, color: newCampaign.sms_body.length > 160 ? '#ef4444' : '#9ca3af', fontWeight: newCampaign.sms_body.length > 160 ? 700 : 400 }}>{newCampaign.sms_body.length}/160</span>
                        </div>
                        <textarea className="crm-input" style={{ marginTop: 0, minHeight: 100, resize: 'vertical' }} placeholder={`Hi {{first_name}}, this is {{agent_name}} from {{brokerage}}. Just checking in — are you still looking for properties? Reply STOP to opt out.`} value={newCampaign.sms_body} onChange={e => setNewCampaign({ ...newCampaign, sms_body: e.target.value })} />
                        <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280', background: '#f9fafb', borderRadius: 6, padding: '6px 10px' }}>
                          💡 Twilio automatically appends opt-out instructions for compliant SMS campaigns. Keep your message concise and personal.
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button className="crm-btn crm-btn-ghost" onClick={() => { setCampaignView(activeCampaign ? 'detail' : 'list'); }}>Cancel</button>
                    <button className="crm-btn crm-btn-gold" onClick={saveCampaign} disabled={saving}>{saving ? 'Saving…' : activeCampaign ? 'Save Changes' : 'Create Campaign'}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {/* Mobile bottom nav */}
        {isMobile && (
          <nav style={{ background: '#111', display: 'flex', borderTop: '1px solid rgba(255,255,255,.08)', flexShrink: 0, paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {mobileNavItems.map(item => (
              <button key={item.id}
                onClick={() => { setPage(item.id); if (item.id === 'contacts') loadClients(); if (item.id === 'calendar') loadCalendarEvents(calendarFilter === 'week' ? 7 : 30); if (item.id === 'campaigns') { setCampaignView('list'); loadCampaigns(); } }}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 0 6px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'color .15s', color: page === item.id ? '#c9922c' : 'rgba(255,255,255,.4)' }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{item.icon}</span>
                <span style={{ fontSize: 10, marginTop: 3, fontWeight: page === item.id ? 700 : 400, letterSpacing: .3 }}>{item.label}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* ── Deal Modal ── */}
      {activeDeal && (
        <div className="overlay" onClick={() => { setActiveDeal(null); setShowDealAgentPicker(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 26px', background: '#111', color: '#fff', display: 'flex', alignItems: 'center', gap: 12, borderRadius: '12px 12px 0 0' }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600, flex: 1 }}>{activeDeal.client}</h3>
              <span style={{ ...Object.fromEntries((TYPE_COLORS[activeDeal.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 } as React.CSSProperties}>{activeDeal.type}</span>
              <button onClick={() => { setActiveDeal(null); setShowDealAgentPicker(false); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: isMobile ? '16px 18px' : '20px 26px', overflowY: 'auto', flex: 1 }}>
              {/* Pipeline bar */}
              <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e7eb', marginBottom: 18 }}>
                {STAGES.map((s, i) => {
                  const ci = STAGES.indexOf(activeDeal.stage);
                  const cls = i < ci ? { background: '#1a1a1a', color: 'rgba(255,255,255,.75)' } : i === ci ? { background: '#c9922c', color: '#111', fontWeight: 700 } : { background: '#f3f4f6', color: '#9ca3af' };
                  return <div key={s} onClick={() => setStage(activeDeal, s)} style={{ flex: 1, textAlign: 'center', padding: '9px 4px', fontSize: 11, fontWeight: 500, cursor: 'pointer', borderRight: i < STAGES.length - 1 ? '1px solid #e5e7eb' : 'none', ...cls }}>{s}</div>;
                })}
              </div>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '2px solid #f0ebe0', marginBottom: 18 }}>
                {(['overview', 'client', 'emails', 'docs'] as const).map(t => (
                  <button key={t} onClick={() => setDealTab(t)}
                    style={{ padding: '8px 18px', fontSize: 13, cursor: 'pointer', background: 'none', border: 'none', color: dealTab === t ? '#111' : '#6b7280', borderBottom: dealTab === t ? '2px solid #c9922c' : '2px solid transparent', marginBottom: -2, fontFamily: "'DM Sans',sans-serif", fontWeight: dealTab === t ? 500 : 400, textTransform: 'capitalize' }}>
                    {t === 'emails' ? 'Email Log' : t === 'docs' ? `Docs${dealDocs.length > 0 ? ` (${dealDocs.length})` : ''}` : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* Overview tab */}
              {dealTab === 'overview' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                    <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Property</label><input className="crm-input" style={{ marginTop: 4 }} defaultValue={activeDeal.property} onBlur={e => updateDeal(activeDeal.id, { property: e.target.value })} /></div>
                    <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Value ($)</label><input className="crm-input" type="number" style={{ marginTop: 4 }} defaultValue={activeDeal.value} onBlur={e => updateDeal(activeDeal.id, { value: +e.target.value })} /></div>
                    <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Stage</label>
                      <select className="crm-input" style={{ marginTop: 4 }} value={activeDeal.stage} onChange={e => setStage(activeDeal, e.target.value)}>
                        {STAGES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    {isAdmin && (
                      <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Assigned Agent</label>
                        <select className="crm-input" style={{ marginTop: 4 }} value={activeDeal.agent_id} onChange={e => updateDeal(activeDeal.id, { agent_id: e.target.value })}>
                          {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                        </select>
                      </div>
                    )}
                    <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Notes</label><textarea className="crm-input" style={{ marginTop: 4, minHeight: 80, resize: 'vertical' }} defaultValue={activeDeal.notes} onBlur={e => updateDeal(activeDeal.id, { notes: e.target.value })} /></div>
                  </div>

                  {/* ── Agent Tags ── */}
                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Agents on This Deal</label>
                      {isAdmin && (
                        <div style={{ position: 'relative', marginLeft: 'auto' }}>
                          <button
                            onClick={e => { e.stopPropagation(); setShowDealAgentPicker(v => !v); }}
                            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '1px dashed #d1d5db', background: 'none', color: '#6b7280', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                            ＋ Tag Agent
                          </button>
                          {showDealAgentPicker && (
                            <div
                              onClick={e => e.stopPropagation()}
                              style={{ position: 'absolute', top: '100%', right: 0, zIndex: 60, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.14)', minWidth: 230, padding: '6px 0', marginTop: 4 }}>
                              <div style={{ padding: '5px 12px 4px', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500 }}>Select Agents</div>
                              {profiles.map(p => {
                                const isTagged = (activeDeal.assigned_agent_ids ?? []).includes(p.id);
                                return (
                                  <button key={p.id}
                                    onClick={e => { e.stopPropagation(); toggleDealAgentTag(activeDeal.id, p.id); }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: isTagged ? '#f0fdf4' : 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#111', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                                      {(p.first_name[0] ?? '') + (p.last_name[0] ?? '')}
                                    </span>
                                    <span style={{ flex: 1 }}>
                                      {p.first_name} {p.last_name}
                                      <br /><span style={{ fontSize: 11, color: '#9ca3af' }}>{p.role}</span>
                                    </span>
                                    {isTagged && <span style={{ fontSize: 13, color: '#16a34a' }}>✓</span>}
                                  </button>
                                );
                              })}
                              <div style={{ borderTop: '1px solid #f0f0f0', padding: '5px 12px 2px' }}>
                                <button onClick={e => { e.stopPropagation(); setShowDealAgentPicker(false); }}
                                  style={{ background: 'none', border: 'none', fontSize: 11, color: '#9ca3af', cursor: 'pointer', padding: 0 }}>Close</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {(() => {
                      const taggedOnDeal = profiles.filter(p => (activeDeal.assigned_agent_ids ?? []).includes(p.id));
                      const owner = profiles.find(p => p.id === activeDeal.agent_id);
                      return (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {/* Owner agent always shown */}
                          {owner && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fef9f0', border: '1px solid #fde68a', borderRadius: 20, padding: '5px 12px 5px 7px' }}>
                              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#c9922c', color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
                                {(owner.first_name[0] ?? '') + (owner.last_name[0] ?? '')}
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>{owner.first_name} {owner.last_name}</span>
                              <span style={{ fontSize: 10, color: '#b45309', marginLeft: 2 }}>Owner</span>
                            </div>
                          )}
                          {/* Tagged co-agents */}
                          {taggedOnDeal.filter(p => p.id !== activeDeal.agent_id).map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20, padding: '5px 10px 5px 7px' }}>
                              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
                                {(p.first_name[0] ?? '') + (p.last_name[0] ?? '')}
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>{p.first_name} {p.last_name}</span>
                              {isAdmin && (
                                <button onClick={() => toggleDealAgentTag(activeDeal.id, p.id)}
                                  style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, marginLeft: 2 }} title="Remove">✕</button>
                              )}
                            </div>
                          ))}
                          {taggedOnDeal.filter(p => p.id !== activeDeal.agent_id).length === 0 && (
                            <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No co-agents tagged yet</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ marginTop: 16, fontSize: 12, color: '#6b7280' }}>Created: {activeDeal.created_at?.slice(0, 10)} · Last Touch: {activeDeal.last_touch?.slice(0, 10)}</div>
                  {isAdmin && <div style={{ marginTop: 12 }}><button onClick={() => deleteDeal(activeDeal.id)} style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>Delete Deal</button></div>}
                </div>
              )}

              {/* Client tab */}
              {dealTab === 'client' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                  <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Client Name</label><input className="crm-input" style={{ marginTop: 4 }} defaultValue={activeDeal.client} onBlur={e => updateDeal(activeDeal.id, { client: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Email</label><input className="crm-input" type="email" style={{ marginTop: 4 }} defaultValue={activeDeal.client_email} onBlur={e => updateDeal(activeDeal.id, { client_email: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Phone</label><input className="crm-input" style={{ marginTop: 4 }} defaultValue={activeDeal.client_phone} onBlur={e => updateDeal(activeDeal.id, { client_phone: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Deal Type</label>
                    <select className="crm-input" style={{ marginTop: 4 }} value={activeDeal.type} onChange={e => updateDeal(activeDeal.id, { type: e.target.value })}>
                      {DEAL_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Emails tab */}
              {dealTab === 'emails' && (
                <div>
                  {gmailConnected && activeDeal?.client_email && (
                    <div style={{ marginBottom: 12, padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#166534' }}>✉️ Gmail — syncing direct thread with {activeDeal.client_email}</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => syncGmail(activeDeal)} disabled={syncing}
                            style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', opacity: syncing ? 0.7 : 1 }}>
                            {syncing ? 'Syncing…' : '↻ Sync'}
                          </button>
                          <button onClick={() => clearAndResync(activeDeal)} disabled={syncing}
                            title="Delete all Gmail-synced emails for this deal and re-sync fresh"
                            style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, background: 'none', color: '#166534', border: '1px solid #86efac', borderRadius: 5, cursor: 'pointer', opacity: syncing ? 0.7 : 1 }}>
                            ↺ Clear & Re-sync
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                    {dealEmails.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>📭 No emails logged yet.</div>}
                    {dealEmails.map(e => (
                      <div key={e.id} style={{ background: '#f8f8f8', borderRadius: 8, padding: '13px 15px', border: '1px solid #e8e8e8' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: .8, padding: '2px 7px', borderRadius: 3, background: e.direction === 'sent' ? '#dbeafe' : '#d1fae5', color: e.direction === 'sent' ? '#1e40af' : '#065f46' }}>{e.direction.toUpperCase()}</span>
                          <span style={{ fontSize: 11, color: '#6b7280' }}>{e.direction === 'sent' ? `To: ${e.to_email}` : `From: ${e.from_email}`}</span>
                          <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>{e.email_date}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{e.subject}</div>
                        <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{e.body}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 8, padding: 15 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#111' }}>+ Log Email Touch</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Direction</label>
                        <select className="crm-input" style={{ marginTop: 4 }} value={ne.direction} onChange={e => setNe({ ...ne, direction: e.target.value as 'sent' | 'received' })}>
                          <option value="sent">Sent</option><option value="received">Received</option>
                        </select>
                      </div>
                      <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Date</label><input className="crm-input" type="date" style={{ marginTop: 4 }} value={ne.email_date} onChange={e => setNe({ ...ne, email_date: e.target.value })} /></div>
                      <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Subject</label><input className="crm-input" style={{ marginTop: 4 }} value={ne.subject} onChange={e => setNe({ ...ne, subject: e.target.value })} placeholder="Email subject…" /></div>
                      <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Body / Summary</label><textarea className="crm-input" style={{ marginTop: 4, minHeight: 70, resize: 'vertical' }} value={ne.body} onChange={e => setNe({ ...ne, body: e.target.value })} placeholder="Paste or summarize…" /></div>
                    </div>
                    <div style={{ marginTop: 10, textAlign: 'right' }}>
                      <button className="crm-btn crm-btn-sm" style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, cursor: 'pointer' }} onClick={() => logEmail(activeDeal)}>Log Email</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Docs tab */}
              {dealTab === 'docs' && (
                <div>
                  {/* Upload area */}
                  <div
                    onClick={() => docFileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#c9922c'; e.currentTarget.style.background = '#fef9f0'; }}
                    onDragLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.background = '#f9fafb'; }}
                    onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.background = '#f9fafb'; const file = e.dataTransfer.files[0]; if (file) uploadDoc(activeDeal, file); }}
                    style={{ border: '2px dashed #d1d5db', borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: '#f9fafb', marginBottom: 16, transition: 'all .15s' }}>
                    {docUploading ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#c9922c' }}>
                        <div style={{ width: 20, height: 20, border: '3px solid #c9922c', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>Uploading…</span>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Drop a file here or click to browse</div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>PDF, Word, JPG, PNG · Max 25 MB</div>
                      </>
                    )}
                  </div>
                  <input ref={docFileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                    onChange={e => { const file = e.target.files?.[0]; if (file) uploadDoc(activeDeal, file); e.target.value = ''; }} />

                  {/* Doc list */}
                  {dealDocs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af', fontSize: 13 }}>📂 No documents uploaded yet</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {dealDocs.map(doc => {
                        const isImage = doc.file_type?.startsWith('image/');
                        const isPdf = doc.file_type === 'application/pdf';
                        const icon = isPdf ? '📄' : isImage ? '🖼️' : '📝';
                        const size = doc.file_size ? (doc.file_size > 1024 * 1024 ? `${(doc.file_size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(doc.file_size / 1024)} KB`) : '';
                        const uploader = profiles.find(p => p.id === doc.uploaded_by);
                        const uploaderName = uploader ? uploader.first_name : profile!.id === doc.uploaded_by ? profile!.first_name : 'Agent';
                        return (
                          <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px' }}>
                            <span style={{ fontSize: 22, flexShrink: 0 }}>{icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                                {size}{size ? ' · ' : ''}{doc.created_at?.slice(0, 10)}{uploaderName ? ` · ${uploaderName}` : ''}
                              </div>
                            </div>
                            {doc.url && (
                              <a href={doc.url} target="_blank" rel="noreferrer"
                                style={{ padding: '5px 12px', background: '#111', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
                                ↓ Open
                              </a>
                            )}
                            {isAdmin && (
                              <button onClick={() => deleteDoc(doc, activeDeal.id)}
                                style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16, padding: '2px 4px', flexShrink: 0 }} title="Remove">🗑</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add Deal Modal ── */}
      {showAddDeal && (
        <div className="overlay" onClick={() => { setShowAddDeal(false); setNd({ client_id: '', client: '', client_email: '', client_phone: '', type: 'Buyer Purchase', property: '', value: 0, notes: '' }); }}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 26px', background: '#111', color: '#fff', display: 'flex', alignItems: 'center', borderRadius: '12px 12px 0 0' }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600, flex: 1 }}>New Deal</h3>
              <button onClick={() => { setShowAddDeal(false); setNd({ client_id: '', client: '', client_email: '', client_phone: '', type: 'Buyer Purchase', property: '', value: 0, notes: '' }); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '22px 26px' }}>

              {/* Client selector */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Select Client *</label>
                {clients.length === 0 ? (
                  <div style={{ marginTop: 8, padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
                    No clients yet.{' '}
                    <button onClick={() => { setShowAddDeal(false); setShowAddClient(true); }}
                      style={{ background: 'none', border: 'none', color: '#c9922c', fontWeight: 600, cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 }}>
                      Add a client first →
                    </button>
                  </div>
                ) : (
                  <select
                    className="crm-input"
                    style={{ marginTop: 6 }}
                    value={nd.client_id}
                    onChange={e => {
                      const chosen = clients.find(c => c.id === e.target.value);
                      if (chosen) {
                        setNd({
                          ...nd,
                          client_id: chosen.id,
                          client: `${chosen.first_name} ${chosen.last_name}`,
                          client_email: chosen.email,
                          client_phone: chosen.phone,
                          type: CLIENT_TYPE_TO_DEAL[chosen.type] || 'Buyer Purchase',
                        });
                      } else {
                        setNd({ ...nd, client_id: '', client: '', client_email: '', client_phone: '', type: 'Buyer Purchase' });
                      }
                    }}
                  >
                    <option value="">— Choose a client —</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.first_name} {c.last_name} · {c.type}{c.email ? ` · ${c.email}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Client preview */}
              {nd.client_id && (
                <div style={{ marginBottom: 18, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, display: 'flex', gap: 16, fontSize: 12, color: '#166534' }}>
                  <span>👤 <strong>{nd.client}</strong></span>
                  {nd.client_email && <span>✉️ {nd.client_email}</span>}
                  {nd.client_phone && <span>📞 {nd.client_phone}</span>}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Deal Type *</label>
                  <select className="crm-input" style={{ marginTop: 4 }} value={nd.type} onChange={e => setNd({ ...nd, type: e.target.value })}>
                    {DEAL_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Property Address</label>
                  <input className="crm-input" style={{ marginTop: 4 }} placeholder="123 Main St, City, State" value={nd.property} onChange={e => setNd({ ...nd, property: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Deal Value ($)</label>
                  <input className="crm-input" type="number" style={{ marginTop: 4 }} value={nd.value} onChange={e => setNd({ ...nd, value: +e.target.value })} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Notes</label>
                  <textarea className="crm-input" style={{ marginTop: 4, minHeight: 70, resize: 'vertical' }} value={nd.notes} onChange={e => setNd({ ...nd, notes: e.target.value })} placeholder="Initial notes…" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="crm-btn crm-btn-ghost" onClick={() => { setShowAddDeal(false); setNd({ client_id: '', client: '', client_email: '', client_phone: '', type: 'Buyer Purchase', property: '', value: 0, notes: '' }); }}>Cancel</button>
                <button className="crm-btn crm-btn-gold" onClick={createDeal} disabled={saving || !nd.client_id}>{saving ? 'Creating…' : 'Create Deal'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Client Modal ── */}
      {showAddClient && (
        <div className="overlay" onClick={() => { setShowAddClient(false); setAssetDropdownOpen(null); }}>
          <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding: '20px 28px', background: '#111', color: '#fff', display: 'flex', alignItems: 'center', borderRadius: '12px 12px 0 0', flexShrink: 0 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600, flex: 1 }}>Add Contact</h3>
              <button onClick={() => setShowAddClient(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            {/* Scrollable body */}
            <div style={{ padding: '24px 28px', overflowY: 'auto', maxHeight: 'calc(90vh - 130px)' }}>

              {/* ── Section: Contact Type ── */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>Contact Type *</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                  {CLIENT_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setNc({ ...nc, type: t })}
                      style={{
                        padding: '10px 4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                        cursor: 'pointer', border: '2px solid', textAlign: 'center', lineHeight: 1.3,
                        borderColor: nc.type === t ? '#c9922c' : '#e5e7eb',
                        background: nc.type === t ? '#fef3e2' : '#f9fafb',
                        color: nc.type === t ? '#92400e' : '#6b7280',
                        transition: 'all .15s', fontFamily: "'DM Sans',sans-serif",
                      }}>
                      <div style={{ fontSize: 18, marginBottom: 4 }}>{t === 'Buyer' ? '🏡' : t === 'Seller' ? '🪧' : t === 'Tenant' ? '🔑' : t === 'Landlord/Investor' ? '🏢' : t === 'Agent' ? '🤝' : '🏛'}</div>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Section: Identity ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Identity</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>First Name *</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="Jane" value={nc.first_name} onChange={e => setNc({ ...nc, first_name: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Last Name</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="Smith" value={nc.last_name} onChange={e => setNc({ ...nc, last_name: e.target.value })} />
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>
                      {nc.type === 'Agent' || nc.type === 'Broker' ? 'Business / Brokerage Name' : 'Business Name'} <span style={{ color: '#d1d5db', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder={nc.type === 'Agent' || nc.type === 'Broker' ? 'Century 21, Keller Williams…' : 'Company or business name'} value={nc.business_name} onChange={e => setNc({ ...nc, business_name: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* ── Section: Contact Info ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Contact Info</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Email</label>
                    <input className="crm-input" type="email" style={{ marginTop: 4 }} placeholder="jane@email.com" value={nc.email} onChange={e => setNc({ ...nc, email: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Phone</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="(210) 555-0000" value={nc.phone} onChange={e => setNc({ ...nc, phone: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Cell Phone</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="(210) 555-0001" value={nc.cell_phone} onChange={e => setNc({ ...nc, cell_phone: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* ── Section: Property Preferences (non-Agent/Broker) ── */}
              {(nc.type !== 'Agent' && nc.type !== 'Broker') && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Property Preferences</div>
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                  </div>

                  {/* Asset Types dropdown */}
                  <div style={{ marginBottom: 12, position: 'relative' }}>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500, display: 'block', marginBottom: 4 }}>Asset Type(s)</label>
                    <button type="button"
                      onClick={e => { e.stopPropagation(); setAssetDropdownOpen(assetDropdownOpen === 'nc' ? null : 'nc'); }}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: nc.asset_types.length ? '#111' : '#9ca3af' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {nc.asset_types.length === 0 ? 'Select asset type(s)…' : nc.asset_types.join(', ')}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{assetDropdownOpen === 'nc' ? '▲' : '▼'}</span>
                    </button>
                    {assetDropdownOpen === 'nc' && (
                      <div onClick={e => e.stopPropagation()}
                        style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '6px 0', marginTop: 4 }}>
                        <div style={{ padding: '4px 12px 6px', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>Select all that apply</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: '0 6px 6px' }}>
                          {ASSET_TYPES.map(at => {
                            const checked = nc.asset_types.includes(at);
                            return (
                              <label key={at} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? '#fef3e2' : 'transparent', transition: 'background .1s' }}>
                                <input type="checkbox" checked={checked} onChange={() => {
                                  const next = checked ? nc.asset_types.filter(x => x !== at) : [...nc.asset_types, at];
                                  setNc({ ...nc, asset_types: next });
                                }} style={{ accentColor: '#c9922c', width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }} />
                                <span style={{ fontSize: 12, fontWeight: checked ? 600 : 400, color: checked ? '#92400e' : '#374151' }}>{at}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '6px 12px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>{nc.asset_types.length} selected</span>
                          <button onClick={() => setAssetDropdownOpen(null)} style={{ background: 'none', border: 'none', fontSize: 11, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Done</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Budget + Size side by side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Budget / Price Range</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="$400k – $500k" value={nc.budget} onChange={e => setNc({ ...nc, budget: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Size Range (Sq Ft)</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="1,500 – 2,500 sqft" value={nc.size_range} onChange={e => setNc({ ...nc, size_range: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Section: Professional (Agent/Broker only) ── */}
              {(nc.type === 'Agent' || nc.type === 'Broker') && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Professional</div>
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Brokerage</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="Century 21, KW…" value={nc.brokerage} onChange={e => setNc({ ...nc, brokerage: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>License #</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="TX-0000000" value={nc.license} onChange={e => setNc({ ...nc, license: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Section: Location ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Location</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Street Address</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="123 Main St" value={nc.address} onChange={e => setNc({ ...nc, address: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>City</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="San Antonio" value={nc.city} onChange={e => setNc({ ...nc, city: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>State</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="TX" value={nc.state} onChange={e => setNc({ ...nc, state: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>ZIP</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="78015" value={nc.zip} onChange={e => setNc({ ...nc, zip: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Section: Notes ── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Notes</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <textarea className="crm-input" style={{ minHeight: 70, resize: 'vertical' }}
                  placeholder={nc.type === 'Agent' || nc.type === 'Broker' ? 'Co-op deals, referral history, relationship notes…' : 'Pre-approval status, timeline, special requirements…'}
                  value={nc.notes} onChange={e => setNc({ ...nc, notes: e.target.value })} />
              </div>
            </div>

            {/* Sticky footer */}
            <div style={{ padding: '16px 28px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 10, justifyContent: 'flex-end', background: '#fff', borderRadius: '0 0 12px 12px', flexShrink: 0 }}>
              <button className="crm-btn crm-btn-ghost" onClick={() => setShowAddClient(false)}>Cancel</button>
              <button className="crm-btn crm-btn-gold" onClick={createClient} disabled={saving}>{saving ? 'Saving…' : 'Add Contact'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Agent Modal ── */}
      {showInvite && (
        <div className="overlay" onClick={() => setShowInvite(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 26px', background: '#111', color: '#fff', display: 'flex', alignItems: 'center', borderRadius: '12px 12px 0 0' }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600, flex: 1 }}>Invite Agent</h3>
              <button onClick={() => setShowInvite(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '22px 26px' }}>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#92400e', marginBottom: 16 }}>
                An invite email will be sent with a link to set their password and access the CRM.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                {[
                  { label: 'First Name *', key: 'first_name', placeholder: 'Jane', type: 'text' },
                  { label: 'Last Name *', key: 'last_name', placeholder: 'Smith', type: 'text' },
                  { label: 'Email *', key: 'email', placeholder: 'agent@fairoaksrealtygroup.com', type: 'email', full: true },
                  { label: 'Phone', key: 'phone', placeholder: '(555) 000-0000', type: 'text' },
                  { label: 'License #', key: 'license', placeholder: 'TX-0000000', type: 'text' },
                ].map(f => (
                  <div key={f.key} style={f.full ? { gridColumn: '1/-1' } : {}}>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>{f.label}</label>
                    <input className="crm-input" type={f.type} style={{ marginTop: 4 }} placeholder={f.placeholder} value={(inv as Record<string,unknown>)[f.key] as string} onChange={e => setInv({ ...inv, [f.key]: e.target.value })} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="crm-btn crm-btn-ghost" onClick={() => setShowInvite(false)}>Cancel</button>
                <button className="crm-btn crm-btn-gold" onClick={inviteAgent} disabled={saving}>{saving ? 'Sending…' : 'Send Invite'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for import */}
      <input
        ref={importFileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) importClients(f); }}
      />

      {/* ── Client Profile Modal ── */}
      {activeClient && (() => {
        const c = activeClient;
        const clientDeals = deals.filter(d => d.client_id === c.id);
        const taggedAgents = (c.assigned_agent_ids ?? []).map(aid => profiles.find(p => p.id === aid)).filter(Boolean) as Profile[];
        const ownerProfile = profiles.find(p => p.id === c.agent_id);
        const ownerName = ownerProfile ? `${ownerProfile.first_name} ${ownerProfile.last_name}` : profile!.id === c.agent_id ? `${profile!.first_name} ${profile!.last_name}` : '—';
        return (
          <div className="overlay" onClick={() => setActiveClient(null)}>
            <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{ padding: '22px 28px', background: '#111', color: '#fff', borderRadius: '12px 12px 0 0', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: '#111', flexShrink: 0 }}>
                  {(c.first_name[0] ?? '') + (c.last_name[0] ?? '')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 700, marginBottom: 2 }}>{c.first_name} {c.last_name}</h3>
                  {c.business_name && <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>{c.business_name}</div>}
                  <span style={{ ...Object.fromEntries((CLIENT_TYPE_COLORS[c.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700 } as React.CSSProperties}>
                    {c.type === 'Buyer' ? '🏡' : c.type === 'Seller' ? '🪧' : c.type === 'Tenant' ? '🔑' : c.type === 'Landlord/Investor' ? '🏢' : c.type === 'Agent' ? '🤝' : '🏛'} {c.type}
                  </span>
                </div>
                <button onClick={() => setActiveClient(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>

              <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', maxHeight: 'calc(90vh - 120px)' }}>
                {/* Contact Info */}
                <div>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>Contact Information</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', gridColumn: (c.extra_emails?.length > 0) ? '1/-1' : undefined }}>
                      <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>
                        Email{(c.extra_emails?.length ?? 0) > 0 ? 's' : ''}
                      </div>
                      {c.email ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <a href={`mailto:${c.email}`} style={{ fontSize: 14, fontWeight: 500, color: '#c9922c', textDecoration: 'none', wordBreak: 'break-all' }}>{c.email}</a>
                            <span style={{ fontSize: 9, background: '#dcfce7', color: '#16a34a', borderRadius: 10, padding: '1px 6px', fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', flexShrink: 0 }}>Primary</span>
                          </div>
                          {(c.extra_emails ?? []).map((em, i) => em.trim() ? (
                            <a key={i} href={`mailto:${em}`} style={{ fontSize: 13, fontWeight: 500, color: '#6b7280', textDecoration: 'none', wordBreak: 'break-all' }}>{em}</a>
                          ) : null)}
                        </div>
                      ) : <span style={{ fontSize: 13, color: '#d1d5db' }}>Not provided</span>}
                    </div>
                    <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>Phone</div>
                      {c.phone ? (
                        <a href={`tel:${c.phone}`} style={{ fontSize: 14, fontWeight: 500, color: '#374151', textDecoration: 'none' }}>{c.phone}</a>
                      ) : <span style={{ fontSize: 13, color: '#d1d5db' }}>Not provided</span>}
                    </div>
                    <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>Cell Phone</div>
                      {c.cell_phone ? (
                        <a href={`tel:${c.cell_phone}`} style={{ fontSize: 14, fontWeight: 500, color: '#374151', textDecoration: 'none' }}>{c.cell_phone}</a>
                      ) : <span style={{ fontSize: 13, color: '#d1d5db' }}>Not provided</span>}
                    </div>
                    {(c.address || c.city || c.state || c.zip) && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', gridColumn: '1/-1' }}>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>Address</div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
                          {c.address && <div>{c.address}</div>}
                          {(c.city || c.state || c.zip) && <div>{[c.city, c.state, c.zip].filter(Boolean).join(', ')}</div>}
                        </div>
                      </div>
                    )}
                    {(c.brokerage || c.type === 'Agent' || c.type === 'Broker') && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>Brokerage</div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{c.brokerage || <span style={{ color: '#d1d5db' }}>Not provided</span>}</div>
                      </div>
                    )}
                    {(c.license || c.type === 'Agent' || c.type === 'Broker') && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>License #</div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{c.license || <span style={{ color: '#d1d5db' }}>Not provided</span>}</div>
                      </div>
                    )}
                    {c.budget && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>Budget / Price Range</div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{c.budget}</div>
                      </div>
                    )}
                    {c.size_range && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>Size Range (Sq Ft)</div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{c.size_range}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Asset Types */}
                {(c.asset_types ?? []).length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>Asset Type(s)</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(c.asset_types ?? []).map(at => (
                        <span key={at} style={{ display: 'inline-block', background: '#fef3e2', border: '1px solid #fde68a', color: '#92400e', borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 600 }}>{at}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {c.notes && (
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>Notes</div>
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{c.notes}</div>
                  </div>
                )}

                {/* Tagged Agents */}
                <div>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>Tagged Agents</div>
                  {taggedAgents.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No agents tagged</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {taggedAgents.map(a => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20, padding: '5px 12px 5px 8px' }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
                            {(a.first_name[0] ?? '') + (a.last_name[0] ?? '')}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>{a.first_name} {a.last_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Deals */}
                <div>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>Linked Deals</div>
                  {clientDeals.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No deals yet</span>
                      <button
                        onClick={() => { setActiveClient(null); setNd({ client_id: c.id, client: `${c.first_name} ${c.last_name}`, client_email: c.email, client_phone: c.phone, type: CLIENT_TYPE_TO_DEAL[c.type] || 'Buyer Purchase', property: '', value: 0, notes: '' }); setShowAddDeal(true); }}
                        style={{ fontSize: 12, color: '#c9922c', background: 'none', border: '1px dashed #c9922c', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                        + Create Deal
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {clientDeals.map(d => (
                        <button key={d.id} onClick={() => { setActiveClient(null); openDeal(d); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                          <span style={{ ...Object.fromEntries((TYPE_COLORS[d.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, flexShrink: 0 } as React.CSSProperties}>
                            {d.type.split(' ')[0]}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#111', flex: 1 }}>{d.property || `${c.first_name}'s deal`}</span>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600, ...({ 'Prospect': { background: '#f3f4f6', color: '#6b7280' }, 'Active': { background: '#dbeafe', color: '#1e40af' }, 'In Contract': { background: '#fef3c7', color: '#92400e' }, 'Closed': { background: '#dcfce7', color: '#166534' }, 'Lost': { background: '#fee2e2', color: '#991b1b' } }[d.stage] ?? {}) } as React.CSSProperties}>
                            {d.stage}
                          </span>
                          {d.value > 0 && <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>{fmtVal(d)}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Activity Log */}
                <div>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>Activity Log</div>

                  {/* Log new activity */}
                  <div style={{ background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>+ Log Touch</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      {(['call', 'email', 'meeting', 'note'] as CRMActivity['type'][]).map(t => (
                        <button key={t} type="button" onClick={() => setNewActivity(a => ({ ...a, type: t }))}
                          style={{ flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '2px solid', fontFamily: "'DM Sans',sans-serif", transition: 'all .12s', borderColor: newActivity.type === t ? '#c9922c' : '#e5e7eb', background: newActivity.type === t ? '#fef3e2' : '#fff', color: newActivity.type === t ? '#92400e' : '#6b7280', textAlign: 'center' }}>
                          <div style={{ fontSize: 14, marginBottom: 2 }}>{activityIcon(t)}</div>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                    <textarea className="crm-input" style={{ minHeight: 54, resize: 'none', fontSize: 12, marginBottom: 8 }}
                      placeholder={newActivity.type === 'call' ? 'Notes from the call…' : newActivity.type === 'email' ? 'Subject / summary…' : newActivity.type === 'meeting' ? 'Meeting outcome…' : 'Add a note…'}
                      value={newActivity.note}
                      onChange={e => setNewActivity(a => ({ ...a, note: e.target.value }))} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="crm-btn crm-btn-gold crm-btn-sm"
                        disabled={activityLoading}
                        onClick={async () => {
                          await logActivity(c.id, newActivity.type, newActivity.note);
                          setNewActivity({ type: 'call', note: '' });
                          showToast('Activity logged');
                        }}>
                        Log {newActivity.type.charAt(0).toUpperCase() + newActivity.type.slice(1)}
                      </button>
                    </div>
                  </div>

                  {/* Activity feed */}
                  {activityLoading ? (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: '#9ca3af', fontSize: 12 }}>Loading…</div>
                  ) : clientActivities.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: '#d1d5db', fontSize: 12 }}>No activity logged yet</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
                      {clientActivities.map((act, i) => {
                        const ta = timeAgo(act.created_at);
                        const agentP = profiles.find(p => p.id === act.agent_id);
                        const agentLabel = agentP ? `${agentP.first_name} ${agentP.last_name}` : profile!.id === act.agent_id ? `${profile!.first_name} ${profile!.last_name}` : 'Agent';
                        return (
                          <div key={act.id} style={{ display: 'flex', gap: 10, paddingBottom: 12 }}>
                            {/* Timeline line */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f3f4f6', border: '2px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{activityIcon(act.type)}</div>
                              {i < clientActivities.length - 1 && <div style={{ width: 2, flex: 1, background: '#f0f0f0', marginTop: 4, minHeight: 12 }} />}
                            </div>
                            {/* Content */}
                            <div style={{ flex: 1, paddingTop: 3, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'capitalize' }}>{act.type.replace('_', ' ')}</span>
                                <span style={{ fontSize: 10, color: '#9ca3af' }}>by {agentLabel}</span>
                                <span style={{ marginLeft: 'auto', fontSize: 10, color: ta.color, fontWeight: 600 }}>{ta.label}</span>
                              </div>
                              {act.note && (
                                <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, background: '#f9fafb', borderRadius: 6, padding: '6px 8px' }}>{act.note}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Meta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, paddingTop: 4, borderTop: '1px solid #f0f0f0', fontSize: 11, color: '#9ca3af' }}>
                  <span>📅 Added {c.created_at?.slice(0, 10)}</span>
                  <span>👤 Owner: {ownerName}</span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  {isAdmin && (
                    <button onClick={() => { setActiveClient(null); deleteClient(c.id, `${c.first_name} ${c.last_name}`); }}
                      style={{ padding: '7px 16px', fontSize: 12, background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                      🗑 Remove
                    </button>
                  )}
                  {(isAdmin || c.agent_id === profile!.id) && (
                    <button onClick={() => openEditClient(c)}
                      style={{ padding: '7px 16px', fontSize: 12, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>
                      ✏️ Edit
                    </button>
                  )}
                  <button onClick={() => setActiveClient(null)}
                    style={{ padding: '7px 20px', fontSize: 12, background: '#111', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Edit Client Modal ── */}
      {editClient && (
        <div className="overlay" onClick={() => { setEditClient(null); setAssetDropdownOpen(null); }}>
          <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding: '20px 28px', background: '#111', color: '#fff', display: 'flex', alignItems: 'center', borderRadius: '12px 12px 0 0', flexShrink: 0 }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600 }}>Edit Contact</h3>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>{editClient.first_name} {editClient.last_name}</div>
              </div>
              <button onClick={() => setEditClient(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            {/* Scrollable body */}
            <div style={{ padding: '24px 28px', overflowY: 'auto', maxHeight: 'calc(90vh - 130px)' }}>

              {/* ── Contact Type ── */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>Contact Type *</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                  {CLIENT_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setEc({ ...ec, type: t })}
                      style={{
                        padding: '10px 4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                        cursor: 'pointer', border: '2px solid', textAlign: 'center', lineHeight: 1.3,
                        borderColor: ec.type === t ? '#c9922c' : '#e5e7eb',
                        background: ec.type === t ? '#fef3e2' : '#f9fafb',
                        color: ec.type === t ? '#92400e' : '#6b7280',
                        transition: 'all .15s', fontFamily: "'DM Sans',sans-serif",
                      }}>
                      <div style={{ fontSize: 18, marginBottom: 4 }}>{t === 'Buyer' ? '🏡' : t === 'Seller' ? '🪧' : t === 'Tenant' ? '🔑' : t === 'Landlord/Investor' ? '🏢' : t === 'Agent' ? '🤝' : '🏛'}</div>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Identity ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Identity</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>First Name *</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.first_name} onChange={e => setEc({ ...ec, first_name: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Last Name</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.last_name} onChange={e => setEc({ ...ec, last_name: e.target.value })} />
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>
                      {ec.type === 'Agent' || ec.type === 'Broker' ? 'Business / Brokerage Name' : 'Business Name'} <span style={{ color: '#d1d5db', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder={ec.type === 'Agent' || ec.type === 'Broker' ? 'Century 21, Keller Williams…' : 'Company or business name'} value={ec.business_name} onChange={e => setEc({ ...ec, business_name: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* ── Contact Info ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Contact Info</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                  {/* ── Email(s) ── */}
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>
                        Email{ec.extra_emails.length > 0 ? 's' : ''}
                        {ec.extra_emails.length > 0 && (
                          <span style={{ marginLeft: 6, background: '#fef3e2', color: '#92400e', borderRadius: 10, padding: '1px 7px', fontSize: 9, fontWeight: 600 }}>
                            {1 + ec.extra_emails.length} addresses
                          </span>
                        )}
                      </label>
                      <button
                        type="button"
                        onClick={() => setEc({ ...ec, extra_emails: [...ec.extra_emails, ''] })}
                        style={{ background: 'none', border: 'none', color: '#c9922c', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        + Add Email
                      </button>
                    </div>

                    {/* Primary email */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: ec.extra_emails.length > 0 ? 6 : 0 }}>
                      <div style={{ position: 'relative', flex: 1 }}>
                        <input
                          className="crm-input"
                          type="email"
                          style={{ marginTop: 0, paddingRight: 60 }}
                          value={ec.email}
                          onChange={e => setEc({ ...ec, email: e.target.value })}
                          placeholder="primary@email.com"
                        />
                        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: '#16a34a', fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', pointerEvents: 'none' }}>Primary</span>
                      </div>
                    </div>

                    {/* Extra emails */}
                    {ec.extra_emails.map((email, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <input
                          className="crm-input"
                          type="email"
                          style={{ marginTop: 0, flex: 1 }}
                          value={email}
                          onChange={e => {
                            const updated = [...ec.extra_emails];
                            updated[idx] = e.target.value;
                            setEc({ ...ec, extra_emails: updated });
                          }}
                          placeholder={`additional${idx + 1}@email.com`}
                          autoFocus={email === ''}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = ec.extra_emails.filter((_, i) => i !== idx);
                            setEc({ ...ec, extra_emails: updated });
                          }}
                          title="Remove this email"
                          style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, color: '#ef4444', fontSize: 14, cursor: 'pointer', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                        >✕</button>
                      </div>
                    ))}
                  </div>

                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Phone</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.phone} onChange={e => setEc({ ...ec, phone: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Cell Phone</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.cell_phone} onChange={e => setEc({ ...ec, cell_phone: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* ── Property Preferences (non-Agent/Broker) ── */}
              {(ec.type !== 'Agent' && ec.type !== 'Broker') && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Property Preferences</div>
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                  </div>
                  <div style={{ marginBottom: 12, position: 'relative' }}>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500, display: 'block', marginBottom: 4 }}>Asset Type(s)</label>
                    <button type="button"
                      onClick={e => { e.stopPropagation(); setAssetDropdownOpen(assetDropdownOpen === 'ec' ? null : 'ec'); }}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: ec.asset_types.length ? '#111' : '#9ca3af' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ec.asset_types.length === 0 ? 'Select asset type(s)…' : ec.asset_types.join(', ')}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{assetDropdownOpen === 'ec' ? '▲' : '▼'}</span>
                    </button>
                    {assetDropdownOpen === 'ec' && (
                      <div onClick={e => e.stopPropagation()}
                        style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '6px 0', marginTop: 4 }}>
                        <div style={{ padding: '4px 12px 6px', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>Select all that apply</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: '0 6px 6px' }}>
                          {ASSET_TYPES.map(at => {
                            const checked = ec.asset_types.includes(at);
                            return (
                              <label key={at} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? '#fef3e2' : 'transparent', transition: 'background .1s' }}>
                                <input type="checkbox" checked={checked} onChange={() => {
                                  const next = checked ? ec.asset_types.filter(x => x !== at) : [...ec.asset_types, at];
                                  setEc({ ...ec, asset_types: next });
                                }} style={{ accentColor: '#c9922c', width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }} />
                                <span style={{ fontSize: 12, fontWeight: checked ? 600 : 400, color: checked ? '#92400e' : '#374151' }}>{at}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '6px 12px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>{ec.asset_types.length} selected</span>
                          <button onClick={() => setAssetDropdownOpen(null)} style={{ background: 'none', border: 'none', fontSize: 11, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Done</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Budget / Price Range</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="$400k – $500k" value={ec.budget} onChange={e => setEc({ ...ec, budget: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Size Range (Sq Ft)</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="1,500 – 2,500 sqft" value={ec.size_range} onChange={e => setEc({ ...ec, size_range: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Professional (Agent/Broker) ── */}
              {(ec.type === 'Agent' || ec.type === 'Broker') && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Professional</div>
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Brokerage</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="Century 21, KW…" value={ec.brokerage} onChange={e => setEc({ ...ec, brokerage: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>License #</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="TX-0000000" value={ec.license} onChange={e => setEc({ ...ec, license: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Location ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Location</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Street Address</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.address} onChange={e => setEc({ ...ec, address: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>City</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.city} onChange={e => setEc({ ...ec, city: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>State</label>
                      <input className="crm-input" style={{ marginTop: 4 }} value={ec.state} onChange={e => setEc({ ...ec, state: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>ZIP</label>
                      <input className="crm-input" style={{ marginTop: 4 }} value={ec.zip} onChange={e => setEc({ ...ec, zip: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Notes ── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Notes</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <textarea className="crm-input" style={{ minHeight: 70, resize: 'vertical' }}
                  placeholder={ec.type === 'Agent' || ec.type === 'Broker' ? 'Co-op deals, referral history, relationship notes…' : 'Pre-approval status, timeline, special requirements…'}
                  value={ec.notes} onChange={e => setEc({ ...ec, notes: e.target.value })} />
              </div>
            </div>

            {/* Sticky footer */}
            <div style={{ padding: '16px 28px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 10, justifyContent: 'flex-end', background: '#fff', borderRadius: '0 0 12px 12px', flexShrink: 0 }}>
              <button className="crm-btn crm-btn-ghost" onClick={() => setEditClient(null)}>Cancel</button>
              <button className="crm-btn crm-btn-gold" onClick={saveEditClient} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 26, right: 26, background: '#111', color: '#fff', padding: '12px 20px', borderRadius: 8, fontSize: 13, zIndex: 9999, borderLeft: '4px solid #c9922c', maxWidth: 300, boxShadow: '0 4px 20px rgba(0,0,0,.3)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
