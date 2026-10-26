'use client';
// Plaza Site > SEO & AI: which AI assistants and search engines are reading fairoaksranchplaza.com, plus the off-site to-do list.
import React, { useEffect, useState } from 'react';

interface Data { bots: { bot: string; ai: boolean; d7: number; d30: number; last: string }[]; topPaths: { path: string; hits: number }[]; recent: { bot: string; path: string; created_at: string }[]; total30: number }
const box: React.CSSProperties = { background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: 'var(--k-9ca3af)', padding: '6px 8px' };
const td: React.CSSProperties = { padding: '7px 8px', fontSize: 14, borderTop: '1px solid var(--k-f3f4f6)' };
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

const TODO: [string, string][] = [
  ['Google Business Profile for the plaza', 'Claim and verify it (postcard or call), add the plaza photos, link fairoaksranchplaza.com. The single biggest local-search lever.'],
  ['Business profiles for each tenant', 'Ask each owner to link their Google Business Profile and Facebook/Instagram to their plaza page, and use the same name, address and phone everywhere.'],
  ['Bing Webmaster Tools', 'Import the site from Google Search Console so Bing (which feeds ChatGPT search and Copilot) sees the sitemap.'],
  ['Apple Business Connect', 'Claim the plaza so Apple Maps and Siri show the right details.'],
  ['OpenStreetMap', 'Add or correct the plaza and its businesses on OpenStreetMap; many assistants and apps read it.'],
  ['Local mentions and links', 'Get the plaza listed by the City, the Boerne/Fair Oaks Ranch chamber, Nextdoor and neighborhood groups. Mentions from trusted local sites are what assistants cite.'],
];

export default function PlazaSeo({ authToken }: { authToken?: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!authToken) return;
    fetch('/api/crm/site-bots', { headers: { Authorization: `Bearer ${authToken}` } }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) setErr(j.error || 'Could not load'); else setD(j); }).catch(() => setErr('Could not load'));
  }, [authToken]);
  const ai = (d?.bots ?? []).filter(b => b.ai); const se = (d?.bots ?? []).filter(b => !b.ai);
  const table = (rows: Data['bots'], empty: string) => rows.length === 0 ? <div style={{ color: 'var(--k-9ca3af)', fontSize: 14, padding: '6px 8px' }}>{empty}</div> : (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Crawler</th><th style={th}>7 days</th><th style={th}>30 days</th><th style={th}>Last seen</th></tr></thead>
      <tbody>{rows.map(b => <tr key={b.bot}><td style={{ ...td, fontWeight: 700 }}>{b.bot}</td><td style={td}>{b.d7}</td><td style={td}>{b.d30}</td><td style={td}>{ago(b.last)}</td></tr>)}</tbody></table>
  );
  return (
    <div>
      <div style={{ ...box, background: 'var(--k-f0fdf4)', borderColor: 'var(--k-bbf7d0)', color: 'var(--k-166534)', fontSize: 14 }}>
        Counts crawler visits to fairoaksranchplaza.com (by user-agent only). People who click through from ChatGPT, Perplexity or Claude show up in <b>Lead Attribution</b> under the AI channel.
      </div>
      {err && <div style={{ ...box, color: 'var(--k-b91c1c)' }}>{err}</div>}
      {!d && !err && <div style={{ color: 'var(--k-9ca3af)' }}>Loading…</div>}
      {d && (<>
        <div style={box}><div style={{ fontWeight: 800, marginBottom: 6 }}>AI assistants &amp; AI crawlers</div>{table(ai, 'None yet. They usually find a new site within days to weeks. Submitting to Bing and getting links speeds it up.')}</div>
        <div style={box}><div style={{ fontWeight: 800, marginBottom: 6 }}>Search engines</div>{table(se, 'None yet.')}</div>
        {d.topPaths.length > 0 && <div style={box}><div style={{ fontWeight: 800, marginBottom: 6 }}>Pages AI crawlers read most (30 days)</div>{d.topPaths.map(p => <div key={p.path} style={{ ...td, display: 'flex', justifyContent: 'space-between' }}><span>{p.path}</span><b>{p.hits}</b></div>)}</div>}
        {d.recent.length > 0 && <div style={box}><div style={{ fontWeight: 800, marginBottom: 6 }}>Latest visits</div>{d.recent.map((r, i) => <div key={i} style={{ ...td, fontSize: 13 }}><b>{r.bot}</b> · {r.path} · <span style={{ color: 'var(--k-9ca3af)' }}>{ago(r.created_at)}</span></div>)}</div>}
      </>)}
      <div style={box}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Off-site to-do (needs you)</div>
        {TODO.map(([t, x]) => <div key={t} style={{ padding: '8px 0', borderTop: '1px solid var(--k-f3f4f6)' }}><div style={{ fontWeight: 700, fontSize: 14 }}>{t}</div><div style={{ fontSize: 13, color: 'var(--k-6b7280)' }}>{x}</div></div>)}
      </div>
    </div>
  );
}
