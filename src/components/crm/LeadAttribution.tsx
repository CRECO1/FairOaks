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

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

const GOLD = '#c9922c';
const GOLD_DEEP = '#9A6E18';
const INK = '#1A1A1A';
const MUTE = '#6b7280';
const FAINT = '#9ca3af';

interface Row { label: string; value: number }
interface HealthSite { site: string; total: number; withAttribution: number; pct: number | null }
interface CampaignRow { name: string; utm: string | null; sent: number; opens: number; clicks: number; leads: number }
interface JourneyStep { p: string; t: number }
interface RecentRow {
  name: string; date: string; source: string | null; site: string | null;
  channel: string | null; campaign: string | null; content: string | null;
  referrer: string | null; landing_page: string | null;
  journey: JourneyStep[] | null;
  time_on_site_sec: number | null;
  page_views: number | null;
}
interface Ga {
  status: { connected: boolean; reason?: string; detail?: string; via?: 'oauth' | 'service_account'; actionUrl?: string };
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

/** Seconds → "48s" / "4m 12s" / "1h 3m". Null for missing/negative. */
function fmtDur(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

/**
 * The ordered pages of a visit as chips, each showing how long they lingered
 * there. Dwell on a page is the gap to the next page view; on the final page
 * it runs to when they left (total time on site) — i.e. how long they sat on
 * the page they submitted from.
 */
function JourneyTrail({ steps, totalSec }: { steps: JourneyStep[]; totalSec: number | null }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {steps.map((s, i) => {
        const nextT = i + 1 < steps.length ? steps[i + 1].t : (totalSec != null ? totalSec * 1000 : null);
        const dwell = nextT != null ? fmtDur(Math.max(0, (nextT - s.t) / 1000)) : null;
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: FAINT }}>→</span>}
            <span style={{ fontSize: 12, color: '#374151', background: '#f6f2e9', border: '1px solid #ecdfc4', borderRadius: 5, padding: '2px 7px' }}>
              <span style={{ fontWeight: 600 }}>{s.p}</span>
              {dwell && <span style={{ color: MUTE }}> · {dwell}</span>}
            </span>
          </span>
        );
      })}
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

/** Shared look for the gold action button. */
const gaBtn: React.CSSProperties = {
  display: 'inline-block', background: GOLD, color: '#fff', border: 'none',
  borderRadius: 8, padding: '11px 18px', fontSize: 14, fontWeight: 700,
  cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textDecoration: 'none',
  lineHeight: 1.3, minHeight: 44,   // 44px keeps it a comfortable phone tap target
};

/**
 * GA connection control.
 *
 * The button does NOT navigate straight to /api/ga4/connect. The CRM
 * authenticates with a bearer token held in localStorage, and a plain
 * navigation sends only cookies — so the route would reject it. Instead it
 * asks the route for a freshly minted consent URL (?json=1, bearer attached)
 * and then sends the browser there. Still one tap, and it works on a phone
 * that has no SSR cookie.
 *
 * Every press mints a new single-use nonce server-side, so a half-finished
 * attempt can simply be repeated — there is no stale-link state to get stuck in.
 */
