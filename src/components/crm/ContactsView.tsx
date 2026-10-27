'use client';

import React, { useEffect, useMemo, useState } from 'react';

/**
 * The Contacts page: a search box, one-tap filter chips and a clean table of rows.
 *
 * Everything is filtered in the browser (the CRM already holds every contact), so counts are exact and
 * typing in the search box is instant. Chip counts are "faceted" — they respect the other filters, so a
 * chip tells you how many you'd get if you tapped it. Rows open the contact card; the small buttons on a
 * row call, email or add a task without opening it. The bulk-action bar, saved lists and "save as list"
 * controls are owned by the CRM and handed in, so their behaviour is unchanged.
 */
export interface ContactRow {
  id: string;
  first_name?: string | null; last_name?: string | null; business_name?: string | null;
  email?: string | null; phone?: string | null; cell_phone?: string | null;
  type: string; agent_id?: string | null;
  tags?: string[] | null; lead_source?: string | null; asset_types?: string[] | null;
  last_touched_at?: string | null; created_at: string;
  is_shared?: boolean; lead_hold?: boolean | null;
}
export type ContactSort = 'recent' | 'never' | 'az' | 'za' | 'added' | 'type' | 'owner';
interface DealLite { id: string; stage: string }
interface Enroll { campaign_name?: string; active?: boolean }
interface Person { id: string; first_name?: string | null; last_name?: string | null }

export interface ContactsViewProps {
  clients: ContactRow[];
  isMobile: boolean; isAdmin: boolean; isSuperAdmin: boolean;
  search: string; setSearch: (v: string) => void;
  type: string; setType: (v: string) => void;
  source: string; setSource: (v: string) => void;
  spec: string; setSpec: (v: string) => void;
  owner: string; setOwner: (v: string) => void;
  tag: string; setTag: (v: string) => void;
  needsTouchOnly: boolean; setNeedsTouchOnly: (v: boolean) => void; needsTouchIds: ReadonlySet<string>;
  noInfoOnly: boolean; setNoInfoOnly: (v: boolean) => void;
  heldOnly: boolean; setHeldOnly: (v: boolean) => void;
  campaignOnly: boolean; setCampaignOnly: (v: boolean) => void;
  dealOnly: boolean; setDealOnly: (v: boolean) => void;
  sort: ContactSort; setSort: (v: ContactSort) => void;
  dealsByClient: Map<string, DealLite[]>;
  enrollmentsByClient: Record<string, Enroll[] | undefined>;
  pendingTasksByClient: Map<string, number>;
  profiles: Person[];
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  onOpen: (c: ContactRow) => void;
  onAddTask: (c: ContactRow) => void;
  onOpenDeal: (dealId: string) => void;
  onChangeType: (c: ContactRow, t: string) => void;
  timeAgo: (d?: string | null) => { label: string; color: string; bg: string };
  phoneDisp: (v?: string | null) => string;
  typeColors: Record<string, string>;
  avatarColors: Record<string, string>;
  types: readonly string[]; sources: readonly string[]; assetTypes: readonly string[];
  /** CRM-owned pieces, rendered in place: saved-list picker, "save as list" controls, bulk action bar. */
  savedLists?: React.ReactNode; saveListControls?: React.ReactNode; bulkBar?: React.ReactNode;
}

const WINDOW = 150;
const SEGMENTS: { label: string; type: string }[] = [
  { label: 'All', type: '' }, { label: 'Buyers', type: 'Buyer' }, { label: 'Sellers', type: 'Seller' },
  { label: 'Tenants', type: 'Tenant' }, { label: 'Landlords', type: 'Landlord/Investor' },
  { label: 'Agents', type: 'Agent' }, { label: 'Brokers', type: 'Broker' },
];

