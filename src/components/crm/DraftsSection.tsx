'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listDrafts, deleteDraft, saveDraft, syncDrafts, onDraftsChanged, draftsServerReady, type EmailDraft } from '@/lib/email-drafts';
import { confirmDialog } from '@/lib/confirm-dialog';
import { MessageFrame } from './MessageFrame';
import { withBodyStyle, withSignature } from '@/lib/agent-signature';

// Everything you started writing and didn't send — the CRM's own saved drafts AND the drafts sitting in Gmail itself — in ONE list,
// newest first. A CRM draft resumes exactly where you left off (right deal or contact, still inside its thread, CRM files still attached).
// A Gmail draft opens "here" in the CRM composer, which is what gives it open tracking and the deal/contact filing — or in Gmail.
// Search it, filter it (replies / new / with files / in Gmail / stale), tick several CRM drafts and discard them at once — with Undo.

const plain = (html: string) => html
  .replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li)>/gi, ' ').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-US', CT);
const DAY = 86_400_000;
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString('en-US', { ...CT, month: 'short', day: 'numeric' });
}
const groupOf = (ms: number) => {
  const now = Date.now();
  if (dayKey(ms) === dayKey(now)) return 'Today';
  if (dayKey(ms) === dayKey(now - DAY)) return 'Yesterday';
  if (now - ms < 7 * DAY) return 'Earlier this week';
  return 'Older';
};
// "Kenneth Hartmann <k@x.com>, b@y.com" → [{ name, email }]
const people = (raw: string, nameFor?: (e: string) => string | undefined) => raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s => s.trim()).filter(Boolean).map(s => {
  const m = s.match(/^"?(.*?)"?\s*<([^>]+)>$/);
  const email = (m ? m[2] : s).trim();
  return { email, name: (m && m[1].trim()) || nameFor?.(email) || '' };
});
const STALE_DAYS = 3;
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export type GmailDraftRow = { id: string; messageId: string; to: string; cc: string; subject: string; snippet: string; date: number; files: Array<{ name: string; size: number }> };
export type GmailDraftBody = { to: string; cc: string; bcc: string; subject: string; html: string; files: Array<{ name: string; size: number }> };

type Item =
  | { src: 'crm'; key: string; at: number; d: EmailDraft }
  | { src: 'gmail'; key: string; at: number; g: GmailDraftRow };

type Props = {
  isMobile: boolean;
  onResume: (d: EmailDraft) => void;
  nameFor?: (email: string) => string | undefined;
  /** Open a Gmail draft in the CRM composer (so it is tracked and filed). */
  onEditGmail?: (g: GmailDraftBody) => void;
  notify?: (msg: string) => void;
  /** The sender's Gmail signature, so a saved draft previews with the signature it will be sent with. */
  signature?: string | null;
};

