'use client';

/**
 * Lead Attribution — owner-only. "What is bringing me leads?"
 *
 * The page leads with the answer: a hero block ranking the sources of every
 * lead in the selected window by site, channel and campaign. Attribution health
 * is a small strip underneath — it is a diagnostic, not the headline, and
 * opening on three red zeros made a working system look broken.
 *
 * Everything on the page respects the window selector. Everything counts LEADS,
 * not the ~3,000-row contact book, so the numbers are small and true.
 *
 * Charts stay hand-rolled CSS in brand gold (#C9922C — the dashboard's
 * established token, deliberately not the #C9A962 used elsewhere on the site).
 * No charting library.
 *
 * Access is enforced server-side (403 for non-super_admin) and the underlying
 * RPC has EXECUTE revoked from authenticated/anon. The nav gate is cosmetic.
 */

import { useCallback, useEffect, useState } from 'react';

const GOLD = '#c9922c';
const GOLD_DEEP = '#9A6E18';
const INK = '#1A1A1A';
const MUTE = '#6b7280';
const FAINT = '#9ca3af';

interface Row { label: string; value: number }
interface HealthSite { site: string; total: number; withAttribution: number; pct: number | null }
interface CampaignRow { name: string; utm: string | null; sent: number; opens: number; clicks: number; leads: number }
interface RecentRow {
  name: string; date: string; source: string | null; site: string | null;
  channel: string | null; campaign: string | null; content: string | null;
  referrer: string | null; landing_page: string | null;
}
interface Ga {
  status: { connected: boolean; reason?: string; detail?: string };
  label: string;
  totals: { sessions: number; users: number; leads: number; conversionRate: number } | null;
  byChannel: Row[]; bySourceMedium: Row[]; landingPages: Row[]; byCountryCity: Row[]; byDevice: Row[];
}
interface Payload {
  windowDays: number; site: string | null; grain: 'day' | 'week' | 'month'; totalLeads: number;
  sources: { bySite: Row[]; byChannel: Row[]; byCampaign: Row[] };
  overTime: { bucket: string; leads: number }[];
  captureSurface: Row[]; inboundFeed: Row[]; byType: Row[]; byCity: Row[];
  campaigns: CampaignRow[]; recent: RecentRow[];
  health: { windowDays: number; sites: HealthSite[] };
  counts: { leads: number; contacts: number; imports: number };
  ga: Ga;
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: '16px 20px', marginBottom: 14 };
const panelTitle: React.CSSProperties = { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, fontWeight: 600, marginBottom: 14 };
const serif = "'Cormorant Garamond',serif";

/** Consistent empty state — reads as "not yet", never as "broken". */
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: FAINT, lineHeight: 1.6, padding: '6px 0 2px', fontStyle: 'italic' }}>
      {children}
    </div>
  );
}

/**
 * Ranked bars with share-of-total. Labels sit ABOVE the bar on mobile so a long
 * hostname is readable instead of being truncated into a 96px column.
 */
function Bars({ rows, isMobile, empty, tone = GOLD }: { rows: Row[]; isMobile: boolean; empty: React.ReactNode; tone?: string }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  const total = rows.reduce((t, r) => t + r.value, 0) || 1;
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 9 }}>
      {rows.map(r => {
        const share = Math.round((r.value / total) * 100);
        const bar = (
          <div style={{ flex: 1, height: 22, background: '#f3f4f6', borderRadius: 5, overflow: 'hidden', minWidth: 0 }}>
            <div style={{ width: `${Math.max(2, Math.round((r.value / max) * 100))}%`, height: '100%', background: tone, borderRadius: 5, transition: 'width .45s ease' }} />
          </div>
        );
        const figure = (
          <div style={{ flexShrink: 0, fontSize: 12, color: '#374151', minWidth: 62, textAlign: 'right' }}>
            <strong style={{ color: INK }}>{r.value.toLocaleString()}</strong>
            <span style={{ color: FAINT }}> · {share}%</span>
          </div>
        );
        return isMobile ? (
          <div key={r.label}>
            <div style={{ fontSize: 12.5, color: '#374151', fontWeight: 500, marginBottom: 4, wordBreak: 'break-word' }}>{r.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{bar}{figure}</div>
          </div>
        ) : (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 168, fontSize: 12, color: '#374151', fontWeight: 500, flexShrink: 0, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
            {bar}{figure}
          </div>
        );
      })}
    </div>
  );
}

