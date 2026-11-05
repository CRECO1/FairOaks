'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { chicagoLocalToUTC, chicagoToday } from '@/lib/chicago-time';
import { sanitizeHtml } from '@/lib/sanitize';
import { MessageFrame } from './MessageFrame';
import { confirmDialog } from '@/lib/confirm-dialog';

// Emails you scheduled with "Send later" (and any that failed). Sits above the saved drafts on the Emails → Drafts tab.

type Item = { id: string; send_at: string; summary_to: string; summary_subject: string; status: 'pending' | 'sending' | 'failed'; attempts: number; last_error: string | null };
type Preview = { to: string; cc: string; bcc: string; subject: string; html: string; body: string; editable: boolean; files: string[] };
const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const whenLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { ...CT, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ScheduledEmails({ isMobile, notify }: { isMobile: boolean; notify: (m: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // the one whose time is being changed
  const [openId, setOpenId] = useState<string | null>(null);   // the one whose full email is open below its row
  const [pv, setPv] = useState<Preview | 'loading' | 'error' | null>(null);
  const [form, setForm] = useState<{ to: string; cc: string; subject: string } | null>(null); // set while the open email is being edited
  const [dirty, setDirty] = useState(false);                                                    // the body text was touched
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const reqRef = React.useRef(0);                                                          // newest preview request wins, so a slow answer for another row can't overwrite this one
  const loadPreview = async (it: Item) => {
    const mine = ++reqRef.current;
    setOpenId(it.id); setPv('loading');
    try {
      const r = await fetch(`/api/crm/scheduled-emails?id=${encodeURIComponent(it.id)}`, { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      const p = (j?.preview as Preview | undefined) ?? null;
      if (mine === reqRef.current) setPv(p ?? 'error');
      return mine === reqRef.current ? p : null;
    } catch { if (mine === reqRef.current) setPv('error'); return null; }
  };
  // Leaving an edit you changed asks first, so a stray click never throws your text away.
  const okToLeave = async () => {
    if (!form || !dirty) return true;
    return confirmDialog('Discard your changes to this email?', { confirmLabel: 'Discard changes' });
  };
  const closeEdit = () => { setForm(null); setDirty(false); };
  const togglePreview = async (it: Item) => {
    if (!(await okToLeave())) return;
    if (openId === it.id && !form) { setOpenId(null); setPv(null); return; }
    closeEdit();
    await loadPreview(it);
  };
  const startEdit = async (it: Item) => {
    if (form && openId === it.id) { bodyRef.current?.focus(); return; }
    if (!(await okToLeave())) return;
    setDirty(false);
    const p = await loadPreview(it);
    if (p) setForm({ to: p.to, cc: p.cc, subject: p.subject });
  };
  const editing_ = !!form;
  useEffect(() => { if (editing_) bodyRef.current?.focus(); }, [editing_, openId]);
  // Bold / italic / underline on the selection (the buttons keep the selection by not taking focus).
  const fmt = (cmd: 'bold' | 'italic' | 'underline') => { bodyRef.current?.focus(); document.execCommand(cmd); setDirty(true); };
  // Pasting brings the other page's fonts and colours with it; keep just the words.
  const pastePlain = (e: React.ClipboardEvent) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); };
  const saveEdit = async (it: Item) => {
    if (!form) return;
    setBusy(it.id);
    try {
      const r = await fetch('/api/crm/scheduled-emails', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, action: 'edit', to: form.to, cc: form.cc, subject: form.subject, ...(dirty && bodyRef.current ? { body: bodyRef.current.innerHTML } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { notify(j.error ?? 'Could not save your changes.'); return; }
      notify('Changes saved — the email will go out as edited.');
      closeEdit();
      await loadPreview(it);
      void load();
    } finally { setBusy(null); }
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
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" style={btn} aria-pressed={openId === it.id && !form} onClick={() => void togglePreview(it)} title="See the email exactly as the recipient will get it">{openId === it.id && !form ? 'Close preview' : '👁 Preview'}</button>
                {it.status !== 'sending' && <button type="button" style={btn} disabled={busy === it.id} onClick={() => void startEdit(it)} title="Change the recipient, subject or text">✏️ Edit</button>}
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
                {pv && typeof pv === 'object' && form && (
                  <>
                    {([['To', 'to'], ['Cc', 'cc'], ['Subject', 'subject']] as const).map(([lab, k]) => (
                      <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12.5, color: 'var(--k-6b7280)' }}>
                        <b style={{ width: 52, flexShrink: 0 }}>{lab}:</b>
                        <input value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} placeholder={k === 'cc' ? '(optional)' : ''} style={{ flex: 1, minWidth: 0, height: isMobile ? 40 : 32, padding: '0 10px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-111)' }} />
                      </label>
                    ))}
                    <div role="toolbar" aria-label="Text formatting" style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      {([['bold', 'B', 800, 'normal', 'none'], ['italic', 'I', 600, 'italic', 'none'], ['underline', 'U', 600, 'normal', 'underline']] as const).map(([cmd, label, w, st, dec]) => (
                        <button key={cmd} type="button" title={cmd[0].toUpperCase() + cmd.slice(1)} aria-label={cmd} onMouseDown={e => e.preventDefault()} onClick={() => fmt(cmd)}
                          style={{ ...btn, minHeight: isMobile ? 36 : 28, minWidth: 32, padding: '0 8px', fontWeight: w, fontStyle: st, textDecoration: dec }}>{label}</button>
                      ))}
                    </div>
                    <div ref={bodyRef} contentEditable suppressContentEditableWarning onInput={() => setDirty(true)} onPaste={pastePlain} aria-label="Email text" aria-multiline="true" role="textbox"
                      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); void (async () => { if (await okToLeave()) closeEdit(); })(); } }}
                      style={{ marginTop: 4, background: '#fff', color: '#222', border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '14px 16px', fontSize: 14, lineHeight: 1.55, minHeight: 160, maxHeight: 420, overflowY: 'auto', overflowWrap: 'anywhere', outline: 'none' }}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(pv.body) }} />
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--k-9ca3af)' }}>Your signature{pv.files.length ? ' and the attached file' : ''} {pv.files.length ? 'are' : 'is'} added automatically when it sends. Save to see the finished email.</div>
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" style={{ ...btn, borderColor: '#c9922c', color: '#92400e' }} disabled={busy === it.id || !form.to.trim() || !form.subject.trim()} title={!form.to.trim() || !form.subject.trim() ? 'It needs a recipient and a subject' : undefined} onClick={() => void saveEdit(it)}>{busy === it.id ? 'Saving…' : 'Save changes'}</button>
                      <button type="button" style={btn} disabled={busy === it.id} onClick={() => void (async () => { if (await okToLeave()) closeEdit(); })()}>Cancel</button>
                    </div>
                  </>
                )}
                {pv && typeof pv === 'object' && !form && (
                  <>
                    <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 4 }}><b>To:</b> {pv.to}{pv.cc ? <> · <b>Cc:</b> {pv.cc}</> : null}{pv.bcc ? <> · <b>Bcc:</b> {pv.bcc}</> : null}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 10 }}><b>Subject:</b> {pv.subject || '(no subject)'}</div>
                    <div style={{ border: '1px solid var(--k-e5e7eb)', borderRadius: 8, padding: '14px 16px', background: '#fff', maxHeight: 460, overflowY: 'auto' }}><MessageFrame html={pv.html} /></div>
                    {pv.files.length > 0 && <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{pv.files.map(f => <span key={f} style={{ fontSize: 12.5, padding: '3px 10px', borderRadius: 999, background: 'var(--k-fdf6e8)', color: 'var(--k-92400e)', border: '1px solid var(--k-fde68a)' }}>📎 {f}</span>)}</div>}
                    {pv.editable && <div style={{ marginTop: 12 }}><button type="button" style={btn} onClick={() => void startEdit(it)}>✏️ Edit this email</button></div>}
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
