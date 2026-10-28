'use client';

import React, { useEffect, useState } from 'react';
import { listDrafts, deleteDraft, onDraftsChanged, type EmailDraft } from '@/lib/email-drafts';

// The Drafts folder, scoped to one contact or deal: the emails an agent started here and hasn't sent, sitting
// right above the composer so they can pick one up later without hunting through the Drafts page.

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

export default function CardDrafts({ match, hideKeys = [], isMobile, onOpen }: {
  match: (d: EmailDraft) => boolean;
  hideKeys?: string[];      // drafts whose composer is already open on screen
  isMobile: boolean;
  onOpen: (d: EmailDraft) => void;
}) {
  const [all, setAll] = useState<EmailDraft[]>(() => listDrafts());
  useEffect(() => { setAll(listDrafts()); return onDraftsChanged(() => setAll(listDrafts())); }, []);

  const mine = all.filter(d => match(d) && !hideKeys.includes(d.key));
  if (mine.length === 0) return null;

  return (
    <div style={{ margin: '0 0 12px', border: '1px solid var(--k-fde68a)', background: 'var(--k-fef9f0)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '7px 12px', fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, color: 'var(--k-92400e)' }}>
        ✎ Saved drafts · {mine.length}
      </div>
      {mine.map(d => {
        const snippet = plain(d.bodyHtml);
        return (
          <div key={d.key} role="button" tabIndex={0} onClick={() => onOpen(d)} onKeyDown={e => { if (e.key === 'Enter') onOpen(d); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 12px' : '8px 12px', minHeight: isMobile ? 56 : 44, borderTop: '1px solid var(--k-fde68a)', cursor: 'pointer', background: 'var(--k-fff)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                  {d.context.replyToId && <span style={{ color: 'var(--k-1d4ed8)', marginRight: 6 }}>↩</span>}{d.subject || '(no subject)'}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--k-9ca3af)', whiteSpace: 'nowrap', flexShrink: 0 }}>{ago(d.updatedAt)}</span>
              </div>
              {snippet && <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet.slice(0, 140)}</div>}
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#c9922c', whiteSpace: 'nowrap' }}>Continue</span>
            <button type="button" aria-label="Discard draft" title="Discard draft"
              onClick={e => { e.stopPropagation(); if (confirm('Discard this draft?')) deleteDraft(d.key); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--k-9ca3af)', padding: '6px 8px', minWidth: 36, minHeight: 36 }}>🗑</button>
          </div>
        );
      })}
    </div>
  );
}
