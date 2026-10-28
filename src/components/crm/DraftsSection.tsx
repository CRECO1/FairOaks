'use client';

import React, { useEffect, useState } from 'react';
import { listDrafts, deleteDraft, syncDrafts, onDraftsChanged, draftsServerReady, type EmailDraft } from '@/lib/email-drafts';

// Gmail's "Drafts" folder: everything you started writing and didn't send, newest first. Click one to pick
// up exactly where you left off — back in the right deal or contact, and still inside its thread if it was a reply.

const plain = (html: string) => html
  .replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li)>/gi, ' ').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function DraftsSection({ isMobile, onResume }: { isMobile: boolean; onResume: (d: EmailDraft) => void }) {
  const [drafts, setDrafts] = useState<EmailDraft[]>(() => listDrafts());
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    const refresh = () => setDrafts(listDrafts());
    const off = onDraftsChanged(refresh);
    syncDrafts().finally(() => { refresh(); setSyncing(false); });
    return off;
  }, []);

  const deviceOnly = !syncing && draftsServerReady() === false;

  return (
    <div style={{ maxWidth: 860 }}>
      <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--k-6b7280)', lineHeight: 1.5 }}>
        Anything you start writing and don’t send is saved here automatically{deviceOnly ? ' on this device' : ' — and follows you between your computer and your phone'}.
      </p>
      {deviceOnly && (
        <div style={{ margin: '0 0 14px', padding: '9px 12px', background: 'var(--k-fef9f0)', border: '1px solid var(--k-fde68a)', borderRadius: 8, fontSize: 12.5, color: 'var(--k-92400e)' }}>
          Drafts are only on this device for now. Once the one-time drafts setup is applied they’ll sync across devices too.
        </div>
      )}

      {drafts.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--k-fff)', border: '1px dashed var(--k-d1d5db)', borderRadius: 12, color: 'var(--k-6b7280)' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>✎</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-374151)', marginBottom: 4 }}>No drafts</div>
          <div style={{ fontSize: 13 }}>{syncing ? 'Checking for drafts from your other devices…' : 'Start an email from Compose, a contact or a deal and it will be saved here if you don’t send it.'}</div>
        </div>
      ) : (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
          {drafts.map((d, i) => {
            const recipients = [d.to, d.moreTo].filter(Boolean).join(', ');
            const snippet = plain(d.bodyHtml);
            const kind = d.context.kind === 'deal' ? '💼 Deal' : d.context.kind === 'contact' ? '👤 Contact' : '✉ New message';
            const isReply = !!d.context.replyToId;
            return (
              <div key={d.key} role="button" tabIndex={0}
                onClick={() => onResume(d)}
                onKeyDown={e => { if (e.key === 'Enter') onResume(d); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '12px 12px' : '12px 16px', minHeight: 64, borderTop: i ? '1px solid var(--k-f3f4f6)' : 'none', cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {recipients || <span style={{ color: '#dc2626', fontWeight: 600 }}>(no recipient)</span>}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--k-9ca3af)', whiteSpace: 'nowrap', flexShrink: 0 }}>{ago(d.updatedAt)}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--k-374151)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ fontWeight: 600 }}>{d.subject || '(no subject)'}</strong>
                    {snippet && <span style={{ color: 'var(--k-9ca3af)' }}> — {snippet.slice(0, 140)}</span>}
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)' }}>
                      {kind}{d.context.label ? ` · ${d.context.label}` : ''}
                    </span>
                    {isReply && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: 'var(--k-eff6ff)', color: 'var(--k-1d4ed8)' }}>↩ Reply</span>}
                  </div>
                </div>
                <button type="button" aria-label="Discard draft" title="Discard draft"
                  onClick={e => { e.stopPropagation(); if (confirm('Discard this draft?')) deleteDraft(d.key); }}
                  style={{ flexShrink: 0, width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 8, color: 'var(--k-9ca3af)', cursor: 'pointer', fontSize: 17 }}>🗑</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
