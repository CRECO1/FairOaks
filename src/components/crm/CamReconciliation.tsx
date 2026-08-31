'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

// Annual expense reconciliation for a property. The figures that can be derived
// (each tenant, their suite, their square footage) come from the rent roll; the
// ones that can't (what the year actually cost, what each tenant paid on account,
// next year's base rent) are typed here once and remembered per year.

const CATS: Array<[string, string]> = [
  ['trash', 'Trash Removal'], ['water', 'Water'], ['landscaping', 'Landscaping'],
  ['repairs', 'Repairs & Maintenance'], ['professional', 'Professional Fees'],
  ['insurance', 'Insurance'], ['taxes', 'Real Estate Taxes'], ['management', 'Management & Operation'],
];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

type Money = Record<string, number | undefined>;
interface Tenant { suite: string; name: string; building: string; sf: number | null; contactName: string | null }
interface TenantVals { paid?: number; paidNote?: string; baseRentNext?: number; baseRentJan?: number; contactName?: string }
interface Data {
  propertyName?: string; propertyAddress?: string; propertyPhone?: string; propertySf?: number;
  rounding?: 'packet' | 'exact';
  buildings?: Record<string, { sf?: number; trashPct?: number }>;
  expenses?: Money; projected?: Money;
  letter?: { from?: string; phone?: string; date?: string; increaseMonth?: string };
  tenants?: Record<string, TenantVals>;
}

const numOrUndef = (v: string) => { const s = v.replace(/[^0-9.\-]/g, ''); return s === '' ? undefined : Number(s); };
const show = (v?: number) => (v == null ? '' : String(v));

