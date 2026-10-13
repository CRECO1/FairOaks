'use client';

/**
 * "Performance" tab on the property card: how this property's web pages are doing — real visitors,
 * actions (calls / texts / downloads / forms), inquiries and deals — versus the previous period.
 * Fed by /api/crm/property-performance?listing_id=… Real visitors use the same definition as the
 * Lead Attribution funnel (scanners and crawlers are out). Which pages count is shown and editable:
 * names/addresses are matched automatically, anything else can be added as a web address fragment.
 */
import { useCallback, useEffect, useState } from 'react';

const GOLD = '#c9922c';
const INK = '#1A1A1A';
const MUTE = '#6b7280';
const FAINT = '#9ca3af';

interface Metrics { views: number; visitors: number; real: number; engaged: number; acted: number; calls: number; texts: number; emails: number; downloads: number; forms: number; clicks: number; inquiries: number; deals: number; openDeals: number }
interface Perf {
  tokens: string[]; current: Metrics; previous: Metrics | null;
  daily: { date: string; visitors: number }[];
  topPages: { site: string; path: string; views: number; visitors: number }[];
  sources: { label: string; visitors: number }[];
  inquiries: { id: string; name: string | null; at: string; source: string | null; page: string | null }[];
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '14px 16px', marginBottom: 12 };
const label: React.CSSProperties = { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: MUTE, fontWeight: 700, marginBottom: 8 };

