'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { chicagoLocalToUTC, chicagoToday } from '@/lib/chicago-time';
import { sanitizeHtml } from '@/lib/sanitize';

// Emails you scheduled with "Send later" (and any that failed). Sits above the saved drafts on the Emails → Drafts tab.

type Item = { id: string; send_at: string; summary_to: string; summary_subject: string; status: 'pending' | 'sending' | 'failed'; attempts: number; last_error: string | null };
type Preview = { to: string; cc: string; bcc: string; subject: string; html: string; files: string[] };
const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const whenLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { ...CT, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ScheduledEmails({ isMobile, notify }: { isMobile: boolean; notify: (m: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // the one whose time is being changed
  const [openId, setOpenId] = useState<string | null>(null);   // the one whose full email is open below its row
  const [pv, setPv] = useState<Preview | 'loading' | 'error' | null>(null);
  const togglePreview = async (it: Item) => {
    if (openId === it.id) { setOpenId(null); setPv(null); return; }
    setOpenId(it.id); setPv('loading');
    try {
      const r = await fetch(`/api/crm/scheduled-emails?id=${encodeURIComponent(it.id)}`, { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      setPv(j?.preview ? (j.preview as Preview) : 'error');
    } catch { setPv('error'); }
  };
  const load = useCallback(async () => {
    try { const r = await fetch('/api/crm/scheduled-emails', { cache: 'no-store' }); if (r.ok) setItems((await r.json()).items as Item[]); else setItems([]); } catch { setItems([]); }
  }, []);
  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener('crm-scheduled-changed', on); window.addEventListener('focus', on);
    return () => { window.removeEventListener('crm-scheduled-changed', on); window.removeEventListener('focus', on); };
  }, [load]);

  const act = async (it: Item, action: 'cancel' | 'send_now') => {
    setBusy(it.id);
    try {
      const r = await fetch('/api/crm/scheduled-emails', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, action }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) notify(j.error ?? 'That did not work — try again.');
      else notify(action === 'cancel' ? 'Cancelled — it will not be sent.' : 'Sent.');
    } finally { setBusy(null); void load(); }
  };

  const resched = async (it: Item, localValue: string) => {
    if (!localValue) return;
    const [d, t] = localValue.split('T');
    setBusy(it.id);
    try {
      const r = await fetch('/api/crm/scheduled-emails', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, action: 'reschedule', send_at: chicagoLocalToUTC(d, t) }) });
      const j = await r.json().catch(() => ({}));
      notify(r.ok ? 'Time changed.' : (j.error ?? 'Could not change the time.'));
    } finally { setBusy(null); setEditing(null); void load(); }
  };

  if (!items || items.length === 0) return null;
  const btn: React.CSSProperties = { minHeight: isMobile ? 40 : 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' };
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', margin: '0 0 8px' }}>🕐 Scheduled ({items.filter(i => i.status !== 'failed').length})</div>
      <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
        {items.map((it, i) => {
          const failed = it.status === 'failed';
          return (
            <React.Fragment key={it.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '11px 14px', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none', background: failed ? 'var(--k-fef2f2)' : 'var(--k-fff)' }}>
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}>To: </span>{it.summary_to}</div>
                <div style={{ fontSize: 13.5, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.summary_subject}</div>
                <div style={{ fontSize: 12.5, marginTop: 2, color: failed ? 'var(--k-dc2626)' : 'var(--k-a06a12)', fontWeight: 600 }}>
                  {failed ? `⚠ Did not send — ${it.last_error ?? 'unknown error'}` : it.status === 'sending' ? 'Sending now…' : `Sends ${whenLabel(it.send_at)}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={btn} aria-pressed={openId === it.id} onClick={() => void togglePreview(it)} title="See the full email exactly as it will go out">{openId === it.id ? 'Close preview' : '👁 Preview'}</button>
                {!failed && it.status === 'pending' && (editing === it.id
                  ? <input type="datetime-local" autoFocus min={`${chicagoToday()}T00:00`} aria-label="New send time (Central)" onChange={e => void resched(it, e.target.value)} onBlur={() => setEditing(null)} style={{ ...btn, padding: '0 6px', fontWeight: 500 }} />
                  : <button type="button" style={btn} disabled={busy === it.id} onClick={() => setEditing(it.id)} title="Pick a new time (Central)">🕐 Change time</button>)}
                <button type="button" style={btn} disabled={busy === it.id || it.status === 'sending'} onClick={() => void act(it, 'send_now')}>{failed ? 'Try again' : 'Send now'}</button>
                <button type="button" style={btn} disabled={busy === it.id || it.status === 'sending'} onClick={() => void act(it, 'cancel')}>{failed ? 'Dismiss' : 'Cancel'}</button>
              </div>
            </div>
            {openId === it.id && (
              <div style={{ padding: isMobile ? '12px 14px 16px' : '14px 20px 18px', background: 'var(--k-fafafa)', borderTop: '1px solid var(--k-f0f0f0)' }}>
                {pv === 'loading' && <div style={{ fontSize: 13, color: 'var(--k-6b7280)' }}>Loading the email…</div>}
                {pv === 'error' && <div style={{ fontSize: 13, color: 'var(--k-dc2626)' }}>Could not load the preview — try again.</div>}
                {pv && typeof pv === 'object' && (
                  <>
                    <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 4 }}><b>To:</b> {pv.to}{pv.cc ? <> · <b>Cc:</b> {pv.cc}</> : null}{pv.bcc ? <> · <b>Bcc:</b> {pv.bcc}</> : null}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 10 }}><b>Subject:</b> {pv.subject || '(no subject)'}</div>
                    <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, padding: '14px 16px', fontSize: 14, lineHeight: 1.55, color: 'var(--k-111)', maxHeight: 420, overflowY: 'auto', overflowWrap: 'anywhere' }}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(pv.html) || '<span style="color:#9ca3af">No text</span>' }} />
                    {pv.files.length > 0 && <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{pv.files.map(f => <span key={f} style={{ fontSize: 12.5, padding: '3px 10px', borderRadius: 999, background: 'var(--k-fdf6e8)', color: 'var(--k-92400e)', border: '1px solid var(--k-fde68a)' }}>📎 {f}</span>)}</div>}
                  </>
                )}
              </div>
            )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
