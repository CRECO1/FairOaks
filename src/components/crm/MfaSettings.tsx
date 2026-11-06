'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// "2-step verification" for the signed-in user: turn it on (scan a QR code with an authenticator app, confirm one code) or off.
// Once on, signing in needs the password AND a 6-digit code, so a stolen or reused password is not enough to get into the CRM.
type Factor = { id: string; status: string };

export default function MfaSettings({ onClose, onChange }: { onClose: () => void; onChange?: (enabled: boolean) => void }) {
  const supabase = createClient();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [loading, setLoading] = useState(true);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactor((data?.totp ?? []).find(f => f.status === 'verified') ?? null);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setBusy(true); setError(''); setMsg('');
    // Clear any half-finished setup so a fresh QR code can be made.
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of (all?.all ?? []).filter(x => x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `CRM ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (e || !data) { setError(e?.message ?? 'Could not start setup.'); return; }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll || busy) return;
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) { setError('Enter the 6-digit code shown in your app.'); return; }
    setBusy(true); setError('');
    const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId: enroll.id });
    if (ce || !ch) { setBusy(false); setError(ce?.message ?? 'Could not check the code.'); return; }
    const { error: ve } = await supabase.auth.mfa.verify({ factorId: enroll.id, challengeId: ch.id, code: clean });
    setBusy(false);
    if (ve) { setError('That code is not right. Wait for the next one and try again.'); setCode(''); return; }
    setEnroll(null); setCode(''); setMsg('2-step verification is on. Next time you sign in you will be asked for a code.');
    await load(); onChange?.(true);
  }

  async function turnOff() {
    if (!factor || busy) return;
    if (!window.confirm('Turn off 2-step verification? Signing in will need only your password.')) return;
    setBusy(true); setError('');
    const { error: e } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    setBusy(false);
    if (e) { setError(e.message || 'Could not turn it off.'); return; }
    setMsg('2-step verification is off.'); await load(); onChange?.(false);
  }

  const btn: React.CSSProperties = { padding: '9px 16px', background: '#111', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' };
  return (
    <div role="dialog" aria-modal="true" aria-label="2-step verification" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--k-fff)', color: 'var(--k-111)', borderRadius: 12, padding: '28px 28px 24px', width: 420, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>2-step verification</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--k-6b7280)' }}>×</button>
        </div>
        {loading ? <p style={{ color: 'var(--k-6b7280)' }}>Loading…</p> : enroll ? (
          <form onSubmit={confirm}>
            <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 12px' }}>1. In an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy), scan this code.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="QR code to scan" width={180} height={180} style={{ display: 'block', margin: '0 auto 8px', background: '#fff', padding: 6, borderRadius: 6 }} />
            <p style={{ fontSize: 12, color: 'var(--k-6b7280)', margin: '0 0 14px', textAlign: 'center', wordBreak: 'break-all' }}>Can’t scan? Enter this key instead:<br /><code>{enroll.secret}</code></p>
            <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 8px' }}>2. Type the 6-digit code the app shows.</p>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={e => setCode(e.target.value)} placeholder="123456"
              style={{ width: '100%', padding: 10, border: '1px solid var(--k-ddd)', borderRadius: 6, fontSize: 20, letterSpacing: 5, textAlign: 'center', boxSizing: 'border-box', marginBottom: 12 }} />
            {error && <div style={{ color: 'var(--k-991b1b)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={busy} style={btn}>{busy ? 'Checking…' : 'Turn on'}</button>
              <button type="button" onClick={async () => { await supabase.auth.mfa.unenroll({ factorId: enroll.id }); setEnroll(null); setError(''); }} style={{ ...btn, background: 'none', color: 'var(--k-6b7280)', border: '1px solid var(--k-ddd)' }}>Cancel</button>
            </div>
          </form>
        ) : factor ? (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 14px' }}><strong style={{ color: '#15803d' }}>On.</strong> Signing in needs your password and a 6-digit code from your authenticator app.</p>
            {msg && <div style={{ color: '#15803d', fontSize: 13, marginBottom: 10 }}>{msg}</div>}
            {error && <div style={{ color: 'var(--k-991b1b)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <button onClick={turnOff} disabled={busy} style={{ ...btn, background: 'none', color: 'var(--k-991b1b)', border: '1px solid var(--k-ddd)' }}>Turn off</button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 14px' }}>Add a second lock to your login. After your password you will also enter a 6-digit code from an app on your phone, so a stolen or reused password alone can’t open the CRM.</p>
            {msg && <div style={{ color: '#15803d', fontSize: 13, marginBottom: 10 }}>{msg}</div>}
            {error && <div style={{ color: 'var(--k-991b1b)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <button onClick={start} disabled={busy} style={btn}>{busy ? 'Starting…' : 'Set up 2-step verification'}</button>
          </>
        )}
      </div>
    </div>
  );
}