function ConnectGa({ detail, label, viewing, token, reason, actionUrl }: {
  detail?: string; label?: string; viewing?: string | null; token: string | null;
  reason?: string; actionUrl?: string;
}) {
  const covers = label ?? 'crecotx.com';
  const mismatch = viewing != null && viewing !== covers;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ga4/connect?json=1', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status === 401 || res.status === 403) { setError('Only the account owner can connect Google Analytics.'); setBusy(false); return; }
      if (!res.ok) { setError('Could not start the connection. Try again in a moment.'); setBusy(false); return; }
      const j = await res.json() as { url?: string };
      if (!j.url) { setError('No consent link came back. Try again.'); setBusy(false); return; }
      window.location.href = j.url;          // → Google consent screen
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  // The grant worked; only the Cloud project switch is left. One tap fixes it,
  // and no re-authorization is needed afterwards.
  const apiDisabled = reason === 'api_disabled' && !!actionUrl;

  return (
    <div style={{ ...card, borderLeft: `4px solid ${GOLD}`, background: '#fffdf7' }}>
      <div style={panelTitle}>Google Analytics — {covers}</div>
      <div style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.7 }}>
        Session and landing-page data — the traffic that <em>didn&apos;t</em> become a lead, which is
        what a conversion rate needs.
      </div>

      {apiDisabled ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>
            Your Google account is connected. One switch left: turn on the Analytics Data API
            in the Google Cloud project, then reload this page.
          </div>
          <a href={actionUrl} target="_blank" rel="noopener noreferrer" style={gaBtn}>Enable the Analytics Data API →</a>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <button onClick={connect} disabled={busy} style={{ ...gaBtn, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Opening Google…' : 'Connect Google Analytics'}
          </button>
          <div style={{ marginTop: 8, fontSize: 12.5, color: MUTE }}>
            Sends you to Google to approve read-only access. Sign in with the account that owns the {covers} property.
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: '#b00020' }}>{error}</div>}
      {mismatch && <div style={{ marginTop: 8, fontSize: 12.5, color: GOLD_DEEP }}>Viewing <strong>{viewing}</strong>; the connected property measures {covers}.</div>}
      {detail && !apiDisabled && <div style={{ marginTop: 8, fontSize: 12.5, color: MUTE }}>Status: {detail}</div>}
    </div>
  );
}

