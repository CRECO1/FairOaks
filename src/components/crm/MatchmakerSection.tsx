'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { usePropertyShortlist } from '@/lib/use-property-shortlist';
import { summarizeProperties, type FilterableProperty } from '@/lib/property-filters';
import StarButton from '@/components/crm/StarButton';
import MatchEmailModal from '@/components/crm/MatchEmailModal';
import { criteriaFromRow, displayName, FIT_LABEL, hasCriteria as hasNeed, matchProperties, MATCH_COLUMNS, possessive, propertyLine, propertyTitle, sourceLabel, type DealType, type Fit, type MatchProperty, type NeedCriteria } from '@/lib/matchmaker/match';

const SHOW = 60;   // rendered at once; the heading always reports the true total
const ASSET_TYPES = ['Retail', 'Office', 'Industrial', 'Flex', 'Land', 'Medical', 'Mixed-Use'];

interface Buyer {
  id: string; first_name: string | null; last_name: string | null; business_name: string | null;
  type: string | null; agent_id: string | null; phone: string | null; email: string | null;
  asset_types: string[] | null;
  req_size_min: number | null; req_size_max: number | null;
  req_price_min: number | null; req_price_max: number | null;
  req_submarkets: string[] | null;
  // added by supabase/matchmaker-needs-2026-11.sql — absent until that has been applied
  req_deal_type?: string | null; req_rate_max?: number | null; req_move_in_by?: string | null; req_must_haves?: string | null;
  req_active?: boolean | null; req_auto_match?: boolean | null;
}
type Prop = MatchProperty;

const BUYER_COLS = 'id,first_name,last_name,business_name,type,agent_id,phone,email,asset_types,req_size_min,req_size_max,req_price_min,req_price_max,req_submarkets';
const BUYER_COLS_NEW = ',req_deal_type,req_rate_max,req_move_in_by,req_must_haves,req_active,req_auto_match';

interface Req { assetTypes: string[]; sizeMin: string; sizeMax: string; priceMin: string; priceMax: string; rateMax: string; submarkets: string[]; dealType: DealType; moveInBy: string; mustHaves: string; active: boolean; autoMatch: boolean }
const EMPTY_REQ: Req = { assetTypes: [], sizeMin: '', sizeMax: '', priceMin: '', priceMax: '', rateMax: '', submarkets: [], dealType: '', moveInBy: '', mustHaves: '', active: false, autoMatch: false };
const reqFrom = (b: Buyer): Req => ({
  assetTypes: b.asset_types ?? [],
  sizeMin: b.req_size_min != null ? String(b.req_size_min) : '', sizeMax: b.req_size_max != null ? String(b.req_size_max) : '',
  priceMin: b.req_price_min != null ? String(b.req_price_min) : '', priceMax: b.req_price_max != null ? String(b.req_price_max) : '',
  rateMax: b.req_rate_max != null ? String(b.req_rate_max) : '',
  submarkets: b.req_submarkets ?? [],
  dealType: b.req_deal_type === 'lease' || b.req_deal_type === 'sale' ? b.req_deal_type : '',
  moveInBy: b.req_move_in_by ?? '', mustHaves: b.req_must_haves ?? '', active: !!b.req_active, autoMatch: !!b.req_auto_match,
});

