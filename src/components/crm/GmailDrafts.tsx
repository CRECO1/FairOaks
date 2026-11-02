'use client';

import React, { useCallback, useEffect, useState } from 'react';

// Drafts that live in Gmail itself — written in Gmail, by the assistant, or by another app. The CRM's own saved drafts (above) never
// showed these, so a draft made elsewhere looked like it didn't exist. Read-only: "Open in Gmail" is the way to edit or send one
// (that keeps its attachments, which a CRM draft does not).

type D = { id: string; messageId: string; to: string; subject: string; snippet: string; date: number; files: string[] };
const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const DAY = 86_400_000;
const when = (ms: number) => {
  const d = new Date(ms), now = Date.now();
  if (d.toLocaleDateString('en-US', CT) === new Date(now).toLocaleDateString('en-US', CT)) return d.toLocaleTimeString('en-US', { ...CT, hour: 'numeric', minute: '2-digit' });
  return now - ms < 7 * DAY ? d.toLocaleDateString('en-US', { ...CT, weekday: 'short' }) : d.toLocaleDateString('en-US', { ...CT, month: 'short', day: 'numeric' });
};
const who = (to: string) => to.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s => s.trim()).filter(Boolean).map(s => { const m = s.match(/^"?(.*?)"?\s*<([^>]+)>$/); return (m && m[1].trim()) || (m ? m[2] : s); });

export default function GmailDrafts({ isMobile }: { isMobile: boolean }) {
  const [state, setState] = useState<{ drafts: D[]; account: string | null } | null>(null);
  const load = useCallback(async () => {
    try { const r = await fetch('/api/gmail/drafts', { cache: 'no-store' }); const j = r.ok ? await r.json() : null; setState(j?.connected ? { drafts: j.drafts as D[], account: j.account ?? null } : { drafts: [], account: null }); }
    catch { setState({ drafts: [], account: null }); }
  }, []);
  useEffect(() => { void load(); window.addEventListener('focus', load); return () => window.removeEventListener('focus', load); }, [load]);
  if (!state || !state.drafts.length) return null;
  const link = (d: D) => `https://mail.google.com/mail/${state.account ? `?authuser=${encodeURIComponent(state.account)}` : ''}#drafts?compose=${d.messageId}`;
  return (
    <div style={{ maxWidth: 860, marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--k-6b7280)' }}>In your Gmail</span>
        <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{state.drafts.length} draft{state.drafts.length === 1 ? '' : 's'} saved in Gmail — open one there to edit or send it</span>
      </div>
      <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
        {state.drafts.map((d, i) => {
          const to = who(d.to);
          return (
            <a key={d.id} href={link(d)} target="_blank" rel="noopener noreferrer" title="Open this draft in Gmail"
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '12px' : '12px 16px', minHeight: 56, borderTop: i ? '1px solid var(--k-f3f4f6)' : 'none', textDecoration: 'none', color: 'inherit', background: 'var(--k-fff)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {to.length ? <>{to[0]}{to.length > 1 && <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> +{to.length - 1}</span>}</> : <span style={{ color: '#dc2626', fontWeight: 600 }}>(no recipient)</span>}
                  </span>
                  {d.files.length > 0 && <span title={d.files.join('\n')} aria-label={`${d.files.length} attachment${d.files.length === 1 ? '' : 's'}`} style={{ fontSize: 12, color: 'var(--k-6b7280)', flexShrink: 0 }}>📎 {d.files.length}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--k-9ca3af)', whiteSpace: 'nowrap', flexShrink: 0 }}>{when(d.date)}</span>
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--k-374151)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <strong style={{ fontWeight: 600 }}>{d.subject || '(no subject)'}</strong>
                  {d.snippet && <span style={{ color: 'var(--k-9ca3af)' }}> — {d.snippet.slice(0, 140)}</span>}
                </div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--k-92400e)', whiteSpace: 'nowrap', flexShrink: 0 }}>Open in Gmail ↗</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
