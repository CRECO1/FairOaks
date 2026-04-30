'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient, Session } from '@supabase/supabase-js';

// Invite flow is now handled by /crm/setup — this page is login only.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

// ── Types ─────────────────────────────────────────────────────────────────────
type Role = 'admin' | 'agent';
interface Profile { id: string; email: string; first_name: string; last_name: string; phone?: string; license?: string; role: Role; last_sign_in_at?: string; }
interface Deal { id: string; client: string; client_email: string; client_phone: string; type: string; property: string; value: number; agent_id: string; stage: string; notes: string; created_at: string; last_touch: string; emails?: DealEmail[]; }
interface DealEmail { id: string; deal_id: string; direction: 'sent' | 'received'; from_email: string; to_email: string; subject: string; body: string; email_date: string; }
interface CalendarEvent { id: string; title: string; description: string | null; location: string | null; start: string | null; end: string | null; allDay: boolean; attendees: { email: string; name: string | null; self: boolean }[]; htmlLink: string | null; status: string; }

const STAGES = ['Prospect', 'Active', 'In Contract', 'Closed', 'Lost'];
const DEAL_TYPES = ['Buyer Purchase', 'Tenant Lease', 'Seller Listing', 'Landlord Listing'];
const TYPE_COLORS: Record<string, string> = {
  'Buyer Purchase': 'background:#dbeafe;color:#1e4d8c',
  'Tenant Lease': 'background:#d1fae5;color:#2d5a3d',
  'Seller Listing': 'background:#fed7aa;color:#7c3d11',
  'Landlord Listing': 'background:#ede9fe;color:#4a1d6e',
};
const STAGE_CLS: Record<string, string> = {
  'Prospect': 'bg-gray-100 text-gray-600',
  'Active': 'bg-blue-100 text-blue-700',
  'In Contract': 'bg-amber-100 text-amber-700',
  'Closed': 'bg-green-100 text-green-700',
  'Lost': 'bg-red-100 text-red-700',
};

