'use client';

import { useCallback, useEffect, useState } from 'react';

// Admin-only "System Health" card for the dashboard. Surfaces the integrations
// the CRM quietly depends on (broker crawl, Gmail, Anthropic API) so an outage
// is visible at a glance instead of being discovered days later.

interface Health {
  checkedAt: string;
  brokerCrawl: { status: Status; note: string; lastIngestAt: string | null; hoursSince: number | null; propertyCount: number | null };
  gmail: { connected: boolean };
  anthropic: { status: 'ok' | 'low_credit' | 'error'; detail?: string };
}
type Status = 'ok' | 'warn' | 'error';

const DOT: Record<Status, string> = { ok: '#16a34a', warn: '#d97706', error: '#dc2626' };
const LABEL: Record<Status, string> = { ok: 'Healthy', warn: 'Attention', error: 'Down' };

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function IntegrationHealthCard({ authToken }: { authToken?: string }) {
  const [h, setH] = useState<Health | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(() => {
    setState('loading');
    fetch('/api/crm/integration-health', { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: Health) => { setH(d); setState('ready'); })
      .catch(() => setState('error'));
  }, [authToken]);
  useEffect(() => { load(); }, [load]);

  const row = (dot: Status, name: string, detail: string, extra?: string) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderTop: '1px solid #f1f2f4' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: DOT[dot], marginTop: 5, flex: '0 0 auto', boxShadow: `0 0 0 3px ${DOT[dot]}22` }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1f2937' }}>{name}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: DOT[dot], textTransform: 'uppercase', letterSpacing: .3 }}>{LABEL[dot]}</span>
          {extra && <span style={{ fontSize: 11.5, color: '#9ca3af', marginLeft: 'auto' }}>{extra}</span>}
        </div>
        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2, lineHeight: 1.4 }}>{detail}</div>
      </div>
    </div>
  );

  const anthStatus: Status = !h ? 'warn' : h.anthropic.status === 'ok' ? 'ok' : h.anthropic.status === 'low_credit' ? 'error' : 'warn';
  const anthDetail = !h ? '' : h.anthropic.status === 'ok' ? 'Credits available; listing extraction can run.'
    : h.anthropic.status === 'low_credit' ? 'Credit balance too low — top up at console.anthropic.com → Billing.'
    : (h.anthropic.detail || 'Unexpected API error.');

  return (
    <div style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 14, padding: '16px 18px', boxShadow: '0 1px 2px rgba(0,0,0,.04)', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 19, fontWeight: 600, color: '#1a1a1a' }}>System Health</span>
        <button onClick={load} title="Re-check" style={{ marginLeft: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: '#6b7280', cursor: 'pointer' }}>
          {state === 'loading' ? '…' : '↻ Re-check'}
        </button>
      </div>

      {state === 'error' && <div style={{ fontSize: 12.5, color: '#dc2626', padding: '8px 0' }}>Couldn&apos;t load health status.</div>}
      {state === 'loading' && !h && <div style={{ fontSize: 12.5, color: '#9ca3af', padding: '8px 0' }}>Checking integrations…</div>}

      {h && (
        <div>
          {row(h.brokerCrawl.status, 'Broker Property Crawl', h.brokerCrawl.note,
            `${h.brokerCrawl.propertyCount ?? '—'} listings · last ${ago(h.brokerCrawl.lastIngestAt)}`)}
          {row(h.gmail.connected ? 'ok' : 'error', 'Gmail (Property DB folder)',
            h.gmail.connected ? 'Connected — the crawl can read listing emails.' : 'Not connected — reconnect Gmail in settings.')}
          {row(anthStatus, 'Anthropic API (extraction)', anthDetail)}
          <div style={{ fontSize: 11, color: '#b6bcc4', marginTop: 8 }}>Checked {ago(h.checkedAt)}</div>
        </div>
      )}
    </div>
  );
}