const num = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, '')); return v.trim() === '' ? null : (Number.isFinite(n) ? n : null); };
const crit = (r: Req): NeedCriteria => ({ dealType: r.dealType, assetTypes: r.assetTypes, sizeMin: num(r.sizeMin), sizeMax: num(r.sizeMax), rateMax: num(r.rateMax), priceMin: num(r.priceMin), priceMax: num(r.priceMax), areas: r.submarkets, moveInBy: r.moveInBy || null, mustHaves: r.mustHaves });
const fitStyle = (fit: Fit): React.CSSProperties => ({ fontSize: 10.5, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 10, flexShrink: 0, background: fit === 'strong' ? '#c9922c' : fit === 'good' ? '#f3e9d2' : 'var(--k-f3f4f6)', color: fit === 'strong' ? '#1a1a1a' : fit === 'good' ? '#6b4a0e' : 'var(--k-6b7280)' });
const sentWhen = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function MatchmakerSection({ businessUnit, onToast, currentUserId, authToken, isMobile = false, initialClientId }: {
  businessUnit: string; onToast: (m: string) => void; currentUserId?: string; authToken?: string; isMobile?: boolean;
  /** Open on this tenant (a link from a Matchmaker alert email). */
  initialClientId?: string;
}) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [props, setProps] = useState<Prop[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Buyer | null>(null);
  const [busy, setBusy] = useState(false);
  const [called, setCalled] = useState<Set<string>>(new Set());
  const { shortlist, toggleStar } = usePropertyShortlist(authToken, onToast);
  // Who the left-hand list shows. The list is mostly investor LLCs; tenants are what you usually match.
  const [who, setWho] = useState<'' | 'Tenant' | 'Buyer' | 'Landlord/Investor' | 'criteria'>('');
  // editable search for the selected buyer. Lease or sale is part of it now (and saved with the tenant): most tenants want a rate, most buyers a price.
  const [req, setReq] = useState<Req>(EMPTY_REQ);
  const [areaDraft, setAreaDraft] = useState('');
  // The new columns exist only after supabase/matchmaker-needs-2026-11.sql; until then the extra fields still search, they just do not save.
  const [setupMissing, setSetupMissing] = useState(false);
  // What was marked "not a fit" for the selected tenant, and what has already been emailed (the server's log).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [emailed, setEmailed] = useState<Record<string, { at: string; to: string | null }>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [mail, setMail] = useState<null | 'agent' | 'client'>(null);
  const autoOpened = useRef(false);
  // How wide the results list is: wide enough for the actions to sit beside each listing, else they go underneath — the same for every row.
  const [listW, setListW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const listRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect(); roRef.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => setListW(Math.round(entries[0].contentRect.width)));
    ro.observe(el); roRef.current = ro;
  }, []);
  const wideRows = !isMobile && listW >= 600;
  const authHeaders = useMemo(() => ({ 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }), [authToken]);

  const load = useCallback(async () => {
    setLoading(true);
    const PAGE = 1000;   // PostgREST's hard ceiling per response, whatever .range() asks
    const allProps: Prop[] = [];
    // Is the database update (new search columns) in? One tiny probe, so a missing column never takes the whole tab down.
    const probe = await supabase.from('crm_clients').select('req_deal_type').limit(1);
    const hasNew = !probe.error;
    setSetupMissing(!hasNew);
    // Pages of 1000, in a stable order (id). One un-paged query silently stopped at 1,000 of the ~2,400
    // buyers / tenants / investors, sorted by first name — so most tenants (business names sort last) never appeared.
    const allBuyers: Buyer[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase.from('crm_clients')
        .select(BUYER_COLS + (hasNew ? BUYER_COLS_NEW : ''))
        .eq('business_unit', businessUnit).in('type', ['Buyer', 'Tenant', 'Landlord/Investor']).order('id').range(from, from + PAGE - 1);
      allBuyers.push(...((data ?? []) as unknown as Buyer[]));
      if (!data || data.length < PAGE) break;
    }
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase.from('crm_prospective_properties')
        .select(MATCH_COLUMNS)
        .eq('business_unit', businessUnit).order('id').range(from, from + PAGE - 1);
      allProps.push(...((data ?? []) as unknown as Prop[]));
      if (!data || data.length < PAGE) break;
    }
    const label = (b: Buyer) => ([b.first_name, b.last_name].filter(Boolean).join(' ') || b.business_name || '').toLowerCase();
    setBuyers(allBuyers.sort((x, y) => label(x).localeCompare(label(y))));
    setProps(allProps);
    setLoading(false);
  }, [supabase, businessUnit]);
  useEffect(() => { load(); }, [load]);

  const submarkets = useMemo(
    () => Array.from(new Set(props.map(p => p.submarket).filter(Boolean) as string[])).sort().slice(0, 40),
    [props]);
  // areas the agent typed (a neighbourhood, a city or a ZIP) that are not one of the database's submarkets
  const customAreas = useMemo(() => req.submarkets.filter(a => !submarkets.includes(a)), [req.submarkets, submarkets]);

  const clearReq = () => { setReq(r => ({ ...EMPTY_REQ, active: r.active, autoMatch: r.autoMatch })); };

  const loadState = useCallback(async (id: string) => {
    setDismissed(new Set()); setEmailed({}); setShowHidden(false);
    if (!authToken) return;
    try {
      const r = await fetch(`/api/crm/matchmaker/state?client_id=${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setDismissed(new Set((j.dismissed as string[]) ?? [])); setEmailed((j.emailed as Record<string, { at: string; to: string | null }>) ?? {}); }
    } catch { /* the log is optional */ }
  }, [authToken]);

  function pick(b: Buyer) {
    setSel(b); setCalled(new Set());
    setReq(reqFrom(b));
    void loadState(b.id);
  }
  // A link from an alert email opens straight on that tenant.
  useEffect(() => {
    if (!initialClientId || autoOpened.current || loading) return;
    autoOpened.current = true;
    const b = buyers.find(x => x.id === initialClientId);
    if (b) { setWho(''); pick(b); return; }
    // not one of the buyer / tenant / investor types the list shows (a tenant-rep client saved by the Copilot, say): open it anyway
    void (async () => {
      const { data } = await supabase.from('crm_clients').select(BUYER_COLS + (setupMissing ? '' : BUYER_COLS_NEW)).eq('id', initialClientId).maybeSingle();
      if (!data) return;
      const row = data as unknown as Buyer;
      setBuyers(prev => (prev.some(x => x.id === row.id) ? prev : [row, ...prev]));
      setWho(''); pick(row);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId, buyers, loading]);

  async function saveReq() {
    if (!sel) return;
    if (req.autoMatch && !hasNeed(crit(req))) { onToast('Add what they are looking for first — there is nothing to match yet'); return; }
    setBusy(true);
    const patch: Record<string, unknown> = {
      asset_types: req.assetTypes,
      req_size_min: num(req.sizeMin), req_size_max: num(req.sizeMax),
      req_price_min: num(req.priceMin), req_price_max: num(req.priceMax),
      req_submarkets: req.submarkets,
    };
    if (!setupMissing) Object.assign(patch, {
      req_deal_type: req.dealType || null, req_rate_max: num(req.rateMax), req_move_in_by: req.moveInBy || null,
      req_must_haves: req.mustHaves.trim() || null, req_active: req.active || req.autoMatch, req_auto_match: req.autoMatch,
    });
    const { error } = await supabase.from('crm_clients').update(patch).eq('id', sel.id);
    setBusy(false);
    if (error) { onToast('Could not save criteria'); return; }
    setBuyers(prev => prev.map(x => x.id === sel.id ? { ...x, ...patch } as Buyer : x));
    setSel(s => s ? { ...s, ...patch } as Buyer : s);
    if (!setupMissing && (req.active || req.autoMatch)) setReq(r => ({ ...r, active: true }));
    onToast(req.autoMatch ? 'Saved ✓ — you’ll get an email each morning when something new fits' : 'Criteria saved ✓');
  }

  const need = useMemo(() => crit(req), [req]);
  const hasCriteria = hasNeed(need);
  // Saved criteria drive the emails and the daily alert, so emailing waits until what is on screen has been saved.
  const critDirty = !!sel && JSON.stringify(need) !== JSON.stringify(criteriaFromRow(sel));
  // the two switches save with the criteria, so flipping one leaves something to save too (it just does not hold up emailing)
  const flagsDirty = !!sel && !setupMissing && ((req.active || req.autoMatch) !== !!sel.req_active || req.autoMatch !== !!sel.req_auto_match);
  const anyDirty = critDirty || flagsDirty;

  const results = useMemo(() => (hasCriteria ? matchProperties(need, props) : []), [need, props, hasCriteria]);
  const visible = useMemo(() => results.filter(r => !dismissed.has(r.property.id)), [results, dismissed]);
  const hiddenCount = results.length - visible.length;
  const shown = (showHidden ? results : visible);
  const fitCounts = useMemo(() => ({ strong: visible.filter(r => r.fit === 'strong').length, good: visible.filter(r => r.fit === 'good').length }), [visible]);

  const buyerName = (b: Buyer) => [b.first_name, b.last_name].filter(Boolean).join(' ') || b.business_name || 'Contact';

  const hasSaved = (b: Buyer) => !!(b.asset_types?.length || b.req_size_min || b.req_size_max || b.req_price_min || b.req_price_max || b.req_submarkets?.length || b.req_rate_max || b.req_must_haves);
  const whoCounts = useMemo(() => ({
    all: buyers.length,
    Tenant: buyers.filter(b => b.type === 'Tenant').length,
    Buyer: buyers.filter(b => b.type === 'Buyer').length,
    'Landlord/Investor': buyers.filter(b => b.type === 'Landlord/Investor').length,
    criteria: buyers.filter(hasSaved).length,
  }), [buyers]);
  const buyerMatches = useMemo(() => {
    const q = search.toLowerCase();
    return buyers
      .filter(b => (!who || (who === 'criteria' ? hasSaved(b) : b.type === who))
        && (!q || `${b.first_name ?? ''} ${b.last_name ?? ''} ${b.business_name ?? ''}`.toLowerCase().includes(q)))
      // people with saved criteria first — they are the ones ready to match
      .sort((a, b) => Number(hasSaved(b)) - Number(hasSaved(a)));
  }, [buyers, search, who]);
  const filteredBuyers = useMemo(() => buyerMatches.slice(0, 200), [buyerMatches]);

  async function addCall(p: Prop) {
    if (!sel) return;
    const title = `🎯 Show ${propertyTitle(p)} to ${buyerName(sel)}`;
    const notes = [
      propertyLine(p),
      p.listing_agent_name ? `Listing: ${p.listing_agent_name}${p.listing_agent_phone ? ' ' + p.listing_agent_phone : ''}` : '',
      p.listing_url || '',
    ].filter(Boolean).join('\n');
    const { error } = await supabase.from('crm_tasks').insert([{
      client_id: sel.id, agent_id: sel.agent_id || currentUserId || null, type: 'call',
      title: title.slice(0, 200), notes, due_date: new Date().toISOString().slice(0, 10),
      status: 'open', priority: 'normal', business_unit: businessUnit,
    }]);
    if (error) { onToast('Could not add call'); return; }
    setCalled(prev => new Set(prev).add(p.id));
    onToast('📞 Call added to the queue');
  }

  // "Not a fit": hide it for this tenant (and never put it in an alert). Optimistic, undone if the save fails.
  async function dismiss(p: Prop, on: boolean) {
    if (!sel || !authToken) return;
    const flip = (v: boolean) => setDismissed(prev => { const n = new Set(prev); if (v) n.add(p.id); else n.delete(p.id); return n; });
    flip(on);
    try {
      const r = await fetch('/api/crm/matchmaker/state', { method: 'POST', headers: authHeaders, body: JSON.stringify({ client_id: sel.id, property_ids: [p.id], action: on ? 'dismiss' : 'restore' }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); flip(!on); onToast(j.setup_needed ? 'That needs the one-time database update first' : (j.error || 'Could not save that')); }
    } catch { flip(!on); onToast('Could not save that'); }
  }

  const addArea = () => {
    const v = areaDraft.trim();
    if (!v) return;
    setReq(r => (r.submarkets.some(a => a.toLowerCase() === v.toLowerCase()) ? r : { ...r, submarkets: [...r.submarkets, v] }));
    setAreaDraft('');
  };

  const chip = (on: boolean): React.CSSProperties => ({
    padding: '5px 11px', borderRadius: 16, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
    border: `1px solid ${on ? '#c9922c' : 'var(--k-e5e7eb)'}`, background: on ? 'var(--k-fdf6e8)' : 'var(--k-fff)', color: on ? 'var(--k-a8741a)' : 'var(--k-6b7280)',
  });
  const inp: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" };
  const lbl: React.CSSProperties = { fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 6 };
  const ghost: React.CSSProperties = { minHeight: isMobile ? 44 : 32, padding: '0 14px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
  const canMail = !!sel && !setupMissing && !critDirty && hasCriteria && visible.length > 0;
  const tenantFirst = sel ? (sel.first_name || buyerName(sel)) : '';

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: 'var(--k-111)', marginBottom: 4 }}>🎯 Matchmaker</h2>
        <p style={{ fontSize: 14, color: 'var(--k-6b7280)' }}>Save a buyer/tenant’s search → see the best-fitting properties from your database, with why — then email them. {loading ? 'Loading…' : `${buyers.length.toLocaleString()} prospects · ${props.length.toLocaleString()} properties`}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(240px, 300px) 1fr', gap: 18, alignItems: 'start' }}>
        {/* Buyer picker */}
        <div style={{ background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 12, padding: 12 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search buyers/tenants…" style={{ ...inp, marginBottom: 10, ...(isMobile ? { minHeight: 44, fontSize: 16 } : {}) }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {([['', 'All', whoCounts.all], ['Tenant', 'Tenants', whoCounts.Tenant], ['Buyer', 'Buyers', whoCounts.Buyer], ['Landlord/Investor', 'Investors', whoCounts['Landlord/Investor']], ['criteria', 'Has criteria', whoCounts.criteria]] as const).map(([k, label, n]) => (
              <button key={k} onClick={() => setWho(k as typeof who)} aria-pressed={who === k} style={{ ...chip(who === k), minHeight: isMobile ? 40 : undefined }}>
                {label} <span style={{ opacity: .6, fontWeight: 700 }}>{n.toLocaleString()}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: isMobile ? 280 : 520, overflowY: 'auto' }}>
            {filteredBuyers.map(b => {
              const active = sel?.id === b.id;
              return (
                <button key={b.id} onClick={() => pick(b)}
                  style={{ textAlign: 'left', padding: '9px 11px', borderRadius: 8, border: `1px solid ${active ? '#c9922c' : 'transparent'}`, background: active ? 'var(--k-fdf6e8)' : 'transparent', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-111)' }}>{buyerName(b)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{b.type}{hasSaved(b) ? ' · has criteria' : ''}{b.req_auto_match ? ' · 📬 alerts on' : b.req_active ? ' · searching' : ''}</div>
                </button>
              );
            })}
            {loading && <div style={{ padding: 16, fontSize: 13, color: 'var(--k-9ca3af)', textAlign: 'center' }}>Loading prospects…</div>}
            {!loading && buyerMatches.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'var(--k-9ca3af)', textAlign: 'center' }}>No one matches that.</div>}
          </div>
          {buyerMatches.length > filteredBuyers.length && (
            <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 8, textAlign: 'center' }}>
              Showing the first {filteredBuyers.length} of {buyerMatches.length.toLocaleString()} — search or pick a type to narrow.
            </div>
          )}
        </div>

        {/* Requirements + matches */}
        <div>
          {/* The criteria panel is always here. Matchmaker used to hide it behind
              picking a buyer, so the tab opened with nothing to search with — but
              most of the time you just want to know what fits a shape, and only
              sometimes is that shape a particular person's. */}
          <div style={{ background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              {sel ? (
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--k-111)', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{buyerName(sel)}</span>
                  <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', fontWeight: 500, flexShrink: 0 }}>· {sel.type}</span>
                  <button onClick={() => { setSel(null); setDismissed(new Set()); setEmailed({}); }} title="Search without a buyer — keeps these criteria" aria-label="Search without a buyer"
                    style={{ background: 'none', border: 'none', color: '#c9b48a', cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0 }}>✕</button>
                </div>
              ) : (
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--k-111)' }}>Property search
                  <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', fontWeight: 500, marginLeft: 8 }}>· pick a buyer on the left to save these to them</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {hasCriteria && <button onClick={clearReq} style={{ padding: '7px 12px', minHeight: isMobile ? 44 : undefined, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Clear</button>}
                {sel && <button onClick={saveReq} disabled={busy || !anyDirty} style={{ padding: '7px 14px', minHeight: isMobile ? 44 : undefined, borderRadius: 8, border: anyDirty ? 'none' : '1px solid var(--k-e5e7eb)', background: anyDirty ? '#c9922c' : 'var(--k-fff)', color: anyDirty ? '#fff' : 'var(--k-16a34a)', fontSize: 13, fontWeight: 700, cursor: busy || !anyDirty ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : anyDirty ? 'Save changes' : '✓ Saved'}</button>}
              </div>
            </div>
            <div style={lbl}>Looking to{!req.dealType && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, marginLeft: 6 }}>· leave both off to see lease and sale</span>}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              <button onClick={() => setReq(r => ({ ...r, dealType: r.dealType === 'lease' ? '' : 'lease' }))} aria-pressed={req.dealType === 'lease'} style={chip(req.dealType === 'lease')}>Lease</button>
              <button onClick={() => setReq(r => ({ ...r, dealType: r.dealType === 'sale' ? '' : 'sale' }))} aria-pressed={req.dealType === 'sale'} style={chip(req.dealType === 'sale')}>Buy</button>
            </div>
            <div style={lbl}>Asset types</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {req.assetTypes.filter(t => !ASSET_TYPES.includes(t)).map(t => <button key={t} onClick={() => setReq(r => ({ ...r, assetTypes: r.assetTypes.filter(x => x !== t) }))} style={chip(true)} title="Click to remove">{t} ✕</button>)}
              {ASSET_TYPES.map(t => {
                const on = req.assetTypes.includes(t);
                return <button key={t} onClick={() => setReq(r => ({ ...r, assetTypes: on ? r.assetTypes.filter(x => x !== t) : [...r.assetTypes, t] }))} style={chip(on)}>{t}</button>;
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={lbl}>Size (SF)</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={req.sizeMin} onChange={e => setReq(r => ({ ...r, sizeMin: e.target.value }))} placeholder="min" inputMode="numeric" style={inp} />
                  <span style={{ color: 'var(--k-9ca3af)' }}>–</span>
                  <input value={req.sizeMax} onChange={e => setReq(r => ({ ...r, sizeMax: e.target.value }))} placeholder="max" inputMode="numeric" style={inp} />
                </div>
              </div>
              {req.dealType !== 'sale' && (
                <div>
                  <div style={lbl}>Lease budget ($/SF/yr, up to)</div>
                  <input value={req.rateMax} onChange={e => setReq(r => ({ ...r, rateMax: e.target.value }))} placeholder="e.g. 26" inputMode="decimal" style={inp} />
                </div>
              )}
              {req.dealType !== 'lease' && (
                <div>
                  <div style={lbl}>Sale price ($)</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={req.priceMin} onChange={e => setReq(r => ({ ...r, priceMin: e.target.value }))} placeholder="min" inputMode="numeric" style={inp} />
                    <span style={{ color: 'var(--k-9ca3af)' }}>–</span>
                    <input value={req.priceMax} onChange={e => setReq(r => ({ ...r, priceMax: e.target.value }))} placeholder="max" inputMode="numeric" style={inp} />
                  </div>
                </div>
              )}
            </div>
            <div style={lbl}>Where</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 96, overflowY: 'auto', marginBottom: 8 }}>
              {customAreas.map(m => <button key={m} onClick={() => setReq(r => ({ ...r, submarkets: r.submarkets.filter(x => x !== m) }))} style={chip(true)} title="Click to remove">{m} ✕</button>)}
              {submarkets.map(m => {
                const on = req.submarkets.includes(m);
                return <button key={m} onClick={() => setReq(r => ({ ...r, submarkets: on ? r.submarkets.filter(x => x !== m) : [...r.submarkets, m] }))} style={chip(on)}>{m}</button>;
              })}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <input value={areaDraft} onChange={e => setAreaDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } }} placeholder="Add a city, neighborhood or ZIP code…" style={{ ...inp, ...(isMobile ? { minHeight: 44, fontSize: 16 } : {}) }} />
              <button onClick={addArea} style={{ ...ghost, flexShrink: 0 }}>Add</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 12 }}>
              <div>
                <div style={lbl}>Needs (comma-separated)</div>
                <input value={req.mustHaves} onChange={e => setReq(r => ({ ...r, mustHaves: e.target.value }))} placeholder="drive-thru, 24' clear, corner, medical build-out…" style={{ ...inp, ...(isMobile ? { minHeight: 44, fontSize: 16 } : {}) }} />
              </div>
              <div>
                <div style={lbl}>Move in by</div>
                <input type="date" value={req.moveInBy} onChange={e => setReq(r => ({ ...r, moveInBy: e.target.value }))} style={{ ...inp, ...(isMobile ? { minHeight: 44, fontSize: 16 } : {}) }} />
              </div>
            </div>
            {sel && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--k-eef0f2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--k-374151)', cursor: setupMissing ? 'default' : 'pointer', minHeight: isMobile ? 44 : undefined }}>
                  <input type="checkbox" checked={req.active || req.autoMatch} disabled={setupMissing || req.autoMatch} onChange={e => setReq(r => ({ ...r, active: e.target.checked }))} style={{ width: 17, height: 17, accentColor: '#c9922c' }} />
                  <span><b>Actively searching</b> <span style={{ color: 'var(--k-9ca3af)' }}>{req.autoMatch ? '— stays on while the email alert is on' : `— marks ${tenantFirst} as looking for space now`}</span></span>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: 'var(--k-374151)', cursor: setupMissing ? 'default' : 'pointer', minHeight: isMobile ? 44 : undefined }}>
                  <input type="checkbox" checked={req.autoMatch} disabled={setupMissing} onChange={e => setReq(r => ({ ...r, autoMatch: e.target.checked, active: e.target.checked ? true : r.active }))} style={{ width: 17, height: 17, accentColor: '#c9922c', marginTop: 2 }} />
                  <span><b>Email me new matches</b> <span style={{ color: 'var(--k-9ca3af)' }}>— one email each morning, only when something <i>new</i> fits {possessive(tenantFirst)} search. It goes to you, never to {tenantFirst}.</span></span>
                </label>
                {setupMissing && <div style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>Lease budget, timing, needs and the email alert are used for searching now, and start saving after a one-time database update (ask an admin).</div>}
                {anyDirty && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', background: 'var(--k-fdf6e8)', border: '1px solid #ecd9a8', borderRadius: 10, padding: '10px 12px' }}>
                    <span style={{ fontSize: 13, color: 'var(--k-a8741a)', fontWeight: 600 }}>You have unsaved changes</span>
                    <button onClick={saveReq} disabled={busy} style={{ padding: '8px 16px', minHeight: isMobile ? 44 : undefined, width: isMobile ? '100%' : undefined, borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save changes'}</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Matches */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700 }}>
              {hasCriteria
                ? `${visible.length.toLocaleString()} matching propert${visible.length === 1 ? 'y' : 'ies'}${fitCounts.strong ? ` · ${fitCounts.strong} strong` : ''}${visible.length > SHOW ? ` · showing the first ${SHOW}` : ''}`
                : 'Set criteria above to search'}
            </div>
            {hasCriteria && visible.length > 0 && (
              <div style={isMobile ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' } : { display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={async () => {
                  const list = visible.slice(0, 25).map(r => r.property) as unknown as FilterableProperty[];
                  let ok = false;
                  try { await navigator.clipboard.writeText(summarizeProperties(list)); ok = true; } catch { /* blocked */ }
                  onToast(ok ? `Copied ${list.length} — paste into an email or text` : 'Could not copy');
                }} style={ghost}>
                  📋 Copy top {Math.min(25, visible.length)}
                </button>
                {sel && (
                  <>
                    <button onClick={() => (canMail ? setMail('agent') : onToast(critDirty ? 'Save the criteria first — emails use what is saved' : setupMissing ? 'Emailing needs the one-time database update first' : 'Nothing to email yet'))} style={{ ...ghost, opacity: canMail ? 1 : .55 }}>✉️ Email me these</button>
                    {sel.email && <button onClick={() => (canMail ? setMail('client') : onToast(critDirty ? 'Save the criteria first — emails use what is saved' : setupMissing ? 'Emailing needs the one-time database update first' : 'Nothing to email yet'))} style={{ ...ghost, opacity: canMail ? 1 : .55, borderColor: '#c9922c', color: 'var(--k-a8741a)', ...(isMobile ? { gridColumn: '1 / -1' } : {}) }}>✉️ Email to {tenantFirst}</button>}
                  </>
                )}
              </div>
            )}
          </div>
          {sel && critDirty && hasCriteria && <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', margin: '-4px 0 10px' }}>You’ve changed the criteria — <b>Save changes</b> to email these.</div>}
          {hasCriteria && req.submarkets.length === 0 && visible.length > 40 && <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', margin: '-4px 0 10px' }}>Searching every area in your database — add a city, neighborhood or ZIP above to narrow it down.</div>}
          {sel && hiddenCount > 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', margin: '-4px 0 10px' }}>
              {hiddenCount} marked “not a fit” for {tenantFirst} {showHidden ? 'shown below, dimmed' : 'hidden'} · <button onClick={() => setShowHidden(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--k-a8741a)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12.5, fontFamily: "'DM Sans',sans-serif" }}>{showHidden ? 'hide them' : 'show them'}</button>
            </div>
          )}
          <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.slice(0, SHOW).map(r => {
              const p = r.property;
              const isHidden = dismissed.has(p.id);
              const tel = p.listing_agent_phone ? p.listing_agent_phone.replace(/[^\d+]/g, '') : '';
              const sent = emailed[p.id];
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: wideRows ? 'nowrap' : 'wrap', background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 10, padding: '11px 12px 11px 14px', opacity: isHidden ? .5 : 1 }}>
                  <div style={{ flex: wideRows ? '1 1 0' : '1 1 100%', minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={fitStyle(r.fit)}>{FIT_LABEL[r.fit]}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--k-9ca3af)', background: 'var(--k-f3f4f6)', padding: '2px 8px', borderRadius: 10 }}>{sourceLabel(p)}</span>
                      {sent && <span title={`Emailed ${sent.to === 'client' ? 'to the tenant' : 'to you'} ${new Date(sent.at).toLocaleDateString()}`} style={{ fontSize: 11, fontWeight: 600, color: 'var(--k-16a34a)' }}>✉ sent {sentWhen(sent.at)}</span>}
                    </div>
                    <div title={propertyTitle(p)} style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>{propertyTitle(p)}</div>
                    <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 2 }}>{p.address && displayName(p) ? `${displayName(p)} · ` : ''}{propertyLine(p)}</div>
                    {r.reasons.length > 0 && (
                      <div style={{ marginTop: 5, fontSize: 12, color: 'var(--k-374151)', lineHeight: 1.5 }}>
                        {r.reasons.slice(0, 3).map(w => <div key={w}><span style={{ color: 'var(--k-16a34a)', fontWeight: 700 }}>✓</span> {w}</div>)}
                      </div>
                    )}
                    {r.caveats.length > 0 && (
                      <div style={{ marginTop: 3, fontSize: 11.5, color: '#9a6a00', lineHeight: 1.5 }}>
                        {r.caveats.slice(0, 3).map(w => <div key={w}>• {w}</div>)}
                      </div>
                    )}
                    {(p.listing_agent_name || tel) && (
                      <div style={{ fontSize: 12, color: 'var(--k-6b7280)', marginTop: 4 }}>
                        {p.listing_agent_name}{p.listing_agent_name && tel ? ' · ' : ''}
                        {tel && <a href={`tel:${tel}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--k-a06a12)', fontWeight: 600, textDecoration: 'none' }}>📞 {p.listing_agent_phone}</a>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', marginTop: wideRows ? 0 : 2 }}>
                    {p.listing_url && <a href={p.listing_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: 'var(--k-6b7280)', textDecoration: 'none', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, padding: isMobile ? '12px 14px' : '6px 12px', whiteSpace: 'nowrap' }}>View ↗</a>}
                    {/* Queueing a showing call needs somebody to show it TO. */}
                    {!sel
                      ? null
                      : called.has(p.id)
                        ? <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--k-16a34a)', flexShrink: 0 }}>✓ Queued</span>
                        : <button onClick={() => addCall(p)} style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: '#c9922c', border: 'none', borderRadius: 7, padding: isMobile ? '12px 14px' : '6px 12px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>＋ Call</button>}
                    {sel && !setupMissing && (isHidden
                      ? <button onClick={() => dismiss(p, false)} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, padding: isMobile ? '12px 14px' : '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>↩ Restore</button>
                      : <button onClick={() => dismiss(p, true)} title={`Not a fit for ${tenantFirst} — hide it and keep it out of alerts`} aria-label="Not a fit" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--k-9ca3af)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, padding: isMobile ? '12px 14px' : '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>✕ Not a fit</button>)}
                    <StarButton on={shortlist.has(p.id)} onToggle={() => toggleStar(p.id)} size={isMobile ? 44 : 34} />
                  </div>
                </div>
              );
            })}
            {hasCriteria && visible.length === 0 && (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--k-9ca3af)', fontSize: 13, background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 10 }}>No available properties fit these criteria yet.{hiddenCount ? ' (Some were marked not a fit.)' : ''}</div>
            )}
            {!hasCriteria && (
              <div style={{ textAlign: 'center', padding: 50, color: 'var(--k-9ca3af)', background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 12 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{sel ? `Tell the Matchmaker what ${tenantFirst} needs` : `Pick an asset type or a size to search ${props.length.toLocaleString()} properties`}</div>
                <div style={{ fontSize: 13, marginTop: 5 }}>{sel ? 'Pick a property type or a size above, then save — it ranks your database and you can email the best matches.' : 'Or choose a buyer on the left to load the criteria you saved for them.'}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {mail && sel && (
        <MatchEmailModal
          audience={mail}
          tenant={{ id: sel.id, name: buyerName(sel), firstName: sel.first_name, email: sel.email }}
          candidates={visible.slice(0, 15)}
          authToken={authToken} isMobile={isMobile} onToast={onToast}
          onClose={() => setMail(null)}
          onSent={({ audience, propertyIds }) => { const at = new Date().toISOString(); setEmailed(prev => ({ ...prev, ...Object.fromEntries(propertyIds.map(id => [id, { at, to: audience }])) })); }}
        />
      )}
    </div>
  );
}
