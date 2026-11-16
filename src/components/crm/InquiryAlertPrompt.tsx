'use client';
import React, { useEffect, useState } from 'react';
import type { PushCategory } from '@/lib/push-categories';

const DISMISS = 'crm:inquiry-alert-prompt-dismissed';
type St = 'hidden' | 'one-tap' | 'setup' | 'done';

/**
 * One-time offer to a listing agent: "Get a morning summary when someone asks about your listings?" If phone alerts are already on for this
 * device it is one tap (the 'Property inquiries' alert is added to this device); if not, it points to where to switch them on. Never shown to
 * anyone who isn't a listing agent, or who already has it, or who said no thanks (remembered on this device).
 */
export default function InquiryAlertPrompt({ authToken, onToast }: { authToken?: string; onToast: (m: string) => void }) {
  const [st, setSt] = useState<St>('hidden');
  const [cats, setCats] = useState<PushCategory[]>([]);
  const [endpoint, setEndpoint] = useState('');
  const h = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    let alive = true;
    (async () => {
      try { if (localStorage.getItem(DISMISS)) return; } catch { /* ignore */ }
      if (!authToken) return;
      const a = await fetch('/api/crm/inquiry-alert', { headers: h }).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (!alive || !a?.listingAgent) return;
      try {
        if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Notification.permission === 'granted') {
          const reg = await navigator.serviceWorker.getRegistration('/crm');
          const sub = await reg?.pushManager.getSubscription();
          if (sub) {
            const r = await fetch('/api/crm/push', { method: 'POST', headers: h, body: JSON.stringify({ subscription: sub.toJSON() }) });
            const j = await r.json().catch(() => ({}));
            if (!alive) return;
            if (r.ok) {
              const c = (j.categories ?? []) as PushCategory[];
              if (c.includes('inquiries')) return;       // already getting it
              setCats(c); setEndpoint(sub.endpoint); setSt('one-tap'); return;
            }
          }
        }
      } catch { /* fall through to setup hint */ }
      if (alive) setSt('setup');
    })();
    return () => { alive = false; };
  }, [authToken]); // eslint-disable-line

  const dismiss = () => { try { localStorage.setItem(DISMISS, '1'); } catch { /* ignore */ } setSt('hidden'); };
  const turnOn = async () => {
    const r = await fetch('/api/crm/push', { method: 'PATCH', headers: h, body: JSON.stringify({ endpoint, categories: [...new Set([...cats, 'inquiries'])] }) }).catch(() => null);
    if (r?.ok) { onToast('Morning inquiry summary is on for this device'); setSt('done'); try { localStorage.setItem(DISMISS, '1'); } catch { /* ignore */ } } else onToast('Could not turn that on — try Phone alerts in your profile');
  };
  if (st === 'hidden' || st === 'done') return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--k-f0fdfa, #f0fdfa)', border: '1px solid var(--k-99f6e4, #99f6e4)', borderRadius: 12, padding: '10px 14px', margin: '0 0 12px', fontSize: 13 }}>
      <span style={{ flex: '1 1 240px' }}>
        🏠 <b>Get a morning summary when someone asks about your listings?</b>{' '}
        {st === 'one-tap' ? 'One tap and this phone gets it on weekdays.' : 'Turn on Phone alerts in your profile first, then choose “Property inquiries”.'}
      </span>
      {st === 'one-tap' && <button onClick={turnOn} style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 14px', borderRadius: 16, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-fff, #fff)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>Turn on</button>}
      <button onClick={dismiss} style={{ fontSize: 12.5, padding: '6px 12px', borderRadius: 16, border: 'none', background: 'none', color: 'var(--k-6b7280, #6b7280)', cursor: 'pointer' }}>No thanks</button>
    </div>
  );
}
