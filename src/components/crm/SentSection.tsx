'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Sent page (Zack, 2026-10-28): every email sent from the CRM with its open tracking: who opened, how often,
// and when last. Drafts have their own page (DraftsSection). Only rows with tracked = true carried a pixel.

const supabase = createClient();

type SentRow = {
  id: string; deal_id: string | null; client_id: string | null; from_email: string; to_email: string;
  cc_emails: string | null; subject: string; body: string | null; created_at: string;
  opened_at: string | null; last_opened_at: string | null; open_count: number | null;
};

const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const when = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toLocaleDateString('en-US', CT) === now.toLocaleDateString('en-US', CT);
  if (sameDay) return d.toLocaleTimeString('en-US', { ...CT, hour: 'numeric', minute: '2-digit' });
  const sameYear = d.toLocaleDateString('en-US', { ...CT, year: 'numeric' }) === now.toLocaleDateString('en-US', { ...CT, year: 'numeric' });
  return d.toLocaleDateString('en-US', { ...CT, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};
const whenLong = (iso: string) => new Date(iso).toLocaleString('en-US', { ...CT, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const firstAddr = (raw: string | null | undefined) => {
  const first = (raw ?? '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0]?.trim() ?? '';
  const m = first.match(/^"?(.*?)"?\s*<([^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: first };
};
// Logged bodies are plain text but can still carry entities (&nbsp; from the editor).
const snippet = (body: string) => body.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').slice(0, 120);
const opens = (r: SentRow) => r.open_count ?? (r.opened_at ? 1 : 0);
const initials = (s: string) => s.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '✉';

type Props = {
  isMobile: boolean;
  myAddresses: string[];
  nameFor: (email: string) => string | undefined;
  dealLabel: (id: string) => string | null;
  clientLabel: (id: string) => string | null;
  onOpenDeal: (id: string) => void;
  onOpenContact: (id: string) => void;
};

export default function SentSection(p: Props) {
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [sent, setSent] = useState<SentRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'opened' | 'unopened' | 'hot'>('all');
  const [sort, setSort] = useState<'sent' | 'opened' | 'opens'>('sent');
  const [q, setQ] = useState('');
  const addrKey = p.myAddresses.map(a => a.toLowerCase()).filter(Boolean).sort().join(',');
  useEffect(() => {
    let live = true;
    setSent(null);
    let query = supabase.from('crm_deal_emails')
      .select('id,deal_id,client_id,from_email,to_email,cc_emails,subject,body,created_at,opened_at,last_opened_at,open_count')
      .eq('direction', 'sent').eq('tracked', true)
      .order('created_at', { ascending: false }).limit(300);
    const addrs = addrKey.split(',').filter(Boolean);
    if (scope === 'mine' && addrs.length) query = query.or(addrs.map(a => `from_email.ilike.${a}`).join(','));
    query.then(({ data }) => { if (live) setSent((data ?? []) as SentRow[]); });
    return () => { live = false; };
  }, [scope, addrKey]);

  const shown = useMemo(() => {
    let rows = sent ?? [];
    if (filter === 'opened') rows = rows.filter(r => r.opened_at);
    if (filter === 'unopened') rows = rows.filter(r => !r.opened_at);
    if (filter === 'hot') rows = rows.filter(r => opens(r) >= 3);
    const needle = q.trim().toLowerCase();
    if (needle) rows = rows.filter(r => `${r.to_email} ${r.cc_emails ?? ''} ${r.subject} ${p.nameFor(firstAddr(r.to_email).email) ?? ''}`.toLowerCase().includes(needle));
    if (sort === 'opened') rows = [...rows].sort((a, b) => (b.last_opened_at ?? b.opened_at ?? '').localeCompare(a.last_opened_at ?? a.opened_at ?? ''));
    if (sort === 'opens') rows = [...rows].sort((a, b) => opens(b) - opens(a));
    return rows;
  }, [sent, filter, sort, q, p]);

  const stats = useMemo(() => {
    const rows = sent ?? [];
    const opened = rows.filter(r => r.opened_at).length;
    return {
      sent: rows.length, opened,
      pct: rows.length ? Math.round((opened / rows.length) * 100) : 0,
      total: rows.reduce((t, r) => t + opens(r), 0),
      hot: rows.filter(r => opens(r) >= 3).length,
    };
  }, [sent]);

  // ── bits ──
  const chip = (on: boolean): React.CSSProperties => ({
    padding: p.isMobile ? '8px 14px' : '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? '#111' : 'var(--k-e5e7eb)'}`, background: on ? '#111' : 'var(--k-fff)', color: on ? '#fff' : 'var(--k-374151)',
    fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  });
  const stat = (label: string, value: string, tone?: string) => (
    <div style={{ flex: '1 1 120px', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone ?? 'var(--k-111)', marginTop: 2 }}>{value}</div>
    </div>
  );
  const avatar = (label: string, warm = false) => (
    <div aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', background: warm ? '#c9922c' : '#475569' }}>{initials(label)}</div>
  );
  const context = (dealId: string | null, clientId: string | null) => {
    const deal = dealId ? p.dealLabel(dealId) : null;
    const contact = !deal && clientId ? p.clientLabel(clientId) : null;
    if (!deal && !contact) return null;
    return (
      <button type="button" onClick={e => { e.stopPropagation(); if (deal && dealId) p.onOpenDeal(dealId); else if (clientId) p.onOpenContact(clientId); }}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--k-a06a12)', fontWeight: 600, fontFamily: "'DM Sans',sans-serif", textAlign: 'left' }}>
        {deal ? `Deal · ${deal}` : `Contact · ${contact}`} →
      </button>
    );
  };
  const empty = (title: string, sub: string) => (
    <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px dashed var(--k-e5e7eb)', borderRadius: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-374151)' }}>{title}</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>{sub}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: p.isMobile ? '12px 12px 96px' : '20px 24px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--k-6b7280)' }}>Email sent from the CRM, with who opened it and when.</div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }} title="Opens are approximate: some mail apps load images automatically, and some block them.">
        {stat('Sent', sent ? String(stats.sent) : '—')}
        {stat('Opened', sent ? `${stats.opened} · ${stats.pct}%` : '—', stats.opened ? 'var(--k-065f46)' : undefined)}
        {stat('Total opens', sent ? String(stats.total) : '—')}
        {stat('Opened 3+ times', sent ? String(stats.hot) : '—', stats.hot ? 'var(--k-b45309)' : undefined)}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="crm-tabs-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
          {([['all', 'All'], ['opened', 'Opened'], ['unopened', 'Not opened'], ['hot', '🔥 3+ opens']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={chip(filter === v)}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: p.isMobile ? 0 : 'auto', flexWrap: 'wrap', width: p.isMobile ? '100%' : undefined }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search recipient or subject" aria-label="Search sent email"
            style={{ flex: p.isMobile ? '1 1 100%' : '0 1 220px', minWidth: 0, height: p.isMobile ? 42 : 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 14 }} />
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort"
            style={{ height: p.isMobile ? 42 : 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 8px', flex: p.isMobile ? 1 : undefined }}>
            <option value="sent">Newest sent</option>
            <option value="opened">Latest opened</option>
            <option value="opens">Most opens</option>
          </select>
          <select value={scope} onChange={e => setScope(e.target.value as typeof scope)} aria-label="Whose email"
            style={{ height: p.isMobile ? 42 : 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 8px', flex: p.isMobile ? 1 : undefined }}>
            <option value="mine">Sent by me</option>
            <option value="team">Whole team</option>
          </select>
        </div>
      </div>

      {sent === null ? <div style={{ color: 'var(--k-9ca3af)', fontSize: 14, padding: 24 }}>Loading sent email…</div>
      : shown.length === 0 ? (sent.length ? empty('Nothing matches', 'Try another filter or search.') : empty('No tracked email yet', 'Emails you send from a deal, a contact card or the Compose button show up here with their opens.'))
      : (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
          {shown.map((r, i) => {
            const a = firstAddr(r.to_email);
            const name = a.name || p.nameFor(a.email) || a.email;
            const n = opens(r);
            const more = (r.to_email.split(',').length - 1) + (r.cc_emails ? r.cc_emails.split(',').length : 0);
            return (
              <div key={r.id} onClick={() => { if (r.deal_id && p.dealLabel(r.deal_id)) p.onOpenDeal(r.deal_id); else if (r.client_id) p.onOpenContact(r.client_id); }}
                style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none', cursor: r.deal_id || r.client_id ? 'pointer' : 'default' }}>
                {avatar(name)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                      {name}{more > 0 && <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> +{more}</span>}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }} title={whenLong(r.created_at)}>{when(r.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--k-374151)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b style={{ fontWeight: 600 }}>{r.subject || '(no subject)'}</b>
                    {r.body && <span style={{ color: 'var(--k-9ca3af)' }}> — {snippet(r.body)}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
                    {r.opened_at ? (
                      <span title={`First opened ${whenLong(r.opened_at)}`} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: n >= 3 ? 'var(--k-fef3c7)' : 'var(--k-ecfdf5)', color: n >= 3 ? 'var(--k-92400e)' : 'var(--k-065f46)' }}>
                        {n >= 3 ? '🔥' : '👁'} Opened{n > 1 ? ` ${n}×` : ''} · {whenLong(r.last_opened_at ?? r.opened_at)}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--k-f3f4f6)', color: 'var(--k-9ca3af)' }}>Not opened</span>
                    )}
                    {context(r.deal_id, r.client_id)}
                    {scope === 'team' && <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>from {r.from_email}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {sent && sent.length >= 300 && <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 8 }}>Showing the latest 300.</div>}
    </div>
  );
}
