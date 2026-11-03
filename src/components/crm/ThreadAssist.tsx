'use client';

import React, { useState } from 'react';

// ✨ "Catch me up" on a deal/contact email thread: a short summary on demand, and a suggested reply that opens in the
// composer for the agent to read, change and send. Same /api/crm/email-assist the Gmail inbox uses; nothing is ever sent from here.

export type AssistMessage = { from: string; date: string; text: string };

export default function ThreadAssist({ messages, contact, canReply, onDraft, onNotify, isMobile }: {
  messages: AssistMessage[];
  contact?: { label?: string; role?: string; sub?: string };
  canReply: boolean;
  onDraft: (bodyHtml: string) => void;
  onNotify: (msg: string) => void;
  isMobile: boolean;
}) {
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState<'summarize' | 'reply' | null>(null);

  const run = async (action: 'summarize' | 'reply') => {
    if (busy || !messages.length) return;
    setBusy(action);
    try {
      const r = await fetch('/api/crm/email-assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, messages, contact }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.text) { onNotify(j.error ?? 'The assistant could not do that — try again.'); return; }
      if (action === 'summarize') { setSummary(String(j.text)); return; }
      const html = String(j.text).split(/\n{2,}/).map(par => `<p>${par.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`).join('');
      onDraft(html);
      onNotify('Draft ready — read it over, fill in any [brackets], then send.');
    } catch { onNotify('Could not reach the assistant — try again.'); } finally { setBusy(null); }
  };

  const btn: React.CSSProperties = {
    minHeight: isMobile ? 40 : 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)',
    fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap', opacity: busy ? 0.7 : 1,
  };
  const lines = summary.split('\n').map(l => l.trim()).filter(Boolean);

  return (
    <div style={{ padding: '10px 14px', background: 'var(--k-fff)', borderBottom: '1px solid var(--k-f0f0f0)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn} disabled={!!busy} onClick={() => run('summarize')} title="A short summary of this conversation and what to do next">
          {busy === 'summarize' ? '✨ Reading…' : summary ? '✨ Refresh summary' : '✨ Catch me up'}
        </button>
        {canReply && (
          <button style={btn} disabled={!!busy} onClick={() => run('reply')} title="Drafts a reply into the composer — you read it and send it">
            {busy === 'reply' ? '✨ Drafting…' : '✨ Suggest a reply'}
          </button>
        )}
      </div>
      {lines.length > 0 && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--k-f9fafb)', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 13.5, lineHeight: 1.55, color: 'var(--k-374151)' }}>
          {lines.map((l, i) => (
            <div key={i} style={{ fontWeight: i === 0 || /^Next step:/i.test(l) ? 600 : 400, color: i === 0 ? 'var(--k-111)' : undefined, marginTop: i === 0 ? 0 : 3 }}>{l}</div>
          ))}
          <button onClick={() => setSummary('')} style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, color: 'var(--k-9ca3af)', fontSize: 12, cursor: 'pointer' }}>Hide</button>
        </div>
      )}
    </div>
  );
}
