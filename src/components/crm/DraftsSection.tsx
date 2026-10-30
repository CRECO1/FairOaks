'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listDrafts, deleteDraft, saveDraft, syncDrafts, onDraftsChanged, draftsServerReady, type EmailDraft } from '@/lib/email-drafts';

// Gmail's "Drafts" folder: everything you started writing and didn't send, newest first. Click one to pick
// up exactly where you left off — back in the right deal or contact, and still inside its thread if it was a reply.
// Search it, filter it (replies / new / stale), tick several and discard them at once — with Undo.

const plain = (html: string) => html
  .replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li)>/gi, ' ').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

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

type Props = { isMobile: boolean; onResume: (d: EmailDraft) => void; nameFor?: (email: string) => string | undefined };

export default function DraftsSection({ isMobile, onResume, nameFor }: Props) {
  const [drafts, setDrafts] = useState<EmailDraft[]>(() => listDrafts());
  const [syncing, setSyncing] = useState(true);
  const [filter, setFilter] = useState<'all' | 'replies' | 'new' | 'stale'>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<{ msg: string; undo: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTick = useRef(-1);

  useEffect(() => {
    const refresh = () => setDrafts(listDrafts());
    const off = onDraftsChanged(refresh);
    syncDrafts().finally(() => { refresh(); setSyncing(false); });
    return off;
  }, []);

  const deviceOnly = !syncing && draftsServerReady() === false;
  const isReply = (d: EmailDraft) => !!d.context.replyToId;
  const stale = (d: EmailDraft) => Date.now() - d.updatedAt >= STALE_DAYS * DAY;
  const counts = useMemo(() => ({ all: drafts.length, replies: drafts.filter(isReply).length, new: drafts.filter(d => !isReply(d)).length, stale: drafts.filter(stale).length }), [drafts]);

  const shown = useMemo(() => {
    let list = drafts;
    if (filter === 'replies') list = list.filter(isReply);
    if (filter === 'new') list = list.filter(d => !isReply(d));
    if (filter === 'stale') list = list.filter(stale);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter(d => `${d.to} ${d.moreTo} ${d.cc} ${d.subject} ${d.context.label ?? ''} ${plain(d.bodyHtml)}`.toLowerCase().includes(needle)
      || people(`${d.to},${d.moreTo}`, nameFor).some(x => x.name.toLowerCase().includes(needle)));
    return list;
  }, [drafts, filter, q, nameFor]);

  useEffect(() => { setSel(new Set()); lastTick.current = -1; }, [filter, q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && sel.size) setSel(new Set()); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [sel.size]);

  const flash = (msg: string, undo: () => void) => { setToast({ msg, undo }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 8000); };
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
  const tick = (key: string, idx: number, range: boolean) => setSel(prev => {
    const n = new Set(prev);
    if (range && lastTick.current >= 0) { const [a, b] = [Math.min(lastTick.current, idx), Math.max(lastTick.current, idx)]; const on = !prev.has(key); for (const x of shown.slice(a, b + 1)) { if (on) n.add(x.key); else n.delete(x.key); } }
    else if (n.has(key)) n.delete(key); else n.add(key);
    lastTick.current = idx; return n;
  });

  const chip = (on: boolean): React.CSSProperties => ({
    padding: isMobile ? '8px 14px' : '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? '#111' : 'var(--k-e5e7eb)'}`, background: on ? '#111' : 'var(--k-fff)', color: on ? '#fff' : 'var(--k-374151)',
    fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  });
  const n = (c: number) => (c ? <span style={{ marginLeft: 6, opacity: 0.7, fontWeight: 500 }}>{c}</span> : null);

  return (
    <div style={{ maxWidth: 860 }}>
      <style>{'.dr-chk{display:none;position:absolute;inset:0;align-items:center;justify-content:center}.dr-row:hover .dr-av,.dr-sel .dr-av{display:none}.dr-row:hover .dr-chk,.dr-sel .dr-chk{display:flex}@media (hover:none){.dr-row .dr-av{display:flex!important}.dr-row .dr-chk{display:none!important}}'}</style>
      <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--k-6b7280)', lineHeight: 1.5 }}>
        Anything you start writing and don’t send is saved here automatically{deviceOnly ? ' on this device' : ' — and follows you between your computer and your phone'}.
      </p>
      {deviceOnly && (
        <div style={{ margin: '0 0 14px', padding: '9px 12px', background: 'var(--k-fef9f0)', border: '1px solid var(--k-fde68a)', borderRadius: 8, fontSize: 12.5, color: 'var(--k-92400e)' }}>
          Drafts are only on this device for now. Once the one-time drafts setup is applied they’ll sync across devices too.
        </div>
      )}

      {drafts.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="crm-tabs-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
            <button type="button" onClick={() => setFilter('all')} style={chip(filter === 'all')}>All{n(counts.all)}</button>
            <button type="button" onClick={() => setFilter('replies')} style={chip(filter === 'replies')}>↩ Replies{n(counts.replies)}</button>
            <button type="button" onClick={() => setFilter('new')} style={chip(filter === 'new')}>✉ New{n(counts.new)}</button>
            <button type="button" onClick={() => setFilter('stale')} title={`Not touched in ${STALE_DAYS}+ days`} style={chip(filter === 'stale')}>⏳ {STALE_DAYS}+ days old{n(counts.stale)}</button>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search drafts" aria-label="Search drafts"
            style={{ flex: isMobile ? '1 1 100%' : '0 1 240px', marginLeft: isMobile ? 0 : 'auto', minWidth: 0, height: isMobile ? 42 : 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 14 }} />
        </div>
      )}

      {sel.size > 0 && (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 10px', background: '#111', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
          <span>{sel.size} selected</span>
          {sel.size < shown.length && <button type="button" onClick={() => setSel(new Set(shown.map(x => x.key)))} style={{ border: 'none', background: 'none', color: '#e8b563', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>All {shown.length}</button>}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => discard(shown.filter(d => sel.has(d.key)))} style={{ height: 32, padding: '0 12px', border: '1px solid #7f1d1d', borderRadius: 8, background: '#450a0a', color: '#fecaca', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>🗑 Discard</button>
          <button type="button" onClick={() => setSel(new Set())} aria-label="Clear selection" title="Clear (Esc)" style={{ width: 32, height: 32, border: 'none', borderRadius: 8, background: 'none', color: '#bbb', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {drafts.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--k-fff)', border: '1px dashed var(--k-d1d5db)', borderRadius: 12, color: 'var(--k-6b7280)' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>✎</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-374151)', marginBottom: 4 }}>No drafts</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>{syncing ? 'Checking for drafts from your other devices…' : <>Start an email from Compose, a contact or a deal and it’s saved here if you don’t send it.<br />Press <kbd style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, background: 'var(--k-f3f4f6)', border: '1px solid var(--k-e5e7eb)', borderRadius: 5, padding: '0 6px' }}>c</kbd> on this page to compose.</>}</div>
        </div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '32px 20px', textAlign: 'center', background: 'var(--k-fff)', border: '1px dashed var(--k-d1d5db)', borderRadius: 12, color: 'var(--k-6b7280)', fontSize: 14 }}>
          Nothing matches{q ? ` “${q}”` : ''}.
        </div>
      ) : (
        <div className={sel.size ? 'dr-sel' : undefined} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
          {shown.map((d, i) => {
            const to = people(`${d.to},${d.moreTo}`, nameFor);
            const snippet = plain(d.bodyHtml);
            const kind = d.context.kind === 'deal' ? '💼 Deal' : d.context.kind === 'contact' ? '👤 Contact' : '✉ New message';
            const reply = isReply(d);
            const old = stale(d);
            const days = Math.floor((Date.now() - d.updatedAt) / DAY);
            const g = groupOf(d.updatedAt), showHeader = i === 0 || groupOf(shown[i - 1].updatedAt) !== g;
            const first = to[0];
            const label = first ? (first.name || first.email) : '';
            const initial = (label || '✉').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '✉';
            return (
              <React.Fragment key={d.key}>
                {showHeader && <div style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', background: 'var(--k-fafafa)', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none', borderBottom: '1px solid var(--k-f0f0f0)' }}>{g}</div>}
                <div role="button" tabIndex={0} className="dr-row" onClick={() => onResume(d)} onKeyDown={e => { if (e.key === 'Enter') onResume(d); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '12px 12px' : '12px 16px', minHeight: 64, borderTop: !showHeader && i ? '1px solid var(--k-f3f4f6)' : 'none', cursor: 'pointer', background: sel.has(d.key) ? 'var(--k-fdf6e8)' : 'var(--k-fff)' }}>
                  <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
                    <div className="dr-av" aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', background: first ? '#475569' : '#9ca3af' }}>{initial}</div>
                    <div className="dr-chk" onClick={e => { e.stopPropagation(); tick(d.key, i, e.shiftKey); }} title="Select (shift-click for a range)">
                      <input type="checkbox" aria-label={`Select draft to ${label || 'nobody'}`} checked={sel.has(d.key)} onChange={() => {}} style={{ width: 18, height: 18, accentColor: '#c9922c', cursor: 'pointer' }} />
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {first ? <>{label}{to.length > 1 && <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> +{to.length - 1}</span>}</> : <span style={{ color: '#dc2626', fontWeight: 600 }}>(no recipient)</span>}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: old ? 'var(--k-b45309)' : 'var(--k-9ca3af)', fontWeight: old ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0 }}>{ago(d.updatedAt)}</span>
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--k-374151)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong style={{ fontWeight: 600 }}>{d.subject || '(no subject)'}</strong>
                      {snippet && <span style={{ color: 'var(--k-9ca3af)' }}> — {snippet.slice(0, 140)}</span>}
                    </div>
                    <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)' }}>
                        {kind}{d.context.label ? ` · ${d.context.label}` : ''}
                      </span>
                      {reply && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: 'var(--k-eff6ff)', color: 'var(--k-1d4ed8)' }}>↩ Reply</span>}
                      {old && <span title="Still need to send this?" style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: 'var(--k-fdf6e8)', border: '1px solid var(--k-fde68a)', color: 'var(--k-92400e)' }}>⏳ {days} days old</span>}
                      {!snippet && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: 'var(--k-fef2f2)', color: 'var(--k-dc2626)' }}>No text yet</span>}
                    </div>
                  </div>
                  <button type="button" aria-label="Discard draft" title="Discard draft (you can undo)"
                    onClick={e => { e.stopPropagation(); discard([d]); }}
                    style={{ flexShrink: 0, width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 8, color: 'var(--k-9ca3af)', cursor: 'pointer', fontSize: 17 }}>🗑</button>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: isMobile ? 84 : 24, zIndex: 80, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', background: '#111', color: '#fff', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,.25)', fontSize: 13.5, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>
          {toast.msg}
          <button type="button" onClick={toast.undo} style={{ border: 'none', background: 'none', color: '#e8b563', fontWeight: 800, cursor: 'pointer', fontSize: 13.5, fontFamily: "'DM Sans',sans-serif" }}>Undo</button>
        </div>
      )}
    </div>
  );
}
