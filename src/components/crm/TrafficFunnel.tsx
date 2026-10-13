'use client';

/**
 * "Traffic → dollars" for the Lead Attribution page: from a visit to money, by site and by channel,
 * with the visitor-quality split that says how much of the traffic is actually people.
 * Fed by /api/crm/traffic-funnel (owner-only). Quality tiers are defined in lib/visitor-quality.ts.
 */
import { useEffect, useState } from 'react';

const GOLD = '#c9922c';
const GOLD_DEEP = '#9A6E18';
const INK = '#1A1A1A';
const MUTE = '#6b7280';
const FAINT = '#9ca3af';

interface Bucket {
  label: string; visitors: number; engaged: number; acted: number; leads: number; deals: number; open: number;
  closed: number; pipeline: number; closedValue: number; commission: number; noValue: number;
}
interface Payload {
  days: number; site: string | null; humanOnly: boolean; truncated: boolean; trackerUpgradedAt: string | null;
  quality: { acted: number; engaged: number; glance: number; automated: number; unverified: number; total: number; real: number };
  total: Omit<Bucket, 'label'>;
  bySite: Bucket[]; byChannel: Bucket[];
  recentLeads: { id: string; at: string; site: string; channel: string; deals: number; stages: string[] }[];
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: '16px 20px', marginBottom: 14 };
const title: React.CSSProperties = { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, fontWeight: 600, marginBottom: 12 };
const th: React.CSSProperties = { background: 'transparent', color: MUTE, fontWeight: 600, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', border: 'none', position: 'static', textAlign: 'right' };
const siteShort = (h: string) => h.replace('www.', '').replace('fairoaksrealtygroup.com', 'Fair Oaks').replace('crecotx.com', 'CRECO').replace('elkhornpoint.com', 'Elkhorn Point');

const TIERS: { key: keyof Payload['quality']; label: string; color: string; hint: string }[] = [
  { key: 'acted', label: 'Took action', color: '#15803d', hint: 'Tapped to call/email/text, hit a button, downloaded, started a form, or came in on an email link.' },
  { key: 'engaged', label: 'Engaged', color: '#65a30d', hint: 'Stayed 8+ seconds, scrolled, or viewed 2+ pages.' },
  { key: 'glance', label: 'Glanced', color: '#d6b25e', hint: 'A real browser that viewed one page and left.' },
  { key: 'automated', label: 'Likely automated', color: '#9ca3af', hint: 'Hit from a cloud-provider city with no engagement at all.' },
  { key: 'unverified', label: 'Unverified', color: '#d1d5db', hint: 'No browser environment reported — the tracker before the Oct 7 upgrade. Not counted as real.' },
];

const money = (n: number) => {
  if (!n) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000).toLocaleString()}K`;
  return `$${Math.round(n).toLocaleString()}`;
};
const pct = (a: number, b: number) => (b > 0 ? `${a / b >= 0.1 ? Math.round((a / b) * 100) : ((a / b) * 100).toFixed(1)}%` : '—');

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  if (h < 1) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export default function TrafficFunnel({ authToken, isMobile, site, days, humanOnly, onHumanChange }: {
  authToken: string | null; isMobile: boolean; site: string | null; days: number; humanOnly: boolean; onHumanChange: (v: boolean) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const effDays = Math.min(days, 90);

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      try {
        const qs = `days=${effDays}&human=${humanOnly ? 1 : 0}` + (site ? `&site=${encodeURIComponent(site)}` : '');
        const r = await fetch(`/api/crm/traffic-funnel?${qs}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
        const j = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) { setErr(j.error ?? 'Could not load the traffic funnel.'); setData(null); }
        else { setErr(null); setData(j as Payload); }
      } catch { if (live) setErr('Network error — try again.'); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [authToken, effDays, site, humanOnly]);

  const toggle = (on: boolean, label: string, value: boolean) => (
    <button key={label} onClick={() => onHumanChange(value)} aria-pressed={on} style={{
      padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? GOLD : '#d1d5db'}`,
      background: on ? GOLD : '#fff', color: on ? '#fff' : '#374151', borderRadius: value ? '6px 0 0 6px' : '0 6px 6px 0',
    }}>{label}</button>
  );

  if (!data && loading) return <div style={card}><div style={title}>Traffic → dollars</div><div style={{ color: FAINT, fontSize: 13 }}>Loading…</div></div>;
  if (!data) return <div style={card}><div style={title}>Traffic → dollars</div><div style={{ color: '#b91c1c', fontSize: 13 }}>{err ?? 'No data.'}</div></div>;

  const q = data.quality;
  const t = data.total;
  const steps = [
    { label: humanOnly ? 'Real visitors' : 'All visitors', n: t.visitors },
    { label: 'Engaged', n: t.engaged },
    { label: 'Took action', n: t.acted },
    { label: 'Leads', n: t.leads },
    { label: 'Deals', n: t.deals },
    { label: 'Closed', n: t.closed },
  ];
  const maxStep = Math.max(...steps.map(s => s.n), 1);
  const realPct = q.total ? Math.round((q.real / q.total) * 100) : 0;

  const Table = ({ heading, rows }: { heading: string; rows: Bucket[] }) => (
    <div style={{ ...card, flex: '1 1 100%', minWidth: 0, overflowX: 'auto' }}>
      <div style={title}>{heading}</div>
      {rows.length === 0 ? <div style={{ fontSize: 12.5, color: FAINT }}>Nothing in this window yet.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead style={{ background: 'transparent' }}>
            <tr style={{ color: MUTE, textAlign: 'right', background: 'transparent' }}>
              <th style={{ ...th, textAlign: 'left', padding: '0 6px 6px 0' }} />
              <th style={{ ...th, padding: '0 6px 6px' }}>Visitors</th>
              {!isMobile && <th style={{ ...th, padding: '0 6px 6px' }}>Engaged</th>}
              <th style={{ ...th, padding: '0 6px 6px' }}>Leads</th>
              <th style={{ ...th, padding: '0 6px 6px' }}>Deals</th>
              <th style={{ ...th, padding: '0 0 6px 6px' }}>Pipeline</th>
              {!isMobile && <th style={{ ...th, padding: '0 0 6px 6px' }}>Commission</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} style={{ borderTop: '1px solid #f1f1f1', textAlign: 'right', color: '#374151' }}>
                <td style={{ textAlign: 'left', padding: '7px 6px 7px 0', fontWeight: 600, color: INK }}>{heading.includes('site') ? siteShort(r.label) : r.label}</td>
                <td style={{ padding: '7px 6px' }}>{r.visitors.toLocaleString()}</td>
                {!isMobile && <td style={{ padding: '7px 6px' }}>{r.engaged.toLocaleString()}</td>}
                <td style={{ padding: '7px 6px', fontWeight: r.leads ? 700 : 400, color: r.leads ? GOLD_DEEP : FAINT }}>{r.leads}</td>
                <td style={{ padding: '7px 6px' }}>{r.deals || '—'}</td>
                <td style={{ padding: '7px 0 7px 6px' }}>{r.pipeline ? money(r.pipeline) : '—'}</td>
                {!isMobile && <td style={{ padding: '7px 0 7px 6px' }}>{r.commission ? money(r.commission) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ ...title, marginBottom: 0 }}>Traffic → dollars</div>
          <span style={{ fontSize: 12, color: FAINT }}>last {data.days} days{days > 90 ? ' (capped at 90)' : ''}</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex' }} role="group" aria-label="Which visitors to count">
            {toggle(humanOnly, 'Real visitors', true)}
            {toggle(!humanOnly, 'All traffic', false)}
          </span>
        </div>

        {/* quality strip */}
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
          <strong style={{ color: INK }}>{q.real.toLocaleString()}</strong> of {q.total.toLocaleString()} visitors look like real people
          {q.total > 0 && <span style={{ color: MUTE }}> ({realPct}%)</span>}
        </div>
        <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: '#f1f1f1', marginBottom: 8 }} aria-hidden>
          {TIERS.map(tr => q[tr.key] > 0 && <div key={tr.key} title={`${tr.label}: ${q[tr.key]}`} style={{ width: `${(q[tr.key] / Math.max(q.total, 1)) * 100}%`, background: tr.color }} />)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: '#374151', marginBottom: 6 }}>
          {TIERS.map(tr => (
            <span key={tr.key} title={tr.hint} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: tr.color, display: 'inline-block' }} />
              {tr.label} <strong>{q[tr.key].toLocaleString()}</strong>
            </span>
          ))}
        </div>
        {q.unverified > 0 && data.trackerUpgradedAt && (
          <div style={{ fontSize: 11.5, color: FAINT }}>
            “Unverified” are visits from before the tracking upgrade on {new Date(data.trackerUpgradedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}; they can’t be proven human, so they aren’t counted as real. This clears as the window moves past that date.
          </div>
        )}
        {data.truncated && <div style={{ fontSize: 11.5, color: '#b45309' }}>Very high volume: showing the most recent 60,000 events in this window.</div>}
      </div>

      {/* funnel */}
      <div style={card}>
        <div style={title}>From first visit to money</div>
        {steps.map((s, i) => (
          <div key={s.label} style={{ marginBottom: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, color: '#374151' }}>
              <span style={{ fontWeight: 600, color: INK }}>{s.label}</span>
              <span>
                <strong>{s.n.toLocaleString()}</strong>
                {i > 0 && <span style={{ color: MUTE, marginLeft: 8 }}>{pct(s.n, steps[i - 1].n)} of {steps[i - 1].label.toLowerCase()}</span>}
              </span>
            </div>
            <div style={{ height: 8, background: '#f1f1f1', borderRadius: 4, marginTop: 3 }}>
              <div style={{ height: 8, width: `${s.n ? Math.max(2, (s.n / maxStep) * 100) : 0}%`, background: i >= 3 ? GOLD : '#c9c2b0', borderRadius: 4 }} />
            </div>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f1f1' }}>
          {[
            { k: 'Open pipeline', v: money(t.pipeline), sub: `${t.open} open deal${t.open === 1 ? '' : 's'}` },
            { k: 'Closed value', v: money(t.closedValue), sub: `${t.closed} closed` },
            { k: 'Commission earned', v: money(t.commission), sub: 'excludes lost deals' },
            { k: 'Visitor → lead', v: pct(t.leads, t.visitors), sub: `${t.leads} lead${t.leads === 1 ? '' : 's'}` },
          ].map(x => (
            <div key={x.k}>
              <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: MUTE, fontWeight: 600 }}>{x.k}</div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, color: INK, lineHeight: 1.1 }}>{x.v}</div>
              <div style={{ fontSize: 11.5, color: FAINT }}>{x.sub}</div>
            </div>
          ))}
        </div>
        {t.noValue > 0 && (
          <div style={{ fontSize: 12, color: '#b45309', marginTop: 12 }}>
            {t.noValue} deal{t.noValue === 1 ? ' has' : 's have'} no value entered, so the dollar totals understate what’s in flight. Add a value on the deal to count it.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Table heading="By channel" rows={data.byChannel} />
        <Table heading="By site" rows={data.bySite} />
      </div>

      {data.recentLeads.length > 0 && (
        <div style={card}>
          <div style={title}>Latest leads</div>
          {data.recentLeads.slice(0, 6).map(l => (
            <div key={l.id} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderTop: '1px solid #f6f6f6', color: '#374151' }}>
              <span><strong style={{ color: INK }}>{siteShort(l.site)}</strong> · {l.channel}</span>
              <span style={{ color: MUTE }}>{l.deals ? `${l.deals} deal${l.deals === 1 ? '' : 's'} (${l.stages.join(', ')})` : 'no deal yet'} · {ago(l.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
