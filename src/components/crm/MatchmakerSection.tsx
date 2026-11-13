'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { usePropertyShortlist } from '@/lib/use-property-shortlist';
import { summarizeProperties, type FilterableProperty } from '@/lib/property-filters';
import StarButton from '@/components/crm/StarButton';
import Skeleton from '@/components/crm/Skeleton';
import MatchEmailModal from '@/components/crm/MatchEmailModal';
import { criteriaFromRow, describeCriteria, displayName, hasCriteria as hasNeed, matchProperties, MATCH_COLUMNS, possessive, propertyLine, propertyTitle, sourceLabel, type DealType, type Fit, type MatchProperty, type NeedCriteria } from '@/lib/matchmaker/match';

const GROUP_STEP = 12;     // listings shown per fit group before "Show more"
const PEOPLE_SHOWN = 150;  // people listed at once; the heading always reports the true total
const ASSET_TYPES = ['Retail', 'Office', 'Industrial', 'Flex', 'Land', 'Medical', 'Mixed-Use'];
const PAGE = 1000;         // PostgREST's hard ceiling per response
const PARALLEL_PAGES = 4;  // asked for together, so a 4,000-row table costs one round trip, not four
const FRESH_MS = 60_000;   // coming back to the tab inside this window refetches nothing

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
const sentWhen = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const buyerName = (b: Buyer) => [b.first_name, b.last_name].filter(Boolean).join(' ') || b.business_name || 'Contact';
const hasSaved = (b: Buyer) => !!(b.asset_types?.length || b.req_size_min || b.req_size_max || b.req_price_min || b.req_price_max || b.req_submarkets?.length || b.req_rate_max || b.req_must_haves);
/** Who to look at first: people with the daily alert on, then people marked as searching, then anyone with a saved search. */
const tier = (b: Buyer) => (b.req_auto_match ? 0 : b.req_active ? 1 : hasSaved(b) ? 2 : 3);

// ── data: everything is asked for at once, shown as it arrives, and kept for the next visit ───────────────────────────────
type PageResult = { data: unknown[] | null; error: { message?: string } | null };
/** All rows of a table, in pages of 1,000 asked for together (a table past 4,000 rows continues one page at a time). */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<{ rows: T[]; error: string | null }> {
  const first = await Promise.all(Array.from({ length: PARALLEL_PAGES }, (_, i) => page(i * PAGE, i * PAGE + PAGE - 1)));
  const bad = first.find(r => r.error);
  if (bad) return { rows: [], error: bad.error?.message ?? 'error' };
  const rows = first.flatMap(r => (r.data ?? []) as T[]);
  let lastLen = first[PARALLEL_PAGES - 1].data?.length ?? 0;
  for (let from = PARALLEL_PAGES * PAGE; lastLen === PAGE; from += PAGE) {
    const r = await page(from, from + PAGE - 1);
    if (r.error) return { rows, error: r.error.message ?? 'error' };
    rows.push(...((r.data ?? []) as T[]));
    lastLen = r.data?.length ?? 0;
  }
  return { rows, error: null };
}

interface Snapshot { unit: string; buyers: Buyer[]; props: Prop[]; setupMissing: boolean; at: number }
let SNAP: Snapshot | null = null;   // survives switching tabs inside the CRM, so coming back is instant; gone on a page reload

function useMatchmakerData(supabase: ReturnType<typeof createBrowserClient>, unit: string) {
  const warm = SNAP && SNAP.unit === unit ? SNAP : null;
  const [buyers, setBuyers] = useState<Buyer[]>(warm?.buyers ?? []);
  const [props, setProps] = useState<Prop[]>(warm?.props ?? []);
  const [loadingPeople, setLoadingPeople] = useState(!warm);
  const [loadingProps, setLoadingProps] = useState(!warm);
  // The new search columns exist only after supabase/matchmaker-needs-2026-11.sql; until then the extra fields still search, they just do not save.
  const [setupMissing, setSetupMissing] = useState(warm?.setupMissing ?? false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    const cached = SNAP && SNAP.unit === unit ? SNAP : null;
    if (cached && Date.now() - cached.at < FRESH_MS) return;
    const label = (b: Buyer) => ([b.first_name, b.last_name].filter(Boolean).join(' ') || b.business_name || '').toLowerCase();
    const people = async () => {
      const q = (cols: string) => (a: number, b: number) => supabase.from('crm_clients').select(cols).eq('business_unit', unit)
        .in('type', ['Buyer', 'Tenant', 'Landlord/Investor']).order('id').range(a, b) as unknown as PromiseLike<PageResult>;
      let r = await fetchAll<Buyer>(q(BUYER_COLS + BUYER_COLS_NEW));
      let missing = false;
      if (r.error) { r = await fetchAll<Buyer>(q(BUYER_COLS)); missing = true; }   // the database update is not in yet
      const rows = r.rows.sort((x, y) => label(x).localeCompare(label(y)));
      if (!dead) { setBuyers(rows); setSetupMissing(missing); setLoadingPeople(false); if (r.error) setFailed(true); }
      return { rows, missing };
    };
    const properties = async () => {
      const r = await fetchAll<Prop>((a, b) => supabase.from('crm_prospective_properties').select(MATCH_COLUMNS).eq('business_unit', unit)
        .order('id').range(a, b) as unknown as PromiseLike<PageResult>);
      if (!dead) { if (r.error) setFailed(true); else setProps(r.rows); setLoadingProps(false); }
      return r.rows;
    };
    (async () => {
      const [b, p] = await Promise.all([people(), properties()]);
      if (b.rows.length || p.length) SNAP = { unit, buyers: b.rows, props: p, setupMissing: b.missing, at: Date.now() };
    })();
    return () => { dead = true; };
  }, [supabase, unit]);

  const patchBuyer = useCallback((id: string, patch: Partial<Buyer>) => {
    setBuyers(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)));
    if (SNAP) SNAP = { ...SNAP, buyers: SNAP.buyers.map(x => (x.id === id ? { ...x, ...patch } : x)) };
  }, []);
  const addBuyer = useCallback((row: Buyer) => {
    setBuyers(prev => (prev.some(x => x.id === row.id) ? prev : [row, ...prev]));
  }, []);
  return { buyers, props, loadingPeople, loadingProps, setupMissing, failed, patchBuyer, addBuyer };
}