function delta(cur: number, prev: number | null | undefined) {
  if (prev == null) return null;
  if (prev === 0) return cur > 0 ? { text: 'new', up: true } : null;
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p === 0) return { text: 'flat', up: null as boolean | null };
  return { text: `${p > 0 ? '+' : ''}${p}%`, up: p > 0 };
}
function ago(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`;
}

export default function PropertyPerformance({ listingId, authToken, isMobile, onToast }: {
  listingId: string; authToken?: string; isMobile?: boolean; onToast?: (m: string) => void;
}) {
  const [days, setDays] = useState(30);
  const [perf, setPerf] = useState<Perf | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/crm/property-performance?listing_id=${listingId}&days=${days}`, { headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? 'Could not load performance'); setPerf(null); }
      else { setErr(null); setPerf(j.perf ?? null); setPaths(j.listing?.web_paths ?? []); }
    } catch { setErr('Network error — try again'); }
    finally { setLoading(false); }
  }, [listingId, days, authToken]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  async function savePaths(next: string[]) {
    const r = await fetch(`/api/crm/listings/${listingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ web_paths: next }) });
    if (!r.ok) { onToast?.('Could not save the web address'); return; }
    setAdding('');
    await load();
  }

  const m = perf?.current;
  const p = perf?.previous ?? null;
  const maxDay = Math.max(1, ...(perf?.daily.map(d => d.visitors) ?? [1]));
  const tile = (k: string, v: number, d: ReturnType<typeof delta>, sub?: string) => (
    <div key={k} style={{ flex: '1 1 110px', minWidth: 100 }}>
      <div style={label}>{k}</div>
      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, lineHeight: 1.05, color: INK }}>{v.toLocaleString()}</div>
      <div style={{ fontSize: 11.5, color: FAINT }}>
        {d && <span style={{ color: d.up === true ? '#15803d' : d.up === false ? '#b91c1c' : FAINT, fontWeight: 700 }}>{d.text} </span>}
        {sub ?? (d ? 'vs prior' : '')}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '0 20px 20px', opacity: loading ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <span style={label}>Last</span>
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} aria-pressed={days === d}
            style={{ padding: '4px 11px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${days === d ? GOLD : '#d1d5db'}`, background: days === d ? GOLD : '#fff', color: days === d ? '#fff' : '#374151' }}>{d} days</button>
        ))}
      </div>

      {err && <div style={{ ...card, color: '#b91c1c', fontSize: 13 }}>{err}</div>}

      {perf && m && (
        <>
          {perf.tokens.length === 0 || (m.views === 0 && m.inquiries === 0) ? (
            <div style={{ ...card, background: '#fffbeb', borderColor: '#fde68a', fontSize: 13, color: '#92400e' }}>
              {perf.tokens.length === 0
                ? 'No web pages are linked to this property yet. Add its page address below (for example “1353-w-french-pl”) and its traffic will show here.'
                : 'No visits or inquiries on this property’s pages in this window. If its page uses a different address, add it below.'}
            </div>
          ) : null}

          <div style={{ ...card, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {tile('Real visitors', m.real, delta(m.real, p?.real), `${m.visitors.toLocaleString()} total`)}
            {tile('Page views', m.views, delta(m.views, p?.views))}
            {tile('Took action', m.acted, delta(m.acted, p?.acted))}
            {tile('Inquiries', m.inquiries, delta(m.inquiries, p?.inquiries))}
            {tile('Deals', m.deals, null, m.openDeals ? `${m.openDeals} open` : 'filed here')}
          </div>

          <div style={{ ...card }}>
            <div style={label}>Actions on this property’s pages</div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: '#374151' }}>
              {[['📞 Call taps', m.calls], ['💬 Text taps', m.texts], ['✉️ Email taps', m.emails], ['📄 Downloads', m.downloads], ['📝 Form starts', m.forms], ['👆 Button clicks', m.clicks]].map(([k, v]) => (
                <span key={k as string}>{k} <strong>{v as number}</strong></span>
              ))}
            </div>
          </div>

          <div style={card}>
            <div style={label}>Visitors per day</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: days > 30 ? 1 : 3, height: 70 }} aria-hidden>
              {perf.daily.map(d => (
                <div key={d.date} title={`${d.date}: ${d.visitors}`} style={{ flex: 1, minWidth: 1, height: `${Math.max(d.visitors ? 6 : 2, (d.visitors / maxDay) * 100)}%`, background: d.visitors ? GOLD : '#eee', borderRadius: 2 }} />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ ...card, flex: '1 1 260px' }}>
              <div style={label}>Top pages</div>
              {perf.topPages.length === 0 ? <div style={{ fontSize: 12.5, color: FAINT }}>None yet.</div> : perf.topPages.map(pg => (
                <div key={pg.site + pg.path} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '3px 0', color: '#374151' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pg.site.replace('fairoaksrealtygroup.com', 'FairOaks').replace('.com', '')}{pg.path}</span>
                  <span style={{ color: MUTE, fontWeight: 600 }}>{pg.visitors} · {pg.views}v</span>
                </div>
              ))}
            </div>
            <div style={{ ...card, flex: '1 1 220px' }}>
              <div style={label}>Where real visitors come from</div>
              {perf.sources.length === 0 ? <div style={{ fontSize: 12.5, color: FAINT }}>None yet.</div> : perf.sources.map(s => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0', color: '#374151' }}>
                  <span>{s.label}</span><span style={{ color: MUTE, fontWeight: 600 }}>{s.visitors}</span>
                </div>
              ))}
            </div>
          </div>

          {perf.inquiries.length > 0 && (
            <div style={card}>
              <div style={label}>Latest inquiries from this property’s pages</div>
              {perf.inquiries.map(q => (
                <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '4px 0', color: '#374151', borderTop: '1px solid #f6f6f6' }}>
                  <span><strong style={{ color: INK }}>{q.name ?? 'Unnamed'}</strong>{q.source ? ` · ${q.source.replace(/^CRECO Website — /, '')}` : ''}</span>
                  <span style={{ color: MUTE }}>{ago(q.at)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={card}>
            <div style={label}>Pages counted as this property</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {perf.tokens.map(t => {
                const mine = paths.includes(t);
                return (
                  <span key={t} style={{ fontSize: 12, padding: '3px 9px', borderRadius: 999, background: mine ? '#fdf6e3' : '#f3f4f6', border: `1px solid ${mine ? '#f1d9a0' : '#e5e7eb'}`, color: '#374151' }}>
                    {t}{mine && <button onClick={() => savePaths(paths.filter(x => x !== t))} aria-label={`Remove ${t}`} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTE, marginLeft: 5 }}>✕</button>}
                  </span>
                );
              })}
              {perf.tokens.length === 0 && <span style={{ fontSize: 12.5, color: FAINT }}>None yet</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
              <input value={adding} onChange={e => setAdding(e.target.value)} placeholder="Add a page address, e.g. move-in-ready-medical-building"
                onKeyDown={e => { if (e.key === 'Enter' && adding.trim()) savePaths([...paths, adding.trim()]); }}
                style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
              <button disabled={!adding.trim()} onClick={() => savePaths([...paths, adding.trim()])}
                style={{ padding: '7px 14px', border: 'none', borderRadius: 6, background: adding.trim() ? GOLD : '#e5e7eb', color: '#fff', fontWeight: 700, cursor: adding.trim() ? 'pointer' : 'default', fontSize: 13 }}>Add</button>
            </div>
            <div style={{ fontSize: 11.5, color: FAINT, marginTop: 7 }}>
              Matched against the site and page address. A whole site works too (e.g. “elkhornpoint.com”). Gray chips come from the property’s name and address.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
