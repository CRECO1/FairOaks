'use client';

/**
 * A contact's whole website story — first touch, ad click ids, environment, every visit, page and action
 * (phone taps, downloads, form starts, scroll, time on page), before AND after they became a lead.
 * Fed by /api/crm/lead-activity. Used on the contact card and inside the Lead Attribution lead rows.
 */
import { useEffect, useState } from 'react';

const GOLD_DEEP = '#9A6E18';
const MUTE = '#6b7280';
const FAINT = '#9ca3af';

interface Pv { site: string; session_id: string; path: string; title: string | null; referrer: string | null; utm_source: string | null; utm_campaign: string | null; device: string | null; browser: string | null; os: string | null; city: string | null; created_at: string }
interface Ev { site: string; type: string; label: string | null; value: number | null; path: string | null; meta: Record<string, unknown> | null; created_at: string }
interface Payload {
  contact: { visit_count: number | null; first_touch: Record<string, unknown> | null; click_ids: Record<string, string> | null; env: Record<string, unknown> | null; channel: string | null; utm_source: string | null; utm_campaign: string | null; landing_page: string | null; referrer: string | null } | null;
  linked: { source: string; at: string }[];
  summary: {
    firstSeen: string | null; lastSeen: string | null; visits: number; pageviews: number; engagedSec: number; maxScroll: number;
    phoneTaps: number; emailTaps: number; downloads: number; ctaClicks: number; formStarts: number;
    sites: string[]; devices: string[]; browsers: string[]; places: string[]; campaigns: string[]; topPages: { path: string; n: number }[];
  };
  pageviews: Pv[]; events: Ev[];
}

const chip: React.CSSProperties = { display: 'inline-block', fontSize: 11.5, color: '#374151', background: '#f3f4f6', borderRadius: 999, padding: '2px 9px', marginRight: 6, marginBottom: 5, whiteSpace: 'nowrap' };
const hot: React.CSSProperties = { ...{ background: '#fef3c7', color: '#92400e', fontWeight: 700 } };
const siteShort = (h: string) => h.replace('www.', '').replace('.com', '').replace('fairoaksrealtygroup', 'Fair Oaks').replace('crecotx', 'CRECO').replace('elkhornpoint', 'Elkhorn');

