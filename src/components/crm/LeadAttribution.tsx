'use client';

/**
 * Lead Attribution — owner-only dashboard. "What is bringing leads to the
 * websites?"
 *
 * First-party panels read our own tables and work today. The GA panels need a
 * GA4 service account; until the env vars exist the API reports
 * `ga.status.connected === false` and those panels render a "Connect Google
 * Analytics" card instead of erroring. Nothing here throws on missing GA.
 *
 * Charts are hand-rolled CSS bars to match the existing Dashboard (Pipeline by
 * Stage, Monthly GCI). No charting library — consistent look, no bundle cost,
 * and these are all bar/stat shapes.
 *
 * Access is enforced server-side (403 for non-super_admin). The nav gate that
 * hides this page is convenience only.
 */

import { useCallback, useEffect, useState } from 'react';

const GOLD = '#c9922c';
const INK = '#111';
const MUTE = '#6b7280';

interface Row { label: string; value: number }
interface Health { sites: { site: string; total: number; withAttribution: number; pct: number | null }[]; windowDays: number }
interface GaStatus { connected: boolean; reason?: string; detail?: string }
interface Ga {
  status: GaStatus;
  label: string;
  totals: { sessions: number; users: number; leads: number; conversionRate: number } | null;
  byChannel: Row[]; bySourceMedium: Row[]; landingPages: Row[]; byCountryCity: Row[]; byDevice: Row[];
}
interface Payload {
  windowDays: number;
  overTime: { month: string; inbound: number; imported: number }[];
  channelMix: Row[]; bySite: Row[]; captureSurface: Row[]; byType: Row[]; byCity: Row[];
  health: Health;
  recent: { name: string; date: string; source: string | null; site: string | null; channel: string | null; campaign: string | null; referrer: string | null; landing_page: string | null }[];
  counts: { clients: number; imports: number; leads: number };
  ga: Ga;
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: '16px 20px', marginBottom: 14 };
const panelTitle: React.CSSProperties = { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, fontWeight: 600, marginBottom: 14 };
const num: React.CSSProperties = { fontFamily: "'Cormorant Garamond',serif", fontSize: 34, fontWeight: 700, color: INK, lineHeight: 1 };

