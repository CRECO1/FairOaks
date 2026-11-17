'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DI from '@/components/crm/drive/DriveIcons';
import { secureState, type SecureStateKey } from '@/lib/secure-status';
import SecureDocs from '@/components/crm/SecureDocs';
import type { DrivePerson } from '@/components/crm/drive/DocsDrive';

// My Drive → Secure documents: every secure folder the signed-in person may see — the ones made by asking a contact for
// documents, and folders they create here themselves. Opening a row shows that folder in place (its files, who can see it,
// its link and password, its activity log). These folders are deliberately NOT ordinary Drive folders: nothing in them is
// searchable, previewed on hover, shared by Drive's sharing, or read by Copilot.

interface Row {
  id: string; client_id: string | null; deal_id: string | null; contact_name: string; deal_label: string | null;
  status: 'open' | 'revoked'; purged_at: string | null; expires_at: string; submitted_at: string | null; first_viewed_at: string | null; sent_at: string | null;
  created_at: string; last_upload_at: string | null; purge_after: string; keep_files: boolean; requested_by: string | null;
  file_count: number; items_total: number; items_done: number;
  kind?: 'request' | 'folder'; has_password?: boolean; guest_view?: boolean;
}
type Filter = 'all' | 'folders' | 'waiting' | 'received' | 'closed';
const GOLD = '#c9922c';
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const group = (k: SecureStateKey, kind?: string): Exclude<Filter, 'all'> => (k === 'deleted' ? 'closed' : kind === 'folder' ? 'folders' : k === 'received' || k === 'uploading' ? 'received' : k === 'closed' || k === 'expired' ? 'closed' : 'waiting');
const WORDS = ['Maple', 'River', 'Cedar', 'Stone', 'Amber', 'Field', 'Harbor', 'Canyon', 'Meadow', 'Summit', 'Prairie', 'Juniper', 'Copper', 'Willow', 'Falcon', 'Garnet', 'Lantern', 'Orchard', 'Pebble', 'Quartz', 'Ranch', 'Saddle', 'Timber', 'Valley', 'Wagon', 'Yarrow', 'Bluff', 'Creek', 'Dune', 'Ember', 'Grove', 'Mesa'];
function makePassword(): string { const n = new Uint32Array(3); crypto.getRandomValues(n); return `${WORDS[n[0] % WORDS.length]}-${WORDS[n[1] % WORDS.length]}-${String(1000 + (n[2] % 9000))}`; }

