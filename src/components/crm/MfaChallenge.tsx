'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Shown after a correct password when the login has 2-step verification turned on: the 6-digit code from the authenticator app.
// Until it is entered the session is password-only, which the server treats as signed out.
export default function MfaChallenge({ brandName, onVerified }: { brandName: string; onVerified: () => void }) {
  const supabase = createClient();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false;
    supabase.auth.mfa.listFactors().then(({ data, error: e }) => {
      if (dead) return;
      const f = data?.totp?.find(x => x.status === 'verified');
      if (e || !f) setError('Could not load your 2-step verification. Sign out and try again.');
      else setFactorId(f.id);
      setLoading(false);
      setTimeout(() => input.current?.focus(), 50);
    });
    return () => { dead = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || busy) return;
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    setBusy(true); setError('');
    const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId });
    if (ce || !ch) { setError(ce?.message ?? 'Could not start the check. Try again.'); setBusy(false); return; }
    const { error: ve } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: clean });
    if (ve) { setError('That code is not right, or it expired. Wait for the next one and try again.'); setCode(''); setBusy(false); input.current?.focus(); return; }
    setBusy(false);
    onVerified();
  }

  const wrap: React.CSSProperties = { fontFamily: "'DM Sans',sans-serif", background: '#111', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const box: React.CSSProperties = { background: 'var(--k-fff)', borderRadius: 12, padding: '40px 36px', width: 400, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,.4)' };
  return (
    <div style={wrap}>
      <div style={box}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: '#c9922c', marginBottom: 4 }}>{brandName}</div>
        <div style={{ fontSize: 14, color: 'var(--k-6b7280)', marginBottom: 20 }}>2-step verification</div>
        <p style={{ fontSize: 14, color: 'var(--k-6b7280)', margin: '0 0 16px', lineHeight: 1.5 }}>Open your authenticator app and enter the 6-digit code for this account.</p>
        {error && <div style={{ background: 'var(--k-fee2e2)', color: 'var(--k-991b1b)', padding: '8px 12px', borderRadius: 6, fontSize: 14, marginBottom: 14 }}>{error}</div>}
        <form onSubmit={verify}>
          <input ref={input} inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={e => setCode(e.target.value)} placeholder="123456" disabled={loading || !factorId}
            style={{ width: '100%', padding: '12px', border: '1px solid var(--k-ddd)', borderRadius: 6, fontSize: 22, letterSpacing: 6, textAlign: 'center', boxSizing: 'border-box', marginBottom: 16 }} />
          <button type="submit" disabled={busy || loading || !factorId}
            style={{ width: '100%', padding: '10px', background: '#111', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Checking…' : 'Verify'}</button>
        </form>
        <button onClick={() => { void supabase.auth.signOut(); }} style={{ marginTop: 14, background: 'none', border: 'none', color: 'var(--k-6b7280)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>Use a different account</button>
      </div>
    </div>
  );
}
