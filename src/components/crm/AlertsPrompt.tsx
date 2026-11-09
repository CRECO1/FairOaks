'use client';

import { useEffect, useState } from 'react';

// Asks every agent to turn on notifications when they sign in to the commercial CRM, so Team Chat messages, @mentions, new
// leads etc. reach them. Computers: if the browser already allows notifications this subscribes silently; otherwise a small
// card asks (browsers insist the permission itself is granted by the person). iPhones only deliver to an installed app, so
// there the card explains Add to Home Screen. "Not now" hides it for this sign-in only — it asks again next time — and it never
// shows once alerts are on or the browser has blocked them.
const b64 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const SNOOZE = 'crm-alerts-prompt-snoozed';

export default function AlertsPrompt({ token, isMobile }: { token?: string; isMobile: boolean }) {
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [show, setShow] = useState<'ask' | 'install' | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const save = async (sub: PushSubscription) => {
    const r = await fetch('/api/crm/push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    if (!r.ok) throw new Error('save failed');
  };
  const subscribe = async () => {
    const reg = await navigator.serviceWorker.register('/crm-sw.js', { scope: '/crm' });
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapid!) as BufferSource }));
    await save(sub);
  };

  useEffect(() => {
    if (!vapid || !token) return;
    let cancelled = false;
    (async () => {
      try {
        if (isIos() && !isStandalone()) { if (!sessionStorage.getItem(SNOOZE)) setShow('install'); return; }
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
        if (Notification.permission === 'denied') return;
        if (Notification.permission === 'granted') { await subscribe(); return; }   // already allowed: turn it on quietly
        const reg = await navigator.serviceWorker.getRegistration('/crm');
        if (await reg?.pushManager.getSubscription()) return;
        if (!cancelled && !sessionStorage.getItem(SNOOZE)) setShow('ask');
      } catch { /* never get in the way of the CRM */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vapid, token]);

  if (!show) return null;
  const snooze = () => { try { sessionStorage.setItem(SNOOZE, '1'); } catch { /* ignore */ } setShow(null); };
  const turnOn = async () => {
    setBusy(true); setErr('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { if (perm === 'denied') setShow(null); else setErr('Notifications were not allowed — you can try again.'); return; }
      await subscribe();
      void fetch('/api/crm/push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'test' }) });
      setDone(true); setTimeout(() => setShow(null), 2500);
    } catch { setErr('Could not turn alerts on. Try again in a moment.'); } finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-label="Turn on notifications" style={{ position: 'fixed', bottom: isMobile ? 'calc(14px + env(safe-area-inset-bottom))' : 20, left: isMobile ? 12 : 20, right: isMobile ? 12 : 'auto', width: isMobile ? 'auto' : 360, zIndex: 9998, background: '#111', color: '#fff', borderLeft: '4px solid #c9922c', borderRadius: 12, padding: '14px 16px', boxShadow: '0 10px 32px rgba(0,0,0,.4)', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ fontWeight: 700, fontSize: 14.5 }}>🔔 {done ? 'Notifications are on' : 'Turn on notifications'}</div>
      <div style={{ fontSize: 13, opacity: .85, lineHeight: 1.5, marginTop: 5 }}>
        {done ? 'You’ll get a ping for team messages, @mentions, new leads and signatures. We sent a test.'
          : show === 'install' ? 'On iPhone: tap Share → “Add to Home Screen”, open the CRM from your home screen, sign in, then turn alerts on from the ☰ menu. (iOS 16.4 or newer.)'
          : 'Get a ping when a teammate messages you, you’re @tagged, or a new lead or signature comes in — even when the CRM is closed.'}
      </div>
      {err && <div style={{ fontSize: 12.5, color: '#e8b04c', marginTop: 6 }}>{err}</div>}
      {!done && (
        <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
          {show === 'ask' && <button onClick={turnOn} disabled={busy} style={{ background: '#c9922c', color: '#111', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', minHeight: 38, opacity: busy ? .6 : 1 }}>{busy ? 'One moment…' : 'Turn on'}</button>}
          <button onClick={snooze} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,.3)', borderRadius: 8, padding: '8px 14px', fontSize: 13.5, cursor: 'pointer', minHeight: 38 }}>{show === 'install' ? 'Got it' : 'Not now'}</button>
        </div>
      )}
    </div>
  );
}