function today() { return new Date().toISOString().slice(0, 10); }
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
  const [page, setPage] = useState<'dashboard' | 'deals' | 'contacts' | 'agents' | 'calendar' | 'invite'>('dashboard');
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [dealEmails, setDealEmails] = useState<DealEmail[]>([]);
  const [dealTab, setDealTab] = useState<'overview' | 'client' | 'emails'>('overview');
  const [toast, setToast] = useState('');
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [saving, setSaving] = useState(false);

  // Kanban drag state
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // Gmail connection state
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');
  const [gmailAccounts, setGmailAccounts] = useState<{ id: string; email: string }[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Calendar state
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState<'week' | 'month' | 'all'>('month');
  const [calendarScopeError, setCalendarScopeError] = useState(false);
  const [calViewMonth, setCalViewMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [calSelectedDate, setCalSelectedDate] = useState<string | null>(new Date().toDateString());

  // New deal form
  const [nd, setNd] = useState({ client: '', client_email: '', client_phone: '', type: 'Buyer Purchase', property: '', value: 0, notes: '' });
  // Invite form
  const [inv, setInv] = useState({ email: '', first_name: '', last_name: '', phone: '', license: '' });
  // New email form
  const [ne, setNe] = useState({ direction: 'sent' as 'sent' | 'received', subject: '', body: '', email_date: today() });

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

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
    const { data } = await supabase.from('crm_profiles').select('*').eq('id', session.user.id).single();
    if (data) {
      setProfile(data as Profile);
      loadDeals(data as Profile);
      if (data.role === 'admin') loadProfiles();
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
      };
      await supabase.from('crm_profiles').insert([newProfile]);
      setProfile(newProfile);
      loadDeals(newProfile);
      if (newProfile.role === 'admin') loadProfiles();
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
    const { data } = await supabase.from('crm_profiles_extended').select('*').order('last_name');
    setProfiles((data ?? []) as Profile[]);
  }, []);

  const loadDealEmails = useCallback(async (dealId: string) => {
    const { data } = await supabase.from('crm_deal_emails').select('*').eq('deal_id', dealId).order('email_date', { ascending: false });
    setDealEmails((data ?? []) as DealEmail[]);
  }, []);

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

  // ── Deal CRUD ────────────────────────────────────────────────────────────────
  async function createDeal() {
    if (!nd.client.trim()) { showToast('Client name required.'); return; }
    setSaving(true);
    const { error } = await supabase.from('crm_deals').insert([{
      ...nd, agent_id: profile!.id, stage: 'Prospect', last_touch: today(),
    }]);
    if (error) { showToast('Error: ' + error.message); } else {
      showToast('Deal created: ' + nd.client);
      setNd({ client: '', client_email: '', client_phone: '', type: 'Buyer Purchase', property: '', value: 0, notes: '' });
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
    loadDealEmails(deal.id);
  }

  // ── Filtered deals ────────────────────────────────────────────────────────────
  const filteredDeals = deals.filter(d => {
    if (filter && d.type !== filter) return false;
    if (search && !d.client.toLowerCase().includes(search.toLowerCase()) && !d.property?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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
  const initials = (profile.first_name[0] ?? '') + (profile.last_name[0] ?? '');
  const agentName = (id: string) => { const p = profiles.find(x => x.id === id); return p ? `${p.first_name} ${p.last_name}` : profile.id === id ? `${profile.first_name} ${profile.last_name}` : '—'; };

  // ── UI ────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", display: 'flex', height: '100vh', overflow: 'hidden', background: '#f2f2f2' }}>
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
      `}</style>

      {/* Sidebar */}
      <nav style={{ width: 248, background: '#111', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
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
          <button className={`crm-nav${page === 'contacts' ? ' active' : ''}`} onClick={() => setPage('contacts')}>👥 &nbsp;Clients</button>
          {isAdmin && <button className={`crm-nav${page === 'agents' ? ' active' : ''}`} onClick={() => { setPage('agents'); loadProfiles(); }}>🤝 &nbsp;Agents</button>}
        </div>
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', padding: '0 8px', marginBottom: 6 }}>Tools</div>
          <button className={`crm-nav${page === 'calendar' ? ' active' : ''}`} onClick={() => { setPage('calendar'); loadCalendarEvents(calendarFilter === 'week' ? 7 : calendarFilter === 'month' ? 30 : 90); }}>📅 &nbsp;Calendar</button>
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
      </nav>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '13px 26px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, flex: 1 }}>
            {page === 'dashboard' ? 'Dashboard' : page === 'deals' ? (filter || 'Deal Flow') : page === 'contacts' ? 'Clients' : page === 'agents' ? 'Agents' : page === 'calendar' ? 'Calendar' : 'Invite Agent'}
          </h2>
          {(page === 'deals' || page === 'contacts') && <button className="crm-btn crm-btn-gold" onClick={() => setShowAddDeal(true)}>+ New Deal</button>}
          {page === 'agents' && isAdmin && <button className="crm-btn crm-btn-gold" onClick={() => setShowInvite(true)}>+ Invite Agent</button>}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: page === 'calendar' ? 'hidden' : 'auto', padding: page === 'calendar' ? 0 : 26 }}>

          {/* ── Dashboard ── */}
          {page === 'dashboard' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 26 }}>
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

          {/* ── Contacts ── */}
          {page === 'contacts' && (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Phone</th><th>Property</th>{isAdmin && <th>Agent</th>}<th></th></tr></thead>
                <tbody>
                  {deals.map(d => (
                    <tr key={d.id}>
                      <td><strong>{d.client}</strong></td>
                      <td><span style={{ ...Object.fromEntries((TYPE_COLORS[d.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 } as React.CSSProperties}>{d.type.split(' ')[0]}</span></td>
                      <td style={{ fontSize: 12 }}>{d.client_email || '—'}</td>
                      <td style={{ fontSize: 12 }}>{d.client_phone || '—'}</td>
                      <td style={{ fontSize: 12 }}>{d.property || '—'}</td>
                      {isAdmin && <td style={{ fontSize: 12 }}>{agentName(d.agent_id)}</td>}
                      <td><button style={{ background: 'none', border: 'none', color: '#111', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => openDeal(d)}>Open Deal</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => resetAgentPassword(a.email, a.first_name)}
                        style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                        🔑 Reset Password
                      </button>
                      {a.role !== 'admin' && (
                        <button
                          onClick={() => deleteAgent(a.id, a.first_name, a.last_name)}
                          style={{ padding: '7px 10px', fontSize: 12, fontWeight: 600, background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {profiles.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: '#9ca3af' }}>No agents yet. Invite one above.</div>}
            </div>
          )}
        </div>
      </div>

      {/* ── Deal Modal ── */}
      {activeDeal && (
        <div className="overlay" onClick={() => setActiveDeal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 26px', background: '#111', color: '#fff', display: 'flex', alignItems: 'center', gap: 12, borderRadius: '12px 12px 0 0' }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600, flex: 1 }}>{activeDeal.client}</h3>
              <span style={{ ...Object.fromEntries((TYPE_COLORS[activeDeal.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 } as React.CSSProperties}>{activeDeal.type}</span>
              <button onClick={() => setActiveDeal(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: '20px 26px' }}>
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
                {(['overview', 'client', 'emails'] as const).map(t => (
                  <button key={t} onClick={() => setDealTab(t)}
                    style={{ padding: '8px 18px', fontSize: 13, cursor: 'pointer', background: 'none', border: 'none', color: dealTab === t ? '#111' : '#6b7280', borderBottom: dealTab === t ? '2px solid #c9922c' : '2px solid transparent', marginBottom: -2, fontFamily: "'DM Sans',sans-serif", fontWeight: dealTab === t ? 500 : 400, textTransform: 'capitalize' }}>
                    {t === 'emails' ? 'Email Log' : t.charAt(0).toUpperCase() + t.slice(1)}
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
                  <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>Created: {activeDeal.created_at?.slice(0, 10)} · Last Touch: {activeDeal.last_touch?.slice(0, 10)}</div>
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                      <span style={{ fontSize: 12, color: '#166534' }}>✉️ Gmail connected — sync emails with {activeDeal.client_email}</span>
                      <button onClick={() => syncGmail(activeDeal)} disabled={syncing}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', opacity: syncing ? 0.7 : 1 }}>
                        {syncing ? 'Syncing…' : '↻ Sync Now'}
                      </button>
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
            </div>
          </div>
        </div>
      )}

      {/* ── Add Deal Modal ── */}
      {showAddDeal && (
        <div className="overlay" onClick={() => setShowAddDeal(false)}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 26px', background: '#111', color: '#fff', display: 'flex', alignItems: 'center', borderRadius: '12px 12px 0 0' }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600, flex: 1 }}>New Deal</h3>
              <button onClick={() => setShowAddDeal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '22px 26px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                {[
                  { label: 'Client Name *', key: 'client', placeholder: 'Full name', type: 'text' },
                  { label: 'Client Email', key: 'client_email', placeholder: 'client@email.com', type: 'email' },
                  { label: 'Client Phone', key: 'client_phone', placeholder: '(555) 000-0000', type: 'text' },
                ].map(f => (
                  <div key={f.key}><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>{f.label}</label>
                    <input className="crm-input" type={f.type} style={{ marginTop: 4 }} placeholder={f.placeholder} value={(nd as Record<string,unknown>)[f.key] as string} onChange={e => setNd({ ...nd, [f.key]: e.target.value })} /></div>
                ))}
                <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Deal Type *</label>
                  <select className="crm-input" style={{ marginTop: 4 }} value={nd.type} onChange={e => setNd({ ...nd, type: e.target.value })}>
                    {DEAL_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Property Address</label><input className="crm-input" style={{ marginTop: 4 }} placeholder="123 Main St, City, State" value={nd.property} onChange={e => setNd({ ...nd, property: e.target.value })} /></div>
                <div><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Deal Value ($)</label><input className="crm-input" type="number" style={{ marginTop: 4 }} value={nd.value} onChange={e => setNd({ ...nd, value: +e.target.value })} /></div>
                <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Notes</label><textarea className="crm-input" style={{ marginTop: 4, minHeight: 70, resize: 'vertical' }} value={nd.notes} onChange={e => setNd({ ...nd, notes: e.target.value })} placeholder="Initial notes…" /></div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="crm-btn crm-btn-ghost" onClick={() => setShowAddDeal(false)}>Cancel</button>
                <button className="crm-btn crm-btn-gold" onClick={createDeal} disabled={saving}>{saving ? 'Creating…' : 'Create Deal'}</button>
              </div>
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

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 26, right: 26, background: '#111', color: '#fff', padding: '12px 20px', borderRadius: 8, fontSize: 13, zIndex: 9999, borderLeft: '4px solid #c9922c', maxWidth: 300, boxShadow: '0 4px 20px rgba(0,0,0,.3)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
