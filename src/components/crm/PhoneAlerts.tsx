'use client';

import { useCallback, useEffect, useState } from 'react';
import Ico from '@/components/crm/Ico';
import { PUSH_CATEGORIES, type PushCategory } from '@/lib/push-categories';

type St = 'loading' | 'unavailable' | 'unsupported' | 'install' | 'denied' | 'off' | 'on';

const b64 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * "Phone alerts" for the CRM: real notifications (tagged, assigned, new lead, voicemail, signature…) that reach
 * your phone even when the CRM is closed. Modeled on the TORCH app's toggle. iPhones only deliver web push to an
 * installed app, so on iOS in Safari this explains Add to Home Screen instead of showing a button that can't work.
 *
 * `tone="dark"` is for the sidebar/drawer (always dark); the default follows the CRM theme.
 */
export default function PhoneAlerts({ token, tone = 'theme', visitors = false }: { token?: string; tone?: 'theme' | 'dark'; visitors?: boolean }) {
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [st, setSt] = useState<St>('loading');
  const [cats, setCats] = useState<PushCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [endpoint, setEndpoint] = useState('');

  const headers = useCallback((json = false): HeadersInit => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!vapid) return setSt('unavailable');
      if (isIos() && !isStandalone()) return setSt('install');
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setSt('unsupported');
      if (Notification.permission === 'denied') return setSt('denied');
      try {
        const reg = await navigator.serviceWorker.getRegistration('/crm');
        const sub = await reg?.pushManager.getSubscription();
        if (cancelled) return;
        if (sub && Notification.permission === 'granted') {
          setEndpoint(sub.endpoint);
          // Re-save quietly (the server may have pruned it) and read back what this device is set to hear.
          const r = await fetch('/api/crm/push', { method: 'POST', headers: headers(true), body: JSON.stringify({ subscription: sub.toJSON() }) });
          const j = await r.json().catch(() => ({}));
          if (cancelled) return;
          if (r.ok) { setCats(j.categories ?? []); setSt('on'); } else setSt('off');
        } else setSt('off');
      } catch { if (!cancelled) setSt('off'); }
    })();
    return () => { cancelled = true; };
  }, [vapid, headers]);

  const enable = async () => {
    if (!vapid) return;
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.register('/crm-sw.js', { scope: '/crm' });
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setSt(perm === 'denied' ? 'denied' : 'off'); return; }
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapid) as BufferSource }));
      const r = await fetch('/api/crm/push', { method: 'POST', headers: headers(true), body: JSON.stringify({ subscription: sub.toJSON() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'save failed');
      setEndpoint(sub.endpoint); setCats(j.categories ?? []); setSt('on');
      // Prove it works: a real alert now.
      void fetch('/api/crm/push', { method: 'POST', headers: headers(true), body: JSON.stringify({ action: 'test' }) });
    } catch (e) { setMsg(e instanceof Error && e.message !== 'save failed' ? e.message : 'Could not turn alerts on for this device. Try again in a moment.'); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/crm');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/crm/push', { method: 'DELETE', headers: headers(true), body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setSt('off');
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMsg('');
    const r = await fetch('/api/crm/push', { method: 'POST', headers: headers(true), body: JSON.stringify({ action: 'test' }) });
    const j = await r.json().catch(() => ({}));
    setMsg(j.sent ? 'Sent — look for it on this device.' : 'Could not reach this device. Try turning alerts off and on again.');
    setBusy(false);
  };

  const toggleCat = async (k: PushCategory) => {
    const next = cats.includes(k) ? cats.filter(c => c !== k) : [...cats, k];
    setCats(next);
    await fetch('/api/crm/push', { method: 'PATCH', headers: headers(true), body: JSON.stringify({ endpoint, categories: next }) });
  };

  if (st === 'loading' || st === 'unavailable' || st === 'unsupported') return null;

  const dark = tone === 'dark';
  const ink = dark ? '#fff' : 'var(--c-ink)';
  const sub = dark ? 'rgba(255,255,255,.55)' : 'var(--c-muted)';
  const btn: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif", opacity: busy ? .6 : 1, minHeight: 36 };
  const gold: React.CSSProperties = { ...btn, background: '#c9922c', color: '#111', border: 'none' };
  const ghost: React.CSSProperties = { ...btn, background: 'transparent', color: ink, border: `1px solid ${dark ? 'rgba(255,255,255,.25)' : 'var(--c-line)'}` };

  return (
    <div style={{ padding: '12px 14px', border: `1px solid ${dark ? 'rgba(255,255,255,.12)' : 'var(--c-line)'}`, borderRadius: 10, background: dark ? 'rgba(255,255,255,.04)' : 'var(--c-surface-2)', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ink, fontSize: 13.5, fontWeight: 700 }}>
        <Ico n="bell" size={16} style={{ color: st === 'on' ? '#76c595' : '#c9922c' }} />
        {st === 'on' ? 'Phone alerts are on' : 'Get alerts on your phone'}
      </div>
      <div style={{ fontSize: 12.5, color: sub, lineHeight: 1.5, marginTop: 5 }}>
        {st === 'install' ? 'On iPhone: tap Share, choose “Add to Home Screen”, open the CRM from your home screen, sign in, then turn alerts on here. (Needs iOS 16.4 or newer.)'
          : st === 'denied' ? 'Notifications are blocked for this site. Allow them in your phone or browser settings, then reopen the CRM.'
          : st === 'on' ? 'This device gets a ping for the things you pick:'
          : 'Tagged, assigned a call list, new lead, voicemail, signature — even when the CRM is closed.'}
      </div>
      {st === 'off' && <div style={{ marginTop: 10 }}><button style={gold} onClick={enable} disabled={busy}>{busy ? 'One moment…' : 'Turn on phone alerts'}</button></div>}
      {st === 'on' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 9 }}>
            {PUSH_CATEGORIES.filter(c => visitors || c.key !== 'visitors').map(c => (
              <label key={c.key} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer', color: ink, fontSize: 13 }}>
                <input type="checkbox" checked={cats.includes(c.key)} onChange={() => toggleCat(c.key)} style={{ marginTop: 3, accentColor: '#c9922c' }} />
                <span><b style={{ fontWeight: 600 }}>{c.label}</b><br /><span style={{ color: sub, fontSize: 12 }}>{c.hint}</span></span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
            <button style={ghost} onClick={test} disabled={busy}>Send a test</button>
            <button style={ghost} onClick={disable} disabled={busy}>Turn off</button>
          </div>
        </>
      )}
      {msg && <div style={{ fontSize: 12.5, color: '#c9922c', marginTop: 8, fontWeight: 600 }}>{msg}</div>}
    </div>
  );
}