const nameOf = (c: ContactRow) => `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
const displayName = (c: ContactRow) => nameOf(c) || c.business_name || c.email || 'Unnamed contact';
const phoneOf = (c: ContactRow) => (c.cell_phone || c.phone || '').trim();

export default function ContactsView(p: ContactsViewProps) {
  const { isMobile, isAdmin } = p;
  const [limit, setLimit] = useState(WINDOW);
  const [panelOpen, setPanelOpen] = useState(false);
  const ownerFirst = useMemo(() => new Map(p.profiles.map(x => [x.id, x.first_name || ''])), [p.profiles]);

  const hasDeal = (id: string) => (p.dealsByClient.get(id) ?? []).some(d => ['Active', 'LOI', 'In Contract'].includes(d.stage));
  const inCampaign = (id: string) => (p.enrollmentsByClient[id]?.length ?? 0) > 0;

  // One predicate, so every count and the list itself can never disagree. `skip` leaves one filter out.
  const matches = (c: ContactRow, skip?: 'type') => {
    if (skip !== 'type' && p.type && c.type !== p.type) return false;
    if (p.source && c.lead_source !== p.source) return false;
    if (p.tag && !(c.tags ?? []).some(t => t.toLowerCase().includes(p.tag.toLowerCase()))) return false;
    if (p.spec && !(c.asset_types ?? []).includes(p.spec)) return false;
    if (p.owner && c.agent_id !== p.owner) return false;
    if (p.needsTouchOnly && !p.needsTouchIds.has(c.id)) return false;
    if (p.heldOnly && !c.lead_hold) return false;
    if (p.noInfoOnly && (c.email || c.phone || c.cell_phone)) return false;
    if (p.campaignOnly && !inCampaign(c.id)) return false;
    if (p.dealOnly && !hasDeal(c.id)) return false;
    const words = p.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const hay = [c.first_name, c.last_name, c.business_name, c.email, c.phone, c.cell_phone, ...(c.tags ?? [])].filter(Boolean).join(' ').toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  };

  const filtered = useMemo(() => {
    const rows = p.clients.filter(c => matches(c));
    const ts = (c: ContactRow) => new Date(c.last_touched_at ?? c.created_at).getTime();
    const key = (c: ContactRow) => `${c.last_name ?? ''}${c.first_name ?? ''}${c.business_name ?? ''}`.toLowerCase();
    return rows.sort((a, b) => {
      switch (p.sort) {
        case 'never': {
          if (!a.last_touched_at && !b.last_touched_at) return 0;
          if (!a.last_touched_at) return -1;
          if (!b.last_touched_at) return 1;
          return new Date(a.last_touched_at).getTime() - new Date(b.last_touched_at).getTime();
        }
        case 'az': return key(a).localeCompare(key(b));
        case 'za': return key(b).localeCompare(key(a));
        case 'type': return a.type.localeCompare(b.type) || key(a).localeCompare(key(b));
        case 'owner': return (ownerFirst.get(a.agent_id ?? '') || '~').localeCompare(ownerFirst.get(b.agent_id ?? '') || '~') || key(a).localeCompare(key(b));
        case 'added': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        default: return ts(b) - ts(a);   // 'recent': being added counts as activity
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.clients, p.search, p.type, p.source, p.tag, p.spec, p.owner, p.needsTouchOnly, p.needsTouchIds, p.heldOnly, p.noInfoOnly, p.campaignOnly, p.dealOnly, p.sort, p.dealsByClient, p.enrollmentsByClient, ownerFirst]);

  useEffect(() => { setLimit(WINDOW); }, [p.search, p.type, p.source, p.tag, p.spec, p.owner, p.needsTouchOnly, p.heldOnly, p.noInfoOnly, p.campaignOnly, p.dealOnly, p.sort]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>(); let all = 0;
    for (const c of p.clients) { if (!matches(c, 'type')) continue; all++; m.set(c.type, (m.get(c.type) ?? 0) + 1); }
    return { all, m };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.clients, p.search, p.source, p.tag, p.spec, p.owner, p.needsTouchOnly, p.needsTouchIds, p.heldOnly, p.noInfoOnly, p.campaignOnly, p.dealOnly, p.dealsByClient, p.enrollmentsByClient]);

  const counts = useMemo(() => ({
    touch: p.clients.filter(c => p.needsTouchIds.has(c.id)).length,
    noInfo: p.clients.filter(c => !c.email && !c.phone && !c.cell_phone).length,
    campaign: p.clients.filter(c => inCampaign(c.id)).length,
    deal: p.clients.filter(c => hasDeal(c.id)).length,
    held: p.clients.filter(c => c.lead_hold).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.clients, p.needsTouchIds, p.dealsByClient, p.enrollmentsByClient]);

  const panelCount = (p.source ? 1 : 0) + (p.spec ? 1 : 0) + (p.owner ? 1 : 0) + (p.tag ? 1 : 0);
  const activeCount = panelCount + (p.type ? 1 : 0) + (p.needsTouchOnly ? 1 : 0) + (p.noInfoOnly ? 1 : 0) + (p.heldOnly ? 1 : 0) + (p.campaignOnly ? 1 : 0) + (p.dealOnly ? 1 : 0) + (p.search.trim() ? 1 : 0);
  const clearAll = () => { p.setSearch(''); p.setType(''); p.setSource(''); p.setSpec(''); p.setOwner(''); p.setTag(''); p.setNeedsTouchOnly(false); p.setNoInfoOnly(false); p.setHeldOnly(false); p.setCampaignOnly(false); p.setDealOnly(false); };

  const chip = (on: boolean, dim = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, whiteSpace: 'nowrap', padding: '0 14px', minHeight: isMobile ? 44 : 34, borderRadius: 999,
    border: `1px solid ${on ? '#c9922c' : 'var(--k-e5e7eb)'}`, background: on ? '#c9922c' : 'var(--k-fff)', color: on ? '#fff' : 'var(--k-374151)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", opacity: dim && !on ? 0.45 : 1,
  });
  const n = (v: number, on: boolean) => <span style={{ fontSize: 11.5, fontWeight: 700, opacity: on ? 0.9 : 0.6 }}>{v.toLocaleString()}</span>;
  const rowScroll: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', ...(isMobile ? { overflowX: 'auto', flexWrap: 'nowrap', margin: '0 -10px', padding: '2px 10px 4px', scrollbarWidth: 'none' as const } : { flexWrap: 'wrap' }) };

  const typeStyle = (t: string): React.CSSProperties =>
    Object.fromEntries((p.typeColors[t] || 'background:var(--k-f3f4f6);color:var(--k-374151)').split(';').filter(Boolean).map(s => { const i = s.indexOf(':'); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; })) as React.CSSProperties;
  const avatar = (c: ContactRow, size: number) => {
    const nm = displayName(c);
    const pair = (p.avatarColors[(nm[0] ?? 'A').toUpperCase()] ?? '#c9922c,#a07020').split(',');
    const initials = nameOf(c) ? ((c.first_name?.[0] ?? '') + (c.last_name?.[0] ?? '')) : (nm[0] ?? '?').toUpperCase();
    return (
      <div aria-hidden style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.38), fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>{initials.toUpperCase()}</div>
    );
  };

  const toggleOne = (id: string, on: boolean) => { const next = new Set(p.selected); if (on) next.add(id); else next.delete(id); p.setSelected(next); };
  const allSelected = filtered.length > 0 && p.selected.size >= filtered.length && filtered.every(c => p.selected.has(c.id));

  const cols = `${isAdmin ? '28px ' : ''}minmax(190px,2fr) 108px minmax(140px,1.5fr) 124px ${isAdmin ? '78px ' : ''}84px 78px 100px`;
  const sortHeader = (label: string, a: ContactSort, b?: ContactSort) => {
    const on = p.sort === a || p.sort === b;
    return (
      <button onClick={() => p.setSort(p.sort === a && b ? b : a)} style={{ all: 'unset', cursor: 'pointer', color: on ? 'var(--k-b07d1f)' : 'var(--k-9ca3af)', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {label}<span style={{ opacity: on ? 1 : 0.3 }}>{on ? (p.sort === a ? ' ↓' : ' ↑') : ' ↕'}</span>
      </button>
    );
  };

  const actionBtn: React.CSSProperties = { width: isMobile ? 44 : 30, height: isMobile ? 44 : 30, flexShrink: 0, border: '1px solid var(--k-e5e7eb)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, textDecoration: 'none' };

  const rowActions = (c: ContactRow) => {
    const phone = phoneOf(c);
    const pending = p.pendingTasksByClient.get(c.id) ?? 0;
    return (
      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
        {phone ? <a href={`tel:${phone}`} title={`Call ${p.phoneDisp(phone)}`} aria-label="Call" style={actionBtn}>☎</a> : <span title="No phone on file" style={{ ...actionBtn, opacity: 0.35, cursor: 'default' }}>☎</span>}
        {c.email ? <a href={`mailto:${c.email}`} title={`Email ${c.email}`} aria-label="Email" style={actionBtn}>✉</a> : <span title="No email on file" style={{ ...actionBtn, opacity: 0.35, cursor: 'default' }}>✉</span>}
        <button onClick={() => p.onAddTask(c)} title={pending > 0 ? `${pending} open task${pending === 1 ? '' : 's'} — add another` : 'Add a task'} aria-label="Add a task"
          style={{ ...actionBtn, ...(pending > 0 ? { background: 'var(--k-fdf6e8)', borderColor: '#f0e2c4', color: '#a06a12', fontWeight: 700 } : {}) }}>{pending > 0 ? pending : '✓'}</button>
      </div>
    );
  };

  const typePill = (c: ContactRow) => (
    <div style={{ position: 'relative', display: 'inline-block' }} title="Change contact type" onClick={e => e.stopPropagation()}>
      <span style={{ ...typeStyle(c.type), display: 'inline-block', padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, pointerEvents: 'none', whiteSpace: 'nowrap' }}>{c.type}</span>
      <select aria-label={`Type for ${displayName(c)}`} value={c.type} onChange={e => p.onChangeType(c, e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}>
        {p.types.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );

  const badges = (c: ContactRow) => {
    const deals = (p.dealsByClient.get(c.id) ?? []).filter(d => ['Active', 'LOI', 'In Contract'].includes(d.stage));
    const enr = p.enrollmentsByClient[c.id] ?? [];
    return (
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
        {deals.length > 0 && <button onClick={() => p.onOpenDeal(deals[0].id)} title={`${deals.length} open deal${deals.length === 1 ? '' : 's'}`} style={{ fontSize: 11, fontWeight: 600, color: 'var(--k-1e40af)', background: 'var(--k-eff6ff)', border: '1px solid var(--k-dbeafe)', borderRadius: 7, padding: '1px 7px', cursor: 'pointer', fontFamily: 'inherit' }}>💼 {deals.length}</button>}
        {enr.length > 0 && <span title={enr.map(e => e.campaign_name).filter(Boolean).join(', ') || 'In a campaign'} style={{ fontSize: 11, color: 'var(--k-1e40af)', background: 'var(--k-f0f7ff)', borderRadius: 7, padding: '1px 7px' }}>📣 {enr.length}</span>}
      </div>
    );
  };

  const shown = filtered.slice(0, limit);

  return (
    <div>
      {/* Toolbar */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12, background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 12, padding: isMobile ? 10 : 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 320px', minWidth: 0 }}>
            <input type="search" aria-label="Search contacts" placeholder={isMobile ? 'Search contacts…' : 'Search name, company, email, phone or tag…'} value={p.search} onChange={e => p.setSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 40px 9px 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: isMobile ? 16 : 14, minHeight: isMobile ? 44 : undefined, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-111)' }} />
            {p.search && <button onClick={() => p.setSearch('')} aria-label="Clear search" style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, border: 'none', background: 'transparent', color: 'var(--k-9ca3af)', fontSize: 18, cursor: 'pointer' }}>×</button>}
          </div>
          {p.savedLists}
        </div>

        <div role="group" aria-label="Contact type" style={rowScroll}>
          {SEGMENTS.map(s => {
            const on = p.type === s.type;
            const v = s.type ? (typeCounts.m.get(s.type) ?? 0) : typeCounts.all;
            return <button key={s.label} onClick={() => p.setType(s.type)} aria-pressed={on} style={chip(on, v === 0)}>{s.label} {n(v, on)}</button>;
          })}
        </div>

        <div role="group" aria-label="Quick filters" style={rowScroll}>
          <button onClick={() => setPanelOpen(o => !o)} aria-expanded={panelOpen} style={{ ...chip(panelCount > 0), borderStyle: 'dashed' }}>
            ⚙ Filters{panelCount > 0 && <span style={{ background: '#fff', color: '#a06a12', borderRadius: 999, padding: '0 7px', fontSize: 11.5, fontWeight: 800 }}>{panelCount}</span>}
          </button>
          <button onClick={() => p.setNeedsTouchOnly(!p.needsTouchOnly)} aria-pressed={p.needsTouchOnly} style={chip(p.needsTouchOnly)} title="Open deals quiet for 2+ weeks, overdue tasks, and new leads nobody has contacted">Needs a touch {n(counts.touch, p.needsTouchOnly)}</button>
          <button onClick={() => p.setNoInfoOnly(!p.noInfoOnly)} aria-pressed={p.noInfoOnly} style={chip(p.noInfoOnly)} title="No email and no phone number">📵 No email / phone {n(counts.noInfo, p.noInfoOnly)}</button>
          <button onClick={() => p.setCampaignOnly(!p.campaignOnly)} aria-pressed={p.campaignOnly} style={chip(p.campaignOnly)}>📣 In a campaign {n(counts.campaign, p.campaignOnly)}</button>
          <button onClick={() => p.setDealOnly(!p.dealOnly)} aria-pressed={p.dealOnly} style={chip(p.dealOnly)}>💼 Has a deal {n(counts.deal, p.dealOnly)}</button>
          {p.isSuperAdmin && counts.held > 0 && <button onClick={() => p.setHeldOnly(!p.heldOnly)} aria-pressed={p.heldOnly} style={chip(p.heldOnly)} title="New leads only you can see">🔒 Held {n(counts.held, p.heldOnly)}</button>}
        </div>

        {panelOpen && (
          <>
            {!isMobile && <div onClick={() => setPanelOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 39 }} />}
            <div role="dialog" aria-label="More filters"
              style={isMobile
                ? { position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(17,17,17,.5)', display: 'flex', alignItems: 'flex-end' }
                : { position: 'absolute', left: 12, top: 'calc(100% + 6px)', width: 420, maxWidth: 'calc(100% - 24px)', zIndex: 40 }}
              onClick={isMobile ? () => setPanelOpen(false) : undefined}>
              <div onClick={e => e.stopPropagation()}
                style={{ background: 'var(--k-fff)', border: '1px solid #eef0f2', fontFamily: "'DM Sans',sans-serif", ...(isMobile ? { width: '100%', maxHeight: '88vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', padding: '18px 18px calc(18px + env(safe-area-inset-bottom))' } : { borderRadius: 14, padding: 18, boxShadow: '0 18px 50px rgba(0,0,0,.18)' }) }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 21, fontWeight: 600, color: 'var(--k-1a1a1a)' }}>More filters</div>
                  <button onClick={() => setPanelOpen(false)} aria-label="Close" style={{ width: isMobile ? 44 : 32, height: isMobile ? 44 : 32, border: 'none', borderRadius: 8, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontSize: 18, cursor: 'pointer' }}>×</button>
                </div>
                {([
                  ['Lead source', p.sources, p.source, p.setSource],
                  ['Asset type', p.assetTypes, p.spec, p.setSpec],
                ] as const).map(([title, opts, val, set]) => (
                  <div key={title} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, letterSpacing: .7, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 8 }}>{title}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {opts.map(o => <button key={o} onClick={() => set(val === o ? '' : o)} aria-pressed={val === o} style={chip(val === o)}>{o}</button>)}
                    </div>
                  </div>
                ))}
                {isAdmin && p.profiles.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, letterSpacing: .7, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 8 }}>Owner</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {p.profiles.map(o => <button key={o.id} onClick={() => p.setOwner(p.owner === o.id ? '' : o.id)} aria-pressed={p.owner === o.id} style={chip(p.owner === o.id)}>{`${o.first_name ?? ''} ${o.last_name ?? ''}`.trim()}</button>)}
                    </div>
                  </div>
                )}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, letterSpacing: .7, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 8 }}>Tag</div>
                  <input value={p.tag} onChange={e => p.setTag(e.target.value)} placeholder="Contains…" style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: isMobile ? 16 : 14, minHeight: isMobile ? 44 : undefined, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-111)' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <button onClick={() => { p.setSource(''); p.setSpec(''); p.setOwner(''); p.setTag(''); }} style={{ minHeight: isMobile ? 44 : 32, border: 'none', background: 'transparent', color: '#a06a12', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Clear these</button>
                  <button onClick={() => setPanelOpen(false)} style={{ minHeight: isMobile ? 48 : 36, padding: '0 22px', border: 'none', borderRadius: 10, background: '#c9922c', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Show {filtered.length.toLocaleString()}</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Result line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div aria-live="polite" style={{ fontSize: 13, color: 'var(--k-6b7280)', fontWeight: 600 }}>
          {filtered.length.toLocaleString()}{filtered.length !== p.clients.length ? ` of ${p.clients.length.toLocaleString()}` : ''} contact{filtered.length === 1 ? '' : 's'}
        </div>
        {activeCount > 0 && <button onClick={clearAll} style={{ minHeight: isMobile ? 44 : 30, padding: '0 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 999, background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Clear {activeCount} filter{activeCount === 1 ? '' : 's'} ✕</button>}
        {p.saveListControls}
        <span style={{ flex: 1 }} />
        {isMobile && (
          <select aria-label="Sort" value={p.sort} onChange={e => p.setSort(e.target.value as ContactSort)} style={{ minHeight: 44, padding: '0 10px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 14, background: 'var(--k-fff)', color: 'var(--k-111)', fontFamily: "'DM Sans',sans-serif" }}>
            <option value="recent">Most recent</option><option value="never">Never contacted</option><option value="az">Name A → Z</option><option value="za">Name Z → A</option><option value="added">Newest added</option><option value="type">Type</option>{isAdmin && <option value="owner">Owner</option>}
          </select>
        )}
      </div>

      {p.bulkBar}

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--k-9ca3af)', background: 'var(--k-fff)', borderRadius: 12, border: '1px solid #eef0f2' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>👥</div>
          No contacts match{activeCount > 0 ? ' these filters' : ''}.
          {activeCount > 0 && <div style={{ marginTop: 14 }}><button onClick={clearAll} style={{ minHeight: 44, padding: '0 20px', border: 'none', borderRadius: 10, background: '#c9922c', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Clear all filters</button></div>}
        </div>
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isAdmin && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--k-6b7280)', minHeight: 40 }}>
              <input type="checkbox" checked={allSelected} onChange={e => p.setSelected(e.target.checked ? new Set(filtered.map(c => c.id)) : new Set())} style={{ width: 20, height: 20, accentColor: '#c9922c' }} /> Select all {filtered.length.toLocaleString()}
            </label>
          )}
          {shown.map(c => {
            const ta = p.timeAgo(c.last_touched_at);
            const tags = (c.tags ?? []).slice(0, 2);
            return (
              <div key={c.id} onClick={() => p.onOpen(c)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') p.onOpen(c); }}
                style={{ background: p.selected.has(c.id) ? 'var(--k-fef9f0)' : 'var(--k-fff)', border: `1px solid ${p.selected.has(c.id) ? '#f0d9a8' : '#eef0f2'}`, borderRadius: 12, padding: '12px 12px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {isAdmin && <input type="checkbox" checked={p.selected.has(c.id)} onClick={e => e.stopPropagation()} onChange={e => toggleOne(c.id, e.target.checked)} aria-label={`Select ${displayName(c)}`} style={{ width: 22, height: 22, accentColor: '#c9922c', flexShrink: 0 }} />}
                  {avatar(c, 38)}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(c)}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[nameOf(c) ? c.business_name : '', ...tags].filter(Boolean).join(' · ') || (phoneOf(c) ? p.phoneDisp(phoneOf(c)) : c.email || 'No contact info yet')}</div>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 10, padding: '2px 9px', background: ta.bg, color: ta.color, whiteSpace: 'nowrap' }}>{ta.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>{typePill(c)}{badges(c)}</div>
                  {rowActions(c)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ border: '1px solid #eef0f2', borderRadius: 12, background: 'var(--k-fff)', overflowX: 'auto' }}>
          <div style={{ minWidth: 960 }}>
            <div role="row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center', padding: '10px 16px', fontSize: 10.5, letterSpacing: .7, textTransform: 'uppercase', borderBottom: '1px solid #eef0f2', position: 'sticky', top: 0, background: 'var(--k-fff)', zIndex: 2, borderRadius: '12px 12px 0 0' }}>
              {isAdmin && <input type="checkbox" aria-label="Select all" checked={allSelected} ref={el => { if (el) el.indeterminate = p.selected.size > 0 && !allSelected; }} onChange={e => p.setSelected(e.target.checked ? new Set(filtered.map(c => c.id)) : new Set())} style={{ width: 15, height: 15, accentColor: '#c9922c', cursor: 'pointer' }} />}
              <div>{sortHeader('Contact', 'az', 'za')}</div>
              <div>{sortHeader('Type', 'type')}</div>
              <div style={{ color: 'var(--k-9ca3af)', fontWeight: 700 }}>Email</div>
              <div style={{ color: 'var(--k-9ca3af)', fontWeight: 700 }}>Phone</div>
              {isAdmin && <div>{sortHeader('Owner', 'owner')}</div>}
              <div>{sortHeader('Touched', 'recent', 'never')}</div>
              <div style={{ color: 'var(--k-9ca3af)', fontWeight: 700 }}>Activity</div>
              <div />
            </div>
            {shown.map(c => {
              const ta = p.timeAgo(c.last_touched_at);
              const phone = phoneOf(c);
              const sel = p.selected.has(c.id);
              const tags = (c.tags ?? []).slice(0, 2);
              const sub = [nameOf(c) ? c.business_name : '', ...tags].filter(Boolean).join(' · ');
              return (
                <div key={c.id} role="row" onClick={() => p.onOpen(c)}
                  style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center', padding: '9px 16px', borderTop: '1px solid var(--k-f4f5f7)', cursor: 'pointer', background: sel ? 'var(--k-fef9f0)' : 'var(--k-fff)' }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--k-fbf8f1)'; }} onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'var(--k-fff)'; }}>
                  {isAdmin && <input type="checkbox" checked={sel} onClick={e => e.stopPropagation()} onChange={e => toggleOne(c.id, e.target.checked)} aria-label={`Select ${displayName(c)}`} style={{ width: 15, height: 15, accentColor: '#c9922c', cursor: 'pointer' }} />}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                    {avatar(c, 34)}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span title={displayName(c)} style={{ fontWeight: 600, fontSize: 14, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(c)}</span>
                        {c.is_shared && <span title="Team contact — visible to all agents" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .5, background: 'var(--k-ede9fe)', color: 'var(--k-6d28d9)', borderRadius: 6, padding: '1px 5px', flexShrink: 0 }}>TEAM</span>}
                        {c.lead_hold && <span title="Held lead" style={{ fontSize: 11, flexShrink: 0 }}>🔒</span>}
                      </div>
                      {sub && <div title={sub} style={{ fontSize: 12, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{sub}</div>}
                    </div>
                  </div>
                  <div>{typePill(c)}</div>
                  <div style={{ minWidth: 0 }} onClick={e => e.stopPropagation()}>{c.email ? <a href={`mailto:${c.email}`} title={c.email} style={{ fontSize: 13, color: 'var(--k-374151)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</a> : <span style={{ color: '#d1d5db' }}>—</span>}</div>
                  <div onClick={e => e.stopPropagation()}>{phone ? <a href={`tel:${phone}`} style={{ fontSize: 13, color: 'var(--k-374151)', textDecoration: 'none', whiteSpace: 'nowrap' }}>{p.phoneDisp(phone)}</a> : <span style={{ color: '#d1d5db' }}>—</span>}</div>
                  {isAdmin && <div style={{ fontSize: 13, color: 'var(--k-6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ownerFirst.get(c.agent_id ?? '') || <span style={{ color: '#d1d5db' }}>—</span>}</div>}
                  <div><span style={{ fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '2px 9px', background: ta.bg, color: ta.color, whiteSpace: 'nowrap' }}>{ta.label}</span></div>
                  <div>{badges(c)}</div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{rowActions(c)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {filtered.length > limit && (
        <div style={{ textAlign: 'center', margin: '16px 0 6px' }}>
          <button onClick={() => setLimit(l => l + WINDOW * 2)} style={{ minHeight: isMobile ? 48 : 38, padding: '0 22px', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            Show {Math.min(WINDOW * 2, filtered.length - limit)} more · {(filtered.length - limit).toLocaleString()} not shown
          </button>
          <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 6 }}>Search or filter to narrow {filtered.length.toLocaleString()} contacts — everything is still searchable.</div>
        </div>
      )}
    </div>
  );
}
