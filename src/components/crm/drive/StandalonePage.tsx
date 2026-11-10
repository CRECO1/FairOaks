'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { CRM_TOKENS_CSS } from '../crm-tokens-css';

/** The look of the CRM (colour tokens, font, light / dark as chosen in the CRM) around a standalone My Drive page. */
export function StandaloneShell({ children }: { children: ReactNode }) {
  // The theme is read after the page loads, so the first paint is hidden rather than flashing light and then switching to dark.
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => { let t: 'light' | 'dark' = 'light'; try { if (localStorage.getItem('crm:theme') === 'dark') t = 'dark'; } catch { /* private mode */ } setTheme(t); }, []);
  return (
    <div className="crm-app-shell" data-crm-theme={theme ?? 'light'} style={{ fontFamily: "'DM Sans',sans-serif", minHeight: '100dvh', background: 'var(--c-canvas)', visibility: theme ? 'visible' : 'hidden' }}>
      <style>{CRM_TOKENS_CSS}{`@keyframes crmSpin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.crm-spin{animation:none!important}}`}</style>
      {children}
    </div>
  );
}

/** True on a phone-width window, and follows the window as it is resized / rotated (the editors switch to their phone layout). */
export function useIsMobile(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const f = () => setM(mq.matches);
    f(); mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}

/** A one-line message in the middle of the page (loading, signing in, not allowed…). */
export function PageMessage({ children, action }: { children: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: 24 }}>
      {!action && <span className="crm-spin" aria-hidden style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--c-line-2, #d1d5db)', borderTopColor: '#c9922c', animation: 'crmSpin .8s linear infinite' }} />}
      <div>{children}</div>
      {action && <button type="button" onClick={action.onClick} style={{ padding: '9px 18px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>{action.label}</button>}
    </div>
  );
}

/** A small message that fades after a few seconds (the CRM's toast, for pages that are not inside the CRM). */
export function useToast(): [string, (m: string) => void] {
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t); }, [msg]);
  return [msg, setMsg];
}
export function Toast({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div role="status" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 3000, background: '#111', color: '#fff', border: '1px solid #c9922c', borderRadius: 10, padding: '10px 16px', fontSize: 13.5, fontWeight: 600, maxWidth: '86vw' }}>{msg}</div>;
}