// ── small pieces ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function Seg<T extends string>({ value, options, onChange, big }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; big: boolean }) {
  return (
    <div role="group" style={{ display: 'inline-flex', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button key={o.v || 'any'} onClick={() => onChange(o.v)} aria-pressed={value === o.v}
          style={{ padding: big ? '0 16px' : '0 14px', minHeight: big ? 40 : 30, borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
            background: value === o.v ? 'var(--k-fff)' : 'transparent', color: value === o.v ? 'var(--k-111)' : 'var(--k-6b7280)', boxShadow: value === o.v ? '0 1px 4px rgba(0,0,0,.1)' : 'none' }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, disabled, onChange, children, big }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; children: React.ReactNode; big: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minHeight: big ? 44 : 34, padding: '0 14px 0 10px', borderRadius: 20, cursor: disabled ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, opacity: disabled && !on ? .55 : 1,
        border: `1px solid ${on ? '#c9922c' : 'var(--k-e5e7eb)'}`, background: on ? 'var(--k-fdf6e8)' : 'var(--k-fff)', color: on ? 'var(--k-a8741a)' : 'var(--k-374151)' }}>
      <span aria-hidden style={{ width: 28, height: 16, borderRadius: 10, background: on ? '#c9922c' : 'var(--k-d1d5db)', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
      </span>
      {children}
    </button>
  );
}

export default function MatchmakerSection({ businessUnit, onToast, currentUserId, authToken, isMobile = false, initialClientId }: {
  businessUnit: string; onToast: (m: string) => void; currentUserId?: string; authToken?: string; isMobile?: boolean;
  /** Open on this tenant (a link from a Matchmaker alert email). */
  initialClientId?: string;
}) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const { buyers, props, loadingPeople, loadingProps, setupMissing, failed, patchBuyer, addBuyer } = useMatchmakerData(supabase, businessUnit);
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Buyer | null>(null);
  const [busy, setBusy] = useState(false);
  const [called, setCalled] = useState<Set<string>>(new Set());
  const { shortlist, toggleStar } = usePropertyShortlist(authToken, onToast);
  // Who the people list shows. The book is mostly investor LLCs; tenants are what agents usually match, so that is where it opens.
  const [who, setWho] = useState<'' | 'Tenant' | 'Buyer' | 'Landlord/Investor' | 'criteria'>('Tenant');
  // The search being worked on. Lease or sale is part of it (and saved with the tenant): most tenants want a rate, most buyers a price.
  const [req, setReq] = useState<Req>(EMPTY_REQ);
  const [formOpen, setFormOpen] = useState(true);   // open while there is nothing to search with; folds into a one-line summary once there is
  const [peopleOpen, setPeopleOpen] = useState(false);   // phones: the people list is a sheet
  const [areaDraft, setAreaDraft] = useState('');
  const [areaFocus, setAreaFocus] = useState(false);
  // What was marked "not a fit" for the selected tenant, and what has already been emailed (the server's log).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [emailed, setEmailed] = useState<Record<string, { at: string; to: string | null }>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [mail, setMail] = useState<null | 'agent' | 'client'>(null);
  const [more, setMore] = useState<Record<Fit, number>>({ strong: GROUP_STEP, good: GROUP_STEP, possible: GROUP_STEP });
  const [possibleOpen, setPossibleOpen] = useState(false);
  const autoOpened = useRef(false);
  const sizeRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLInputElement>(null);
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

  // Where the properties are: each submarket and city with how many listings it has (the most common ones become one-tap choices).
  const areaCounts = useMemo(() => {
    const exact = new Map<string, number>();
    for (const p of props) for (const a of new Set([p.submarket, p.city].filter(Boolean) as string[])) exact.set(a, (exact.get(a) ?? 0) + 1);
    // "San Antonio" and "SAN ANTONIO" are the same place: one entry, spelled the way most listings spell it, with both counted
    const byLower = new Map<string, { name: string; best: number; n: number }>();
    for (const [a, n] of exact) {
      const cur = byLower.get(a.toLowerCase());
      if (!cur) byLower.set(a.toLowerCase(), { name: a, best: n, n });
      else { cur.n += n; if (n > cur.best) { cur.name = a; cur.best = n; } }
    }
    return new Map([...byLower.values()].map(v => [v.name, v.n] as const));
  }, [props]);
  const allAreas = useMemo(() => [...areaCounts.keys()].sort(), [areaCounts]);
  const popularAreas = useMemo(() => [...areaCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k), [areaCounts]);
  const areaSuggestions = useMemo(() => {
    const q = areaDraft.trim().toLowerCase();
    if (!q) return [];
    return allAreas.filter(a => !req.submarkets.some(s => s.toLowerCase() === a.toLowerCase()) && a.toLowerCase().includes(q))
      .sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)) || (areaCounts.get(b) ?? 0) - (areaCounts.get(a) ?? 0)).slice(0, 7);
  }, [areaDraft, allAreas, areaCounts, req.submarkets]);

  const clearReq = () => { setReq(r => ({ ...EMPTY_REQ, active: r.active, autoMatch: r.autoMatch })); setFormOpen(true); };

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
    setSel(b); setCalled(new Set()); setPeopleOpen(false);
    setReq(reqFrom(b));
    setFormOpen(!hasNeed(criteriaFromRow(b)));   // a saved search opens as a summary with the matches right under it
    setMore({ strong: GROUP_STEP, good: GROUP_STEP, possible: GROUP_STEP }); setPossibleOpen(false);
    void loadState(b.id);
  }
  // A link from an alert email opens straight on that tenant.
  useEffect(() => {
    if (!initialClientId || autoOpened.current || loadingPeople) return;
    autoOpened.current = true;
    const b = buyers.find(x => x.id === initialClientId);
    if (b) { setWho(''); pick(b); return; }
    // not one of the buyer / tenant / investor types the list shows (a tenant-rep client saved by the Copilot, say): open it anyway
    void (async () => {
      const { data } = await supabase.from('crm_clients').select(BUYER_COLS + (setupMissing ? '' : BUYER_COLS_NEW)).eq('id', initialClientId).maybeSingle();
      if (!data) return;
      const row = data as unknown as Buyer;
      addBuyer(row);
      setWho(''); pick(row);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId, buyers, loadingPeople]);

  async function saveReq(quiet = false): Promise<boolean> {
    if (!sel) return false;
    if (req.autoMatch && !hasNeed(crit(req))) { onToast('Add what they are looking for first — there is nothing to match yet'); return false; }
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
    if (error) { onToast('Could not save the search'); return false; }
    patchBuyer(sel.id, patch as Partial<Buyer>);
    setSel(s => s ? { ...s, ...patch } as Buyer : s);
    if (!setupMissing && (req.active || req.autoMatch)) setReq(r => ({ ...r, active: true }));
    if (!quiet) onToast(req.autoMatch ? 'Saved ✓ — you’ll get an email each morning when something new fits' : 'Search saved ✓');
    return true;
  }

  const need = useMemo(() => crit(req), [req]);
  const hasCriteria = hasNeed(need);
  // Saved criteria drive the emails and the daily alert, so what is on screen is saved first when you email.
  const critDirty = !!sel && JSON.stringify(need) !== JSON.stringify(criteriaFromRow(sel));
  // the two switches save with the criteria, so flipping one leaves something to save too
  const flagsDirty = !!sel && !setupMissing && ((req.active || req.autoMatch) !== !!sel.req_active || req.autoMatch !== !!sel.req_auto_match);
  const anyDirty = critDirty || flagsDirty;
  const summary = useMemo(() => describeCriteria(need).split(' · ').filter(Boolean), [need]);

  const results = useMemo(() => (hasCriteria ? matchProperties(need, props) : []), [need, props, hasCriteria]);
  const visible = useMemo(() => results.filter(r => !dismissed.has(r.property.id)), [results, dismissed]);
  const hiddenCount = results.length - visible.length;
  const shown = showHidden ? results : visible;
  const byFit = useMemo(() => ({
    strong: shown.filter(r => r.fit === 'strong'), good: shown.filter(r => r.fit === 'good'), possible: shown.filter(r => r.fit === 'possible'),
  }), [shown]);
  const strongCt = visible.filter(r => r.fit === 'strong').length;
  const goodCt = visible.filter(r => r.fit === 'good').length;
  const thin = hasCriteria && visible.length > 40 && !need.sizeMin && !need.sizeMax && need.areas.length === 0;   // too loose to be useful

  const peopleMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return buyers
      .filter(b => (!who || (who === 'criteria' ? hasSaved(b) : b.type === who))
        && (!q || `${b.first_name ?? ''} ${b.last_name ?? ''} ${b.business_name ?? ''}`.toLowerCase().includes(q)))
      .sort((a, b) => tier(a) - tier(b));   // stable: the name order from the load is kept inside each group
  }, [buyers, search, who]);
  const whoCounts = useMemo(() => ({
    all: buyers.length,
    Tenant: buyers.filter(b => b.type === 'Tenant').length,
    Buyer: buyers.filter(b => b.type === 'Buyer').length,
    'Landlord/Investor': buyers.filter(b => b.type === 'Landlord/Investor').length,
    criteria: buyers.filter(hasSaved).length,
  }), [buyers]);

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

  // Emailing uses the saved search, so a changed search is saved first — one click instead of "save, then email".
  async function startMail(kind: 'agent' | 'client') {
    if (!sel) return;
    if (setupMissing) { onToast('Emailing needs the one-time database update first'); return; }
    if (!hasCriteria || visible.length === 0) { onToast('Nothing to email yet'); return; }
    if (critDirty) {
      if (!(await saveReq(true))) return;
      onToast(`Saved ${possessive(tenantFirst)} search`);
    }
    setMail(kind);
  }

  const addArea = (value?: string) => {
    const v = (value ?? areaDraft).trim();
    if (!v) return;
    setReq(r => (r.submarkets.some(a => a.toLowerCase() === v.toLowerCase()) ? r : { ...r, submarkets: [...r.submarkets, v] }));
    setAreaDraft('');
  };
  const openForm = (focus: 'size' | 'area') => {
    setFormOpen(true);
    setTimeout(() => (focus === 'size' ? sizeRef : areaRef).current?.focus(), 60);
  };

  const chip = (on: boolean): React.CSSProperties => ({
    padding: isMobile ? '0 13px' : '5px 11px', minHeight: isMobile ? 40 : undefined, borderRadius: 16, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5,
    border: `1px solid ${on ? '#c9922c' : 'var(--k-e5e7eb)'}`, background: on ? 'var(--k-fdf6e8)' : 'var(--k-fff)', color: on ? 'var(--k-a8741a)' : 'var(--k-6b7280)',
  });
  const inp: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: isMobile ? 16 : 14, minHeight: isMobile ? 44 : undefined, width: '100%', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" };
  const lbl: React.CSSProperties = { fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 6 };
  const ghost: React.CSSProperties = { minHeight: isMobile ? 44 : 32, padding: '0 14px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
  const card: React.CSSProperties = { background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 12, padding: isMobile ? 14 : 16 };
  const tenantFirst = sel ? (sel.first_name || buyerName(sel)) : '';

  // ── the people list (a rail on a desktop, a sheet on a phone) ──
  const peoplePicker = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search tenants and buyers"
        onKeyDown={e => { if (e.key === 'Enter' && peopleMatches[0]) pick(peopleMatches[0]); }}
        placeholder="🔍  Search by name…" style={{ ...inp, marginBottom: 10 }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {([['Tenant', 'Tenants', whoCounts.Tenant], ['Buyer', 'Buyers', whoCounts.Buyer], ['Landlord/Investor', 'Investors', whoCounts['Landlord/Investor']], ['criteria', 'Saved searches', whoCounts.criteria], ['', 'All', whoCounts.all]] as const).map(([k, label, n]) => (
          <button key={k || 'all'} onClick={() => setWho(k as typeof who)} aria-pressed={who === k} style={chip(who === k)}>
            {label} <span style={{ opacity: .6, fontWeight: 700 }}>{n.toLocaleString()}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', flex: 1, minHeight: 0, maxHeight: isMobile ? undefined : 'calc(100vh - 290px)' }}>
        {loadingPeople ? <Skeleton rows={7} label="Loading prospects" /> : peopleMatches.slice(0, PEOPLE_SHOWN).map(b => {
          const active = sel?.id === b.id;
          const line = hasSaved(b) ? describeCriteria(criteriaFromRow(b)) : '';
          return (
            <button key={b.id} onClick={() => pick(b)} aria-current={active}
              style={{ textAlign: 'left', padding: isMobile ? '11px 12px' : '8px 10px', borderRadius: 8, border: `1px solid ${active ? '#c9922c' : 'transparent'}`, background: active ? 'var(--k-fdf6e8)' : 'transparent', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", display: 'block', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{buyerName(b)}</span>
                {b.req_auto_match ? <span title="Daily email alert on" style={{ fontSize: 12 }}>📬</span> : b.req_active ? <span title="Marked as searching" style={{ fontSize: 10, color: '#16a34a' }}>●</span> : null}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.type}{line ? ` · ${line}` : ''}</div>
            </button>
          );
        })}
        {!loadingPeople && peopleMatches.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'var(--k-9ca3af)', textAlign: 'center' }}>No one matches that.</div>}
      </div>
      {!loadingPeople && peopleMatches.length > PEOPLE_SHOWN && (
        <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 8, textAlign: 'center' }}>
          Showing the first {PEOPLE_SHOWN} of {peopleMatches.length.toLocaleString()} — search or pick a type to narrow.
        </div>
      )}
    </div>
  );

  // ── one property ──
  const renderRow = (r: ReturnType<typeof matchProperties>[number]) => {
    const p = r.property;
    const isHidden = dismissed.has(p.id);
    const tel = p.listing_agent_phone ? p.listing_agent_phone.replace(/[^\d+]/g, '') : '';
    const sent = emailed[p.id];
    const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, borderRadius: 7, padding: isMobile ? '12px 14px' : '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' };
    return (
      <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: wideRows ? 'nowrap' : 'wrap', background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 10, padding: '10px 12px 10px 14px', opacity: isHidden ? .5 : 1 }}>
        <div style={{ flex: wideRows ? '1 1 0' : '1 1 100%', minWidth: 0 }}>
          <div title={propertyTitle(p)} style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>{propertyTitle(p)}</div>
          <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 2 }}>
            {p.address && displayName(p) ? `${displayName(p)} · ` : ''}{propertyLine(p)}
            <span style={{ marginLeft: 6, fontWeight: 600 }}>· {sourceLabel(p)}</span>
            {sent && <span title={`Emailed ${sent.to === 'client' ? 'to the tenant' : 'to you'} ${new Date(sent.at).toLocaleDateString()}`} style={{ marginLeft: 6, fontWeight: 600, color: 'var(--k-16a34a)' }}>✉ sent {sentWhen(sent.at)}</span>}
          </div>
          {r.reasons.length > 0 && (
            <div style={{ marginTop: 5, fontSize: 12, color: 'var(--k-374151)', lineHeight: 1.5 }}>
              {r.reasons.slice(0, 3).map(w => <div key={w}><span style={{ color: 'var(--k-16a34a)', fontWeight: 700 }}>✓</span> {w}</div>)}
            </div>
          )}
          {r.caveats.length > 0 && (
            <div style={{ marginTop: 3, fontSize: 11.5, color: '#9a6a00', lineHeight: 1.5 }}>
              {r.caveats.slice(0, 2).map(w => <div key={w}>• {w}</div>)}
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
          {p.listing_url && <a href={p.listing_url} target="_blank" rel="noopener noreferrer" style={{ ...btn, color: 'var(--k-6b7280)', textDecoration: 'none', border: '1px solid var(--k-e5e7eb)', fontWeight: 500 }}>View ↗</a>}
          {/* Queueing a showing call needs somebody to show it TO. */}
          {!sel
            ? null
            : called.has(p.id)
              ? <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--k-16a34a)', flexShrink: 0 }}>✓ Queued</span>
              : <button onClick={() => addCall(p)} style={{ ...btn, fontWeight: 700, color: '#fff', background: '#c9922c', border: 'none', flexShrink: 0 }}>＋ Call</button>}
          {sel && !setupMissing && (isHidden
            ? <button onClick={() => dismiss(p, false)} style={{ ...btn, color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)' }}>↩ Restore</button>
            : <button onClick={() => dismiss(p, true)} title={`Not a fit for ${tenantFirst} — hide it and keep it out of alerts`} aria-label="Not a fit" style={{ ...btn, color: 'var(--k-9ca3af)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)' }}>✕ Not a fit</button>)}
          <StarButton on={shortlist.has(p.id)} onToggle={() => toggleStar(p.id)} size={isMobile ? 44 : 34} />
        </div>
      </div>
    );
  };

  const GROUPS: { key: Fit; label: string; color: string }[] = [
    { key: 'strong', label: 'Strong fits', color: '#c9922c' },
    { key: 'good', label: 'Good fits', color: '#e0b95f' },
    { key: 'possible', label: 'Worth a look', color: 'var(--k-9ca3af)' },
  ];
  const nonEmptyGroups = GROUPS.filter(g => byFit[g.key].length > 0);
  const canEmailClient = !!sel?.email;

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: 'var(--k-111)', marginBottom: 4 }}>🎯 Matchmaker</h2>
        <p style={{ fontSize: 14, color: 'var(--k-6b7280)' }}>
          Pick a tenant or buyer, say what they need, and see what fits — then email them the best.{' '}
          <span style={{ color: 'var(--k-9ca3af)' }}>
            {loadingPeople && loadingProps ? 'Loading…' : loadingProps ? `${buyers.length.toLocaleString()} prospects · loading properties…` : `${buyers.length.toLocaleString()} prospects · ${props.length.toLocaleString()} properties`}
          </span>
        </p>
        {failed && <p style={{ fontSize: 13, color: '#9a6a00', marginTop: 4 }}>Part of the list did not load — reload the page to try again.</p>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '280px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        {!isMobile && (
          <aside style={{ ...card, padding: 12, position: 'sticky', top: 8, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 110px)' }}>{peoplePicker}</aside>
        )}

        <div style={{ minWidth: 0 }}>
          {isMobile && (
            <button onClick={() => setPeopleOpen(true)} aria-haspopup="dialog"
              style={{ ...card, width: '100%', marginBottom: 12, minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textAlign: 'left' }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700 }}>Searching for</span>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel ? buyerName(sel) : 'Pick a tenant or buyer'}</span>
              </span>
              <span style={{ color: 'var(--k-9ca3af)' }}>▾</span>
            </button>
          )}

          {/* The search: a one-line summary once there is one, the form while there is not. */}
          <div style={{ ...card, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: hasCriteria || formOpen ? 12 : 0, flexWrap: 'wrap' }}>
              {sel ? (
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--k-111)', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{buyerName(sel)}</span>
                  <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', fontWeight: 500, flexShrink: 0 }}>· {sel.type}</span>
                  <button onClick={() => { setSel(null); setDismissed(new Set()); setEmailed({}); }} title="Search without a buyer — keeps this search" aria-label="Search without a buyer"
                    style={{ background: 'none', border: 'none', color: '#c9b48a', cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0, minWidth: isMobile ? 36 : undefined, minHeight: isMobile ? 36 : undefined }}>✕</button>
                </div>
              ) : (
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--k-111)' }}>Quick search
                  <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', fontWeight: 500, marginLeft: 8 }}>· pick someone to save it to them</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                {sel && (anyDirty
                  ? <button onClick={() => saveReq()} disabled={busy} style={{ padding: '7px 14px', minHeight: isMobile ? 44 : 34, borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>{busy ? 'Saving…' : `Save to ${tenantFirst.length > 14 ? 'them' : tenantFirst}`}</button>
                  : hasCriteria && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--k-16a34a)' }}>✓ Saved</span>)}
                {hasCriteria && formOpen && <button onClick={clearReq} style={{ ...ghost, minHeight: isMobile ? 44 : 34, color: 'var(--k-6b7280)' }}>Clear</button>}
                {isMobile && hasCriteria && !formOpen && <button onClick={() => setFormOpen(true)} style={{ ...ghost, minHeight: 44 }}>Edit search</button>}
              </div>
            </div>

            {!formOpen && hasCriteria && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                  {summary.map(s => <span key={s} style={{ fontSize: 12.5, fontWeight: 600, padding: '4px 10px', borderRadius: 14, background: 'var(--k-fdf6e8)', color: 'var(--k-a8741a)', border: '1px solid #ecd9a8' }}>{s}</span>)}
                </div>
                {!isMobile && <button onClick={() => setFormOpen(true)} style={{ ...ghost, flexShrink: 0 }}>Edit search</button>}
              </div>
            )}

            {formOpen && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
                  <div>
                    <div style={lbl}>Looking to</div>
                    <Seg big={isMobile} value={req.dealType} onChange={v => setReq(r => ({ ...r, dealType: v }))} options={[{ v: '', label: 'Either' }, { v: 'lease', label: 'Lease' }, { v: 'sale', label: 'Buy' }]} />
                  </div>
                  <div>
                    <div style={lbl}>Size (SF)</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input ref={sizeRef} value={req.sizeMin} onChange={e => setReq(r => ({ ...r, sizeMin: e.target.value }))} placeholder="min" inputMode="numeric" style={inp} />
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

                <div style={lbl}>Asset types</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  {req.assetTypes.filter(t => !ASSET_TYPES.includes(t)).map(t => <button key={t} onClick={() => setReq(r => ({ ...r, assetTypes: r.assetTypes.filter(x => x !== t) }))} style={chip(true)} title="Click to remove">{t} ✕</button>)}
                  {ASSET_TYPES.map(t => {
                    const on = req.assetTypes.includes(t);
                    return <button key={t} onClick={() => setReq(r => ({ ...r, assetTypes: on ? r.assetTypes.filter(x => x !== t) : [...r.assetTypes, t] }))} aria-pressed={on} style={chip(on)}>{t}</button>;
                  })}
                </div>

                <div style={lbl}>Where <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· a city, neighborhood or ZIP — leave blank for everywhere</span></div>
                {req.submarkets.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {req.submarkets.map(m => <button key={m} onClick={() => setReq(r => ({ ...r, submarkets: r.submarkets.filter(x => x !== m) }))} style={chip(true)} title="Click to remove">{m} ✕</button>)}
                  </div>
                )}
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input ref={areaRef} value={areaDraft} onChange={e => setAreaDraft(e.target.value)} onFocus={() => setAreaFocus(true)} onBlur={() => setTimeout(() => setAreaFocus(false), 150)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addArea(areaSuggestions[0] ?? undefined); } }}
                      placeholder="Start typing — Boerne, 78006, Stone Oak…" aria-label="Add an area" autoComplete="off" style={inp} />
                    <button onClick={() => addArea()} style={{ ...ghost, flexShrink: 0 }}>Add</button>
                  </div>
                  {areaFocus && areaDraft.trim() && (
                    <div style={{ position: 'absolute', left: 0, right: isMobile ? 60 : 56, top: '100%', marginTop: 4, zIndex: 20, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.14)', overflow: 'hidden' }}>
                      {areaSuggestions.map(a => (
                        <button key={a} onMouseDown={e => e.preventDefault()} onClick={() => { addArea(a); areaRef.current?.focus(); }}
                          style={{ display: 'flex', justifyContent: 'space-between', width: '100%', textAlign: 'left', padding: isMobile ? '12px 14px' : '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13.5, color: 'var(--k-111)', fontFamily: "'DM Sans',sans-serif" }}>
                          <span>{a}</span><span style={{ color: 'var(--k-9ca3af)', fontSize: 12 }}>{areaCounts.get(a)} listing{areaCounts.get(a) === 1 ? '' : 's'}</span>
                        </button>
                      ))}
                      {!allAreas.some(a => a.toLowerCase() === areaDraft.trim().toLowerCase()) && (
                        <button onMouseDown={e => e.preventDefault()} onClick={() => { addArea(); areaRef.current?.focus(); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: isMobile ? '12px 14px' : '8px 12px', border: 'none', borderTop: areaSuggestions.length ? '1px solid var(--k-f3f4f6)' : 'none', background: 'transparent', cursor: 'pointer', fontSize: 13.5, color: 'var(--k-a8741a)', fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>
                          ＋ Add “{areaDraft.trim()}”
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {req.submarkets.length === 0 && popularAreas.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>Most listings:</span>
                    {popularAreas.map(a => <button key={a} onClick={() => addArea(a)} style={chip(false)}>{a}</button>)}
                  </div>
                )}
                {(req.submarkets.length > 0 || popularAreas.length === 0) && <div style={{ marginBottom: 6 }} />}

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 12 }}>
                  <div>
                    <div style={lbl}>Needs (comma-separated)</div>
                    <input value={req.mustHaves} onChange={e => setReq(r => ({ ...r, mustHaves: e.target.value }))} placeholder="drive-thru, 24' clear, corner, medical build-out…" style={inp} />
                  </div>
                  <div>
                    <div style={lbl}>Move in by</div>
                    <input type="date" value={req.moveInBy} onChange={e => setReq(r => ({ ...r, moveInBy: e.target.value }))} style={inp} />
                  </div>
                </div>
                {hasCriteria && (
                  <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => setFormOpen(false)} style={{ ...ghost, minHeight: isMobile ? 44 : 34 }}>Done</button>
                  </div>
                )}
              </div>
            )}

            {sel && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--k-eef0f2)' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Switch big={isMobile} on={req.active || req.autoMatch} disabled={setupMissing || req.autoMatch} onChange={v => setReq(r => ({ ...r, active: v }))}>Actively searching</Switch>
                  <Switch big={isMobile} on={req.autoMatch} disabled={setupMissing} onChange={v => setReq(r => ({ ...r, autoMatch: v }))}>📬 Email me new matches</Switch>
                </div>
                <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 8, lineHeight: 1.5 }}>
                  {req.autoMatch
                    ? <>One email each morning, only when something <i>new</i> fits {possessive(tenantFirst)} search. It goes to you, never to {tenantFirst}.</>
                    : <>Turn on the email alert and you hear about new matches the morning they appear — it goes to you, never to {tenantFirst}.</>}
                  {setupMissing && ' Saving the budget, timing, needs and alert starts after a one-time database update (ask an admin).'}
                </div>
              </div>
            )}
          </div>

          {/* Matches */}
          <div ref={listRef}>
            {hasCriteria ? (
              <>
                <div style={{ position: isMobile ? 'static' : 'sticky', top: 0, zIndex: 6, background: 'var(--c-canvas)', padding: isMobile ? '0 0 10px' : '8px 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, color: 'var(--k-374151)', fontWeight: 600 }}>
                    {loadingProps && props.length === 0 ? 'Searching…' : (
                      <>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-111)' }}>{visible.length.toLocaleString()}</span> match{visible.length === 1 ? '' : 'es'}
                        {(strongCt > 0 || goodCt > 0) && <span style={{ color: 'var(--k-9ca3af)', fontWeight: 500 }}> · {strongCt > 0 ? `${strongCt} strong` : ''}{strongCt > 0 && goodCt > 0 ? ' · ' : ''}{goodCt > 0 ? `${goodCt} good` : ''}</span>}
                      </>
                    )}
                  </div>
                  {visible.length > 0 && (
                    <div style={isMobile ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' } : { display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={async () => {
                        const list = visible.slice(0, 25).map(r => r.property) as unknown as FilterableProperty[];
                        let ok = false;
                        try { await navigator.clipboard.writeText(summarizeProperties(list)); ok = true; } catch { /* blocked */ }
                        onToast(ok ? `Copied ${list.length} — paste into an email or text` : 'Could not copy');
                      }} style={ghost}>📋 Copy top {Math.min(25, visible.length)}</button>
                      {sel && <button onClick={() => startMail('agent')} disabled={busy} style={{ ...ghost, opacity: setupMissing ? .55 : 1 }}>✉️ Email me these</button>}
                      {sel && canEmailClient && <button onClick={() => startMail('client')} disabled={busy} style={{ ...ghost, background: '#c9922c', borderColor: '#c9922c', color: '#fff', fontWeight: 700, opacity: setupMissing ? .55 : 1, ...(isMobile ? { gridColumn: '1 / -1' } : {}) }}>✉️ Email to {tenantFirst}</button>}
                    </div>
                  )}
                </div>

                {thin && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', background: 'var(--k-fdf6e8)', border: '1px solid #ecd9a8', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, color: 'var(--k-a8741a)', fontWeight: 600 }}>{visible.length.toLocaleString()} properties fit — that is too many to be useful. Add a size or an area to narrow it.</span>
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => openForm('size')} style={ghost}>＋ Size</button>
                      <button onClick={() => openForm('area')} style={ghost}>＋ Area</button>
                    </span>
                  </div>
                )}
                {sel && hiddenCount > 0 && (
                  <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', margin: '0 0 10px' }}>
                    {hiddenCount} marked “not a fit” for {tenantFirst} {showHidden ? 'shown below, dimmed' : 'hidden'} · <button onClick={() => setShowHidden(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--k-a8741a)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12.5, fontFamily: "'DM Sans',sans-serif" }}>{showHidden ? 'hide them' : 'show them'}</button>
                  </div>
                )}

                {loadingProps && props.length === 0 && <Skeleton rows={5} label="Loading properties" pad={8} />}

                {nonEmptyGroups.map(g => {
                  const rows = byFit[g.key];
                  const only = nonEmptyGroups.length === 1;
                  const foldable = g.key === 'possible' && !only;   // "Worth a look" stays folded while there are better matches to read
                  const open = !foldable || possibleOpen;
                  return (
                    <section key={g.key} style={{ marginBottom: 14 }}>
                      <div role={foldable ? 'button' : undefined} tabIndex={foldable ? 0 : undefined} aria-expanded={foldable ? open : undefined}
                        onClick={foldable ? () => setPossibleOpen(o => !o) : undefined}
                        onKeyDown={foldable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPossibleOpen(o => !o); } } : undefined}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMobile && foldable ? '10px 2px' : '2px 2px 8px', cursor: foldable ? 'pointer' : 'default', minHeight: isMobile && foldable ? 44 : undefined }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12.5, letterSpacing: .6, textTransform: 'uppercase', fontWeight: 700, color: 'var(--k-374151)' }}>{g.label}</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--k-6b7280)', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: '1px 8px' }}>{rows.length.toLocaleString()}</span>
                        {foldable && <span style={{ fontSize: 12, color: 'var(--k-a8741a)', fontWeight: 600 }}>{open ? 'Hide' : 'Show'}</span>}
                      </div>
                      {open && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {rows.slice(0, more[g.key]).map(renderRow)}
                          {rows.length > more[g.key] && (
                            <button onClick={() => setMore(m => ({ ...m, [g.key]: m[g.key] + 2 * GROUP_STEP }))} style={{ ...ghost, width: '100%', minHeight: isMobile ? 48 : 38, color: 'var(--k-a8741a)', fontWeight: 700 }}>
                              Show {Math.min(2 * GROUP_STEP, rows.length - more[g.key])} more · {(rows.length - more[g.key]).toLocaleString()} left
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}

                {!loadingProps && visible.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--k-9ca3af)', fontSize: 13, background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 10 }}>No available properties fit this search yet.{hiddenCount ? ' (Some were marked not a fit.)' : ''}</div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: isMobile ? 32 : 50, color: 'var(--k-9ca3af)', background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 12 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{sel ? `Tell the Matchmaker what ${tenantFirst} needs` : props.length ? `Pick an asset type or a size to search ${props.length.toLocaleString()} properties` : 'Pick an asset type or a size to search'}</div>
                <div style={{ fontSize: 13, marginTop: 5 }}>{sel ? 'Choose a property type or a size above — the best fits show up right here, and you can email them.' : isMobile ? 'Or tap “Pick a tenant or buyer” to load the search you saved for them.' : 'Or choose someone on the left to load the search you saved for them.'}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isMobile && peopleOpen && (
        <div className="crm-sheet" onClick={e => { if (e.target === e.currentTarget) setPeopleOpen(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div className="crm-sheet-panel" role="dialog" aria-label="Pick a tenant or buyer"
            style={{ background: 'var(--k-fff)', borderRadius: '18px 18px 0 0', width: '100%', maxHeight: '88dvh', display: 'flex', flexDirection: 'column', padding: 14, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--k-111)' }}>Pick a tenant or buyer</span>
              <button onClick={() => setPeopleOpen(false)} aria-label="Close" style={{ width: 44, height: 44, border: 'none', borderRadius: 8, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            {peoplePicker}
          </div>
        </div>
      )}

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