function fmtSec(s: number): string { if (s < 60) return `${s}s`; const m = Math.floor(s / 60); return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`; }
function when(iso: string) { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

const EVENT_TEXT: Record<string, (e: Ev) => string> = {
  phone_tap: e => `📞 Tapped to call ${e.label ?? ''}`,
  email_tap: e => `✉️ Tapped to email ${e.label ?? ''}`,
  text_tap: e => `💬 Tapped to text ${e.label ?? ''}`,
  download: e => `⬇️ Downloaded ${e.label ?? ''}`,
  cta_click: e => `👆 Clicked “${e.label ?? ''}”`,
  outbound_click: e => `↗ Left the site → ${e.label ?? ''}`,
  lead_form_started: e => `📝 Started a form${e.label ? ` (${e.label})` : ''}`,
  email_click_identified: () => '📧 Clicked through from one of our emails',
  page_exit: e => `⏱ Spent ${fmtSec(Number(e.value) || 0)}${Number((e.meta as { max_scroll?: number } | null)?.max_scroll) ? `, scrolled ${(e.meta as { max_scroll?: number }).max_scroll}%` : ''} on ${e.path ?? 'page'}`,
};
const isNoise = (t: string) => t === 'page_load' || t === 'scroll';

export default function SiteActivity({ clientId, authToken, compact }: { clientId: string; authToken: string | null; compact?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let off = false;
    setData(null); setErr(null);
    fetch(`/api/crm/lead-activity?client_id=${encodeURIComponent(clientId)}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed'); if (!off) setData(j); })
      .catch(e => { if (!off) setErr(e.message || 'Could not load'); });
    return () => { off = true; };
  }, [clientId, authToken]);

  if (err) return <div style={{ fontSize: 12.5, color: '#b91c1c' }}>{err}</div>;
  if (!data) return <div style={{ fontSize: 12.5, color: FAINT }}>Loading website activity…</div>;

  const s = data.summary, c = data.contact;
  const timeline = [
    ...data.pageviews.map(p => ({ at: p.created_at, site: p.site, kind: 'page' as const, text: `Viewed ${p.path}${p.title ? ` — ${p.title.slice(0, 60)}` : ''}`, sub: [p.utm_campaign && `campaign ${p.utm_campaign}`, p.referrer && (() => { try { return `from ${new URL(p.referrer!).hostname.replace('www.', '')}`; } catch { return null; } })(), p.city && p.city].filter(Boolean).join(' · ') })),
    ...data.events.filter(e => !isNoise(e.type)).map(e => ({ at: e.created_at, site: e.site, kind: 'event' as const, text: (EVENT_TEXT[e.type] ?? ((x: Ev) => `${x.type}${x.label ? `: ${x.label}` : ''}`))(e), sub: '' })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const shown = all ? timeline : timeline.slice(0, compact ? 12 : 25);

  const ft = (c?.first_touch ?? {}) as Record<string, unknown>;
  const ftClick = Object.keys((ft.click_ids as Record<string, string> | undefined) ?? {});
  const clickIds = Object.keys(c?.click_ids ?? {});
  const env = (c?.env ?? {}) as Record<string, unknown>;
  const none = !timeline.length && !c?.first_touch && !clickIds.length && !Object.keys(env).length;

  if (none) return <div style={{ fontSize: 12.5, color: FAINT, lineHeight: 1.55 }}>No website activity is linked to this contact yet. It appears once they submit a form on one of our sites, or click through from one of our campaign emails.</div>;

  return (
    <div>
      {/* headline numbers */}
      <div style={{ marginBottom: 6 }}>
        {s.visits > 0 && <span style={chip}>{s.visits} {s.visits === 1 ? 'visit' : 'visits'}{c?.visit_count && c.visit_count > s.visits ? ` (${c.visit_count} lifetime)` : ''}</span>}
        {s.pageviews > 0 && <span style={chip}>{s.pageviews} pages</span>}
        {s.engagedSec > 0 && <span style={chip}>{fmtSec(s.engagedSec)} engaged</span>}
        {s.maxScroll > 0 && <span style={chip}>scrolled up to {s.maxScroll}%</span>}
        {s.phoneTaps > 0 && <span style={{ ...chip, ...hot }}>📞 {s.phoneTaps} call tap{s.phoneTaps > 1 ? 's' : ''}</span>}
        {s.emailTaps > 0 && <span style={{ ...chip, ...hot }}>✉️ {s.emailTaps} email tap{s.emailTaps > 1 ? 's' : ''}</span>}
        {s.downloads > 0 && <span style={{ ...chip, ...hot }}>⬇️ {s.downloads} download{s.downloads > 1 ? 's' : ''}</span>}
        {s.ctaClicks > 0 && <span style={chip}>👆 {s.ctaClicks} button click{s.ctaClicks > 1 ? 's' : ''}</span>}
        {s.formStarts > 0 && <span style={chip}>📝 {s.formStarts} form start{s.formStarts > 1 ? 's' : ''}</span>}
      </div>
      {(s.firstSeen || s.lastSeen) && <div style={{ fontSize: 12, color: MUTE, marginBottom: 6 }}>First seen {s.firstSeen ? when(s.firstSeen) : '—'} · last active {s.lastSeen ? when(s.lastSeen) : '—'}{s.sites.length ? ` · ${s.sites.map(siteShort).join(', ')}` : ''}</div>}

      {/* how they first found us */}
      {(c?.first_touch || c?.channel) && (
        <div style={{ fontSize: 12.5, color: '#374151', marginBottom: 6, lineHeight: 1.55 }}>
          <strong style={{ color: GOLD_DEEP }}>First touch:</strong>{' '}
          {[ft.utm_source && `${ft.utm_source}${ft.utm_medium ? ` / ${ft.utm_medium}` : ''}`, ft.utm_campaign && `campaign ${ft.utm_campaign}`, ft.referrer && (() => { try { return `via ${new URL(String(ft.referrer)).hostname.replace('www.', '')}`; } catch { return null; } })(), ftClick.length && `ad click (${ftClick.join(', ')})`, ft.landing_page && `landed on ${ft.landing_page}`].filter(Boolean).join(' · ') || (c?.channel ?? '—')}
          {c?.channel ? <span style={{ color: FAINT }}> · channel {c.channel}</span> : null}
        </div>
      )}
      {clickIds.length > 0 && <div style={{ fontSize: 12, color: MUTE, marginBottom: 6 }}>Ad click ids: {clickIds.join(', ')}</div>}

      {/* environment */}
      <div style={{ marginBottom: 8 }}>
        {s.devices.map(d => <span key={d} style={chip}>{d}</span>)}
        {s.browsers.map(b => <span key={b} style={chip}>{b}</span>)}
        {typeof env.lang === 'string' && <span style={chip}>{env.lang}</span>}
        {typeof env.tz === 'string' && <span style={chip}>{env.tz}</span>}
        {typeof env.screen === 'string' && <span style={chip}>{env.screen}</span>}
        {s.places.slice(0, 3).map(p => <span key={p} style={chip}>📍 {p}</span>)}
        {s.campaigns.slice(0, 3).map(p => <span key={p} style={chip}>✉ {p}</span>)}
      </div>

      {/* timeline */}
      {shown.length > 0 && (
        <div style={{ borderTop: '1px solid #f1f1f1', paddingTop: 6 }}>
          {shown.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '3px 0', lineHeight: 1.45, alignItems: 'baseline' }}>
              <span style={{ color: FAINT, width: 104, flexShrink: 0, fontSize: 11.5 }}>{when(t.at)}</span>
              <span style={{ color: t.kind === 'event' ? '#111827' : '#374151', fontWeight: t.kind === 'event' ? 600 : 400, minWidth: 0, overflowWrap: 'anywhere' }}>
                {t.text}{t.sub ? <span style={{ color: FAINT }}> · {t.sub}</span> : null}
              </span>
            </div>
          ))}
          {timeline.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} style={{ background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', fontSize: 12.5, color: GOLD_DEEP, fontWeight: 600 }}>
              Show all {timeline.length} items ▾
            </button>
          )}
        </div>
      )}
    </div>
  );
}