export default function DraftsSection({ isMobile, onResume, nameFor, onEditGmail, notify, signature }: Props) {
  const [drafts, setDrafts] = useState<EmailDraft[]>(() => listDrafts());
  const [gm, setGm] = useState<{ drafts: GmailDraftRow[]; account: string | null; canModify: boolean; loaded: boolean }>({ drafts: [], account: null, canModify: false, loaded: false });
  const [syncing, setSyncing] = useState(true);
  const [filter, setFilter] = useState<'all' | 'replies' | 'new' | 'files' | 'gmail' | 'stale'>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [previewKey, setPreviewKey] = useState<string | null>(null);   // the CRM draft whose full text is open below its row
  const [gPreview, setGPreview] = useState<{ id: string; draft?: GmailDraftBody; error?: string } | null>(null);   // the Gmail draft whose full text is open below its row
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTick = useRef(-1);

  const loadGmail = useCallback(async () => {
    try {
      const r = await fetch('/api/gmail/drafts', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      setGm({ drafts: j?.connected ? (j.drafts as GmailDraftRow[]) : [], account: j?.account ?? null, canModify: !!j?.canModify, loaded: true });
    } catch { setGm(g => ({ ...g, loaded: true })); }
  }, []);

  useEffect(() => {
    const refresh = () => setDrafts(listDrafts());
    const off = onDraftsChanged(refresh);
    syncDrafts().finally(() => { refresh(); setSyncing(false); });
    void loadGmail();
    const onFocus = () => void loadGmail();
    window.addEventListener('focus', onFocus);
    return () => { off(); window.removeEventListener('focus', onFocus); };
  }, [loadGmail]);

  const deviceOnly = !syncing && draftsServerReady() === false;
  const isReplyCrm = (d: EmailDraft) => !!d.context.replyToId;
  const isReply = (it: Item) => (it.src === 'crm' ? isReplyCrm(it.d) : /^\s*(re|fwd?):/i.test(it.g.subject));
  const fileCount = (it: Item) => (it.src === 'crm' ? it.d.context.files?.length ?? 0 : it.g.files.length);
  const items: Item[] = useMemo(() => [
    ...drafts.map(d => ({ src: 'crm' as const, key: `c:${d.key}`, at: d.updatedAt, d })),
    ...gm.drafts.map(g => ({ src: 'gmail' as const, key: `g:${g.id}`, at: g.date, g })),
  ].sort((a, b) => b.at - a.at), [drafts, gm.drafts]);
  const stale = (it: Item) => Date.now() - it.at >= STALE_DAYS * DAY;
  const counts = useMemo(() => ({
    all: items.length, replies: items.filter(isReply).length, new: items.filter(i => !isReply(i)).length,
    files: items.filter(i => fileCount(i) > 0).length, gmail: items.filter(i => i.src === 'gmail').length, stale: items.filter(stale).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items]);

  const text = (it: Item) => it.src === 'crm'
    ? `${it.d.to} ${it.d.moreTo} ${it.d.cc} ${it.d.subject} ${it.d.context.label ?? ''} ${plain(it.d.bodyHtml)} ${(it.d.context.files ?? []).map(f => f.name).join(' ')}`
    : `${it.g.to} ${it.g.cc} ${it.g.subject} ${it.g.snippet} ${it.g.files.map(f => f.name).join(' ')}`;
  const recips = (it: Item) => people(it.src === 'crm' ? `${it.d.to},${it.d.moreTo}` : it.g.to, nameFor);

  const shown = useMemo(() => {
    let list = items;
    if (filter === 'replies') list = list.filter(isReply);
    if (filter === 'new') list = list.filter(i => !isReply(i));
    if (filter === 'files') list = list.filter(i => fileCount(i) > 0);
    if (filter === 'gmail') list = list.filter(i => i.src === 'gmail');
    if (filter === 'stale') list = list.filter(stale);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter(i => text(i).toLowerCase().includes(needle) || recips(i).some(x => x.name.toLowerCase().includes(needle)));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, q, nameFor]);

  const crmShown = shown.filter((i): i is Extract<Item, { src: 'crm' }> => i.src === 'crm');
  useEffect(() => { setSel(new Set()); lastTick.current = -1; }, [filter, q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && sel.size) setSel(new Set()); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [sel.size]);

  const flash = (msg: string, undo?: () => void) => { setToast({ msg, undo }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 8000); };
  // Discard now, put it back if you change your mind (no "are you sure?" — the Undo is the safety net).
  const discard = (list: EmailDraft[]) => {
    if (!list.length) return;
    list.forEach(d => deleteDraft(d.key));
    setSel(new Set());
    flash(list.length === 1 ? 'Draft discarded' : `${list.length} drafts discarded`, () => {
      list.forEach(d => saveDraft({ key: d.key, subject: d.subject, to: d.to, moreTo: d.moreTo, cc: d.cc, bcc: d.bcc, bodyHtml: d.bodyHtml, context: d.context }));
      setToast(null);
    });
  };
  // A Gmail draft has no Undo (Gmail deletes it for good), so this one asks first.
  const discardGmail = async (g: GmailDraftRow) => {
    if (!(await confirmDialog(`Discard the Gmail draft “${g.subject || '(no subject)'}”? Gmail deletes it for good — there is no Undo.`, { confirmLabel: 'Discard draft' }))) return;
    setBusy(g.id);
    try {
      const r = await fetch(`/api/gmail/drafts?id=${encodeURIComponent(g.id)}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { notify?.(j.error ?? 'Could not discard it in Gmail.'); return; }
      setGm(s => ({ ...s, drafts: s.drafts.filter(x => x.id !== g.id) }));
      window.dispatchEvent(new Event('crm-gmail-drafts-changed'));
      flash('Gmail draft discarded');
    } finally { setBusy(null); }
  };
  // Show a Gmail draft's full text in place (same fetch as "Edit here", nothing is opened or changed).
  const toggleGmailPreview = async (g: GmailDraftRow) => {
    if (gPreview?.id === g.id) { setGPreview(null); return; }
    setGPreview({ id: g.id });
    try {
      const r = await fetch(`/api/gmail/drafts?id=${encodeURIComponent(g.id)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      setGPreview(p => (p?.id === g.id ? (r.ok && j.draft ? { id: g.id, draft: j.draft as GmailDraftBody } : { id: g.id, error: j.error ?? 'Could not load that draft.' }) : p));
    } catch { setGPreview(p => (p?.id === g.id ? { id: g.id, error: 'Could not load that draft.' } : p)); }
  };
  const editGmail = async (g: GmailDraftRow) => {
    if (!onEditGmail) return;
    setBusy(g.id);
    try {
      const r = await fetch(`/api/gmail/drafts?id=${encodeURIComponent(g.id)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.draft) { notify?.(j.error ?? 'Could not open that draft.'); return; }
      onEditGmail(j.draft as GmailDraftBody);
    } finally { setBusy(null); }
  };
  const tick = (key: string, idx: number, range: boolean) => setSel(prev => {
    const n = new Set(prev);
    if (range && lastTick.current >= 0) { const [a, b] = [Math.min(lastTick.current, idx), Math.max(lastTick.current, idx)]; const on = !prev.has(key); for (const x of crmShown.slice(a, b + 1)) { if (on) n.add(x.d.key); else n.delete(x.d.key); } }
    else if (n.has(key)) n.delete(key); else n.add(key);
    lastTick.current = idx; return n;
  });

  const chip = (on: boolean): React.CSSProperties => ({
    padding: isMobile ? '8px 14px' : '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--chip-on-line, #111)' : 'var(--k-e5e7eb)'}`, background: on ? 'var(--chip-on-bg, #111)' : 'var(--k-fff)', color: on ? 'var(--chip-on-fg, #fff)' : 'var(--k-374151)',
    fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  });
  const n = (c: number) => (c ? <span style={{ marginLeft: 6, opacity: 0.7, fontWeight: 500 }}>{c}</span> : null);
  const pill = (bg: string, fg: string, border?: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: bg, color: fg, ...(border ? { border: `1px solid ${border}` } : {}) });
  const btn: React.CSSProperties = { height: isMobile ? 40 : 32, padding: '0 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap', border: '1px solid var(--k-d1d5db)', background: 'var(--k-fff)', color: 'var(--k-374151)', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' };

  const total = items.length;
  return (
    <div style={{ maxWidth: 860 }}>
      <style>{'.dr-chk{display:none;position:absolute;inset:0;align-items:center;justify-content:center}.dr-row:hover .dr-av,.dr-sel .dr-av{display:none}.dr-row:hover .dr-chk,.dr-sel .dr-chk{display:flex}.dr-row.dr-gm .dr-chk{display:none!important}.dr-row.dr-gm:hover .dr-av{display:flex!important}@media (hover:none){.dr-row .dr-av{display:flex!important}.dr-row .dr-chk{display:none!important}}'}</style>
      <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--k-6b7280)', lineHeight: 1.5 }}>
        Everything you started and haven’t sent — saved here in the CRM{deviceOnly ? ' on this device' : ' (it follows you to your phone)'} or sitting in your Gmail. Open a draft to pick up where you left off.
      </p>
      {deviceOnly && (
        <div style={{ margin: '0 0 14px', padding: '9px 12px', background: 'var(--k-fef9f0)', border: '1px solid var(--k-fde68a)', borderRadius: 8, fontSize: 12.5, color: 'var(--k-92400e)' }}>
          CRM drafts are only on this device for now. Once the one-time drafts setup is applied they’ll sync across devices too.
        </div>
      )}

      {total > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="crm-tabs-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
            <button type="button" onClick={() => setFilter('all')} style={chip(filter === 'all')}>All{n(counts.all)}</button>
            <button type="button" onClick={() => setFilter('replies')} style={chip(filter === 'replies')}>↩ Replies{n(counts.replies)}</button>
            <button type="button" onClick={() => setFilter('new')} style={chip(filter === 'new')}>✉ New{n(counts.new)}</button>
            {counts.files > 0 && <button type="button" onClick={() => setFilter('files')} style={chip(filter === 'files')}>📎 With files{n(counts.files)}</button>}
            {counts.gmail > 0 && <button type="button" onClick={() => setFilter('gmail')} style={chip(filter === 'gmail')}>In Gmail{n(counts.gmail)}</button>}
            <button type="button" onClick={() => setFilter('stale')} title={`Not touched in ${STALE_DAYS}+ days`} style={chip(filter === 'stale')}>⏳ {STALE_DAYS}+ days old{n(counts.stale)}</button>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search drafts" aria-label="Search drafts"
            style={{ flex: isMobile ? '1 1 100%' : '0 1 240px', marginLeft: isMobile ? 0 : 'auto', minWidth: 0, height: isMobile ? 42 : 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 14 }} />
        </div>
      )}

      {sel.size > 0 && (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 10px', background: '#111', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
          <span>{sel.size} selected</span>
          {sel.size < crmShown.length && <button type="button" onClick={() => setSel(new Set(crmShown.map(x => x.d.key)))} style={{ border: 'none', background: 'none', color: '#e8b563', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>All {crmShown.length}</button>}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => discard(crmShown.map(x => x.d).filter(d => sel.has(d.key)))} style={{ height: 32, padding: '0 12px', border: '1px solid #7f1d1d', borderRadius: 8, background: '#450a0a', color: '#fecaca', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>🗑 Discard</button>
          <button type="button" onClick={() => setSel(new Set())} aria-label="Clear selection" title="Clear (Esc)" style={{ width: 32, height: 32, border: 'none', borderRadius: 8, background: 'none', color: '#bbb', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {total === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--k-fff)', border: '1px dashed var(--k-d1d5db)', borderRadius: 12, color: 'var(--k-6b7280)' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>✎</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-374151)', marginBottom: 4 }}>No drafts</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>{syncing || !gm.loaded ? 'Checking for drafts…' : <>Start an email from Compose, a contact or a deal and it’s saved here if you don’t send it.<br />Press <kbd style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, background: 'var(--k-f3f4f6)', border: '1px solid var(--k-e5e7eb)', borderRadius: 5, padding: '0 6px' }}>c</kbd> on this page to compose.</>}</div>
        </div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '32px 20px', textAlign: 'center', background: 'var(--k-fff)', border: '1px dashed var(--k-d1d5db)', borderRadius: 12, color: 'var(--k-6b7280)', fontSize: 14 }}>
          Nothing matches{q ? ` “${q}”` : ''}.
        </div>
      ) : (
        <div className={sel.size ? 'dr-sel' : undefined} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
          {shown.map((it, i) => {
            const to = recips(it);
            const isG = it.src === 'gmail';
            const subject = isG ? it.g.subject : it.d.subject;
            const snippet = isG ? it.g.snippet : plain(it.d.bodyHtml);
            const files = isG ? it.g.files : (it.d.context.files ?? []).map(f => ({ name: f.name, size: f.size ?? 0 }));
            const reply = isReply(it);
            const old = stale(it);
            const days = Math.floor((Date.now() - it.at) / DAY);
            const g = groupOf(it.at), showHeader = i === 0 || groupOf(shown[i - 1].at) !== g;
            const first = to[0];
            const label = first ? (first.name || first.email) : '';
            const initial = (label || '✉').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '✉';
            const crmIdx = isG ? -1 : crmShown.findIndex(x => x.key === it.key);
            const kind = !isG ? (it.d.context.kind === 'deal' ? '💼 Deal' : it.d.context.kind === 'contact' ? '👤 Contact' : '✉ New message') : '';
            // A draft with nobody to send it to yet (e.g. prepared for a contact whose email isn't known) can't be resumed into a composer, so a click shows its full text instead.
            const noRecipient = !isG && !it.d.to.trim() && !it.d.moreTo.trim();
            const open = () => (isG ? void editGmail(it.g) : noRecipient ? setPreviewKey(k => (k === it.d.key ? null : it.d.key)) : onResume(it.d));
            const previewing = !isG && previewKey === it.d.key;
            const gLink = isG ? `https://mail.google.com/mail/${gm.account ? `?authuser=${encodeURIComponent(gm.account)}` : ''}#drafts?compose=${it.g.messageId}` : '';
            return (
              <React.Fragment key={it.key}>
                {showHeader && <div style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', background: 'var(--k-fafafa)', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none', borderBottom: '1px solid var(--k-f0f0f0)' }}>{g}</div>}
                <div role="button" tabIndex={0} className={`dr-row${isG ? ' dr-gm' : ''}`} onClick={open} onKeyDown={e => { if (e.key === 'Enter') open(); }}
                  style={{ display: 'flex', flexWrap: isMobile && isG ? 'wrap' : 'nowrap', alignItems: 'center', gap: 12, padding: isMobile ? '12px 12px' : '12px 16px', minHeight: 68, borderTop: !showHeader && i ? '1px solid var(--k-f3f4f6)' : 'none', cursor: 'pointer', opacity: busy === (isG ? it.g.id : '') ? 0.6 : 1, background: !isG && sel.has(it.d.key) ? 'var(--k-fdf6e8)' : 'var(--k-fff)' }}>
                  <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
                    <div className="dr-av" aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', background: first ? '#475569' : '#9ca3af' }}>{initial}</div>
                    {!isG && (
                      <div className="dr-chk" onClick={e => { e.stopPropagation(); tick(it.d.key, crmIdx, e.shiftKey); }} title="Select (shift-click for a range)">
                        <input type="checkbox" aria-label={`Select draft to ${label || 'nobody'}`} checked={sel.has(it.d.key)} onChange={() => {}} style={{ width: 18, height: 18, accentColor: '#c9922c', cursor: 'pointer' }} />
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {first ? <>{label}{to.length > 1 && <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> +{to.length - 1}</span>}</> : <span style={{ color: '#dc2626', fontWeight: 600 }}>(no recipient)</span>}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: old ? 'var(--k-b45309)' : 'var(--k-9ca3af)', fontWeight: old ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0 }}>{ago(it.at)}</span>
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--k-374151)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong style={{ fontWeight: 600 }}>{subject || '(no subject)'}</strong>
                      {snippet && <span style={{ color: 'var(--k-9ca3af)' }}> — {snippet.slice(0, 140)}</span>}
                    </div>
                    <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {isG
                        ? <span title="Saved in your Gmail" style={pill('var(--k-f3f4f6)', 'var(--k-374151)', 'var(--k-e5e7eb)')}>✉ Gmail</span>
                        : <span style={pill('var(--k-f3f4f6)', 'var(--k-6b7280)')}>{kind}{it.d.context.label ? ` · ${it.d.context.label}` : ''}</span>}
                      {reply && <span style={pill('var(--k-eff6ff)', 'var(--k-1d4ed8)')}>↩ Reply</span>}
                      {files.length > 0 && <span title={files.map(f => `${f.name}${f.size ? ` (${kb(f.size)})` : ''}`).join('\n')} style={pill('var(--k-fdf6e8)', 'var(--k-92400e)', 'var(--k-fde68a)')}>📎 {files.length === 1 ? files[0].name.replace(/(.{26}).+(\.\w+)$/, '$1…$2') : `${files.length} files`}</span>}
                      {old && <span title="Still need to send this?" style={pill('var(--k-fdf6e8)', 'var(--k-92400e)', 'var(--k-fde68a)')}>⏳ {days} days old</span>}
                      {!snippet && !files.length && <span style={pill('var(--k-fef2f2)', 'var(--k-dc2626)')}>No text yet</span>}
                    </div>
                  </div>
                  {isG ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, ...(isMobile ? { flexBasis: '100%', paddingLeft: 48 } : {}) }} onClick={e => e.stopPropagation()}>
                      <button type="button" aria-label={gPreview?.id === it.g.id ? 'Close preview' : 'Preview draft'} title={gPreview?.id === it.g.id ? 'Close preview' : 'Preview the full draft'} aria-pressed={gPreview?.id === it.g.id}
                        onClick={() => void toggleGmailPreview(it.g)}
                        style={{ width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: gPreview?.id === it.g.id ? 'var(--k-fdf6e9)' : 'none', border: 'none', borderRadius: 8, color: 'var(--k-6b7280)', cursor: 'pointer', fontSize: 17 }}>👁</button>
                      {onEditGmail && <button type="button" onClick={() => void editGmail(it.g)} disabled={busy === it.g.id} title="Open it in the CRM composer — sent from here it is tracked (opens) and filed on the deal or contact" style={{ ...btn, borderColor: '#c9922c', color: 'var(--k-92400e)', background: 'var(--k-fffbeb)' }}>{busy === it.g.id ? 'Opening…' : 'Edit here'}</button>}
                      {!isMobile && <a href={gLink} target="_blank" rel="noopener noreferrer" title="Open this draft in Gmail (keeps its attachments)" style={btn}>Gmail ↗</a>}
                      {gm.canModify && <button type="button" aria-label="Discard Gmail draft" title="Discard this draft in Gmail" onClick={() => void discardGmail(it.g)} style={{ width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 8, color: 'var(--k-9ca3af)', cursor: 'pointer', fontSize: 17 }}>🗑</button>}
                    </div>
                  ) : (
                    <>
                    <button type="button" aria-label={previewing ? 'Close preview' : 'Preview draft'} title={previewing ? 'Close preview' : 'Preview the full draft'} aria-pressed={previewing}
                      onClick={e => { e.stopPropagation(); setPreviewKey(k => (k === it.d.key ? null : it.d.key)); }}
                      style={{ flexShrink: 0, width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: previewing ? 'var(--k-fdf6e9)' : 'none', border: 'none', borderRadius: 8, color: 'var(--k-6b7280)', cursor: 'pointer', fontSize: 17 }}>👁</button>
                    <button type="button" aria-label="Discard draft" title="Discard draft (you can undo)"
                      onClick={e => { e.stopPropagation(); discard([it.d]); }}
                      style={{ flexShrink: 0, width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 8, color: 'var(--k-9ca3af)', cursor: 'pointer', fontSize: 17 }}>🗑</button>
                    </>
                  )}
                </div>
                {isG && gPreview?.id === it.g.id && (
                  <div style={{ padding: isMobile ? '12px 14px 16px' : '14px 20px 18px 64px', background: 'var(--k-fafafa)', borderTop: '1px solid var(--k-f0f0f0)' }}>
                    {!gPreview.draft && !gPreview.error && <div style={{ fontSize: 13, color: 'var(--k-6b7280)' }}>Loading the draft…</div>}
                    {gPreview.error && <div style={{ fontSize: 13, color: '#b45309' }}>{gPreview.error}</div>}
                    {gPreview.draft && (
                      <>
                        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 4 }}><b>To:</b> {gPreview.draft.to || <span style={{ color: '#b45309' }}>nobody yet</span>}</div>
                        {gPreview.draft.cc && <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 4 }}><b>Cc:</b> {gPreview.draft.cc}</div>}
                        {gPreview.draft.bcc && <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 4 }}><b>Bcc:</b> {gPreview.draft.bcc}</div>}
                        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 10 }}><b>Subject:</b> {gPreview.draft.subject || '(no subject)'}</div>
                        <div style={{ border: '1px solid var(--k-e5e7eb)', borderRadius: 8, padding: '14px 16px', background: '#fff', maxHeight: 460, overflowY: 'auto' }}>
                          {plain(gPreview.draft.html) ? <MessageFrame html={gPreview.draft.html} /> : <span style={{ color: '#9ca3af', fontSize: 14 }}>No text yet</span>}
                        </div>
                        {gPreview.draft.files.length > 0 && <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{gPreview.draft.files.map(f => <span key={f.name} style={pill('var(--k-fdf6e8)', 'var(--k-92400e)', 'var(--k-fde68a)')}>📎 {f.name}{f.size ? ` (${kb(f.size)})` : ''}</span>)}</div>}
                      </>
                    )}
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {onEditGmail && <button type="button" onClick={() => void editGmail(it.g)} style={{ ...btn, borderColor: '#c9922c', color: '#92400e' }}>Open to edit &amp; send</button>}
                      <button type="button" onClick={() => setGPreview(null)} style={btn}>Close preview</button>
                    </div>
                  </div>
                )}
                {previewing && !isG && (
                  <div style={{ padding: isMobile ? '12px 14px 16px' : '14px 20px 18px 64px', background: 'var(--k-fafafa)', borderTop: '1px solid var(--k-f0f0f0)' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 4 }}>
                      <b>To:</b> {first ? to.map(x => x.name ? `${x.name} <${x.email}>` : x.email).join(', ') : <span style={{ color: '#b45309' }}>nobody yet — add the contact’s email address on their card after your call, then open this draft there to send</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginBottom: 10 }}><b>Subject:</b> {subject || '(no subject)'}</div>
                    <div style={{ border: '1px solid var(--k-e5e7eb)', borderRadius: 8, padding: '14px 16px', background: '#fff', maxHeight: 460, overflowY: 'auto' }}>
                      {plain(it.d.bodyHtml) ? <MessageFrame html={withBodyStyle(withSignature(it.d.bodyHtml, signature))} /> : <span style={{ color: '#9ca3af', fontSize: 14 }}>No text yet</span>}
                    </div>
                    {files.length > 0 && <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{files.map(f => <span key={f.name} style={pill('var(--k-fdf6e8)', 'var(--k-92400e)', 'var(--k-fde68a)')}>📎 {f.name}{f.size ? ` (${kb(f.size)})` : ''}</span>)}</div>}
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {!noRecipient && <button type="button" onClick={() => onResume(it.d)} style={{ ...btn, borderColor: '#c9922c', color: '#92400e' }}>Open to edit &amp; send</button>}
                      <button type="button" onClick={() => setPreviewKey(null)} style={btn}>Close preview</button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: isMobile ? 84 : 24, zIndex: 80, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', background: '#111', color: '#fff', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,.25)', fontSize: 13.5, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>
          {toast.msg}
          {toast.undo && <button type="button" onClick={toast.undo} style={{ border: 'none', background: 'none', color: '#e8b563', fontWeight: 800, cursor: 'pointer', fontSize: 13.5, fontFamily: "'DM Sans',sans-serif" }}>Undo</button>}
        </div>
      )}
    </div>
  );
}
