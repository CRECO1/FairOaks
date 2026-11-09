'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export default function CRMSetupPage() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'done' | 'error'>('loading');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  // An account with 2-step verification turned on can only change its password from a session that has used the code (aal2), and a reset or
  // invite link signs in with the password-level only. So the page asks for the 6-digit code first, then shows the new-password form.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [checkedMfa, setCheckedMfa] = useState(false);

  useEffect(() => {
    if (status !== 'ready' || checkedMfa) return;
    setCheckedMfa(true);
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') setNeedsCode(true);
    }).catch(() => { /* if the check fails, the password step still reports any problem */ });
  }, [status, checkedMfa]);

  async function handleCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    setStatus('saving');
    const { data: f } = await supabase.auth.mfa.listFactors();
    const factor = f?.totp?.find(x => x.status === 'verified');
    if (!factor) { setError('Could not find your 2-step verification. Ask the account owner to reset it.'); setStatus('ready'); return; }
    const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (ce || !ch) { setError(ce?.message ?? 'Could not start the check. Try again.'); setStatus('ready'); return; }
    const { error: ve } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: ch.id, code: clean });
    if (ve) { setError('That code is not right, or it expired. Wait for the next one and try again.'); setCode(''); setStatus('ready'); return; }
    setNeedsCode(false); setCode(''); setStatus('ready');
  }

  useEffect(() => {
    // Handles both invite links and password reset links.
    // Supabase processes the token from the URL and fires SIGNED_IN or PASSWORD_RECOVERY.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') && session) {
        setStatus('ready');
      } else if (event === 'INITIAL_SESSION' && !session) {
        setStatus('error');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }

    setStatus('saving');
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      if (/aal2/i.test(updateError.message)) { setNeedsCode(true); setError('Enter your 6-digit code first, then set the new password.'); }
      else setError(updateError.message);
      setStatus('ready');
      return;
    }

    setStatus('done');
    setTimeout(() => { window.location.href = '/crm'; }, 1500);
  }

  const wrap: React.CSSProperties = {
    fontFamily: "'DM Sans', sans-serif",
    background: '#111',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  const box: React.CSSProperties = {
    background: '#fff',
    borderRadius: 12,
    padding: '40px 36px',
    width: 420,
    maxWidth: '95vw',
    boxShadow: '0 20px 60px rgba(0,0,0,.4)',
  };
  const label: React.CSSProperties = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', fontWeight: 500 };
  const input: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, marginTop: 4, marginBottom: 14, boxSizing: 'border-box', fontFamily: "'DM Sans', sans-serif" };

  if (status === 'loading') return (
    <div style={wrap}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 36, height: 36, border: '4px solid #c9922c', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ color: '#c9922c', fontFamily: 'sans-serif' }}>Verifying invite link…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );

  if (status === 'done') return (
    <div style={wrap}>
      <div style={{ ...box, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 700, color: '#c9922c', marginBottom: 8 }}>Account Activated!</div>
        <p style={{ color: '#6b7280', fontSize: 14 }}>Redirecting you to the CRM…</p>
      </div>
    </div>
  );

  if (status === 'error') return (
    <div style={wrap}>
      <div style={{ ...box, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, fontWeight: 700, color: '#991b1b', marginBottom: 8 }}>Invalid or Expired Link</div>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>This invite link is no longer valid. Please ask your admin to send a new invite.</p>
        <a href="/crm" style={{ color: '#c9922c', fontSize: 14 }}>← Go to Login</a>
      </div>
    </div>
  );

  return (
    <div style={wrap}>
      <div style={box}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 700, color: '#c9922c', marginBottom: 4 }}>
          CRECO / Fair Oaks Realty Group
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
          Create your password to activate your account
        </div>

        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}

        {needsCode ? (
          <form onSubmit={handleCode}>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.5, margin: '0 0 14px' }}>This account has 2-step verification on. Open your authenticator app and enter the 6-digit code to continue.</p>
            <label style={label}>6-digit code</label>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={e => setCode(e.target.value)} placeholder="123456" autoFocus
              style={{ ...input, fontSize: 22, letterSpacing: 6, textAlign: 'center', marginBottom: 20 }} />
            <button type="submit" disabled={status === 'saving'}
              style={{ width: '100%', padding: '10px', background: '#c9922c', color: '#111', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              {status === 'saving' ? 'Checking…' : 'Verify'}
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit}>
          <label style={label}>New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            style={input}
          />
          <label style={label}>Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            required
            style={{ ...input, marginBottom: 20 }}
          />
          <button
            type="submit"
            disabled={status === 'saving'}
            style={{ width: '100%', padding: '10px', background: '#c9922c', color: '#111', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
          >
            {status === 'saving' ? 'Activating…' : 'Activate My Account'}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
