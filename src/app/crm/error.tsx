'use client';
import { useEffect, useState } from 'react';

// Shown instead of Next's blank "Application error" page when something in the CRM crashes in the browser.
// It reports the real error to /api/crm/client-error (audit_logs, action client_error) and offers two ways out:
// reload, or reload after clearing this browser's remembered view (the folder/document it reopens on refresh).
export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [sent, setSent] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        await fetch('/api/crm/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ message: error?.message, stack: error?.stack, digest: error?.digest, url: location.href, ua: navigator.userAgent }),
        });
        setSent(true);
      } catch { /* reporting is best-effort */ }
    })();
  }, [error]);

  const clearAndReload = () => {
    try { Object.keys(sessionStorage).filter(k => k.startsWith('crm:view:')).forEach(k => sessionStorage.removeItem(k)); } catch { /* blocked */ }
    location.reload();
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#faf7f0', color: '#111', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Something went wrong on this page</h1>
        <p style={{ margin: '0 0 16px', color: '#555', lineHeight: 1.5 }}>
          Your work is saved. {sent ? 'We have recorded what happened.' : 'Try again below.'}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => { reset(); location.reload(); }} style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#111', color: '#fff', fontSize: 15, cursor: 'pointer' }}>Reload</button>
          <button onClick={clearAndReload} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #bbb', background: '#fff', fontSize: 15, cursor: 'pointer' }}>Reset my view and reload</button>
        </div>
        <p style={{ margin: '18px 0 0', fontSize: 12, color: '#888', wordBreak: 'break-word' }}>{error?.message}</p>
      </div>
    </div>
  );
}
