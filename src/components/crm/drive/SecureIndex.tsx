'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DI from '@/components/crm/drive/DriveIcons';
import { secureState, type SecureStateKey } from '@/lib/secure-status';

// My Drive → Secure documents. An INDEX only: one line per private upload folder the signed-in person may see, with its
// status. The files themselves are deliberately not in My Drive (not searchable, not previewed, not shared, not read by
// Copilot) — a row opens the contact or deal, where the folder lives with its access list, activity log and auto-delete.

interface Row {
  id: string; client_id: string; deal_id: string | null; contact_name: string; deal_label: string | null;
  status: 'open' | 'revoked'; purged_at: string | null; expires_at: string; submitted_at: string | null; first_viewed_at: string | null; sent_at: string | null;
  created_at: string; last_upload_at: string | null; purge_after: string; keep_files: boolean; requested_by: string | null;
  file_count: number; items_total: number; items_done: number;
}
type Filter = 'all' | 'waiting' | 'received' | 'closed';
const GOLD = '#c9922c';
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const group = (k: SecureStateKey): Exclude<Filter, 'all'> => (k === 'received' || k === 'uploading' ? 'received' : k === 'deleted' || k === 'closed' || k === 'expired' ? 'closed' : 'waiting');

export default function SecureIndex({ authToken, businessUnit, isMobile, onOpenContact, onOpenDeal }: {
  authToken?: string; businessUnit: string; isMobile: boolean;
  onOpenContact?: (clientId: string) => void; onOpenDeal?: (dealId: string) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  // Cards instead of the table whenever THIS panel is narrow (a phone, or a small window beside the sidebars) — never a sideways scroll.
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = rootRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 660));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stacked = isMobile || narrow;

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await fetch(`/api/crm/secure-requests?all=1&business_unit=${encodeURIComponent(businessUnit)}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setFailed(true); setRows([]); return; }
      setRows(j.requests ?? []);
    } catch { setFailed(true); setRows([]); }
  }, [authToken, businessUnit]);
  useEffect(() => { void load(); }, [load]);

  const list = useMemo(() => (rows ?? [])
    .map(r => ({ r, st: secureState({ ...r, fileCount: r.file_count }) }))
    .sort((a, b) => (b.r.last_upload_at ?? b.r.created_at).localeCompare(a.r.last_upload_at ?? a.r.created_at)), [rows]);
  const counts = useMemo(() => {
    const c = { all: list.length, waiting: 0, received: 0, closed: 0 };
    for (const x of list) c[group(x.st.key)]++;
    return c;
  }, [list]);
  const shown = filter === 'all' ? list : list.filter(x => group(x.st.key) === filter);

  const open = (r: Row) => { if (r.deal_id && onOpenDeal) onOpenDeal(r.deal_id); else onOpenContact?.(r.client_id); };
  const progress = (r: Row) => {
    if (r.purged_at) return 'Files deleted';
    const files = `${r.file_count} file${r.file_count === 1 ? '' : 's'}`;
    return r.items_total ? `${r.items_done} of ${r.items_total} items · ${files}` : files;
  };
  const dates = (r: Row, key: SecureStateKey) => {
    if (r.purged_at) return `Deleted ${day(r.purged_at)}`;
    const keep = r.file_count ? (r.keep_files ? 'Files kept' : `Auto-deletes ${day(r.purge_after)}`) : '';
    const link = key === 'closed' || key === 'expired' ? '' : `Link until ${day(r.expires_at)}`;
    return [link, keep].filter(Boolean).join(' · ');
  };

  const chip = (k: Filter, label: string) => {
    const on = filter === k;
    return (
      <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={on}
        style={{ minHeight: isMobile ? 40 : 32, padding: '0 14px', borderRadius: 20, border: `1px solid ${on ? GOLD : 'var(--k-e5e7eb)'}`, background: on ? 'var(--k-fdf6e9)' : 'var(--k-fff)', color: on ? 'var(--k-a06a12)' : 'var(--k-374151)', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0, fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
        {label}<span style={{ fontWeight: 600, opacity: .7, marginLeft: 6 }}>{counts[k]}</span>
      </button>
    );
  };
  const pill = (st: { text: string; color: string; bg: string }) => (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: st.color, background: st.bg, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>{st.text}</span>
  );
  const tile = (
    <span aria-hidden style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--k-fdf6e9)', color: GOLD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><DI n="lock" size={18} /></span>
  );
  const cols = 'minmax(170px,2fr) 158px minmax(170px,1.5fr) 62px';

  return (
    <div ref={rootRef} style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ flex: '1 1 220px', fontSize: isMobile ? 16 : 17, fontWeight: 700, color: 'var(--k-1a1a1a)', padding: '6px 4px' }}>Secure documents</div>
        <button type="button" onClick={() => { setRows(null); void load(); }} style={{ height: isMobile ? 44 : 38, padding: '0 14px', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Refresh</button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--k-6b7280)', lineHeight: 1.5, margin: '0 4px 14px', maxWidth: 760 }}>
        Private upload folders you’ve asked tenants and buyers for. The files are kept out of My Drive on purpose — they aren’t searchable, previewed or shared here. Open a row to see the files on the contact or deal.
      </div>
      <div role="group" aria-label="Filter" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 12 }}>
        {chip('all', 'All')}{chip('waiting', 'Waiting')}{chip('received', 'Received')}{chip('closed', 'Closed')}
      </div>

      {rows === null ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading…</div>
      ) : failed ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--k-b91c1c)', fontSize: 14 }}>
          Couldn’t load the secure folders. <button type="button" onClick={() => { setRows(null); void load(); }} style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 12, padding: '36px 20px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', marginBottom: 10 }}>{tile}</div>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--k-1a1a1a)', marginBottom: 4 }}>No secure folders yet</div>
          <div style={{ fontSize: 13.5, color: 'var(--k-6b7280)', lineHeight: 1.55, maxWidth: 460, margin: '0 auto' }}>
            Ask someone for an application, ID or bank statements with the 🔒 button on the Contacts list, or from a deal’s Docs &amp; Sign tab. Each request shows up here with its status.
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--k-9ca3af)', fontSize: 14 }}>Nothing in this group.</div>
      ) : stacked ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(({ r, st }) => (
            <button key={r.id} type="button" onClick={() => open(r)}
              style={{ textAlign: 'left', background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 12, padding: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {tile}
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--k-1a1a1a)', overflowWrap: 'anywhere' }}>{r.contact_name}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--k-9ca3af)', margin: '1px 0 7px' }}>{[r.deal_label, `Asked ${day(r.created_at)}`].filter(Boolean).join(' · ')}</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{pill(st)}<span style={{ fontSize: 12.5, color: 'var(--k-374151)' }}>{progress(r)}</span></span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 5 }}>{dates(r, st.key)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div role="table" aria-label="Secure documents" style={{ background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 12, overflowX: 'auto' }}>
          <div style={{ minWidth: 600 }}>
            <div role="row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: '10px 16px', fontSize: 10.5, letterSpacing: .8, textTransform: 'uppercase', fontWeight: 700, color: 'var(--k-9ca3af)', borderBottom: '1px solid var(--k-eef0f2)' }}>
              <span>Requested from</span><span>Status</span><span>Received</span><span />
            </div>
            {shown.map(({ r, st }) => (
              <div key={r.id} role="row" tabIndex={0} onClick={() => open(r)} onKeyDown={e => { if (e.key === 'Enter') open(r); }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--k-fbf8f1)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: '10px 16px', borderTop: '1px solid var(--k-f4f5f7)', cursor: 'pointer' }}>
                <span style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                  {tile}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.contact_name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[r.deal_label, `Asked ${day(r.created_at)}`, r.requested_by ? `by ${r.requested_by}` : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
                <span>{pill(st)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--k-374151)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{progress(r)}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dates(r, st.key)}</span>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--k-a06a12)', textAlign: 'right', whiteSpace: 'nowrap' }}>Open →</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