/** Connected badge with a quiet way to re-authorize. */
function GaConnected({ label, via, token }: { label: string; via?: string; token: string | null }) {
  const [busy, setBusy] = useState(false);
  async function reconnect() {
    setBusy(true);
    try {
      const res = await fetch('/api/ga4/connect?json=1', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const j = await res.json().catch(() => null) as { url?: string } | null;
      if (j?.url) { window.location.href = j.url; return; }
    } catch { /* fall through */ }
    setBusy(false);
  }
  return (
    <div style={{ ...card, borderLeft: `4px solid ${GOLD}`, marginBottom: 14, padding: '12px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, color: '#374151', flex: '1 1 260px' }}>
          <strong>Google Analytics — {label}</strong>
          <span style={{ color: '#1a7f37', fontWeight: 700 }}> · Connected ✓</span>
          {via === 'oauth' && <span style={{ color: MUTE }}> (Google sign-in)</span>}
          <span style={{ color: MUTE }}> · traffic for this site only. The panels above cover all three sites.</span>
        </div>
        <button onClick={reconnect} disabled={busy}
          style={{ background: 'none', border: `1px solid ${GOLD}`, color: GOLD_DEEP, borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif", minHeight: 34 }}>
          {busy ? 'Opening…' : 'Reconnect'}
        </button>
      </div>
    </div>
  );
}

interface LiveFeedItem { sid: string; site: string; path: string; title: string | null; source: string; loc: string | null; device: string | null; at: string }
interface LiveData { now: string; activeCount: number; activeBySite: { label: string; value: number }[]; last30min: number; feed: LiveFeedItem[] }

/** Relative "time ago" for the live feed — coarse, recomputed on each poll. */
function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}
const siteShort = (host: string) => host.replace(/\.com$/, '').replace('fairoaksrealtygroup', 'Fair Oaks').replace('crecotx', 'CRECO').replace('elkhornpoint', 'Elkhorn');

export default function LeadAttribution({ authToken, isMobile }: { authToken: string | null; isMobile: boolean }) {
  const token = authToken;
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [site, setSite] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);   // which recent-lead row is showing its visit path
  // ── Live: poll silently every 15s and flash the leads that arrived since the last poll ──
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set());
  const [lastRefreshed, setLastRefreshed] = useState<number>(() => Date.now());
  const lastTopDateRef = useRef<string>('');   // created_at of the newest lead at the previous poll
  const firstLoadRef = useRef(true);           // don't flash the whole list on first paint or a window switch
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (d: number, s: string | null, silent = false) => {
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const qs = `days=${d}` + (s ? `&site=${encodeURIComponent(s)}` : '');
      const res = await fetch(`/api/crm/lead-attribution?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (res.status === 403) { setErr('Lead attribution is limited to the account owner.'); setData(null); return; }
      if (!res.ok) { if (!silent) { setErr('Could not load lead attribution.'); setData(null); } return; }
      const payload: Payload = await res.json();
      const recent = payload.recent ?? [];
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
      } else {
        const prevTop = lastTopDateRef.current;
        const fresh = new Set<string>();
        for (const r of recent) if (r.date && r.date > prevTop) fresh.add(`${r.name}|${r.date}`);
        if (fresh.size) {
          setNewKeys(fresh);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setNewKeys(new Set()), 12000);
        }
      }
      if (recent[0]?.date) lastTopDateRef.current = recent[0].date;
      setData(payload);
      setLastRefreshed(Date.now());
    } catch { if (!silent) setErr('Could not load lead attribution.'); }
    finally { if (!silent) setLoading(false); }
  }, [token]);

  // Load on mount and whenever the window/site changes — treated as a fresh view (no flash).
  useEffect(() => { firstLoadRef.current = true; load(days, site); }, [load, days, site]);

  // Live: silent background poll so new leads surface on their own.
  useEffect(() => {
    const t = setInterval(() => load(days, site, true), 15000);
    return () => clearInterval(t);
  }, [load, days, site]);

  // Clear any pending "new lead" flash timer on unmount.
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // ── Live activity ("who's on the site now") — its own faster poll (12s) ──
  const [live, setLive] = useState<LiveData | null>(null);
  const [liveFresh, setLiveFresh] = useState<Set<string>>(new Set());
  const liveTopAtRef = useRef<string>('');
  const liveFirstRef = useRef(true);
  const liveFlash = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadLive = useCallback(async (s: string | null) => {
    try {
      const qs = s ? `?site=${encodeURIComponent(s)}` : '';
      const res = await fetch(`/api/crm/live-activity${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!res.ok) return;
      const d: LiveData = await res.json();
      const feed = d.feed ?? [];
      if (liveFirstRef.current) {
        liveFirstRef.current = false;
      } else {
        const prev = liveTopAtRef.current;
        const fresh = new Set<string>();
        for (const f of feed) if (f.at > prev) fresh.add(`${f.sid}|${f.at}`);
        if (fresh.size) {
          setLiveFresh(fresh);
          if (liveFlash.current) clearTimeout(liveFlash.current);
          liveFlash.current = setTimeout(() => setLiveFresh(new Set()), 6000);
        }
      }
      if (feed[0]?.at) liveTopAtRef.current = feed[0].at;
      setLive(d);
    } catch { /* live panel is best-effort */ }
  }, [token]);

  useEffect(() => {
    liveFirstRef.current = true;
    loadLive(site);
    const t = setInterval(() => loadLive(site), 12000);
    return () => clearInterval(t);
  }, [loadLive, site]);
  useEffect(() => () => { if (liveFlash.current) clearTimeout(liveFlash.current); }, []);

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
        {[7, 30, 90, 365].map(d => (
          <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} style={{ ...pill(days === d), borderRadius: 6 }}>
            {d === 365 ? '1 year' : `${d} days`}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <style>{`@keyframes laPulse{0%,100%{opacity:1}50%{opacity:.28}}`}</style>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: '#16a34a', fontWeight: 700 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: '#16a34a', animation: 'laPulse 1.5s infinite' }} />
            Live
          </span>
          {newKeys.size > 0 && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>· {newKeys.size} just arrived</span>}
          <span style={{ fontSize: 11, color: FAINT }}>
            {loading ? 'updating…' : `updated ${new Date(lastRefreshed).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`}
          </span>
        </span>
      </div>

      {/* ── RIGHT NOW: live first-party activity feed ── */}
      <div style={{ background: INK, borderRadius: 12, padding: isMobile ? '16px 16px' : '18px 22px', marginBottom: 14, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'center' }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: '#22c55e', animation: 'laPulse 1.5s infinite' }} />
            <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.6)', fontWeight: 700 }}>Right now</span>
          </span>
          <span style={{ fontFamily: serif, fontSize: isMobile ? 34 : 42, fontWeight: 700, lineHeight: 1, color: '#22c55e' }}>{live?.activeCount ?? 0}</span>
          <span style={{ fontSize: 13.5, color: 'rgba(255,255,255,.7)', alignSelf: 'center' }}>
            {(live?.activeCount === 1 ? 'visitor' : 'visitors')} on {site ? siteShort(site) : 'the sites'} now
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignSelf: 'center' }}>
            {(live?.activeBySite ?? []).map(b => (
              <span key={b.label} style={{ fontSize: 11.5, color: 'rgba(255,255,255,.8)', background: 'rgba(255,255,255,.08)', padding: '3px 9px', borderRadius: 999 }}>{siteShort(b.label)} · {b.value}</span>
            ))}
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', alignSelf: 'center' }}>{live?.last30min ?? 0} views · 30 min</span>
          </span>
        </div>
        {(!live || live.feed.length === 0) ? (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)' }}>
            {live ? 'No activity in the last 30 minutes — pageviews appear here the instant someone browses either site.' : 'Loading live activity…'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: isMobile ? 240 : 290, overflowY: 'auto' }}>
            {live.feed.map((f, i) => {
              const fresh = liveFresh.has(`${f.sid}|${f.at}`);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', borderRadius: 6, background: fresh ? 'rgba(34,197,94,.16)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,.06)', transition: 'background .5s' }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', width: 42, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{ago(f.at)}</span>
                  <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,.6)', background: 'rgba(255,255,255,.08)', padding: '1px 6px', borderRadius: 4, flexShrink: 0, whiteSpace: 'nowrap' }}>{siteShort(f.site)}</span>
                  <span style={{ fontSize: 12.5, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 60 }} title={f.title || f.path}>{f.path}</span>
                  {!isMobile && <span style={{ fontSize: 11.5, color: GOLD, flexShrink: 0, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.source}>{f.source}</span>}
                  {!isMobile && f.loc && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.loc}</span>}
                  <span style={{ fontSize: 11, flexShrink: 0 }}>{f.device === 'mobile' ? '📱' : f.device === 'tablet' ? '📲' : '💻'}</span>
                </div>
              );
            })}
          </div>
        )}
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
      {!gaOn ? (
        <ConnectGa detail={ga?.status?.detail} label={ga?.label} viewing={site} token={token}
                   reason={ga?.status?.reason} actionUrl={ga?.status?.actionUrl} />
      ) : (
        <>
          <GaConnected label={ga.label} via={ga?.status?.via} token={token} />
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
            {data.recent.map((r, i) => {
              const pv = r.page_views ?? (r.journey ? r.journey.length : null);
              const dur = fmtDur(r.time_on_site_sec);
              const hasJourney = !!(r.journey && r.journey.length);
              const open = expanded === i;
              const isNew = newKeys.has(`${r.name}|${r.date}`);
              return (
                <div key={i} style={{ borderBottom: '1px solid #f1f1f1', paddingBottom: 9, ...(isNew ? { background: '#fffbeb', borderLeft: '3px solid #16a34a', paddingLeft: 10, marginLeft: -10 } : {}) }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>
                    {r.name}
                    {isNew && <span style={{ marginLeft: 7, fontSize: 9, letterSpacing: 0.5, fontWeight: 800, color: '#fff', background: '#16a34a', padding: '1px 6px', borderRadius: 999 }}>NEW</span>}
                  </div>
                  <div style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>
                    {r.date ? new Date(r.date).toLocaleDateString() : '—'} · {r.site ?? '—'} · {r.source ?? '—'}
                  </div>
                  <div style={{ fontSize: 12, color: r.channel ? GOLD_DEEP : FAINT, marginTop: 2, fontWeight: r.channel ? 600 : 400 }}>
                    {r.channel ?? 'no source recorded'}{r.campaign ? ` · ${r.campaign}` : ''}
                  </div>
                  {(hasJourney || dur) && (
                    <button type="button" onClick={() => hasJourney && setExpanded(open ? null : i)}
                      style={{ marginTop: 5, background: 'none', border: 'none', padding: 0, cursor: hasJourney ? 'pointer' : 'default', fontSize: 12, color: GOLD_DEEP, fontWeight: 600 }}>
                      {pv != null ? `${pv} ${pv === 1 ? 'page' : 'pages'}` : ''}{dur ? `${pv != null ? ' · ' : ''}${dur} on site` : ''}{hasJourney ? ` ${open ? '▾' : '▸'}` : ''}
                    </button>
                  )}
                  {open && hasJourney && (
                    <div style={{ marginTop: 6 }}><JourneyTrail steps={r.journey!} totalSec={r.time_on_site_sec} /></div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: MUTE }}>
                  {['Name', 'Date', 'Site', 'Form', 'Channel', 'Campaign', 'Landing page', 'Pages · time on site'].map(h => (
                    <th key={h} style={{ padding: '6px 10px 8px 0', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => {
                  const pv = r.page_views ?? (r.journey ? r.journey.length : null);
                  const dur = fmtDur(r.time_on_site_sec);
                  const hasJourney = !!(r.journey && r.journey.length);
                  const open = expanded === i;
                  const isNew = newKeys.has(`${r.name}|${r.date}`);
                  const td: React.CSSProperties = { padding: '7px 10px 7px 0', borderBottom: '1px solid #f5f5f5' };
                  return (
                    <Fragment key={i}>
                      <tr onClick={hasJourney ? () => setExpanded(open ? null : i) : undefined} style={{ ...(hasJourney ? { cursor: 'pointer' } : {}), ...(isNew ? { background: '#fffbeb' } : {}) }}>
                        <td style={{ ...td, fontWeight: 600, color: INK, boxShadow: isNew ? 'inset 3px 0 0 #16a34a' : undefined }}>
                          {r.name}
                          {isNew && <span style={{ marginLeft: 7, fontSize: 9, letterSpacing: 0.5, fontWeight: 800, color: '#fff', background: '#16a34a', padding: '1px 6px', borderRadius: 999 }}>NEW</span>}
                        </td>
                        <td style={{ ...td, color: MUTE, whiteSpace: 'nowrap' }}>{r.date ? new Date(r.date).toLocaleDateString() : '—'}</td>
                        <td style={{ ...td, color: '#374151', whiteSpace: 'nowrap' }}>{r.site ?? '—'}</td>
                        <td style={{ ...td, color: '#374151' }}>{r.source ?? '—'}</td>
                        <td style={{ ...td, color: r.channel ? GOLD_DEEP : FAINT, fontWeight: r.channel ? 600 : 400 }}>{r.channel ?? 'not recorded'}</td>
                        <td style={{ ...td, color: '#374151' }}>{r.campaign ?? '—'}</td>
                        <td style={{ ...td, color: MUTE, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.landing_page ?? ''}>{r.landing_page ?? '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {hasJourney ? (
                            <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(open ? null : i); }}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: GOLD_DEEP, fontWeight: 600 }}>
                              {pv} {pv === 1 ? 'page' : 'pages'}{dur ? ` · ${dur}` : ''} <span style={{ color: FAINT }}>{open ? '▾' : '▸'}</span>
                            </button>
                          ) : dur ? <span style={{ color: MUTE }}>{dur}</span> : <span style={{ color: FAINT }}>—</span>}
                        </td>
                      </tr>
                      {open && hasJourney && (
                        <tr>
                          <td colSpan={8} style={{ padding: '0 10px 12px 0', borderBottom: '1px solid #f5f5f5', background: '#fcfbf8' }}>
                            <div style={{ fontSize: 11, color: MUTE, margin: '2px 0 6px' }}>
                              Entered on <strong style={{ color: '#374151' }}>{r.journey![0].p}</strong>
                              {dur ? ` · ${dur} on site before submitting` : ''}
                            </div>
                            <JourneyTrail steps={r.journey!} totalSec={r.time_on_site_sec} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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