export default function CamReconciliation({ listingId, listingName, address, authToken, isAdmin, onToast, onPreview }: {
  listingId: string; listingName: string; address: string;
  authToken?: string; isAdmin: boolean;
  onToast: (m: string) => void;
  onPreview: (f: { url: string; name: string }) => void;
}) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear - 1);
  const [data, setData] = useState<Data>({});
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [missingSf, setMissingSf] = useState<string[]>([]);
  const [rollSf, setRollSf] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const auth: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/crm/cam-reconciliation?listing_id=${listingId}&year=${year}`, { headers: auth });
      const j = await r.json();
      setTenants(j.tenants ?? []); setMissingSf(j.missingSf ?? []); setRollSf(j.rollSf ?? 0);
      // First time on a year: seed what we can from the property itself.
      setData(Object.keys(j.data ?? {}).length ? j.data : {
        propertyName: listingName, propertyAddress: address,
        letter: { date: `${year + 1}-01-19`, increaseMonth: 'February' },
      });
    } finally { setLoading(false); }
  }, [listingId, year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const buildings = useMemo(
    () => Array.from(new Set(tenants.map(t => t.building).filter(Boolean))).sort(),
    [tenants]);

  const set = (patch: Partial<Data>) => setData(d => ({ ...d, ...patch }));
  const setCat = (which: 'expenses' | 'projected', k: string, v: string) =>
    setData(d => ({ ...d, [which]: { ...(d[which] ?? {}), [k]: numOrUndef(v) } }));
  const setBldg = (b: string, k: 'sf' | 'trashPct', v: string) =>
    setData(d => ({ ...d, buildings: { ...(d.buildings ?? {}), [b]: { ...(d.buildings?.[b] ?? {}), [k]: numOrUndef(v) } } }));
  const setTen = (suite: string, k: keyof TenantVals, v: string) =>
    setData(d => ({ ...d, tenants: { ...(d.tenants ?? {}), [suite]: { ...(d.tenants?.[suite] ?? {}), [k]: k === 'paidNote' || k === 'contactName' ? v : numOrUndef(v) } } }));

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/crm/cam-reconciliation?listing_id=${listingId}&year=${year}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ data }),
      });
      onToast(r.ok ? 'Reconciliation saved ✓' : ((await r.json().catch(() => ({})))?.error || 'Could not save'));
    } finally { setBusy(false); }
  };

  const generate = async (suite?: string) => {
    setBusy(true);
    try {
      await fetch(`/api/crm/cam-reconciliation?listing_id=${listingId}&year=${year}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ data }),
      });
      const qs = `listing_id=${listingId}&year=${year}${suite ? `&suite=${encodeURIComponent(suite)}` : ''}`;
      const r = await fetch(`/api/crm/cam-reconciliation?${qs}`, { method: 'POST', headers: auth });
      const j = await r.json();
      if (!r.ok || !j.url) { onToast(j.error || 'Could not generate the packet'); return; }
      onToast(`📄 ${j.count} packet${j.count === 1 ? '' : 's'} generated`);
      onPreview({ url: j.url, name: j.name });
    } finally { setBusy(false); }
  };

  const inp: React.CSSProperties = { padding: '7px 9px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13.5, width: '100%', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" };
  const lbl: React.CSSProperties = { fontSize: 10.5, letterSpacing: .5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 4 };
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 16, marginBottom: 14 };
  const head: React.CSSProperties = { fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, marginBottom: 10 };

  if (loading) return <div style={{ padding: 30, color: '#9ca3af', fontSize: 13 }}>Loading…</div>;

  const total = (m?: Money) => CATS.reduce((s, [k]) => s + (Number(m?.[k]) || 0), 0);

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={head}>Expense Reconciliation</div>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          style={{ ...inp, width: 'auto', fontWeight: 700 }}>
          {[thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: '#9ca3af' }}>reconciles {year} · projects {year + 1}</span>
        <span style={{ flex: 1 }} />
        {isAdmin && <button onClick={save} disabled={busy} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 13, fontWeight: 700, color: '#6b7280', cursor: 'pointer' }}>Save</button>}
        <button onClick={() => generate()} disabled={busy} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>
          {busy ? 'Working…' : '📄 Generate all packets'}
        </button>
      </div>

      {missingSf.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '11px 14px', marginBottom: 14, fontSize: 13, color: '#78350f', lineHeight: 1.5 }}>
          <strong>{missingSf.length} suite{missingSf.length === 1 ? ' has' : 's have'} no square footage</strong> — {missingSf.join(', ')}.
          Every allocation divides by leasable SF, so these are left out of the run and the rent roll’s {rollSf.toLocaleString()} SF
          is short of the property total. Fill them in on the Rent Roll tab.
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div><div style={lbl}>Property name</div><input value={data.propertyName ?? ''} onChange={e => set({ propertyName: e.target.value })} style={inp} /></div>
          <div><div style={lbl}>Total leasable SF</div><input value={show(data.propertySf)} onChange={e => set({ propertySf: numOrUndef(e.target.value) })} placeholder="13021" style={inp} /></div>
          <div><div style={lbl}>Letter from</div><input value={data.letter?.from ?? ''} onChange={e => set({ letter: { ...data.letter, from: e.target.value } })} style={inp} /></div>
          <div><div style={lbl}>Phone</div><input value={data.letter?.phone ?? ''} onChange={e => set({ letter: { ...data.letter, phone: e.target.value } })} style={inp} /></div>
          <div><div style={lbl}>Letter date</div><input type="date" value={data.letter?.date ?? ''} onChange={e => set({ letter: { ...data.letter, date: e.target.value } })} style={inp} /></div>
          <div><div style={lbl}>Increase starts</div>
            <select value={data.letter?.increaseMonth ?? 'February'} onChange={e => set({ letter: { ...data.letter, increaseMonth: e.target.value } })} style={inp}>
              {MONTHS.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12.5, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={(data.rounding ?? 'packet') === 'packet'}
              onChange={e => set({ rounding: e.target.checked ? 'packet' : 'exact' })} style={{ accentColor: '#c9922c', width: 15, height: 15 }} />
            <span>Round percentages and tenant totals the way the previous packets did</span>
          </label>
          <span style={{ color: '#9ca3af' }}>— off gives the exact share to the cent.</span>
        </div>
      </div>

      <div style={card}>
        <div style={head}>Buildings</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          {buildings.map(b => (
            <div key={b} style={{ border: '1px solid #f3f4f6', borderRadius: 9, padding: 11 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Building {b}</div>
              <div style={lbl}>Leasable SF</div>
              <input value={show(data.buildings?.[b]?.sf)} onChange={e => setBldg(b, 'sf', e.target.value)} style={{ ...inp, marginBottom: 8 }} />
              <div style={lbl}>Share of trash bill (%)</div>
              <input value={show(data.buildings?.[b]?.trashPct)} onChange={e => setBldg(b, 'trashPct', e.target.value)} placeholder="50" style={inp} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {(['expenses', 'projected'] as const).map(which => (
          <div key={which} style={card}>
            <div style={head}>{which === 'expenses' ? `${year} actual` : `${year + 1} projected`}</div>
            {CATS.map(([k, label]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                <div style={{ flex: 1, fontSize: 13.5, color: '#374151' }}>{label}</div>
                <input value={show(data[which]?.[k])} onChange={e => setCat(which, k, e.target.value)} placeholder="0.00" style={{ ...inp, width: 120, textAlign: 'right' }} />
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f3f4f6', marginTop: 8, paddingTop: 8, fontSize: 13.5, fontWeight: 700 }}>
              <span>Total</span><span>${total(data[which]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={head}>Tenants · what they paid and next year’s rent</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#9ca3af', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5 }}>
                {['Suite', 'Tenant', 'Bldg', 'SF', `Paid in ${year}`, 'How that adds up', `${year + 1} base rent`, 'Jan base', ''].map(h => (
                  <th key={h} style={{ padding: '6px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => {
                const v = data.tenants?.[t.suite] ?? {};
                return (
                  <tr key={t.suite} style={{ borderTop: '1px solid #f3f4f6', opacity: t.sf ? 1 : .5 }}>
                    <td style={{ padding: '6px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>{t.suite}</td>
                    <td style={{ padding: '6px 8px', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</td>
                    <td style={{ padding: '6px 8px' }}>{t.building || '—'}</td>
                    <td style={{ padding: '6px 8px', color: t.sf ? '#374151' : '#dc2626', whiteSpace: 'nowrap' }}>{t.sf ? t.sf.toLocaleString() : 'no SF'}</td>
                    <td style={{ padding: '4px 8px' }}><input value={show(v.paid)} onChange={e => setTen(t.suite, 'paid', e.target.value)} style={{ ...inp, width: 100 }} /></td>
                    <td style={{ padding: '4px 8px' }}><input value={v.paidNote ?? ''} onChange={e => setTen(t.suite, 'paidNote', e.target.value)} placeholder="($462 x 11 + $440 in Jan)" style={{ ...inp, minWidth: 190 }} /></td>
                    <td style={{ padding: '4px 8px' }}><input value={show(v.baseRentNext)} onChange={e => setTen(t.suite, 'baseRentNext', e.target.value)} style={{ ...inp, width: 100 }} /></td>
                    <td style={{ padding: '4px 8px' }}><input value={show(v.baseRentJan)} onChange={e => setTen(t.suite, 'baseRentJan', e.target.value)} style={{ ...inp, width: 100 }} /></td>
                    <td style={{ padding: '4px 8px' }}>
                      <button onClick={() => generate(t.suite)} disabled={busy || !t.sf} title={t.sf ? 'Generate this tenant’s packet' : 'Needs square footage first'}
                        style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #f0e2c4', background: '#fff', color: '#a06a12', fontSize: 12.5, fontWeight: 700, cursor: t.sf ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>📄</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
