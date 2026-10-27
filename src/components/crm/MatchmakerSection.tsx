'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { usePropertyShortlist } from '@/lib/use-property-shortlist';
import { summarizeProperties, type FilterableProperty } from '@/lib/property-filters';
import StarButton from '@/components/crm/StarButton';

const SHOW = 60;   // rendered at once; the heading always reports the true total
const ASSET_TYPES = ['Retail', 'Office', 'Industrial', 'Flex', 'Land', 'Medical', 'Mixed-Use'];

interface Buyer {
  id: string; first_name: string | null; last_name: string | null; business_name: string | null;
  type: string | null; agent_id: string | null; phone: string | null; email: string | null;
  asset_types: string[] | null;
  req_size_min: number | null; req_size_max: number | null;
  req_price_min: number | null; req_price_max: number | null;
  req_submarkets: string[] | null;
}
interface Prop {
  id: string; name: string | null; address: string | null; city: string | null; submarket: string | null;
  asset_type: string | null; size_sf: number | null; sale_price: number | null; asking_rate: string | number | null;
  transaction_status: string | null; listing_url: string | null; listing_agent_name: string | null; listing_agent_phone: string | null;
  listing_type: string | null;
}

const num = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, '')); return v.trim() === '' ? null : (Number.isFinite(n) ? n : null); };
const fmt$ = (n?: number | null) => (n && n > 0 ? '$' + Number(n).toLocaleString() : '');
const fmtSf = (n?: number | null) => (n ? Number(n).toLocaleString() + ' SF' : '');

