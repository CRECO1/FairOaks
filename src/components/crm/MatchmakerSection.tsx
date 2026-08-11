'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient as createBrowserClient } from '@/lib/supabase/client';

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
}

const num = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, '')); return v.trim() === '' ? null : (Number.isFinite(n) ? n : null); };
const fmt$ = (n?: number | null) => (n && n > 0 ? '$' + Number(n).toLocaleString() : '');
const fmtSf = (n?: number | null) => (n ? Number(n).toLocaleString() + ' SF' : '');

export default function MatchmakerSection({ businessUnit, onToast, currentUserId }: {
  businessUnit: string; onToast: (m: string) => void; currentUserId?: string;
}) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [props, setProps] = useState<Prop[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Buyer | null>(null);
  const [busy, setBusy] = useState(false);
  const [called, setCalled] = useState<Set<string>>(new Set());
  // editable requirements for the selected buyer
  const [req, setReq] = useState({ assetTypes: [] as string[], sizeMin: '', sizeMax: '', priceMin: '', priceMax: '', submarkets: [] as string[] });

  const load = useCallback(async () => {
    setLoading(true);
    const [b, p] = await Promise.all([
      supabase.from('crm_clients')
        .select('id,first_name,last_name,business_name,type,agent_id,phone,email,asset_types,req_size_min,req_size_max,req_price_min,req_price_max,req_submarkets')
        .eq('business_unit', businessUnit).in('type', ['Buyer', 'Tenant', 'Landlord/Investor']).order('first_name'),
      supabase.from('crm_prospective_properties')
        .select('id,name,address,city,submarket,asset_type,size_sf,sale_price,asking_rate,transaction_status,listing_url,listing_agent_name,listing_agent_phone')
        .eq('business_unit', businessUnit).range(0, 4999),
    ]);
    setBuyers((b.data ?? []) as Buyer[]);
    setProps((p.data ?? []) as Prop[]);
    setLoading(false);
  }, [supabase, businessUnit]);
  useEffect(() => { load(); }, [load]);

  const submarkets = useMemo(
    () => Array.from(new Set(props.map(p => p.submarket).filter(Boolean) as string[])).sort().slice(0, 40),
    [props]);

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

  const hasCriteria = req.assetTypes.length > 0 || req.sizeMin || req.sizeMax || req.priceMin || req.priceMax || req.submarkets.length > 0;

  const matches = useMemo(() => {
    if (!sel || !hasCriteria) return [];
    const sMin = num(req.sizeMin), sMax = num(req.sizeMax), pMin = num(req.priceMin), pMax = num(req.priceMax);
    const rows = props.filter(p => {
      if (p.transaction_status && !['Available', 'available', ''].includes(p.transaction_status)) return false;
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
    return rows.sort((a, b) => score(b) - score(a) || (a.sale_price ?? 9e15) - (b.sale_price ?? 9e15)).slice(0, 60);
  }, [sel, props, req, hasCriteria]);

  const buyerName = (b: Buyer) => [b.first_name, b.last_name].filter(Boolean).join(' ') || b.business_name || 'Contact';

  const filteredBuyers = useMemo(() => {
    const q = search.toLowerCase();
    return buyers.filter(b => !q || `${b.first_name ?? ''} ${b.last_name ?? ''} ${b.business_name ?? ''}`.toLowerCase().includes(q)).slice(0, 200);
  }, [buyers, search]);

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
    border: `1px solid ${on ? '#c9922c' : '#e5e7eb'}`, background: on ? '#fdf6e8' : '#fff', color: on ? '#a8741a' : '#6b7280',
  });
  const inp: React.CSSProperties = { padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" };

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 4 }}>🎯 Matchmaker</h2>
        <p style={{ fontSize: 14, color: '#6b7280' }}>Set a buyer/tenant’s criteria → see fitting properties from your database. {loading ? 'Loading…' : `${buyers.length} prospects · ${props.length} properties`}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) 1fr', gap: 18, alignItems: 'start' }}>
        {/* Buyer picker */}
        <div style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 12 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search buyers/tenants…" style={{ ...inp, marginBottom: 10 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 520, overflowY: 'auto' }}>
            {filteredBuyers.map(b => {
              const active = sel?.id === b.id;
              return (
                <button key={b.id} onClick={() => pick(b)}
                  style={{ textAlign: 'left', padding: '9px 11px', borderRadius: 8, border: `1px solid ${active ? '#c9922c' : 'transparent'}`, background: active ? '#fdf6e8' : 'transparent', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#111' }}>{buyerName(b)}</div>
                  <div style={{ fontSize: 11.5, color: '#9ca3af' }}>{b.type}{(b.asset_types?.length || b.req_price_max) ? ' · has criteria' : ''}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Requirements + matches */}
        <div>
          {!sel ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#fff', border: '1px solid #eef0f2', borderRadius: 12 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Pick a buyer or tenant to start matching</div>
            </div>
          ) : (
            <>
              {/* Requirements editor */}
              <div style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{buyerName(sel)} <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>· {sel.type}</span></div>
                  <button onClick={saveReq} disabled={busy} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save criteria'}</button>
                </div>
                <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 8 }}>Asset types</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  {ASSET_TYPES.map(t => {
                    const on = req.assetTypes.includes(t);
                    return <button key={t} onClick={() => setReq(r => ({ ...r, assetTypes: on ? r.assetTypes.filter(x => x !== t) : [...r.assetTypes, t] }))} style={chip(on)}>{t}</button>;
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 6 }}>Size (SF)</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input value={req.sizeMin} onChange={e => setReq(r => ({ ...r, sizeMin: e.target.value }))} placeholder="min" style={inp} />
                      <span style={{ color: '#9ca3af' }}>–</span>
                      <input value={req.sizeMax} onChange={e => setReq(r => ({ ...r, sizeMax: e.target.value }))} placeholder="max" style={inp} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 6 }}>Price ($)</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input value={req.priceMin} onChange={e => setReq(r => ({ ...r, priceMin: e.target.value }))} placeholder="min" style={inp} />
                      <span style={{ color: '#9ca3af' }}>–</span>
                      <input value={req.priceMax} onChange={e => setReq(r => ({ ...r, priceMax: e.target.value }))} placeholder="max" style={inp} />
                    </div>
                  </div>
                </div>
                {submarkets.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 8 }}>Submarkets</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 96, overflowY: 'auto' }}>
                      {submarkets.map(s => {
                        const on = req.submarkets.includes(s);
                        return <button key={s} onClick={() => setReq(r => ({ ...r, submarkets: on ? r.submarkets.filter(x => x !== s) : [...r.submarkets, s] }))} style={chip(on)}>{s}</button>;
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Matches */}
              <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, marginBottom: 10 }}>
                {hasCriteria ? `${matches.length} matching propert${matches.length === 1 ? 'y' : 'ies'}` : 'Set criteria above to see matches'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {matches.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #eef0f2', borderRadius: 10, padding: '11px 14px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.address || 'Property'}</div>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{[p.asset_type, fmtSf(p.size_sf), fmt$(p.sale_price), p.submarket || p.city].filter(Boolean).join(' · ')}</div>
                    </div>
                    {p.listing_url && <a href={p.listing_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: '#6b7280', textDecoration: 'none', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 9px', flexShrink: 0 }}>View ↗</a>}
                    {called.has(p.id)
                      ? <span style={{ fontSize: 12.5, fontWeight: 700, color: '#16a34a', flexShrink: 0 }}>✓ Queued</span>
                      : <button onClick={() => addCall(p)} style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: '#c9922c', border: 'none', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>＋ Call</button>}
                  </div>
                ))}
                {hasCriteria && matches.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af', fontSize: 13, background: '#fff', border: '1px solid #eef0f2', borderRadius: 10 }}>No available properties fit these criteria yet.</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
