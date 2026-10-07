'use client';

/**
 * Engagement report for the Lead Attribution page — what visitors DO on the three sites, from the first-party
 * tracker: new vs returning, high-intent actions, known contacts active right now, top pages with time and
 * scroll, devices / browsers / places / referrers, ad click ids, CTAs, downloads, and site health.
 * Fed by /api/crm/site-engagement (owner-only).
 */
import { useEffect, useState } from 'react';

const GOLD = '#c9922c';
const GOLD_DEEP = '#9A6E18';
const INK = '#1A1A1A';
const MUTE = '#6b7280';
const FAINT = '#9ca3af';

interface Row { label: string; value: number }
interface Known { client_id: string; name: string; type: string | null; business: string | null; last: string; pages: number; events: number; sites: string[]; topPages: string[]; actions: Row[] }
interface Payload {
  days: number; site: string | null;
  totals: { visitors: number; returning: number; sessions: number; pageviews: number; events: number; avgLoadMs: number | null };
  intent: { type: string; count: number; visitors: number }[];
  pages: { path: string; title: string | null; views: number; avgEngagedSec: number | null; avgScroll: number | null }[];
  ctas: Row[]; phones: Row[]; outbound: Row[]; downloads: Row[]; scroll: Row[];
  devices: Row[]; browsers: Row[]; os: Row[]; places: Row[]; languages: Row[]; referrers: Row[]; clickIds: Row[]; errors: Row[];
  known: Known[];
  feed: { at: string; site: string; type: string; label: string | null; path: string | null; contact: string | null; client_id: string | null }[];
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: '16px 20px', marginBottom: 14 };
const title: React.CSSProperties = { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, fontWeight: 600, marginBottom: 12 };
const siteShort = (h: string) => h.replace('www.', '').replace('.com', '').replace('fairoaksrealtygroup', 'Fair Oaks').replace('crecotx', 'CRECO').replace('elkhornpoint', 'Elkhorn');
const INTENT_LABEL: Record<string, string> = { phone_tap: '📞 Call taps', email_tap: '✉️ Email taps', text_tap: '💬 Text taps', cta_click: '👆 Button clicks', download: '⬇️ Downloads', lead_form_started: '📝 Form starts' };
const FEED_TEXT: Record<string, string> = { phone_tap: 'tapped to call', email_tap: 'tapped to email', text_tap: 'tapped to text', download: 'downloaded', cta_click: 'clicked', lead_form_started: 'started a form', email_click_identified: 'clicked through from an email' };

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function MiniBars({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <div style={{ fontSize: 12.5, color: FAINT }}>{empty}</div>;
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div>
      {rows.map(r => (
        <div key={r.label} style={{ marginBottom: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: '#374151' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <span style={{ color: MUTE, fontWeight: 600 }}>{r.value.toLocaleString()}</span>
          </div>
          <div style={{ height: 5, background: '#f1f1f1', borderRadius: 3, marginTop: 2 }}><div style={{ height: 5, width: `${Math.max(3, (r.value / max) * 100)}%`, background: GOLD, borderRadius: 3 }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function SiteEngagement({ authToken, isMobile, site, days }: { authToken: string | null; isMobile: boolean; site: string | null; days: number }) {
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const window = Math.min(days, 90);

  useEffect(() => {
    let off = false;
    const load = () => fetch(`/api/crm/site-engagement?days=${window}${site ? `&site=${encodeURIComponent(site)}` : ''}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed'); if (!off) { setD(j); setErr(null); } })
      .catch(e => { if (!off) setErr(e.message || 'Could not load engagement'); });
    load();
    const t = setInterval(load, 30000);
    return () => { off = true; clearInterval(t); };
  }, [authToken, site, window]);

  if (err) return <div style={card}><div style={title}>Visitor engagement</div><div style={{ fontSize: 13, color: '#b91c1c' }}>{err}</div></div>;
  if (!d) return <div style={card}><div style={title}>Visitor engagement</div><div style={{ fontSize: 13, color: FAINT }}>Loading…</div></div>;

  const t = d.totals;
  const retPct = t.visitors ? Math.round((t.returning / t.visitors) * 100) : 0;
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 14 };
  const kpi = (label: string, value: string, sub?: string) => (
    <div style={{ flex: '1 1 120px', minWidth: 110 }}>
      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, color: INK, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: MUTE, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 11.5, color: FAINT }}>{sub}</div>}
    </div>
  );
  const nothing = t.pageviews === 0 && t.events === 0;

  return (
    <div>
      {/* KPIs */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        {kpi('Visitors', t.visitors.toLocaleString(), `${t.sessions.toLocaleString()} sessions`)}
        {kpi('Returning', `${retPct}%`, `${t.returning.toLocaleString()} came back`)}
        {kpi('Pageviews', t.pageviews.toLocaleString())}
        {kpi('Actions', t.events.toLocaleString(), 'clicks, taps, scrolls')}
        {kpi('Avg load', t.avgLoadMs != null ? `${(t.avgLoadMs / 1000).toFixed(1)}s` : '—')}
      </div>

      {nothing && <div style={{ ...card, fontSize: 13, color: MUTE, lineHeight: 1.6 }}>No visitor-level data in this window yet. The v2 tracker records visitor ids, returns, taps, downloads, scroll and time on page as the sites are browsed — it populates as new traffic arrives.</div>}

      {/* known contacts */}
      <div style={card}>
        <div style={title}>Known contacts on the site</div>
        {d.known.length === 0 ? (
          <div style={{ fontSize: 12.5, color: FAINT, lineHeight: 1.55 }}>None yet. A contact shows up here when they click a link in one of our campaign emails or submit a form, and then keep browsing.</div>
        ) : d.known.map(k => (
          <div key={k.client_id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13.5, color: INK }}>{k.name}</strong>
              {k.type && <span style={{ fontSize: 11, color: MUTE }}>{k.type}</span>}
              <span style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 600 }}>{ago(k.last)}</span>
              <span style={{ fontSize: 11.5, color: FAINT }}>{k.sites.map(siteShort).join(', ')}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#374151', marginTop: 2 }}>
              {k.pages} page{k.pages === 1 ? '' : 's'}{k.topPages.length ? ` · ${k.topPages.join(', ')}` : ''}
              {k.actions.map(a => <span key={a.label} style={{ marginLeft: 8, background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '1px 8px', fontSize: 11.5, fontWeight: 700 }}>{INTENT_LABEL[a.label] ?? a.label} {a.value}</span>)}
            </div>
          </div>
        ))}
      </div>

      {/* high intent */}
      <div style={card}>
        <div style={title}>High-intent actions</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 12 }}>
          {d.intent.map(i => (
            <div key={i.type} style={{ minWidth: 100 }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, color: i.count ? GOLD_DEEP : FAINT }}>{i.count}</div>
              <div style={{ fontSize: 11.5, color: MUTE }}>{INTENT_LABEL[i.type]}</div>
              <div style={{ fontSize: 11, color: FAINT }}>{i.visitors} visitor{i.visitors === 1 ? '' : 's'}</div>
            </div>
          ))}
        </div>
        {d.feed.length > 0 && (
          <div style={{ borderTop: '1px solid #f1f1f1', paddingTop: 8 }}>
            {d.feed.slice(0, 10).map((f, i) => (
              <div key={i} style={{ fontSize: 12.5, color: '#374151', padding: '2px 0' }}>
                <span style={{ color: FAINT, fontSize: 11.5, display: 'inline-block', width: 62 }}>{ago(f.at)}</span>
                <strong style={{ color: f.contact ? INK : '#374151' }}>{f.contact ?? 'A visitor'}</strong> {FEED_TEXT[f.type] ?? f.type}{f.label && f.type !== 'email_click_identified' ? ` “${f.label}”` : ''}
                <span style={{ color: FAINT }}> · {siteShort(f.site)}{f.path ? ` ${f.path}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* top pages */}
      <div style={card}>
        <div style={title}>Top pages — views, time on page, scroll depth</div>
        {d.pages.length === 0 ? <div style={{ fontSize: 12.5, color: FAINT }}>No pageviews in this window.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Page', 'Views', 'Avg time', 'Avg scroll'].map(h => <th key={h} style={{ textAlign: h === 'Page' ? 'left' : 'right', color: MUTE, fontWeight: 600, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', padding: '0 8px 6px 0' }}>{h}</th>)}</tr></thead>
              <tbody>{d.pages.map(p => (
                <tr key={p.path} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px 6px 0', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#374151' }} title={p.title ?? p.path}>{p.path}</td>
                  <td style={{ textAlign: 'right', padding: '6px 8px 6px 0', fontWeight: 600 }}>{p.views}</td>
                  <td style={{ textAlign: 'right', padding: '6px 8px 6px 0', color: MUTE }}>{p.avgEngagedSec != null ? `${p.avgEngagedSec}s` : '—'}</td>
                  <td style={{ textAlign: 'right', padding: '6px 0', color: MUTE }}>{p.avgScroll != null ? `${p.avgScroll}%` : '—'}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* breakdowns */}
      <div style={grid}>
        <div style={card}><div style={title}>Where visitors came from</div><MiniBars rows={d.referrers} empty="All direct so far." /></div>
        <div style={card}><div style={title}>Paid click ids seen</div><MiniBars rows={d.clickIds} empty="No ad click ids (gclid / fbclid / msclkid …) yet." /></div>
        <div style={card}><div style={title}>Buttons clicked</div><MiniBars rows={d.ctas} empty="No button clicks yet." /></div>
        <div style={card}><div style={title}>Scroll depth reached</div><MiniBars rows={d.scroll} empty="—" /></div>
        <div style={card}><div style={title}>Devices</div><MiniBars rows={d.devices} empty="—" /></div>
        <div style={card}><div style={title}>Browsers · OS</div><MiniBars rows={[...d.browsers.slice(0, 4), ...d.os.slice(0, 3).map(o => ({ label: `OS: ${o.label}`, value: o.value }))]} empty="—" /></div>
        <div style={card}><div style={title}>Locations</div><MiniBars rows={d.places} empty="—" /></div>
        <div style={card}><div style={title}>Languages</div><MiniBars rows={d.languages} empty="—" /></div>
        <div style={card}><div style={title}>Downloads</div><MiniBars rows={d.downloads} empty="No downloads yet." /></div>
        <div style={card}><div style={title}>Outbound clicks</div><MiniBars rows={d.outbound} empty="None." /></div>
        <div style={card}><div style={title}>Numbers tapped to call</div><MiniBars rows={d.phones} empty="No call taps yet." /></div>
        <div style={card}><div style={title}>Site errors (JS)</div><MiniBars rows={d.errors} empty="No errors seen — healthy." /></div>
      </div>
    </div>
  );
}
