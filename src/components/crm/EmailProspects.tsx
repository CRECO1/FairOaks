'use client';

import React, { useEffect, useMemo, useState } from 'react';

// Email Prospects — sits in a property's Rent Roll tab. Everyone the property's
// campaigns have emailed (campaign projects linked to the listing), with opens,
// clicks and an open rate per campaign. Read-only and live from /api/crm/listing-prospects,
// so the open rates keep themselves current as each campaign sends.

interface Camp { id: string; name: string; status: string; sent: number; opened: number; clickers: number; openRate: number; lastSent: string | null }
interface Prospect {
  client_id: string; name: string; business: string; email: string; phone: string; category: string; askFor: string; locations: string;
  emailsSent: number; emailsOpened: number; opens: number; firstOpen: string | null; lastOpen: string | null; lastSent: string | null;
  clicks: number; lastClick: string | null; unsubscribed: boolean; dead: boolean;
}
type SortKey = 'who' | 'category' | 'emailsSent' | 'emailsOpened' | 'opens' | 'lastOpen' | 'clicks';

const GOLD = '#c9922c';
const authOf = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const pct = (r: number) => `${Math.round(r * 100)}%`;
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }) : '';
const who = (p: Prospect) => p.business || p.name || p.email;
const TH: React.CSSProperties = { textAlign: 'left', fontSize: 10.5, letterSpacing: .6, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800, padding: '8px 10px', borderBottom: '1px solid #e5e7eb', background: '#fafafa', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const TD: React.CSSProperties = { fontSize: 12.5, color: '#1f2937', padding: '7px 10px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };

export default function EmailProspects({ listingId, authToken }: { listingId: string; authToken?: string }) {
  const [campaigns, setCampaigns] = useState<Camp[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyOpened, setOnlyOpened] = useState(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'lastOpen', dir: -1 });
  const [showCamps, setShowCamps] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/crm/listing-prospects?listing_id=${listingId}`, { headers: authOf(authToken) })
      .then(r => r.json()).catch(() => ({}))
      .then(j => { if (!live) return; setCampaigns(j.campaigns ?? []); setProspects(j.prospects ?? []); setLoading(false); });
    return () => { live = false; };
  }, [listingId, authToken]);

  const totals = useMemo(() => {
    const reached = prospects.length;
    const opened = prospects.filter(p => p.emailsOpened > 0).length;
    const clicked = prospects.filter(p => p.clicks > 0).length;
    const sent = campaigns.reduce((s, c) => s + c.sent, 0);
    const opens = campaigns.reduce((s, c) => s + c.opened, 0);
    return { reached, opened, clicked, sent, rate: sent ? opens / sent : 0 };
  }, [prospects, campaigns]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = prospects.filter(p => (!onlyOpened || p.emailsOpened > 0) &&
      (!needle || [p.business, p.name, p.email, p.phone, p.category, p.askFor].some(v => v.toLowerCase().includes(needle))));
    const k = sort.key;
    return [...rows].sort((a, b) => {
      const av = k === 'who' ? who(a) : a[k]; const bv = k === 'who' ? who(b) : b[k];
      if (av === bv) return 0;
      if (av === null || av === '') return 1;
      if (bv === null || bv === '') return -1;
      return (typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv))) * sort.dir;
    });
  }, [prospects, onlyOpened, q, sort]);

  if (loading) return null;
  if (!campaigns.length) return null;            // property has no linked campaigns

  const exportCsv = () => {
    const head = ['Business', 'Contact', 'Ask for', 'Locations', 'Email', 'Phone', 'Category', 'Emails sent', 'Emails opened', 'Total opens', 'First open', 'Last open', 'Clicks', 'Unsubscribed', 'Dead email'];
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [head.join(','), ...visible.map(p => [p.business, p.name, p.askFor, p.locations, p.email, p.phone, p.category, p.emailsSent, p.emailsOpened, p.opens, day(p.firstOpen), day(p.lastOpen), p.clicks, p.unsubscribed ? 'yes' : '', p.dead ? 'yes' : ''].map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = onlyOpened ? 'email-prospects-opened.csv' : 'email-prospects.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const th = (label: string, k?: SortKey, right?: boolean) => (
    <th style={{ ...TH, textAlign: right ? 'right' : 'left', cursor: k ? 'pointer' : 'default' }}
      onClick={() => k && setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : (k === 'who' || k === 'category' ? 1 : -1) }))}>
      {label}{k && sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const tile = (label: string, value: string, sub?: string) => (
    <div style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 10, padding: '9px 13px', minWidth: 104, flex: '1 1 104px' }}>
      <div style={{ fontSize: 10, letterSpacing: .7, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: '#1a1a1a', marginTop: 2, fontFamily: "'Cormorant Garamond',serif" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#9ca3af' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: GOLD, fontWeight: 700 }}>Email Prospects</div>
        <span style={{ fontSize: 11.5, color: '#9ca3af' }}>from this property&apos;s campaigns · live</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {tile('Emailed', String(totals.reached), `${totals.sent} emails sent`)}
        {tile('Opened', String(totals.opened), totals.reached ? `${pct(totals.opened / totals.reached)} of people` : undefined)}
        {tile('Open rate', pct(totals.rate), 'opens ÷ emails sent')}
        {tile('Clicked', String(totals.clicked), 'includes link scanners')}
      </div>

      <button onClick={() => setShowCamps(v => !v)} style={{ fontSize: 12, fontWeight: 700, color: '#a06a12', background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', marginBottom: 6 }}>
        {showCamps ? '▾' : '▸'} Open rate by campaign ({campaigns.length})
      </button>
      {showCamps && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'auto', background: '#fff', marginBottom: 12 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
            <thead><tr>{th('Campaign')}{th('Sent', undefined, true)}{th('Opened', undefined, true)}{th('Open rate', undefined, true)}{th('Clicked', undefined, true)}{th('Last sent')}</tr></thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id}>
                  <td style={TD}>{c.name}{c.status === 'active' && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#15803d', background: '#f0fdf4', borderRadius: 6, padding: '1px 6px' }}>SENDING</span>}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>{c.sent}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>{c.opened}</td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{c.sent ? pct(c.openRate) : '—'}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>{c.clickers}</td>
                  <td style={{ ...TD, whiteSpace: 'nowrap' }}>{day(c.lastSent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search business, contact, category…"
          style={{ flex: '1 1 190px', minWidth: 0, padding: '7px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
        <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          {([[true, `Opened (${totals.opened})`], [false, `All emailed (${totals.reached})`]] as [boolean, string][]).map(([v, l]) => (
            <button key={l} onClick={() => setOnlyOpened(v)} style={{ fontSize: 12, fontWeight: 700, padding: '7px 11px', border: 'none', cursor: 'pointer', background: onlyOpened === v ? '#1a1a1a' : '#fff', color: onlyOpened === v ? '#fff' : '#374151' }}>{l}</button>
          ))}
        </div>
        <button onClick={exportCsv} style={{ fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 11px', cursor: 'pointer' }}>⬇ CSV</button>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'auto', background: '#fff', maxHeight: 520 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
          <thead><tr>
            {th('Prospect', 'who')}{th('Category', 'category')}{th('Contact')}
            {th('Sent', 'emailsSent', true)}{th('Opened', 'emailsOpened', true)}{th('Opens', 'opens', true)}{th('Last open', 'lastOpen')}{th('Clicks', 'clicks', true)}
          </tr></thead>
          <tbody>
            {visible.map(p => (
              <tr key={p.client_id} style={{ opacity: p.unsubscribed || p.dead ? .55 : 1 }}>
                <td style={TD}>
                  <div style={{ fontWeight: 700 }}>{who(p)}</div>
                  {p.askFor
                    ? <div style={{ fontSize: 11.5, color: '#a06a12', fontWeight: 600 }}>📞 Ask for: {p.askFor}{p.locations && <span style={{ color: '#6b7280', fontWeight: 500 }}> · {p.locations}</span>}</div>
                    : p.business && p.name && <div style={{ fontSize: 11.5, color: '#6b7280' }}>{p.name}</div>}
                  {(p.unsubscribed || p.dead) && <div style={{ fontSize: 10.5, fontWeight: 800, color: '#b91c1c' }}>{p.dead ? 'DEAD EMAIL' : 'UNSUBSCRIBED'}</div>}
                </td>
                <td style={{ ...TD, color: '#6b7280', maxWidth: 170 }}>{p.category}</td>
                <td style={TD}>
                  {p.email && <div><a href={`mailto:${p.email}`} style={{ color: '#a06a12', textDecoration: 'none' }}>{p.email}</a></div>}
                  {p.phone && <div><a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} style={{ color: '#374151', textDecoration: 'none' }}>{p.phone}</a></div>}
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>{p.emailsSent}</td>
                <td style={{ ...TD, textAlign: 'right' }}>{p.emailsOpened}</td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{p.opens || ''}</td>
                <td style={{ ...TD, whiteSpace: 'nowrap' }}>{day(p.lastOpen)}</td>
                <td style={{ ...TD, textAlign: 'right' }}>{p.clicks || ''}</td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>{onlyOpened ? 'No opens yet.' : 'No one emailed yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 7 }}>
        Opens are approximate — Apple Mail pre-loads images, so some &ldquo;opens&rdquo; are automatic. Clicks that hit every link at once are usually corporate link scanners. Replies and booked calls are the real signal.
      </div>
    </div>
  );
}