function ConnectGa({ detail, label, viewing }: { detail?: string; label?: string; viewing?: string | null }) {
  const covers = label ?? 'crecotx.com';
  const mismatch = viewing != null && viewing !== covers;
  return (
    <div style={{ ...card, borderLeft: `4px solid ${GOLD}`, background: '#fffdf7' }}>
      <div style={panelTitle}>Google Analytics — {covers}</div>
      <div style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.7 }}>
        Session and landing-page data — the traffic that <em>didn&apos;t</em> become a lead, which is
        what a conversion rate needs. Dark until a GA4 service account is connected.
        <div style={{ marginTop: 10, fontSize: 13, color: MUTE }}>
          Add <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>GA4_PROPERTY_ID</code> and{' '}
          <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>GA4_SERVICE_ACCOUNT_KEY</code> in Vercel, then redeploy.
        </div>
        {mismatch && <div style={{ marginTop: 8, fontSize: 12.5, color: GOLD_DEEP }}>Viewing <strong>{viewing}</strong>; the connected property measures {covers}.</div>}
        {detail && <div style={{ marginTop: 8, fontSize: 12.5, color: GOLD_DEEP }}>Status: {detail}</div>}
      </div>
    </div>
  );
}

export default function LeadAttribution({ authToken, isMobile }: { authToken: string | null; isMobile: boolean }) {
  const token = authToken;
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [site, setSite] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number, s: string | null) => {
    setLoading(true); setErr(null);
    try {
      const qs = `days=${d}` + (s ? `&site=${encodeURIComponent(s)}` : '');
      const res = await fetch(`/api/crm/lead-attribution?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (res.status === 403) { setErr('Lead attribution is limited to the account owner.'); setData(null); return; }
      if (!res.ok) { setErr('Could not load lead attribution.'); setData(null); return; }
      setData(await res.json());
    } catch { setErr('Could not load lead attribution.'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(days, site); }, [load, days, site]);

  if (loading && !data) return <div style={{ padding: 24, color: MUTE, fontSize: 14 }}>Loading lead attribution…</div>;
  if (err) return <div style={{ ...card, borderLeft: '4px solid #ef4444' }}><div style={{ fontSize: 14, color: '#374151' }}>{err}</div></div>;
  if (!data) return null;

  const ga = data.ga;
  const gaOn = ga?.status?.connected === true;
  const rangeLabel = data.windowDays === 365 ? 'the last year' : `the last ${data.windowDays} days`;
  const scopeLabel = site ?? 'all three sites';
  const maxBucket = Math.max(...data.overTime.map(b => b.leads), 1);
  const pill = (on: boolean): React.CSSProperties => ({
    border: `1px solid ${on ? GOLD : '#e0e0e0'}`, background: on ? GOLD : '#fff',
    color: on ? '#fff' : '#374151', borderRadius: 999, padding: '6px 14px',
    fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
    whiteSpace: 'nowrap', lineHeight: 1.4,
  });

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, fontWeight: 600, marginRight: 2 }}>Site</span>
        {([[null, 'All sites'], ['crecotx.com', 'crecotx.com'], ['fairoaksrealtygroup.com', 'Fair Oaks'], ['elkhornpoint.com', 'Elkhorn Point']] as [string | null, string][]).map(([v, l]) => (
          <button key={l} onClick={() => setSite(v)} aria-pressed={site === v} style={pill(site === v)}>{l}</button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, fontWeight: 600 }}>Window</span>
        {[30, 90, 365].map(d => (
          <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} style={{ ...pill(days === d), borderRadius: 6 }}>
            {d === 365 ? '1 year' : `${d} days`}
          </button>
        ))}
        {loading && <span style={{ fontSize: 12, color: FAINT }}>updating…</span>}
      </div>

      {/* ── HERO: the answer ── */}
      <div style={{ background: INK, borderRadius: 12, padding: isMobile ? '20px 18px' : '24px 26px', marginBottom: 14, color: '#fff' }}>
        <div style={{ fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', fontWeight: 700 }}>
          What brought leads · {scopeLabel} · {rangeLabel}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '10px 0 4px', flexWrap: 'wrap' }}>
          <div style={{ fontFamily: serif, fontSize: isMobile ? 46 : 58, fontWeight: 700, lineHeight: 1, color: GOLD }}>
            {data.totalLeads.toLocaleString()}
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.7)' }}>
            {data.totalLeads === 1 ? 'inbound lead' : 'inbound leads'}
          </div>
        </div>

        {data.totalLeads === 0 ? (
          <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.72)', lineHeight: 1.7, marginTop: 8 }}>
            No inbound leads in this window yet. Attribution is wired and live on all three sites —
            the next form submission will appear here with its source, channel and campaign.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: isMobile ? 16 : 26, marginTop: 14 }}>
            {([['Site', data.sources.bySite], ['Channel', data.sources.byChannel], ['Campaign', data.sources.byCampaign]] as [string, Row[]][]).map(([heading, rows]) => (
              <div key={heading}>
                <div style={{ fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', fontWeight: 700, marginBottom: 8 }}>{heading}</div>
                {rows.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.45)', fontStyle: 'italic' }}>nothing recorded</div>
                ) : rows.slice(0, 4).map(r => {
                  const share = Math.round((r.value / data.totalLeads) * 100);
                  const unknown = /^(not recorded|no campaign)$/i.test(r.label);
                  return (
                    <div key={r.label} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginBottom: 3 }}>
                        <span style={{ color: unknown ? 'rgba(255,255,255,.45)' : '#fff', fontWeight: unknown ? 400 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</span>
                        <span style={{ color: 'rgba(255,255,255,.65)', flexShrink: 0 }}>{r.value} · {share}%</span>
                      </div>
                      <div style={{ height: 5, background: 'rgba(255,255,255,.12)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${share}%`, height: '100%', background: unknown ? 'rgba(255,255,255,.25)' : GOLD, borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Attribution health — demoted to a strip ── */}
      <div style={{ ...card, padding: '12px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 22, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: MUTE, fontWeight: 600 }}>Source recorded</span>
          {data.health.sites.map(s => {
            const tone = s.pct === null ? FAINT : s.pct >= 80 ? '#16a34a' : s.pct >= 40 ? GOLD : GOLD_DEEP;
            return (
              <span key={s.site} style={{ fontSize: 12.5, color: '#374151' }}>
                <strong style={{ color: tone }}>{s.pct === null ? '—' : `${s.pct}%`}</strong>
                <span style={{ color: FAINT }}> {s.site.replace('.com', '')} ({s.withAttribution}/{s.total})</span>
              </span>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: FAINT, marginTop: 7, lineHeight: 1.6 }}>
          Leads captured before the attribution wiring shipped carry no source and cannot be backfilled — this climbs as new leads arrive.
        </div>
      </div>

      {/* ── Trend ── */}
      <div style={card}>
        <div style={panelTitle}>Leads over time — by {data.grain}</div>
        {data.overTime.length === 0 ? <Empty>No leads in this window yet.</Empty> : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
            {data.overTime.map(b => (
              <div key={b.bucket} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4, minWidth: 0 }}
                   title={`${b.bucket}: ${b.leads} lead${b.leads === 1 ? '' : 's'}`}>
                <div style={{ fontSize: 10.5, color: MUTE, fontWeight: 600 }}>{b.leads || ''}</div>
                <div style={{ width: '100%', height: `${Math.max(3, Math.round((b.leads / maxBucket) * 88))}%`, background: b.leads ? GOLD : '#f0f0f0', borderRadius: '3px 3px 0 0' }} />
                <div style={{ fontSize: 9.5, color: FAINT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                  {data.grain === 'month' ? b.bucket.slice(0, 7) : b.bucket.slice(5)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Email campaign performance ── */}
      <div style={card}>
        <div style={panelTitle}>Email campaigns — opens → clicks → leads</div>
        {data.campaigns.length === 0 ? (
          <Empty>No campaign sends in this window.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: isMobile ? 420 : undefined }}>
              <thead>
                <tr style={{ textAlign: 'left', color: MUTE }}>
                  {['Campaign', 'Sent', 'Opens', 'Open %', 'Clicks', 'Leads'].map((h, i) => (
                    <th key={h} style={{ padding: '6px 10px 8px 0', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c, i) => {
                  const openPct = c.sent ? Math.round((c.opens / c.sent) * 100) : 0;
                  return (
                    <tr key={i}>
                      <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: INK, fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>{c.name}</td>
                      <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', textAlign: 'right', color: '#374151' }}>{c.sent}</td>
                      <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', textAlign: 'right', color: '#374151' }}>{c.opens}</td>
                      <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', textAlign: 'right', color: openPct >= 40 ? '#16a34a' : openPct >= 20 ? GOLD_DEEP : MUTE, fontWeight: 600 }}>{openPct}%</td>
                      <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', textAlign: 'right', color: c.clicks ? GOLD_DEEP : FAINT, fontWeight: c.clicks ? 600 : 400 }}>{c.clicks || '—'}</td>
                      <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', textAlign: 'right', color: c.leads ? INK : FAINT, fontWeight: c.leads ? 700 : 400 }}>{c.leads || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 11.5, color: FAINT, marginTop: 10, lineHeight: 1.6 }}>
              Opens are the higher of our tracking pixel and Resend&apos;s webhook. Clicks come from Resend and
              count unique people. Leads are matched to a campaign by the utm_campaign inside that email&apos;s links.
            </div>
          </div>
        )}
      </div>

      {/* ── Supporting breakdowns ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 14 }}>
        <div style={card}>
          <div style={panelTitle}>Capture surface — which form</div>
          <Bars rows={data.captureSurface} isMobile={isMobile} empty="No form submissions in this window." />
        </div>
        <div style={card}>
          <div style={panelTitle}>Portal &amp; importer feed</div>
          <Bars rows={data.inboundFeed} isMobile={isMobile} tone={GOLD_DEEP} empty="No portal or importer activity in this window." />
        </div>
        <div style={card}>
          <div style={panelTitle}>Lead type</div>
          <Bars rows={data.byType} isMobile={isMobile} tone={GOLD_DEEP} empty="No lead has a contact type yet." />
        </div>
        <div style={card}>
          <div style={panelTitle}>Lead geography</div>
          <Bars rows={data.byCity} isMobile={isMobile} tone={GOLD_DEEP} empty="No lead has a city recorded yet." />
        </div>
      </div>

      {/* ── GA ── */}
      {!gaOn ? <ConnectGa detail={ga?.status?.detail} label={ga?.label} viewing={site} /> : (
        <>
          <div style={{ ...card, borderLeft: `4px solid ${GOLD}`, marginBottom: 14, padding: '12px 20px' }}>
            <div style={{ fontSize: 12.5, color: '#374151' }}>
              <strong>Google Analytics — {ga.label}</strong>
              <span style={{ color: MUTE }}> · traffic for this site only. The panels above cover all three sites.</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: isMobile ? 10 : 14, marginBottom: 14 }}>
            {[
              { label: 'Sessions', val: ga.totals?.sessions ?? 0, sub: 'GA4' },
              { label: 'Users', val: ga.totals?.users ?? 0, sub: 'GA4' },
              { label: 'Key events', val: ga.totals?.leads ?? 0, sub: 'incl. generate_lead' },
              { label: 'Conv. rate', val: `${((ga.totals?.conversionRate ?? 0) * 100).toFixed(1)}%`, sub: 'events ÷ sessions' },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: '18px 20px', border: '1px solid #e0e0e0', borderLeft: `4px solid ${GOLD}` }}>
                <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontFamily: serif, fontSize: 34, fontWeight: 700, color: INK, lineHeight: 1 }}>{typeof s.val === 'number' ? s.val.toLocaleString() : s.val}</div>
                <div style={{ fontSize: 12, color: MUTE, marginTop: 3 }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 14 }}>
            <div style={card}><div style={panelTitle}>Sessions by channel · {ga.label}</div><Bars rows={ga.byChannel} isMobile={isMobile} empty="No sessions." /></div>
            <div style={card}><div style={panelTitle}>Source / medium · {ga.label}</div><Bars rows={ga.bySourceMedium} isMobile={isMobile} tone={GOLD_DEEP} empty="No sessions." /></div>
            <div style={card}><div style={panelTitle}>Top landing pages · {ga.label}</div><Bars rows={ga.landingPages} isMobile={isMobile} tone={GOLD_DEEP} empty="No sessions." /></div>
            <div style={card}><div style={panelTitle}>Device · {ga.label}</div><Bars rows={ga.byDevice} isMobile={isMobile} tone={GOLD_DEEP} empty="No sessions." /></div>
          </div>
        </>
      )}

      {/* ── Per-lead detail ── */}
      <div style={card}>
        <div style={panelTitle}>Recent leads — where each came from</div>
        {data.recent.length === 0 ? (
          <Empty>No leads in this window. When one arrives it will appear here with its site, form, channel and campaign.</Empty>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.recent.map((r, i) => (
              <div key={i} style={{ borderBottom: '1px solid #f1f1f1', paddingBottom: 9 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{r.name}</div>
                <div style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>
                  {r.date ? new Date(r.date).toLocaleDateString() : '—'} · {r.site ?? '—'} · {r.source ?? '—'}
                </div>
                <div style={{ fontSize: 12, color: r.channel ? GOLD_DEEP : FAINT, marginTop: 2, fontWeight: r.channel ? 600 : 400 }}>
                  {r.channel ?? 'no source recorded'}{r.campaign ? ` · ${r.campaign}` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: MUTE }}>
                  {['Name', 'Date', 'Site', 'Form', 'Channel', 'Campaign', 'Landing page'].map(h => (
                    <th key={h} style={{ padding: '6px 10px 8px 0', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', fontWeight: 600, color: INK }}>{r.name}</td>
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: MUTE, whiteSpace: 'nowrap' }}>{r.date ? new Date(r.date).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: '#374151', whiteSpace: 'nowrap' }}>{r.site ?? '—'}</td>
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: '#374151' }}>{r.source ?? '—'}</td>
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: r.channel ? GOLD_DEEP : FAINT, fontWeight: r.channel ? 600 : 400 }}>{r.channel ?? 'not recorded'}</td>
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: '#374151' }}>{r.campaign ?? '—'}</td>
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: MUTE, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.landing_page ?? ''}>{r.landing_page ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: FAINT, textAlign: 'center', paddingBottom: 20, lineHeight: 1.6 }}>
        {site ?? 'All sites'} · {rangeLabel} · {data.counts.leads.toLocaleString()} inbound {data.counts.leads === 1 ? 'lead' : 'leads'} ·{' '}
        {data.counts.imports.toLocaleString()} importer rows · {data.counts.contacts.toLocaleString()} contacts in the book
      </div>
    </div>
  );
}
