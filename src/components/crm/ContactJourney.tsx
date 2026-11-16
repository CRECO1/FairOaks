'use client';
import React, { useEffect, useState } from 'react';

type Step = { key: string; label: string; at: string | null; detail: string };
const ICON: Record<string, string> = { targeted: '🎯', asked: '🏠', emailed: '✉️', replied: '↩', called: '📞', deal: '💼' };

/** One line on a contact's card: reached out → asked → emailed → they replied → called → deal, with dates, and what to do next. Hidden when there is no property context. */
export default function ContactJourney({ contactId, authToken }: { contactId: string; authToken?: string }) {
  const [d, setD] = useState<{ steps: Step[]; next: string } | null>(null);
  useEffect(() => {
    setD(null);
    if (!contactId || !authToken) return;
    let alive = true;
    fetch(`/api/crm/contact-journey?contact_id=${contactId}`, { headers: { Authorization: `Bearer ${authToken}` } }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setD(j); }).catch(() => {});
    return () => { alive = false; };
  }, [contactId, authToken]);
  if (!d || d.steps.length === 0) return null;
  return (
    <div style={{ marginTop: 10, border: '1px solid #eef0f2', borderRadius: 12, padding: '10px 12px', background: 'var(--k-fafafa, #fafafa)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--k-374151, #374151)', marginBottom: 6 }}>🧭 Where they are with us</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 4px' }}>
        {d.steps.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <span style={{ color: 'var(--k-9ca3af, #9ca3af)', fontSize: 13 }}>→</span>}
            <span title={s.detail} style={{ fontSize: 12.5, background: 'var(--k-fff, #fff)', border: '1px solid var(--k-e5e7eb, #e5e7eb)', borderRadius: 14, padding: '3px 10px', whiteSpace: 'nowrap' }}>
              {ICON[s.key]} <b>{s.label}</b>{s.at ? <span style={{ color: 'var(--k-6b7280, #6b7280)' }}> · {new Date(s.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> : ''}
            </span>
          </React.Fragment>
        ))}
      </div>
      {d.next && <div style={{ fontSize: 12.5, color: 'var(--k-0f766e, #0f766e)', fontWeight: 600, marginTop: 7 }}>Next: {d.next}</div>}
    </div>
  );
}
