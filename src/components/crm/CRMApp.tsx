'use client';

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Session } from '@supabase/supabase-js';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { sanitizeHtml } from '@/lib/sanitize';
import SocialMediaSection from '@/components/crm/SocialMediaSection';

// Use the SSR browser client so the session is stored in cookies,
// which allows server-side API routes to read it via getCrmUser().
const supabase = createBrowserClient();

// ── Types ─────────────────────────────────────────────────────────────────────
type Role = 'admin' | 'agent';
interface Profile { id: string; email: string; first_name: string; last_name: string; phone?: string; license?: string; role: Role; last_sign_in_at?: string; business_unit?: string; email_signature?: string; }
interface Client { id: string; agent_id: string; assigned_agent_ids: string[]; first_name: string; last_name: string; business_name: string; email: string; extra_emails: string[]; phone: string; cell_phone: string; address: string; city: string; state: string; zip: string; brokerage: string; license: string; budget: string; size_range: string; asset_types: string[]; type: 'Buyer' | 'Seller' | 'Tenant' | 'Landlord/Investor' | 'Agent' | 'Broker'; tags: string[]; lead_source: string; notes: string; created_at: string; last_touched_at?: string; unsubscribed_at?: string | null; unsubscribe_token?: string; lease_expiration_date?: string | null; lxp_follow_up_days?: number | null; review_requested_at?: string | null; birthday?: string | null; is_shared?: boolean; }
interface CRMTask { id: string; client_id: string; agent_id: string; type: 'call' | 'email' | 'follow_up'; title: string; due_date: string; notes: string; completed_at: string | null; created_at: string; }
interface Task { id: string; title: string; description?: string; due_date?: string; assigned_to?: string; client_id?: string; deal_id?: string; status: 'open' | 'in_progress' | 'done'; priority: 'low' | 'normal' | 'high' | 'urgent'; created_by?: string; business_unit: string; created_at: string; updated_at?: string; client?: { id: string; first_name: string; last_name: string; email: string }; assignee?: { id: string; first_name: string; last_name: string }; }
interface SmartList { id: string; created_by: string; name: string; filters: Record<string, any>; is_shared: boolean; created_at: string; }
interface ActionPlan { id: string; created_by: string; name: string; description: string; trigger_type: 'manual' | 'new_contact' | 'stage_change' | 'tag_added'; trigger_value?: string; status: 'active' | 'paused'; steps?: ActionPlanStep[]; step_count?: number; enrollment_count?: number; created_at: string; updated_at: string; }
interface ActionPlanStep { id?: string; plan_id?: string; step_order: number; type: 'email' | 'sms' | 'task' | 'note'; delay_days: number; subject?: string; body: string; }
interface ActionPlanEnrollment { id: string; plan_id: string; client_id: string; current_step: number; next_step_at: string | null; active: boolean; started_at: string; client?: Client; }
interface Deal { id: string; client_id?: string; client: string; client_email: string; client_phone: string; type: string; property: string; value: number; agent_id: string; assigned_agent_ids: string[]; stage: string; notes: string; lost_reason?: string; created_at: string; last_touch: string; emails?: DealEmail[]; }
interface DealEmail { id: string; deal_id: string | null; client_id?: string | null; direction: 'sent' | 'received'; from_email: string; to_email: string; subject: string; body: string; email_date: string; tracking_id?: string; opened_at?: string | null; open_count?: number; gmail_thread_id?: string | null; rfc_message_id?: string | null; }
interface DealDoc { id: string; deal_id: string; name: string; storage_path: string; file_size: number; file_type: string; uploaded_by: string; created_at: string; url?: string; }
interface CalendarEvent { id: string; title: string; description: string | null; location: string | null; start: string | null; end: string | null; allDay: boolean; attendees: { email: string; name: string | null; self: boolean }[]; htmlLink: string | null; status: string; }
interface CRMActivity { id: string; client_id: string; agent_id: string; type: 'call' | 'email' | 'meeting' | 'note' | 'deal_update'; note: string; created_at: string; }
interface Campaign { id: string; created_by: string; name: string; description: string; type: 'email' | 'sms'; frequency: 'monthly' | 'quarterly' | 'semi-annual' | 'annual' | 'one-time'; send_date?: string; send_time?: string; send_day_of_month?: number | null; status: 'draft' | 'active' | 'paused' | 'completed'; email_subject?: string; email_body?: string; sms_body?: string; created_at: string; updated_at: string; enrollment_count?: number; last_sent_at?: string | null; sender_agent_id?: string | null; }
interface CampaignEnrollment { id: string; campaign_id: string; client_id: string; enrolled_at: string; next_send_at: string | null; active: boolean; client?: Client; }
interface CampaignSend { id: string; campaign_id: string; client_id: string; type: 'email' | 'sms'; status: 'sent' | 'failed' | 'skipped'; sent_at: string; subject?: string; body_preview?: string; tracking_id?: string | null; opened_at?: string | null; open_count?: number | null; }
interface Commission { id: string; deal_id: string; agent_id?: string; business_unit: string; sale_price: number; deal_type?: string; commission_rate: number; gross_commission: number; agent_split: number; agent_net: number; brokerage_net: number; referral_fee: number; referral_to?: string; transaction_fee: number; status: 'pending' | 'paid' | 'disputed'; close_date?: string; paid_date?: string; notes?: string; created_at: string; deal?: { id: string; client: string; property: string; type: string }; agent?: { id: string; first_name: string; last_name: string }; }

const LEAD_SOURCES = ['Zillow', 'Realtor.com', 'Crexi', 'Referral', 'Website', 'Social Media', 'Open House', 'Sign Call', 'Cold Call', 'Direct Mail', 'Other'];
const STAGES = ['Prospect', 'Active', 'LOI', 'In Contract', 'Closed', 'Lost'];
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
  'LOI': 'bg-purple-100 text-purple-700',
  'In Contract': 'bg-amber-100 text-amber-700',
  'Closed': 'bg-green-100 text-green-700',
  'Lost': 'bg-red-100 text-red-700',
};

function today() { return new Date().toISOString().slice(0, 10); }

function emailDisplayName(addr: string): string {
  const m = addr.match(/^"?(.+?)"?\s*<[^>]+>/);
  return m ? m[1].trim() : addr.split('@')[0];
}
function emailInitials(addr: string): string {
  const n = emailDisplayName(addr).split(' ');
  return n.length >= 2 ? (n[0][0] + n[n.length - 1][0]).toUpperCase() : n[0].slice(0, 2).toUpperCase();
}
function emailAvatarColor(addr: string): string {
  const colors = ['#4f46e5','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#db2777','#0284c7'];
  let h = 0; for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function cleanEmailBody(raw: string): string {
  const lines = raw.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('>')) continue;
    if (/^On .{5,120} wrote:$/.test(t)) break;
    if (/^[-_]{3,}/.test(t)) break;
    if (/^CONFIDENTIALITY NOTICE/i.test(t)) break;
    if (/^This (e-?mail|message) (message |communication )?(is intended|may contain)/i.test(t)) break;
    if (/^(Thanks,?|Thank you,?|Best,?|Regards,?|Sincerely,?|Cheers,?)$/i.test(t)) { result.push(line); break; }
    result.push(line);
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function timeAgo(dateStr: string | undefined | null): { label: string; color: string; bg: string } {
  if (!dateStr) return { label: 'Never', color: '#dc2626', bg: '#fee2e2' };
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1)  return { label: 'Today',     color: '#16a34a', bg: '#dcfce7' };
  if (days === 1) return { label: 'Yesterday', color: '#16a34a', bg: '#dcfce7' };
  if (days < 14) return { label: `${days}d ago`, color: '#16a34a', bg: '#dcfce7' };
  if (days < 30) return { label: `${days}d ago`, color: '#d97706', bg: '#fef9c3' };
  if (days < 60) return { label: `${days}d ago`, color: '#a16207', bg: '#fef9c3' };
  if (days < 90) return { label: `${days}d ago`, color: '#c2410c', bg: '#fed7aa' };
  return { label: `${days}d ago`, color: '#dc2626', bg: '#fee2e2' };
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
  'LOI':         { bg: '#faf5ff', border: '#e9d5ff', dot: '#a855f7' },
  'In Contract': { bg: '#fffbeb', border: '#fde68a', dot: '#f59e0b' },
  'Closed':      { bg: '#f0fdf4', border: '#bbf7d0', dot: '#22c55e' },
  'Lost':        { bg: '#fef2f2', border: '#fecaca', dot: '#ef4444' },
};

function KanbanBoard({ deals, isAdmin, agentName, draggedDealId, dragOverStage, setDraggedDealId, setDragOverStage, handleDrop, openDeal, isMobile, onAddDeal }: {
  deals: Deal[]; isAdmin: boolean; agentName: (id: string) => string;
  draggedDealId: string | null; dragOverStage: string | null;
  setDraggedDealId: (id: string | null) => void; setDragOverStage: (s: string | null) => void;
  handleDrop: (stage: string) => void; openDeal: (deal: Deal) => void;
  isMobile: boolean; onAddDeal?: () => void;
}) {
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {STAGES.map(stage => {
          const col = STAGE_COLORS[stage];
          const stageDeals = deals.filter(d => d.stage === stage);
          if (stageDeals.length === 0) return null;
          return (
            <div key={stage}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.dot, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#374151', textTransform: 'uppercase', letterSpacing: 1 }}>{stage}</span>
                <span style={{ background: '#e5e7eb', borderRadius: 10, padding: '1px 7px', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>{stageDeals.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stageDeals.map(deal => (
                  <div key={deal.id} onClick={() => openDeal(deal)}
                    style={{ background: '#fff', border: `1px solid ${col.border}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#111', marginBottom: 4 }}>{deal.client}</div>
                    {deal.property && <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{deal.property}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ ...Object.fromEntries((TYPE_COLORS[deal.type] || '').split(';').map((s: string) => s.split(':'))), display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 } as React.CSSProperties}>
                        {deal.type.split(' ')[0]}
                      </span>
                      {deal.value > 0 && <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>{fmtVal(deal)}</span>}
                      {isAdmin && <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>👤 {agentName(deal.agent_id)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {deals.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af', fontSize: 14 }}>No deals yet</div>
        )}
      </div>
    );
  }

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
                <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{stage}</span>
                <span style={{ marginLeft: 'auto', background: '#e5e7eb', borderRadius: 10, padding: '1px 8px', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>{stageDeals.length}</span>
              </div>
              {totalVal > 0 && (
                <div style={{ fontSize: 12, color: '#6b7280', paddingLeft: 18 }}>
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
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#111', marginBottom: 5 }}>{deal.client}</div>
                  {deal.property && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.property}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ ...Object.fromEntries((TYPE_COLORS[deal.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600 } as React.CSSProperties}>
                      {deal.type.split(' ')[0]}
                    </span>
                    {deal.value > 0 && (
                      <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>{fmtVal(deal)}</span>
                    )}
                    {deal.value > 0 && (() => {
                      const gci = deal.value * 0.03;
                      const gciStr = gci >= 1000000 ? `$${(gci/1000000).toFixed(2)}M` : gci >= 1000 ? `$${Math.round(gci/1000)}k` : `$${Math.round(gci)}`;
                      return <span style={{ fontSize: 11, color: '#c9922c', fontWeight: 700 }}>{gciStr} GCI</span>;
                    })()}
                  </div>
                  {isAdmin && (
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 5 }}>👤 {agentName(deal.agent_id)}</div>
                  )}
                </div>
              ))}
              {stageDeals.length === 0 && (
                <div style={{ textAlign: 'center', padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 22, opacity: 0.25 }}>📋</div>
                  <div style={{ fontSize: 13, color: '#d1d5db', fontWeight: 500 }}>No deals here</div>
                  {onAddDeal && (
                    <button onClick={onAddDeal} style={{ fontSize: 12, color: '#c9922c', background: 'none', border: '1px dashed #fde68a', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, marginTop: 2 }}>
                      + Add Deal
                    </button>
                  )}
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
function LoginScreen({ onLogin, brandName }: { onLogin: (s: Session) => void; brandName: string }) {
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
  const labelStyle: React.CSSProperties = { fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, marginTop: 4, marginBottom: 14, boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" };

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
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: '#c9922c', marginBottom: 4 }}>{brandName}</div>
        <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>Agent CRM — Sign In</div>
        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 14, marginBottom: 14 }}>{error}</div>}
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
type BusinessUnit = 'residential' | 'commercial';

const BRANDING: Record<BusinessUnit, { name: string; shortName: string; tagline: string }> = {
  residential: { name: 'Fair Oaks Realty Group', shortName: 'Fair Oaks', tagline: 'Residential CRM' },
  commercial:  { name: 'CRECO',                  shortName: 'CRECO',      tagline: 'Commercial CRM'  },
};

export default function CRMApp({ businessUnit }: { businessUnit: BusinessUnit }) {
  const brand = BRANDING[businessUnit];
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const VALID_PAGES = ['dashboard', 'prospects', 'deals', 'contacts', 'agents', 'calendar', 'invite', 'campaigns', 'action-plans', 'tasks', 'commissions', 'social'] as const;
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
  const [contactEmails, setContactEmails] = useState<DealEmail[]>([]);
  const [contactEmailsLoading, setContactEmailsLoading] = useState(false);
  const [showContactCompose, setShowContactCompose] = useState(false);
  const [replyToContactEmail, setReplyToContactEmail] = useState<DealEmail | null>(null);
  const [dealDocs, setDealDocs] = useState<DealDoc[]>([]);
  const [docUploading, setDocUploading] = useState(false);
  const [dealTab, setDealTab] = useState<'overview' | 'client' | 'emails' | 'docs' | 'intel' | 'commission'>('overview');
  const [dealCommission, setDealCommission] = useState<Commission | null>(null);
  const [commissionLoading, setCommissionLoading] = useState(false);
  const [commissionSaving, setCommissionSaving] = useState(false);
  const [allCommissions, setAllCommissions] = useState<Commission[]>([]);
  const [commissionForm, setCommissionForm] = useState({ sale_price: '', commission_rate: '3', agent_split: '70', referral_fee: '0', referral_to: '', transaction_fee: '0', status: 'pending' as Commission['status'], close_date: '', paid_date: '', notes: '' });
  const [commissionFilterYear, setCommissionFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [commissionFilterAgent, setCommissionFilterAgent] = useState<string>('');
  const [commissionFilterStatus, setCommissionFilterStatus] = useState<string>('');
  const [commissionView, setCommissionView] = useState<'list' | '1099'>('list');
  const [commission1099Year, setCommission1099Year] = useState<string>(String(new Date().getFullYear() - 1));
  const [propIntel, setPropIntel] = useState<{ detail: any; comps: any[]; error?: string } | null>(null);
  const [propIntelLoading, setPropIntelLoading] = useState(false);
  const emailEditorRef = useRef<HTMLDivElement>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [editTagsClientId, setEditTagsClientId] = useState<string | null>(null);
  const [inlineTagInput, setInlineTagInput] = useState('');
  const [showDealAgentPicker, setShowDealAgentPicker] = useState(false);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState('');
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [ec, setEc] = useState({ first_name: '', last_name: '', business_name: '', email: '', extra_emails: [] as string[], phone: '', cell_phone: '', address: '', city: '', state: '', zip: '', brokerage: '', license: '', budget: '', size_range: '', asset_types: [] as string[], type: 'Buyer' as Client['type'], tags: [] as string[], lead_source: '', notes: '', lease_expiration_date: '', lxp_follow_up_days: null as number | null, birthday: '' });
  const [assetDropdownOpen, setAssetDropdownOpen] = useState<'nc' | 'ec' | null>(null);
  const [saving, setSaving] = useState(false);
  // Tasks
  const [allTasks, setAllTasks] = useState<CRMTask[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskClientId, setTaskClientId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<{ type: 'call'|'email'|'follow_up'; title: string; due_date: string; notes: string }>({ type: 'follow_up', title: '', due_date: '', notes: '' });

  // Kanban drag state
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // Gmail connection state
  const [gmailConnected, setGmailConnected] = useState(false);
  const [showGmailInput, setShowGmailInput] = useState(false);
  const [gmailInputValue, setGmailInputValue] = useState('');
  const [gmailAccounts, setGmailAccounts] = useState<{ id: string; email: string }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [mlsSyncing, setMlsSyncing] = useState(false);

  // Compose state
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeSending, setComposeSending] = useState(false);
  const [replyToEmail, setReplyToEmail] = useState<DealEmail | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [expandedContactThreads, setExpandedContactThreads] = useState<Set<string>>(new Set());
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const contactAttachInputRef = useRef<HTMLInputElement>(null);
  const composeBodyRef = useRef<HTMLDivElement>(null);
  const contactComposeBodyRef = useRef<HTMLDivElement>(null);

  function clearComposeBody() {
    if (composeBodyRef.current) composeBodyRef.current.innerHTML = '';
  }
  function clearContactComposeBody() {
    if (contactComposeBodyRef.current) contactComposeBodyRef.current.innerHTML = '';
  }
  function richCmd(cmd: string, value?: string) {
    composeBodyRef.current?.focus();
    document.execCommand(cmd, false, value);
  }
  function richCmdContact(cmd: string, value?: string) {
    contactComposeBodyRef.current?.focus();
    document.execCommand(cmd, false, value);
  }

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
  const [prospects, setProspects] = useState<any[]>([]);
  const [prospectsLoading, setProspectsLoading] = useState(false);
  const [prospectStatusFilter, setProspectStatusFilter] = useState<string>('new');
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [campaignView, setCampaignView] = useState<'list' | 'builder' | 'detail'>('list');
  const [campaignTab, setCampaignTab] = useState<'enrolled' | 'history' | 'preview' | 'settings'>('enrolled');
  const [campaignEnrollments, setCampaignEnrollments] = useState<CampaignEnrollment[]>([]);
  const [campaignEnrollmentsLoading, setCampaignEnrollmentsLoading] = useState(false);
  const [campaignSends, setCampaignSends] = useState<CampaignSend[]>([]);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignActivating, setCampaignActivating] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [newCampaign, setNewCampaign] = useState<{ name: string; description: string; type: 'email' | 'sms'; frequency: string; send_date: string; send_time: string; send_day_of_month: string; status: string; email_subject: string; email_body: string; sms_body: string; sender_agent_id: string }>({ name: '', description: '', type: 'email', frequency: 'monthly', send_date: '', send_time: '08:00', send_day_of_month: '', status: 'draft', email_subject: '', email_body: '', sms_body: '', sender_agent_id: '' });
  const [enrollClientSearch, setEnrollClientSearch] = useState('');
  const [selectedEnrollIds, setSelectedEnrollIds] = useState<string[]>([]);
  const [enrollTypeFilter, setEnrollTypeFilter] = useState('');
  const [enrollAssetFilter, setEnrollAssetFilter] = useState('');
  const [enrollTagFilter, setEnrollTagFilter] = useState('');

  // Smart Lists & Contact Filters
  const [smartLists, setSmartLists] = useState<SmartList[]>([]);
  const [contactTypeFilter, setContactTypeFilter] = useState('');
  const [contactTagFilter, setContactTagFilter] = useState('');
  const [contactSourceFilter, setContactSourceFilter] = useState('');
  const [contactSpecFilter, setContactSpecFilter] = useState('');
  const [contactOwnerFilter, setContactOwnerFilter] = useState('');
  const [contactSort, setContactSort] = useState<'recent' | 'never' | 'az' | 'added'>('recent');
  const [emailEditorMode, setEmailEditorMode] = useState<'rich' | 'html'>('rich');
  const [showSaveList, setShowSaveList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [tagInput, setTagInput] = useState(''); // for tag input in add/edit forms

  // Follow-Up Report
  const [followUpDays, setFollowUpDays] = useState(30);
  const [followUpTypeFilter, setFollowUpTypeFilter] = useState('');

  // Agent filters for campaigns + action plans
  const [campaignAgentFilter, setCampaignAgentFilter] = useState<string | null>(null);
  const [actionPlanAgentFilter, setActionPlanAgentFilter] = useState<string | null>(null);
  // Inline owner editing on list cards
  const [inlineOwnerPlanId, setInlineOwnerPlanId] = useState<string | null>(null);
  const [inlineOwnerCampaignId, setInlineOwnerCampaignId] = useState<string | null>(null);

  // Action Plans
  const [actionPlans, setActionPlans] = useState<ActionPlan[]>([]);
  const [activeActionPlan, setActiveActionPlan] = useState<ActionPlan | null>(null);
  const [actionPlanView, setActionPlanView] = useState<'list' | 'builder' | 'detail'>('list');
  const [actionPlanTab, setActionPlanTab] = useState<'enrolled' | 'history' | 'preview' | 'settings'>('enrolled');
  const [actionPlanEnrollments, setActionPlanEnrollments] = useState<ActionPlanEnrollment[]>([]);
  const [actionPlanLoading, setActionPlanLoading] = useState(false);
  const [planSteps, setPlanSteps] = useState<ActionPlanStep[]>([]);
  const [detailSteps, setDetailSteps] = useState<ActionPlanStep[]>([]);
  const [previewStepIdx, setPreviewStepIdx] = useState(0);
  const [newPlan, setNewPlan] = useState({ name: '', description: '', trigger_type: 'manual' as ActionPlan['trigger_type'], trigger_value: '', status: 'active' as 'active' | 'paused', completion_campaign_id: '' });
  const [selectedPlanEnrollIds, setSelectedPlanEnrollIds] = useState<string[]>([]);
  const [planEnrollSearch, setPlanEnrollSearch] = useState('');
  const [planEnrollTypeFilter, setPlanEnrollTypeFilter] = useState('');
  const [planEnrollAssetFilter, setPlanEnrollAssetFilter] = useState('');
  const [planEnrollTagFilter, setPlanEnrollTagFilter] = useState('');

  // Activity Report
  const [activityReport, setActivityReport] = useState<{ agent_id: string; name: string; calls: number; emails: number; meetings: number; notes: number; total: number }[]>([]);
  const [activityReportDays, setActivityReportDays] = useState(30);
  const [activityReportLoading, setActivityReportLoading] = useState(false);

  // Global search (⌘K)
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Notification center
  const [showNotifications, setShowNotifications] = useState(false);

  // Email preview
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  async function sendCampaignTestEmail() {
    if (!session?.access_token) return;
    setSendingTestEmail(true);
    try {
      const res = await fetch('/api/campaigns/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ subject: newCampaign.email_subject, body: newCampaign.email_body, campaignName: newCampaign.name }),
      });
      const data = await res.json();
      if (res.ok) showToast(`✅ Test email sent to ${data.sentTo}`);
      else showToast('Error: ' + (data.error ?? 'Failed to send'));
    } catch { showToast('Failed to send test email'); }
    finally { setSendingTestEmail(false); }
  }

  // Closed deal enrollment prompt
  const [closedDealPrompt, setClosedDealPrompt] = useState<Deal | null>(null);
  const [closedEnrollPlanIds, setClosedEnrollPlanIds] = useState<string[]>([]);
  const [closedEnrollCampaignIds, setClosedEnrollCampaignIds] = useState<string[]>([]);
  const [closedEnrolling, setClosedEnrolling] = useState(false);

  // Action plan step preview tabs (idx → 'code' | 'preview')
  const [stepViewMode, setStepViewMode] = useState<Record<number, 'code' | 'preview'>>({});

  // Lost deal reason prompt
  const [lostDealPrompt, setLostDealPrompt] = useState<Deal | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [lostReasonOther, setLostReasonOther] = useState('');
  const [lostSaving, setLostSaving] = useState(false);

  // Bulk unenroll
  const [selectedUnenrollIds, setSelectedUnenrollIds] = useState<string[]>([]);

  // Bulk reassign contacts
  const [showBulkReassign, setShowBulkReassign] = useState(false);
  const [bulkReassignTarget, setBulkReassignTarget] = useState('');
  const [bulkReassigning, setBulkReassigning] = useState(false);

  // Campaign completed filter
  const [campaignFilter, setCampaignFilter] = useState<'all' | 'active' | 'draft' | 'paused' | 'completed'>('all');

  // Action plan test send
  const [testSending, setTestSending] = useState(false);

  // Agent profile editing
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editAgentForm, setEditAgentForm] = useState({ first_name: '', last_name: '', email: '', phone: '', license: '', business_unit: 'residential' });
  const [editAgentSaving, setEditAgentSaving] = useState(false);

  // Task Manager (full Tasks page)
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'done'>('open');
  const [taskPriorityFilter, setTaskPriorityFilter] = useState('');
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState('');
  const [taskSearchStr, setTaskSearchStr] = useState('');
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newTaskForm, setNewTaskForm] = useState({ title: '', description: '', due_date: '', assigned_to: '', client_id: '', priority: 'normal' as Task['priority'], status: 'open' as Task['status'] });

  // Bulk enroll in campaign
  const [showBulkEnrollModal, setShowBulkEnrollModal] = useState(false);
  const [bulkEnrollCampaignId, setBulkEnrollCampaignId] = useState('');
  const [bulkEnrolling, setBulkEnrolling] = useState(false);

  // New deal form
  const [nd, setNd] = useState({ client_id: '', client: '', client_email: '', client_phone: '', type: 'Buyer Purchase', property: '', value: 0, notes: '' });
  // New client form
  const [nc, setNc] = useState({ first_name: '', last_name: '', business_name: '', email: '', phone: '', cell_phone: '', address: '', city: '', state: '', zip: '', brokerage: '', license: '', budget: '', size_range: '', asset_types: [] as string[], type: 'Buyer' as Client['type'], tags: [] as string[], lead_source: '', notes: '', lease_expiration_date: '', lxp_follow_up_days: null as number | null, birthday: '' });
  // Invite form
  const [inv, setInv] = useState({ email: '', first_name: '', last_name: '', phone: '', license: '' });
  // New email form
  const [ne, setNe] = useState({ direction: 'sent' as 'sent' | 'received', subject: '', body: '', email_date: today() });

  // Activity tracking
  const [clientActivities, setClientActivities] = useState<CRMActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [newActivity, setNewActivity] = useState<{ type: CRMActivity['type']; note: string }>({ type: 'call', note: '' });
  const [clientCampaignSends, setClientCampaignSends] = useState<(CampaignSend & { campaign_name?: string })[]>([]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // Load activities + campaign sends + emails whenever client modal opens/closes
  useEffect(() => {
    if (activeClient) {
      loadClientActivities(activeClient.id);
      loadClientCampaignSends(activeClient.id);
      loadContactEmails(activeClient.id);
      setNewActivity({ type: 'call', note: '' });
      setShowContactCompose(false);
      setReplyToContactEmail(null);
    } else {
      setClientActivities([]);
      setClientCampaignSends([]);
      setContactEmails([]);
    }
  }, [activeClient?.id]); // eslint-disable-line

  // Reset to rich mode whenever builder opens
  useEffect(() => {
    if (campaignView === 'builder') setEmailEditorMode('rich');
  }, [campaignView]); // eslint-disable-line

  // Sync editor innerHTML once rich mode + builder are both active
  useLayoutEffect(() => {
    if (campaignView === 'builder' && emailEditorMode === 'rich' && emailEditorRef.current) {
      emailEditorRef.current.innerHTML = newCampaign.email_body ?? '';
    }
  }, [campaignView, emailEditorMode]); // eslint-disable-line

  // Global search keyboard shortcut (⌘K / Ctrl+K) + quick shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(s => !s); setSearchQuery(''); }
      if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); setShowNotifications(false); }
      // Quick nav shortcuts — only when no input/modal is focused
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (!e.metaKey && !e.ctrlKey && !e.altKey && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        if (e.key === '/') { e.preventDefault(); setShowSearch(true); setSearchQuery(''); }
        const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
        if (e.key === 'n' && hash === 'contacts') { e.preventDefault(); setShowAddClient(true); }
        if (e.key === 'c' && hash === 'deals') { e.preventDefault(); setShowAddDeal(true); }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchRef.current?.focus(), 50);
  }, [showSearch]);

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
          setGmailAccounts(d.accounts ?? []);
          // Fetch & save Gmail signature in the background
          fetch(`/api/gmail/signature?userId=${session.user.id}`)
            .then(r => r.json())
            .then(s => {
              if (s.signature !== undefined) {
                setProfile(prev => prev ? { ...prev, email_signature: s.signature } : prev);
              }
            })
            .catch(() => {});
        }
      });
    // Handle OAuth redirect result — re-fetch accounts so new connection shows immediately
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail') === 'connected') {
      const connectedAccount = params.get('account');
      fetch(`/api/gmail/status?userId=${session.user.id}`)
        .then(r => r.json())
        .then(d => {
          if (d.connected) {
            setGmailConnected(true);
            setGmailAccounts(d.accounts ?? []);
            const msg = connectedAccount
              ? `✓ ${connectedAccount} connected`
              : '✓ Gmail account connected';
            setToast(msg);
            setTimeout(() => setToast(''), 4000);
          }
        });
      // Fetch signature after fresh OAuth connect
      fetch(`/api/gmail/signature?userId=${session.user.id}`)
        .then(r => r.json())
        .then(s => { if (s.signature !== undefined) setProfile(prev => prev ? { ...prev, email_signature: s.signature } : prev); })
        .catch(() => {});
      window.history.replaceState({}, '', '/crm');
    }
    if (params.get('gmail') === 'error') {
      const reason = params.get('reason') ?? 'unknown';
      const reasonMessages: Record<string, string> = {
        oauth_denied:     'Authorization was denied. Please try again.',
        invalid_user:     'Session error. Please log out and back in.',
        token_exchange:   'Google token exchange failed. Please try again.',
        no_email:         'Could not read Gmail address. Please try again.',
        no_refresh_token: 'Google did not return full access. Please try again — if this repeats, revoke app access in your Google Account settings first.',
        db_update:        'Database error saving connection. Please try again.',
        db_insert:        'Database error saving connection. Please try again.',
      };
      const msg = reasonMessages[reason] ?? 'Gmail connection failed. Please try again.';
      setToast(`⚠ ${msg}`);
      setTimeout(() => setToast(''), 8000);
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

      // Access control: non-admins are locked to their assigned business_unit
      if (updated.role !== 'admin' && updated.business_unit && updated.business_unit !== businessUnit) {
        router.replace(`/crm/${updated.business_unit}`);
        return;
      }

      setProfile(updated);
      loadDeals(updated);
      loadClients(updated);
      loadProfiles();
      loadSmartLists();
      loadActionPlans();
      loadCampaigns();
      setTimeout(() => { loadAllTasks(); loadAllCommissions(); }, 500);
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
        business_unit: businessUnit,
      };
      await supabase.from('crm_profiles').insert([newProfile]);
      setProfile(newProfile);
      loadDeals(newProfile);
      loadClients(newProfile);
      loadProfiles();
      loadSmartLists();
      loadActionPlans();
      loadCampaigns();
      setTimeout(() => { loadAllTasks(); loadAllCommissions(); }, 500);
    }
    setLoading(false);
  }, [session]);

  const loadDeals = useCallback(async (p: Profile) => {
    let q = supabase.from('crm_deals').select('*').eq('business_unit', businessUnit).order('last_touch', { ascending: false });
    if (p.role === 'agent') q = q.eq('agent_id', p.id);
    const { data } = await q;
    const loaded = (data ?? []) as Deal[];
    setDeals(loaded);
    // Restore active deal after page refresh
    const savedDealId = typeof window !== 'undefined' ? sessionStorage.getItem('activeDealId') : null;
    if (savedDealId) {
      const saved = loaded.find(d => d.id === savedDealId);
      if (saved) {
        setActiveDeal(saved);
        setDealTab('emails');
        loadDealEmails(saved.id);
        loadDealDocs(saved.id);
        sessionStorage.removeItem('activeDealId');
      }
    }
  }, [businessUnit]); // eslint-disable-line

  const loadProfiles = useCallback(async () => {
    // Sync real last_sign_in_at from Supabase Auth → crm_profiles first
    await fetch('/api/crm/sync-logins', { method: 'POST' }).catch(() => {});
    // Each workspace shows its own agents + all admins
    const { data } = await supabase.from('crm_profiles').select('*')
      .or(`business_unit.eq.${businessUnit},role.eq.admin`)
      .order('last_name');
    setProfiles((data ?? []) as Profile[]);
  }, [businessUnit]);

  const loadDealEmails = useCallback(async (dealId: string) => {
    const { data } = await supabase.from('crm_deal_emails').select('*').eq('deal_id', dealId).order('email_date', { ascending: false });
    setDealEmails((data ?? []) as DealEmail[]);
  }, []);

  const loadContactEmails = useCallback(async (clientId: string) => {
    setContactEmailsLoading(true);
    const { data } = await supabase.from('crm_deal_emails').select('*').eq('client_id', clientId).order('email_date', { ascending: false });
    setContactEmails((data ?? []) as DealEmail[]);
    setContactEmailsLoading(false);
  }, []);

  const loadDealDocs = useCallback(async (dealId: string) => {
    const res = await fetch(`/api/crm/docs?dealId=${dealId}`);
    const json = await res.json();
    setDealDocs((json.docs ?? []) as DealDoc[]);
  }, []);

  const loadDealCommission = useCallback(async (dealId: string) => {
    setCommissionLoading(true);
    try {
      const res = await fetch(`/api/crm/commissions?business_unit=${businessUnit}&deal_id=${dealId}`, {
        headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
      });
      const json = await res.json();
      const c = (json.commissions ?? [])[0] ?? null;
      setDealCommission(c);
      if (c) {
        setCommissionForm({
          sale_price: String(c.sale_price ?? ''),
          commission_rate: String(c.commission_rate ?? '3'),
          agent_split: String(c.agent_split ?? '70'),
          referral_fee: String(c.referral_fee ?? '0'),
          referral_to: c.referral_to ?? '',
          transaction_fee: String(c.transaction_fee ?? '0'),
          status: c.status ?? 'pending',
          close_date: c.close_date ?? '',
          paid_date: c.paid_date ?? '',
          notes: c.notes ?? '',
        });
      }
    } catch { /* ignore */ }
    finally { setCommissionLoading(false); }
  }, [businessUnit, session?.access_token]);

  async function loadAllCommissions() {
    const res = await fetch(`/api/crm/commissions?business_unit=${businessUnit}`, {
      headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
    });
    const json = await res.json();
    setAllCommissions((json.commissions ?? []) as Commission[]);
  }

  async function saveCommission(deal: Deal) {
    if (!commissionForm.sale_price) { showToast('Enter a sale/lease price first'); return; }
    setCommissionSaving(true);
    try {
      const payload = {
        deal_id: deal.id,
        agent_id: deal.agent_id,
        business_unit: businessUnit,
        deal_type: deal.type,
        sale_price: Number(commissionForm.sale_price),
        commission_rate: Number(commissionForm.commission_rate),
        agent_split: Number(commissionForm.agent_split),
        referral_fee: Number(commissionForm.referral_fee),
        referral_to: commissionForm.referral_to || null,
        transaction_fee: Number(commissionForm.transaction_fee),
        status: commissionForm.status,
        close_date: commissionForm.close_date || null,
        paid_date: commissionForm.paid_date || null,
        notes: commissionForm.notes || null,
      };
      const res = await fetch('/api/crm/commissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { showToast('Error: ' + json.error); return; }
      setDealCommission(json.commission);
      setAllCommissions(prev => {
        const exists = prev.find(c => c.deal_id === deal.id);
        return exists ? prev.map(c => c.deal_id === deal.id ? json.commission : c) : [json.commission, ...prev];
      });
      showToast('Commission saved ✓');
    } finally { setCommissionSaving(false); }
  }

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
      .eq('business_unit', businessUnit)
      .order('created_at', { ascending: false });
    if (error) { console.error('loadClients error:', error.message); return; }
    setClients((data ?? []) as Client[]);
  }, [profile, businessUnit]);


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
    if (nc.lease_expiration_date && !nc.lxp_follow_up_days) { showToast('Please select a contact window (90/120/180/360d) for the LXP date.'); return; }
    setSaving(true);
    // Duplicate email check — only when an email is provided
    if (nc.email.trim()) {
      const { data: existing } = await supabase
        .from('crm_clients')
        .select('id, first_name, last_name')
        .eq('business_unit', businessUnit)
        .ilike('email', nc.email.trim())
        .maybeSingle();
      if (existing) {
        showToast(`A contact with that email already exists: ${existing.first_name} ${existing.last_name}`);
        setSaving(false);
        return;
      }
    }
    const { error } = await supabase.from('crm_clients').insert([{
      ...nc,
      agent_id: profile!.id,
      business_unit: businessUnit,
      // date columns reject empty strings — coerce to null
      lease_expiration_date: nc.lease_expiration_date || null,
      birthday: nc.birthday || null,
    }]);
    if (error) { showToast('Error: ' + error.message); } else {
      showToast(`${nc.first_name} ${nc.last_name} added`);
      setNc({ first_name: '', last_name: '', business_name: '', email: '', phone: '', cell_phone: '', address: '', city: '', state: '', zip: '', brokerage: '', license: '', budget: '', size_range: '', asset_types: [], type: 'Buyer', tags: [], lead_source: '', notes: '', lease_expiration_date: '', lxp_follow_up_days: null, birthday: '' });
      setShowAddClient(false);
      loadClients(profile!);
    }
    setSaving(false);
  }

  async function deleteClient(id: string, name: string) {
    if (!isAdmin) { showToast('Only admins can delete contacts.'); return; }
    if (!confirm(`Remove ${name}? This cannot be undone.`)) return;
    await supabase.from('crm_clients').delete().eq('id', id);
    setClients(prev => prev.filter(c => c.id !== id));
    showToast(`${name} removed.`);
  }

  async function massDeleteClients() {
    if (!isAdmin) { showToast('Only admins can delete contacts.'); return; }
    const count = selectedClientIds.size;
    if (count === 0) return;
    if (!confirm(`Permanently delete ${count} contact${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    const ids = [...selectedClientIds];
    await supabase.from('crm_clients').delete().in('id', ids);
    setClients(prev => prev.filter(c => !ids.includes(c.id)));
    setSelectedClientIds(new Set());
    showToast(`${count} contact${count !== 1 ? 's' : ''} deleted.`);
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
      tags: c.tags ?? [],
      lead_source: c.lead_source ?? '',
      notes: c.notes ?? '',
      lease_expiration_date: c.lease_expiration_date ?? '',
      lxp_follow_up_days: c.lxp_follow_up_days ?? null,
      birthday: c.birthday ?? '',
    });
    setEditClient(c);
    setActiveClient(null); // close profile modal when opening edit
  }

  async function saveEditClient() {
    if (!editClient) return;
    if (!ec.first_name.trim()) { showToast('First name required.'); return; }
    if (ec.lease_expiration_date && !ec.lxp_follow_up_days) { showToast('Please select a contact window (90/120/180/360d) for the LXP date.'); return; }
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
      tags: ec.tags,
      lead_source: ec.lead_source,
      notes: ec.notes,
      lease_expiration_date: ec.lease_expiration_date || null,
      lxp_follow_up_days: ec.lxp_follow_up_days ?? null,
      birthday: ec.birthday || null,
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

  // ── Task Manager (full page) ──────────────────────────────────────────────────
  async function loadTasks() {
    setTasksLoading(true);
    try {
      const res = await fetch(`/api/crm/tasks?unit=${businessUnit}&status=all`, {
        headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
      });
      const data = await res.json();
      setTasks((data.tasks ?? []) as Task[]);
    } catch { /* ignore */ }
    finally { setTasksLoading(false); }
  }

  async function createTask() {
    if (!newTaskForm.title.trim()) return;
    const res = await fetch('/api/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ ...newTaskForm, business_unit: businessUnit }),
    });
    if (!res.ok) { showToast('Error creating task'); return; }
    const { task } = await res.json();
    setTasks(prev => [task, ...prev]);
    setShowNewTaskModal(false);
    setNewTaskForm({ title: '', description: '', due_date: '', assigned_to: '', client_id: '', priority: 'normal', status: 'open' });
    showToast('Task created ✓');
  }

  async function updateTask(id: string, updates: Partial<Task>) {
    const res = await fetch(`/api/crm/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(updates),
    });
    if (!res.ok) { showToast('Error updating task'); return; }
    const { task } = await res.json();
    setTasks(prev => prev.map(t => t.id === id ? task : t));
    setEditingTask(null);
    showToast('Task updated ✓');
  }

  async function deleteTask(id: string) {
    await fetch(`/api/crm/tasks/${id}`, {
      method: 'DELETE',
      headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
    });
    setTasks(prev => prev.filter(t => t.id !== id));
    showToast('Task deleted');
  }

  async function bulkEnrollInCampaign() {
    if (!bulkEnrollCampaignId || selectedClientIds.size === 0) return;
    setBulkEnrolling(true);
    const ids = Array.from(selectedClientIds);
    const res = await fetch(`/api/campaigns/${bulkEnrollCampaignId}/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ client_ids: ids, enrolled_by: profile?.id }),
    }).catch(() => null);
    setBulkEnrolling(false);
    setShowBulkEnrollModal(false);
    setBulkEnrollCampaignId('');
    setSelectedClientIds(new Set());
    if (res?.ok) showToast(`✅ Enrolled ${ids.length} contact${ids.length !== 1 ? 's' : ''} in campaign`);
    else showToast('Error enrolling contacts');
  }

  // ── Task Management ───────────────────────────────────────────────────────────
  async function loadAllTasks() {
    const { data } = await supabase
      .from('crm_tasks')
      .select('*')
      .eq('agent_id', profile!.id)
      .is('completed_at', null)
      .order('due_date', { ascending: true });
    setAllTasks((data ?? []) as CRMTask[]);
  }

  async function saveTask() {
    if (!taskClientId || !taskForm.due_date || !taskForm.title.trim()) return;
    const { data, error } = await supabase.from('crm_tasks').insert([{
      client_id: taskClientId,
      agent_id: profile!.id,
      type: taskForm.type,
      title: taskForm.title.trim(),
      due_date: taskForm.due_date,
      notes: taskForm.notes.trim(),
    }]).select().single();
    if (error) { showToast('Error saving task'); return; }
    setAllTasks(prev => [...prev, data as CRMTask].sort((a, b) => a.due_date.localeCompare(b.due_date)));
    setShowTaskModal(false);
    setTaskForm({ type: 'follow_up', title: '', due_date: '', notes: '' });

    // Push to Google Calendar (fire-and-forget — task is already saved regardless)
    const client = clients.find(c => c.id === taskClientId);
    fetch('/api/calendar/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: profile!.id,
        title: taskForm.title.trim(),
        due_date: taskForm.due_date,
        notes: taskForm.notes.trim(),
        client_name: client ? `${client.first_name} ${client.last_name}` : '',
        task_type: taskForm.type,
      }),
    }).then(r => r.json()).then(res => {
      if (res.error === 'scope_missing') {
        showToast('Task saved — reconnect Google in Settings to enable calendar sync');
      } else if (res.success) {
        showToast('Task saved + added to Google Calendar ✓');
      } else {
        showToast('Task saved (calendar sync unavailable)');
      }
    }).catch(() => showToast('Task saved'));
  }

  async function completeTask(taskId: string) {
    const now = new Date().toISOString();
    await supabase.from('crm_tasks').update({ completed_at: now }).eq('id', taskId);
    setAllTasks(prev => prev.filter(t => t.id !== taskId));
    showToast('Task completed ✓');
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

  async function loadClientCampaignSends(clientId: string) {
    const { data } = await supabase
      .from('crm_campaign_sends')
      .select('*, campaign:crm_campaigns(name)')
      .eq('client_id', clientId)
      .order('sent_at', { ascending: false })
      .limit(50);
    setClientCampaignSends(
      (data ?? []).map((s: any) => ({ ...s, campaign_name: s.campaign?.name ?? 'Campaign' }))
    );
  }

  async function logActivity(clientId: string, type: CRMActivity['type'], note: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('crm_client_activities').insert([{
      client_id: clientId,
      agent_id: profile!.id,
      type,
      note,
    }]);
    if (error) { console.error('Activity log error:', error.message); }
    // Always stamp last_touched_at on client regardless of activity insert outcome
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

  async function saveClientTags(clientId: string, newTags: string[]) {
    const { error } = await supabase.from('crm_clients').update({ tags: newTags }).eq('id', clientId);
    if (error) { showToast('Error saving tags'); return; }
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, tags: newTags } : c));
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

    // Notify admin whenever any agent (non-admin) exports
    if (!isAdmin && profile) {
      fetch('/api/crm/export-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: `${profile.first_name} ${profile.last_name}`,
          agent_email: profile.email ?? '',
          count: toExport.length,
          business_unit: businessUnit,
          selected: selectedClientIds.size > 0,
        }),
      }).catch(() => {});
    }

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
      let added = 0, errors = 0, dupes = 0;

      // Pre-fetch all existing emails in this business unit for fast dupe checking
      const { data: existingContacts } = await supabase
        .from('crm_clients').select('email').eq('business_unit', businessUnit);
      const existingEmails = new Set(
        (existingContacts ?? []).map(c => (c.email ?? '').toLowerCase().trim()).filter(Boolean)
      );

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
        const lead_source = (row['lead_source'] ?? row['Lead Source'] ?? row['source'] ?? row['Source'] ?? '').toString().trim();
        const VALID_ASSET_TYPES = ['Home','Condo','Multi-Family','Land','Industrial','Flex/Warehouse','Retail','Office','Storage'];
        const rawAssetTypes = (row['asset_types'] ?? row['Asset Types'] ?? row['Asset Type'] ?? row['specializes_in'] ?? '').toString();
        const asset_types = rawAssetTypes.split(',').map(s => s.trim()).filter(s => VALID_ASSET_TYPES.includes(s));
        const rawTags = (row['tags'] ?? row['Tags'] ?? '').toString();
        const tags = rawTags ? rawTags.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (!first_name) { errors++; continue; }
        // Skip duplicates — match by email (case-insensitive)
        if (email && existingEmails.has(email.toLowerCase())) { dupes++; continue; }
        const { error } = await supabase.from('crm_clients').insert([{
          first_name, last_name, business_name, email, phone, cell_phone, address, city, state, zip, type, brokerage, license, notes, lead_source, asset_types, tags, agent_id: profile!.id, business_unit: businessUnit,
        }]);
        if (error) { errors++; } else { added++; if (email) existingEmails.add(email.toLowerCase()); }
      }
      await loadClients(profile!);
      showToast(`Imported ${added} contact${added !== 1 ? 's' : ''}${dupes > 0 ? ` · ${dupes} duplicate${dupes !== 1 ? 's' : ''} skipped` : ''}${errors > 0 ? ` · ${errors} error${errors !== 1 ? 's' : ''}` : ''}`);
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
      business_unit: businessUnit,
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
    if (stage === 'Closed') triggerClosedPrompt({ ...deal, stage });
    if (stage === 'Lost') triggerLostPrompt({ ...deal, stage });
  }

  async function deleteDeal(id: string) {
    if (!confirm('Delete this deal? This cannot be undone.')) return;
    await supabase.from('crm_deals').delete().eq('id', id);
    setDeals(prev => prev.filter(d => d.id !== id));
    setActiveDeal(null);
    if (typeof window !== 'undefined') sessionStorage.removeItem('activeDealId');
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
      body: JSON.stringify({ ...inv, firstName: inv.first_name, lastName: inv.last_name, business_unit: businessUnit }),
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
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}) },
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

  async function saveAgentProfile() {
    if (!editingAgentId) return;
    setEditAgentSaving(true);
    const res = await fetch(`/api/crm/profiles/${editingAgentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editAgentForm),
    });
    const json = await res.json();
    if (!res.ok) { showToast('Error: ' + json.error); }
    else {
      showToast('Profile updated ✓');
      setEditingAgentId(null);
      loadProfiles();
    }
    setEditAgentSaving(false);
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
    if (updated.length === 0) setGmailConnected(false);
    showToast('Account disconnected');
  }

  // ── Gmail sync ───────────────────────────────────────────────────────────────
  async function syncGmail(deal: Deal) {
    if (!deal.client_email) { showToast('No client email on this deal'); return; }
    setSyncing(true);
    const res = await fetch('/api/gmail/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session!.access_token}` },
      body: JSON.stringify({ userId: deal.agent_id ?? session!.user.id, dealId: deal.id, clientEmail: deal.client_email }),
    });
    const json = await res.json();
    if (!res.ok) showToast('Sync error: ' + (json.error ?? res.status) + (json.debug ? ' | ' + JSON.stringify(json.debug) : ''));
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session!.access_token}` },
      body: JSON.stringify({ userId: deal.agent_id ?? session!.user.id, dealId: deal.id, clientEmail: deal.client_email }),
    });
    const json = await res.json();
    if (!res.ok) showToast('Sync error: ' + json.error);
    else { showToast(`Re-synced ${json.synced} email${json.synced !== 1 ? 's' : ''} between you and ${deal.client_email}`); loadDealEmails(deal.id); }
    setSyncing(false);
  }

  // ── Contact-level Gmail sync & send ─────────────────────────────────────────
  async function syncGmailForContact(client: Client) {
    if (!client.email) { showToast('No email on this contact'); return; }
    setSyncing(true);
    const res = await fetch('/api/gmail/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session!.access_token}` },
      body: JSON.stringify({ userId: client.agent_id ?? session!.user.id, clientId: client.id, clientEmail: client.email }),
    });
    const json = await res.json();
    if (!res.ok) showToast('Sync error: ' + (json.error ?? res.status) + (json.debug ? ' | ' + JSON.stringify(json.debug) : ''));
    else { showToast(`Synced ${json.synced} new email${json.synced !== 1 ? 's' : ''}`); loadContactEmails(client.id); }
    setSyncing(false);
  }

  async function sendGmailEmailToContact(client: Client) {
    if (!composeSubject.trim()) { showToast('Subject is required'); return; }
    setComposeSending(true);
    try {
      const messageHtml = contactComposeBodyRef.current?.innerHTML ?? '';
      const sig = profile?.email_signature ? `<br/><br/><div class="gmail_signature">${profile.email_signature}</div>` : '';
      const fullBody = profile?.email_signature ? `${messageHtml}${sig}` : messageHtml;
      const agentName = `${profile!.first_name} ${profile!.last_name}`;
      const threadingParams = replyToContactEmail ? {
        threadId: replyToContactEmail.gmail_thread_id,
        inReplyTo: replyToContactEmail.rfc_message_id,
      } : {};
      const attachments = await Promise.all(
        composeAttachments.map(file => new Promise<{ name: string; mimeType: string; data: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', data: (reader.result as string).split(',')[1] });
          reader.onerror = reject;
          reader.readAsDataURL(file);
        }))
      );
      const res = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session!.user.id, clientId: client.id, to: client.email, subject: composeSubject, body: fullBody, agentName, ccAgentIds: [], attachments, ...threadingParams }),
      });
      const json = await res.json();
      if (!res.ok) { showToast('Send failed: ' + (json.error ?? res.status)); }
      else {
        showToast('Email sent');
        setShowContactCompose(false);
        setReplyToContactEmail(null);
        clearContactComposeBody();
        setComposeSubject('');
        setComposeAttachments([]);
        loadContactEmails(client.id);
        logActivity(client.id, 'email', `Sent email: ${composeSubject}`);
      }
    } catch (err) {
      showToast('Send error — check console');
      console.error(err);
    }
    setComposeSending(false);
  }

  // ── Gmail compose & send ─────────────────────────────────────────────────────
  async function sendGmailEmail(deal: Deal) {
    if (!composeSubject.trim()) { showToast('Subject is required'); return; }
    setComposeSending(true);
    try {
      const agentName = `${profile!.first_name} ${profile!.last_name}`;
      const sig = profile?.email_signature ?? '';
      const messageHtml = composeBodyRef.current?.innerHTML ?? '';
      const fullBody = sig
        ? `${messageHtml}<br/><br/><div class="gmail_signature">${sig}</div>`
        : messageHtml || '&nbsp;';
      const threadingParams = replyToEmail ? {
        threadId: replyToEmail.gmail_thread_id,
        inReplyTo: replyToEmail.rfc_message_id,
      } : {};

      // Convert attachments to base64
      const attachments = await Promise.all(
        composeAttachments.map(file => new Promise<{ name: string; mimeType: string; data: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', data: (reader.result as string).split(',')[1] });
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        }))
      );

      const res = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session!.user.id, dealId: deal.id, to: deal.client_email, subject: composeSubject, body: fullBody, agentName, ccAgentIds: deal.assigned_agent_ids ?? [], attachments, ...threadingParams }),
      });
      let j: any = {};
      try { j = await res.json(); } catch {}
      if (!res.ok) {
        showToast('Send failed: ' + (j.error || `HTTP ${res.status}`));
      } else {
        showToast('✉️ Email sent via Gmail');
        setShowCompose(false);
        setComposeSubject('');
        clearComposeBody();
        setReplyToEmail(null);
        setComposeAttachments([]);
        loadDealEmails(deal.id);
        if (deal.client_id) logActivity(deal.client_id, 'email', `Sent email: ${composeSubject}`);
      }
    } catch (err) {
      showToast('Send failed: ' + String(err));
    } finally {
      setComposeSending(false);
    }
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────────
  async function loadProspects() {
    setProspectsLoading(true);
    const { data } = await supabase
      .from('email_lead_imports')
      .select('*, client:crm_clients(id,first_name,last_name,email,phone,prospect_status,lead_source,notes,created_at)')
      .eq('business_unit', businessUnit)
      .order('created_at', { ascending: false })
      .limit(200);
    setProspects(data ?? []);
    setProspectsLoading(false);
  }

  async function updateProspectStatus(clientId: string, status: string) {
    await supabase.from('crm_clients').update({ prospect_status: status }).eq('id', clientId);
    setProspects(prev => prev.map(p => p.client?.id === clientId ? { ...p, client: { ...p.client, prospect_status: status } } : p));
    showToast(`Prospect marked as ${status}`);
  }

  async function syncEmailLeads() {
    showToast('Scanning inbox for new leads…');
    const res = await fetch('/api/email-leads/sync', { method: 'POST' });
    const data = await res.json();
    if (data.imported > 0) { showToast(`✅ ${data.imported} new lead${data.imported > 1 ? 's' : ''} imported!`); loadProspects(); }
    else showToast('No new leads found');
  }

  async function loadCampaigns() {
    setCampaignLoading(true);
    try {
      const res = await fetch(`/api/campaigns?unit=${businessUnit}`);
      const j = await res.json();
      if (res.ok) { setCampaigns(j.campaigns ?? []); }
      else { showToast(`Could not load campaigns: ${j.error ?? res.status}`); }
    } catch (err) {
      showToast('Network error loading campaigns');
    } finally {
      setCampaignLoading(false);
    }
  }

  async function saveCampaign() {
    // Always grab the freshest content — editor ref if mounted, otherwise state
    const latestEmailBody = (emailEditorMode === 'rich' && emailEditorRef.current?.innerHTML)
      || newCampaign.email_body;
    setSaving(true);
    try {
      const body = { ...newCampaign, email_body: latestEmailBody, created_by: session!.user.id, business_unit: businessUnit };
      const url = activeCampaign ? `/api/campaigns/${activeCampaign.id}` : '/api/campaigns';
      const method = activeCampaign ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { showToast('Error: ' + (j.error ?? 'Save failed')); }
      else {
        showToast(activeCampaign ? 'Campaign updated' : 'Campaign created');
        setEmailEditorMode('rich');
        setCampaignView('list');
        setActiveCampaign(null);
        setNewCampaign({ name: '', description: '', type: 'email', frequency: 'monthly', send_date: '', send_time: '08:00', send_day_of_month: '', status: 'draft', email_subject: '', email_body: '', sms_body: '', sender_agent_id: '' });
        loadCampaigns();
      }
    } catch (err) {
      showToast('Network error — please try again');
    } finally {
      setSaving(false);
    }
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
    setCampaignEnrollmentsLoading(true);
    const res = await fetch(`/api/campaigns/${campaignId}/enrollments`);
    if (res.ok) { const j = await res.json(); setCampaignEnrollments(j.enrollments ?? []); }
    setCampaignEnrollmentsLoading(false);
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

  // ── Smart Lists ───────────────────────────────────────────────────────────────
  async function loadSmartLists() {
    const res = await fetch(`/api/smart-lists?unit=${businessUnit}`);
    if (res.ok) { const j = await res.json(); setSmartLists(j.smartLists ?? []); }
  }

  async function saveSmartList() {
    if (!newListName.trim()) { showToast('Enter a list name'); return; }
    const filters: Record<string, any> = {};
    if (contactTypeFilter) filters.type = contactTypeFilter;
    if (contactTagFilter) filters.tag = contactTagFilter;
    if (contactSourceFilter) filters.lead_source = contactSourceFilter;
    const res = await fetch('/api/smart-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newListName.trim(), filters, created_by: session!.user.id, is_shared: true, business_unit: businessUnit }),
    });
    if (res.ok) { showToast(`"${newListName}" saved`); setNewListName(''); setShowSaveList(false); loadSmartLists(); }
    else showToast('Error saving list');
  }

  async function deleteSmartList(id: string) {
    const res = await fetch(`/api/smart-lists?id=${id}`, { method: 'DELETE' });
    if (res.ok) { setSmartLists(prev => prev.filter(s => s.id !== id)); showToast('List deleted'); }
    else showToast('Error deleting list');
  }

  function applySmartList(sl: SmartList) {
    setContactTypeFilter(sl.filters.type ?? '');
    setContactTagFilter(sl.filters.tag ?? '');
    setContactSourceFilter(sl.filters.lead_source ?? '');
  }

  // ── Action Plans ──────────────────────────────────────────────────────────────
  async function loadActionPlans() {
    setActionPlanLoading(true);
    const res = await fetch(`/api/action-plans?unit=${businessUnit}`);
    if (res.ok) { const j = await res.json(); setActionPlans(j.plans ?? []); }
    setActionPlanLoading(false);
  }

  async function saveActionPlan() {
    if (!newPlan.name.trim()) { showToast('Plan name is required'); return; }
    // Validate steps — each step needs at least some content
    const emptyStep = planSteps.find(s => !s.body?.trim());
    if (emptyStep) { showToast(`Step ${emptyStep.step_order} needs content`); return; }

    setSaving(true);
    const url = activeActionPlan ? `/api/action-plans/${activeActionPlan.id}` : '/api/action-plans';
    const method = activeActionPlan ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newPlan, created_by: session!.user.id, business_unit: businessUnit }),
    });
    const j = await res.json();
    if (!res.ok) { showToast('Error: ' + j.error); setSaving(false); return; }
    const planId = activeActionPlan?.id ?? j.plan?.id;

    // Save steps (always call PUT so we can clear steps too)
    if (planId) {
      const stepsRes = await fetch(`/api/action-plans/${planId}/steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: planSteps }),
      });
      if (!stepsRes.ok) {
        const stepsErr = await stepsRes.json();
        showToast('Steps error: ' + (stepsErr.error ?? 'Unknown error'));
        setSaving(false);
        return;
      }
    }

    showToast(activeActionPlan ? 'Plan updated' : 'Plan created');
    setActionPlanView('list');
    setActiveActionPlan(null);
    setNewPlan({ name: '', description: '', trigger_type: 'manual', trigger_value: '', status: 'active', completion_campaign_id: '' });
    setPlanSteps([]);
    loadActionPlans();
    setSaving(false);
  }

  async function deleteActionPlan(id: string) {
    if (!confirm('Delete this action plan? This cannot be undone.')) return;
    await fetch(`/api/action-plans/${id}`, { method: 'DELETE' });
    showToast('Plan deleted');
    setActiveActionPlan(null);
    setActionPlanView('list');
    loadActionPlans();
  }

  async function loadActionPlanEnrollments(planId: string) {
    const res = await fetch(`/api/action-plans/${planId}/enrollments`);
    if (res.ok) { const j = await res.json(); setActionPlanEnrollments(j.enrollments ?? []); }
  }

  async function enrollInActionPlan(planId: string) {
    if (!selectedPlanEnrollIds.length) { showToast('Select at least one client'); return; }
    const res = await fetch(`/api/action-plans/${planId}/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_ids: selectedPlanEnrollIds, agent_id: session!.user.id }),
    });
    const j = await res.json();
    if (!res.ok) showToast('Error: ' + j.error);
    else { showToast(`Enrolled ${j.enrolled} client${j.enrolled !== 1 ? 's' : ''}`); setSelectedPlanEnrollIds([]); loadActionPlanEnrollments(planId); }
  }

  async function unenrollFromActionPlan(planId: string, clientId: string) {
    await fetch(`/api/action-plans/${planId}/enrollments`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId }) });
    showToast('Client removed from plan');
    loadActionPlanEnrollments(planId);
  }

  async function sendActionPlanTest(planId: string) {
    if (!profile) return;
    setTestSending(true);
    const res = await fetch('/api/action-plans/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: planId, agent_id: profile.id }),
    });
    const j = await res.json();
    if (res.ok) showToast(`Test email sent to ${j.to} ✓`);
    else showToast('Error: ' + j.error);
    setTestSending(false);
  }

  async function bulkUnenrollClients(campaignId: string) {
    if (!selectedUnenrollIds.length) return;
    await Promise.all(selectedUnenrollIds.map(clientId =>
      fetch(`/api/campaigns/${campaignId}/enrollments`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId }) })
    ));
    showToast(`Removed ${selectedUnenrollIds.length} client${selectedUnenrollIds.length !== 1 ? 's' : ''}`);
    setSelectedUnenrollIds([]);
    loadCampaignEnrollments(campaignId);
  }

  function addPlanStep() {
    const order = planSteps.length + 1;
    setPlanSteps(prev => [...prev, { step_order: order, type: 'email', delay_days: order === 1 ? 0 : 3, subject: '', body: '' }]);
  }

  function updatePlanStep(idx: number, patch: Partial<ActionPlanStep>) {
    setPlanSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function removePlanStep(idx: number) {
    setPlanSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i + 1 })));
  }

  // ── Activity Report ───────────────────────────────────────────────────────────
  async function loadActivityReport(days: number) {
    setActivityReportLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase
      .from('crm_activity')
      .select('agent_id, type')
      .gte('created_at', since);
    const map: Record<string, { calls: number; emails: number; meetings: number; notes: number }> = {};
    (data ?? []).forEach((row: any) => {
      if (!map[row.agent_id]) map[row.agent_id] = { calls: 0, emails: 0, meetings: 0, notes: 0 };
      if (row.type === 'call') map[row.agent_id].calls++;
      else if (row.type === 'email') map[row.agent_id].emails++;
      else if (row.type === 'meeting') map[row.agent_id].meetings++;
      else map[row.agent_id].notes++;
    });
    const report = Object.entries(map).map(([agent_id, counts]) => {
      const p = profiles.find(x => x.id === agent_id);
      return { agent_id, name: p ? `${p.first_name} ${p.last_name}` : 'Unknown', ...counts, total: counts.calls + counts.emails + counts.meetings + counts.notes };
    }).sort((a, b) => b.total - a.total);
    setActivityReport(report);
    setActivityReportLoading(false);
  }

  // ── Lost deal reason prompt ────────────────────────────────────────────────────
  function triggerLostPrompt(deal: Deal) {
    setLostReason('');
    setLostReasonOther('');
    setLostDealPrompt(deal);
  }

  async function handleLostSave() {
    if (!lostDealPrompt) return;
    const finalReason = lostReason === 'Other' ? lostReasonOther.trim() : lostReason;
    if (!finalReason) { showToast('Please select or enter a reason'); return; }
    setLostSaving(true);
    await supabase.from('crm_deals').update({ lost_reason: finalReason }).eq('id', lostDealPrompt.id);
    setDeals(prev => prev.map(d => d.id === lostDealPrompt.id ? { ...d, lost_reason: finalReason } : d));
    if (activeDeal?.id === lostDealPrompt.id) setActiveDeal(prev => prev ? { ...prev, lost_reason: finalReason } : prev);
    if (lostDealPrompt.client_id) {
      logActivity(lostDealPrompt.client_id, 'deal_update', `Deal lost — ${finalReason}`);
    }
    showToast('📋 Loss reason saved');
    setLostSaving(false);
    setLostDealPrompt(null);
  }

  // ── Closed deal enrollment prompt ─────────────────────────────────────────────
  function triggerClosedPrompt(deal: Deal) {
    if (!deal.client_id) return;
    setClosedEnrollPlanIds([]);
    setClosedEnrollCampaignIds([]);
    setClosedDealPrompt(deal);
  }

  async function handleClosedEnroll() {
    if (!closedDealPrompt?.client_id) return;
    setClosedEnrolling(true);
    const clientId = closedDealPrompt.client_id;
    const agentId = session!.user.id;

    // Enroll in action plans, then immediately fire step 1 (don't wait for cron)
    await Promise.all(
      closedEnrollPlanIds.map(async planId => {
        await fetch(`/api/action-plans/${planId}/enrollments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_ids: [clientId], agent_id: agentId }),
        });
        // Send step 1 right now instead of waiting up to 15 min for the cron
        await fetch(`/api/action-plans/${planId}/send-now`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, agent_id: agentId }),
        });
      })
    );

    // Enroll in campaigns (cron handles sending on their schedule)
    await Promise.all(
      closedEnrollCampaignIds.map(campaignId =>
        fetch(`/api/campaigns/${campaignId}/enrollments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_ids: [clientId], enrolled_by: agentId }),
        })
      )
    );

    const total = closedEnrollPlanIds.length + closedEnrollCampaignIds.length;
    if (total > 0) showToast(`✅ Enrolled in ${total} item${total !== 1 ? 's' : ''}`);
    setClosedEnrolling(false);
    setClosedDealPrompt(null);
  }

  // ── Kanban drag & drop ────────────────────────────────────────────────────────
  async function updateDealStage(dealId: string, newStage: string) {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage, last_touch: today() } : d));
    await supabase.from('crm_deals').update({ stage: newStage, last_touch: today() }).eq('id', dealId);
    const deal = deals.find(d => d.id === dealId);
    if (deal) {
      if (newStage === 'Closed') triggerClosedPrompt({ ...deal, stage: newStage });
      if (newStage === 'Lost') triggerLostPrompt({ ...deal, stage: newStage });
      // Fire stage-change action plans
      if (deal.client_id) {
        fetch('/api/action-plans/stage-trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: newStage, clientId: deal.client_id, agentId: deal.agent_id, businessUnit }),
        }).catch(() => {});
      }
    }
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
    setDealCommission(null);
    loadDealEmails(deal.id);
    loadDealDocs(deal.id);
    loadDealCommission(deal.id);
    if (typeof window !== 'undefined') sessionStorage.setItem('activeDealId', deal.id);
  }

  // ── Filtered deals ────────────────────────────────────────────────────────────
  const filteredDeals = deals.filter(d => {
    if (filter && d.type !== filter) return false;
    if (search && !d.client.toLowerCase().includes(search.toLowerCase()) && !d.property?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function getDefaultEmailBody(): string {
    return `<p>Hi {{first_name}},</p><p>I wanted to reach out and check in with you. Whether you're actively looking or just keeping an eye on the market, I'm here to help with any questions you may have.</p><p>Feel free to reply or call me directly at {{agent_phone}}.</p><p>Best regards,<br><strong>{{agent_name}}</strong><br>{{brokerage}}</p><p><small><a href="{{unsubscribe_url}}">Unsubscribe</a> · 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015</small></p>`;
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
  if (!session) return <LoginScreen onLogin={s => { setSession(s); setLoading(true); }} brandName={brand.name} />;
  if (!profile) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#111', color: '#fff', fontFamily: 'sans-serif' }}>Setting up your profile…</div>;

  const isAdmin = profile.role === 'admin';
  const isMobile = windowWidth < 768;
  const initials = (profile.first_name[0] ?? '') + (profile.last_name[0] ?? '');
  const agentName = (id: string) => { const p = profiles.find(x => x.id === id); return p ? `${p.first_name} ${p.last_name}` : profile.id === id ? `${profile.first_name} ${profile.last_name}` : '—'; };

  const mobileNavItems: { id: typeof page; icon: string; label: string }[] = [
    { id: 'dashboard', icon: '🏠', label: 'Home' },
    { id: 'prospects' as typeof page, icon: '🎯', label: 'Prospects' },
    { id: 'deals', icon: '📋', label: 'Deals' },
    { id: 'contacts', icon: '👥', label: 'Contacts' },
    { id: 'tasks' as typeof page, icon: '✅', label: 'Tasks' },
    { id: 'campaigns' as typeof page, icon: '📣', label: 'Campaigns' },
    { id: 'action-plans' as typeof page, icon: '⚡', label: 'Plans' },
    ...(isAdmin ? [{ id: 'agents' as typeof page, icon: '🤝', label: 'Team' }] : []),
  ];

  const pageLabel: Record<typeof page, string> = {
    dashboard: 'Dashboard', prospects: 'Prospects', deals: filter || 'Deal Flow', contacts: 'Contacts',
    agents: 'Team', calendar: 'Calendar', invite: 'Invite', campaigns: 'Campaigns', 'action-plans': 'Action Plans', tasks: 'Tasks', commissions: 'Commissions', social: 'Social Media',
  };

  // ── UI ────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100vh', overflow: 'hidden', background: '#f2f2f2' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .crm-input{padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;font-family:'DM Sans',sans-serif;width:100%;}
        .crm-input:focus{outline:none;border-color:#c9922c;}
        .crm-btn{padding:8px 18px;border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all .15s;}
        .crm-btn-gold{background:#c9922c;color:#111;font-weight:600;}
        .crm-btn-ghost{background:transparent;border:1px solid #ccc;color:#6b7280;}
        .crm-btn-sm{padding:5px 12px;font-size:13px;}
        .crm-nav{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:6px;cursor:pointer;color:rgba(255,255,255,.85);font-size:14px;font-weight:500;border:none;background:none;width:100%;font-family:'DM Sans',sans-serif;text-align:left;transition:all .15s;}
        .crm-nav:hover{background:rgba(255,255,255,.08);color:#fff;}
        .crm-nav.active{background:rgba(201,168,76,.18);color:#c9922c;font-weight:600;}
        table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e8e8e8;}
        thead{background:#111;color:#fff;}
        th{padding:10px 14px;text-align:left;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-weight:500;}
        td{padding:12px 14px;font-size:14px;border-bottom:1px solid #efefef;vertical-align:middle;}
        tr:last-child td{border-bottom:none;}
        tr:hover td{background:#fafafa;}
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:36px 20px;overflow-y:auto;}
        .modal{background:#fff;border-radius:12px;width:760px;max-width:96vw;box-shadow:0 20px 60px rgba(0,0,0,.3);flex-shrink:0;}
        .pill{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:12px;font-size:12px;font-weight:500;}
        @keyframes spin{to{transform:rotate(360deg)}}
        /* ── Contacts redesign ── */
        .contacts-table{border:1px solid #e8edf2!important;border-radius:12px!important;overflow:hidden!important;box-shadow:0 1px 4px rgba(0,0,0,.05)!important;table-layout:fixed!important;}
        .contacts-table thead{background:#f8fafc!important;color:inherit!important;}
        .contacts-table th{color:#94a3b8!important;font-size:11.5px!important;letter-spacing:.9px!important;padding:12px 14px!important;border-bottom:1px solid #e8edf2!important;font-weight:600!important;}
        .contacts-table td{padding:12px 14px!important;font-size:14px!important;border-bottom:1px solid #f1f5f9!important;vertical-align:middle!important;overflow:hidden!important;text-overflow:ellipsis!important;}
        .contacts-table col.col-check{width:36px;}
        .contacts-table col.col-name{width:190px;}
        .contacts-table col.col-asset{width:130px;}
        .contacts-table col.col-source{width:100px;}
        .contacts-table col.col-tags{width:160px;}
        .contacts-table col.col-email{width:190px;}
        .contacts-table col.col-phone{width:135px;}
        .contacts-table col.col-deals{width:105px;}
        .contacts-table col.col-owner{width:110px;}
        .contacts-table col.col-added{width:90px;}
        .contacts-table col.col-touch{width:95px;}
        .contacts-table col.col-actions{width:160px;}
        .contacts-table tr:last-child td{border-bottom:none!important;}
        .contacts-table tr:hover td{background:#fafbfd!important;}
        .contacts-table .row-actions{opacity:1;}
        .cf-select{padding:6px 30px 6px 11px;border-radius:8px;border:1px solid #e2e8f0;font-size:13.5px;font-family:'DM Sans',sans-serif;color:#374151;background:#fff;cursor:pointer;font-weight:500;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;transition:border-color .15s,box-shadow .15s;}
        .cf-select:hover{border-color:#c9922c;}
        .cf-select:focus{outline:none;border-color:#c9922c;box-shadow:0 0 0 3px rgba(201,146,44,.12);}
        .cf-select.active{border-color:#c9922c;background-color:#fffbf2;color:#92400e;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2392400e'/%3E%3C/svg%3E");}
        .cf-tag-input{padding:6px 11px;border-radius:8px;border:1px solid #e2e8f0;font-size:13.5px;font-family:'DM Sans',sans-serif;color:#374151;background:#fff;transition:border-color .15s,box-shadow .15s;outline:none;}
        .cf-tag-input:focus{border-color:#c9922c;box-shadow:0 0 0 3px rgba(201,146,44,.12);}
        .cf-tag-input.active{border-color:#c9922c;background:#fffbf2;}
        @media(max-width:767px){
          .overlay{padding:0!important;align-items:flex-end!important;overflow:hidden!important;}
          .modal{width:100%!important;max-width:100%!important;border-radius:20px 20px 0 0!important;max-height:92vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;}
          .crm-btn{padding:10px 18px;font-size:15px;}
          .crm-btn-sm{padding:8px 14px!important;font-size:14px!important;}
          .crm-input{padding:10px 12px;font-size:16px;}
          .mobile-table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}
        }
      `}</style>

      {/* Sidebar — desktop only */}
      {!isMobile && <nav style={{ width: 248, background: '#111', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
        <div style={{ padding: '22px 20px 16px', borderBottom: '1px solid rgba(201,146,44,.3)' }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 19, fontWeight: 700, color: '#c9922c', lineHeight: 1.2 }}>{brand.name}</div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)', letterSpacing: 2, textTransform: 'uppercase', marginTop: 4, marginBottom: 12 }}>{brand.tagline}</div>
          {/* Workspace switcher — admin only */}
          {isAdmin && (
            <a
              href={businessUnit === 'residential' ? '/crm/commercial' : '/crm/residential'}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 8, padding: '6px 10px', textDecoration: 'none', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 14 }}>{businessUnit === 'residential' ? '🏢' : '🏡'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', letterSpacing: 1, textTransform: 'uppercase' }}>Switch to</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.9)' }}>
                  {businessUnit === 'residential' ? 'CRECO' : 'Fair Oaks'}
                </div>
              </div>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.55)' }}>→</span>
            </a>
          )}
        </div>
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', padding: '0 8px', marginBottom: 6 }}>Overview</div>
          <button className={`crm-nav${page === 'dashboard' ? ' active' : ''}`} onClick={() => setPage('dashboard')}>🏠 &nbsp;Dashboard</button>
        </div>
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', padding: '0 8px', marginBottom: 6 }}>Deal Flow</div>
          <button className={`crm-nav${page === 'deals' && !filter ? ' active' : ''}`} onClick={() => { setPage('deals'); setFilter(''); }}>📋 &nbsp;All Deals <span style={{ marginLeft: 'auto', background: '#c9922c', color: '#111', fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>{deals.length}</span></button>
        </div>
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', padding: '0 8px', marginBottom: 6 }}>People</div>
          <button className={`crm-nav${page === 'contacts' ? ' active' : ''}`} onClick={() => { setPage('contacts'); loadClients(); loadSmartLists(); }}>👥 &nbsp;Contacts <span style={{ marginLeft: 'auto', background: clients.length > 0 ? '#c9922c' : 'rgba(255,255,255,.12)', color: clients.length > 0 ? '#111' : 'rgba(255,255,255,.4)', fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>{clients.length}</span></button>
          <button className={`crm-nav${page === 'prospects' ? ' active' : ''}`} onClick={() => { setPage('prospects'); loadProspects(); }}>🎯 &nbsp;Prospects {prospects.filter(p => p.client?.prospect_status === 'new').length > 0 && <span style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>{prospects.filter(p => p.client?.prospect_status === 'new').length}</span>}</button>
          {isAdmin && <button className={`crm-nav${page === 'agents' ? ' active' : ''}`} onClick={() => { setPage('agents'); loadProfiles(); loadActivityReport(activityReportDays); }}>🤝 &nbsp;Broker / Agents</button>}
        </div>
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', padding: '0 8px', marginBottom: 6 }}>Tools</div>
          <button className={`crm-nav${page === 'calendar' ? ' active' : ''}`} onClick={() => { setPage('calendar'); loadCalendarEvents(calendarFilter === 'week' ? 7 : calendarFilter === 'month' ? 30 : 90); }}>📅 &nbsp;Calendar</button>
          <button className={`crm-nav${page === 'tasks' ? ' active' : ''}`} onClick={() => { setPage('tasks'); loadTasks(); loadProfiles(); }}>
            ✅ &nbsp;Tasks
            {tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < today()).length > 0 && (
              <span style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
                {tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < today()).length}
              </span>
            )}
          </button>
          <button className={`crm-nav${page === 'campaigns' ? ' active' : ''}`} onClick={() => { setPage('campaigns'); setCampaignView('list'); loadCampaigns(); loadProfiles(); setCampaignAgentFilter(null); }}>📣 &nbsp;Campaigns</button>
          <button className={`crm-nav${page === 'action-plans' ? ' active' : ''}`} onClick={() => { setPage('action-plans'); setActionPlanView('list'); loadActionPlans(); loadCampaigns(); loadProfiles(); setActionPlanAgentFilter(null); }}>⚡ &nbsp;Action Plans</button>
          <button className={`crm-nav${page === 'social' ? ' active' : ''}`} onClick={() => setPage('social')}>📱 &nbsp;Social Media</button>
          {isAdmin && <button className={`crm-nav${page === 'commissions' ? ' active' : ''}`} onClick={() => { setPage('commissions'); loadAllCommissions(); }}>💰 &nbsp;Commissions</button>}
        </div>
        {isAdmin && businessUnit === 'residential' && (
          <div style={{ padding: '10px 12px 4px' }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', padding: '0 8px', marginBottom: 6 }}>MLS</div>
            <button
              onClick={async () => {
                setMlsSyncing(true);
                try {
                  const res = await fetch('/api/mls/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}) } });
                  const data = await res.json();
                  if (!res.ok) showToast('MLS sync failed: ' + (data.error ?? res.status));
                  else showToast(`✅ MLS sync done — ${data.synced} listings updated`);
                } catch (err) {
                  showToast('MLS sync error — check console');
                } finally {
                  setMlsSyncing(false);
                }
              }}
              disabled={mlsSyncing}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, cursor: mlsSyncing ? 'default' : 'pointer', border: '1px solid rgba(201,146,44,.3)', background: 'rgba(201,146,44,.08)', color: 'rgba(255,255,255,.85)', fontSize: 14, fontFamily: "'DM Sans',sans-serif", width: '100%', opacity: mlsSyncing ? 0.7 : 1, transition: 'all .15s' }}>
              <span>{mlsSyncing ? '⏳' : '🏠'}</span>
              <span>{mlsSyncing ? 'Syncing MLS…' : '↻ Sync MLS Listings'}</span>
            </button>
          </div>
        )}
        <div style={{ marginTop: 'auto', padding: '14px 12px', borderTop: '1px solid rgba(255,255,255,.07)' }}>
          {/* Gmail / Calendar accounts */}
          <div style={{ marginBottom: 10 }}>
            {gmailAccounts.map(acct => (
              <div key={acct.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)', borderRadius: 7, marginBottom: 5 }}>
                <span style={{ fontSize: 13 }}>✉️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: '#4ade80', fontWeight: 600, letterSpacing: .5 }}>Connected</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acct.email}</div>
                </div>
                <button onClick={() => disconnectGmailAccount(acct.id)} title="Disconnect" aria-label="Disconnect" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.25)', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            ))}
            {showGmailInput ? (
              <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 7, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 6 }}>Enter the Gmail address to connect:</div>
                <input
                  type="email"
                  autoFocus
                  placeholder="you@gmail.com"
                  value={gmailInputValue}
                  onChange={e => setGmailInputValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && gmailInputValue.trim()) {
                      window.location.href = `/api/gmail/auth?userId=${session!.user.id}&hint=${encodeURIComponent(gmailInputValue.trim())}&bu=${businessUnit}`;
                    }
                    if (e.key === 'Escape') { setShowGmailInput(false); setGmailInputValue(''); }
                  }}
                  style={{ width: '100%', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: '#fff', fontFamily: "'DM Sans',sans-serif", outline: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    disabled={!gmailInputValue.trim()}
                    onClick={() => { window.location.href = `/api/gmail/auth?userId=${session!.user.id}&hint=${encodeURIComponent(gmailInputValue.trim())}&bu=${businessUnit}`; }}
                    style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', background: gmailInputValue.trim() ? '#c9922c' : 'rgba(255,255,255,.1)', color: gmailInputValue.trim() ? '#111' : 'rgba(255,255,255,.3)', fontSize: 12, fontWeight: 700, cursor: gmailInputValue.trim() ? 'pointer' : 'default', fontFamily: "'DM Sans',sans-serif" }}>
                    Connect →
                  </button>
                  <button onClick={() => { setShowGmailInput(false); setGmailInputValue(''); }}
                    style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.4)', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowGmailInput(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.15)', borderRadius: 7, cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                <span style={{ fontSize: 13 }}>＋</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', fontWeight: 500 }}>{gmailAccounts.length === 0 ? 'Connect Google Account' : 'Add Another Account'}</span>
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: 'rgba(255,255,255,.05)', borderRadius: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#111', flexShrink: 0 }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.first_name} {profile.last_name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{isAdmin ? 'Broker · Admin' : 'Agent'}</div>
            </div>
            <button onClick={signOut} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', cursor: 'pointer', fontSize: 16 }} title="Sign out">⏻</button>
          </div>
        </div>
      </nav>}

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Mobile top header */}
        {isMobile && (
          <div style={{ background: '#111', color: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, borderBottom: '1px solid rgba(201,146,44,.2)' }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 15, fontWeight: 700, color: '#c9922c', flexShrink: 0 }}>{brand.shortName}</div>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,.15)', flexShrink: 0 }} />
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 600, color: '#fff', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pageLabel[page]}</div>
            {/* Search */}
            <button onClick={() => { setShowSearch(true); setSearchQuery(''); }}
              style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, color: 'rgba(255,255,255,.7)', cursor: 'pointer', fontSize: 16, padding: '6px 10px', flexShrink: 0, lineHeight: 1 }}>🔍</button>
            {page === 'contacts' && <button className="crm-btn crm-btn-gold crm-btn-sm" onClick={() => setShowAddClient(true)} style={{ flexShrink: 0, padding: '7px 12px', fontSize: 14 }}>+ Add</button>}
            {page === 'deals' && <button className="crm-btn crm-btn-gold crm-btn-sm" onClick={() => setShowAddDeal(true)} style={{ flexShrink: 0, padding: '7px 12px', fontSize: 14 }}>+ Deal</button>}
            {page === 'campaigns' && <button className="crm-btn crm-btn-gold crm-btn-sm" onClick={() => { setCampaignView('builder'); setActiveCampaign(null); setNewCampaign({ name: '', description: '', type: 'email', frequency: 'monthly', send_date: '', send_time: '08:00', send_day_of_month: '', status: 'draft', email_subject: '', email_body: '', sms_body: '', sender_agent_id: '' }); }} style={{ flexShrink: 0, padding: '7px 12px', fontSize: 14 }}>+ New</button>}
          </div>
        )}

        {/* Desktop topbar */}
        {!isMobile && <div style={{ background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '13px 26px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, flex: 1 }}>
            {pageLabel[page]}
          </h2>
          {/* Global search trigger */}
          <button onClick={() => { setShowSearch(true); setSearchQuery(''); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", color: '#9ca3af', fontSize: 14, transition: 'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#c9922c'; e.currentTarget.style.color = '#374151'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#9ca3af'; }}>
            🔍 <span>Search…</span>
            <kbd style={{ fontSize: 11, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 5px', fontFamily: 'monospace', marginLeft: 4 }}>⌘K</kbd>
          </button>

          {/* Notification Bell */}
          {(() => {
            const now = Date.now();
            const todayStr = new Date().toISOString().slice(0, 10);
            const overdueTasks = allTasks.filter(t => !t.completed_at && t.due_date && t.due_date < todayStr);
            const newLeads = clients.filter(c => (c.tags ?? []).includes('New Lead') && c.created_at && (now - new Date(c.created_at).getTime()) < 7 * 86400000);
            const upcomingBdays = clients.filter(c => {
              if (!c.birthday) return false;
              const bday = new Date(c.birthday + 'T00:00:00');
              const base = new Date(); base.setHours(0,0,0,0);
              const thisYearBday = new Date(base.getFullYear(), bday.getMonth(), bday.getDate());
              const next = thisYearBday < base ? new Date(base.getFullYear() + 1, bday.getMonth(), bday.getDate()) : thisYearBday;
              return Math.ceil((next.getTime() - now) / 86400000) <= 14;
            });
            const lxpUrgent = clients.filter(c => {
              if (!c.lease_expiration_date) return false;
              const d = Math.ceil((new Date(c.lease_expiration_date).getTime() - now) / 86400000);
              return d >= 0 && d <= 30;
            });
            const totalAlerts = overdueTasks.length + newLeads.length + upcomingBdays.length + lxpUrgent.length;
            return (
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowNotifications(n => !n)} title="Notifications"
                  style={{ position: 'relative', width: 38, height: 38, borderRadius: 8, border: `1px solid ${totalAlerts > 0 ? '#fde68a' : '#e5e7eb'}`, background: showNotifications ? '#fef9f0' : totalAlerts > 0 ? '#fffbeb' : '#f9fafb', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, transition: 'all .15s' }}>
                  🔔
                  {totalAlerts > 0 && (
                    <span style={{ position: 'absolute', top: 3, right: 3, width: 15, height: 15, borderRadius: '50%', background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #fff' }}>
                      {totalAlerts > 9 ? '9+' : totalAlerts}
                    </span>
                  )}
                </button>
                {showNotifications && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 8999 }} onClick={() => setShowNotifications(false)} />
                    <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 9000, marginTop: 6, width: 340, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.15)', overflow: 'hidden' }}>
                      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#111', fontFamily: "'DM Sans',sans-serif" }}>🔔 Smart Alerts</span>
                        {totalAlerts > 0 && <span style={{ fontSize: 12, color: '#6b7280' }}>{totalAlerts} item{totalAlerts !== 1 ? 's' : ''}</span>}
                      </div>
                      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                        {totalAlerts === 0 && (
                          <div style={{ padding: '28px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                            All clear — no alerts right now
                          </div>
                        )}
                        {overdueTasks.length > 0 && (
                          <div style={{ padding: '10px 16px', borderBottom: '1px solid #f9fafb' }}>
                            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#dc2626', fontWeight: 700, marginBottom: 8 }}>⚠️ Overdue Tasks ({overdueTasks.length})</div>
                            {overdueTasks.slice(0, 4).map(t => (
                              <button key={t.id} onClick={() => { setPage('tasks'); setShowNotifications(false); }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', flexShrink: 0 }} />
                                <span style={{ fontSize: 13, color: '#111', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                                <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, flexShrink: 0 }}>{t.due_date}</span>
                              </button>
                            ))}
                            {overdueTasks.length > 4 && <div style={{ fontSize: 12, color: '#9ca3af', paddingTop: 4 }}>+{overdueTasks.length - 4} more overdue</div>}
                          </div>
                        )}
                        {newLeads.length > 0 && (
                          <div style={{ padding: '10px 16px', borderBottom: '1px solid #f9fafb' }}>
                            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#16a34a', fontWeight: 700, marginBottom: 8 }}>🆕 New Leads — Last 7 Days ({newLeads.length})</div>
                            {newLeads.slice(0, 3).map(c => (
                              <button key={c.id} onClick={() => { setPage('contacts'); setActiveClient(c); setShowNotifications(false); }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                                <span style={{ fontSize: 13, color: '#111', flex: 1 }}>{c.first_name} {c.last_name}</span>
                                <span style={{ fontSize: 11, color: '#6b7280', flexShrink: 0 }}>{c.lead_source || 'Unknown source'}</span>
                              </button>
                            ))}
                            {newLeads.length > 3 && <div style={{ fontSize: 12, color: '#9ca3af', paddingTop: 4 }}>+{newLeads.length - 3} more new leads</div>}
                          </div>
                        )}
                        {upcomingBdays.length > 0 && (
                          <div style={{ padding: '10px 16px', borderBottom: lxpUrgent.length > 0 ? '1px solid #f9fafb' : 'none' }}>
                            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, marginBottom: 8 }}>🎂 Upcoming Birthdays</div>
                            {upcomingBdays.slice(0, 3).map(c => {
                              const bday = new Date(c.birthday! + 'T00:00:00');
                              const base = new Date(); base.setHours(0,0,0,0);
                              const thisYearBday = new Date(base.getFullYear(), bday.getMonth(), bday.getDate());
                              const next = thisYearBday < base ? new Date(base.getFullYear() + 1, bday.getMonth(), bday.getDate()) : thisYearBday;
                              const daysUntil = Math.ceil((next.getTime() - now) / 86400000);
                              return (
                                <button key={c.id} onClick={() => { setPage('contacts'); setActiveClient(c); setShowNotifications(false); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c9922c', flexShrink: 0 }} />
                                  <span style={{ fontSize: 13, color: '#111', flex: 1 }}>{c.first_name} {c.last_name}</span>
                                  <span style={{ fontSize: 11, color: '#c9922c', fontWeight: 700, flexShrink: 0 }}>{daysUntil === 0 ? '🎉 Today!' : `in ${daysUntil}d`}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {lxpUrgent.length > 0 && (
                          <div style={{ padding: '10px 16px' }}>
                            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#c2410c', fontWeight: 700, marginBottom: 8 }}>🗓 LXP Expiring Within 30 Days ({lxpUrgent.length})</div>
                            {lxpUrgent.slice(0, 3).map(c => {
                              const daysLeft = Math.ceil((new Date(c.lease_expiration_date!).getTime() - now) / 86400000);
                              return (
                                <button key={c.id} onClick={() => { setPage('contacts'); setActiveClient(c); setShowNotifications(false); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f97316', flexShrink: 0 }} />
                                  <span style={{ fontSize: 13, color: '#111', flex: 1 }}>{c.first_name} {c.last_name}</span>
                                  <span style={{ fontSize: 11, color: '#c2410c', fontWeight: 700, flexShrink: 0 }}>{daysLeft}d left</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div style={{ padding: '8px 16px', borderTop: '1px solid #f0f0f0', background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>Keyboard shortcut: N (contacts) · C (deals) · / (search)</span>
                        <button onClick={() => setShowNotifications(false)} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Close</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {page === 'deals' && <button className="crm-btn crm-btn-gold" onClick={() => setShowAddDeal(true)}>+ New Deal</button>}
          {page === 'contacts' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {selectedClientIds.size > 0 && (
                <span style={{ fontSize: 13, color: '#6b7280', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20, padding: '3px 10px', fontWeight: 500 }}>
                  {selectedClientIds.size} selected
                </span>
              )}
              <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={exportClients} title={selectedClientIds.size > 0 ? `Export ${selectedClientIds.size} selected` : 'Export all clients to CSV'} style={{ fontSize: 13 }}>
                ⬇ Export{selectedClientIds.size > 0 ? ` (${selectedClientIds.size})` : ' All'}
              </button>
              <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => importFileRef.current?.click()} title="Import from XLSX or CSV" style={{ fontSize: 13 }}>⬆ Import</button>
              <button className="crm-btn crm-btn-gold" onClick={() => setShowAddClient(true)}>+ Add Client</button>
            </div>
          )}
          {page === 'agents' && isAdmin && <button className="crm-btn crm-btn-gold" onClick={() => setShowInvite(true)}>+ Invite Agent</button>}
          {page === 'commissions' && isAdmin && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* View toggle */}
              <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 7, padding: 2, gap: 2 }}>
                {(['list', '1099'] as const).map(v => (
                  <button key={v} onClick={() => setCommissionView(v)}
                    style={{ padding: '5px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", background: commissionView === v ? '#fff' : 'transparent', color: commissionView === v ? '#111' : '#6b7280', boxShadow: commissionView === v ? '0 1px 3px rgba(0,0,0,.1)' : 'none', transition: 'all .15s' }}>
                    {v === 'list' ? '📋 List' : '📄 1099'}
                  </button>
                ))}
              </div>
              {commissionView === 'list' && (
                <button className="crm-btn crm-btn-ghost crm-btn-sm" style={{ fontSize: 13 }} onClick={() => {
                  const filtered = allCommissions.filter(c =>
                    (!commissionFilterYear || c.close_date?.startsWith(commissionFilterYear)) &&
                    (!commissionFilterAgent || c.agent_id === commissionFilterAgent) &&
                    (!commissionFilterStatus || c.status === commissionFilterStatus)
                  );
                  const rows = [
                    ['Deal', 'Property', 'Agent', 'Deal Type', 'Sale Price', 'Rate %', 'Gross GCI', 'Agent Split %', 'Agent Net', 'Brokerage Net', 'Referral Fee', 'Referral To', 'Tx Fee', 'Status', 'Close Date', 'Paid Date', 'Notes'],
                    ...filtered.map(c => [
                      c.deal?.client ?? '', c.deal?.property ?? '',
                      c.agent ? `${c.agent.first_name} ${c.agent.last_name}` : '',
                      c.deal_type ?? '', c.sale_price, c.commission_rate,
                      c.gross_commission, c.agent_split, c.agent_net, c.brokerage_net,
                      c.referral_fee, c.referral_to ?? '', c.transaction_fee,
                      c.status, c.close_date ?? '', c.paid_date ?? '', c.notes ?? '',
                    ]),
                  ];
                  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url;
                  a.download = `commissions-${commissionFilterYear || 'all'}.csv`; a.click();
                  URL.revokeObjectURL(url);
                }}>⬇ Export CSV</button>
              )}
              {commissionView === '1099' && (
                <button className="crm-btn crm-btn-ghost crm-btn-sm" style={{ fontSize: 13 }} onClick={() => window.print()}>🖨 Print</button>
              )}
            </div>
          )}
        </div>}

        {/* Content */}
        <div style={{ flex: 1, overflowY: (page === 'calendar' && !isMobile) ? 'hidden' : 'auto', padding: page === 'calendar' || page === 'campaigns' ? 0 : isMobile ? 14 : 26 }} onClick={() => { setAssetDropdownOpen(null); }}>

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
                    <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, fontWeight: 700, color: '#111', lineHeight: 1 }}>{s.val}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* YTD Commission widget */}
              {allCommissions.length > 0 && (() => {
                const thisYear = new Date().getFullYear().toString();
                const ytd = allCommissions.filter(c => c.close_date?.startsWith(thisYear));
                const totalGCI = ytd.reduce((s, c) => s + (c.gross_commission ?? 0), 0);
                const totalAgentNet = ytd.reduce((s, c) => s + (c.agent_net ?? 0), 0);
                const totalBrokerNet = ytd.reduce((s, c) => s + (c.brokerage_net ?? 0), 0);
                const paidCount = ytd.filter(c => c.status === 'paid').length;
                const pendingCount = ytd.filter(c => c.status === 'pending').length;
                const fmt = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}K` : `$${n.toFixed(0)}`;
                return (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8dcc8', padding: '16px 20px', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600 }}>💰 {thisYear} Commission Summary</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {paidCount > 0 && <span style={{ padding: '2px 9px', borderRadius: 10, fontSize: 12, fontWeight: 600, background: '#d1fae5', color: '#065f46' }}>✓ {paidCount} paid</span>}
                        {pendingCount > 0 && <span style={{ padding: '2px 9px', borderRadius: 10, fontSize: 12, fontWeight: 600, background: '#fef3c7', color: '#92400e' }}>{pendingCount} pending</span>}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3,1fr)', gap: 10 }}>
                      {[
                        { label: 'Gross GCI', val: totalGCI, color: '#c9922c' },
                        { label: 'Agent Net', val: totalAgentNet, color: '#059669' },
                        { label: 'Brokerage Net', val: totalBrokerNet, color: '#374151' },
                      ].map(s => (
                        <div key={s.label} style={{ background: '#f9f5ef', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, marginBottom: 4 }}>{s.label}</div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'Cormorant Garamond',serif" }}>{fmt(s.val)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Commission Pipeline Forecast */}
              {deals.some(d => ['Active', 'In Contract'].includes(d.stage) && d.value > 0) && (() => {
                const fmtC = (n: number) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(1)}K` : `$${n.toFixed(0)}`;
                const RATE = 0.03;
                const inContract = deals.filter(d => d.stage === 'In Contract' && d.value > 0);
                const activePipe = deals.filter(d => d.stage === 'Active' && d.value > 0);
                const contractGCI = inContract.reduce((s, d) => s + d.value * RATE, 0);
                const pipeGCI = activePipe.reduce((s, d) => s + d.value * RATE, 0);
                const totalPipeVal = inContract.reduce((s, d) => s + d.value, 0) + activePipe.reduce((s, d) => s + d.value, 0);
                return (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: '16px 20px', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600 }}>📈 Commission Pipeline Forecast</div>
                      <span style={{ fontSize: 12, color: '#9ca3af' }}>est. at 3% avg rate</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3,1fr)', gap: 10, marginBottom: inContract.length > 0 ? 14 : 0 }}>
                      {[
                        { label: 'In Contract GCI', val: contractGCI, color: '#c9922c', count: inContract.length },
                        { label: 'Active Pipeline GCI', val: pipeGCI, color: '#3b82f6', count: activePipe.length },
                        { label: 'Total Pipeline Value', val: totalPipeVal, color: '#374151', count: inContract.length + activePipe.length },
                      ].map(s => (
                        <div key={s.label} style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, marginBottom: 4 }}>{s.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "'Cormorant Garamond',serif" }}>{fmtC(s.val)}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{s.count} deal{s.count !== 1 ? 's' : ''}</div>
                        </div>
                      ))}
                    </div>
                    {inContract.length > 0 && (
                      <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                        <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>Deals In Contract</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {inContract.slice(0, 5).map(d => (
                            <button key={d.id} onClick={() => { setPage('deals'); openDeal(d); }}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#fef9f0', border: '1px solid #fde68a', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#111', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.client}{d.property ? ` — ${d.property}` : ''}</span>
                              <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>{fmtC(d.value)}</span>
                              <span style={{ fontSize: 12, color: '#c9922c', flexShrink: 0, fontWeight: 700 }}>~{fmtC(d.value * RATE)} GCI</span>
                            </button>
                          ))}
                          {inContract.length > 5 && <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>+{inContract.length - 5} more in contract</div>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Contact type breakdown */}
              {clients.length > 0 && (() => {
                const typeBreakdown = CLIENT_TYPES.map(t => ({ type: t, count: clients.filter(c => c.type === t).length })).filter(x => x.count > 0);
                const total = clients.length;
                return (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: '16px 20px', marginBottom: 26 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600 }}>Contacts by Type</div>
                      <button onClick={() => setPage('contacts')} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>View all {total} →</button>
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
                            <span style={{ fontSize: 13, color: '#374151' }}>{emoji} {type}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{count}</span>
                            <span style={{ fontSize: 12, color: '#9ca3af' }}>({Math.round(count / total * 100)}%)</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* LXP Expiration Alert widget */}
              {(() => {
                const now = Date.now();
                const lxpTenants = clients
                  .filter(c => c.type === 'Tenant' && c.lease_expiration_date)
                  .map(c => {
                    const daysLeft = Math.ceil((new Date(c.lease_expiration_date!).getTime() - now) / (1000 * 60 * 60 * 24));
                    return { ...c, daysLeft };
                  })
                  .filter(c => c.daysLeft <= 180) // only show expiring within 6 months or already expired
                  .sort((a, b) => a.daysLeft - b.daysLeft); // soonest first

                if (lxpTenants.length === 0) return null;

                const expired   = lxpTenants.filter(c => c.daysLeft < 0).length;
                const within90  = lxpTenants.filter(c => c.daysLeft >= 0 && c.daysLeft < 90).length;
                const within180 = lxpTenants.filter(c => c.daysLeft >= 90 && c.daysLeft <= 180).length;
                const show = lxpTenants.slice(0, 5);

                return (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #fed7aa', padding: '16px 20px', marginBottom: 26 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#c2410c', fontWeight: 600 }}>
                        🗓 Lease Expirations — {lxpTenants.length} Tenant{lxpTenants.length !== 1 ? 's' : ''}
                      </div>
                      <button
                        onClick={() => { setPage('contacts'); setContactTypeFilter('Tenant'); }}
                        style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>
                        View All Tenants →
                      </button>
                    </div>
                    {/* Tier pills */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                      {expired   > 0 && <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: '#fee2e2', color: '#dc2626' }}>🔴 Expired: {expired}</span>}
                      {within90  > 0 && <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: '#fed7aa', color: '#c2410c' }}>🟠 &lt;90 days: {within90}</span>}
                      {within180 > 0 && <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: '#fef9c3', color: '#a16207' }}>🟡 90–180 days: {within180}</span>}
                    </div>
                    {/* Top 5 soonest */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {show.map(c => {
                        const bg    = c.daysLeft < 0 ? '#fee2e2' : c.daysLeft < 90 ? '#fff7ed' : '#fefce8';
                        const color = c.daysLeft < 0 ? '#dc2626' : c.daysLeft < 90 ? '#c2410c' : '#a16207';
                        const label = c.daysLeft < 0 ? `Expired ${Math.abs(c.daysLeft)}d ago` : c.daysLeft === 0 ? 'Expires today' : `${c.daysLeft}d left`;
                        return (
                          <button key={c.id}
                            onClick={() => { setPage('contacts'); setActiveClient(c); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                            <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                              {(c.first_name[0] ?? '') + (c.last_name[0] ?? '')}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.first_name} {c.last_name}</div>
                              <div style={{ fontSize: 11, color: '#6b7280' }}>
                                {c.business_name ? `${c.business_name} · ` : ''}LXP {new Date(c.lease_expiration_date!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </div>
                            </div>
                            <span style={{ fontSize: 12, padding: '2px 9px', borderRadius: 10, background: bg, color, fontWeight: 700, flexShrink: 0 }}>
                              {label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {lxpTenants.length > 5 && (
                      <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                        +{lxpTenants.length - 5} more — <button onClick={() => { setPage('contacts'); setContactTypeFilter('Tenant'); }} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', fontFamily: "'DM Sans',sans-serif" }}>view all</button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Needs Attention widget — Tenants never touched */}
              {(() => {
                // Only surface Tenants who have never been contacted at all.
                // Outside-broker deals can go untouched for months by design,
                // so we skip the time-based tiers and focus purely on "never touched" Tenants.
                const neverTouchedTenants = clients
                  .filter(c => c.type === 'Tenant' && !c.last_touched_at)
                  .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // oldest first
                if (neverTouchedTenants.length === 0) return null;
                const show = neverTouchedTenants.slice(0, 5);
                return (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #fee2e2', padding: '16px 20px', marginBottom: 26 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#dc2626', fontWeight: 600 }}>
                        🔑 Tenants Never Contacted — {neverTouchedTenants.length}
                      </div>
                      <button
                        onClick={() => { setPage('contacts'); setContactTypeFilter('Tenant'); setContactSort('never'); }}
                        style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>
                        View All →
                      </button>
                    </div>
                    <div style={{ marginBottom: 10, fontSize: 12, color: '#6b7280' }}>
                      These tenants have been added but never had a call, email, or note logged.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {show.map(c => (
                        <button key={c.id}
                          onClick={() => { setPage('contacts'); setActiveClient(c); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                            {(c.first_name[0] ?? '') + (c.last_name[0] ?? '')}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.first_name} {c.last_name}</div>
                            <div style={{ fontSize: 11, color: '#6b7280' }}>
                              {c.business_name ? `${c.business_name} · ` : ''}Added {new Date(c.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          <span style={{ fontSize: 12, padding: '2px 9px', borderRadius: 10, background: '#fee2e2', color: '#dc2626', fontWeight: 700, flexShrink: 0 }}>
                            Never
                          </span>
                        </button>
                      ))}
                    </div>
                    {neverTouchedTenants.length > 5 && (
                      <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                        +{neverTouchedTenants.length - 5} more — <button onClick={() => { setPage('contacts'); setContactTypeFilter('Tenant'); setContactSort('never'); }} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', fontFamily: "'DM Sans',sans-serif" }}>view all</button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Overdue Tasks widget */}
              {(() => {
                const overdue = allTasks.filter(t => t.due_date && t.due_date < today());
                if (overdue.length === 0) return null;
                return (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #fecaca', padding: '16px 20px', marginBottom: 26 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#dc2626', fontWeight: 600 }}>
                        ⚠️ Overdue Tasks — {overdue.length}
                      </div>
                      <button onClick={() => { setPage('tasks'); loadTasks(); }} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>View All Tasks →</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {overdue.slice(0, 5).map(t => {
                        const client = clients.find(c => c.id === t.client_id);
                        const daysOverdue = Math.floor((Date.now() - new Date(t.due_date!).getTime()) / (1000 * 60 * 60 * 24));
                        return (
                          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                            <span style={{ fontSize: 14 }}>{t.type === 'call' ? '📞' : t.type === 'email' ? '✉️' : '📝'}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                              {client && <div style={{ fontSize: 11, color: '#6b7280' }}>{client.first_name} {client.last_name}</div>}
                            </div>
                            <span style={{ fontSize: 12, padding: '2px 9px', borderRadius: 10, background: '#fee2e2', color: '#dc2626', fontWeight: 700, flexShrink: 0 }}>{daysOverdue}d overdue</span>
                            <button onClick={() => completeTask(t.id)} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#16a34a', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>Done ✓</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <KanbanBoard deals={deals} isAdmin={isAdmin} agentName={agentName} draggedDealId={draggedDealId} dragOverStage={dragOverStage} setDraggedDealId={setDraggedDealId} setDragOverStage={setDragOverStage} handleDrop={handleDrop} openDeal={openDeal} isMobile={isMobile} onAddDeal={() => setShowAddDeal(true)} />
            </div>
          )}

          {/* ── Deals ── */}
          {page === 'deals' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                {['', ...DEAL_TYPES].map(t => (
                  <button key={t} onClick={() => setFilter(t)}
                    style={{ padding: '5px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: '1px solid', background: filter === t ? '#111' : '#fff', color: filter === t ? '#fff' : '#6b7280', borderColor: filter === t ? '#111' : '#ddd', fontFamily: "'DM Sans',sans-serif" }}>
                    {t || 'All'}
                  </button>
                ))}
                <input className="crm-input" placeholder="🔍  Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginLeft: 'auto', width: 200 }} />
              </div>
              <KanbanBoard deals={filteredDeals} isAdmin={isAdmin} agentName={agentName} draggedDealId={draggedDealId} dragOverStage={dragOverStage} setDraggedDealId={setDraggedDealId} setDragOverStage={setDragOverStage} handleDrop={handleDrop} openDeal={openDeal} isMobile={isMobile} onAddDeal={() => setShowAddDeal(true)} />
            </div>
          )}

          {/* ── Prospects ── */}
          {page === 'prospects' && (() => {
            const SOURCE_COLORS: Record<string, { bg: string; color: string; emoji: string }> = {
              'LoopNet':     { bg: '#fff7ed', color: '#c2410c', emoji: '🔶' },
              'Crexi':       { bg: '#f0fdf4', color: '#15803d', emoji: '🟢' },
              'CoStar':      { bg: '#eff6ff', color: '#1d4ed8', emoji: '🔵' },
              '42Floors':    { bg: '#faf5ff', color: '#7e22ce', emoji: '🟣' },
              'Zillow':      { bg: '#fff1f2', color: '#be123c', emoji: '🏠' },
              'Realtor.com': { bg: '#fff1f2', color: '#dc2626', emoji: '🔑' },
              'Website':     { bg: '#f0fdf4', color: '#15803d', emoji: '🌐' },
            };
            const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'converted', 'lost'];
            const filtered = prospects.filter(p => prospectStatusFilter === 'all' || p.client?.prospect_status === prospectStatusFilter);
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 4 }}>Prospects</h2>
                    <p style={{ fontSize: 14, color: '#6b7280' }}>Auto-imported leads from {businessUnit === 'commercial' ? 'LoopNet, Crexi, CoStar & 42Floors' : 'Zillow, Realtor.com & Website'}</p>
                  </div>
                  <button className="crm-btn crm-btn-gold" onClick={syncEmailLeads} style={{ fontSize: 14 }}>🔄 Sync Now</button>
                </div>

                {/* Status filter pills */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
                  {['all', ...STATUS_OPTIONS].map(s => (
                    <button key={s} onClick={() => setProspectStatusFilter(s)}
                      style={{ padding: '4px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", border: '1px solid', borderColor: prospectStatusFilter === s ? '#c9922c' : '#e5e7eb', background: prospectStatusFilter === s ? '#c9922c' : '#fff', color: prospectStatusFilter === s ? '#111' : '#6b7280', textTransform: 'capitalize' }}>
                      {s === 'all' ? `All (${prospects.length})` : `${s} (${prospects.filter(p => p.client?.prospect_status === s).length})`}
                    </button>
                  ))}
                </div>

                {prospectsLoading ? (
                  <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Loading prospects…</div>
                ) : filtered.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 60, background: '#f9fafb', borderRadius: 12, border: '2px dashed #e5e7eb' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 6 }}>No prospects yet</div>
                    <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>Connect Gmail in Settings and leads will auto-import every 15 minutes</div>
                    <button className="crm-btn crm-btn-gold" onClick={syncEmailLeads}>🔄 Sync Now</button>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(340px,1fr))' }}>
                    {filtered.map(p => {
                      const src = SOURCE_COLORS[p.source] ?? { bg: '#f9fafb', color: '#374151', emoji: '📧' };
                      const c = p.client;
                      const name = c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() : p.parsed_name ?? 'Unknown';
                      const importedAgo = p.created_at ? (() => {
                        const diff = Date.now() - new Date(p.created_at).getTime();
                        const mins = Math.floor(diff / 60000);
                        const hrs = Math.floor(diff / 3600000);
                        const days = Math.floor(diff / 86400000);
                        return days > 0 ? `${days}d ago` : hrs > 0 ? `${hrs}h ago` : `${mins}m ago`;
                      })() : '';
                      return (
                        <div key={p.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,.04)', borderLeft: `4px solid ${src.color}` }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                            <div>
                              <span style={{ background: src.bg, color: src.color, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                                {src.emoji} {p.source}
                              </span>
                              <div style={{ fontWeight: 700, fontSize: 15, color: '#111', lineHeight: 1.3 }}>{name || 'Unknown Contact'}</div>
                              {c?.email && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{c.email}</div>}
                              {c?.phone && <div style={{ fontSize: 13, color: '#6b7280' }}>{c.phone}</div>}
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>{importedAgo}</div>
                              <select value={c?.prospect_status ?? 'new'} onChange={e => c && updateProspectStatus(c.id, e.target.value)}
                                style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', fontFamily: "'DM Sans',sans-serif", cursor: 'pointer', color: '#374151', textTransform: 'capitalize' }}>
                                {STATUS_OPTIONS.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
                              </select>
                            </div>
                          </div>
                          {p.parsed_property && (
                            <div style={{ fontSize: 13, color: '#374151', background: '#f9fafb', borderRadius: 6, padding: '6px 10px', marginBottom: 10 }}>
                              🏢 {p.parsed_property.length > 80 ? p.parsed_property.slice(0, 80) + '…' : p.parsed_property}
                            </div>
                          )}
                          {p.parsed_message && (
                            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10, lineHeight: 1.5, fontStyle: 'italic' }}>
                              "{p.parsed_message.length > 120 ? p.parsed_message.slice(0, 120) + '…' : p.parsed_message}"
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {c?.phone && (
                              <a href={`tel:${c.phone}`} className="crm-btn crm-btn-sm" style={{ fontSize: 13, padding: '5px 12px', textDecoration: 'none' }}>📞 Call</a>
                            )}
                            {c?.email && (
                              <a href={`mailto:${c.email}`} className="crm-btn crm-btn-sm" style={{ fontSize: 13, padding: '5px 12px', textDecoration: 'none' }}>✉️ Email</a>
                            )}
                            {c && (
                              <button className="crm-btn crm-btn-sm" style={{ fontSize: 13, padding: '5px 12px' }}
                                onClick={() => { loadClients(); setPage('contacts'); setTimeout(() => { setActiveClient(c as any); }, 500); }}>
                                👤 View
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Clients ── */}
          {page === 'contacts' && (
            <div>
              {/* Smart Filter Bar */}
              {clients.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {/* Saved Smart Lists */}
                  {smartLists.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Saved lists</span>
                      {smartLists.map(sl => (
                        <button key={sl.id} onClick={() => applySmartList(sl)}
                          style={{ padding: '4px 10px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: '1px solid #e2e8f0', background: '#fff', color: '#374151', fontFamily: "'DM Sans',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 500, transition: 'border-color .15s' }}>
                          <span style={{ fontSize: 12 }}>📋</span> {sl.name}
                          <span onClick={e => { e.stopPropagation(); deleteSmartList(sl.id); }} style={{ color: '#94a3b8', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>✕</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Filter row */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Type filter */}
                    <select value={contactTypeFilter} onChange={e => setContactTypeFilter(e.target.value)} className={`cf-select${contactTypeFilter ? ' active' : ''}`}>
                      <option value="">All Types</option>
                      {['Buyer','Seller','Tenant','Landlord/Investor','Agent','Broker'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {/* Lead source filter */}
                    <select value={contactSourceFilter} onChange={e => setContactSourceFilter(e.target.value)} className={`cf-select${contactSourceFilter ? ' active' : ''}`}>
                      <option value="">All Sources</option>
                      {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {/* Specialization filter */}
                    <select value={contactSpecFilter} onChange={e => setContactSpecFilter(e.target.value)} className={`cf-select${contactSpecFilter ? ' active' : ''}`}>
                      <option value="">All Asset Types</option>
                      {ASSET_TYPES.map(at => <option key={at} value={at}>{at}</option>)}
                    </select>
                    {/* Owner / agent filter — admin only */}
                    {isAdmin && profiles.length > 0 && (
                      <select value={contactOwnerFilter} onChange={e => setContactOwnerFilter(e.target.value)} className={`cf-select${contactOwnerFilter ? ' active' : ''}`}>
                        <option value="">All Owners</option>
                        {profiles.map(p => (
                          <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                        ))}
                      </select>
                    )}
                    {/* Sort order */}
                    <select value={contactSort} onChange={e => setContactSort(e.target.value as typeof contactSort)} className="cf-select">
                      <option value="recent">Most Recent</option>
                      <option value="never">Never Contacted</option>
                      <option value="az">A → Z</option>
                      <option value="added">Newest Added</option>
                    </select>
                    {/* Tag filter */}
                    <input placeholder="Filter by tag…" value={contactTagFilter} onChange={e => setContactTagFilter(e.target.value)}
                      className={`cf-tag-input${contactTagFilter ? ' active' : ''}`} style={{ width: 140 }} />
                    {/* Clear */}
                    {(contactTypeFilter || contactSourceFilter || contactTagFilter || contactSpecFilter || contactOwnerFilter) && (
                      <button onClick={() => { setContactTypeFilter(''); setContactSourceFilter(''); setContactTagFilter(''); setContactSpecFilter(''); setContactOwnerFilter(''); }}
                        style={{ fontSize: 13, color: '#6b7280', background: 'none', border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                        Clear
                      </button>
                    )}
                    {/* Save as Smart List */}
                    {(contactTypeFilter || contactSourceFilter || contactTagFilter || contactSpecFilter || contactOwnerFilter) && !showSaveList && (
                      <button onClick={() => setShowSaveList(true)}
                        style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid #c9922c', fontSize: 13, background: '#fffbf2', color: '#92400e', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>
                        Save as List
                      </button>
                    )}
                    {showSaveList && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input autoFocus placeholder="List name…" value={newListName} onChange={e => setNewListName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveSmartList(); if (e.key === 'Escape') setShowSaveList(false); }}
                          className="cf-tag-input active" style={{ width: 140 }} />
                        <button onClick={saveSmartList} style={{ padding: '5px 12px', borderRadius: 6, background: '#c9922c', color: '#fff', border: 'none', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>Save</button>
                        <button onClick={() => setShowSaveList(false)} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>✕</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {clients.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0' }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600, color: '#111', marginBottom: 8 }}>No clients yet</div>
                  <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>Add buyers, sellers, tenants, landlords, and outside brokers/agents — all in one place.</div>
                  <button className="crm-btn crm-btn-gold" onClick={() => setShowAddClient(true)}>+ Add First Client</button>
                </div>
              ) : (() => {
                const filteredContacts = clients.filter(c => {
                  if (contactTypeFilter && c.type !== contactTypeFilter) return false;
                  if (contactSourceFilter && c.lead_source !== contactSourceFilter) return false;
                  if (contactTagFilter && !(c.tags ?? []).some(t => t.toLowerCase().includes(contactTagFilter.toLowerCase()))) return false;
                  if (contactSpecFilter && !(c.asset_types ?? []).includes(contactSpecFilter)) return false;
                  if (contactOwnerFilter && c.agent_id !== contactOwnerFilter) return false;
                  return true;
                }).sort((a, b) => {
                  if (contactSort === 'recent') {
                    if (!a.last_touched_at && !b.last_touched_at) return 0;
                    if (!a.last_touched_at) return 1;
                    if (!b.last_touched_at) return -1;
                    return new Date(b.last_touched_at).getTime() - new Date(a.last_touched_at).getTime();
                  }
                  if (contactSort === 'never') {
                    if (!a.last_touched_at && !b.last_touched_at) return 0;
                    if (!a.last_touched_at) return -1;
                    if (!b.last_touched_at) return 1;
                    return new Date(a.last_touched_at).getTime() - new Date(b.last_touched_at).getTime();
                  }
                  if (contactSort === 'az') {
                    const nameA = `${a.last_name}${a.first_name}`.toLowerCase();
                    const nameB = `${b.last_name}${b.first_name}`.toLowerCase();
                    return nameA.localeCompare(nameB);
                  }
                  // 'added' — newest added first
                  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                });
                return isMobile ? (
              /* ── Mobile Contact Cards ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredContacts.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No contacts match these filters.</div>}
                {filteredContacts.map(c => {
                  const ta = timeAgo(c.last_touched_at);
                  const clientDeals = deals.filter(d => d.client_id === c.id);
                  const activeDeals = clientDeals.filter(d => ['Active', 'LOI', 'In Contract'].includes(d.stage));
                  return (
                    <div key={c.id} onClick={() => setActiveClient(c)}
                      style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                        <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                          {(c.first_name[0] ?? '') + (c.last_name[0] ?? '')}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 2 }}>{c.first_name} {c.last_name}</div>
                          {c.business_name && <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 4 }}>{c.business_name}</div>}
                          <span style={{ ...Object.fromEntries((CLIENT_TYPE_COLORS[c.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '1px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 } as React.CSSProperties}>{c.type}</span>
                        </div>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: ta.bg, color: ta.color, fontWeight: 700, flexShrink: 0, alignSelf: 'flex-start' }}>{ta.label}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {c.email && (
                          <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()}
                            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, color: '#c9922c', textDecoration: 'none', padding: '5px 0' }}>
                            <span>✉️</span> {c.email}
                          </a>
                        )}
                        {(c.phone || c.cell_phone) && (
                          <a href={`tel:${c.cell_phone || c.phone}`} onClick={e => e.stopPropagation()}
                            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, color: '#374151', textDecoration: 'none', padding: '5px 0' }}>
                            <span>📞</span> {c.cell_phone || c.phone}
                          </a>
                        )}
                      </div>
                      {(activeDeals.length > 0 || c.budget || (c.asset_types ?? []).length > 0) && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {activeDeals.length > 0 && (
                            <span style={{ fontSize: 12, background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                              {activeDeals.length} active deal{activeDeals.length > 1 ? 's' : ''}
                            </span>
                          )}
                          {c.budget && <span style={{ fontSize: 12, background: '#f0fdf4', color: '#166534', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>💰 {c.budget}</span>}
                          {(c.asset_types ?? []).slice(0, 2).map(at => (
                            <span key={at} style={{ fontSize: 12, background: '#fef3e2', color: '#92400e', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{at}</span>
                          ))}
                          {(c.asset_types ?? []).length > 2 && <span style={{ fontSize: 12, color: '#9ca3af' }}>+{(c.asset_types ?? []).length - 2} more</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
                <>
                {/* Bulk action bar — admin only */}
                {isAdmin && selectedClientIds.size > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '10px 14px', background: '#fef9f0', border: '1px solid #f0d9a8', borderRadius: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#92400e' }}>
                      {selectedClientIds.size} contact{selectedClientIds.size !== 1 ? 's' : ''} selected
                    </span>
                    <button
                      onClick={() => { loadCampaigns(); setShowBulkEnrollModal(true); }}
                      style={{ background: '#c9922c', color: '#111', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      📣 Enroll in Campaign
                    </button>
                    <button
                      onClick={() => { setBulkReassignTarget(''); setShowBulkReassign(true); }}
                      style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 6, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      👤 Reassign
                    </button>
                    <button
                      onClick={massDeleteClients}
                      style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      🗑 Delete Selected
                    </button>
                    <button
                      onClick={() => setSelectedClientIds(new Set())}
                      style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                      Clear selection
                    </button>
                  </div>
                )}
                <div style={{ overflowX: 'auto' }}>
                  <table className="contacts-table">
                    <colgroup>
                      <col className="col-check" />
                      <col className="col-name" />
                      <col className="col-email" />
                      <col className="col-phone" />
                      <col className="col-deals" />
                      {isAdmin && <col className="col-owner" />}
                      <col className="col-touch" />
                      <col className="col-source" />
                      <col className="col-actions" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ width: 36, paddingRight: 0 }}>
                          <input
                            type="checkbox"
                            title={selectedClientIds.size === filteredContacts.length ? 'Deselect all' : 'Select all'}
                            checked={filteredContacts.length > 0 && selectedClientIds.size === filteredContacts.length}
                            ref={el => { if (el) el.indeterminate = selectedClientIds.size > 0 && selectedClientIds.size < filteredContacts.length; }}
                            onChange={e => {
                              if (e.target.checked) setSelectedClientIds(new Set(filteredContacts.map(c => c.id)));
                              else setSelectedClientIds(new Set());
                            }}
                            style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#c9922c' }}
                          />
                        </th>
                        <th>Contact</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Deals</th>
                        {isAdmin && <th>Owner</th>}
                        <th>Last Touch</th>
                        <th>Source</th>
                        <th style={{ width: 90 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredContacts.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No contacts match these filters.</td></tr>}
                      {filteredContacts.map(c => {
                        const clientDeals = deals.filter(d => d.client_id === c.id);
                        const activeDeals = clientDeals.filter(d => ['Active', 'LOI', 'In Contract'].includes(d.stage));
                        const taggedAgents = (c.assigned_agent_ids ?? []).map(aid => profiles.find(p => p.id === aid)).filter(Boolean) as Profile[];
                        const canTag = isAdmin || c.agent_id === profile!.id;

                        // Avatar gradient based on first letter
                        const avatarColors: Record<string, string> = {
                          A:'#667eea,#764ba2', B:'#f093fb,#f5576c', C:'#4facfe,#00f2fe',
                          D:'#43e97b,#38f9d7', E:'#fa709a,#fee140', F:'#a18cd1,#fbc2eb',
                          G:'#fccb90,#d57eeb', H:'#a1c4fd,#c2e9fb', I:'#fd7043,#ff8a65',
                          J:'#66bb6a,#43a047', K:'#ab47bc,#8e24aa', L:'#26c6da,#00acc1',
                          M:'#ef5350,#e53935', N:'#7e57c2,#673ab7', O:'#ff7043,#f4511e',
                          P:'#26a69a,#00897b', Q:'#d4ac0d,#b7950b', R:'#5c6bc0,#3949ab',
                          S:'#ec407a,#d81b60', T:'#29b6f6,#039be5', U:'#9ccc65,#7cb342',
                          V:'#ff8a65,#f4511e', W:'#26c6da,#0097a7', X:'#ab47bc,#7b1fa2',
                          Y:'#ffca28,#ffb300', Z:'#78909c,#546e7a',
                        };
                        const rowInitials = (c.first_name[0] ?? '') + (c.last_name[0] ?? '');
                        const avatarPair = (avatarColors[(c.first_name[0] ?? 'A').toUpperCase()] ?? '#c9922c,#a07020').split(',');
                        const avatarG1 = avatarPair[0];
                        const avatarG2 = avatarPair[1];

                        return (
                          <tr key={c.id} style={{ background: selectedClientIds.has(c.id) ? '#fffbf2' : undefined }}>
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
                            {/* Name + Type pill inline */}
                            <td onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 34, height: 34, borderRadius: '50%', background: `linear-gradient(135deg, ${avatarG1}, ${avatarG2})`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Cormorant Garamond',serif", fontSize: 14, fontWeight: 700, flexShrink: 0, letterSpacing: .5 }}>
                                  {rowInitials}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <button
                                    onClick={e => { e.stopPropagation(); setActiveClient(c); }}
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', display: 'block', maxWidth: '100%' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ fontWeight: 600, color: '#111', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {c.first_name} {c.last_name}
                                      </span>
                                      {c.is_shared && <span title="Team contact — visible to all agents" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, background: '#ede9fe', color: '#6d28d9', borderRadius: 6, padding: '1px 5px', flexShrink: 0, textTransform: 'uppercase' }}>Team</span>}
                                    </div>
                                    {c.business_name && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.business_name}</div>}
                                  </button>
                                  {/* Type pill — inline select below name */}
                                  {(() => {
                                    const typeStyle = Object.fromEntries((CLIENT_TYPE_COLORS[c.type] || 'background:#f3f4f6;color:#374151').split(';').filter(Boolean).map(s => s.split(':').map(p => p.trim()))) as React.CSSProperties;
                                    return (
                                      <div style={{ position: 'relative', display: 'inline-block', marginTop: 3 }} title="Change contact type">
                                        {/* Visual span — matches source pill exactly */}
                                        <span style={{ ...typeStyle, display: 'inline-block', padding: '2px 7px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, lineHeight: 1.4, pointerEvents: 'none' }}>
                                          {c.type}
                                        </span>
                                        {/* Invisible select overlay for dropdown */}
                                        <select
                                          value={c.type}
                                          onChange={async e => {
                                            const newType = e.target.value as Client['type'];
                                            await supabase.from('crm_clients').update({ type: newType }).eq('id', c.id);
                                            setClients(prev => prev.map(x => x.id === c.id ? { ...x, type: newType } : x));
                                          }}
                                          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                                        >
                                          {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </td>

                            {/* Email */}
                            <td style={{ fontSize: 13 }}>
                              {c.email ? <a href={`mailto:${c.email}`} style={{ color: '#c9922c', textDecoration: 'none' }}>{c.email}</a> : '—'}
                            </td>

                            {/* Phone */}
                            <td style={{ fontSize: 13 }}>
                              {c.phone ? <a href={`tel:${c.phone}`} style={{ color: '#374151', textDecoration: 'none' }}>{c.phone}</a> : '—'}
                            </td>

                            {/* Active deals */}
                            <td style={{ fontSize: 13 }}>
                              {activeDeals.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  {activeDeals.map(d => (
                                    <button key={d.id} onClick={() => openDeal(d)}
                                      style={{ background: 'none', border: 'none', color: '#c9922c', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline' }}>
                                      {d.property || d.type.split(' ')[0]}
                                    </button>
                                  ))}
                                </div>
                              ) : clientDeals.length > 0 ? (
                                <span style={{ color: '#9ca3af' }}>{clientDeals.length} deal{clientDeals.length !== 1 ? 's' : ''}</span>
                              ) : (
                                <button onClick={() => { setNd({ client_id: c.id, client: `${c.first_name} ${c.last_name}`, client_email: c.email, client_phone: c.phone, type: CLIENT_TYPE_TO_DEAL[c.type] || 'Buyer Purchase', property: '', value: 0, notes: '' }); setShowAddDeal(true); }}
                                  style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 4, color: '#6b7280', fontSize: 12, cursor: 'pointer', padding: '2px 8px' }}>
                                  + New Deal
                                </button>
                              )}
                            </td>


                            {/* Owner agent (admin only) — click to reassign */}
                            {isAdmin && (
                              <td style={{ fontSize: 13 }} onClick={e => e.stopPropagation()}>
                                <div style={{ position: 'relative', display: 'inline-block' }} title="Change owner">
                                  <span style={{ display: 'inline-block', background: '#f3f4f6', color: '#374151', padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                                    {agentName(c.agent_id)}
                                  </span>
                                  <select
                                    value={c.agent_id}
                                    onChange={async e => {
                                      const newOwnerId = e.target.value;
                                      await supabase.from('crm_clients').update({ agent_id: newOwnerId }).eq('id', c.id);
                                      setClients(prev => prev.map(x => x.id === c.id ? { ...x, agent_id: newOwnerId } : x));
                                    }}
                                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                                  >
                                    {profiles.map(p => (
                                      <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                                    ))}
                                  </select>
                                </div>
                              </td>
                            )}

                            {/* Date added */}
                            {/* Last Contact */}
                            <td>
                              {(() => {
                                const ta = timeAgo(c.last_touched_at);
                                return (
                                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, background: ta.bg, color: ta.color, whiteSpace: 'nowrap' }}>
                                    {ta.label}
                                  </span>
                                );
                              })()}
                            </td>

                            {/* Source */}
                            <td style={{ fontSize: 12 }}>
                              {c.lead_source ? <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 7px', borderRadius: 8, fontWeight: 600 }}>{c.lead_source}</span> : <span style={{ color: '#d1d5db' }}>—</span>}
                            </td>

                            {/* Actions — hover-reveal */}
                            <td onClick={e => e.stopPropagation()}>
                              <div className="row-actions" style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                                {(() => {
                                  const pendingCount = allTasks.filter(t => t.client_id === c.id).length;
                                  return (
                                    <button
                                      onClick={() => { setTaskClientId(c.id); setTaskForm({ type: 'follow_up', title: '', due_date: '', notes: '' }); setShowTaskModal(true); }}
                                      style={{ position: 'relative', background: pendingCount > 0 ? '#fef3e2' : '#f8fafc', border: `1px solid ${pendingCount > 0 ? '#fde68a' : '#e2e8f0'}`, borderRadius: 7, color: pendingCount > 0 ? '#92400e' : '#6b7280', fontSize: 13, cursor: 'pointer', padding: '4px 7px', display: 'flex', alignItems: 'center', gap: 3, fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}
                                      title={pendingCount > 0 ? `${pendingCount} pending task${pendingCount !== 1 ? 's' : ''}` : 'Add task'}>
                                      {pendingCount > 0 ? `${pendingCount} task${pendingCount !== 1 ? 's' : ''}` : '+ Task'}
                                    </button>
                                  );
                                })()}
                                {isAdmin && (
                                  <>
                                    <button onClick={() => openEditClient(c)}
                                      style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, color: '#6b7280', fontSize: 13, cursor: 'pointer', padding: '4px 7px' }} title="Edit contact">
                                      ✏️
                                    </button>
                                    <button onClick={() => deleteClient(c.id, `${c.first_name} ${c.last_name}`)}
                                      style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, color: '#ef4444', fontSize: 13, cursor: 'pointer', padding: '4px 7px' }} title="Remove client (admin only)">
                                      🗑
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </> // end desktop view (bulk bar + table)
                ); // end desktop table return
              })() /* end filteredContacts IIFE */}

              {/* ── Follow-Up Report ── */}
              {clients.length > 0 && (() => {
                const cutoff = new Date(Date.now() - followUpDays * 24 * 60 * 60 * 1000);
                const stale = clients
                  .filter(c => {
                    const lastTouch = c.last_touched_at ? new Date(c.last_touched_at) : c.created_at ? new Date(c.created_at) : null;
                    if (!lastTouch || lastTouch < cutoff) {
                      if (followUpTypeFilter && c.type !== followUpTypeFilter) return false;
                      return true;
                    }
                    return false;
                  })
                  .sort((a, b) => {
                    const aDate = a.last_touched_at ?? a.created_at ?? '';
                    const bDate = b.last_touched_at ?? b.created_at ?? '';
                    return aDate < bDate ? -1 : 1; // oldest first
                  });

                return (
                  <div style={{ marginTop: 36, borderTop: '2px solid #f0f0f0', paddingTop: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                      <div>
                        <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 2 }}>Follow-Up Report</h3>
                        <p style={{ fontSize: 13, color: '#6b7280' }}>Contacts with no activity in the selected period</p>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Day range buttons */}
                        {[30, 60, 90].map(d => (
                          <button key={d} onClick={() => setFollowUpDays(d)}
                            style={{ padding: '5px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, background: followUpDays === d ? '#111' : '#fff', color: followUpDays === d ? '#fff' : '#6b7280', borderColor: followUpDays === d ? '#111' : '#e5e7eb' }}>
                            {d}d+
                          </button>
                        ))}
                        <button onClick={() => setFollowUpDays(180)}
                          style={{ padding: '5px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, background: followUpDays === 180 ? '#111' : '#fff', color: followUpDays === 180 ? '#fff' : '#6b7280', borderColor: followUpDays === 180 ? '#111' : '#e5e7eb' }}>
                          6mo+
                        </button>
                        {/* Type filter */}
                        <select value={followUpTypeFilter} onChange={e => setFollowUpTypeFilter(e.target.value)}
                          style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, fontFamily: "'DM Sans',sans-serif", color: followUpTypeFilter ? '#111' : '#9ca3af', background: followUpTypeFilter ? '#f0fdf4' : '#fff', cursor: 'pointer' }}>
                          <option value="">All Types</option>
                          {['Buyer','Seller','Tenant','Landlord/Investor','Agent','Broker'].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>

                    {stale.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '28px 20px', background: '#f0fdf4', borderRadius: 10, border: '1px dashed #bbf7d0' }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#166534', marginBottom: 4 }}>All caught up!</div>
                        <div style={{ fontSize: 13, color: '#6b7280' }}>No contacts have gone {followUpDays}+ days without a touch.</div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 600, marginBottom: 12 }}>
                          ⚠️ {stale.length} contact{stale.length !== 1 ? 's' : ''} need{stale.length === 1 ? 's' : ''} follow-up ({followUpDays}d+ since last touch)
                        </div>
                        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                          <div className="mobile-table-scroll">
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                                {['Contact', 'Type', 'Last Touch', 'Days Overdue', 'Source', ''].map(h => (
                                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {stale.map((c, i) => {
                                const lastDate = c.last_touched_at ?? c.created_at;
                                const daysAgo = lastDate ? Math.floor((Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24)) : null;
                                const urgency = daysAgo === null ? '#dc2626' : daysAgo >= 90 ? '#dc2626' : daysAgo >= 60 ? '#d97706' : '#6b7280';
                                return (
                                  <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                                    <td style={{ padding: '11px 14px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                          {(c.first_name[0] ?? '') + (c.last_name[0] ?? '')}
                                        </div>
                                        <div>
                                          <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{c.first_name} {c.last_name}</div>
                                          {c.email && <div style={{ fontSize: 12, color: '#9ca3af' }}>{c.email}</div>}
                                        </div>
                                      </div>
                                    </td>
                                    <td style={{ padding: '11px 14px' }}>
                                      <span style={{ ...Object.fromEntries((CLIENT_TYPE_COLORS[c.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 } as React.CSSProperties}>{c.type}</span>
                                    </td>
                                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap' }}>
                                      {lastDate ? new Date(lastDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                      {!c.last_touched_at && c.created_at && <div style={{ fontSize: 11, color: '#9ca3af' }}>added date</div>}
                                    </td>
                                    <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                                      <span style={{ background: urgency + '18', color: urgency, padding: '3px 10px', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>
                                        {daysAgo !== null ? `${daysAgo}d` : 'Never'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#9ca3af' }}>{c.lead_source || '—'}</td>
                                    <td style={{ padding: '11px 14px' }}>
                                      <button onClick={() => setActiveClient(c)}
                                        style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: '#fef3e2', color: '#92400e', border: '1px solid #fde68a', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
                                        Open →
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* ── Lead Source ROI Report ── */}
              {clients.length > 0 && (() => {
                const sourceCounts: Record<string, { total: number; closed: number; value: number }> = {};
                clients.forEach(c => {
                  const src = c.lead_source || 'Unknown';
                  if (!sourceCounts[src]) sourceCounts[src] = { total: 0, closed: 0, value: 0 };
                  sourceCounts[src].total++;
                });
                deals.filter(d => d.stage === 'Closed').forEach(d => {
                  const client = clients.find(c => c.id === d.client_id);
                  const src = client?.lead_source || 'Unknown';
                  if (!sourceCounts[src]) sourceCounts[src] = { total: 0, closed: 0, value: 0 };
                  sourceCounts[src].closed++;
                  sourceCounts[src].value += d.value || 0;
                });
                const rows = Object.entries(sourceCounts)
                  .map(([src, data]) => ({ src, ...data, rate: data.total > 0 ? Math.round(data.closed / data.total * 100) : 0 }))
                  .filter(r => r.total > 0)
                  .sort((a, b) => b.total - a.total);
                if (rows.length === 0) return null;
                const fmtV = (n: number) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(1)}K` : n > 0 ? `$${n}` : '—';
                return (
                  <div style={{ marginTop: 36, borderTop: '2px solid #f0f0f0', paddingTop: 28 }}>
                    <div style={{ marginBottom: 16 }}>
                      <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 2 }}>Lead Source ROI</h3>
                      <p style={{ fontSize: 13, color: '#6b7280' }}>Contact volume, closed deals, and revenue by lead source</p>
                    </div>
                    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                      <div className="mobile-table-scroll">
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                              {['Source', 'Contacts', 'Closed Deals', 'Conv. Rate', 'Closed Value'].map(h => (
                                <th key={h} style={{ padding: '10px 16px', textAlign: h === 'Source' ? 'left' : 'right', fontSize: 12, fontWeight: 600, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => (
                              <tr key={r.src} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                                <td style={{ padding: '11px 16px', fontWeight: 600, fontSize: 14, color: '#111' }}>
                                  <button onClick={() => { setContactSourceFilter(r.src === 'Unknown' ? '' : r.src); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c9922c', fontWeight: 600, fontSize: 14, padding: 0, textDecoration: 'underline', textDecorationStyle: 'dotted', fontFamily: "'DM Sans',sans-serif" }}>
                                    {r.src}
                                  </button>
                                </td>
                                <td style={{ padding: '11px 16px', textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#374151' }}>{r.total}</td>
                                <td style={{ padding: '11px 16px', textAlign: 'right', fontSize: 14 }}>
                                  {r.closed > 0 ? <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 9px', borderRadius: 8, fontWeight: 700, fontSize: 13 }}>{r.closed}</span> : <span style={{ color: '#d1d5db' }}>0</span>}
                                </td>
                                <td style={{ padding: '11px 16px', textAlign: 'right' }}>
                                  <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: r.rate >= 20 ? '#16a34a' : r.rate >= 10 ? '#c9922c' : '#374151' }}>{r.rate}%</span>
                                    <div style={{ width: 60, height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                                      <div style={{ width: `${Math.min(r.rate, 100)}%`, height: '100%', background: r.rate >= 20 ? '#16a34a' : r.rate >= 10 ? '#c9922c' : '#9ca3af', borderRadius: 2 }} />
                                    </div>
                                  </div>
                                </td>
                                <td style={{ padding: '11px 16px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: r.value > 0 ? '#c9922c' : '#d1d5db' }}>{fmtV(r.value)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                              <td style={{ padding: '10px 16px', fontWeight: 700, fontSize: 13, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#374151' }}>{rows.reduce((s, r) => s + r.total, 0)}</td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#166534' }}>{rows.reduce((s, r) => s + r.closed, 0)}</td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#374151' }}>
                                {(() => { const t = rows.reduce((s, r) => s + r.total, 0); const c = rows.reduce((s, r) => s + r.closed, 0); return t > 0 ? `${Math.round(c/t*100)}%` : '—'; })()}
                              </td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#c9922c' }}>{fmtV(rows.reduce((s, r) => s + r.value, 0))}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Calendar ── */}
          {page === 'calendar' && (
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : '100%', overflow: isMobile ? 'visible' : 'hidden' }}>
              {!gmailConnected ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 40 }}>
                  <div style={{ fontSize: 56 }}>📅</div>
                  <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, color: '#111' }}>Connect Google to See Your Calendar</h3>
                  <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 380, textAlign: 'center' }}>Link your Google account to sync your calendar events and Gmail directly in the CRM.</p>
                  <a href={`/api/gmail/auth?userId=${session!.user.id}&bu=${businessUnit}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', background: '#111', color: '#fff', borderRadius: 7, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>
                    📧 Connect Google Account
                  </a>
                </div>
              ) : calendarScopeError ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 40 }}>
                  <div style={{ fontSize: 56 }}>🔑</div>
                  <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, color: '#111' }}>Calendar Permission Needed</h3>
                  <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 400, textAlign: 'center' }}>Your Google account is connected but calendar access wasn't granted. Reconnect to enable it.</p>
                  <a href={`/api/gmail/auth?userId=${session!.user.id}&bu=${businessUnit}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', background: '#c9922c', color: '#111', borderRadius: 7, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>
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
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: isMobile ? 'none' : '1px solid #e5e7eb', borderBottom: isMobile ? '1px solid #e5e7eb' : 'none', overflow: 'hidden' }}>
                      {/* Month header */}
                      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #e5e7eb', background: '#fff', gap: 12 }}>
                        <button onClick={() => setCalViewMonth(new Date(year, month - 1, 1))}
                          style={{ width: 32, height: 32, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                        <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: '#111', flex: 1, textAlign: 'center' }}>{monthName}</span>
                        <button onClick={() => setCalViewMonth(new Date(year, month + 1, 1))}
                          style={{ width: 32, height: 32, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                        <button onClick={() => { setCalViewMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setCalSelectedDate(today.toDateString()); }}
                          style={{ padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 12, color: '#374151', fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>Today</button>
                        <button onClick={() => loadCalendarEvents(90)}
                          style={{ padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 12, color: '#374151', fontFamily: "'DM Sans',sans-serif" }}>↻ Refresh</button>
                      </div>

                      {/* Day headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                        {DAYS.map(d => (
                          <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af' }}>{d}</div>
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
                                <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontSize: 13, fontWeight: isToday ? 700 : 400, background: isToday ? '#c9922c' : 'transparent', color: isToday ? '#fff' : isSelected ? '#c9922c' : '#374151' }}>
                                  {dayNum}
                                </span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {dayEvents.slice(0, 3).map(ev => (
                                  <div key={ev.id} style={{ fontSize: 11, background: '#1a365d', color: '#fff', borderRadius: 3, padding: '1px 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {ev.allDay ? '● ' : `${new Date(ev.start!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} `}{ev.title}
                                  </div>
                                ))}
                                {dayEvents.length > 3 && (
                                  <div style={{ fontSize: 10, color: '#9ca3af', paddingLeft: 4 }}>+{dayEvents.length - 3} more</div>
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
                    <div style={{ width: isMobile ? '100%' : 320, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden', maxHeight: isMobile ? 300 : undefined }}>
                      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
                        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 700, color: '#111' }}>
                          {calSelectedDate ? (() => {
                            const d = new Date(calSelectedDate);
                            const isToday = d.toDateString() === today.toDateString();
                            return isToday ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                          })() : 'Select a day'}
                        </div>
                        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                          {selectedEvents.length === 0 ? 'No events' : `${selectedEvents.length} event${selectedEvents.length !== 1 ? 's' : ''}`}
                        </div>
                      </div>
                      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {selectedEvents.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '40px 0', color: '#d1d5db' }}>
                            <div style={{ fontSize: 32, marginBottom: 8 }}>🗓️</div>
                            <div style={{ fontSize: 13 }}>No events this day</div>
                          </div>
                        ) : selectedEvents.map(ev => {
                          const startTime = ev.allDay ? 'All day' : ev.start ? new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                          const endTime = ev.allDay ? '' : ev.end ? new Date(ev.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                          const matchedDeal = deals.find(d => d.client_email && ev.attendees.some(a => a.email.toLowerCase() === d.client_email?.toLowerCase()));
                          return (
                            <div key={ev.id} style={{ background: '#f9fafb', borderRadius: 10, padding: '13px 14px', border: '1px solid #e5e7eb', borderLeft: '4px solid #1a365d' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: '#111', lineHeight: 1.3 }}>{ev.title}</div>
                                {ev.htmlLink && (
                                  <a href={ev.htmlLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#c9922c', textDecoration: 'none', flexShrink: 0 }}>Open ↗</a>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>🕐 {startTime}{endTime ? ` – ${endTime}` : ''}</div>
                              {ev.location && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>📍 {ev.location}</div>}
                              {ev.description && <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginBottom: 6 }}>{ev.description.slice(0, 140)}{ev.description.length > 140 ? '…' : ''}</div>}
                              {matchedDeal && (
                                <div style={{ marginTop: 6 }}>
                                  <span onClick={() => openDeal(matchedDeal)} style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '3px 9px', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }}>
                                    🏡 {matchedDeal.client}
                                  </span>
                                </div>
                              )}
                              {ev.attendees.filter(a => !a.self).length > 0 && (
                                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {ev.attendees.filter(a => !a.self).slice(0, 4).map(a => (
                                    <span key={a.email} style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '2px 7px', borderRadius: 8 }}>{a.name ?? a.email}</span>
                                  ))}
                                  {ev.attendees.filter(a => !a.self).length > 4 && <span style={{ fontSize: 10, color: '#9ca3af' }}>+{ev.attendees.filter(a => !a.self).length - 4}</span>}
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

          {/* ── Tasks Page ── */}
          {page === 'tasks' && (() => {
            const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
              urgent: { bg: '#fee2e2', color: '#dc2626' },
              high:   { bg: '#fed7aa', color: '#c2410c' },
              normal: { bg: '#dbeafe', color: '#1d4ed8' },
              low:    { bg: '#f1f5f9', color: '#64748b' },
            };
            const STATUS_ICONS: Record<string, string> = { open: '⬜', in_progress: '🔄', done: '✅' };

            const filteredTasks = tasks.filter(t => {
              if (taskStatusFilter !== 'all' && t.status !== taskStatusFilter) return false;
              if (taskPriorityFilter && t.priority !== taskPriorityFilter) return false;
              if (taskAssigneeFilter && t.assigned_to !== taskAssigneeFilter) return false;
              if (taskSearchStr && !t.title.toLowerCase().includes(taskSearchStr.toLowerCase())) return false;
              return true;
            });

            const overdueCt = tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < today()).length;
            const openCt    = tasks.filter(t => t.status === 'open').length;
            const inProgCt  = tasks.filter(t => t.status === 'in_progress').length;

            return (
              <div>
                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: 'Open',        val: openCt,   color: '#3b82f6' },
                    { label: 'In Progress', val: inProgCt, color: '#f59e0b' },
                    { label: 'Overdue',     val: overdueCt,color: '#ef4444' },
                    { label: 'Total',       val: tasks.length, color: '#c9922c' },
                  ].map(s => (
                    <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', border: '1px solid #e0e0e0', borderLeft: `4px solid ${s.color}` }}>
                      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, fontWeight: 700, color: '#111', lineHeight: 1 }}>{s.val}</div>
                    </div>
                  ))}
                </div>

                {/* Filters + New Task */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(['all', 'open', 'in_progress', 'done'] as const).map(s => (
                    <button key={s} onClick={() => setTaskStatusFilter(s)}
                      style={{ padding: '5px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif",
                        background: taskStatusFilter === s ? '#111' : '#fff', color: taskStatusFilter === s ? '#fff' : '#6b7280', borderColor: taskStatusFilter === s ? '#111' : '#ddd' }}>
                      {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                  <select value={taskPriorityFilter} onChange={e => setTaskPriorityFilter(e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, fontFamily: "'DM Sans',sans-serif", color: taskPriorityFilter ? '#111' : '#9ca3af', background: '#fff', cursor: 'pointer' }}>
                    <option value="">All Priorities</option>
                    {['urgent','high','normal','low'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
                  </select>
                  {isAdmin && (
                    <select value={taskAssigneeFilter} onChange={e => setTaskAssigneeFilter(e.target.value)}
                      style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, fontFamily: "'DM Sans',sans-serif", color: taskAssigneeFilter ? '#111' : '#9ca3af', background: '#fff', cursor: 'pointer' }}>
                      <option value="">All Assignees</option>
                      {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                    </select>
                  )}
                  <input className="crm-input" placeholder="🔍 Search tasks…" value={taskSearchStr} onChange={e => setTaskSearchStr(e.target.value)} style={{ width: 200 }} />
                  <button className="crm-btn crm-btn-gold" style={{ marginLeft: 'auto' }} onClick={() => setShowNewTaskModal(true)}>+ New Task</button>
                </div>

                {/* Task list */}
                {tasksLoading ? (
                  <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading tasks…</div>
                ) : filteredTasks.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f9fafb', borderRadius: 10, border: '1px dashed #e5e7eb' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>No tasks found</div>
                    <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>Create a new task to get started</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filteredTasks.map(t => {
                      const isOverdue = t.status !== 'done' && t.due_date && t.due_date < today();
                      const pc = PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.normal;
                      const linkedClient = t.client ?? (t.client_id ? clients.find(c => c.id === t.client_id) : null);
                      const assigneeName = t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : t.assigned_to ? agentName(t.assigned_to) : '—';
                      return (
                        <div key={t.id} style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', border: `1px solid ${isOverdue ? '#fecaca' : '#e5e7eb'}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                          {/* Status toggle */}
                          <button title="Toggle status" onClick={() => {
                            const next: Task['status'] = t.status === 'open' ? 'in_progress' : t.status === 'in_progress' ? 'done' : 'open';
                            updateTask(t.id, { status: next });
                          }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, flexShrink: 0, padding: 0, marginTop: 1 }}>
                            {STATUS_ICONS[t.status]}
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: t.status === 'done' ? '#9ca3af' : '#111', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                                {t.title}
                              </span>
                              <span style={{ ...pc, padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 } as React.CSSProperties}>
                                {t.priority}
                              </span>
                              {isOverdue && <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: '#fee2e2', color: '#dc2626' }}>OVERDUE</span>}
                            </div>
                            {t.description && <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>{t.description}</div>}
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#9ca3af' }}>
                              {t.due_date && <span>📅 {new Date(t.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                              {linkedClient && <span>👤 {typeof linkedClient === 'object' && 'first_name' in linkedClient ? `${linkedClient.first_name} ${linkedClient.last_name}` : ''}</span>}
                              {isAdmin && t.assigned_to && <span>🤝 {assigneeName}</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <button onClick={() => setEditingTask(t)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', color: '#374151', fontFamily: "'DM Sans',sans-serif" }}>Edit</button>
                            <button onClick={() => { if (confirm('Delete this task?')) deleteTask(t.id); }} style={{ background: '#fee2e2', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', color: '#dc2626', fontFamily: "'DM Sans',sans-serif" }}>✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* New Task Modal */}
                {showNewTaskModal && (
                  <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setShowNewTaskModal(false); }}>
                    <div className="modal" style={{ padding: 28, maxWidth: 520 }}>
                      <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, marginBottom: 20 }}>New Task</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Title *</label>
                          <input className="crm-input" placeholder="Call to discuss offer…" value={newTaskForm.title} onChange={e => setNewTaskForm(f => ({ ...f, title: e.target.value }))} autoFocus />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Description</label>
                          <textarea className="crm-input" style={{ minHeight: 60, resize: 'none' }} placeholder="Optional details…" value={newTaskForm.description} onChange={e => setNewTaskForm(f => ({ ...f, description: e.target.value }))} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Due Date</label>
                            <input type="date" className="crm-input" value={newTaskForm.due_date} onChange={e => setNewTaskForm(f => ({ ...f, due_date: e.target.value }))} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Priority</label>
                            <select className="crm-input" value={newTaskForm.priority} onChange={e => setNewTaskForm(f => ({ ...f, priority: e.target.value as Task['priority'] }))}>
                              {['urgent','high','normal','low'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
                            </select>
                          </div>
                        </div>
                        {isAdmin && (
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Assign To</label>
                            <select className="crm-input" value={newTaskForm.assigned_to} onChange={e => setNewTaskForm(f => ({ ...f, assigned_to: e.target.value }))}>
                              <option value="">Unassigned</option>
                              {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                            </select>
                          </div>
                        )}
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Linked Contact</label>
                          <select className="crm-input" value={newTaskForm.client_id} onChange={e => setNewTaskForm(f => ({ ...f, client_id: e.target.value }))}>
                            <option value="">None</option>
                            {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.business_name ? ` — ${c.business_name}` : ''}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                          <button className="crm-btn crm-btn-ghost" style={{ flex: 1 }} onClick={() => setShowNewTaskModal(false)}>Cancel</button>
                          <button className="crm-btn crm-btn-gold" style={{ flex: 2 }} disabled={!newTaskForm.title.trim()} onClick={createTask}>Create Task</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Edit Task Modal */}
                {editingTask && (
                  <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setEditingTask(null); }}>
                    <div className="modal" style={{ padding: 28, maxWidth: 520 }}>
                      <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Edit Task</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Title *</label>
                          <input className="crm-input" value={editingTask.title} onChange={e => setEditingTask(t => t ? { ...t, title: e.target.value } : t)} autoFocus />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Description</label>
                          <textarea className="crm-input" style={{ minHeight: 60, resize: 'none' }} value={editingTask.description ?? ''} onChange={e => setEditingTask(t => t ? { ...t, description: e.target.value } : t)} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Due Date</label>
                            <input type="date" className="crm-input" value={editingTask.due_date ?? ''} onChange={e => setEditingTask(t => t ? { ...t, due_date: e.target.value } : t)} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Status</label>
                            <select className="crm-input" value={editingTask.status} onChange={e => setEditingTask(t => t ? { ...t, status: e.target.value as Task['status'] } : t)}>
                              {['open','in_progress','done'].map(s => <option key={s} value={s}>{s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Priority</label>
                          <select className="crm-input" value={editingTask.priority} onChange={e => setEditingTask(t => t ? { ...t, priority: e.target.value as Task['priority'] } : t)}>
                            {['urgent','high','normal','low'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
                          </select>
                        </div>
                        {isAdmin && (
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 5 }}>Assign To</label>
                            <select className="crm-input" value={editingTask.assigned_to ?? ''} onChange={e => setEditingTask(t => t ? { ...t, assigned_to: e.target.value } : t)}>
                              <option value="">Unassigned</option>
                              {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                            </select>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                          <button className="crm-btn crm-btn-ghost" style={{ flex: 1 }} onClick={() => setEditingTask(null)}>Cancel</button>
                          <button className="crm-btn crm-btn-gold" style={{ flex: 2 }} disabled={!editingTask.title.trim()} onClick={() => updateTask(editingTask.id, { title: editingTask.title, description: editingTask.description, due_date: editingTask.due_date, status: editingTask.status, priority: editingTask.priority, assigned_to: editingTask.assigned_to })}>Save Changes</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Agents (admin only) ── */}
          {page === 'agents' && isAdmin && (<>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 16 }}>
              {profiles.map(a => {
                const agDeals = deals.filter(d => d.agent_id === a.id);
                const active = agDeals.filter(d => ['Active', 'LOI', 'In Contract'].includes(d.stage)).length;
                const closed = agDeals.filter(d => d.stage === 'Closed').length;
                const isEditing = editingAgentId === a.id;
                return (
                  <div key={a.id} style={{ background: '#fff', borderRadius: 10, padding: 20, border: `1px solid ${isEditing ? '#c9922c' : '#e0e0e0'}` }}>
                    {/* Header row with avatar + name + edit toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 700, flexShrink: 0 }}>
                        {(isEditing ? (editAgentForm.first_name[0] ?? '') : (a.first_name[0] ?? '')) + (isEditing ? (editAgentForm.last_name[0] ?? '') : (a.last_name[0] ?? ''))}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>
                          {isEditing ? `${editAgentForm.first_name} ${editAgentForm.last_name}`.trim() || 'Editing…' : `${a.first_name} ${a.last_name}`}
                          {' '}<span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: a.role === 'admin' ? '#fef3c7' : '#e0f2fe', color: a.role === 'admin' ? '#92400e' : '#0369a1' }}>{a.role}</span>
                        </div>
                        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 1 }}>{isEditing ? editAgentForm.email : a.email}</div>
                      </div>
                      <button
                        onClick={() => {
                          if (isEditing) { setEditingAgentId(null); }
                          else { setEditingAgentId(a.id); setEditAgentForm({ first_name: a.first_name, last_name: a.last_name, email: a.email, phone: a.phone || '', license: a.license || '', business_unit: (a as any).business_unit || 'residential' }); }
                        }}
                        style={{ flexShrink: 0, padding: '4px 10px', fontSize: 12, fontWeight: 600, background: isEditing ? '#f3f4f6' : '#fffbeb', color: isEditing ? '#374151' : '#92400e', border: `1px solid ${isEditing ? '#e5e7eb' : '#fde68a'}`, borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                        {isEditing ? '✕ Cancel' : '✏️ Edit'}
                      </button>
                    </div>

                    {/* Edit form */}
                    {isEditing ? (
                      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>First Name</label>
                            <input className="crm-input" style={{ marginTop: 3 }} value={editAgentForm.first_name} onChange={e => setEditAgentForm({ ...editAgentForm, first_name: e.target.value })} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Last Name</label>
                            <input className="crm-input" style={{ marginTop: 3 }} value={editAgentForm.last_name} onChange={e => setEditAgentForm({ ...editAgentForm, last_name: e.target.value })} />
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Email</label>
                          <input className="crm-input" style={{ marginTop: 3 }} type="email" value={editAgentForm.email} onChange={e => setEditAgentForm({ ...editAgentForm, email: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Phone</label>
                            <input className="crm-input" style={{ marginTop: 3 }} type="tel" placeholder="210-555-0000" value={editAgentForm.phone} onChange={e => setEditAgentForm({ ...editAgentForm, phone: e.target.value })} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>License #</label>
                            <input className="crm-input" style={{ marginTop: 3 }} placeholder="TX-XXXXXXX" value={editAgentForm.license} onChange={e => setEditAgentForm({ ...editAgentForm, license: e.target.value })} />
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Workspace</label>
                          <select className="crm-input" style={{ marginTop: 3 }} value={editAgentForm.business_unit} onChange={e => setEditAgentForm({ ...editAgentForm, business_unit: e.target.value })}>
                            <option value="residential">🏡 Fair Oaks Realty Group (Residential)</option>
                            <option value="commercial">🏢 CRECO (Commercial)</option>
                          </select>
                        </div>
                        <button
                          onClick={saveAgentProfile}
                          disabled={editAgentSaving}
                          style={{ width: '100%', padding: '9px 0', fontSize: 14, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 7, cursor: editAgentSaving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans',sans-serif", opacity: editAgentSaving ? 0.7 : 1 }}>
                          {editAgentSaving ? 'Saving…' : '💾 Save Changes'}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                          {[{ n: agDeals.length, l: 'Total' }, { n: active, l: 'Active' }, { n: closed, l: 'Closed' }].map(s => (
                            <div key={s.l} style={{ flex: 1, textAlign: 'center', background: '#f9fafb', borderRadius: 6, padding: '8px 4px' }}>
                              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 700, color: '#111' }}>{s.n}</div>
                              <div style={{ fontSize: 11, color: '#6b7280' }}>{s.l}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>📞 {a.phone || '—'} &nbsp;·&nbsp; Lic: {a.license || '—'}</div>
                        <div style={{ marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8, background: (a as any).business_unit === 'commercial' ? '#eff6ff' : '#fef9f0', color: (a as any).business_unit === 'commercial' ? '#1d4ed8' : '#92400e' }}>
                            {(a as any).business_unit === 'commercial' ? '🏢 CRECO' : '🏡 Fair Oaks'}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>
                          🕐 Last login: {a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'}
                        </div>
                      </>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* Role toggle — only for other users */}
                      {a.id !== profile.id && (
                        <button
                          onClick={() => updateAgentRole(a.id, a.first_name, a.role === 'admin' ? 'agent' : 'admin')}
                          style={{ width: '100%', padding: '7px 0', fontSize: 13, fontWeight: 600, background: a.role === 'admin' ? '#fef3c7' : '#f0fdf4', color: a.role === 'admin' ? '#92400e' : '#166534', border: `1px solid ${a.role === 'admin' ? '#fde68a' : '#bbf7d0'}`, borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                          {a.role === 'admin' ? '⬇️ Remove Admin' : '⬆️ Make Admin'}
                        </button>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => resetAgentPassword(a.email, a.first_name)}
                          style={{ flex: 1, padding: '7px 0', fontSize: 13, fontWeight: 600, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                          🔑 Reset Password
                        </button>
                        {a.id !== profile.id && a.role !== 'admin' && (
                          <button
                            onClick={() => deleteAgent(a.id, a.first_name, a.last_name)}
                            style={{ padding: '7px 10px', fontSize: 13, fontWeight: 600, background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
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

            {/* ── Activity Report ── */}

            {isAdmin && (
              <div style={{ marginTop: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 2 }}>Activity Report</h3>
                    <p style={{ fontSize: 13, color: '#6b7280' }}>Calls, emails, meetings & notes logged by each agent</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[7, 30, 90].map(d => (
                      <button key={d} onClick={() => { setActivityReportDays(d); loadActivityReport(d); }}
                        style={{ padding: '5px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif", background: activityReportDays === d ? '#111' : '#fff', color: activityReportDays === d ? '#fff' : '#6b7280', borderColor: activityReportDays === d ? '#111' : '#e5e7eb' }}>
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
                {activityReportLoading ? (
                  <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af' }}>Loading…</div>
                ) : activityReport.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af', background: '#f9fafb', borderRadius: 10, border: '1px dashed #e5e7eb' }}>No activity logged in the last {activityReportDays} days.</div>
                ) : (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    <div className="mobile-table-scroll">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          {['Agent', 'Calls', 'Emails', 'Meetings', 'Notes', 'Total'].map(h => (
                            <th key={h} style={{ padding: '10px 16px', textAlign: h === 'Agent' ? 'left' : 'center', fontSize: 12, fontWeight: 600, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activityReport.map((row, i) => (
                          <tr key={row.agent_id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14 }}>{row.name}</td>
                            <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 14 }}>
                              <span style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 8, fontWeight: 600, fontSize: 13 }}>{row.calls}</span>
                            </td>
                            <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 14 }}>
                              <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 8, fontWeight: 600, fontSize: 13 }}>{row.emails}</span>
                            </td>
                            <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 14 }}>
                              <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 8, fontWeight: 600, fontSize: 13 }}>{row.meetings}</span>
                            </td>
                            <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 14 }}>
                              <span style={{ background: '#f3f4f6', color: '#374151', padding: '2px 8px', borderRadius: 8, fontWeight: 600, fontSize: 13 }}>{row.notes}</span>
                            </td>
                            <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, fontSize: 14, color: '#c9922c' }}>{row.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Agent Commission Breakdown ── */}
            {allCommissions.length > 0 && (() => {
              const thisYear = new Date().getFullYear().toString();
              const agentRows = profiles
                .map(p => {
                  const ytd = allCommissions.filter(c => c.agent_id === p.id && c.close_date?.startsWith(thisYear));
                  return {
                    profile: p,
                    deals: ytd.length,
                    gci: ytd.reduce((s, c) => s + (c.gross_commission ?? 0), 0),
                    agentNet: ytd.reduce((s, c) => s + (c.agent_net ?? 0), 0),
                    paid: ytd.filter(c => c.status === 'paid').length,
                    pending: ytd.filter(c => c.status === 'pending').length,
                  };
                })
                .filter(r => r.deals > 0)
                .sort((a, b) => b.gci - a.gci);

              if (agentRows.length === 0) return null;
              const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
              return (
                <div style={{ marginTop: 32 }}>
                  <div style={{ marginBottom: 14 }}>
                    <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 2 }}>Commission Breakdown — {thisYear}</h3>
                    <p style={{ fontSize: 13, color: '#6b7280' }}>Year-to-date commissions by agent</p>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8dcc8', overflow: 'hidden' }}>
                    <div className="mobile-table-scroll">
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f9f5ef', borderBottom: '2px solid #e8dcc8' }}>
                            {['Agent', 'Deals', 'Gross GCI', 'Agent Net', 'Paid', 'Pending'].map(h => (
                              <th key={h} style={{ padding: '10px 16px', textAlign: h === 'Agent' ? 'left' : 'right', fontSize: 12, fontWeight: 600, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {agentRows.map((r, i) => (
                            <tr key={r.profile.id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                              <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14 }}>
                                <div>{r.profile.first_name} {r.profile.last_name}</div>
                                <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>{r.profile.email}</div>
                              </td>
                              <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#374151' }}>{r.deals}</td>
                              <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#c9922c' }}>{fmt(r.gci)}</td>
                              <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#059669' }}>{fmt(r.agentNet)}</td>
                              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#d1fae5', color: '#065f46' }}>{r.paid}</span>
                              </td>
                              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#fef3c7', color: '#92400e' }}>{r.pending}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>)}

          {/* ── Commissions Page ── */}
          {page === 'commissions' && isAdmin && (() => {
            const years = Array.from(new Set(allCommissions.map(c => c.close_date?.slice(0, 4)).filter(Boolean))).sort().reverse();
            if (!years.includes(new Date().getFullYear().toString())) years.unshift(new Date().getFullYear().toString());
            const filtered = allCommissions.filter(c =>
              (!commissionFilterYear || c.close_date?.startsWith(commissionFilterYear)) &&
              (!commissionFilterAgent || c.agent_id === commissionFilterAgent) &&
              (!commissionFilterStatus || c.status === commissionFilterStatus)
            );
            const totalGCI = filtered.reduce((s, c) => s + (c.gross_commission ?? 0), 0);
            const totalAgentNet = filtered.reduce((s, c) => s + (c.agent_net ?? 0), 0);
            const totalBrokerNet = filtered.reduce((s, c) => s + (c.brokerage_net ?? 0), 0);
            const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
            const statusColor: Record<string, { bg: string; color: string }> = {
              paid:     { bg: '#d1fae5', color: '#065f46' },
              pending:  { bg: '#fef3c7', color: '#92400e' },
              disputed: { bg: '#fee2e2', color: '#991b1b' },
            };

            // ── 1099 view ─────────────────────────────────────────────────────────
            if (commissionView === '1099') {
              const reportYears = Array.from(new Set(allCommissions.map(c => c.paid_date?.slice(0, 4) ?? c.close_date?.slice(0, 4)).filter(Boolean))).sort().reverse();
              if (!reportYears.includes(String(new Date().getFullYear() - 1))) reportYears.unshift(String(new Date().getFullYear() - 1));
              // Only include PAID commissions whose paid_date (or close_date fallback) falls in the selected year
              const paidInYear = allCommissions.filter(c =>
                c.status === 'paid' &&
                ((c.paid_date ?? c.close_date) ?? '').startsWith(commission1099Year)
              );
              // Per-agent rollup
              const agentTotals = profiles.map(p => {
                const mine = paidInYear.filter(c => c.agent_id === p.id);
                return { profile: p, total: mine.reduce((s, c) => s + (c.agent_net ?? 0), 0), deals: mine };
              }).filter(r => r.total > 0).sort((a, b) => b.total - a.total);
              const totalPaid = agentTotals.reduce((s, r) => s + r.total, 0);
              const needsFiling = agentTotals.filter(r => r.total >= 600);
              const buName = businessUnit === 'commercial' ? 'CRECO' : 'Fair Oaks Realty Group';

              return (
                <div>
                  {/* Print stylesheet injected inline */}
                  <style>{`
                    @media print {
                      body > * { display: none !important; }
                      #crm-1099-report { display: block !important; position: static !important; width: 100% !important; }
                      .crm-1099-no-print { display: none !important; }
                    }
                  `}</style>

                  {/* Controls — hidden on print */}
                  <div className="crm-1099-no-print" style={{ marginBottom: 20 }}>
                    <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 4 }}>1099-NEC Report</h2>
                    <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>Non-employee compensation summary for paid commissions. Agents earning ≥ $600 require a 1099-NEC filing.</p>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginRight: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Tax Year</label>
                        <select className="crm-input" style={{ width: 'auto' }} value={commission1099Year} onChange={e => setCommission1099Year(e.target.value)}>
                          {reportYears.map(y => <option key={y} value={y!}>{y}</option>)}
                        </select>
                      </div>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        {needsFiling.length > 0 && (
                          <button style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
                            onClick={() => {
                              const rows = [
                                ['Recipient Name', 'Email', 'Phone', 'License #', `Box 1 NEC (${commission1099Year})`, 'Deal Count', 'Filing Required'],
                                ...agentTotals.map(r => [
                                  `${r.profile.first_name} ${r.profile.last_name}`,
                                  r.profile.email,
                                  r.profile.phone ?? '',
                                  r.profile.license ?? '',
                                  r.total.toFixed(2),
                                  r.deals.length,
                                  r.total >= 600 ? 'YES' : 'No',
                                ]),
                              ];
                              const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                              const blob = new Blob([csv], { type: 'text/csv' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a'); a.href = url;
                              a.download = `1099-nec-${commission1099Year}.csv`; a.click();
                              URL.revokeObjectURL(url);
                            }}>
                            ⬇ Export CSV
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Printable report */}
                  <div id="crm-1099-report">
                    {/* Report header */}
                    <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '2px solid #111' }}>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 700, color: '#111' }}>{buName}</div>
                      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>1099-NEC Non-Employee Compensation Report — Tax Year {commission1099Year}</div>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                    </div>

                    {agentTotals.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f9fafb', borderRadius: 10, border: '1px dashed #e5e7eb', color: '#9ca3af' }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>No paid commissions for {commission1099Year}</div>
                        <div style={{ fontSize: 13 }}>Mark commissions as "Paid" on each deal to include them in this report.</div>
                      </div>
                    ) : (
                      <>
                        {/* Summary banner */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 24 }}>
                          {[
                            { label: 'Agents Paid', val: String(agentTotals.length), note: 'received commission' },
                            { label: 'Must File 1099', val: String(needsFiling.length), note: '≥ $600 threshold' },
                            { label: 'Total Compensation', val: fmt(totalPaid), note: 'agent net paid' },
                          ].map(s => (
                            <div key={s.label} style={{ background: '#f9f5ef', border: '1px solid #e8dcc8', borderRadius: 8, padding: '12px 16px' }}>
                              <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, marginBottom: 4 }}>{s.label}</div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: '#111', fontFamily: "'Cormorant Garamond',serif" }}>{s.val}</div>
                              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{s.note}</div>
                            </div>
                          ))}
                        </div>

                        {/* Per-agent cards */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {agentTotals.map(r => {
                            const mustFile = r.total >= 600;
                            return (
                              <div key={r.profile.id} style={{ background: '#fff', border: `1px solid ${mustFile ? '#fde68a' : '#e5e7eb'}`, borderLeft: `4px solid ${mustFile ? '#c9922c' : '#9ca3af'}`, borderRadius: 8, padding: '16px 20px' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 700, color: '#111' }}>
                                        {r.profile.first_name} {r.profile.last_name}
                                      </span>
                                      {mustFile
                                        ? <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: '#fef3c7', color: '#92400e' }}>1099 REQUIRED</span>
                                        : <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#f3f4f6', color: '#6b7280' }}>Below $600</span>
                                      }
                                    </div>
                                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 3, display: 'flex', gap: 14 }}>
                                      <span>✉ {r.profile.email}</span>
                                      {r.profile.phone && <span>📞 {r.profile.phone}</span>}
                                      {r.profile.license && <span>Lic: {r.profile.license}</span>}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                                    <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500 }}>Box 1 — NEC</div>
                                    <div style={{ fontSize: 22, fontWeight: 700, color: '#c9922c', fontFamily: "'Cormorant Garamond',serif" }}>{fmt(r.total)}</div>
                                    <div style={{ fontSize: 12, color: '#9ca3af' }}>{r.deals.length} deal{r.deals.length !== 1 ? 's' : ''}</div>
                                  </div>
                                </div>
                                {/* Deal breakdown */}
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                      {['Deal / Property', 'Close Date', 'Paid Date', 'Agent Net'].map(h => (
                                        <th key={h} style={{ padding: '5px 8px', textAlign: h === 'Agent Net' ? 'right' : 'left', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.deals.map(c => (
                                      <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                        <td style={{ padding: '6px 8px' }}>
                                          <div style={{ fontWeight: 500, color: '#111' }}>{c.deal?.client ?? '—'}</div>
                                          <div style={{ color: '#9ca3af', fontSize: 12 }}>{c.deal?.property ?? ''}</div>
                                        </td>
                                        <td style={{ padding: '6px 8px', color: '#6b7280', whiteSpace: 'nowrap' }}>{c.close_date ? new Date(c.close_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                                        <td style={{ padding: '6px 8px', color: '#6b7280', whiteSpace: 'nowrap' }}>{c.paid_date ? new Date(c.paid_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                                        <td style={{ padding: '6px 8px', fontWeight: 700, color: '#059669', textAlign: 'right' }}>{fmt(c.agent_net)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                                      <td colSpan={3} style={{ padding: '6px 8px', fontWeight: 700, color: '#374151', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</td>
                                      <td style={{ padding: '6px 8px', fontWeight: 700, color: '#c9922c', textAlign: 'right' }}>{fmt(r.total)}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                                {mustFile && (
                                  <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
                                    ⚠ Verify recipient's SSN/EIN and address before filing. This report is for internal reference only — consult your tax professional or CPA.
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Print footer */}
                        <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                          {buName} · 1099-NEC Summary · Tax Year {commission1099Year} · For internal use only — not a substitute for professional tax advice.
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div>
                {/* Header */}
                <div style={{ marginBottom: 20 }}>
                  <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 4 }}>Commissions</h2>
                  <p style={{ fontSize: 14, color: '#6b7280' }}>Deal-level commission tracking across all agents</p>
                </div>

                {/* Filters */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select className="crm-input" style={{ width: 'auto', minWidth: 110 }} value={commissionFilterYear} onChange={e => setCommissionFilterYear(e.target.value)}>
                    <option value="">All Years</option>
                    {years.map(y => <option key={y} value={y!}>{y}</option>)}
                  </select>
                  <select className="crm-input" style={{ width: 'auto', minWidth: 150 }} value={commissionFilterAgent} onChange={e => setCommissionFilterAgent(e.target.value)}>
                    <option value="">All Agents</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                  </select>
                  <select className="crm-input" style={{ width: 'auto', minWidth: 120 }} value={commissionFilterStatus} onChange={e => setCommissionFilterStatus(e.target.value)}>
                    <option value="">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="disputed">Disputed</option>
                  </select>
                  {(commissionFilterYear !== new Date().getFullYear().toString() || commissionFilterAgent || commissionFilterStatus) && (
                    <button onClick={() => { setCommissionFilterYear(new Date().getFullYear().toString()); setCommissionFilterAgent(''); setCommissionFilterStatus(''); }}
                      style={{ padding: '6px 12px', fontSize: 13, fontWeight: 600, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                      Reset
                    </button>
                  )}
                </div>

                {/* Summary stat row */}
                {filtered.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
                    {[
                      { label: 'Deals', val: String(filtered.length), color: '#111' },
                      { label: 'Gross GCI', val: fmt(totalGCI), color: '#c9922c' },
                      { label: 'Agent Net', val: fmt(totalAgentNet), color: '#059669' },
                      { label: 'Brokerage Net', val: fmt(totalBrokerNet), color: '#374151' },
                    ].map(s => (
                      <div key={s.label} style={{ background: '#fff', borderRadius: 8, padding: '14px 16px', border: '1px solid #e8dcc8', borderLeft: '4px solid #c9922c' }}>
                        <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "'Cormorant Garamond',serif" }}>{s.val}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Table */}
                {filtered.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f9fafb', borderRadius: 10, border: '1px dashed #e5e7eb', color: '#9ca3af' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>💰</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>No commissions found</div>
                    <div style={{ fontSize: 13 }}>Add commissions via the Commission tab on any deal.</div>
                  </div>
                ) : (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    <div className="mobile-table-scroll">
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f9f5ef', borderBottom: '2px solid #e8dcc8' }}>
                            {['Client / Property', 'Agent', 'Close Date', 'Sale Price', 'Gross GCI', 'Agent Net', 'Broker Net', 'Status'].map(h => (
                              <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Client / Property' || h === 'Agent' ? 'left' : 'right', fontSize: 12, fontWeight: 600, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((c, i) => (
                            <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa', cursor: 'pointer' }}
                              onClick={() => { if (c.deal_id) { const d = deals.find(x => x.id === c.deal_id); if (d) { setPage('deals'); openDeal(d); setDealTab('commission'); } } }}>
                              <td style={{ padding: '11px 14px', minWidth: 160 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{c.deal?.client ?? '—'}</div>
                                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>{c.deal?.property ?? ''}</div>
                              </td>
                              <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151', whiteSpace: 'nowrap' }}>
                                {c.agent ? `${c.agent.first_name} ${c.agent.last_name}` : '—'}
                              </td>
                              <td style={{ padding: '11px 14px', fontSize: 13, color: '#6b7280', textAlign: 'right', whiteSpace: 'nowrap' }}>{c.close_date ? new Date(c.close_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                              <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: '#111', textAlign: 'right' }}>{fmt(c.sale_price)}</td>
                              <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: '#c9922c', textAlign: 'right' }}>{fmt(c.gross_commission)}</td>
                              <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: '#059669', textAlign: 'right' }}>{fmt(c.agent_net)}</td>
                              <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: '#374151', textAlign: 'right' }}>{fmt(c.brokerage_net)}</td>
                              <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                                <span style={{ padding: '3px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600, ...(statusColor[c.status] ?? { bg: '#f3f4f6', color: '#374151' }), background: statusColor[c.status]?.bg }}>
                                  {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {/* Totals row */}
                        <tfoot>
                          <tr style={{ background: '#f9f5ef', borderTop: '2px solid #e8dcc8' }}>
                            <td colSpan={4} style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total ({filtered.length})</td>
                            <td style={{ padding: '10px 14px', fontSize: 14, fontWeight: 700, color: '#c9922c', textAlign: 'right' }}>{fmt(totalGCI)}</td>
                            <td style={{ padding: '10px 14px', fontSize: 14, fontWeight: 700, color: '#059669', textAlign: 'right' }}>{fmt(totalAgentNet)}</td>
                            <td style={{ padding: '10px 14px', fontSize: 14, fontWeight: 700, color: '#374151', textAlign: 'right' }}>{fmt(totalBrokerNet)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Campaigns Page ── */}
          {page === 'campaigns' && (
            <div style={{ padding: isMobile ? '16px' : '28px', flex: 1, overflowY: 'auto' }}>

              {/* List view */}
              {campaignView === 'list' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                    <div>
                      <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 4 }}>Campaigns</h2>
                      <p style={{ fontSize: 14, color: '#6b7280' }}>Automated email & SMS drip campaigns to keep clients engaged</p>
                    </div>
                    <button className="crm-btn crm-btn-gold" onClick={() => { setActiveCampaign(null); setNewCampaign({ name: '', description: '', type: 'email', frequency: 'monthly', send_date: '', send_time: '08:00', send_day_of_month: '', status: 'draft', email_subject: '', email_body: getDefaultEmailBody(), sms_body: '', sender_agent_id: '' }); setCampaignView('builder'); }}>
                      + New Campaign
                    </button>
                  </div>

                  {/* Agent filter row — admin only */}
                  {isAdmin && profiles.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginRight: 4 }}>Agent:</span>
                      <button onClick={() => setCampaignAgentFilter(null)}
                        style={{ padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, background: campaignAgentFilter === null ? '#1a1a1a' : '#fff', color: campaignAgentFilter === null ? '#fff' : '#6b7280', borderColor: campaignAgentFilter === null ? '#1a1a1a' : '#e5e7eb' }}>
                        All
                      </button>
                      {profiles.map(p => {
                        const name = `${p.first_name} ${p.last_name}`.trim() || p.email;
                        const count = campaigns.filter(c => c.created_by === p.id).length;
                        if (count === 0) return null;
                        const active = campaignAgentFilter === p.id;
                        return (
                          <button key={p.id} onClick={() => setCampaignAgentFilter(active ? null : p.id)}
                            style={{ padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, background: active ? '#c9922c' : '#fff', color: active ? '#fff' : '#6b7280', borderColor: active ? '#c9922c' : '#e5e7eb' }}>
                            {name} <span style={{ opacity: .7 }}>({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Status filter tabs */}
                  {campaigns.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
                      {(['all', 'active', 'draft', 'paused', 'completed'] as const).map(f => {
                        const filtered = campaigns.filter(c => campaignAgentFilter ? c.created_by === campaignAgentFilter : true);
                        return (
                          <button key={f} onClick={() => setCampaignFilter(f)}
                            style={{ padding: '5px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, background: campaignFilter === f ? '#111' : '#fff', color: campaignFilter === f ? '#fff' : '#6b7280', borderColor: campaignFilter === f ? '#111' : '#e5e7eb', textTransform: 'capitalize' }}>
                            {f === 'all' ? `All (${filtered.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${filtered.filter(c => c.status === f).length})`}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {campaignLoading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading campaigns…</div>
                  ) : campaigns.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 60, background: '#f9fafb', borderRadius: 12, border: '2px dashed #e5e7eb' }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>📣</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 6 }}>No campaigns yet</div>
                      <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>Create your first drip campaign to automatically stay in touch with clients</div>
                      <button className="crm-btn crm-btn-gold" onClick={() => { setActiveCampaign(null); setNewCampaign({ name: '', description: '', type: 'email', frequency: 'monthly', send_date: '', send_time: '08:00', send_day_of_month: '', status: 'draft', email_subject: '', email_body: getDefaultEmailBody(), sms_body: '', sender_agent_id: '' }); setCampaignView('builder'); }}>+ Create First Campaign</button>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {campaigns.filter(c => (campaignFilter === 'all' || c.status === campaignFilter) && (!campaignAgentFilter || c.created_by === campaignAgentFilter)).map(camp => (
                        <div key={camp.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
                          <div style={{ width: 44, height: 44, borderRadius: 10, background: camp.type === 'email' ? '#dbeafe' : '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                            {camp.type === 'email' ? '✉️' : '💬'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                              <span style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>{camp.name}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase', background: camp.status === 'active' ? '#dcfce7' : camp.status === 'completed' ? '#dbeafe' : camp.status === 'paused' ? '#fef3c7' : '#f3f4f6', color: camp.status === 'active' ? '#166534' : camp.status === 'completed' ? '#1e40af' : camp.status === 'paused' ? '#92400e' : '#6b7280' }}>{camp.status}</span>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: camp.type === 'email' ? '#dbeafe' : '#d1fae5', color: camp.type === 'email' ? '#1e40af' : '#065f46' }}>{camp.type.toUpperCase()}</span>
                            </div>
                            <div style={{ fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                              <span>{camp.frequency.charAt(0).toUpperCase() + camp.frequency.slice(1)} · {camp.enrollment_count ?? 0} enrolled</span>
                              {camp.last_sent_at
                                ? <span style={{ color: '#16a34a', fontWeight: 500 }}> · Last sent {new Date(camp.last_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                : <span style={{ color: '#9ca3af' }}> · Never sent</span>
                              }
                              {isAdmin && (
                                inlineOwnerCampaignId === camp.id ? (
                                  <select
                                    autoFocus
                                    value={camp.created_by ?? ''}
                                    onBlur={() => setInlineOwnerCampaignId(null)}
                                    onChange={async e => {
                                      const newOwner = e.target.value;
                                      await fetch(`/api/campaigns/${camp.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ created_by: newOwner }) });
                                      setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, created_by: newOwner } : c));
                                      if (activeCampaign?.id === camp.id) setActiveCampaign(ac => ac ? { ...ac, created_by: newOwner } : ac);
                                      setInlineOwnerCampaignId(null);
                                      showToast('Owner updated ✓');
                                    }}
                                    style={{ fontSize: 13, fontFamily: "'DM Sans',sans-serif", border: '1px solid #c9922c', borderRadius: 6, padding: '2px 6px', color: '#c9922c', fontWeight: 600, background: '#fff', cursor: 'pointer' }}
                                  >
                                    {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                                  </select>
                                ) : (
                                  <button
                                    onClick={e => { e.stopPropagation(); setInlineOwnerCampaignId(camp.id); }}
                                    title="Click to change owner"
                                    style={{ background: 'none', border: 'none', padding: '1px 0', cursor: 'pointer', color: '#c9922c', fontWeight: 600, fontSize: 13, fontFamily: "'DM Sans',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                  >
                                    · {(() => { const o = profiles.find(p => p.id === camp.created_by); return o ? `${o.first_name} ${o.last_name}` : '—'; })()}
                                    <span style={{ fontSize: 10, color: '#d1a054', marginLeft: 1 }}>▾</span>
                                  </button>
                                )
                              )}
                              {!isAdmin && (() => { const owner = profiles.find(p => p.id === camp.created_by); return owner ? <span style={{ color: '#c9922c', fontWeight: 500 }}> · {owner.first_name} {owner.last_name}</span> : null; })()}
                              {camp.description && <span> · {camp.description}</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                            <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => { setActiveCampaign(camp); loadCampaignEnrollments(camp.id); loadCampaignSends(camp.id); setCampaignTab('enrolled'); setSelectedEnrollIds([]); setEnrollTypeFilter(''); setEnrollAssetFilter(''); setEnrollTagFilter(''); setEnrollClientSearch(''); setCampaignView('detail'); }}>Manage</button>
                            {isAdmin && <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => { setActiveCampaign(camp); setNewCampaign({ name: camp.name, description: camp.description, type: camp.type, frequency: camp.frequency, send_date: camp.send_date ?? '', send_time: camp.send_time ?? '08:00', send_day_of_month: camp.send_day_of_month != null ? String(camp.send_day_of_month) : '', status: camp.status, email_subject: camp.email_subject ?? '', email_body: camp.email_body ?? '', sms_body: camp.sms_body ?? '', sender_agent_id: camp.sender_agent_id ?? '' }); setCampaignView('builder'); }}>Edit</button>}
                            {isAdmin && <button className="crm-btn crm-btn-ghost crm-btn-sm" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={() => deleteCampaign(camp.id)}>🗑</button>}
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
                      <div style={{ fontSize: 13, color: '#6b7280' }}>{activeCampaign.type.toUpperCase()} · {activeCampaign.frequency} · <span style={{ color: activeCampaign.status === 'active' ? '#16a34a' : activeCampaign.status === 'paused' ? '#d97706' : '#6b7280', fontWeight: 600 }}>{activeCampaign.status}</span></div>
                    </div>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => { setNewCampaign({ name: activeCampaign.name, description: activeCampaign.description, type: activeCampaign.type, frequency: activeCampaign.frequency, send_date: activeCampaign.send_date ?? '', send_time: activeCampaign.send_time ?? '08:00', send_day_of_month: activeCampaign.send_day_of_month != null ? String(activeCampaign.send_day_of_month) : '', status: activeCampaign.status, email_subject: activeCampaign.email_subject ?? '', email_body: activeCampaign.email_body ?? '', sms_body: activeCampaign.sms_body ?? '', sender_agent_id: activeCampaign.sender_agent_id ?? '' }); setCampaignView('builder'); }}>Edit</button>
                        {activeCampaign.status !== 'active' && <button className="crm-btn crm-btn-sm" disabled={campaignActivating} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, cursor: campaignActivating ? 'not-allowed' : 'pointer', opacity: campaignActivating ? 0.7 : 1 }} onClick={async () => { setCampaignActivating(true); await fetch(`/api/campaigns/${activeCampaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) }); showToast('Campaign activated ✓'); await loadCampaigns(); setActiveCampaign({ ...activeCampaign, status: 'active' }); setCampaignActivating(false); }}>{campaignActivating ? '…' : '▶ Activate'}</button>}
                        {activeCampaign.status === 'active' && <button className="crm-btn crm-btn-sm" disabled={campaignActivating} style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, cursor: campaignActivating ? 'not-allowed' : 'pointer', opacity: campaignActivating ? 0.7 : 1 }} onClick={async () => { setCampaignActivating(true); await fetch(`/api/campaigns/${activeCampaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paused' }) }); showToast('Campaign paused'); await loadCampaigns(); setActiveCampaign({ ...activeCampaign, status: 'paused' }); setCampaignActivating(false); }}>{campaignActivating ? '…' : '⏸ Pause'}</button>}
                        <button className="crm-btn crm-btn-ghost crm-btn-sm" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={() => deleteCampaign(activeCampaign.id)}>🗑 Delete</button>
                      </div>
                    )}
                  </div>

                  {/* Draft warning banner */}
                  {activeCampaign.status === 'draft' && (
                    <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#92400e', fontSize: 14 }}>⚠️ This campaign is a Draft — emails will NOT send</div>
                        <div style={{ fontSize: 13, color: '#92400e', marginTop: 2 }}>Click &quot;Activate&quot; to schedule sends for all enrolled contacts.</div>
                      </div>
                      <button className="crm-btn crm-btn-sm" disabled={campaignActivating} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 13, cursor: campaignActivating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: campaignActivating ? 0.7 : 1 }}
                        onClick={async () => { setCampaignActivating(true); await fetch(`/api/campaigns/${activeCampaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) }); showToast('Campaign activated — sends scheduled!'); await loadCampaigns(); setActiveCampaign({ ...activeCampaign, status: 'active' }); setCampaignActivating(false); }}>{campaignActivating ? 'Activating…' : '▶ Activate Now'}</button>
                    </div>
                  )}

                  {/* Tabs */}
                  <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #f0f0f0', marginBottom: 20 }}>
                    {(['enrolled', 'history', 'preview', 'settings'] as const).map(t => (
                      <button key={t} onClick={() => setCampaignTab(t)} style={{ padding: '10px 18px', fontSize: 14, fontWeight: campaignTab === t ? 700 : 400, color: campaignTab === t ? '#c9922c' : '#6b7280', background: 'none', border: 'none', borderBottom: campaignTab === t ? '2px solid #c9922c' : '2px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textTransform: 'capitalize' }}>
                        {t === 'enrolled' ? `Enrolled (${campaignEnrollments.filter(e => e.active).length})` : t === 'preview' ? '👁 Preview' : t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>

                  {/* Enrolled tab */}
                  {campaignTab === 'enrolled' && (
                    <div>
                      {/* Enroll new clients */}
                      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 10 }}>Enroll Clients</div>

                        {/* Filter row */}
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <select className="crm-input" style={{ fontSize: 13 }} value={enrollTypeFilter} onChange={e => setEnrollTypeFilter(e.target.value)}>
                            <option value="">All Types</option>
                            {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <select className="crm-input" style={{ fontSize: 13 }} value={enrollAssetFilter} onChange={e => setEnrollAssetFilter(e.target.value)}>
                            <option value="">All Asset Types</option>
                            {ASSET_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                          <select className="crm-input" style={{ fontSize: 13 }} value={enrollTagFilter} onChange={e => setEnrollTagFilter(e.target.value)}>
                            <option value="">All Tags</option>
                            {[...new Set(clients.flatMap(c => c.tags ?? []))].sort().map(tag => <option key={tag} value={tag}>{tag}</option>)}
                          </select>
                        </div>

                        <input className="crm-input" placeholder="Search by name or email…" value={enrollClientSearch} onChange={e => setEnrollClientSearch(e.target.value)} style={{ marginBottom: 8 }} />

                        {(() => {
                          const filtered = clients.filter(c => {
                            const q = enrollClientSearch.toLowerCase();
                            const enrolled = campaignEnrollments.some(e => e.client_id === c.id && e.active);
                            if (enrolled) return false;
                            if (enrollTypeFilter && c.type !== enrollTypeFilter) return false;
                            if (enrollAssetFilter && !(c.asset_types ?? []).includes(enrollAssetFilter)) return false;
                            if (enrollTagFilter && !(c.tags ?? []).includes(enrollTagFilter)) return false;
                            if (q && !`${c.first_name} ${c.last_name}`.toLowerCase().includes(q) && !c.email?.toLowerCase().includes(q)) return false;
                            return true;
                          });
                          const allSelected = filtered.length > 0 && filtered.every(c => selectedEnrollIds.includes(c.id));

                          return (
                            <>
                              {/* Select all bar */}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#f3f4f6', borderRadius: 6, marginBottom: 6 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' }}>
                                  <input type="checkbox" style={{ accentColor: '#c9922c' }}
                                    checked={allSelected}
                                    onChange={() => {
                                      if (allSelected) {
                                        setSelectedEnrollIds(prev => prev.filter(id => !filtered.find(c => c.id === id)));
                                      } else {
                                        setSelectedEnrollIds(prev => [...new Set([...prev, ...filtered.map(c => c.id)])]);
                                      }
                                    }} />
                                  Select all ({filtered.length})
                                </label>
                                {(enrollTypeFilter || enrollAssetFilter || enrollTagFilter || enrollClientSearch) && (
                                  <button onClick={() => { setEnrollTypeFilter(''); setEnrollAssetFilter(''); setEnrollTagFilter(''); setEnrollClientSearch(''); }} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Clear filters</button>
                                )}
                              </div>

                              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {filtered.slice(0, 50).map(c => (
                                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: selectedEnrollIds.includes(c.id) ? '#fef3e2' : 'transparent', transition: 'background .1s' }}>
                                    <input type="checkbox" checked={selectedEnrollIds.includes(c.id)} onChange={() => setSelectedEnrollIds(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])} style={{ accentColor: '#c9922c', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 14, fontWeight: 500 }}>{c.first_name} {c.last_name}</span>
                                        <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: '#e5e7eb', color: '#374151', fontWeight: 600 }}>{c.type}</span>
                                        {(c.asset_types ?? []).slice(0, 2).map(at => (
                                          <span key={at} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: '#dbeafe', color: '#1e40af', fontWeight: 500 }}>{at}</span>
                                        ))}
                                        {(c.tags ?? []).slice(0, 2).map(tag => (
                                          <span key={tag} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: '#fef3c7', color: '#92400e', fontWeight: 500 }}>{tag}</span>
                                        ))}
                                      </div>
                                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {c.email || 'No email'}{c.business_name ? ` · ${c.business_name}` : ''}{c.city ? ` · ${c.city}` : ''}
                                      </div>
                                    </div>
                                  </label>
                                ))}
                                {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 13 }}>No contacts match these filters</div>}
                                {filtered.length > 50 && <div style={{ textAlign: 'center', padding: 8, color: '#9ca3af', fontSize: 12 }}>Showing 50 of {filtered.length} — refine filters to narrow down</div>}
                              </div>
                            </>
                          );
                        })()}

                        {selectedEnrollIds.length > 0 && (
                          <button className="crm-btn crm-btn-gold" style={{ marginTop: 10, width: '100%' }} onClick={() => enrollClients(activeCampaign.id)}>
                            Enroll {selectedEnrollIds.length} Client{selectedEnrollIds.length !== 1 ? 's' : ''}
                          </button>
                        )}
                      </div>

                      {/* Enrolled list — show all for completed/one-time, active-only for recurring */}
                      {(() => {
                        const isCompleted = activeCampaign.status === 'completed' || activeCampaign.frequency === 'one-time';
                        const visibleEnrollments = isCompleted ? campaignEnrollments : campaignEnrollments.filter(e => e.active);
                        const activeEnrollments = campaignEnrollments.filter(e => e.active);
                        const allUnenrollChecked = activeEnrollments.length > 0 && selectedUnenrollIds.length === activeEnrollments.length;
                        return (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                              <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>
                                {isCompleted ? `All Recipients (${visibleEnrollments.length})` : `Currently Enrolled (${activeEnrollments.length})`}
                              </div>
                              {selectedUnenrollIds.length > 0 && (
                                <button onClick={() => bulkUnenrollClients(activeCampaign.id)}
                                  style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                                  Remove {selectedUnenrollIds.length} selected
                                </button>
                              )}
                            </div>
                            {campaignEnrollmentsLoading ? (
                              <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af', fontSize: 14 }}>Loading…</div>
                            ) : visibleEnrollments.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af', fontSize: 14 }}>No clients enrolled yet</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {/* Select all row — only show for active recurring campaigns */}
                                {!isCompleted && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', background: '#f9fafb', borderRadius: 6, border: '1px dashed #e5e7eb' }}>
                                    <input type="checkbox" checked={allUnenrollChecked} style={{ accentColor: '#c9922c', cursor: 'pointer' }}
                                      onChange={e => setSelectedUnenrollIds(e.target.checked ? activeEnrollments.map(en => en.client_id) : [])} />
                                    <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>Select all to remove</span>
                                  </div>
                                )}
                                {visibleEnrollments.map(en => (
                                  <div key={en.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: selectedUnenrollIds.includes(en.client_id) ? '#fff5f5' : '#fff', border: `1px solid ${selectedUnenrollIds.includes(en.client_id) ? '#fecaca' : '#e5e7eb'}`, borderRadius: 8, transition: 'all .1s' }}>
                                    {!isCompleted && (
                                      <input type="checkbox" checked={selectedUnenrollIds.includes(en.client_id)} style={{ accentColor: '#ef4444', cursor: 'pointer', flexShrink: 0 }}
                                        onChange={e => setSelectedUnenrollIds(prev => e.target.checked ? [...prev, en.client_id] : prev.filter(id => id !== en.client_id))} />
                                    )}
                                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: en.active ? '#c9922c' : '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                      {(en.client?.first_name?.[0] ?? '') + (en.client?.last_name?.[0] ?? '')}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 14, fontWeight: 500 }}>{en.client?.first_name} {en.client?.last_name}</div>
                                      <div style={{ fontSize: 12, color: '#9ca3af' }}>
                                        {isCompleted
                                          ? <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ Sent</span>
                                          : <>Next send: {en.next_send_at ? new Date(en.next_send_at).toLocaleDateString() : 'On activation'}</>
                                        }
                                        {en.client?.unsubscribed_at && <span style={{ marginLeft: 8, color: '#ef4444', fontWeight: 600 }}>· Unsubscribed</span>}
                                      </div>
                                    </div>
                                    {!isCompleted && (
                                      <button onClick={() => unenrollClient(activeCampaign.id, en.client_id)} style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 5, color: '#ef4444', fontSize: 12, cursor: 'pointer', padding: '3px 10px', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Remove</button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* History tab */}
                  {campaignTab === 'history' && (
                    <div>
                      {campaignSends.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No sends yet — activate the campaign to start sending.</div>
                      ) : (() => {
                        const sentEmails = campaignSends.filter(s => s.status === 'sent' && s.type === 'email');
                        const openedCount = sentEmails.filter(s => s.opened_at).length;
                        const trackedCount = sentEmails.filter(s => s.tracking_id).length;
                        const openRate = trackedCount > 0 ? Math.round((openedCount / trackedCount) * 100) : null;
                        return (
                          <div>
                            {/* Open rate summary bar */}
                            {trackedCount > 0 && (
                              <div style={{ display: 'flex', gap: 16, padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                                <div style={{ textAlign: 'center', minWidth: 60 }}>
                                  <div style={{ fontSize: 22, fontWeight: 700, color: '#111', fontFamily: "'Cormorant Garamond',serif" }}>{openRate}%</div>
                                  <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>Open Rate</div>
                                </div>
                                <div style={{ width: 1, background: '#e5e7eb', alignSelf: 'stretch' }} />
                                <div style={{ textAlign: 'center', minWidth: 50 }}>
                                  <div style={{ fontSize: 18, fontWeight: 700, color: '#16a34a' }}>{openedCount}</div>
                                  <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>Opened</div>
                                </div>
                                <div style={{ textAlign: 'center', minWidth: 50 }}>
                                  <div style={{ fontSize: 18, fontWeight: 700, color: '#6b7280' }}>{trackedCount - openedCount}</div>
                                  <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>Unopened</div>
                                </div>
                                <div style={{ textAlign: 'center', minWidth: 50 }}>
                                  <div style={{ fontSize: 18, fontWeight: 700, color: '#374151' }}>{trackedCount}</div>
                                  <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>Tracked</div>
                                </div>
                                {/* Open rate bar */}
                                <div style={{ flex: 1, minWidth: 120 }}>
                                  <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${openRate}%`, background: openRate! >= 40 ? '#16a34a' : openRate! >= 20 ? '#c9922c' : '#ef4444', borderRadius: 4, transition: 'width .4s' }} />
                                  </div>
                                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Industry avg: ~20–25%</div>
                                </div>
                              </div>
                            )}

                            {/* Send rows */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {campaignSends.map(s => {
                                const client = clients.find(c => c.id === s.client_id);
                                const isOpened = !!s.opened_at;
                                const isTracked = !!s.tracking_id;
                                return (
                                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: isOpened ? '#f0fdf4' : '#fff', border: `1px solid ${isOpened ? '#bbf7d0' : '#e5e7eb'}`, borderRadius: 8 }}>
                                    {/* Send status */}
                                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, flexShrink: 0, background: s.status === 'sent' ? '#dcfce7' : s.status === 'failed' ? '#fee2e2' : '#f3f4f6', color: s.status === 'sent' ? '#166534' : s.status === 'failed' ? '#991b1b' : '#6b7280' }}>
                                      {s.status.toUpperCase()}
                                    </span>

                                    {/* Client name + subject */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{client ? `${client.first_name} ${client.last_name}` : 'Unknown'}</div>
                                      {s.subject && <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subject}</div>}
                                    </div>

                                    {/* Open badge */}
                                    {s.status === 'sent' && s.type === 'email' && (
                                      isOpened ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: '#15803d', background: '#dcfce7', border: '1px solid #bbf7d0', padding: '2px 9px', borderRadius: 20, flexShrink: 0 }}>
                                          👁 Opened{s.open_count && s.open_count > 1 ? ` ×${s.open_count}` : ''}
                                        </span>
                                      ) : isTracked ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#9ca3af', background: '#f3f4f6', border: '1px solid #e5e7eb', padding: '2px 9px', borderRadius: 20, flexShrink: 0 }}>
                                          ○ Unopened
                                        </span>
                                      ) : null
                                    )}

                                    {/* Date */}
                                    <div style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>
                                      {new Date(s.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                      {isOpened && s.opened_at && (
                                        <div style={{ fontSize: 11, color: '#16a34a' }}>
                                          opened {new Date(s.opened_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </div>
                                      )}
                                    </div>

                                    {/* Type pill */}
                                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, flexShrink: 0, background: s.type === 'email' ? '#dbeafe' : '#d1fae5', color: s.type === 'email' ? '#1e40af' : '#065f46' }}>
                                      {s.type.toUpperCase()}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Preview tab */}
                  {campaignTab === 'preview' && (
                    <div>
                      {activeCampaign.type === 'sms' ? (
                        /* ── SMS preview ── */
                        <div style={{ maxWidth: 400, margin: '0 auto' }}>
                          <div style={{ background: '#f3f4f6', borderRadius: 16, padding: 20, marginBottom: 16 }}>
                            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 }}>SMS Preview</div>
                            <div style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', fontSize: 14, lineHeight: 1.6, color: '#111', boxShadow: '0 1px 4px rgba(0,0,0,.08)', whiteSpace: 'pre-wrap' }}>
                              {(activeCampaign.sms_body ?? '')
                                .replace(/\{\{first_name\}\}/g, 'Jane')
                                .replace(/\{\{last_name\}\}/g, 'Smith')
                                .replace(/\{\{full_name\}\}/g, 'Jane Smith')
                                .replace(/\{\{agent_name\}\}/g, `${profile?.first_name ?? 'Your'} ${profile?.last_name ?? 'Agent'}`.trim())
                                .replace(/\{\{agent_phone\}\}/g, profile?.phone ?? '210-390-9997')
                                .replace(/\{\{brokerage\}\}/g, 'Fair Oaks Realty Group')
                                || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No SMS body set.</span>}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>Sample data — real sends use each contact&apos;s actual info.</div>
                        </div>
                      ) : (
                        /* ── Email preview ── */
                        <div>
                          {/* Subject line */}
                          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'baseline' }}>
                            <span style={{ fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>Subject</span>
                            <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>
                              {(activeCampaign.email_subject ?? '(no subject)')
                                .replace(/\{\{first_name\}\}/g, 'Jane')
                                .replace(/\{\{last_name\}\}/g, 'Smith')
                                .replace(/\{\{full_name\}\}/g, 'Jane Smith')
                                .replace(/\{\{agent_name\}\}/g, `${profile?.first_name ?? 'Your'} ${profile?.last_name ?? 'Agent'}`.trim())
                                .replace(/\{\{brokerage\}\}/g, 'Fair Oaks Realty Group')}
                            </span>
                          </div>

                          {/* Rendered email body */}
                          {activeCampaign.email_body ? (
                            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}>
                              {/* Fake email client chrome */}
                              <div style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }} />
                                <div style={{ flex: 1, marginLeft: 12, background: '#fff', borderRadius: 6, padding: '4px 12px', fontSize: 12, color: '#9ca3af' }}>
                                  From: Fair Oaks Realty Group &lt;noreply@fairoaksrealtygroup.com&gt;
                                </div>
                              </div>
                              <iframe
                                sandbox="allow-same-origin"
                                srcDoc={(() => {
                                  const body = (activeCampaign.email_body ?? '')
                                    .replace(/\{\{first_name\}\}/g, 'Jane')
                                    .replace(/\{\{last_name\}\}/g, 'Smith')
                                    .replace(/\{\{full_name\}\}/g, 'Jane Smith')
                                    .replace(/\{\{email\}\}/g, 'jane@example.com')
                                    .replace(/\{\{client_type\}\}/g, 'Buyer')
                                    .replace(/\{\{agent_name\}\}/g, `${profile?.first_name ?? 'Your'} ${profile?.last_name ?? 'Agent'}`.trim())
                                    .replace(/\{\{agent_email\}\}/g, profile?.email ?? 'agent@fairoaksrealtygroup.com')
                                    .replace(/\{\{agent_phone\}\}/g, profile?.phone ?? '210-390-9997')
                                    .replace(/\{\{brokerage\}\}/g, 'Fair Oaks Realty Group')
                                    .replace(/\{\{unsubscribe_url\}\}/g, '#preview');
                                  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:0;font-family:Arial,sans-serif;}</style></head><body>${body}</body></html>`;
                                })()}
                                style={{ width: '100%', border: 'none', minHeight: 500, display: 'block', background: '#fff' }}
                                onLoad={(e) => {
                                  const iframe = e.currentTarget;
                                  try { iframe.style.height = (iframe.contentDocument?.body?.scrollHeight ?? 500) + 'px'; } catch {}
                                }}
                                title="Email Preview"
                              />
                            </div>
                          ) : (
                            <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af', background: '#f9fafb', borderRadius: 12, border: '1px dashed #e5e7eb' }}>
                              <div style={{ fontSize: 32, marginBottom: 8 }}>📧</div>
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>No email body yet</div>
                              <div style={{ fontSize: 13 }}>Edit this campaign to add an email template.</div>
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 12 }}>
                            Sample data shown — real sends replace merge fields with each contact&apos;s actual info.
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Settings tab */}
                  {campaignTab === 'settings' && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {([
                        ['Type', activeCampaign.type.toUpperCase()],
                        ['Frequency', activeCampaign.frequency.charAt(0).toUpperCase() + activeCampaign.frequency.slice(1)],
                        ['Status', activeCampaign.status.charAt(0).toUpperCase() + activeCampaign.status.slice(1)],
                        ...(activeCampaign.frequency === 'one-time' && activeCampaign.send_date ? [
                          ['Scheduled Date', new Date(activeCampaign.send_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })],
                          ['Scheduled Time (CT)', (() => { const [h, m] = (activeCampaign.send_time || '08:00').split(':'); const hr = parseInt(h); return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`; })()],
                        ] : []),
                        ...(activeCampaign.frequency !== 'one-time' && activeCampaign.send_day_of_month ? [
                          ['Send Day of Month', (() => { const d = activeCampaign.send_day_of_month!; return `${d}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'} of each ${activeCampaign.frequency === 'monthly' ? 'month' : 'period'}`; })()],
                          ['Send Time (CT)', (() => { const [h, m] = (activeCampaign.send_time || '08:00').split(':'); const hr = parseInt(h); return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`; })()],
                        ] : []),
                        ['Created', new Date(activeCampaign.created_at).toLocaleDateString()],
                      ] as [string, string][]).map(([label, val]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: '#f9fafb', borderRadius: 8, fontSize: 14 }}>
                          <span style={{ color: '#6b7280', fontWeight: 500 }}>{label}</span>
                          <span style={{ color: label === 'Scheduled Time (CT)' ? '#c9922c' : '#111', fontWeight: 600 }}>{val}</span>
                        </div>
                      ))}
                      {/* Send As Agent row */}
                      {isAdmin && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: '#f9fafb', borderRadius: 8, fontSize: 14 }}>
                          <span style={{ color: '#6b7280', fontWeight: 500 }}>Send As</span>
                          <span style={{ fontWeight: 600, color: '#111' }}>
                            {activeCampaign.sender_agent_id
                              ? (() => { const a = profiles.find(p => p.id === activeCampaign.sender_agent_id); return a ? `${a.first_name} ${a.last_name}` : 'Unknown Agent'; })()
                              : "Contact's assigned agent (default)"}
                          </span>
                        </div>
                      )}
                      {/* Owner (created_by) — editable dropdown */}
                      {isAdmin && profiles.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f9fafb', borderRadius: 8, fontSize: 14 }}>
                          <span style={{ color: '#6b7280', fontWeight: 500 }}>Owner</span>
                          <select
                            value={activeCampaign.created_by ?? ''}
                            onChange={async e => {
                              const newOwner = e.target.value;
                              await fetch(`/api/campaigns/${activeCampaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ created_by: newOwner }) });
                              setActiveCampaign({ ...activeCampaign, created_by: newOwner });
                              setCampaigns(prev => prev.map(c => c.id === activeCampaign.id ? { ...c, created_by: newOwner } : c));
                              showToast('Owner updated ✓');
                            }}
                            style={{ fontSize: 14, fontWeight: 600, color: '#111', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                            {profiles.map(p => (
                              <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {activeCampaign.type === 'email' && activeCampaign.email_subject && (
                        <div style={{ padding: '12px 14px', background: '#f9fafb', borderRadius: 8 }}>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Subject Line</div>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{activeCampaign.email_subject}</div>
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
                    <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 14 }}>Campaign Details</div>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Campaign Name *</label><input className="crm-input" style={{ marginTop: 4 }} placeholder="Monthly Market Update" value={newCampaign.name} onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })} /></div>
                      <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Description</label><input className="crm-input" style={{ marginTop: 4 }} placeholder="Brief description of the campaign purpose" value={newCampaign.description} onChange={e => setNewCampaign({ ...newCampaign, description: e.target.value })} /></div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Channel</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newCampaign.type} onChange={e => setNewCampaign({ ...newCampaign, type: e.target.value as 'email' | 'sms' })}>
                            <option value="email">✉️ Email</option>
                            <option value="sms">💬 SMS / Text</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Frequency</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newCampaign.frequency} onChange={e => setNewCampaign({ ...newCampaign, frequency: e.target.value, send_date: '', send_time: '08:00' })}>
                            <option value="one-time">One-Time (specific date)</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="semi-annual">Semi-Annual</option>
                            <option value="annual">Annual</option>
                          </select>
                        </div>
                        {/* ── Shared inline calendar for both one-time and recurring ── */}
                        {(() => {
                          const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                          const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
                          const today = new Date(); today.setHours(0,0,0,0);
                          const { year, month } = calendarMonth;
                          const firstDay = new Date(year, month, 1).getDay();
                          const daysInMonth = new Date(year, month + 1, 0).getDate();
                          const selectedDate = newCampaign.send_date ? new Date(newCampaign.send_date + 'T12:00:00') : null;
                          const isOneTime = newCampaign.frequency === 'one-time';
                          const suffix = (d: number) => d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
                          const prevMonth = () => setCalendarMonth(({ year: y, month: m }) => m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 });
                          const nextMonth = () => setCalendarMonth(({ year: y, month: m }) => m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 });
                          const canGoPrev = new Date(year, month, 1) > new Date(today.getFullYear(), today.getMonth(), 1);
                          const selectDay = (d: number) => {
                            const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                            setNewCampaign({ ...newCampaign, send_date: dateStr, send_day_of_month: isOneTime ? '' : String(d) });
                          };
                          return (
                            <div style={{ gridColumn: '1/-1' }}>
                              <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>
                                {isOneTime ? 'Send Date *' : 'First Send Date & Recurring Day *'}
                              </label>
                              <div style={{ marginTop: 8, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, maxWidth: 340 }}>
                                {/* Month nav */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                  <button type="button" onClick={prevMonth} disabled={!canGoPrev}
                                    style={{ background: 'none', border: 'none', cursor: canGoPrev ? 'pointer' : 'default', fontSize: 16, color: canGoPrev ? '#374151' : '#d1d5db', padding: '2px 8px', borderRadius: 4 }}>‹</button>
                                  <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{MONTHS[month]} {year}</span>
                                  <button type="button" onClick={nextMonth}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#374151', padding: '2px 8px', borderRadius: 4 }}>›</button>
                                </div>
                                {/* Weekday headers */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 4 }}>
                                  {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', fontWeight: 600, padding: '2px 0' }}>{d}</div>)}
                                </div>
                                {/* Day cells */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
                                  {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                                    const cellDate = new Date(year, month, d);
                                    const isPast = cellDate < today;
                                    const isSelected = selectedDate && selectedDate.getFullYear() === year && selectedDate.getMonth() === month && selectedDate.getDate() === d;
                                    const isToday = cellDate.getTime() === today.getTime();
                                    const isDisabled = isPast || (!isOneTime && d > 28);
                                    return (
                                      <button key={d} type="button" disabled={isDisabled} onClick={() => !isDisabled && selectDay(d)}
                                        title={!isOneTime && d > 28 ? 'Day 29–31 skipped in short months' : undefined}
                                        style={{ padding: '6px 0', borderRadius: 6, border: isSelected ? '2px solid #c9922c' : isToday ? '1px solid #c9922c' : '1px solid transparent', background: isSelected ? '#c9922c' : '#fff', color: isDisabled ? '#d1d5db' : isSelected ? '#fff' : '#111', fontSize: 14, fontWeight: isSelected ? 700 : 400, cursor: isDisabled ? 'default' : 'pointer', textAlign: 'center', opacity: isDisabled ? 0.4 : 1 }}>
                                        {d}
                                      </button>
                                    );
                                  })}
                                </div>
                                {/* Summary */}
                                {newCampaign.send_date ? (
                                  <div style={{ marginTop: 12, padding: '8px 10px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, fontSize: 13, color: '#92400e' }}>
                                    {isOneTime
                                      ? <>📅 Sends once on <strong>{MONTHS[month]} {selectedDate!.getDate()}, {year}</strong></>
                                      : <>📅 First send: <strong>{MONTHS[selectedDate!.getMonth()]} {selectedDate!.getDate()}{suffix(selectedDate!.getDate())}, {selectedDate!.getFullYear()}</strong> — then repeats on the <strong>{selectedDate!.getDate()}{suffix(selectedDate!.getDate())}</strong> of each {newCampaign.frequency === 'monthly' ? 'month' : newCampaign.frequency === 'quarterly' ? 'quarter' : newCampaign.frequency === 'semi-annual' ? 'half-year' : 'year'}</>
                                    }
                                  </div>
                                ) : (
                                  <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af' }}>Select a date above to set your {isOneTime ? 'send date' : 'first send & recurring day'}.</div>
                                )}
                                {/* Time picker */}
                                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>Send time (CT)</span>
                                  <select className="crm-input" style={{ flex: 1 }} value={newCampaign.send_time} onChange={e => setNewCampaign({ ...newCampaign, send_time: e.target.value })}>
                                    {Array.from({ length: 24 * 4 }, (_, i) => {
                                      const h = Math.floor(i / 4); const m2 = (i % 4) * 15;
                                      const val = `${String(h).padStart(2,'0')}:${String(m2).padStart(2,'0')}`;
                                      const lbl = `${h % 12 || 12}:${String(m2).padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}`;
                                      return <option key={val} value={val}>{lbl}</option>;
                                    })}
                                  </select>
                                </div>
                                {!isOneTime && <div style={{ marginTop: 6, fontSize: 12, color: '#9ca3af' }}>Days 29–31 are disabled for recurring campaigns to ensure every month has that date.</div>}
                              </div>
                            </div>
                          );
                        })()}
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Status</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newCampaign.status} onChange={e => setNewCampaign({ ...newCampaign, status: e.target.value })}>
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                          </select>
                        </div>
                      </div>
                      {isAdmin && (
                        <div style={{ marginTop: 12 }}>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Send As (Agent)</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newCampaign.sender_agent_id} onChange={e => setNewCampaign({ ...newCampaign, sender_agent_id: e.target.value })}>
                            <option value="">— Contact&apos;s assigned agent (default) —</option>
                            {profiles.map(a => (
                              <option key={a.id} value={a.id}>{a.first_name} {a.last_name}{a.email ? ` (${a.email})` : ''}</option>
                            ))}
                          </select>
                          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Override whose name &amp; reply-to appear on every email in this campaign.</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Email fields */}
                  {newCampaign.type === 'email' && (
                    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                      <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 14 }}>Email Content</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Subject Line *</label><input className="crm-input" style={{ marginTop: 4 }} placeholder="Hi {{first_name}}, here's your market update!" value={newCampaign.email_subject} onChange={e => setNewCampaign({ ...newCampaign, email_subject: e.target.value })} /></div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Email Body *</label>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              {/* HTML / Visual toggle */}
                              <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                                <button type="button" onClick={() => {
                                    if (emailEditorMode === 'html') {
                                      // switching TO rich: sync textarea → editor
                                      setEmailEditorMode('rich');
                                      setTimeout(() => {
                                        if (emailEditorRef.current) emailEditorRef.current.innerHTML = sanitizeHtml(newCampaign.email_body);
                                      }, 0);
                                    }
                                  }}
                                  style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: emailEditorMode === 'rich' ? '#111' : '#fff', color: emailEditorMode === 'rich' ? '#fff' : '#6b7280', border: 'none', fontFamily: "'DM Sans',sans-serif" }}>
                                  Visual
                                </button>
                                <button type="button" onClick={() => {
                                    if (emailEditorMode === 'rich') {
                                      // switching TO html: sync editor → textarea
                                      const html = emailEditorRef.current?.innerHTML ?? newCampaign.email_body;
                                      setNewCampaign(prev => ({ ...prev, email_body: html }));
                                      setEmailEditorMode('html');
                                    }
                                  }}
                                  style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: emailEditorMode === 'html' ? '#111' : '#fff', color: emailEditorMode === 'html' ? '#fff' : '#6b7280', border: 'none', fontFamily: "'DM Sans',sans-serif" }}>
                                  {'<HTML>'}
                                </button>
                              </div>
                              {newCampaign.email_body.replace(/<[^>]*>/g, '').trim() && (
                                <button type="button" onClick={() => setShowEmailPreview(true)}
                                  style={{ fontSize: 12, color: '#c9922c', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                  👁 Preview
                                </button>
                              )}
                            </div>
                          </div>

                          {emailEditorMode === 'html' ? (
                            /* ── Raw HTML editor ── */
                            <textarea
                              value={newCampaign.email_body}
                              onChange={e => setNewCampaign(prev => ({ ...prev, email_body: e.target.value }))}
                              spellCheck={false}
                              placeholder="Paste or write your HTML here…"
                              style={{ width: '100%', minHeight: 340, border: '1px solid #d1d5db', borderRadius: 6, padding: '12px 14px', fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', background: '#1e1e2e', color: '#cdd6f4', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                            />
                          ) : (
                            <>
                              {/* Rich text toolbar */}
                              <div style={{ marginTop: 4, border: '1px solid #d1d5db', borderRadius: '6px 6px 0 0', background: '#f9fafb', padding: '6px 10px', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                {[
                                  { label: 'B', cmd: 'bold', title: 'Bold', style: { fontWeight: 700 } },
                                  { label: 'I', cmd: 'italic', title: 'Italic', style: { fontStyle: 'italic' } },
                                  { label: 'U', cmd: 'underline', title: 'Underline', style: { textDecoration: 'underline' } },
                                ].map(btn => (
                                  <button key={btn.cmd} type="button" title={btn.title} aria-label={btn.title}
                                    onMouseDown={e => { e.preventDefault(); document.execCommand(btn.cmd, false); emailEditorRef.current?.focus(); setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? prev.email_body })); }}
                                    style={{ ...btn.style, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, width: 28, height: 26, cursor: 'pointer', fontSize: 14, fontFamily: "'DM Sans',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {btn.label}
                                  </button>
                                ))}
                                <div style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 2px' }} />
                                <button type="button" title="Heading" aria-label="Heading"
                                  onMouseDown={e => { e.preventDefault(); document.execCommand('formatBlock', false, 'h3'); emailEditorRef.current?.focus(); setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? prev.email_body })); }}
                                  style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, height: 26, padding: '0 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>H</button>
                                <button type="button" title="Bullet List" aria-label="Bullet list"
                                  onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList', false); emailEditorRef.current?.focus(); setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? prev.email_body })); }}
                                  style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, width: 28, height: 26, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>•</button>
                                <button type="button" title="Insert Link" aria-label="Insert link"
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    const url = window.prompt('Enter URL (e.g. https://fairoaksrealtygroup.com):');
                                    if (url) { document.execCommand('createLink', false, url); const links = emailEditorRef.current?.querySelectorAll('a'); links?.forEach(a => { a.target = '_blank'; a.rel = 'noopener'; }); }
                                    emailEditorRef.current?.focus();
                                    setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? prev.email_body }));
                                  }}
                                  style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, height: 26, padding: '0 8px', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif", display: 'flex', alignItems: 'center', gap: 4 }}>🔗 Link</button>
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
                                    style={{ background: '#fef3e2', border: '1px solid #fde68a', borderRadius: 4, padding: '2px 7px', fontSize: 11, color: '#92400e', cursor: 'pointer', fontFamily: 'monospace', height: 26, display: 'flex', alignItems: 'center' }}>
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
                                role="textbox"
                                aria-multiline="true"
                                aria-label="Campaign email body"
                                onInput={() => setNewCampaign(prev => ({ ...prev, email_body: emailEditorRef.current?.innerHTML ?? '' }))}
                                style={{ minHeight: 240, border: '1px solid #d1d5db', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: '14px 16px', fontSize: 14, lineHeight: 1.7, color: '#111', outline: 'none', fontFamily: "'DM Sans',sans-serif", background: '#fff', overflowY: 'auto' }}
                              />
                            </>
                          )}
                          {!newCampaign.email_body.includes('{{unsubscribe_url}}') && newCampaign.email_body.replace(/<[^>]*>/g, '').length > 0 && (
                            <div style={{ marginTop: 6, fontSize: 12, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '5px 10px' }}>
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
                      <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 14 }}>SMS Content</div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Message *</label>
                          <span style={{ fontSize: 12, color: newCampaign.sms_body.length > 160 ? '#ef4444' : '#9ca3af', fontWeight: newCampaign.sms_body.length > 160 ? 700 : 400 }}>{newCampaign.sms_body.length}/160</span>
                        </div>
                        <textarea className="crm-input" style={{ marginTop: 0, minHeight: 100, resize: 'vertical' }} placeholder={`Hi {{first_name}}, this is {{agent_name}} from {{brokerage}}. Just checking in — are you still looking for properties? Reply STOP to opt out.`} value={newCampaign.sms_body} onChange={e => setNewCampaign({ ...newCampaign, sms_body: e.target.value })} />
                        <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280', background: '#f9fafb', borderRadius: 6, padding: '6px 10px' }}>
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

          {/* ── Action Plans Page ── */}
          {page === 'action-plans' && (
            <div style={{ padding: isMobile ? '16px' : '28px', flex: 1, overflowY: 'auto' }}>

              {/* List view */}
              {actionPlanView === 'list' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                    <div>
                      <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 4 }}>Action Plans</h2>
                      <p style={{ fontSize: 14, color: '#6b7280' }}>Multi-step sequences triggered automatically or manually applied to contacts</p>
                    </div>
                    <button className="crm-btn crm-btn-gold" onClick={() => { setActiveActionPlan(null); setNewPlan({ name: '', description: '', trigger_type: 'manual', trigger_value: '', status: 'active', completion_campaign_id: '' }); setPlanSteps([]); setActionPlanView('builder'); }}>+ New Plan</button>
                  </div>

                  {/* Agent filter row — admin only */}
                  {isAdmin && profiles.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginRight: 4 }}>Agent:</span>
                      <button onClick={() => setActionPlanAgentFilter(null)}
                        style={{ padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, background: actionPlanAgentFilter === null ? '#1a1a1a' : '#fff', color: actionPlanAgentFilter === null ? '#fff' : '#6b7280', borderColor: actionPlanAgentFilter === null ? '#1a1a1a' : '#e5e7eb' }}>
                        All
                      </button>
                      {profiles.map(p => {
                        const name = `${p.first_name} ${p.last_name}`.trim() || p.email;
                        const count = actionPlans.filter(pl => pl.created_by === p.id).length;
                        if (count === 0) return null;
                        const active = actionPlanAgentFilter === p.id;
                        return (
                          <button key={p.id} onClick={() => setActionPlanAgentFilter(active ? null : p.id)}
                            style={{ padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, background: active ? '#c9922c' : '#fff', color: active ? '#fff' : '#6b7280', borderColor: active ? '#c9922c' : '#e5e7eb' }}>
                            {name} <span style={{ opacity: .7 }}>({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {actionPlanLoading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading…</div>
                  ) : actionPlans.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 60, background: '#f9fafb', borderRadius: 12, border: '2px dashed #e5e7eb' }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 6 }}>No action plans yet</div>
                      <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>Build multi-step follow-up sequences that run automatically</div>
                      <button className="crm-btn crm-btn-gold" onClick={() => { setActiveActionPlan(null); setNewPlan({ name: '', description: '', trigger_type: 'manual', trigger_value: '', status: 'active', completion_campaign_id: '' }); setPlanSteps([]); setActionPlanView('builder'); }}>+ Create First Plan</button>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {actionPlans.filter(plan => !actionPlanAgentFilter || plan.created_by === actionPlanAgentFilter).map(plan => (
                        <div key={plan.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
                          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>⚡</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                              <span style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>{plan.name}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: plan.status === 'active' ? '#dcfce7' : '#fef3c7', color: plan.status === 'active' ? '#166534' : '#92400e', textTransform: 'uppercase' }}>{plan.status}</span>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#ede9fe', color: '#6d28d9' }}>{plan.trigger_type.replace('_', ' ')}</span>
                            </div>
                            <div style={{ fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                              <span>{plan.step_count ?? 0} steps · {plan.enrollment_count ?? 0} enrolled</span>
                              {isAdmin && (
                                inlineOwnerPlanId === plan.id ? (
                                  <select
                                    autoFocus
                                    value={plan.created_by ?? ''}
                                    onBlur={() => setInlineOwnerPlanId(null)}
                                    onChange={async e => {
                                      const newOwner = e.target.value;
                                      await fetch(`/api/action-plans/${plan.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ created_by: newOwner }) });
                                      setActionPlans(prev => prev.map(p => p.id === plan.id ? { ...p, created_by: newOwner } : p));
                                      if (activeActionPlan?.id === plan.id) setActiveActionPlan(ap => ap ? { ...ap, created_by: newOwner } : ap);
                                      setInlineOwnerPlanId(null);
                                      showToast('Owner updated ✓');
                                    }}
                                    style={{ fontSize: 13, fontFamily: "'DM Sans',sans-serif", border: '1px solid #c9922c', borderRadius: 6, padding: '2px 6px', color: '#c9922c', fontWeight: 600, background: '#fff', cursor: 'pointer' }}
                                  >
                                    {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                                  </select>
                                ) : (
                                  <button
                                    onClick={e => { e.stopPropagation(); setInlineOwnerPlanId(plan.id); }}
                                    title="Click to change owner"
                                    style={{ background: 'none', border: 'none', padding: '1px 0', cursor: 'pointer', color: '#c9922c', fontWeight: 600, fontSize: 13, fontFamily: "'DM Sans',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                  >
                                    · {(() => { const o = profiles.find(p => p.id === plan.created_by); return o ? `${o.first_name} ${o.last_name}` : '—'; })()}
                                    <span style={{ fontSize: 10, color: '#d1a054', marginLeft: 1 }}>▾</span>
                                  </button>
                                )
                              )}
                              {!isAdmin && (() => { const owner = profiles.find(p => p.id === plan.created_by); return owner ? <span style={{ color: '#c9922c', fontWeight: 500 }}> · {owner.first_name} {owner.last_name}</span> : null; })()}
                              {plan.description && <span> · {plan.description}</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                            <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => { setActiveActionPlan(plan); loadActionPlanEnrollments(plan.id); setActionPlanTab('enrolled'); setSelectedPlanEnrollIds([]); setPlanEnrollTypeFilter(''); setPlanEnrollAssetFilter(''); setPlanEnrollTagFilter(''); setPlanEnrollSearch(''); setPreviewStepIdx(0); fetch(`/api/action-plans/${plan.id}`).then(r => r.json()).then(j => setDetailSteps(j.plan?.steps ?? [])); setActionPlanView('detail'); }}>Manage</button>
                            {isAdmin && <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => { setActiveActionPlan(plan); setNewPlan({ name: plan.name, description: plan.description, trigger_type: plan.trigger_type, trigger_value: plan.trigger_value ?? '', status: plan.status, completion_campaign_id: (plan as any).completion_campaign_id ?? '' }); fetch(`/api/action-plans/${plan.id}`).then(r => r.json()).then(j => setPlanSteps(j.plan?.steps ?? [])); setActionPlanView('builder'); }}>Edit</button>}
                            {isAdmin && <button className="crm-btn crm-btn-ghost crm-btn-sm" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={() => deleteActionPlan(plan.id)}>🗑</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Detail view */}
              {actionPlanView === 'detail' && activeActionPlan && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                    <button onClick={() => { setActionPlanView('list'); setActiveActionPlan(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', padding: 0 }}>←</button>
                    <div style={{ flex: 1 }}>
                      <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 700, color: '#111' }}>{activeActionPlan.name}</h2>
                      <div style={{ fontSize: 13, color: '#6b7280' }}>{activeActionPlan.trigger_type.replace(/_/g, ' ')} · <span style={{ color: activeActionPlan.status === 'active' ? '#16a34a' : '#d97706', fontWeight: 600 }}>{activeActionPlan.status}</span></div>
                    </div>
                    {isAdmin && <button className="crm-btn crm-btn-ghost crm-btn-sm" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={() => deleteActionPlan(activeActionPlan.id)}>🗑 Delete</button>}
                  </div>

                  {/* Tabs */}
                  <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
                    {(['enrolled', 'history', 'preview', 'settings'] as const).map(tab => (
                      <button key={tab} onClick={() => {
                        setActionPlanTab(tab);
                        if ((tab === 'preview' || tab === 'settings') && activeActionPlan) {
                          setPreviewStepIdx(0);
                          fetch(`/api/action-plans/${activeActionPlan.id}`)
                            .then(r => r.json())
                            .then(j => setDetailSteps(j.plan?.steps ?? []));
                        }
                      }}
                        style={{ padding: '10px 18px', fontSize: 14, fontWeight: actionPlanTab === tab ? 700 : 400, color: actionPlanTab === tab ? '#c9922c' : '#6b7280', background: 'none', border: 'none', borderBottom: actionPlanTab === tab ? '2px solid #c9922c' : '2px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textTransform: 'capitalize' }}>
                        {tab === 'enrolled' ? `Enrolled (${actionPlanEnrollments.filter(e => e.active).length})` : tab === 'preview' ? '👁 Preview' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                  </div>

                  {/* Enrolled tab */}
                  {actionPlanTab === 'enrolled' && (
                    <div>
                      {/* Enroll clients */}
                      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Enroll Contacts</div>

                        {/* Filter row */}
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <select className="crm-input" style={{ fontSize: 13 }} value={planEnrollTypeFilter} onChange={e => setPlanEnrollTypeFilter(e.target.value)}>
                            <option value="">All Types</option>
                            {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <select className="crm-input" style={{ fontSize: 13 }} value={planEnrollAssetFilter} onChange={e => setPlanEnrollAssetFilter(e.target.value)}>
                            <option value="">All Asset Types</option>
                            {ASSET_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                          <select className="crm-input" style={{ fontSize: 13 }} value={planEnrollTagFilter} onChange={e => setPlanEnrollTagFilter(e.target.value)}>
                            <option value="">All Tags</option>
                            {[...new Set(clients.flatMap(c => c.tags ?? []))].sort().map(tag => <option key={tag} value={tag}>{tag}</option>)}
                          </select>
                        </div>

                        <input className="crm-input" placeholder="Search by name or email…" value={planEnrollSearch} onChange={e => setPlanEnrollSearch(e.target.value)} style={{ marginBottom: 8 }} />

                        {(() => {
                          const filtered = clients.filter(c => {
                            const enrolled = actionPlanEnrollments.some(e => e.client_id === c.id && e.active);
                            if (enrolled) return false;
                            if (planEnrollTypeFilter && c.type !== planEnrollTypeFilter) return false;
                            if (planEnrollAssetFilter && !(c.asset_types ?? []).includes(planEnrollAssetFilter)) return false;
                            if (planEnrollTagFilter && !(c.tags ?? []).includes(planEnrollTagFilter)) return false;
                            if (planEnrollSearch && !`${c.first_name} ${c.last_name} ${c.email}`.toLowerCase().includes(planEnrollSearch.toLowerCase())) return false;
                            return true;
                          });
                          const allSelected = filtered.length > 0 && filtered.every(c => selectedPlanEnrollIds.includes(c.id));

                          return (
                            <>
                              {/* Select all bar */}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#f3f4f6', borderRadius: 6, marginBottom: 6 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' }}>
                                  <input type="checkbox" style={{ accentColor: '#c9922c' }}
                                    checked={allSelected}
                                    onChange={() => {
                                      if (allSelected) {
                                        setSelectedPlanEnrollIds(prev => prev.filter(id => !filtered.find(c => c.id === id)));
                                      } else {
                                        setSelectedPlanEnrollIds(prev => [...new Set([...prev, ...filtered.map(c => c.id)])]);
                                      }
                                    }} />
                                  Select all ({filtered.length})
                                </label>
                                {(planEnrollTypeFilter || planEnrollAssetFilter || planEnrollTagFilter || planEnrollSearch) && (
                                  <button onClick={() => { setPlanEnrollTypeFilter(''); setPlanEnrollAssetFilter(''); setPlanEnrollTagFilter(''); setPlanEnrollSearch(''); }} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Clear filters</button>
                                )}
                              </div>

                              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {filtered.slice(0, 50).map(c => (
                                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: selectedPlanEnrollIds.includes(c.id) ? '#fef3e2' : 'transparent', transition: 'background .1s' }}>
                                    <input type="checkbox" checked={selectedPlanEnrollIds.includes(c.id)} onChange={e => setSelectedPlanEnrollIds(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))} style={{ accentColor: '#c9922c', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 14, fontWeight: 500 }}>{c.first_name} {c.last_name}</span>
                                        <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: '#e5e7eb', color: '#374151', fontWeight: 600 }}>{c.type}</span>
                                        {(c.asset_types ?? []).slice(0, 2).map(at => (
                                          <span key={at} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: '#dbeafe', color: '#1e40af', fontWeight: 500 }}>{at}</span>
                                        ))}
                                        {(c.tags ?? []).slice(0, 2).map(tag => (
                                          <span key={tag} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: '#fef3c7', color: '#92400e', fontWeight: 500 }}>{tag}</span>
                                        ))}
                                      </div>
                                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {c.email || 'No email'}{c.business_name ? ` · ${c.business_name}` : ''}{c.city ? ` · ${c.city}` : ''}
                                      </div>
                                    </div>
                                  </label>
                                ))}
                                {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 13 }}>No contacts match these filters</div>}
                                {filtered.length > 50 && <div style={{ textAlign: 'center', padding: 8, color: '#9ca3af', fontSize: 12 }}>Showing 50 of {filtered.length} — refine filters to narrow down</div>}
                              </div>
                            </>
                          );
                        })()}

                        <button className="crm-btn crm-btn-gold" style={{ marginTop: 10 }} onClick={() => enrollInActionPlan(activeActionPlan.id)} disabled={selectedPlanEnrollIds.length === 0}>
                          {selectedPlanEnrollIds.length > 0 ? `Enroll ${selectedPlanEnrollIds.length} Contact${selectedPlanEnrollIds.length !== 1 ? 's' : ''}` : 'Enroll'}
                        </button>
                      </div>
                      {/* Enrolled list */}
                      {actionPlanEnrollments.filter(e => e.active).length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af' }}>No contacts enrolled yet.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {actionPlanEnrollments.filter(e => e.active).map(e => (
                            <div key={e.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{e.client?.first_name} {e.client?.last_name}</div>
                                <div style={{ fontSize: 12, color: '#9ca3af' }}>Step {e.current_step} · {e.next_step_at ? `Next: ${new Date(e.next_step_at).toLocaleDateString()}` : 'Completed'}</div>
                              </div>
                              <button onClick={() => unenrollFromActionPlan(activeActionPlan.id, e.client_id)} style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, color: '#ef4444', fontSize: 12, padding: '3px 8px', cursor: 'pointer' }}>Remove</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Preview tab */}
                  {actionPlanTab === 'preview' && (() => {
                    const fromLine = businessUnit === 'commercial'
                      ? 'CRECO <info@crecotx.com>'
                      : 'Fair Oaks Realty Group <info@fairoaksrealtygroup.com>';
                    const applyPreview = (t: string) => (t ?? '')
                      .replace(/\{\{first_name\}\}/g, 'Jane')
                      .replace(/\{\{last_name\}\}/g, 'Smith')
                      .replace(/\{\{full_name\}\}/g, 'Jane Smith')
                      .replace(/\{\{email\}\}/g, 'jane@example.com')
                      .replace(/\{\{client_type\}\}/g, 'Tenant')
                      .replace(/\{\{agent_name\}\}/g, `${profile?.first_name ?? 'Your'} ${profile?.last_name ?? 'Agent'}`.trim())
                      .replace(/\{\{agent_email\}\}/g, profile?.email ?? 'agent@fairoaksrealtygroup.com')
                      .replace(/\{\{agent_phone\}\}/g, profile?.phone ?? '210-390-9997')
                      .replace(/\{\{brokerage\}\}/g, 'Fair Oaks Realty Group')
                      .replace(/\{\{unsubscribe_url\}\}/g, '#preview');

                    if (detailSteps.length === 0) return (
                      <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Loading preview…</div>
                      </div>
                    );

                    const step = detailSteps[previewStepIdx];
                    return (
                      <div>
                        {/* Step selector */}
                        {detailSteps.length > 1 && (
                          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                            {detailSteps.map((s, i) => (
                              <button key={i} onClick={() => setPreviewStepIdx(i)}
                                style={{ fontSize: 13, padding: '5px 14px', borderRadius: 6, border: '1px solid', cursor: 'pointer', fontWeight: 600,
                                  borderColor: previewStepIdx === i ? '#c9922c' : '#e5e7eb',
                                  background: previewStepIdx === i ? '#c9922c' : '#fff',
                                  color: previewStepIdx === i ? '#fff' : '#6b7280' }}>
                                Step {s.step_order}
                              </button>
                            ))}
                          </div>
                        )}

                        {step.type === 'email' ? (
                          <>
                            {/* Subject bar */}
                            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'baseline' }}>
                              <span style={{ fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>Subject</span>
                              <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{applyPreview(step.subject ?? '(no subject)')}</span>
                            </div>
                            {/* Email chrome + iframe */}
                            {step.body ? (
                              <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}>
                                <div style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
                                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }} />
                                  <div style={{ flex: 1, marginLeft: 12, background: '#fff', borderRadius: 6, padding: '4px 12px', fontSize: 12, color: '#9ca3af' }}>
                                    From: {fromLine}
                                  </div>
                                </div>
                                <iframe
                                  sandbox="allow-same-origin"
                                  srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:0;font-family:Arial,sans-serif;}</style></head><body>${applyPreview(step.body)}</body></html>`}
                                  style={{ width: '100%', border: 'none', minHeight: 500, display: 'block', background: '#fff' }}
                                  onLoad={e => { try { (e.currentTarget as HTMLIFrameElement).style.height = ((e.currentTarget as HTMLIFrameElement).contentDocument?.body?.scrollHeight ?? 500) + 'px'; } catch {} }}
                                  title={`Step ${step.step_order} Preview`}
                                />
                              </div>
                            ) : (
                              <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af', background: '#f9fafb', borderRadius: 12, border: '1px dashed #e5e7eb' }}>
                                <div style={{ fontSize: 32, marginBottom: 8 }}>📧</div>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>No email body yet</div>
                                <div style={{ fontSize: 13 }}>Edit this plan to add an email template.</div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', fontSize: 14, color: '#374151', lineHeight: 1.6 }}>
                            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>{step.type} · Day {step.delay_days}</div>
                            {applyPreview(step.body)}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Settings tab */}
                  {actionPlanTab === 'settings' && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {[['Trigger', activeActionPlan.trigger_type.replace(/_/g, ' ')], ['Trigger Value', activeActionPlan.trigger_value || '—'], ['Status', activeActionPlan.status], ['Steps', String(activeActionPlan.step_count ?? 0)], ['Created', new Date(activeActionPlan.created_at).toLocaleDateString()]].map(([l, v]) => (
                        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#f9fafb', borderRadius: 8, fontSize: 14 }}>
                          <span style={{ color: '#6b7280', fontWeight: 500 }}>{l}</span><span style={{ fontWeight: 600, textTransform: l === 'Trigger' ? 'capitalize' : undefined }}>{v}</span>
                        </div>
                      ))}
                      {/* Owner (created_by) — editable dropdown */}
                      {isAdmin && profiles.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f9fafb', borderRadius: 8, fontSize: 14 }}>
                          <span style={{ color: '#6b7280', fontWeight: 500 }}>Owner</span>
                          <select
                            value={activeActionPlan.created_by ?? ''}
                            onChange={async e => {
                              const newOwner = e.target.value;
                              await fetch(`/api/action-plans/${activeActionPlan.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ created_by: newOwner }) });
                              setActiveActionPlan({ ...activeActionPlan, created_by: newOwner });
                              setActionPlans(prev => prev.map(p => p.id === activeActionPlan.id ? { ...p, created_by: newOwner } : p));
                              showToast('Owner updated ✓');
                            }}
                            style={{ fontSize: 14, fontWeight: 600, color: '#111', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                            {profiles.map(p => (
                              <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {/* Test Send */}
                      <div style={{ marginTop: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 16px' }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>🧪 Send Test Email</div>
                        <div style={{ fontSize: 13, color: '#92400e', marginBottom: 12 }}>Sends Step 1 of this plan to your email with sample merge fields so you can see exactly how it looks before enrolling real contacts.</div>
                        <button className="crm-btn crm-btn-sm" disabled={testSending}
                          onClick={() => sendActionPlanTest(activeActionPlan.id)}
                          style={{ background: '#c9922c', color: '#fff', border: 'none', padding: '7px 18px', fontSize: 14, borderRadius: 7, cursor: testSending ? 'not-allowed' : 'pointer', opacity: testSending ? 0.7 : 1, fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>
                          {testSending ? 'Sending…' : `Send Test to ${profile?.email ?? 'me'}`}
                        </button>
                      </div>
                      {isAdmin && <button className="crm-btn crm-btn-ghost crm-btn-sm" style={{ color: '#ef4444', borderColor: '#fecaca', marginTop: 4 }} onClick={() => deleteActionPlan(activeActionPlan.id)}>🗑 Delete Plan</button>}
                    </div>
                  )}
                </div>
              )}

              {/* Builder view */}
              {actionPlanView === 'builder' && (
                <div style={{ maxWidth: 680 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                    <button onClick={() => setActionPlanView(activeActionPlan ? 'detail' : 'list')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', padding: 0 }}>←</button>
                    <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 700, color: '#111' }}>{activeActionPlan ? 'Edit Plan' : 'New Action Plan'}</h2>
                  </div>

                  {/* Plan details */}
                  <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 14 }}>Plan Details</div>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Plan Name *</label><input className="crm-input" style={{ marginTop: 4 }} value={newPlan.name} onChange={e => setNewPlan({ ...newPlan, name: e.target.value })} placeholder="e.g. New Buyer Welcome Sequence" /></div>
                      <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Description</label><input className="crm-input" style={{ marginTop: 4 }} value={newPlan.description} onChange={e => setNewPlan({ ...newPlan, description: e.target.value })} placeholder="What does this plan do?" /></div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Trigger</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newPlan.trigger_type} onChange={e => setNewPlan({ ...newPlan, trigger_type: e.target.value as ActionPlan['trigger_type'], trigger_value: '' })}>
                            <option value="manual">Manual (apply manually)</option>
                            <option value="new_contact">New Contact Added</option>
                            <option value="tag_added">Tag Added</option>
                            <option value="stage_change">Deal Stage Change</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Status</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newPlan.status} onChange={e => setNewPlan({ ...newPlan, status: e.target.value as 'active' | 'paused' })}>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                          </select>
                        </div>
                      </div>
                      {(newPlan.trigger_type === 'tag_added') && (
                        <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Tag Name</label><input className="crm-input" style={{ marginTop: 4 }} value={newPlan.trigger_value} onChange={e => setNewPlan({ ...newPlan, trigger_value: e.target.value })} placeholder="e.g. Hot Lead" /></div>
                      )}
                      {(newPlan.trigger_type === 'stage_change') && (
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Stage</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={newPlan.trigger_value} onChange={e => setNewPlan({ ...newPlan, trigger_value: e.target.value })}>
                            <option value="">Select stage…</option>
                            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>When Complete → Enroll in Campaign</label>
                        <select className="crm-input" style={{ marginTop: 4 }} value={newPlan.completion_campaign_id} onChange={e => setNewPlan({ ...newPlan, completion_campaign_id: e.target.value })}>
                          <option value="">None (no handoff)</option>
                          {campaigns.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{c.name} ({c.frequency})</option>)}
                        </select>
                        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>When a contact finishes all steps, they&apos;ll be auto-enrolled into this campaign.</div>
                      </div>
                    </div>
                  </div>

                  {/* Steps */}
                  <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Steps ({planSteps.length})</div>
                      <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={addPlanStep}>+ Add Step</button>
                    </div>
                    {planSteps.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 14 }}>No steps yet. Add your first step above.</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {planSteps.map((step, idx) => (
                        <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, background: '#fafafa', position: 'relative' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#c9922c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{step.step_order}</div>
                            <select value={step.type} onChange={e => updatePlanStep(idx, { type: e.target.value as ActionPlanStep['type'] })}
                              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: '#fff' }}>
                              <option value="email">✉️ Email</option>
                              <option value="sms">💬 SMS</option>
                              <option value="task">✅ Task (reminder)</option>
                              <option value="note">📝 Note</option>
                            </select>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                              <span style={{ fontSize: 12, color: '#9ca3af' }}>Day</span>
                              <input type="number" min={0} value={step.delay_days} onChange={e => updatePlanStep(idx, { delay_days: +e.target.value })}
                                style={{ width: 52, padding: '4px 6px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13, fontFamily: "'DM Sans',sans-serif", textAlign: 'center' }} />
                            </div>
                            <button onClick={() => removePlanStep(idx)} aria-label="Remove step" title="Remove step" style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>✕</button>
                          </div>
                          {step.type === 'email' && (
                            <input className="crm-input" placeholder="Subject line…" value={step.subject ?? ''} onChange={e => updatePlanStep(idx, { subject: e.target.value })} style={{ marginBottom: 8 }} />
                          )}
                          {step.type === 'email' ? (() => {
                            const mode = stepViewMode[idx] ?? 'code';
                            const preview = (step.body || '')
                              .replaceAll('{{first_name}}', 'John')
                              .replaceAll('{{last_name}}', 'Smith')
                              .replaceAll('{{full_name}}', 'John Smith')
                              .replaceAll('{{email}}', 'john.smith@email.com')
                              .replaceAll('{{client_type}}', 'Buyer')
                              .replaceAll('{{agent_name}}', 'Zachary Stovall')
                              .replaceAll('{{agent_email}}', 'info@fairoaksrealtygroup.com')
                              .replaceAll('{{agent_phone}}', '210-390-9997')
                              .replaceAll('{{brokerage}}', 'Fair Oaks Realty Group')
                              .replaceAll('{{unsubscribe_url}}', '#');
                            return (
                              <div>
                                {/* Tab bar */}
                                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                                  {(['code', 'preview'] as const).map(m => (
                                    <button key={m} onClick={() => setStepViewMode(prev => ({ ...prev, [idx]: m }))}
                                      style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: mode === m ? 600 : 400, background: mode === m ? '#111' : '#fff', color: mode === m ? '#fff' : '#6b7280' }}>
                                      {m === 'code' ? '</> Code' : '👁 Preview'}
                                    </button>
                                  ))}
                                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af', alignSelf: 'center' }}>
                                    Merge fields: {'{{first_name}}'} {'{{agent_name}}'} {'{{unsubscribe_url}}'}
                                  </span>
                                </div>
                                {mode === 'code' ? (
                                  <textarea
                                    className="crm-input"
                                    style={{ minHeight: 200, resize: 'vertical', fontSize: 13, fontFamily: "'Courier New', Courier, monospace", lineHeight: 1.6 }}
                                    placeholder={'Paste HTML here… e.g. <p>Hi {{first_name}},</p>'}
                                    value={step.body}
                                    onChange={e => updatePlanStep(idx, { body: e.target.value })}
                                  />
                                ) : (
                                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', minHeight: 200, overflow: 'hidden' }}>
                                    {/* Email chrome */}
                                    <div style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', padding: '8px 14px', fontSize: 13, color: '#6b7280' }}>
                                      <div><strong>From:</strong> Fair Oaks Realty Group &lt;info@fairoaksrealtygroup.com&gt;</div>
                                      <div><strong>To:</strong> john.smith@email.com</div>
                                      <div><strong>Subject:</strong> {(step.subject || '(no subject)').replaceAll('{{first_name}}', 'John').replaceAll('{{agent_name}}', 'Zachary Stovall')}</div>
                                    </div>
                                    <iframe
                                      srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:20px;font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.6}a{color:#c9922c}</style></head><body>${preview || '<p style="color:#9ca3af">Nothing to preview yet — add some HTML in the Code tab.</p>'}</body></html>`}
                                      style={{ width: '100%', minHeight: 300, border: 'none', display: 'block' }}
                                      sandbox="allow-same-origin"
                                      onLoad={e => {
                                        const iframe = e.currentTarget;
                                        const body = iframe.contentDocument?.body;
                                        if (body) iframe.style.height = body.scrollHeight + 40 + 'px';
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })() : (
                            <textarea className="crm-input" style={{ minHeight: 80, resize: 'vertical', fontSize: 14 }}
                              placeholder={step.type === 'sms' ? 'SMS message…' : step.type === 'task' ? 'Task description for the agent…' : 'Note content…'}
                              value={step.body} onChange={e => updatePlanStep(idx, { body: e.target.value })} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="crm-btn crm-btn-ghost" onClick={() => setActionPlanView(activeActionPlan ? 'detail' : 'list')}>Cancel</button>
                    <button className="crm-btn crm-btn-gold" onClick={saveActionPlan} disabled={saving || !newPlan.name}>{saving ? 'Saving…' : activeActionPlan ? 'Save Changes' : 'Create Plan'}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Social Media Page ── */}
          {page === 'social' && (
            <SocialMediaSection
              agentId={profile?.id ?? ''}
              isAdmin={isAdmin}
              toast={(msg: string) => showToast(msg)}
            />
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
                <span style={{ fontSize: 11, marginTop: 3, fontWeight: page === item.id ? 700 : 400, letterSpacing: .3 }}>{item.label}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* ── Deal Modal ── */}
      {activeDeal && (
        <div className="overlay" onClick={() => { setActiveDeal(null); setShowDealAgentPicker(false); setDealTab('overview'); if (typeof window !== 'undefined') sessionStorage.removeItem('activeDealId'); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 26px', background: '#111', color: '#fff', display: 'flex', alignItems: 'center', gap: 12, borderRadius: '12px 12px 0 0' }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 600, flex: 1 }}>{activeDeal.client}</h3>
              <span style={{ ...Object.fromEntries((TYPE_COLORS[activeDeal.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 } as React.CSSProperties}>{activeDeal.type}</span>
              <button onClick={() => { setActiveDeal(null); setShowDealAgentPicker(false); setDealTab('overview'); if (typeof window !== 'undefined') sessionStorage.removeItem('activeDealId'); }} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: isMobile ? '16px 18px' : '20px 26px', overflowY: 'auto', flex: 1 }}>
              {/* Pipeline bar */}
              <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e7eb', marginBottom: 18 }}>
                {STAGES.map((s, i) => {
                  const ci = STAGES.indexOf(activeDeal.stage);
                  const cls = i < ci ? { background: '#1a1a1a', color: 'rgba(255,255,255,.75)' } : i === ci ? { background: '#c9922c', color: '#111', fontWeight: 700 } : { background: '#f3f4f6', color: '#9ca3af' };
                  return <div key={s} onClick={() => setStage(activeDeal, s)} style={{ flex: 1, textAlign: 'center', padding: '9px 4px', fontSize: 12, fontWeight: 500, cursor: 'pointer', borderRight: i < STAGES.length - 1 ? '1px solid #e5e7eb' : 'none', ...cls }}>{s}</div>;
                })}
              </div>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '2px solid #f0ebe0', marginBottom: 18 }}>
                {(['overview', 'client', 'emails', 'docs', 'intel', 'commission'] as const).map(t => (
                  <button key={t} onClick={() => setDealTab(t)}
                    style={{ padding: '8px 18px', fontSize: 14, cursor: 'pointer', background: 'none', border: 'none', color: dealTab === t ? '#111' : '#6b7280', borderBottom: dealTab === t ? '2px solid #c9922c' : '2px solid transparent', marginBottom: -2, fontFamily: "'DM Sans',sans-serif", fontWeight: dealTab === t ? 500 : 400, textTransform: 'capitalize' }}>
                    {t === 'emails' ? 'Email Log' : t === 'docs' ? `Docs${dealDocs.length > 0 ? ` (${dealDocs.length})` : ''}` : t === 'intel' ? '🏢 Property Intel' : t === 'commission' ? `💰 Commission${dealCommission ? ' ✓' : ''}` : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* Overview tab */}
              {dealTab === 'overview' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                    <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Property</label><input className="crm-input" style={{ marginTop: 4 }} defaultValue={activeDeal.property} onBlur={e => updateDeal(activeDeal.id, { property: e.target.value })} /></div>
                    <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Value ($)</label><input className="crm-input" type="number" style={{ marginTop: 4 }} defaultValue={activeDeal.value} onBlur={e => updateDeal(activeDeal.id, { value: +e.target.value })} /></div>
                    <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Stage</label>
                      <select className="crm-input" style={{ marginTop: 4 }} value={activeDeal.stage} onChange={e => setStage(activeDeal, e.target.value)}>
                        {STAGES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    {isAdmin && (
                      <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Assigned Agent</label>
                        <select className="crm-input" style={{ marginTop: 4 }} value={activeDeal.agent_id} onChange={e => updateDeal(activeDeal.id, { agent_id: e.target.value })}>
                          {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                        </select>
                      </div>
                    )}
                    <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Notes</label><textarea className="crm-input" style={{ marginTop: 4, minHeight: 80, resize: 'vertical' }} defaultValue={activeDeal.notes} onBlur={e => updateDeal(activeDeal.id, { notes: e.target.value })} /></div>
                  </div>

                  {/* ── Loss Reason Banner ── */}
                  {activeDeal.stage === 'Lost' && (
                    <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: 18, flexShrink: 0 }}>📋</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#dc2626', marginBottom: 2 }}>Loss Reason</div>
                        {activeDeal.lost_reason ? (
                          <div style={{ fontSize: 14, color: '#374151' }}>{activeDeal.lost_reason}</div>
                        ) : (
                          <button onClick={() => triggerLostPrompt(activeDeal)} style={{ fontSize: 14, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}>
                            + Add loss reason
                          </button>
                        )}
                      </div>
                      {activeDeal.lost_reason && (
                        <button onClick={() => triggerLostPrompt(activeDeal)} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', flexShrink: 0 }}>Edit</button>
                      )}
                    </div>
                  )}

                  {/* ── Agent Tags ── */}
                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Agents on This Deal</label>
                      {isAdmin && (
                        <div style={{ position: 'relative', marginLeft: 'auto' }}>
                          <button
                            onClick={e => { e.stopPropagation(); setShowDealAgentPicker(v => !v); }}
                            style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, border: '1px dashed #d1d5db', background: 'none', color: '#6b7280', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                            ＋ Tag Agent
                          </button>
                          {showDealAgentPicker && (
                            <div
                              onClick={e => e.stopPropagation()}
                              style={{ position: 'absolute', top: '100%', right: 0, zIndex: 60, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.14)', minWidth: 230, padding: '6px 0', marginTop: 4 }}>
                              <div style={{ padding: '5px 12px 4px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500 }}>Select Agents</div>
                              {profiles.map(p => {
                                const isTagged = (activeDeal.assigned_agent_ids ?? []).includes(p.id);
                                return (
                                  <button key={p.id}
                                    onClick={e => { e.stopPropagation(); toggleDealAgentTag(activeDeal.id, p.id); }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: isTagged ? '#f0fdf4' : 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#111', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                                      {(p.first_name[0] ?? '') + (p.last_name[0] ?? '')}
                                    </span>
                                    <span style={{ flex: 1 }}>
                                      {p.first_name} {p.last_name}
                                      <br /><span style={{ fontSize: 12, color: '#9ca3af' }}>{p.role}</span>
                                    </span>
                                    {isTagged && <span style={{ fontSize: 14, color: '#16a34a' }}>✓</span>}
                                  </button>
                                );
                              })}
                              <div style={{ borderTop: '1px solid #f0f0f0', padding: '5px 12px 2px' }}>
                                <button onClick={e => { e.stopPropagation(); setShowDealAgentPicker(false); }}
                                  style={{ background: 'none', border: 'none', fontSize: 12, color: '#9ca3af', cursor: 'pointer', padding: 0 }}>Close</button>
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
                              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#c9922c', color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                                {(owner.first_name[0] ?? '') + (owner.last_name[0] ?? '')}
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>{owner.first_name} {owner.last_name}</span>
                              <span style={{ fontSize: 11, color: '#b45309', marginLeft: 2 }}>Owner</span>
                            </div>
                          )}
                          {/* Tagged co-agents */}
                          {taggedOnDeal.filter(p => p.id !== activeDeal.agent_id).map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20, padding: '5px 10px 5px 7px' }}>
                              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                                {(p.first_name[0] ?? '') + (p.last_name[0] ?? '')}
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{p.first_name} {p.last_name}</span>
                              {isAdmin && (
                                <button onClick={() => toggleDealAgentTag(activeDeal.id, p.id)}
                                  style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }} title="Remove">✕</button>
                              )}
                            </div>
                          ))}
                          {taggedOnDeal.filter(p => p.id !== activeDeal.agent_id).length === 0 && (
                            <span style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No co-agents tagged yet</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ marginTop: 16, fontSize: 13, color: '#6b7280' }}>Created: {activeDeal.created_at?.slice(0, 10)} · Last Touch: {activeDeal.last_touch?.slice(0, 10)}</div>
                  {isAdmin && <div style={{ marginTop: 12 }}><button onClick={() => deleteDeal(activeDeal.id)} style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}>Delete Deal</button></div>}
                </div>
              )}

              {/* Client tab */}
              {dealTab === 'client' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                  <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Client Name</label><input className="crm-input" style={{ marginTop: 4 }} defaultValue={activeDeal.client} onBlur={e => updateDeal(activeDeal.id, { client: e.target.value })} /></div>
                  <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Email</label><input className="crm-input" type="email" style={{ marginTop: 4 }} defaultValue={activeDeal.client_email} onBlur={e => updateDeal(activeDeal.id, { client_email: e.target.value })} /></div>
                  <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Phone</label><input className="crm-input" style={{ marginTop: 4 }} defaultValue={activeDeal.client_phone} onBlur={e => updateDeal(activeDeal.id, { client_phone: e.target.value })} /></div>
                  <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Deal Type</label>
                    <select className="crm-input" style={{ marginTop: 4 }} value={activeDeal.type} onChange={e => updateDeal(activeDeal.id, { type: e.target.value })}>
                      {DEAL_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Emails tab */}
              {dealTab === 'emails' && (
                <div>
                  {/* Compose button */}
                  {gmailConnected && activeDeal?.client_email && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                      <button className="crm-btn crm-btn-gold crm-btn-sm" onClick={() => {
                        if (!showCompose) {
                          clearComposeBody();
                          setComposeSubject('');
                        }
                        setShowCompose(v => !v);
                      }}
                        style={{ background: '#c9922c', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        ✉️ Compose
                      </button>
                    </div>
                  )}

                  {/* Compose panel */}
                  {showCompose && activeDeal && (
                    <div style={{ marginBottom: 14, border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#111', color: '#fff' }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{replyToEmail ? '↩ Reply' : 'New Email'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            onClick={() => fetch(`/api/gmail/signature?userId=${session!.user.id}`).then(r => r.json()).then(s => { if (s.signature !== undefined) { setProfile(prev => prev ? { ...prev, email_signature: s.signature } : prev); showToast('Signature synced from Gmail'); } })}
                            style={{ background: 'none', border: '1px solid rgba(255,255,255,.3)', color: 'rgba(255,255,255,.7)', cursor: 'pointer', fontSize: 12, borderRadius: 4, padding: '2px 8px', fontFamily: "'DM Sans',sans-serif" }}>
                            ↻ Sync signature
                          </button>
                          <button onClick={() => { setShowCompose(false); setReplyToEmail(null); clearComposeBody(); }} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
                        </div>
                      </div>
                      {replyToEmail && (
                        <div style={{ padding: '8px 12px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe', fontSize: 13, color: '#1d4ed8' }}>
                          ↩ Replying to: &ldquo;{replyToEmail.subject}&rdquo; — this will appear in the same Gmail thread
                        </div>
                      )}
                      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>To</label>
                          <div style={{ marginTop: 4, padding: '6px 10px', background: '#f3f4f6', borderRadius: 5, fontSize: 13, color: '#6b7280' }}>{activeDeal.client_email}</div>
                        </div>
                        {activeDeal.assigned_agent_ids?.filter(id => id !== session!.user.id).length > 0 && (
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>CC (tagged agents)</label>
                            <div style={{ marginTop: 4, padding: '6px 10px', background: '#fef9f0', border: '1px solid #fde68a', borderRadius: 5, fontSize: 13, color: '#92400e' }}>
                              {activeDeal.assigned_agent_ids.filter(id => id !== session!.user.id).map(id => agentName(id)).join(', ')}
                            </div>
                          </div>
                        )}
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Subject</label>
                          <input className="crm-input" style={{ marginTop: 4 }} value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Email subject…" />
                        </div>
                        {/* Rich text editor */}
                        <div style={{ marginTop: 4, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                          {/* Formatting toolbar */}
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, padding: '4px 8px', background: '#fafafa', borderBottom: '1px solid #e9ecef' }}>
                            {/* Font family */}
                            <select className="rtb-select" aria-label="Font family" defaultValue="Arial" onChange={e => richCmd('fontName', e.target.value)} style={{ padding: '0 6px', maxWidth: 104 }}>
                              {['Arial','Georgia','Times New Roman','Courier New','Verdana','Trebuchet MS'].map(f => <option key={f} value={f}>{f === 'Times New Roman' ? 'Times' : f === 'Trebuchet MS' ? 'Trebuchet' : f}</option>)}
                            </select>
                            {/* Font size */}
                            <select className="rtb-select" aria-label="Font size" defaultValue="3" onChange={e => richCmd('fontSize', e.target.value)} style={{ padding: '0 4px', width: 50 }}>
                              {[['1','8'],['2','10'],['3','12'],['4','14'],['5','18'],['6','24'],['7','36']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                            </select>

                            <span style={{ width: 1, height: 18, background: '#e0e0e0', margin: '0 5px', flexShrink: 0 }} />

                            {/* Bold */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('bold'); }} title="Bold" aria-label="Bold" style={{ fontWeight: 700, fontSize: 14 }}>B</button>
                            {/* Italic */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('italic'); }} title="Italic" aria-label="Italic" style={{ fontStyle: 'italic', fontSize: 14 }}>I</button>
                            {/* Underline */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('underline'); }} title="Underline" aria-label="Underline" style={{ textDecoration: 'underline', fontSize: 14 }}>U</button>

                            <span style={{ width: 1, height: 18, background: '#e0e0e0', margin: '0 5px', flexShrink: 0 }} />

                            {/* Text color — hidden input overlaid behind A */}
                            <label className="rtb" title="Text color" aria-label="Text color" style={{ position: 'relative', flexDirection: 'column', gap: 0 }}>
                              <span style={{ fontWeight: 800, fontSize: 14, lineHeight: 1, display: 'block' }}>A</span>
                              <span style={{ display: 'block', height: 3, background: '#c9922c', borderRadius: 1, marginTop: 1 }} />
                              <input type="color" defaultValue="#000000" onChange={e => richCmd('foreColor', e.target.value)}
                                style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                            </label>

                            <span style={{ width: 1, height: 18, background: '#e0e0e0', margin: '0 5px', flexShrink: 0 }} />

                            {/* Align left */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('justifyLeft'); }} title="Align left" aria-label="Align left">
                              <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="4.5" width="9" height="2" rx="1"/><rect x="0" y="9" width="12" height="2" rx="1"/></svg>
                            </button>
                            {/* Align center */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('justifyCenter'); }} title="Align center" aria-label="Align center">
                              <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2.5" y="4.5" width="9" height="2" rx="1"/><rect x="1" y="9" width="12" height="2" rx="1"/></svg>
                            </button>
                            {/* Align right */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('justifyRight'); }} title="Align right" aria-label="Align right">
                              <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="5" y="4.5" width="9" height="2" rx="1"/><rect x="2" y="9" width="12" height="2" rx="1"/></svg>
                            </button>

                            <span style={{ width: 1, height: 18, background: '#e0e0e0', margin: '0 5px', flexShrink: 0 }} />

                            {/* Bullet list */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('insertUnorderedList'); }} title="Bullet list" aria-label="Bullet list">
                              <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><circle cx="1.5" cy="1.5" r="1.5"/><rect x="4" y="0.5" width="10" height="2" rx="1"/><circle cx="1.5" cy="5.5" r="1.5"/><rect x="4" y="4.5" width="10" height="2" rx="1"/><circle cx="1.5" cy="9.5" r="1.5"/><rect x="4" y="8.5" width="10" height="2" rx="1"/></svg>
                            </button>
                            {/* Numbered list */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('insertOrderedList'); }} title="Numbered list" aria-label="Numbered list">
                              <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><text x="0" y="3" fontSize="3.5" fontFamily="Arial" fontWeight="bold">1.</text><rect x="4" y="0.5" width="10" height="2" rx="1"/><text x="0" y="7" fontSize="3.5" fontFamily="Arial" fontWeight="bold">2.</text><rect x="4" y="4.5" width="10" height="2" rx="1"/><text x="0" y="11" fontSize="3.5" fontFamily="Arial" fontWeight="bold">3.</text><rect x="4" y="8.5" width="10" height="2" rx="1"/></svg>
                            </button>
                            {/* Outdent */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('outdent'); }} title="Outdent" aria-label="Outdent">
                              <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><polygon points="0,4.5 3.5,7 0,9.5"/><rect x="5" y="4.5" width="9" height="2" rx="1"/><rect x="5" y="8.5" width="9" height="2" rx="1"/></svg>
                            </button>
                            {/* Indent */}
                            <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmd('indent'); }} title="Indent" aria-label="Indent">
                              <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><polygon points="0,4.5 3.5,7 0,9.5" transform="rotate(180 1.75 7)"/><rect x="5" y="4.5" width="9" height="2" rx="1"/><rect x="5" y="8.5" width="9" height="2" rx="1"/></svg>
                            </button>
                          </div>
                          {/* Editable body */}
                          <div
                            ref={composeBodyRef}
                            contentEditable
                            suppressContentEditableWarning
                            role="textbox"
                            aria-multiline="true"
                            aria-label="Email body"
                            style={{ minHeight: 180, maxHeight: 340, overflowY: 'auto', padding: '12px 14px', fontSize: 14, fontFamily: 'Arial, sans-serif', lineHeight: 1.65, outline: 'none', color: '#111' }}
                            data-placeholder="Write your message…"
                          />
                        </div>
                        {/* Attachments */}
                        <div>
                          <input
                            ref={attachInputRef}
                            type="file"
                            multiple
                            style={{ display: 'none' }}
                            onChange={e => {
                              const files = Array.from(e.target.files ?? []);
                              setComposeAttachments(prev => [...prev, ...files]);
                              e.target.value = '';
                            }}
                          />
                          {composeAttachments.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                              {composeAttachments.map((file, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 5, fontSize: 12, color: '#374151' }}>
                                  <span>📎</span>
                                  <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                                  <span style={{ color: '#9ca3af', fontSize: 11 }}>({(file.size / 1024).toFixed(0)} KB)</span>
                                  <button onClick={() => setComposeAttachments(prev => prev.filter((_, idx) => idx !== i))}
                                    aria-label="Remove attachment" title="Remove attachment" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }}>✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {profile?.email_signature && (
                          <div style={{ fontSize: 12, color: '#9ca3af', borderTop: '1px dashed #e5e7eb', paddingTop: 6 }}>
                            <span style={{ fontWeight: 600 }}>Signature preview:</span>
                            <div style={{ marginTop: 4, padding: '6px 10px', background: '#f9fafb', borderRadius: 5, fontSize: 13, color: '#374151' }}
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(profile.email_signature) }} />
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                          <button onClick={() => attachInputRef.current?.click()}
                            style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', gap: 5 }}>
                            📎 Attach
                          </button>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="crm-btn crm-btn-sm" onClick={() => { setShowCompose(false); setReplyToEmail(null); setComposeAttachments([]); clearComposeBody(); }}
                              style={{ background: 'none', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 14px', fontSize: 13, cursor: 'pointer' }}>
                              Cancel
                            </button>
                            <button className="crm-btn crm-btn-gold crm-btn-sm" onClick={() => sendGmailEmail(activeDeal)} disabled={composeSending}
                              style={{ background: '#c9922c', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: composeSending ? 0.7 : 1 }}>
                              {composeSending ? 'Sending…' : 'Send via Gmail'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {gmailConnected && activeDeal?.client_email && (
                    <div style={{ marginBottom: 12, padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: '#166534' }}>✉️ Gmail — syncing direct thread with {activeDeal.client_email}</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => syncGmail(activeDeal)} disabled={syncing}
                            style={{ padding: '4px 12px', fontSize: 13, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', opacity: syncing ? 0.7 : 1 }}>
                            {syncing ? 'Syncing…' : '↻ Sync'}
                          </button>
                          <button onClick={() => clearAndResync(activeDeal)} disabled={syncing}
                            title="Delete all Gmail-synced emails for this deal and re-sync fresh"
                            style={{ padding: '4px 10px', fontSize: 13, fontWeight: 600, background: 'none', color: '#166534', border: '1px solid #86efac', borderRadius: 5, cursor: 'pointer', opacity: syncing ? 0.7 : 1 }}>
                            ↺ Clear & Re-sync
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Threaded email list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                    {dealEmails.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>📭 No emails logged yet.</div>}
                    {(() => {
                      // Group emails by gmail_thread_id; emails without a thread ID each get their own group keyed by id
                      const threadMap = new Map<string, DealEmail[]>();
                      for (const email of dealEmails) {
                        const key = email.gmail_thread_id ?? `solo_${email.id}`;
                        const existing = threadMap.get(key) ?? [];
                        existing.push(email);
                        threadMap.set(key, existing);
                      }
                      // Sort groups by most recent email (descending)
                      const groups = Array.from(threadMap.entries()).sort((a, b) => {
                        const latestA = a[1].reduce((mx, e) => e.email_date > mx ? e.email_date : mx, '');
                        const latestB = b[1].reduce((mx, e) => e.email_date > mx ? e.email_date : mx, '');
                        return latestB.localeCompare(latestA);
                      });
                      return groups.map(([threadKey, threadEmails]) => {
                        const isExpanded = expandedThreads.has(threadKey);
                        const latest = threadEmails.reduce((mx, e) => e.email_date > mx.email_date ? e : mx, threadEmails[0]);
                        const snippet = cleanEmailBody(latest.body).slice(0, 120).replace(/\s+/g, ' ');
                        // Open status summary for collapsed header
                        const sentEmails = threadEmails.filter(e => e.direction === 'sent');
                        const openedEmails = sentEmails.filter(e => e.opened_at);
                        const hasTracked = sentEmails.some(e => e.tracking_id);
                        const senderAddr = latest.direction === 'sent' ? latest.to_email : latest.from_email;
                        return (
                          <div key={threadKey} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                            {/* Thread header row */}
                            <div
                              onClick={() => setExpandedThreads(prev => {
                                const next = new Set(prev);
                                if (next.has(threadKey)) next.delete(threadKey); else next.add(threadKey);
                                return next;
                              })}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', background: isExpanded ? '#f9fafb' : '#fff', transition: 'background .12s' }}
                            >
                              {/* Avatar */}
                              <div style={{ width: 34, height: 34, borderRadius: '50%', background: emailAvatarColor(senderAddr), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                                {emailInitials(senderAddr)}
                              </div>
                              {/* Middle: name + subject/snippet */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                  <span style={{ fontSize: 14, fontWeight: 600, color: '#111', flexShrink: 0 }}>{emailDisplayName(senderAddr)}</span>
                                  {threadEmails.length > 1 && <span style={{ fontSize: 12, color: '#9ca3af' }}>{threadEmails.length}</span>}
                                  {openedEmails.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: '#d1fae5', color: '#065f46' }}>👁 Opened</span>}
                                  {openedEmails.length === 0 && hasTracked && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: '#f3f4f6', color: '#9ca3af' }}>Not opened</span>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, overflow: 'hidden' }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{latest.subject}</span>
                                  <span style={{ fontSize: 13, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}> — {snippet}</span>
                                </div>
                              </div>
                              {/* Right: date + chevron */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <span style={{ fontSize: 12, color: '#9ca3af' }}>{latest.email_date}</span>
                                <span style={{ fontSize: 12, color: '#cbd5e1' }}>{isExpanded ? '▾' : '▸'}</span>
                              </div>
                            </div>

                            {/* Expanded thread emails */}
                            {isExpanded && (
                              <div style={{ borderTop: '1px solid #f0f0f0' }}>
                                {[...threadEmails].sort((a, b) => a.email_date.localeCompare(b.email_date)).map((e, idx, arr) => {
                                  const fromAddr = e.direction === 'sent' ? e.to_email : e.from_email;
                                  const toAddr = e.direction === 'sent' ? e.to_email : e.from_email;
                                  return (
                                  <div key={e.id} style={{ padding: '14px 16px', background: idx % 2 === 0 ? '#fafafa' : '#fff', borderBottom: idx < arr.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                                    {/* Email header */}
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: emailAvatarColor(e.from_email), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                                        {emailInitials(e.from_email)}
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                          <div>
                                            <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{emailDisplayName(e.from_email)}</span>
                                            <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 5 }}>&lt;{e.from_email.match(/<(.+)>/)?.[1] ?? e.from_email}&gt;</span>
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                            {e.direction === 'sent' && e.opened_at && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: '#d1fae5', color: '#065f46', fontWeight: 600 }}>👁 Opened</span>}
                                            {e.direction === 'sent' && !e.opened_at && e.tracking_id && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: '#f3f4f6', color: '#9ca3af' }}>Not opened</span>}
                                            <span style={{ fontSize: 12, color: '#9ca3af' }}>{e.email_date}</span>
                                          </div>
                                        </div>
                                        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>to {emailDisplayName(e.to_email)}</div>
                                      </div>
                                    </div>
                                    <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.65, whiteSpace: 'pre-wrap', paddingLeft: 42 }}>{cleanEmailBody(e.body)}</div>
                                  </div>
                                );})}

                                {/* Reply button at the bottom of expanded thread */}
                                {gmailConnected && activeDeal?.client_email && (
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 14px', background: '#fff' }}>
                                    <button
                                      onClick={() => {
                                        const lastEmail = [...threadEmails].sort((a, b) => a.email_date.localeCompare(b.email_date)).slice(-1)[0];
                                        setReplyToEmail(lastEmail);
                                        setComposeSubject(lastEmail.subject?.startsWith('Re:') ? lastEmail.subject : `Re: ${lastEmail.subject}`);
                                        clearComposeBody();
                                        setShowCompose(true);
                                      }}
                                      style={{ background: '#c9922c', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                                      ↩ Reply
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                  <div style={{ background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 8, padding: 15 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#111' }}>+ Log Email Touch</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Direction</label>
                        <select className="crm-input" style={{ marginTop: 4 }} value={ne.direction} onChange={e => setNe({ ...ne, direction: e.target.value as 'sent' | 'received' })}>
                          <option value="sent">Sent</option><option value="received">Received</option>
                        </select>
                      </div>
                      <div><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Date</label><input className="crm-input" type="date" style={{ marginTop: 4 }} value={ne.email_date} onChange={e => setNe({ ...ne, email_date: e.target.value })} /></div>
                      <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Subject</label><input className="crm-input" style={{ marginTop: 4 }} value={ne.subject} onChange={e => setNe({ ...ne, subject: e.target.value })} placeholder="Email subject…" /></div>
                      <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Body / Summary</label><textarea className="crm-input" style={{ marginTop: 4, minHeight: 70, resize: 'vertical' }} value={ne.body} onChange={e => setNe({ ...ne, body: e.target.value })} placeholder="Paste or summarize…" /></div>
                    </div>
                    <div style={{ marginTop: 10, textAlign: 'right' }}>
                      <button className="crm-btn crm-btn-sm" style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, cursor: 'pointer' }} onClick={() => logEmail(activeDeal)}>Log Email</button>
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
                        <span style={{ fontSize: 14, fontWeight: 500 }}>Uploading…</span>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Drop a file here or click to browse</div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>PDF, Word, JPG, PNG · Max 25 MB</div>
                      </>
                    )}
                  </div>
                  <input ref={docFileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                    onChange={e => { const file = e.target.files?.[0]; if (file) uploadDoc(activeDeal, file); e.target.value = ''; }} />

                  {/* Doc list */}
                  {dealDocs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af', fontSize: 14 }}>📂 No documents uploaded yet</div>
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
                              <div style={{ fontSize: 14, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                                {size}{size ? ' · ' : ''}{doc.created_at?.slice(0, 10)}{uploaderName ? ` · ${uploaderName}` : ''}
                              </div>
                            </div>
                            {doc.url && (
                              <a href={doc.url} target="_blank" rel="noreferrer"
                                style={{ padding: '5px 12px', background: '#111', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
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

              {/* ── Property Intel tab ── */}
              {dealTab === 'intel' && (
                <div>
                  {/* Address input + lookup button */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <input
                      id="intel-address-input"
                      className="crm-input"
                      style={{ flex: 1 }}
                      placeholder="Enter property address to look up…"
                      defaultValue={activeDeal.property ?? ''}
                    />
                    <button
                      onClick={async () => {
                        const addr = (document.getElementById('intel-address-input') as HTMLInputElement)?.value?.trim();
                        if (!addr) return;
                        setPropIntelLoading(true);
                        setPropIntel(null);
                        try {
                          const res = await fetch('/api/attom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr }) });
                          const data = await res.json();
                          setPropIntel(data);
                        } catch (e: any) {
                          setPropIntel({ detail: null, comps: [], error: e.message });
                        } finally {
                          setPropIntelLoading(false);
                        }
                      }}
                      style={{ padding: '8px 18px', background: '#111', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {propIntelLoading ? '⏳ Looking up…' : '🔍 Look Up'}
                    </button>
                  </div>

                  {/* Error state */}
                  {propIntel?.error && (
                    <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', fontSize: 14, color: '#991b1b', marginBottom: 16 }}>
                      ⚠️ {propIntel.error.includes('ATTOM_API_KEY') ? (
                        <>ATTOM API key not configured. Add <code style={{ background: '#fecaca', padding: '1px 4px', borderRadius: 3 }}>ATTOM_API_KEY</code> to your environment variables. <a href="https://www.attomdata.com/solutions/property-data-api/" target="_blank" rel="noreferrer" style={{ color: '#c2410c', fontWeight: 600 }}>Get a free trial key →</a></>
                      ) : propIntel.error}
                    </div>
                  )}

                  {/* Property detail card */}
                  {propIntel?.detail && (() => {
                    const d = propIntel.detail;
                    const assessed = d.assessment?.assessed?.assdttlvalue;
                    const market   = d.assessment?.market?.mktttlvalue;
                    const taxAmt   = d.assessment?.tax?.taxamt;
                    const lastSale = d.sale?.amount?.saleamt;
                    const lastSaleDate = d.sale?.salesearchdate;
                    const sqft     = d.building?.size?.universalsize ?? d.building?.size?.livingsize;
                    const ppsf     = d.sale?.calculation?.pricepersizeunit;
                    return (
                      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 18px', marginBottom: 16 }}>
                        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>Property Details</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>{d.address?.oneLine}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                          {[
                            { label: 'Type', val: d.summary?.proptype ?? d.summary?.propLandUse ?? '—' },
                            { label: 'Year Built', val: d.summary?.yearbuilt ?? '—' },
                            { label: 'Sq Ft', val: sqft ? sqft.toLocaleString() : '—' },
                            { label: 'Beds / Baths', val: (d.building?.rooms?.beds != null && d.building?.rooms?.bathstotal != null) ? `${d.building.rooms.beds} / ${d.building.rooms.bathstotal}` : '—' },
                            { label: 'Assessed Value', val: assessed ? `$${assessed.toLocaleString()}` : '—' },
                            { label: 'Market Value', val: market ? `$${market.toLocaleString()}` : '—' },
                            { label: 'Annual Taxes', val: taxAmt ? `$${taxAmt.toLocaleString()}` : '—' },
                            { label: 'Last Sale', val: lastSale ? `$${lastSale.toLocaleString()}` : '—' },
                            { label: 'Last Sale Date', val: lastSaleDate ? lastSaleDate.slice(0, 10) : '—' },
                            ...(ppsf ? [{ label: '$/Sq Ft', val: `$${ppsf.toFixed(0)}` }] : []),
                            ...(d.lot?.lotsize1 ? [{ label: 'Lot Size (SF)', val: d.lot.lotsize1.toLocaleString() }] : []),
                            ...(d.identifier?.apn ? [{ label: 'APN', val: d.identifier.apn }] : []),
                          ].map(({ label, val }) => (
                            <div key={label} style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 7, padding: '10px 12px' }}>
                              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                              <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{String(val)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Comps */}
                  {(propIntel?.comps?.length ?? 0) > 0 && (
                    <div>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>
                        Nearby Sales Comps ({propIntel!.comps.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {propIntel!.comps.map((comp: any, i: number) => {
                          const saleAmt = comp.sale?.amount?.saleamt;
                          const sqft    = comp.building?.size?.universalsize;
                          const ppsf    = comp.sale?.calculation?.pricepersizeunit;
                          const date    = comp.sale?.salesearchdate;
                          return (
                            <div key={comp.identifier?.attomId ?? i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px' }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{comp.address?.oneLine ?? comp.address?.line1}</div>
                                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                  {comp.summary?.proptype ?? ''}{sqft ? ` · ${sqft.toLocaleString()} SF` : ''}{date ? ` · Sold ${date.slice(0, 10)}` : ''}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{saleAmt ? `$${saleAmt.toLocaleString()}` : '—'}</div>
                                {ppsf ? <div style={{ fontSize: 11, color: '#9ca3af' }}>${ppsf.toFixed(0)}/SF</div> : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {!propIntelLoading && !propIntel && (
                    <div style={{ textAlign: 'center', padding: '32px 20px', color: '#9ca3af' }}>
                      <div style={{ fontSize: 32, marginBottom: 10 }}>🏢</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Property Intelligence</div>
                      <div style={{ fontSize: 13 }}>Enter an address above to pull property details, assessed value, tax data, and nearby sale comps from ATTOM.</div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Commission tab ── */}
              {dealTab === 'commission' && (
                <div>
                  {commissionLoading ? (
                    <div style={{ textAlign: 'center', padding: '32px 20px', color: '#9ca3af', fontSize: 14 }}>Loading…</div>
                  ) : (
                    <div>
                      {/* Live preview banner */}
                      {commissionForm.sale_price && (
                        (() => {
                          const sp = Number(commissionForm.sale_price) || 0;
                          const rate = Number(commissionForm.commission_rate) || 0;
                          const split = Number(commissionForm.agent_split) || 0;
                          const ref = Number(commissionForm.referral_fee) || 0;
                          const txFee = Number(commissionForm.transaction_fee) || 0;
                          const gross = sp * (rate / 100);
                          const agentNet = gross * (split / 100) - ref - txFee;
                          const brokerNet = gross - gross * (split / 100);
                          return (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20, background: '#f9f5ef', border: '1px solid #e8dcc8', borderRadius: 10, padding: '14px 16px' }}>
                              <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, marginBottom: 3 }}>Gross Commission</div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: '#c9922c' }}>${gross.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                              </div>
                              <div style={{ textAlign: 'center', borderLeft: '1px solid #e8dcc8', borderRight: '1px solid #e8dcc8' }}>
                                <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, marginBottom: 3 }}>Agent Net</div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: '#059669' }}>${agentNet.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, marginBottom: 3 }}>Brokerage Net</div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: '#374151' }}>${brokerNet.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                              </div>
                            </div>
                          );
                        })()
                      )}

                      {/* Form grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={{ gridColumn: '1/-1' }}>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Sale / Lease Price ($) *</label>
                          <input className="crm-input" type="number" style={{ marginTop: 4 }} value={commissionForm.sale_price} onChange={e => setCommissionForm(f => ({ ...f, sale_price: e.target.value }))} placeholder="0" />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Commission Rate (%)</label>
                          <input className="crm-input" type="number" step="0.1" style={{ marginTop: 4 }} value={commissionForm.commission_rate} onChange={e => setCommissionForm(f => ({ ...f, commission_rate: e.target.value }))} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Agent Split (%)</label>
                          <input className="crm-input" type="number" style={{ marginTop: 4 }} value={commissionForm.agent_split} onChange={e => setCommissionForm(f => ({ ...f, agent_split: e.target.value }))} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Referral Fee ($)</label>
                          <input className="crm-input" type="number" style={{ marginTop: 4 }} value={commissionForm.referral_fee} onChange={e => setCommissionForm(f => ({ ...f, referral_fee: e.target.value }))} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Referral To</label>
                          <input className="crm-input" style={{ marginTop: 4 }} value={commissionForm.referral_to} onChange={e => setCommissionForm(f => ({ ...f, referral_to: e.target.value }))} placeholder="Agent / Brokerage name" />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Transaction Fee ($)</label>
                          <input className="crm-input" type="number" style={{ marginTop: 4 }} value={commissionForm.transaction_fee} onChange={e => setCommissionForm(f => ({ ...f, transaction_fee: e.target.value }))} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Status</label>
                          <select className="crm-input" style={{ marginTop: 4 }} value={commissionForm.status} onChange={e => setCommissionForm(f => ({ ...f, status: e.target.value as Commission['status'] }))}>
                            <option value="pending">Pending</option>
                            <option value="paid">Paid</option>
                            <option value="disputed">Disputed</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Close Date</label>
                          <input className="crm-input" type="date" style={{ marginTop: 4 }} value={commissionForm.close_date} onChange={e => setCommissionForm(f => ({ ...f, close_date: e.target.value }))} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Paid Date</label>
                          <input className="crm-input" type="date" style={{ marginTop: 4 }} value={commissionForm.paid_date} onChange={e => setCommissionForm(f => ({ ...f, paid_date: e.target.value }))} />
                        </div>
                        <div style={{ gridColumn: '1/-1' }}>
                          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Notes</label>
                          <textarea className="crm-input" style={{ marginTop: 4, minHeight: 60, resize: 'vertical' }} value={commissionForm.notes} onChange={e => setCommissionForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional notes…" />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                        <button className="crm-btn crm-btn-gold" onClick={() => saveCommission(activeDeal)} disabled={commissionSaving}>
                          {commissionSaving ? 'Saving…' : dealCommission ? 'Update Commission' : 'Save Commission'}
                        </button>
                      </div>
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
              <button onClick={() => { setShowAddDeal(false); setNd({ client_id: '', client: '', client_email: '', client_phone: '', type: 'Buyer Purchase', property: '', value: 0, notes: '' }); }} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '22px 26px' }}>

              {/* Client selector */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Select Client *</label>
                {clients.length === 0 ? (
                  <div style={{ marginTop: 8, padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 14, color: '#92400e' }}>
                    No clients yet.{' '}
                    <button onClick={() => { setShowAddDeal(false); setShowAddClient(true); }}
                      style={{ background: 'none', border: 'none', color: '#c9922c', fontWeight: 600, cursor: 'pointer', fontSize: 14, textDecoration: 'underline', padding: 0 }}>
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
                <div style={{ marginBottom: 18, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, display: 'flex', gap: 16, fontSize: 13, color: '#166534' }}>
                  <span>👤 <strong>{nd.client}</strong></span>
                  {nd.client_email && <span>✉️ {nd.client_email}</span>}
                  {nd.client_phone && <span>📞 {nd.client_phone}</span>}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Deal Type *</label>
                  <select className="crm-input" style={{ marginTop: 4 }} value={nd.type} onChange={e => setNd({ ...nd, type: e.target.value })}>
                    {DEAL_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Property Address</label>
                  <input className="crm-input" style={{ marginTop: 4 }} placeholder="123 Main St, City, State" value={nd.property} onChange={e => setNd({ ...nd, property: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Deal Value ($)</label>
                  <input className="crm-input" type="number" style={{ marginTop: 4 }} value={nd.value} onChange={e => setNd({ ...nd, value: +e.target.value })} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Notes</label>
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
              <button onClick={() => setShowAddClient(false)} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            {/* Scrollable body */}
            <div style={{ padding: '24px 28px', overflowY: 'auto', maxHeight: 'calc(90vh - 130px)' }}>

              {/* ── Section: Contact Type ── */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>Contact Type *</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                  {CLIENT_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setNc({ ...nc, type: t })}
                      style={{
                        padding: '10px 4px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600,
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
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Identity</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>First Name *</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="Jane" value={nc.first_name} onChange={e => setNc({ ...nc, first_name: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Last Name</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="Smith" value={nc.last_name} onChange={e => setNc({ ...nc, last_name: e.target.value })} />
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>
                      {nc.type === 'Agent' || nc.type === 'Broker' ? 'Business / Brokerage Name' : 'Business Name'} <span style={{ color: '#d1d5db', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder={nc.type === 'Agent' || nc.type === 'Broker' ? 'Century 21, Keller Williams…' : 'Company or business name'} value={nc.business_name} onChange={e => setNc({ ...nc, business_name: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* ── Section: Contact Info ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Contact Info</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Email</label>
                    <input className="crm-input" type="email" style={{ marginTop: 4 }} placeholder="jane@email.com" value={nc.email} onChange={e => setNc({ ...nc, email: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Phone</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="210-555-0000" value={nc.phone} onChange={e => setNc({ ...nc, phone: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Cell Phone</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="210-555-0001" value={nc.cell_phone} onChange={e => setNc({ ...nc, cell_phone: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* ── Section: Property Preferences (non-Agent/Broker) ── */}
              {(nc.type !== 'Agent' && nc.type !== 'Broker') && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Property Preferences</div>
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                  </div>

                  {/* Asset Types dropdown */}
                  <div style={{ marginBottom: 12, position: 'relative' }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500, display: 'block', marginBottom: 4 }}>Asset Type(s)</label>
                    <button type="button"
                      onClick={e => { e.stopPropagation(); setAssetDropdownOpen(assetDropdownOpen === 'nc' ? null : 'nc'); }}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: nc.asset_types.length ? '#111' : '#9ca3af' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {nc.asset_types.length === 0 ? 'Select asset type(s)…' : nc.asset_types.join(', ')}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{assetDropdownOpen === 'nc' ? '▲' : '▼'}</span>
                    </button>
                    {assetDropdownOpen === 'nc' && (
                      <div onClick={e => e.stopPropagation()}
                        style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '6px 0', marginTop: 4 }}>
                        <div style={{ padding: '4px 12px 6px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>Select all that apply</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: '0 6px 6px' }}>
                          {ASSET_TYPES.map(at => {
                            const checked = nc.asset_types.includes(at);
                            return (
                              <label key={at} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? '#fef3e2' : 'transparent', transition: 'background .1s' }}>
                                <input type="checkbox" checked={checked} onChange={() => {
                                  const next = checked ? nc.asset_types.filter(x => x !== at) : [...nc.asset_types, at];
                                  setNc({ ...nc, asset_types: next });
                                }} style={{ accentColor: '#c9922c', width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }} />
                                <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? '#92400e' : '#374151' }}>{at}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '6px 12px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#9ca3af' }}>{nc.asset_types.length} selected</span>
                          <button onClick={() => setAssetDropdownOpen(null)} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Done</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Budget + Size side by side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Budget / Price Range</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="$400k – $500k" value={nc.budget} onChange={e => setNc({ ...nc, budget: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Size Range (Sq Ft)</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="1,500 – 2,500 sqft" value={nc.size_range} onChange={e => setNc({ ...nc, size_range: e.target.value })} />
                    </div>
                  </div>
                  {/* LXP — all types */}
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>🗓 LXP — Lease Expiration Date</label>
                    <input type="date" className="crm-input" style={{ marginTop: 4 }} value={nc.lease_expiration_date} onChange={e => setNc({ ...nc, lease_expiration_date: e.target.value })} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>Contact me:</span>
                      {[90, 120, 180, 360].map(d => (
                        <button key={d} type="button"
                          onClick={() => setNc(f => ({ ...f, lxp_follow_up_days: f.lxp_follow_up_days === d ? null : d }))}
                          style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', fontFamily: "'DM Sans',sans-serif", transition: 'all .12s', borderColor: nc.lxp_follow_up_days === d ? '#c9922c' : '#e5e7eb', background: nc.lxp_follow_up_days === d ? '#fef3e2' : '#f9fafb', color: nc.lxp_follow_up_days === d ? '#92400e' : '#6b7280' }}>
                          {d}d out
                        </button>
                      ))}
                      {nc.lxp_follow_up_days && nc.lease_expiration_date && (
                        <span style={{ fontSize: 12, color: '#c9922c', fontWeight: 600, marginLeft: 4 }}>
                          → {new Date(new Date(nc.lease_expiration_date).getTime() - nc.lxp_follow_up_days * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Section: Professional (Agent/Broker only) ── */}
              {(nc.type === 'Agent' || nc.type === 'Broker') && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Professional</div>
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Brokerage</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="Century 21, KW…" value={nc.brokerage} onChange={e => setNc({ ...nc, brokerage: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>License #</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="TX-0000000" value={nc.license} onChange={e => setNc({ ...nc, license: e.target.value })} />
                    </div>
                  </div>
                  {/* Asset Type — asset type checkboxes */}
                  <div style={{ position: 'relative' }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500, display: 'block', marginBottom: 4 }}>Asset Type</label>
                    <button type="button"
                      onClick={e => { e.stopPropagation(); setAssetDropdownOpen(assetDropdownOpen === 'nc' ? null : 'nc'); }}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: nc.asset_types.length ? '#111' : '#9ca3af' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {nc.asset_types.length === 0 ? 'Office, Industrial, Retail…' : nc.asset_types.join(', ')}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{assetDropdownOpen === 'nc' ? '▲' : '▼'}</span>
                    </button>
                    {assetDropdownOpen === 'nc' && (
                      <div onClick={e => e.stopPropagation()}
                        style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '6px 0', marginTop: 4 }}>
                        <div style={{ padding: '4px 12px 6px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>Select all that apply</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: '0 6px 6px' }}>
                          {ASSET_TYPES.map(at => {
                            const checked = nc.asset_types.includes(at);
                            return (
                              <label key={at} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? '#e0f2fe' : 'transparent', transition: 'background .1s' }}>
                                <input type="checkbox" checked={checked} onChange={() => {
                                  const next = checked ? nc.asset_types.filter(x => x !== at) : [...nc.asset_types, at];
                                  setNc({ ...nc, asset_types: next });
                                }} style={{ accentColor: '#0369a1', width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }} />
                                <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? '#075985' : '#374151' }}>{at}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '6px 12px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#9ca3af' }}>{nc.asset_types.length} selected</span>
                          <button onClick={() => setAssetDropdownOpen(null)} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Done</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Section: Location ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Location</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Street Address</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="123 Main St" value={nc.address} onChange={e => setNc({ ...nc, address: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>City</label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder="San Antonio" value={nc.city} onChange={e => setNc({ ...nc, city: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>State</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="TX" value={nc.state} onChange={e => setNc({ ...nc, state: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>ZIP</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="78015" value={nc.zip} onChange={e => setNc({ ...nc, zip: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Section: Notes ── */}
              <div>
                {/* Lead Source & Tags */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Lead Source</label>
                    <select className="crm-input" style={{ marginTop: 4 }} value={nc.lead_source} onChange={e => setNc({ ...nc, lead_source: e.target.value })}>
                      <option value="">Select source…</option>
                      {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Tags</label>
                    <div style={{ marginTop: 4, border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px', minHeight: 38, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', background: '#fff', cursor: 'text' }}
                      onClick={() => document.getElementById('nc-tag-input')?.focus()}>
                      {nc.tags.map(tag => (
                        <span key={tag} style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 8, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                          {tag}<button onClick={() => setNc({ ...nc, tags: nc.tags.filter(t => t !== tag) })} aria-label={`Remove tag ${tag}`} title="Remove tag" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', fontSize: 11, padding: 0, lineHeight: 1 }}>✕</button>
                        </span>
                      ))}
                      <input id="nc-tag-input" placeholder={nc.tags.length === 0 ? 'Add tags…' : ''} value={tagInput} onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) { e.preventDefault(); const tag = tagInput.trim().replace(/,$/, ''); if (!nc.tags.includes(tag)) setNc({ ...nc, tags: [...nc.tags, tag] }); setTagInput(''); } if (e.key === 'Backspace' && !tagInput && nc.tags.length) setNc({ ...nc, tags: nc.tags.slice(0, -1) }); }}
                        style={{ border: 'none', outline: 'none', fontSize: 13, fontFamily: "'DM Sans',sans-serif", minWidth: 80, flex: 1 }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Press Enter or comma to add</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Notes</div>
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
              <button onClick={() => setShowInvite(false)} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '22px 26px' }}>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: '#92400e', marginBottom: 16 }}>
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
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>{f.label}</label>
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
                  {c.business_name && <div style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>{c.business_name}</div>}
                  <span style={{ ...Object.fromEntries((CLIENT_TYPE_COLORS[c.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 13, fontWeight: 700 } as React.CSSProperties}>
                    {c.type === 'Buyer' ? '🏡' : c.type === 'Seller' ? '🪧' : c.type === 'Tenant' ? '🔑' : c.type === 'Landlord/Investor' ? '🏢' : c.type === 'Agent' ? '🤝' : '🏛'} {c.type}
                  </span>
                </div>
                <button onClick={() => setActiveClient(null)} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>

              {/* Smart Status Banner */}
              {(() => {
                const activeDeal = clientDeals.find(d => d.stage !== 'Closed' && d.stage !== 'Lost');
                const closedDeal = clientDeals.find(d => d.stage === 'Closed');
                const daysSinceTouch = c.last_touched_at ? Math.floor((Date.now() - new Date(c.last_touched_at).getTime()) / 86400000) : null;
                const lxpDays = c.lease_expiration_date ? Math.ceil((new Date(c.lease_expiration_date).getTime() - Date.now()) / 86400000) : null;

                if (lxpDays !== null && lxpDays < 90) {
                  const isExpired = lxpDays < 0;
                  const bg = isExpired ? '#fee2e2' : lxpDays < 30 ? '#fff7ed' : '#fefce8';
                  const color = isExpired ? '#dc2626' : lxpDays < 30 ? '#c2410c' : '#a16207';
                  return (
                    <div style={{ background: bg, padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color, borderBottom: `1px solid ${color}22` }}>
                      <span>🗓 {isExpired ? `Lease expired ${Math.abs(lxpDays)}d ago` : `Lease expires in ${lxpDays} day${lxpDays === 1 ? '' : 's'}`}</span>
                      <button onClick={() => openEditClient(c)} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 12, color, cursor: 'pointer', fontWeight: 700, textDecoration: 'underline', fontFamily: "'DM Sans',sans-serif" }}>Update →</button>
                    </div>
                  );
                }
                if (activeDeal) {
                  const stageMeta: Record<string, [string, string]> = {
                    'Prospect': ['#eff6ff', '#1e4d8c'], 'Active': ['#dcfce7', '#15803d'],
                    'LOI': ['#f3e8ff', '#7e22ce'], 'In Contract': ['#fefce8', '#92400e'],
                  };
                  const [bg, color] = stageMeta[activeDeal.stage] ?? ['#f3f4f6', '#374151'];
                  return (
                    <div style={{ background: bg, padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color, borderBottom: `1px solid ${color}22` }}>
                      <span>🟢 Active — {activeDeal.type}</span>
                      <span style={{ background: `${color}22`, color, padding: '1px 8px', borderRadius: 10, fontSize: 12 }}>{activeDeal.stage}</span>
                      <button onClick={() => { setActiveClient(null); setPage('deals'); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 12, color, cursor: 'pointer', fontWeight: 700, textDecoration: 'underline', fontFamily: "'DM Sans',sans-serif" }}>View deal →</button>
                    </div>
                  );
                }
                if (closedDeal) {
                  return (
                    <div style={{ background: '#f3f4f6', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                      <span>⚫ Past client — deal closed</span>
                      {closedDeal.created_at && <span style={{ color: '#9ca3af' }}>{new Date(closedDeal.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
                    </div>
                  );
                }
                if (daysSinceTouch !== null && daysSinceTouch >= 90) {
                  return (
                    <div style={{ background: '#fff7ed', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#c2410c', borderBottom: '1px solid #fed7aa' }}>
                      <span>🔴 No contact in {daysSinceTouch} days</span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>Log a touch below ↓</span>
                    </div>
                  );
                }
                return null;
              })()}

              <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', maxHeight: 'calc(90vh - 120px)' }}>
                {/* Contact Info */}
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>
                    {c.type === 'Tenant' ? '🔑 Tenant Details' : c.type === 'Buyer' ? '🏡 Buyer Details' : c.type === 'Seller' ? '🪧 Seller Details' : c.type === 'Landlord/Investor' ? '🏢 Landlord Details' : c.type === 'Agent' || c.type === 'Broker' ? '🤝 Agent Details' : 'Contact Information'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', gridColumn: (c.extra_emails?.length > 0) ? '1/-1' : undefined }}>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>
                        Email{(c.extra_emails?.length ?? 0) > 0 ? 's' : ''}
                      </div>
                      {c.email ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <a href={`mailto:${c.email}`} style={{ fontSize: 14, fontWeight: 500, color: '#c9922c', textDecoration: 'none', wordBreak: 'break-all' }}>{c.email}</a>
                            <span style={{ fontSize: 10, background: '#dcfce7', color: '#16a34a', borderRadius: 10, padding: '1px 6px', fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', flexShrink: 0 }}>Primary</span>
                          </div>
                          {(c.extra_emails ?? []).map((em, i) => em.trim() ? (
                            <a key={i} href={`mailto:${em}`} style={{ fontSize: 14, fontWeight: 500, color: '#6b7280', textDecoration: 'none', wordBreak: 'break-all' }}>{em}</a>
                          ) : null)}
                        </div>
                      ) : <span style={{ fontSize: 14, color: '#d1d5db' }}>Not provided</span>}
                    </div>
                    <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>Phone</div>
                      {c.phone ? (
                        <a href={`tel:${c.phone}`} style={{ fontSize: 14, fontWeight: 500, color: '#374151', textDecoration: 'none' }}>{c.phone}</a>
                      ) : <span style={{ fontSize: 14, color: '#d1d5db' }}>Not provided</span>}
                    </div>
                    <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>Cell Phone</div>
                      {c.cell_phone ? (
                        <a href={`tel:${c.cell_phone}`} style={{ fontSize: 14, fontWeight: 500, color: '#374151', textDecoration: 'none' }}>{c.cell_phone}</a>
                      ) : <span style={{ fontSize: 14, color: '#d1d5db' }}>Not provided</span>}
                    </div>
                    {(c.address || c.city || c.state || c.zip) && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', gridColumn: '1/-1' }}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>Address</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>
                          {c.address && <div>{c.address}</div>}
                          {(c.city || c.state || c.zip) && <div>{[c.city, c.state, c.zip].filter(Boolean).join(', ')}</div>}
                        </div>
                      </div>
                    )}
                    {(c.brokerage || c.type === 'Agent' || c.type === 'Broker') && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>Brokerage</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>{c.brokerage || <span style={{ color: '#d1d5db' }}>Not provided</span>}</div>
                      </div>
                    )}
                    {(c.license || c.type === 'Agent' || c.type === 'Broker') && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>License #</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>{c.license || <span style={{ color: '#d1d5db' }}>Not provided</span>}</div>
                      </div>
                    )}
                    {c.budget && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>Budget / Price Range</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>{c.budget}</div>
                      </div>
                    )}
                    {c.size_range && (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>Size Range (Sq Ft)</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>{c.size_range}</div>
                      </div>
                    )}
                    {(c.type === 'Tenant' || c.type === 'Landlord/Investor' || c.lease_expiration_date) && (c.lease_expiration_date ? (() => {
                      const lxpDate = new Date(c.lease_expiration_date);
                      const daysLeft = Math.ceil((lxpDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                      const lxpBg = daysLeft < 0 ? '#fee2e2' : daysLeft < 90 ? '#fed7aa' : daysLeft < 180 ? '#fef9c3' : '#dcfce7';
                      const lxpColor = daysLeft < 0 ? '#dc2626' : daysLeft < 90 ? '#c2410c' : daysLeft < 180 ? '#a16207' : '#16a34a';
                      const lxpLabel = daysLeft < 0 ? `Expired ${Math.abs(daysLeft)}d ago` : daysLeft === 0 ? 'Expires today' : `${daysLeft}d left`;
                      return (
                        <div style={{ background: lxpBg, borderRadius: 8, padding: '12px 14px', gridColumn: '1/-1', border: `1px solid ${lxpColor}22` }}>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>🗓 LXP — Lease Expiration</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{lxpDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: lxpColor, background: `${lxpColor}22`, padding: '2px 8px', borderRadius: 10 }}>{lxpLabel}</span>
                            {c.lxp_follow_up_days && (
                              <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 10 }}>
                                📞 Contact by {new Date(lxpDate.getTime() - c.lxp_follow_up_days * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ({c.lxp_follow_up_days}d out)
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })() : (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', gridColumn: '1/-1', border: '1px dashed #e5e7eb' }}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>🗓 LXP — Lease Expiration</div>
                        <span style={{ fontSize: 13, color: '#d1d5db' }}>Not set — <button onClick={() => openEditClient(c)} style={{ background: 'none', border: 'none', color: '#c9922c', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, fontFamily: "'DM Sans',sans-serif" }}>Add date</button></span>
                      </div>
                    ))}
                    {/* Birthday */}
                    {c.birthday ? (() => {
                      const bday = new Date(c.birthday + 'T00:00:00');
                      const now = new Date();
                      const thisYear = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
                      const nextBday = thisYear < now ? new Date(now.getFullYear() + 1, bday.getMonth(), bday.getDate()) : thisYear;
                      const daysUntil = Math.ceil((nextBday.getTime() - now.setHours(0,0,0,0)) / (1000*60*60*24));
                      const isSoon = daysUntil <= 30;
                      return (
                        <div style={{ background: isSoon ? '#fef3e2' : '#f9fafb', borderRadius: 8, padding: '12px 14px', border: isSoon ? '1px solid #fde68a' : undefined }}>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>🎂 Birthday</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{bday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span>
                            {isSoon && <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e', background: '#fde68a', padding: '1px 7px', borderRadius: 10 }}>{daysUntil === 0 ? '🎉 Today!' : `in ${daysUntil}d`}</span>}
                          </div>
                        </div>
                      );
                    })() : (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', border: '1px dashed #e5e7eb' }}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>🎂 Birthday</div>
                        <span style={{ fontSize: 13, color: '#d1d5db' }}>Not set — <button onClick={() => openEditClient(c)} style={{ background: 'none', border: 'none', color: '#c9922c', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, fontFamily: "'DM Sans',sans-serif" }}>Add date</button></span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Asset Types / Asset Type */}
                {(c.asset_types ?? []).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>
                      Asset Type
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(c.asset_types ?? []).map(at => (
                        <span key={at} style={{ display: 'inline-block', background: (c.type === 'Agent' || c.type === 'Broker') ? '#e0f2fe' : '#fef3e2', border: `1px solid ${(c.type === 'Agent' || c.type === 'Broker') ? '#bae6fd' : '#fde68a'}`, color: (c.type === 'Agent' || c.type === 'Broker') ? '#075985' : '#92400e', borderRadius: 20, padding: '3px 12px', fontSize: 13, fontWeight: 600 }}>{at}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {c.notes && (
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>Notes</div>
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 14px', fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{c.notes}</div>
                  </div>
                )}

                {/* Tagged Agents */}
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>Tagged Agents</div>
                  {taggedAgents.length === 0 ? (
                    <div style={{ fontSize: 14, color: '#9ca3af', fontStyle: 'italic' }}>No agents tagged</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {taggedAgents.map(a => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20, padding: '5px 12px 5px 8px' }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                            {(a.first_name[0] ?? '') + (a.last_name[0] ?? '')}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{a.first_name} {a.last_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Deals */}
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>Linked Deals</div>
                  {clientDeals.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 14, color: '#9ca3af', fontStyle: 'italic' }}>No deals yet</span>
                      <button
                        onClick={() => { setActiveClient(null); setNd({ client_id: c.id, client: `${c.first_name} ${c.last_name}`, client_email: c.email, client_phone: c.phone, type: CLIENT_TYPE_TO_DEAL[c.type] || 'Buyer Purchase', property: '', value: 0, notes: '' }); setShowAddDeal(true); }}
                        style={{ fontSize: 13, color: '#c9922c', background: 'none', border: '1px dashed #c9922c', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                        + Create Deal
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {clientDeals.map(d => (
                        <button key={d.id} onClick={() => { setActiveClient(null); openDeal(d); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
                          <span style={{ ...Object.fromEntries((TYPE_COLORS[d.type] || '').split(';').map(s => s.split(':'))), display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, flexShrink: 0 } as React.CSSProperties}>
                            {d.type.split(' ')[0]}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#111', flex: 1 }}>{d.property || `${c.first_name}'s deal`}</span>
                          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, fontWeight: 600, ...({ 'Prospect': { background: '#f3f4f6', color: '#6b7280' }, 'Active': { background: '#dbeafe', color: '#1e40af' }, 'LOI': { background: '#f3e8ff', color: '#7e22ce' }, 'In Contract': { background: '#fef3c7', color: '#92400e' }, 'Closed': { background: '#dcfce7', color: '#166534' }, 'Lost': { background: '#fee2e2', color: '#991b1b' } }[d.stage] ?? {}) } as React.CSSProperties}>
                            {d.stage}
                          </span>
                          {d.value > 0 && <span style={{ fontSize: 13, color: '#6b7280', flexShrink: 0 }}>{fmtVal(d)}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tasks */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Tasks</div>
                    <button
                      onClick={() => { setTaskClientId(c.id); setTaskForm({ type: 'follow_up', title: '', due_date: '', notes: '' }); setShowTaskModal(true); }}
                      style={{ background: 'none', border: '1px dashed #c9922c', borderRadius: 6, color: '#c9922c', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '3px 10px', fontFamily: "'DM Sans',sans-serif" }}>
                      + Add Task
                    </button>
                  </div>
                  {(() => {
                    const clientTasks = allTasks.filter(t => t.client_id === c.id);
                    if (clientTasks.length === 0) return (
                      <div style={{ fontSize: 14, color: '#9ca3af', fontStyle: 'italic' }}>No pending tasks</div>
                    );
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {clientTasks.map(t => {
                          const due = new Date(t.due_date + 'T00:00:00');
                          const today = new Date(); today.setHours(0,0,0,0);
                          const isOverdue = due < today;
                          const isToday = due.getTime() === today.getTime();
                          const dueBg = isOverdue ? '#fee2e2' : isToday ? '#fef3c7' : '#f0fdf4';
                          const dueColor = isOverdue ? '#dc2626' : isToday ? '#92400e' : '#15803d';
                          const typeLabel = t.type === 'follow_up' ? '📋 Follow Up' : t.type === 'call' ? '📞 Call' : '✉️ Email';
                          return (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }}>
                              <button onClick={() => completeTask(t.id)}
                                style={{ width: 18, height: 18, borderRadius: 4, border: '2px solid #d1d5db', background: '#fff', cursor: 'pointer', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}
                                title="Mark complete">
                              </button>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 2 }}>{t.title}</div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span style={{ fontSize: 12, color: '#6b7280' }}>{typeLabel}</span>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: dueColor, background: dueBg, padding: '1px 7px', borderRadius: 10 }}>
                                    {isOverdue ? `Overdue · ${due.toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : isToday ? 'Due today' : due.toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                                  </span>
                                </div>
                                {t.notes && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 3 }}>{t.notes}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* Activity Log */}
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>Activity Log</div>

                  {/* Log new activity */}
                  <div style={{ background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>+ Log Touch</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      {(['call', 'email', 'meeting', 'note'] as CRMActivity['type'][]).map(t => (
                        <button key={t} type="button" onClick={() => setNewActivity(a => ({ ...a, type: t }))}
                          style={{ flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '2px solid', fontFamily: "'DM Sans',sans-serif", transition: 'all .12s', borderColor: newActivity.type === t ? '#c9922c' : '#e5e7eb', background: newActivity.type === t ? '#fef3e2' : '#fff', color: newActivity.type === t ? '#92400e' : '#6b7280', textAlign: 'center' }}>
                          <div style={{ fontSize: 14, marginBottom: 2 }}>{activityIcon(t)}</div>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                    <textarea className="crm-input" style={{ minHeight: 54, resize: 'none', fontSize: 13, marginBottom: 8 }}
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

                  {/* Activity feed — manual activities + campaign sends merged chronologically */}
                  {(() => {
                    // Build unified timeline entries
                    const manualItems = clientActivities.map(act => ({
                      id: act.id,
                      kind: 'activity' as const,
                      date: act.created_at,
                      act,
                    }));
                    const campaignItems = clientCampaignSends.map(s => ({
                      id: s.id,
                      kind: 'campaign' as const,
                      date: s.sent_at,
                      send: s,
                    }));
                    const allItems = [...manualItems, ...campaignItems]
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                    if (activityLoading) return (
                      <div style={{ textAlign: 'center', padding: '16px 0', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
                    );
                    if (allItems.length === 0) return (
                      <div style={{ textAlign: 'center', padding: '16px 0', color: '#d1d5db', fontSize: 13 }}>No activity logged yet</div>
                    );
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
                        {allItems.map((item, i) => {
                          const ta = timeAgo(item.date);
                          const isLast = i === allItems.length - 1;

                          if (item.kind === 'activity') {
                            const act = item.act;
                            const agentP = profiles.find(p => p.id === act.agent_id);
                            const agentLabel = agentP ? `${agentP.first_name} ${agentP.last_name}` : profile!.id === act.agent_id ? `${profile!.first_name} ${profile!.last_name}` : 'Agent';
                            return (
                              <div key={act.id} style={{ display: 'flex', gap: 10, paddingBottom: 12 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f3f4f6', border: '2px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{activityIcon(act.type)}</div>
                                  {!isLast && <div style={{ width: 2, flex: 1, background: '#f0f0f0', marginTop: 4, minHeight: 12 }} />}
                                </div>
                                <div style={{ flex: 1, paddingTop: 3, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'capitalize' }}>{act.type.replace('_', ' ')}</span>
                                    <span style={{ fontSize: 11, color: '#9ca3af' }}>by {agentLabel}</span>
                                    <span style={{ marginLeft: 'auto', fontSize: 11, color: ta.color, fontWeight: 600 }}>{ta.label}</span>
                                  </div>
                                  {act.note && (
                                    <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5, background: '#f9fafb', borderRadius: 6, padding: '6px 8px' }}>{act.note}</div>
                                  )}
                                </div>
                              </div>
                            );
                          } else {
                            // Campaign send entry
                            const s = item.send;
                            const statusColor = s.status === 'sent' ? { bg: '#dcfce7', color: '#166534' } : s.status === 'failed' ? { bg: '#fee2e2', color: '#991b1b' } : { bg: '#f3f4f6', color: '#6b7280' };
                            return (
                              <div key={s.id} style={{ display: 'flex', gap: 10, paddingBottom: 12 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#fef3e2', border: '2px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>📧</div>
                                  {!isLast && <div style={{ width: 2, flex: 1, background: '#f0f0f0', marginTop: 4, minHeight: 12 }} />}
                                </div>
                                <div style={{ flex: 1, paddingTop: 3, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Campaign Email</span>
                                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: statusColor.bg, color: statusColor.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.status}</span>
                                    <span style={{ marginLeft: 'auto', fontSize: 11, color: ta.color, fontWeight: 600 }}>{ta.label}</span>
                                  </div>
                                  <div style={{ fontSize: 13, color: '#374151', fontWeight: 600, marginBottom: 2 }}>{s.campaign_name}</div>
                                  {s.subject && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 3 }}>Subject: {s.subject}</div>}
                                  {s.body_preview && (
                                    <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.4, background: '#f9fafb', borderRadius: 6, padding: '5px 8px', whiteSpace: 'pre-wrap', overflow: 'hidden', maxHeight: 48, textOverflow: 'ellipsis' }}>{s.body_preview}</div>
                                  )}
                                </div>
                              </div>
                            );
                          }
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* Gmail Email Thread */}
                {gmailConnected && c.email && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Email Thread</div>
                      <button className="crm-btn crm-btn-gold crm-btn-sm" onClick={() => {
                        if (!showContactCompose) {
                          clearContactComposeBody();
                          setComposeSubject('');
                          setReplyToContactEmail(null);
                          setComposeAttachments([]);
                        }
                        setShowContactCompose(v => !v);
                      }}
                        style={{ background: '#c9922c', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        ✉️ Compose
                      </button>
                    </div>

                    {/* Compose panel */}
                    {showContactCompose && (
                      <div style={{ marginBottom: 14, border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#111', color: '#fff' }}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{replyToContactEmail ? '↩ Reply' : 'New Email'}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                              onClick={() => fetch(`/api/gmail/signature?userId=${session!.user.id}`).then(r => r.json()).then(s => { if (s.signature !== undefined) { setProfile(prev => prev ? { ...prev, email_signature: s.signature } : prev); showToast('Signature synced from Gmail'); } })}
                              style={{ background: 'none', border: '1px solid rgba(255,255,255,.3)', color: 'rgba(255,255,255,.7)', cursor: 'pointer', fontSize: 12, borderRadius: 4, padding: '2px 8px', fontFamily: "'DM Sans',sans-serif" }}>
                              ↻ Sync signature
                            </button>
                            <button onClick={() => { setShowContactCompose(false); setReplyToContactEmail(null); clearContactComposeBody(); setComposeAttachments([]); }} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
                          </div>
                        </div>
                        {replyToContactEmail && (
                          <div style={{ padding: '8px 12px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe', fontSize: 13, color: '#1d4ed8' }}>
                            ↩ Replying to: &ldquo;{replyToContactEmail.subject}&rdquo; — this will appear in the same Gmail thread
                          </div>
                        )}
                        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>To</label>
                            <div style={{ marginTop: 4, padding: '6px 10px', background: '#f3f4f6', borderRadius: 5, fontSize: 13, color: '#6b7280' }}>{c.email}</div>
                          </div>
                          <div>
                            <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Subject</label>
                            <input className="crm-input" style={{ marginTop: 4 }} value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Email subject…" />
                          </div>
                          {/* Rich text editor */}
                          <div style={{ marginTop: 4, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                            {/* Formatting toolbar */}
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, padding: '4px 8px', background: '#fafafa', borderBottom: '1px solid #e9ecef' }}>
                              <select className="rtb-select" aria-label="Font family" defaultValue="Arial" onChange={e => richCmdContact('fontName', e.target.value)} style={{ padding: '0 6px', maxWidth: 104 }}>
                                {['Arial','Georgia','Times New Roman','Courier New','Verdana','Trebuchet MS'].map(f => <option key={f} value={f}>{f === 'Times New Roman' ? 'Times' : f === 'Trebuchet MS' ? 'Trebuchet' : f}</option>)}
                              </select>
                              <select className="rtb-select" aria-label="Font size" defaultValue="3" onChange={e => richCmdContact('fontSize', e.target.value)} style={{ padding: '0 4px', width: 50 }}>
                                {[['1','8'],['2','10'],['3','12'],['4','14'],['5','18'],['6','24'],['7','36']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                              <span style={{ width: 1, height: 18, background: '#e0e0e0', margin: '0 5px', flexShrink: 0 }} />
                              <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmdContact('bold'); }} title="Bold" aria-label="Bold" style={{ fontWeight: 700, fontSize: 14 }}>B</button>
                              <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmdContact('italic'); }} title="Italic" aria-label="Italic" style={{ fontStyle: 'italic', fontSize: 14 }}>I</button>
                              <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmdContact('underline'); }} title="Underline" aria-label="Underline" style={{ textDecoration: 'underline', fontSize: 14 }}>U</button>
                              <span style={{ width: 1, height: 18, background: '#e0e0e0', margin: '0 5px', flexShrink: 0 }} />
                              <label className="rtb" title="Text color" aria-label="Text color" style={{ position: 'relative', flexDirection: 'column', gap: 0 }}>
                                <span style={{ fontWeight: 800, fontSize: 14, lineHeight: 1, display: 'block' }}>A</span>
                                <span style={{ display: 'block', height: 3, background: '#c9922c', borderRadius: 1, marginTop: 1 }} />
                                <input type="color" defaultValue="#000000" onChange={e => richCmdContact('foreColor', e.target.value)}
                                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                              </label>
                              <span style={{ width: 1, height: 18, background: '#e0e0e0', margin: '0 5px', flexShrink: 0 }} />
                              <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmdContact('justifyLeft'); }} title="Align left" aria-label="Align left">
                                <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="4.5" width="9" height="2" rx="1"/><rect x="0" y="9" width="12" height="2" rx="1"/></svg>
                              </button>
                              <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmdContact('justifyCenter'); }} title="Align center" aria-label="Align center">
                                <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2.5" y="4.5" width="9" height="2" rx="1"/><rect x="1" y="9" width="12" height="2" rx="1"/></svg>
                              </button>
                              <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmdContact('justifyRight'); }} title="Align right" aria-label="Align right">
                                <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="5" y="4.5" width="9" height="2" rx="1"/><rect x="2" y="9" width="12" height="2" rx="1"/></svg>
                              </button>
                              <span style={{ width: 1, height: 18, background: '#e0e0e0', margin: '0 5px', flexShrink: 0 }} />
                              <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmdContact('insertUnorderedList'); }} title="Bullet list" aria-label="Bullet list">
                                <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><circle cx="1.5" cy="1.5" r="1.5"/><rect x="4" y="0.5" width="10" height="2" rx="1"/><circle cx="1.5" cy="5.5" r="1.5"/><rect x="4" y="4.5" width="10" height="2" rx="1"/><circle cx="1.5" cy="9.5" r="1.5"/><rect x="4" y="8.5" width="10" height="2" rx="1"/></svg>
                              </button>
                              <button className="rtb" onMouseDown={e => { e.preventDefault(); richCmdContact('insertOrderedList'); }} title="Numbered list" aria-label="Numbered list">
                                <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><text x="0" y="3" fontSize="3.5" fontFamily="Arial" fontWeight="bold">1.</text><rect x="4" y="0.5" width="10" height="2" rx="1"/><text x="0" y="7" fontSize="3.5" fontFamily="Arial" fontWeight="bold">2.</text><rect x="4" y="4.5" width="10" height="2" rx="1"/><text x="0" y="11" fontSize="3.5" fontFamily="Arial" fontWeight="bold">3.</text><rect x="4" y="8.5" width="10" height="2" rx="1"/></svg>
                              </button>
                            </div>
                            {/* Editable body */}
                            <div
                              ref={contactComposeBodyRef}
                              contentEditable
                              suppressContentEditableWarning
                              role="textbox"
                              aria-multiline="true"
                              aria-label="Email body"
                              style={{ minHeight: 160, maxHeight: 300, overflowY: 'auto', padding: '12px 14px', fontSize: 14, fontFamily: 'Arial, sans-serif', lineHeight: 1.65, outline: 'none', color: '#111' }}
                              data-placeholder="Write your message…"
                            />
                          </div>
                          {/* Attachments */}
                          <div>
                            <input
                              ref={contactAttachInputRef}
                              type="file"
                              multiple
                              style={{ display: 'none' }}
                              onChange={e => {
                                const files = Array.from(e.target.files ?? []);
                                setComposeAttachments(prev => [...prev, ...files]);
                                e.target.value = '';
                              }}
                            />
                            {composeAttachments.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                                {composeAttachments.map((file, i) => (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 5, fontSize: 12, color: '#374151' }}>
                                    <span>📎</span>
                                    <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                                    <span style={{ color: '#9ca3af', fontSize: 11 }}>({(file.size / 1024).toFixed(0)} KB)</span>
                                    <button onClick={() => setComposeAttachments(prev => prev.filter((_, idx) => idx !== i))}
                                      aria-label="Remove attachment" title="Remove attachment" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }}>✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {profile?.email_signature && (
                            <div style={{ fontSize: 12, color: '#9ca3af', borderTop: '1px dashed #e5e7eb', paddingTop: 6 }}>
                              <span style={{ fontWeight: 600 }}>Signature preview:</span>
                              <div style={{ marginTop: 4, padding: '6px 10px', background: '#f9fafb', borderRadius: 5, fontSize: 13, color: '#374151' }}
                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(profile.email_signature) }} />
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                            <button onClick={() => contactAttachInputRef.current?.click()}
                              style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', gap: 5 }}>
                              📎 Attach
                            </button>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button className="crm-btn crm-btn-sm" onClick={() => { setShowContactCompose(false); setReplyToContactEmail(null); setComposeAttachments([]); clearContactComposeBody(); }}
                                style={{ background: 'none', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 14px', fontSize: 13, cursor: 'pointer' }}>
                                Cancel
                              </button>
                              <button className="crm-btn crm-btn-gold crm-btn-sm" onClick={() => sendGmailEmailToContact(c)} disabled={composeSending}
                                style={{ background: '#c9922c', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: composeSending ? 0.7 : 1 }}>
                                {composeSending ? 'Sending…' : 'Send via Gmail'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Sync bar */}
                    <div style={{ marginBottom: 12, padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: '#166534' }}>✉️ Gmail — direct thread with {c.email}</span>
                        <button onClick={() => syncGmailForContact(c)} disabled={syncing}
                          style={{ padding: '4px 12px', fontSize: 13, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', opacity: syncing ? 0.7 : 1 }}>
                          {syncing ? 'Syncing…' : '↻ Sync'}
                        </button>
                      </div>
                    </div>

                    {/* Threaded email list */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
                      {contactEmailsLoading && (
                        <div style={{ textAlign: 'center', padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading emails…</div>
                      )}
                      {!contactEmailsLoading && contactEmails.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 16, color: '#9ca3af', fontSize: 13 }}>📭 No emails yet. Hit Sync to pull Gmail history.</div>
                      )}
                      {!contactEmailsLoading && (() => {
                        const threadMap = new Map<string, DealEmail[]>();
                        for (const email of contactEmails) {
                          const key = email.gmail_thread_id ?? `solo_${email.id}`;
                          const existing = threadMap.get(key) ?? [];
                          existing.push(email);
                          threadMap.set(key, existing);
                        }
                        const groups = Array.from(threadMap.entries()).sort((a, b) => {
                          const latestA = a[1].reduce((mx, e) => e.email_date > mx ? e.email_date : mx, '');
                          const latestB = b[1].reduce((mx, e) => e.email_date > mx ? e.email_date : mx, '');
                          return latestB.localeCompare(latestA);
                        });
                        return groups.map(([threadKey, threadEmails]) => {
                          const isExpanded = expandedContactThreads.has(threadKey);
                          const latest = threadEmails.reduce((mx, e) => e.email_date > mx.email_date ? e : mx, threadEmails[0]);
                          const snippet = cleanEmailBody(latest.body).slice(0, 120).replace(/\s+/g, ' ');
                          const sentEmails = threadEmails.filter(e => e.direction === 'sent');
                          const openedEmails = sentEmails.filter(e => e.opened_at);
                          const hasTracked = sentEmails.some(e => e.tracking_id);
                          const senderAddrC = latest.direction === 'sent' ? latest.to_email : latest.from_email;
                          return (
                            <div key={threadKey} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                              {/* Thread header */}
                              <div
                                onClick={() => setExpandedContactThreads(prev => {
                                  const next = new Set(prev);
                                  if (next.has(threadKey)) next.delete(threadKey); else next.add(threadKey);
                                  return next;
                                })}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', background: isExpanded ? '#f9fafb' : '#fff', transition: 'background .12s' }}
                              >
                                <div style={{ width: 34, height: 34, borderRadius: '50%', background: emailAvatarColor(senderAddrC), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                                  {emailInitials(senderAddrC)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                    <span style={{ fontSize: 14, fontWeight: 600, color: '#111', flexShrink: 0 }}>{emailDisplayName(senderAddrC)}</span>
                                    {threadEmails.length > 1 && <span style={{ fontSize: 12, color: '#9ca3af' }}>{threadEmails.length}</span>}
                                    {openedEmails.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: '#d1fae5', color: '#065f46' }}>👁 Opened</span>}
                                    {openedEmails.length === 0 && hasTracked && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: '#f3f4f6', color: '#9ca3af' }}>Not opened</span>}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, overflow: 'hidden' }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{latest.subject}</span>
                                    <span style={{ fontSize: 13, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}> — {snippet}</span>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                  <span style={{ fontSize: 12, color: '#9ca3af' }}>{latest.email_date}</span>
                                  <span style={{ fontSize: 12, color: '#cbd5e1' }}>{isExpanded ? '▾' : '▸'}</span>
                                </div>
                              </div>

                              {/* Expanded messages */}
                              {isExpanded && (
                                <div style={{ borderTop: '1px solid #f0f0f0' }}>
                                  {[...threadEmails].sort((a, b) => a.email_date.localeCompare(b.email_date)).map((e, idx, arr) => (
                                    <div key={e.id} style={{ padding: '14px 16px', background: idx % 2 === 0 ? '#fafafa' : '#fff', borderBottom: idx < arr.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: emailAvatarColor(e.from_email), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                                          {emailInitials(e.from_email)}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                            <div>
                                              <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{emailDisplayName(e.from_email)}</span>
                                              <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 5 }}>&lt;{e.from_email.match(/<(.+)>/)?.[1] ?? e.from_email}&gt;</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                              {e.direction === 'sent' && e.opened_at && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: '#d1fae5', color: '#065f46', fontWeight: 600 }}>👁 Opened</span>}
                                              {e.direction === 'sent' && !e.opened_at && e.tracking_id && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: '#f3f4f6', color: '#9ca3af' }}>Not opened</span>}
                                              <span style={{ fontSize: 12, color: '#9ca3af' }}>{e.email_date}</span>
                                            </div>
                                          </div>
                                          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>to {emailDisplayName(e.to_email)}</div>
                                        </div>
                                      </div>
                                      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.65, whiteSpace: 'pre-wrap', paddingLeft: 42 }}>{cleanEmailBody(e.body)}</div>
                                    </div>
                                  ))}
                                  {/* Reply button */}
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', background: '#fff' }}>
                                    <button
                                      onClick={() => {
                                        const lastEmail = [...threadEmails].sort((a, b) => a.email_date.localeCompare(b.email_date)).slice(-1)[0];
                                        setReplyToContactEmail(lastEmail);
                                        setComposeSubject(lastEmail.subject?.startsWith('Re:') ? lastEmail.subject : `Re: ${lastEmail.subject}`);
                                        clearContactComposeBody();
                                        setComposeAttachments([]);
                                        setShowContactCompose(true);
                                      }}
                                      style={{ background: '#c9922c', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                                      ↩ Reply
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {/* Team Contact Toggle — owner or admin only */}
                {(isAdmin || c.agent_id === profile!.id) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: c.is_shared ? '#f5f3ff' : '#f9fafb', borderRadius: 8, border: `1px solid ${c.is_shared ? '#ddd6fe' : '#e5e7eb'}` }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>🏢 Team Contact</div>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Visible to all agents on the team — for shared brokers, landlords, and industry contacts.</div>
                    </div>
                    <button
                      onClick={async () => {
                        const newVal = !c.is_shared;
                        await supabase.from('crm_clients').update({ is_shared: newVal }).eq('id', c.id);
                        setClients(prev => prev.map(x => x.id === c.id ? { ...x, is_shared: newVal } : x));
                        setActiveClient(prev => prev && prev.id === c.id ? { ...prev, is_shared: newVal } : prev);
                      }}
                      style={{ position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', background: c.is_shared ? '#7c3aed' : '#d1d5db', cursor: 'pointer', transition: 'background .2s', flexShrink: 0, padding: 0 }}
                    >
                      <span style={{ position: 'absolute', top: 3, left: c.is_shared ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                    </button>
                  </div>
                )}

                {/* Meta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 4, borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#9ca3af', flexWrap: 'wrap' }}>
                  <span>📅 Added {c.created_at?.slice(0, 10)}</span>
                  <span>👤 Owner: {ownerName}</span>
                  {c.lead_source && (
                    <span>📌 <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '1px 7px', borderRadius: 8, fontWeight: 600, fontSize: 11 }}>{c.lead_source}</span></span>
                  )}
                  {c.last_touched_at ? (
                    <span>🤝 Last touch: <strong style={{ color: (() => { const d = Math.floor((Date.now() - new Date(c.last_touched_at).getTime()) / 86400000); return d >= 90 ? '#dc2626' : d >= 30 ? '#c2410c' : '#16a34a'; })() }}>{Math.floor((Date.now() - new Date(c.last_touched_at).getTime()) / 86400000)}d ago</strong></span>
                  ) : (
                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>🤝 Never contacted</span>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {/* Review Request — only show if client has email and hasn't unsubscribed */}
                  {c.email && !c.unsubscribed_at && (
                    <button
                      onClick={async () => {
                        const confirmed = confirm(`Send a Google review request email to ${c.first_name}?`);
                        if (!confirmed) return;
                        const res = await fetch('/api/crm/review-request', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ clientId: c.id }),
                        });
                        const data = await res.json();
                        if (!res.ok) {
                          alert(data.error ?? 'Failed to send review request');
                        } else {
                          // Update local state so the timestamp shows immediately
                          const now = new Date().toISOString();
                          setClients(prev => prev.map(cl => cl.id === c.id ? { ...cl, review_requested_at: now, tags: cl.tags.includes('Review Requested') ? cl.tags : [...cl.tags, 'Review Requested'] } : cl));
                          setActiveClient(prev => prev && prev.id === c.id ? { ...prev, review_requested_at: now, tags: prev.tags.includes('Review Requested') ? prev.tags : [...prev.tags, 'Review Requested'] } : prev);
                          alert(`✅ Review request sent to ${c.first_name}!`);
                        }
                      }}
                      title={c.review_requested_at ? `Last sent ${new Date(c.review_requested_at).toLocaleDateString()}` : 'Send Google review request email'}
                      style={{ padding: '7px 14px', fontSize: 13, background: c.review_requested_at ? '#f0fdf4' : '#fffbeb', color: c.review_requested_at ? '#15803d' : '#92400e', border: `1px solid ${c.review_requested_at ? '#bbf7d0' : '#fde68a'}`, borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>
                      {c.review_requested_at ? `⭐ Sent ${new Date(c.review_requested_at).toLocaleDateString()}` : '⭐ Request Review'}
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => { setActiveClient(null); deleteClient(c.id, `${c.first_name} ${c.last_name}`); }}
                      style={{ padding: '7px 16px', fontSize: 13, background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                      🗑 Remove
                    </button>
                  )}
                  {(isAdmin || c.agent_id === profile!.id) && (
                    <button onClick={() => openEditClient(c)}
                      style={{ padding: '7px 16px', fontSize: 13, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>
                      ✏️ Edit
                    </button>
                  )}
                  <button onClick={() => setActiveClient(null)}
                    style={{ padding: '7px 20px', fontSize: 13, background: '#111', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>
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
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>{editClient.first_name} {editClient.last_name}</div>
              </div>
              <button onClick={() => setEditClient(null)} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            {/* Scrollable body */}
            <div style={{ padding: '24px 28px', overflowY: 'auto', maxHeight: 'calc(90vh - 130px)' }}>

              {/* ── Contact Type ── */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, marginBottom: 10 }}>Contact Type *</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                  {CLIENT_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setEc({ ...ec, type: t })}
                      style={{
                        padding: '10px 4px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600,
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
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Identity</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>First Name *</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.first_name} onChange={e => setEc({ ...ec, first_name: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Last Name</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.last_name} onChange={e => setEc({ ...ec, last_name: e.target.value })} />
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>
                      {ec.type === 'Agent' || ec.type === 'Broker' ? 'Business / Brokerage Name' : 'Business Name'} <span style={{ color: '#d1d5db', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <input className="crm-input" style={{ marginTop: 4 }} placeholder={ec.type === 'Agent' || ec.type === 'Broker' ? 'Century 21, Keller Williams…' : 'Company or business name'} value={ec.business_name} onChange={e => setEc({ ...ec, business_name: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* ── Contact Info ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Contact Info</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                  {/* ── Email(s) ── */}
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>
                        Email{ec.extra_emails.length > 0 ? 's' : ''}
                        {ec.extra_emails.length > 0 && (
                          <span style={{ marginLeft: 6, background: '#fef3e2', color: '#92400e', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 600 }}>
                            {1 + ec.extra_emails.length} addresses
                          </span>
                        )}
                      </label>
                      <button
                        type="button"
                        onClick={() => setEc({ ...ec, extra_emails: [...ec.extra_emails, ''] })}
                        style={{ background: 'none', border: 'none', color: '#c9922c', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4 }}
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
                        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#16a34a', fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', pointerEvents: 'none' }}>Primary</span>
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
                          aria-label="Remove this email"
                          style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, color: '#ef4444', fontSize: 14, cursor: 'pointer', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                        >✕</button>
                      </div>
                    ))}
                  </div>

                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Phone</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.phone} onChange={e => setEc({ ...ec, phone: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Cell Phone</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.cell_phone} onChange={e => setEc({ ...ec, cell_phone: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* ── Property Preferences (non-Agent/Broker) ── */}
              {(ec.type !== 'Agent' && ec.type !== 'Broker') && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Property Preferences</div>
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                  </div>
                  <div style={{ marginBottom: 12, position: 'relative' }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500, display: 'block', marginBottom: 4 }}>Asset Type(s)</label>
                    <button type="button"
                      onClick={e => { e.stopPropagation(); setAssetDropdownOpen(assetDropdownOpen === 'ec' ? null : 'ec'); }}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: ec.asset_types.length ? '#111' : '#9ca3af' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ec.asset_types.length === 0 ? 'Select asset type(s)…' : ec.asset_types.join(', ')}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{assetDropdownOpen === 'ec' ? '▲' : '▼'}</span>
                    </button>
                    {assetDropdownOpen === 'ec' && (
                      <div onClick={e => e.stopPropagation()}
                        style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '6px 0', marginTop: 4 }}>
                        <div style={{ padding: '4px 12px 6px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>Select all that apply</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: '0 6px 6px' }}>
                          {ASSET_TYPES.map(at => {
                            const checked = ec.asset_types.includes(at);
                            return (
                              <label key={at} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? '#fef3e2' : 'transparent', transition: 'background .1s' }}>
                                <input type="checkbox" checked={checked} onChange={() => {
                                  const next = checked ? ec.asset_types.filter(x => x !== at) : [...ec.asset_types, at];
                                  setEc({ ...ec, asset_types: next });
                                }} style={{ accentColor: '#c9922c', width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }} />
                                <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? '#92400e' : '#374151' }}>{at}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '6px 12px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#9ca3af' }}>{ec.asset_types.length} selected</span>
                          <button onClick={() => setAssetDropdownOpen(null)} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Done</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Budget / Price Range</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="$400k – $500k" value={ec.budget} onChange={e => setEc({ ...ec, budget: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Size Range (Sq Ft)</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="1,500 – 2,500 sqft" value={ec.size_range} onChange={e => setEc({ ...ec, size_range: e.target.value })} />
                    </div>
                  </div>
                  {/* LXP — all types */}
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>🗓 LXP — Lease Expiration Date</label>
                    <input type="date" className="crm-input" style={{ marginTop: 4 }} value={ec.lease_expiration_date} onChange={e => setEc({ ...ec, lease_expiration_date: e.target.value })} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>Contact me:</span>
                      {[90, 120, 180, 360].map(d => (
                        <button key={d} type="button"
                          onClick={() => setEc(f => ({ ...f, lxp_follow_up_days: f.lxp_follow_up_days === d ? null : d }))}
                          style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', fontFamily: "'DM Sans',sans-serif", transition: 'all .12s', borderColor: ec.lxp_follow_up_days === d ? '#c9922c' : '#e5e7eb', background: ec.lxp_follow_up_days === d ? '#fef3e2' : '#f9fafb', color: ec.lxp_follow_up_days === d ? '#92400e' : '#6b7280' }}>
                          {d}d out
                        </button>
                      ))}
                      {ec.lxp_follow_up_days && ec.lease_expiration_date && (
                        <span style={{ fontSize: 12, color: '#c9922c', fontWeight: 600, marginLeft: 4 }}>
                          → {new Date(new Date(ec.lease_expiration_date).getTime() - ec.lxp_follow_up_days * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Birthday */}
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>🎂 Birthday <span style={{ color: '#d1d5db', fontWeight: 400 }}>(optional)</span></label>
                    <input type="date" className="crm-input" style={{ marginTop: 4 }} value={ec.birthday} onChange={e => setEc({ ...ec, birthday: e.target.value })} />
                  </div>
                </div>
              )}

              {/* ── Professional (Agent/Broker) ── */}
              {(ec.type === 'Agent' || ec.type === 'Broker') && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Professional</div>
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Brokerage</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="Century 21, KW…" value={ec.brokerage} onChange={e => setEc({ ...ec, brokerage: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>License #</label>
                      <input className="crm-input" style={{ marginTop: 4 }} placeholder="TX-0000000" value={ec.license} onChange={e => setEc({ ...ec, license: e.target.value })} />
                    </div>
                  </div>
                  {/* Asset Type — supports multiple */}
                  <div style={{ position: 'relative' }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500, display: 'block', marginBottom: 4 }}>Asset Type</label>
                    <button type="button"
                      onClick={e => { e.stopPropagation(); setAssetDropdownOpen(assetDropdownOpen === 'ec' ? null : 'ec'); }}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: ec.asset_types.length ? '#111' : '#9ca3af' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ec.asset_types.length === 0 ? 'Office, Industrial, Retail…' : ec.asset_types.join(', ')}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{assetDropdownOpen === 'ec' ? '▲' : '▼'}</span>
                    </button>
                    {assetDropdownOpen === 'ec' && (
                      <div onClick={e => e.stopPropagation()}
                        style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '6px 0', marginTop: 4 }}>
                        <div style={{ padding: '4px 12px 6px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 500, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>Select all that apply</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: '0 6px 6px' }}>
                          {ASSET_TYPES.map(at => {
                            const checked = ec.asset_types.includes(at);
                            return (
                              <label key={at} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? '#e0f2fe' : 'transparent', transition: 'background .1s' }}>
                                <input type="checkbox" checked={checked} onChange={() => {
                                  const next = checked ? ec.asset_types.filter(x => x !== at) : [...ec.asset_types, at];
                                  setEc({ ...ec, asset_types: next });
                                }} style={{ accentColor: '#0369a1', width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }} />
                                <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? '#075985' : '#374151' }}>{at}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '6px 12px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#9ca3af' }}>{ec.asset_types.length} selected</span>
                          <button onClick={() => setAssetDropdownOpen(null)} style={{ background: 'none', border: 'none', fontSize: 12, color: '#c9922c', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Done</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Location ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Location</div>
                  <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>Street Address</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.address} onChange={e => setEc({ ...ec, address: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>City</label>
                    <input className="crm-input" style={{ marginTop: 4 }} value={ec.city} onChange={e => setEc({ ...ec, city: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>State</label>
                      <input className="crm-input" style={{ marginTop: 4 }} value={ec.state} onChange={e => setEc({ ...ec, state: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 }}>ZIP</label>
                      <input className="crm-input" style={{ marginTop: 4 }} value={ec.zip} onChange={e => setEc({ ...ec, zip: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Lead Source & Tags ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Lead Source</label>
                  <select className="crm-input" style={{ marginTop: 4 }} value={ec.lead_source} onChange={e => setEc({ ...ec, lead_source: e.target.value })}>
                    <option value="">Select source…</option>
                    {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Tags</label>
                  <div style={{ marginTop: 4, border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px', minHeight: 38, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', background: '#fff', cursor: 'text' }}
                    onClick={() => document.getElementById('ec-tag-input')?.focus()}>
                    {ec.tags.map(tag => (
                      <span key={tag} style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 8, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                        {tag}<button onClick={() => setEc({ ...ec, tags: ec.tags.filter(t => t !== tag) })} aria-label={`Remove tag ${tag}`} title="Remove tag" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', fontSize: 11, padding: 0, lineHeight: 1 }}>✕</button>
                      </span>
                    ))}
                    <input id="ec-tag-input" placeholder={ec.tags.length === 0 ? 'Add tags…' : ''} value={tagInput} onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) { e.preventDefault(); const tag = tagInput.trim().replace(/,$/, ''); if (!ec.tags.includes(tag)) setEc({ ...ec, tags: [...ec.tags, tag] }); setTagInput(''); } if (e.key === 'Backspace' && !tagInput && ec.tags.length) setEc({ ...ec, tags: ec.tags.slice(0, -1) }); }}
                      style={{ border: 'none', outline: 'none', fontSize: 13, fontFamily: "'DM Sans',sans-serif", minWidth: 80, flex: 1 }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Press Enter or comma to add</div>
                </div>
              </div>

              {/* ── Notes ── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>Notes</div>
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

      {/* ── Email Preview Modal ── */}
      {showEmailPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setShowEmailPreview(false)}>
          <div style={{ background: '#f9fafb', borderRadius: 12, width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ background: '#111', color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, borderRadius: '12px 12px 0 0' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 2, letterSpacing: 1, textTransform: 'uppercase' }}>Email Preview</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {newCampaign.email_subject
                    .replace('{{first_name}}', 'Jane').replace('{{full_name}}', 'Jane Smith').replace('{{last_name}}', 'Smith')
                    .replace('{{agent_name}}', `${profile?.first_name} ${profile?.last_name}`) || '(no subject)'}
                </div>
              </div>
              <button
                onClick={sendCampaignTestEmail}
                disabled={sendingTestEmail}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: sendingTestEmail ? 'rgba(201,146,44,.4)' : 'rgba(201,146,44,.15)', border: '1px solid rgba(201,146,44,.5)', color: '#c9a84c', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: sendingTestEmail ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif", marginRight: 8, whiteSpace: 'nowrap' }}>
                {sendingTestEmail ? '⏳ Sending…' : '📧 Send Test to Me'}
              </button>
              <button onClick={() => setShowEmailPreview(false)} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            {/* Email meta bar */}
            <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '10px 20px', fontSize: 13, color: '#6b7280', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span><strong>To:</strong> Jane Smith &lt;jane@example.com&gt;</span>
              <span><strong>From:</strong> Fair Oaks Realty Group &lt;noreply@fairoaksrealtygroup.com&gt;</span>
              <span style={{ marginLeft: 'auto', color: '#9ca3af', fontStyle: 'italic' }}>Test sends to: {profile?.email ?? session?.user?.email}</span>
            </div>
            <div style={{ fontSize: 11, background: '#fef3c7', borderBottom: '1px solid #fde68a', padding: '6px 20px', color: '#92400e', fontWeight: 500 }}>
              ✦ Merge fields replaced with sample data for preview — actual emails use each contact&apos;s real info
            </div>
            {/* Rendered body */}
            <div style={{ flex: 1, overflowY: 'auto', background: '#fff', padding: 24 }}
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(newCampaign.email_body
                  .replace(/\{\{first_name\}\}/g, 'Jane').replace(/\{\{last_name\}\}/g, 'Smith')
                  .replace(/\{\{full_name\}\}/g, 'Jane Smith').replace(/\{\{email\}\}/g, 'jane@example.com')
                  .replace(/\{\{client_type\}\}/g, 'Buyer')
                  .replace(/\{\{agent_name\}\}/g, `${profile?.first_name ?? 'Your'} ${profile?.last_name ?? 'Agent'}`)
                  .replace(/\{\{agent_email\}\}/g, profile?.email ?? 'agent@fairoaksrealtygroup.com')
                  .replace(/\{\{agent_phone\}\}/g, profile?.phone ?? '210-390-9997')
                  .replace(/\{\{brokerage\}\}/g, 'Fair Oaks Realty Group')
                  .replace(/\{\{unsubscribe_url\}\}/g, '#unsubscribe-preview'))
              }}
            />
          </div>
        </div>
      )}

      {/* ── Bulk Reassign Modal ── */}
      {showBulkReassign && isAdmin && (
        <div className="overlay" onClick={() => setShowBulkReassign(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', background: '#111', color: '#fff', borderRadius: '12px 12px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Reassign Contacts</h3>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{selectedClientIds.size} contact{selectedClientIds.size !== 1 ? 's' : ''} selected</div>
              </div>
              <button onClick={() => setShowBulkReassign(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 8 }}>Assign to Agent</label>
                <select className="crm-input" value={bulkReassignTarget} onChange={e => setBulkReassignTarget(e.target.value)}>
                  <option value="">Select an agent…</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name} ({p.role})</option>)}
                </select>
              </div>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e' }}>
                ⚠️ This will update the <strong>Owner</strong> field on {selectedClientIds.size} contact{selectedClientIds.size !== 1 ? 's' : ''}. The contacts will remain visible to their original team.
              </div>
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button className="crm-btn crm-btn-ghost" style={{ flex: 1 }} onClick={() => setShowBulkReassign(false)}>Cancel</button>
                <button
                  className="crm-btn crm-btn-gold"
                  style={{ flex: 2 }}
                  disabled={!bulkReassignTarget || bulkReassigning}
                  onClick={async () => {
                    if (!bulkReassignTarget) return;
                    setBulkReassigning(true);
                    const ids = Array.from(selectedClientIds);
                    await supabase.from('crm_clients').update({ agent_id: bulkReassignTarget }).in('id', ids);
                    setClients(prev => prev.map(c => selectedClientIds.has(c.id) ? { ...c, agent_id: bulkReassignTarget } : c));
                    const agent = profiles.find(p => p.id === bulkReassignTarget);
                    showToast(`✓ ${ids.length} contact${ids.length !== 1 ? 's' : ''} reassigned to ${agent?.first_name ?? 'agent'}`);
                    setSelectedClientIds(new Set());
                    setShowBulkReassign(false);
                    setBulkReassigning(false);
                  }}>
                  {bulkReassigning ? 'Reassigning…' : `Reassign ${selectedClientIds.size} Contact${selectedClientIds.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Global Search (⌘K) ── */}
      {showSearch && (() => {
        const q = searchQuery.toLowerCase().trim();
        const contactResults = q.length >= 1 ? clients.filter(c =>
          `${c.first_name} ${c.last_name} ${c.email} ${c.phone} ${c.business_name}`.toLowerCase().includes(q)
        ).slice(0, 5) : [];
        const dealResults = q.length >= 1 ? deals.filter(d =>
          `${d.client} ${d.property} ${d.type}`.toLowerCase().includes(q)
        ).slice(0, 4) : [];
        const campaignResults = q.length >= 1 ? campaigns.filter(c =>
          `${c.name} ${c.description}`.toLowerCase().includes(q)
        ).slice(0, 3) : [];
        const hasResults = contactResults.length + dealResults.length + campaignResults.length > 0;
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80 }}
            onClick={() => { setShowSearch(false); setSearchQuery(''); }}>
            <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 580, margin: '0 16px', boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden' }}
              onClick={e => e.stopPropagation()}>
              {/* Search input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #f0f0f0' }}>
                <span style={{ fontSize: 18, color: '#9ca3af' }}>🔍</span>
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search contacts, deals, campaigns…"
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, fontFamily: "'DM Sans',sans-serif", color: '#111', background: 'transparent' }}
                />
                <kbd style={{ fontSize: 11, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, padding: '2px 6px', color: '#6b7280', fontFamily: 'monospace' }}>ESC</kbd>
              </div>
              {/* Results */}
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {!q && (
                  <div style={{ padding: '20px 18px', color: '#9ca3af', fontSize: 14, textAlign: 'center' }}>
                    Start typing to search contacts, deals, and campaigns
                  </div>
                )}
                {q && !hasResults && (
                  <div style={{ padding: '20px 18px', color: '#9ca3af', fontSize: 14, textAlign: 'center' }}>No results for &quot;{searchQuery}&quot;</div>
                )}
                {contactResults.length > 0 && (
                  <div>
                    <div style={{ padding: '8px 18px 4px', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Contacts</div>
                    {contactResults.map(c => (
                      <button key={c.id} onClick={() => { setPage('contacts'); setActiveClient(c); setShowSearch(false); setSearchQuery(''); }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#111', color: '#c9922c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                          {(c.first_name[0] ?? '') + (c.last_name[0] ?? '')}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{c.first_name} {c.last_name}</div>
                          <div style={{ fontSize: 13, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || c.phone || c.type}</div>
                        </div>
                        <span style={{ ...Object.fromEntries((CLIENT_TYPE_COLORS[c.type] || '').split(';').map(s => s.split(':'))), fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 600, flexShrink: 0 } as React.CSSProperties}>{c.type}</span>
                      </button>
                    ))}
                  </div>
                )}
                {dealResults.length > 0 && (
                  <div>
                    <div style={{ padding: '8px 18px 4px', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Deals</div>
                    {dealResults.map(d => (
                      <button key={d.id} onClick={() => { setPage('deals'); setFilter(''); openDeal(d); setShowSearch(false); setSearchQuery(''); }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        <span style={{ fontSize: 20 }}>{d.type.startsWith('Buyer') ? '🏡' : d.type.startsWith('Tenant') ? '🔑' : d.type.startsWith('Seller') ? '🪧' : '🏢'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{d.client}</div>
                          <div style={{ fontSize: 13, color: '#9ca3af' }}>{d.property || d.type} · {d.stage}</div>
                        </div>
                        {d.value > 0 && <div style={{ fontSize: 13, color: '#6b7280', flexShrink: 0 }}>${d.value.toLocaleString()}</div>}
                      </button>
                    ))}
                  </div>
                )}
                {campaignResults.length > 0 && (
                  <div>
                    <div style={{ padding: '8px 18px 4px', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 600 }}>Campaigns</div>
                    {campaignResults.map(c => (
                      <button key={c.id} onClick={() => { setPage('campaigns'); setActiveCampaign(c); setCampaignView('detail'); setCampaignTab('enrolled'); loadCampaignEnrollments(c.id); loadCampaignSends(c.id); setShowSearch(false); setSearchQuery(''); }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        <span style={{ fontSize: 20 }}>📣</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{c.name}</div>
                          <div style={{ fontSize: 13, color: '#9ca3af' }}>{c.type.toUpperCase()} · {c.frequency}</div>
                        </div>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 700, background: c.status === 'active' ? '#dcfce7' : c.status === 'completed' ? '#dbeafe' : '#f3f4f6', color: c.status === 'active' ? '#166534' : c.status === 'completed' ? '#1e40af' : '#6b7280' }}>{c.status}</span>
                      </button>
                    ))}
                  </div>
                )}
                {hasResults && (
                  <div style={{ padding: '8px 18px', borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <kbd style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace', fontSize: 11 }}>↵</kbd> to open &nbsp;·&nbsp; <kbd style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace', fontSize: 11 }}>ESC</kbd> to close
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Closed Deal Enrollment Prompt ── */}
      {closedDealPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setClosedDealPrompt(null)}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ background: '#16a34a', padding: '20px 24px', color: '#fff' }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>🎉</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Deal Closed!</div>
              <div style={{ fontSize: 14, opacity: 0.85, marginTop: 2 }}>
                Enroll <strong>{closedDealPrompt.client}</strong> in a follow-up campaign or action plan?
              </div>
            </div>

            <div style={{ padding: '20px 24px', maxHeight: 400, overflowY: 'auto' }}>
              {/* Action Plans */}
              {actionPlans.filter(p => p.status === 'active').length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', marginBottom: 10 }}>⚡ Action Plans</div>
                  {actionPlans.filter(p => p.status === 'active').map(plan => (
                    <label key={plan.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}>
                      <input
                        type="checkbox"
                        checked={closedEnrollPlanIds.includes(plan.id)}
                        onChange={e => setClosedEnrollPlanIds(prev =>
                          e.target.checked ? [...prev, plan.id] : prev.filter(id => id !== plan.id)
                        )}
                        style={{ marginTop: 2, accentColor: '#16a34a', width: 15, height: 15, flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{plan.name}</div>
                        {plan.description && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 1 }}>{plan.description}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Campaigns */}
              {campaigns.filter(c => c.status === 'active').length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', marginBottom: 10 }}>📣 Campaigns</div>
                  {campaigns.filter(c => c.status === 'active').map(camp => (
                    <label key={camp.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}>
                      <input
                        type="checkbox"
                        checked={closedEnrollCampaignIds.includes(camp.id)}
                        onChange={e => setClosedEnrollCampaignIds(prev =>
                          e.target.checked ? [...prev, camp.id] : prev.filter(id => id !== camp.id)
                        )}
                        style={{ marginTop: 2, accentColor: '#16a34a', width: 15, height: 15, flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{camp.name}</div>
                        {camp.description && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 1 }}>{camp.description}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {actionPlans.filter(p => p.status === 'active').length === 0 && campaigns.filter(c => c.status === 'active').length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af', fontSize: 14 }}>
                  No active campaigns or action plans found.<br />
                  <span style={{ fontSize: 13 }}>Create one in the Campaigns or Action Plans tab.</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 10, justifyContent: 'flex-end', background: '#f9fafb' }}>
              <button
                onClick={() => setClosedDealPrompt(null)}
                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 14, cursor: 'pointer', color: '#374151', fontWeight: 500 }}>
                Skip
              </button>
              <button
                onClick={handleClosedEnroll}
                disabled={closedEnrolling || (closedEnrollPlanIds.length === 0 && closedEnrollCampaignIds.length === 0)}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: (closedEnrollPlanIds.length + closedEnrollCampaignIds.length > 0) ? '#16a34a' : '#d1d5db', color: '#fff', fontSize: 14, fontWeight: 600, cursor: (closedEnrolling || (closedEnrollPlanIds.length === 0 && closedEnrollCampaignIds.length === 0)) ? 'not-allowed' : 'pointer' }}>
                {closedEnrolling ? 'Enrolling…' : `Enroll${(closedEnrollPlanIds.length + closedEnrollCampaignIds.length) > 0 ? ` (${closedEnrollPlanIds.length + closedEnrollCampaignIds.length} selected)` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lost Deal Reason Prompt ── */}
      {lostDealPrompt && (() => {
        const LOST_REASONS = [
          'Price / budget',
          'Went with another agent',
          'Property fell through',
          'Client changed their mind',
          'Timeline didn\'t work',
          'Lost contact',
          'Financing fell through',
          'Other',
        ];
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            onClick={() => setLostDealPrompt(null)}>
            <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 400, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}
              onClick={e => e.stopPropagation()}>
              {/* Header — fixed */}
              <div style={{ background: '#dc2626', padding: '12px 18px', color: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>📋</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>Why did we lose this deal?</div>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>{lostDealPrompt.client}</div>
                </div>
              </div>

              {/* Scrollable reasons */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {LOST_REASONS.map(reason => (
                    <label key={reason} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px', borderRadius: 7, border: `1.5px solid ${lostReason === reason ? '#dc2626' : '#e5e7eb'}`, background: lostReason === reason ? '#fef2f2' : '#fff', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="lostReason"
                        value={reason}
                        checked={lostReason === reason}
                        onChange={() => setLostReason(reason)}
                        style={{ accentColor: '#dc2626', width: 14, height: 14, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 14, fontWeight: lostReason === reason ? 600 : 400, color: lostReason === reason ? '#dc2626' : '#374151' }}>{reason}</span>
                    </label>
                  ))}
                </div>
                {lostReason === 'Other' && (
                  <textarea
                    placeholder="Describe why the deal was lost…"
                    value={lostReasonOther}
                    onChange={e => setLostReasonOther(e.target.value)}
                    rows={2}
                    style={{ marginTop: 8, width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 14, resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  />
                )}
              </div>

              {/* Footer — pinned */}
              <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', background: '#f9fafb', flexShrink: 0 }}>
                <button
                  onClick={handleLostSave}
                  disabled={lostSaving || !lostReason || (lostReason === 'Other' && !lostReasonOther.trim())}
                  style={{ padding: '8px 22px', borderRadius: 7, border: 'none', background: (lostReason && (lostReason !== 'Other' || lostReasonOther.trim())) ? '#dc2626' : '#d1d5db', color: '#fff', fontSize: 14, fontWeight: 600, cursor: (lostSaving || !lostReason || (lostReason === 'Other' && !lostReasonOther.trim())) ? 'not-allowed' : 'pointer' }}>
                  {lostSaving ? 'Saving…' : 'Save Reason'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Task Modal */}
      {showTaskModal && taskClientId && (() => {
        const client = clients.find(c => c.id === taskClientId);
        return (
          <div className="overlay" onClick={() => setShowTaskModal(false)}>
            <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '20px 24px', background: '#111', color: '#fff', borderRadius: '12px 12px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Add Task</h3>
                  {client && <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{client.first_name} {client.last_name}</div>}
                </div>
                <button onClick={() => setShowTaskModal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Task type */}
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, marginBottom: 8 }}>Task Type</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {(['follow_up', 'call', 'email'] as const).map(t => (
                      <button key={t} type="button" onClick={() => setTaskForm(f => ({ ...f, type: t }))}
                        style={{ padding: '10px 8px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '2px solid', textAlign: 'center', transition: 'all .12s', fontFamily: "'DM Sans',sans-serif", borderColor: taskForm.type === t ? '#c9922c' : '#e5e7eb', background: taskForm.type === t ? '#fef3e2' : '#f9fafb', color: taskForm.type === t ? '#92400e' : '#6b7280' }}>
                        <div style={{ fontSize: 18, marginBottom: 4 }}>{t === 'follow_up' ? '📋' : t === 'call' ? '📞' : '✉️'}</div>
                        {t === 'follow_up' ? 'Follow Up' : t === 'call' ? 'Call' : 'Email'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 6 }}>Title *</label>
                  <input className="crm-input" style={{ marginTop: 0 }}
                    placeholder={taskForm.type === 'follow_up' ? 'Check in on search criteria…' : taskForm.type === 'call' ? 'Call to discuss offer…' : 'Send listing options…'}
                    value={taskForm.title}
                    onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
                    autoFocus
                  />
                </div>

                {/* Due Date */}
                <div>
                  <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 6 }}>Due Date *</label>
                  <input type="date" className="crm-input" style={{ marginTop: 0 }}
                    value={taskForm.due_date}
                    onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))}
                  />
                </div>

                {/* Notes */}
                <div>
                  <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 6 }}>Notes <span style={{ color: '#d1d5db', fontWeight: 400 }}>(optional)</span></label>
                  <textarea className="crm-input" style={{ marginTop: 0, minHeight: 64, resize: 'none', fontSize: 13 }}
                    placeholder="Any additional context…"
                    value={taskForm.notes}
                    onChange={e => setTaskForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                  <button className="crm-btn crm-btn-ghost" style={{ flex: 1 }} onClick={() => setShowTaskModal(false)}>Cancel</button>
                  <button className="crm-btn crm-btn-gold" style={{ flex: 2 }}
                    disabled={!taskForm.title.trim() || !taskForm.due_date}
                    onClick={saveTask}>
                    Save Task
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bulk Enroll in Campaign Modal */}
      {showBulkEnrollModal && (
        <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setShowBulkEnrollModal(false); }}>
          <div className="modal" style={{ padding: 28, maxWidth: 480 }}>
            <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Enroll in Campaign</h3>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>
              Enroll <strong>{selectedClientIds.size} contact{selectedClientIds.size !== 1 ? 's' : ''}</strong> into a campaign.
            </p>
            <div>
              <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 6 }}>Select Campaign</label>
              <select className="crm-input" value={bulkEnrollCampaignId} onChange={e => setBulkEnrollCampaignId(e.target.value)}>
                <option value="">— Choose a campaign —</option>
                {campaigns.filter(c => c.status !== 'completed').map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.frequency})</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="crm-btn crm-btn-ghost" style={{ flex: 1 }} onClick={() => setShowBulkEnrollModal(false)}>Cancel</button>
              <button className="crm-btn crm-btn-gold" style={{ flex: 2 }} disabled={!bulkEnrollCampaignId || bulkEnrolling} onClick={bulkEnrollInCampaign}>
                {bulkEnrolling ? 'Enrolling…' : 'Enroll Contacts'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 26, right: 26, background: '#111', color: '#fff', padding: '12px 20px', borderRadius: 8, fontSize: 14, zIndex: 9999, borderLeft: '4px solid #c9922c', maxWidth: 300, boxShadow: '0 4px 20px rgba(0,0,0,.3)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