export default function SecureIndex({ authToken, businessUnit, isMobile, onOpenContact, onOpenDeal, userId, role, profiles, onToast, createSignal }: {
  authToken?: string; businessUnit: string; isMobile: boolean;
  onOpenContact?: (clientId: string) => void; onOpenDeal?: (dealId: string) => void;
  userId?: string; role?: string | null; profiles?: DrivePerson[]; onToast: (m: string) => void;
  /** Bumped by My Drive's "+ New → Secure folder" to open the create form. */
  createSignal?: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [mkName, setMkName] = useState('');
  const [mkPw, setMkPw] = useState('');
  const [mkView, setMkView] = useState(true);
  const [mkBusy, setMkBusy] = useState(false);
  const [justMade, setJustMade] = useState<{ id: string; password: string; link: string | null } | null>(null);
  useEffect(() => { if (createSignal) { setOpenId(null); setMaking(true); } }, [createSignal]);
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
    .map(r => ({ r, st: secureState({ ...r, fileCount: r.file_count }) }))   // (kind rides along in r)
    .sort((a, b) => (b.r.last_upload_at ?? b.r.created_at).localeCompare(a.r.last_upload_at ?? a.r.created_at)), [rows]);
  const counts = useMemo(() => {
    const c = { all: list.length, folders: 0, waiting: 0, received: 0, closed: 0 };
    for (const x of list) c[group(x.st.key, x.r.kind)]++;
    return c;
  }, [list]);
  const shown = filter === 'all' ? list : list.filter(x => group(x.st.key, x.r.kind) === filter);

  const open = (r: Row) => { setJustMade(j => (j?.id === r.id ? j : null)); setOpenId(r.id); };
  const sub2 = (r: Row) => (r.kind === 'folder'
    ? ['Folder', `Created ${day(r.created_at)}`, r.requested_by ? `by ${r.requested_by}` : '', r.has_password ? '🔑 password' : ''].filter(Boolean).join(' · ')
    : [r.deal_label, `Asked ${day(r.created_at)}`, r.requested_by ? `by ${r.requested_by}` : '', r.has_password ? '🔑 password' : ''].filter(Boolean).join(' · '));

  const makeFolder = async () => {
    const name = mkName.trim();
    if (!name) { onToast('Give the folder a name.'); return; }
    if (mkPw && mkPw.length < 8) { onToast('Use a password of at least 8 characters, or leave it blank.'); return; }
    setMkBusy(true);
    try {
      const r = await fetch('/api/crm/secure-requests', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ action: 'create_folder', name, business_unit: businessUnit, ...(mkPw ? { password: mkPw, guestView: mkView } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { onToast(j.error || 'Could not create the folder'); return; }
      const made = j.request as { id: string; link: string | null };
      setJustMade(mkPw ? { id: made.id, password: mkPw, link: made.link } : null);
      setMaking(false); setMkName(''); setMkPw(''); setMkView(true);
      setOpenId(made.id);
      void load();
    } finally { setMkBusy(false); }
  };
  const copyText = async (t: string, what: string) => { try { await navigator.clipboard.writeText(t); onToast(`${what} copied`); } catch { onToast('Could not copy — select it and copy'); } };
  const progress = (r: Row) => {
    if (r.purged_at) return 'Files deleted';
    const files = `${r.file_count} file${r.file_count === 1 ? '' : 's'}`;
    return r.items_total && r.kind !== 'folder' ? `${r.items_done} of ${r.items_total} items · ${files}` : files;
  };
  const dates = (r: Row, key: SecureStateKey) => {
    if (r.purged_at) return `Deleted ${day(r.purged_at)}`;
    const keep = r.file_count ? (r.keep_files ? 'Files kept' : `Auto-deletes ${day(r.purge_after)}`) : '';
    const link = key === 'closed' || key === 'expired' || key === 'private' ? '' : `Link until ${day(r.expires_at)}`;
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

  const hBtn: React.CSSProperties = { height: isMobile ? 44 : 38, padding: '0 14px', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' };
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', minHeight: isMobile ? 44 : 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--k-e5e7eb)', fontSize: isMobile ? 16 : 14, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)' };

  // ── One folder, opened in place ──
  if (openId) {
    const row = (rows ?? []).find(r => r.id === openId);
    return (
      <div ref={rootRef} style={{ fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" onClick={() => { setOpenId(null); setJustMade(null); void load(); }} style={hBtn}>← Secure documents</button>
          <div style={{ flex: '1 1 200px', minWidth: 0, fontSize: isMobile ? 16 : 17, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: GOLD, display: 'inline-flex' }}><DI n="lock" size={18} /></span>{row?.contact_name ?? 'Secure folder'}
          </div>
          {row && row.kind !== 'folder' && (row.deal_id && onOpenDeal
            ? <button type="button" style={hBtn} onClick={() => onOpenDeal(row.deal_id!)}>Open the deal</button>
            : row.client_id && onOpenContact ? <button type="button" style={hBtn} onClick={() => onOpenContact(row.client_id!)}>Open the contact</button> : null)}
        </div>
        {justMade?.id === openId && (
          <div role="status" style={{ background: 'var(--k-fdf6e9)', border: '1px solid #f0e2c4', borderRadius: 12, padding: '12px 14px', marginBottom: 12, fontSize: 13.5, color: 'var(--k-374151)', lineHeight: 1.55 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Folder created. Anyone outside the team needs BOTH of these:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' }}>
              <span>1. The link</span>{justMade.link && <button type="button" style={{ ...hBtn, height: 32 }} onClick={() => void copyText(justMade.link!, 'Link')}>Copy link</button>}
              <span style={{ marginLeft: 8 }}>2. The password <code style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 6, padding: '2px 8px', fontSize: 14 }}>{justMade.password}</code></span>
              <button type="button" style={{ ...hBtn, height: 32 }} onClick={() => void copyText(justMade.password, 'Password')}>Copy password</button>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--k-a06a12)' }}>Send them separately: the link by email or text, the password by phone. Capitals, spaces and dashes don’t matter when they type it. This is the only time the password is shown — afterwards it can only be replaced.</div>
          </div>
        )}
        <SecureDocs requestId={openId} authToken={authToken} userId={userId} role={role} profiles={profiles} showToast={onToast} onChanged={() => void load()} />
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ flex: '1 1 220px', fontSize: isMobile ? 16 : 17, fontWeight: 700, color: 'var(--k-1a1a1a)', padding: '6px 4px' }}>Secure documents</div>
        <button type="button" onClick={() => { setRows(null); void load(); }} style={hBtn}>Refresh</button>
        <button type="button" onClick={() => setMaking(m => !m)} style={{ ...hBtn, border: 'none', background: GOLD, color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 7 }}>{making ? 'Cancel' : <><DI n="plus" size={16} />New secure folder</>}</button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--k-6b7280)', lineHeight: 1.5, margin: '0 4px 14px', maxWidth: 760 }}>
        Private folders for sensitive paperwork: the ones you’ve asked tenants and buyers to upload to, and folders you make yourself. They’re kept apart from the rest of My Drive on purpose — nothing in them is searchable, previewed or shared the ordinary way, and every open is logged.
      </div>
      {making && (
        <form onSubmit={e => { e.preventDefault(); void makeFolder(); }} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-eef0f2)', borderRadius: 12, padding: 14, marginBottom: 14, maxWidth: 560 }}>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--k-374151)', marginBottom: 5 }}>Folder name</label>
          <input value={mkName} onChange={e => setMkName(e.target.value)} maxLength={80} autoFocus placeholder="e.g. Suite 3118 — tenant financials" style={{ ...field, marginBottom: 12 }} />
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--k-374151)', marginBottom: 5 }}>Password for people outside the team <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}>(optional)</span></label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input value={mkPw} onChange={e => setMkPw(e.target.value)} type="text" autoComplete="off" placeholder="8+ characters — leave blank to keep it team-only" style={{ ...field, flex: 1, minWidth: 0 }} />
            <button type="button" onClick={() => setMkPw(makePassword())} style={hBtn}>Suggest</button>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', lineHeight: 1.5, marginBottom: 10 }}>
            {mkPw ? 'A private link is made with the folder. To get in, someone needs the link AND this password.' : 'With no password the folder has no link at all: only you, the broker and agents you add can open it. You can add a password later.'}
          </div>
          {mkPw && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, marginBottom: 12, color: 'var(--k-1a1a1a)' }}>
              <input type="checkbox" checked={mkView} onChange={e => setMkView(e.target.checked)} /> With the password they can open the files, not just add their own
            </label>
          )}
          <button type="submit" disabled={mkBusy || !mkName.trim()} style={{ ...hBtn, border: 'none', background: mkName.trim() ? 'var(--k-111)' : 'var(--k-e5e7eb)', color: mkName.trim() ? 'var(--k-fff)' : 'var(--k-9ca3af)' }}>{mkBusy ? 'Creating…' : 'Create folder'}</button>
        </form>
      )}
      <div role="group" aria-label="Filter" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 12 }}>
        {chip('all', 'All')}{chip('folders', 'My folders')}{chip('waiting', 'Waiting')}{chip('received', 'Received')}{chip('closed', 'Closed')}
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
            Make one with <strong>New secure folder</strong> above, or ask someone for an application, ID or bank statements with the 🔒 button on the Contacts list or a deal’s Docs &amp; Sign tab.
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
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--k-9ca3af)', margin: '1px 0 7px' }}>{sub2(r)}</span>
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
              <span>Folder</span><span>Status</span><span>Files</span><span />
            </div>
            {shown.map(({ r, st }) => (
              <div key={r.id} role="row" tabIndex={0} onClick={() => open(r)} onKeyDown={e => { if (e.key === 'Enter') open(r); }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--k-fbf8f1)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: '10px 16px', borderTop: '1px solid var(--k-f4f5f7)', cursor: 'pointer' }}>
                <span style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                  {tile}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.contact_name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub2(r)}</span>
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