function Bars({ rows, isMobile, color = GOLD, suffix }: { rows: Row[]; isMobile: boolean; color?: string; suffix?: string }) {
  if (!rows.length) return <div style={{ fontSize: 13, color: MUTE }}>No data yet.</div>;
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: isMobile ? 96 : 150, fontSize: 12, color: '#374151', fontWeight: 500, flexShrink: 0, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
          <div style={{ flex: 1, height: 24, background: '#f3f4f6', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((r.value / max) * 100)}%`, height: '100%', background: color, borderRadius: 5, display: 'flex', alignItems: 'center', paddingLeft: 8, minWidth: r.value > 0 ? 30 : 0, transition: 'width .5s ease' }}>
              <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>{r.value.toLocaleString()}{suffix ?? ''}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConnectGa({ detail, label }: { detail?: string; label?: string }) {
  return (
    <div style={{ ...card, borderLeft: `4px solid ${GOLD}`, background: '#fffdf7' }}>
      <div style={panelTitle}>📈 Connect Google Analytics — {label ?? 'crecotx.com'}</div>
      <div style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.7 }}>
        These panels show sessions by channel, top landing pages and conversion rate — the traffic
        that <em>didn&apos;t</em> become a lead, which is what a conversion rate needs. They stay dark
        until a GA4 service account is connected.
        <div style={{ marginTop: 10, fontSize: 13, color: MUTE }}>
          Add <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>GA4_PROPERTY_ID</code> and{' '}
          <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>GA4_SERVICE_ACCOUNT_KEY</code> in Vercel, then redeploy.
        </div>
        {detail && <div style={{ marginTop: 8, fontSize: 12.5, color: '#9a6e18' }}>Status: {detail}</div>}
      </div>
    </div>
  );
}

export default function LeadAttribution({ authToken, isMobile }: { authToken: string | null; isMobile: boolean }) {
  const token = authToken;
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number) => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/crm/lead-attribution?days=${d}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status === 403) { setErr('Lead attribution is limited to the account owner.'); setData(null); return; }
      if (!res.ok) { setErr('Could not load lead attribution.'); setData(null); return; }
      setData(await res.json());
    } catch {
      setErr('Could not load lead attribution.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(days); }, [load, days]);

  if (loading && !data) return <div style={{ padding: 24, color: MUTE, fontSize: 14 }}>Loading lead attribution…</div>;
  if (err) return <div style={{ ...card, borderLeft: '4px solid #ef4444' }}><div style={{ fontSize: 14, color: '#374151' }}>{err}</div></div>;
  if (!data) return null;

  const ga = data.ga;
  const gaOn = ga?.status?.connected === true;
  const maxMonth = Math.max(...data.overTime.map(m => m.inbound + m.imported), 1);

  return (
    <div>
      {/* Range selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, fontWeight: 600 }}>Window</span>
        {[30, 90, 365].map(d => (
          <button key={d} onClick={() => setDays(d)}
            style={{ border: `1px solid ${days === d ? GOLD : '#e0e0e0'}`, background: days === d ? GOLD : '#fff', color: days === d ? '#fff' : '#374151', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            {d === 365 ? '1 year' : `${d} days`}
          </button>
        ))}
      </div>

      {/* ── 5. ATTRIBUTION HEALTH — built first, it makes the gap visible ── */}
      <div style={{ ...card, borderLeft: `4px solid ${GOLD}` }}>
        <div style={panelTitle}>🩺 Attribution health by site — do we know where leads came from?</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: isMobile ? 14 : 18 }}>
          {data.health.sites.map(s => {
            const pct = s.pct;
            const tone = pct === null ? '#9ca3af' : pct >= 80 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
            return (
              <div key={s.site}>
                <div style={{ fontSize: 12.5, color: '#374151', fontWeight: 600, marginBottom: 6 }}>{s.site}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ ...num, color: tone }}>{pct === null ? '—' : `${pct}%`}</div>
                  <div style={{ fontSize: 12.5, color: MUTE }}>{s.withAttribution} of {s.total} leads carry a source</div>
                </div>
                <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
                  <div style={{ width: `${pct ?? 0}%`, height: '100%', background: tone, borderRadius: 4, transition: 'width .5s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12.5, color: MUTE, marginTop: 12, lineHeight: 1.6 }}>
          All three sites are listed even at zero leads — an absent row would read as &ldquo;fine&rdquo;
          when it actually means the site sends us nothing we can see. Leads captured before the
          attribution wiring shipped cannot be backfilled; this climbs as new leads arrive.
        </div>
      </div>

      {/* ── 1. Inbound vs imported over time ── */}
      <div style={card}>
        <div style={panelTitle}>📈 Contacts added over time — inbound vs imported</div>
        {data.overTime.length === 0 ? <div style={{ fontSize: 13, color: MUTE }}>No data yet.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {data.overTime.map(m => (
              <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: isMobile ? 58 : 72, fontSize: 12, color: '#374151', fontWeight: 500, flexShrink: 0, textAlign: 'right' }}>{m.month}</div>
                <div style={{ flex: 1, height: 24, background: '#f3f4f6', borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${Math.round((m.inbound / maxMonth) * 100)}%`, height: '100%', background: GOLD, display: 'flex', alignItems: 'center', paddingLeft: m.inbound ? 6 : 0 }}>
                    {m.inbound > 0 && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{m.inbound}</span>}
                  </div>
                  <div style={{ width: `${Math.round((m.imported / maxMonth) * 100)}%`, height: '100%', background: '#d8d3c8', display: 'flex', alignItems: 'center', paddingLeft: m.imported ? 6 : 0 }}>
                    {m.imported > 0 && <span style={{ color: '#4b5563', fontSize: 11, fontWeight: 700 }}>{m.imported.toLocaleString()}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 12, color: MUTE, flexWrap: 'wrap' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: GOLD, borderRadius: 2, marginRight: 5 }} />Inbound (web form)</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#d8d3c8', borderRadius: 2, marginRight: 5 }} />Imported list / prospecting</span>
        </div>
      </div>

      {/* ── 2 + 3. Channel mix and capture surface ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 14 }}>
        <div style={card}>
          <div style={panelTitle}>🏷 Leads by site</div>
          <Bars rows={data.bySite ?? []} isMobile={isMobile} />
        </div>
        <div style={card}>
          <div style={panelTitle}>🌐 Inbound channel mix</div>
          <Bars rows={data.channelMix} isMobile={isMobile} />
        </div>
        <div style={card}>
          <div style={panelTitle}>📝 Capture surface — which form</div>
          <Bars rows={data.captureSurface} isMobile={isMobile} color="#9A6E18" />
        </div>
      </div>

      {/* ── 4. Lead type + geography ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 14 }}>
        <div style={card}>
          <div style={panelTitle}>👤 Contact type</div>
          <Bars rows={data.byType} isMobile={isMobile} color="#3b82f6" />
        </div>
        <div style={card}>
          <div style={panelTitle}>📍 Geography</div>
          <Bars rows={data.byCity} isMobile={isMobile} color="#22c55e" />
        </div>
      </div>

      {/* ── GA-dependent panels ── */}
      {!gaOn ? <ConnectGa detail={ga?.status?.detail} label={ga?.label} /> : (
        <>
          {/* The first-party panels above cover all three sites; GA covers one.
              Say which, or these numbers read as the whole business. */}
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
                <div style={num}>{typeof s.val === 'number' ? s.val.toLocaleString() : s.val}</div>
                <div style={{ fontSize: 12, color: MUTE, marginTop: 3 }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 14 }}>
            <div style={card}><div style={panelTitle}>🚦 Sessions by channel · {ga.label}</div><Bars rows={ga.byChannel} isMobile={isMobile} /></div>
            <div style={card}><div style={panelTitle}>🔗 Source / medium · {ga.label}</div><Bars rows={ga.bySourceMedium} isMobile={isMobile} color="#9A6E18" /></div>
          </div>
          <div style={card}><div style={panelTitle}>🛬 Top landing pages · {ga.label}</div><Bars rows={ga.landingPages} isMobile={isMobile} color="#3b82f6" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 14 }}>
            <div style={card}><div style={panelTitle}>🌎 Top cities · {ga.label}</div><Bars rows={ga.byCountryCity} isMobile={isMobile} color="#22c55e" /></div>
            <div style={card}><div style={panelTitle}>📱 Device · {ga.label}</div><Bars rows={ga.byDevice} isMobile={isMobile} color="#a855f7" /></div>
          </div>
        </>
      )}

      {/* ── Per-lead attribution table ── */}
      <div style={card}>
        <div style={panelTitle}>🧾 Recent leads — where each came from</div>
        {data.recent.length === 0 ? <div style={{ fontSize: 13, color: MUTE }}>No leads yet.</div> : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.recent.slice(0, 20).map((r, i) => (
              <div key={i} style={{ borderBottom: '1px solid #f1f1f1', paddingBottom: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{r.name}</div>
                <div style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>
                  {r.date ? new Date(r.date).toLocaleDateString() : '—'} · {r.site ?? '—'} · {r.source ?? '—'}
                </div>
                <div style={{ fontSize: 12, color: r.channel ? '#9A6E18' : '#9ca3af', marginTop: 2 }}>
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
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: r.channel ? '#9A6E18' : '#9ca3af', fontWeight: r.channel ? 600 : 400 }}>{r.channel ?? 'not recorded'}</td>
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: '#374151' }}>{r.campaign ?? '—'}</td>
                    <td style={{ padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5', color: MUTE, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.landing_page ?? ''}>{r.landing_page ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: '#9ca3af', textAlign: 'center', paddingBottom: 20 }}>
        {data.counts.clients.toLocaleString()} contacts · {data.counts.imports.toLocaleString()} inbound imports · {data.counts.leads.toLocaleString()} raw leads
      </div>
    </div>
  );
}