export default function MatchmakerSection({ businessUnit, onToast, currentUserId, authToken, isMobile = false }: {
  businessUnit: string; onToast: (m: string) => void; currentUserId?: string; authToken?: string; isMobile?: boolean;
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
  // Lease or sale: most tenants want a rate, most buyers a price, and the two never mix.
  const [listing, setListing] = useState<'' | 'lease' | 'sale'>('');
  // Who the left-hand list shows. The list is mostly investor LLCs; tenants are what you usually match.
  const [who, setWho] = useState<'' | 'Tenant' | 'Buyer' | 'Landlord/Investor' | 'criteria'>('');
  // editable requirements for the selected buyer
  const [req, setReq] = useState({ assetTypes: [] as string[], sizeMin: '', sizeMax: '', priceMin: '', priceMax: '', submarkets: [] as string[] });

  const load = useCallback(async () => {
    setLoading(true);
    const PAGE = 1000;   // PostgREST's hard ceiling per response, whatever .range() asks
    const allProps: Prop[] = [];
    // Pages of 1000, in a stable order (id). One un-paged query silently stopped at 1,000 of the ~2,400
    // buyers / tenants / investors, sorted by first name — so most tenants (business names sort last) never appeared.
    const allBuyers: Buyer[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase.from('crm_clients')
        .select('id,first_name,last_name,business_name,type,agent_id,phone,email,asset_types,req_size_min,req_size_max,req_price_min,req_price_max,req_submarkets')
        .eq('business_unit', businessUnit).in('type', ['Buyer', 'Tenant', 'Landlord/Investor']).order('id').range(from, from + PAGE - 1);
      allBuyers.push(...((data ?? []) as Buyer[]));
      if (!data || data.length < PAGE) break;
    }
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase.from('crm_prospective_properties')
        .select('id,name,address,city,submarket,asset_type,size_sf,sale_price,asking_rate,transaction_status,listing_url,listing_agent_name,listing_agent_phone,listing_type')
        .eq('business_unit', businessUnit).order('id').range(from, from + PAGE - 1);
      allProps.push(...((data ?? []) as Prop[]));
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

  const clearReq = () => { setReq({ assetTypes: [], sizeMin: '', sizeMax: '', priceMin: '', priceMax: '', submarkets: [] }); setListing(''); };

  function pick(b: Buyer) {
    setSel(b); setCalled(new Set());
    setReq({
      assetTypes: b.asset_types ?? [],
      sizeMin: b.req_size_min != null ? String(b.req_size_min) : '',
      sizeMax: b.req_size_max != null ? String(b.req_size_max) : '',
      priceMin: b.req_price_min != null ? String(b.req_price_min) : '',
      priceMax: b.req_price_max != null ? String(b.req_price_max) : '',
      submarkets: b.req_submarkets ?? [],
    });
  }

  async function saveReq() {
    if (!sel) return;
    setBusy(true);
    const patch = {
      asset_types: req.assetTypes,
      req_size_min: num(req.sizeMin), req_size_max: num(req.sizeMax),
      req_price_min: num(req.priceMin), req_price_max: num(req.priceMax),
      req_submarkets: req.submarkets,
    };
    const { error } = await supabase.from('crm_clients').update(patch).eq('id', sel.id);
    setBusy(false);
    if (error) { onToast('Could not save criteria'); return; }
    setBuyers(prev => prev.map(x => x.id === sel.id ? { ...x, ...patch } : x));
    setSel(s => s ? { ...s, ...patch } : s);
    onToast('Criteria saved ✓');
  }

  const hasCriteria = req.assetTypes.length > 0 || req.sizeMin || req.sizeMax || req.priceMin || req.priceMax || req.submarkets.length > 0 || listing !== '';

  const matches = useMemo(() => {
    if (!hasCriteria) return [];
    const sMin = num(req.sizeMin), sMax = num(req.sizeMax), pMin = num(req.priceMin), pMax = num(req.priceMax);
    const rows = props.filter(p => {
      if (p.transaction_status && !['Available', 'available', ''].includes(p.transaction_status)) return false;
      if (listing) {
        const lt = (p.listing_type || '').toLowerCase();
        if (lt && !(lt.includes(listing) || lt.includes('both'))) return false;
      }
      if (req.assetTypes.length && p.asset_type && !req.assetTypes.includes(p.asset_type)) return false;
      if (sMin != null && p.size_sf != null && p.size_sf < sMin) return false;
      if (sMax != null && p.size_sf != null && p.size_sf > sMax) return false;
      if (pMin != null && p.sale_price != null && p.sale_price < pMin) return false;
      if (pMax != null && p.sale_price != null && p.sale_price > pMax) return false;
      if (req.submarkets.length && !(req.submarkets.includes(p.submarket ?? '') || req.submarkets.includes(p.city ?? ''))) return false;
      return true;
    });
    // rank: properties with the most concrete data matched first, then by price
    const score = (p: Prop) => (p.asset_type ? 1 : 0) + (p.size_sf ? 1 : 0) + (p.sale_price ? 1 : 0);
    return rows.sort((a, b) => score(b) - score(a) || (a.sale_price ?? 9e15) - (b.sale_price ?? 9e15));
  }, [props, req, hasCriteria, listing]);

  const buyerName = (b: Buyer) => [b.first_name, b.last_name].filter(Boolean).join(' ') || b.business_name || 'Contact';

  const hasSaved = (b: Buyer) => !!(b.asset_types?.length || b.req_size_min || b.req_size_max || b.req_price_min || b.req_price_max || b.req_submarkets?.length);
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
    const title = `🎯 Show ${p.name || p.address || 'property'} to ${buyerName(sel)}`;
    const notes = [
      [p.asset_type, fmtSf(p.size_sf), fmt$(p.sale_price)].filter(Boolean).join(' · '),
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

  const chip = (on: boolean): React.CSSProperties => ({
    padding: '5px 11px', borderRadius: 16, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
    border: `1px solid ${on ? '#c9922c' : 'var(--k-e5e7eb)'}`, background: on ? 'var(--k-fdf6e8)' : 'var(--k-fff)', color: on ? 'var(--k-a8741a)' : 'var(--k-6b7280)',
  });
  const inp: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" };

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: 'var(--k-111)', marginBottom: 4 }}>🎯 Matchmaker</h2>
        <p style={{ fontSize: 14, color: 'var(--k-6b7280)' }}>Set a buyer/tenant’s criteria → see fitting properties from your database. {loading ? 'Loading…' : `${buyers.length} prospects · ${props.length} properties`}</p>
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
                  <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{b.type}{(b.asset_types?.length || b.req_price_max) ? ' · has criteria' : ''}</div>
                </button>
              );
            })}
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
                  <button onClick={() => setSel(null)} title="Search without a buyer — keeps these criteria"
                    style={{ background: 'none', border: 'none', color: '#c9b48a', cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0 }}>✕</button>
                </div>
              ) : (
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--k-111)' }}>Property search
                  <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', fontWeight: 500, marginLeft: 8 }}>· pick a buyer on the left to save these to them</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {hasCriteria && <button onClick={clearReq} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Clear</button>}
                {sel && <button onClick={saveReq} disabled={busy} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save to ' + buyerName(sel).split(' ')[0]}</button>}
              </div>
            </div>
            <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 8 }}>Looking to</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              <button onClick={() => setListing(l => (l === 'lease' ? '' : 'lease'))} aria-pressed={listing === 'lease'} style={chip(listing === 'lease')}>Lease</button>
              <button onClick={() => setListing(l => (l === 'sale' ? '' : 'sale'))} aria-pressed={listing === 'sale'} style={chip(listing === 'sale')}>Buy</button>
            </div>
            <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 8 }}>Asset types</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {ASSET_TYPES.map(t => {
                const on = req.assetTypes.includes(t);
                return <button key={t} onClick={() => setReq(r => ({ ...r, assetTypes: on ? r.assetTypes.filter(x => x !== t) : [...r.assetTypes, t] }))} style={chip(on)}>{t}</button>;
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 6 }}>Size (SF)</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={req.sizeMin} onChange={e => setReq(r => ({ ...r, sizeMin: e.target.value }))} placeholder="min" style={inp} />
                  <span style={{ color: 'var(--k-9ca3af)' }}>–</span>
                  <input value={req.sizeMax} onChange={e => setReq(r => ({ ...r, sizeMax: e.target.value }))} placeholder="max" style={inp} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 6 }}>Sale price ($)</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={req.priceMin} onChange={e => setReq(r => ({ ...r, priceMin: e.target.value }))} placeholder="min" style={inp} />
                  <span style={{ color: 'var(--k-9ca3af)' }}>–</span>
                  <input value={req.priceMax} onChange={e => setReq(r => ({ ...r, priceMax: e.target.value }))} placeholder="max" style={inp} />
                </div>
              </div>
            </div>
            {submarkets.length > 0 && (
              <>
                <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 8 }}>Submarkets</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 96, overflowY: 'auto' }}>
                  {submarkets.map(m => {
                    const on = req.submarkets.includes(m);
                    return <button key={m} onClick={() => setReq(r => ({ ...r, submarkets: on ? r.submarkets.filter(x => x !== m) : [...r.submarkets, m] }))} style={chip(on)}>{m}</button>;
                  })}
                </div>
              </>
            )}
          </div>

          {/* Matches */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700 }}>
              {hasCriteria
                ? `${matches.length.toLocaleString()} matching propert${matches.length === 1 ? 'y' : 'ies'}${matches.length > SHOW ? ` · showing the first ${SHOW}` : ''}`
                : 'Set criteria above to search'}
            </div>
            {hasCriteria && matches.length > 0 && (
              <button onClick={async () => {
                const list = matches.slice(0, 25) as unknown as FilterableProperty[];
                let ok = false;
                try { await navigator.clipboard.writeText(summarizeProperties(list)); ok = true; } catch { /* blocked */ }
                onToast(ok ? `Copied ${list.length} — paste into an email or text` : 'Could not copy');
              }} style={{ minHeight: isMobile ? 44 : 32, padding: '0 14px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                📋 Copy top {Math.min(25, matches.length)}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matches.slice(0, SHOW).map(p => {
              const rate = p.sale_price ? fmt$(p.sale_price) : (p.asking_rate != null && p.asking_rate !== '' ? (typeof p.asking_rate === 'number' ? `$${p.asking_rate}` : String(p.asking_rate)) : '');
              const tel = p.listing_agent_phone ? p.listing_agent_phone.replace(/[^\d+]/g, '') : '';
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: isMobile ? 'wrap' : 'nowrap', background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 10, padding: '11px 12px 11px 14px' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isMobile ? 'normal' : 'nowrap' }}>{p.name || p.address || 'Property'}</div>
                    <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 2 }}>{[p.asset_type, fmtSf(p.size_sf), rate, p.submarket || p.city].filter(Boolean).join(' · ')}</div>
                    {(p.listing_agent_name || tel) && (
                      <div style={{ fontSize: 12, color: 'var(--k-6b7280)', marginTop: 2 }}>
                        {p.listing_agent_name}{p.listing_agent_name && tel ? ' · ' : ''}
                        {tel && <a href={`tel:${tel}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--k-a06a12)', fontWeight: 600, textDecoration: 'none' }}>📞 {p.listing_agent_phone}</a>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {p.listing_url && <a href={p.listing_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: 'var(--k-6b7280)', textDecoration: 'none', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, padding: isMobile ? '12px 10px' : '5px 9px', flexShrink: 0 }}>View ↗</a>}
                    {/* Queueing a showing call needs somebody to show it TO. */}
                    {!sel
                      ? null
                      : called.has(p.id)
                        ? <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--k-16a34a)', flexShrink: 0 }}>✓ Queued</span>
                        : <button onClick={() => addCall(p)} style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: '#c9922c', border: 'none', borderRadius: 7, padding: isMobile ? '12px 14px' : '6px 12px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>＋ Call</button>}
                    <StarButton on={shortlist.has(p.id)} onToggle={() => toggleStar(p.id)} size={isMobile ? 44 : 34} />
                  </div>
                </div>
              );
            })}
            {hasCriteria && matches.length === 0 && (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--k-9ca3af)', fontSize: 13, background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 10 }}>No available properties fit these criteria yet.</div>
            )}
            {!hasCriteria && (
              <div style={{ textAlign: 'center', padding: 50, color: 'var(--k-9ca3af)', background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 12 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Pick an asset type or a size to search {props.length.toLocaleString()} properties</div>
                <div style={{ fontSize: 13, marginTop: 5 }}>Or choose a buyer on the left to load the criteria you saved for them.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
