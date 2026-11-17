'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Ico from '@/components/crm/Ico';
import PhoneAlerts from '@/components/crm/PhoneAlerts';

// The agent's own Settings page: profile, email + signature, goals, appearance, notifications, security.
// Everything here is about the signed-in person only (role / workspace changes stay with the broker).

type Prof = { id: string; email: string; first_name: string; last_name: string; phone?: string; license?: string; email_signature?: string; role: string };
type GmailAcct = { id: string; email: string; needsReconnect?: boolean };

const SECTIONS = [
  { id: 'profile', label: 'Profile', ico: 'users' },
  { id: 'email', label: 'Email & signature', ico: 'mail' },
  { id: 'goals', label: 'Goals', ico: 'chart' },
  { id: 'appearance', label: 'Appearance', ico: 'sun' },
  { id: 'notifications', label: 'Notifications', ico: 'bell' },
  { id: 'security', label: 'Security', ico: 'pen' },
] as const;
type SectionId = typeof SECTIONS[number]['id'];

const card: React.CSSProperties = { background: 'var(--k-fff, #fff)', border: '1px solid var(--k-e5e7eb, #e5e7eb)', borderRadius: 12, padding: 20, marginBottom: 16 };
const h2: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: 'var(--k-111, #111)', margin: 0 };
const sub: React.CSSProperties = { fontSize: 13, color: 'var(--k-6b7280, #6b7280)', margin: '4px 0 16px', lineHeight: 1.45 };
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--k-6b7280, #6b7280)', marginBottom: 4, display: 'block' };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 16, border: '1px solid var(--k-d1d5db, #d1d5db)', borderRadius: 8, background: 'var(--k-fff, #fff)', color: 'var(--k-111, #111)', fontFamily: "'DM Sans',sans-serif" };
const gold: React.CSSProperties = { background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
const ghost: React.CSSProperties = { background: 'none', color: 'var(--k-111, #111)', border: '1px solid var(--k-d1d5db, #d1d5db)', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderTop: '1px solid var(--k-f0f0f0, #f0f0f0)', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111, #111)' }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export default function SettingsPage(props: {
  supabase: SupabaseClient;
  profile: Prof;
  onProfileChange: (p: Partial<Prof>) => void;
  token?: string;
  userId: string;
  businessUnit: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isMobile: boolean;
  gmailAccounts: GmailAcct[];
  onDisconnectGmail: (id: string) => void;
  onSyncSignature: () => void;
  callGoal: number;
  onSaveCallGoal: (n: number) => void;
  theme: 'light' | 'dark';
  onTheme: (t: 'light' | 'dark') => void;
  hasMfa: boolean;
  onOpenMfa: () => void;
  onSignOut: () => void;
  notify: (m: string) => void;
}) {
  const { profile, supabase, notify } = props;
  const [section, setSection] = useState<SectionId>('profile');
  const [first, setFirst] = useState(profile.first_name ?? '');
  const [last, setLast] = useState(profile.last_name ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [license, setLicense] = useState(profile.license ?? '');
  const [saving, setSaving] = useState(false);
  const [goal, setGoal] = useState(String(props.callGoal));
  useEffect(() => { setGoal(String(props.callGoal)); }, [props.callGoal]);

  const dirty = first.trim() !== (profile.first_name ?? '') || last.trim() !== (profile.last_name ?? '') || phone.trim() !== (profile.phone ?? '') || license.trim() !== (profile.license ?? '');
  const initials = ((profile.first_name?.[0] ?? '') + (profile.last_name?.[0] ?? '')).toUpperCase();
  const sigHtml = useMemo(() => {
    // Preview only: strip scripts/handlers from the synced Gmail signature before showing it.
    const s = profile.email_signature ?? '';
    return s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/javascript:/gi, '');
  }, [profile.email_signature]);

  async function saveProfile() {
    if (!first.trim()) { notify('First name can’t be empty'); return; }
    setSaving(true);
    const patch = { first_name: first.trim(), last_name: last.trim(), phone: phone.trim(), license: license.trim() };
    const { error } = await supabase.from('crm_profiles').update(patch).eq('id', profile.id);
    setSaving(false);
    if (error) { notify('Couldn’t save — ' + error.message); return; }
    props.onProfileChange(patch);
    notify('Profile saved');
  }

  function commitGoal() {
    const n = Math.round(Number(goal));
    if (!Number.isFinite(n) || n < 1 || n > 500) { notify('Pick a daily goal between 1 and 500 calls'); setGoal(String(props.callGoal)); return; }
    if (n !== props.callGoal) { props.onSaveCallGoal(n); notify('Daily call goal saved'); }
  }

  return (
    <div style={{ padding: props.isMobile ? '16px 16px 90px' : '28px 32px 40px', maxWidth: 1040, margin: '0 auto', width: '100%', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#c9922c', color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>{initials}</div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--k-111, #111)' }}>Settings</h1>
          <div style={{ fontSize: 13, color: 'var(--k-6b7280, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.first_name} {profile.last_name} · {profile.email} · {props.isSuperAdmin ? 'Owner' : props.isAdmin ? 'Broker · Admin' : 'Agent'}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, flexDirection: props.isMobile ? 'column' : 'row', alignItems: 'flex-start' }}>
        <nav aria-label="Settings sections" style={props.isMobile
          ? { display: 'flex', gap: 8, overflowX: 'auto', width: '100%', paddingBottom: 4 }
          : { width: 210, flexShrink: 0, position: 'sticky', top: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {SECTIONS.map(s => {
            const on = section === s.id;
            return (
              <button key={s.id} onClick={() => setSection(s.id)} aria-current={on ? 'page' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: on ? 700 : 500, whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif",
                  background: on ? 'rgba(201,146,44,.14)' : 'transparent', color: on ? '#a06f12' : 'var(--k-374151, #374151)', minHeight: 40 }}>
                <Ico n={s.ico} size={17} />{s.label}
              </button>
            );
          })}
          <button onClick={props.onSignOut} style={{ ...ghost, marginTop: props.isMobile ? 0 : 12, whiteSpace: 'nowrap', minHeight: 40 }}>⏻ Sign out</button>
        </nav>

        <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
          {section === 'profile' && (
            <section style={card}>
              <h2 style={h2}>Profile</h2>
              <p style={sub}>This is how your name and contact details appear on emails, flyers, e-sign requests and your teammates’ screens.</p>
              <div style={{ display: 'grid', gridTemplateColumns: props.isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
                <div><label style={label} htmlFor="st-first">First name</label><input id="st-first" style={input} value={first} onChange={e => setFirst(e.target.value)} autoComplete="given-name" /></div>
                <div><label style={label} htmlFor="st-last">Last name</label><input id="st-last" style={input} value={last} onChange={e => setLast(e.target.value)} autoComplete="family-name" /></div>
                <div><label style={label} htmlFor="st-phone">Phone</label><input id="st-phone" style={input} value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></div>
                <div><label style={label} htmlFor="st-lic">License #</label><input id="st-lic" style={input} value={license} onChange={e => setLicense(e.target.value)} /></div>
                <div style={{ gridColumn: props.isMobile ? 'auto' : '1 / -1' }}>
                  <label style={label} htmlFor="st-email">Login email</label>
                  <input id="st-email" style={{ ...input, opacity: .65 }} value={profile.email} readOnly />
                  <div style={{ fontSize: 12, color: 'var(--k-9ca3af, #9ca3af)', marginTop: 4 }}>To change your login email or role, ask the broker.</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button style={{ ...gold, opacity: dirty && !saving ? 1 : .5 }} disabled={!dirty || saving} onClick={saveProfile}>{saving ? 'Saving…' : 'Save changes'}</button>
                {dirty && <button style={ghost} onClick={() => { setFirst(profile.first_name ?? ''); setLast(profile.last_name ?? ''); setPhone(profile.phone ?? ''); setLicense(profile.license ?? ''); }}>Discard</button>}
              </div>
            </section>
          )}

          {section === 'email' && (
            <>
              <section style={card}>
                <h2 style={h2}>Connected Google accounts</h2>
                <p style={sub}>Your Gmail and Calendar connect here so emails you send from the CRM come from you and tasks sync to your calendar.</p>
                {props.gmailAccounts.length === 0 && <div style={{ fontSize: 13, color: 'var(--k-6b7280, #6b7280)', marginBottom: 12 }}>No Google account connected yet.</div>}
                {props.gmailAccounts.map(a => (
                  <Row key={a.id} title={a.email} hint={a.needsReconnect ? 'Google stopped accepting this connection — reconnect to keep sending.' : 'Connected'}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {a.needsReconnect && <button style={gold} onClick={() => { window.location.href = `/api/gmail/auth?userId=${props.userId}&bu=${props.businessUnit}`; }}>Reconnect</button>}
                      <button style={ghost} onClick={() => { if (window.confirm(`Disconnect ${a.email}? You can reconnect any time.`)) props.onDisconnectGmail(a.id); }}>Disconnect</button>
                    </div>
                  </Row>
                ))}
                <div style={{ marginTop: 12 }}>
                  <button style={props.gmailAccounts.length ? ghost : gold} onClick={() => { window.location.href = `/api/gmail/auth?userId=${props.userId}&bu=${props.businessUnit}`; }}>
                    ＋ {props.gmailAccounts.length ? 'Add another account' : 'Connect Google account'}
                  </button>
                </div>
              </section>
              <section style={card}>
                <h2 style={h2}>Email signature</h2>
                <p style={sub}>Added to every email you send from the CRM, action plans and Copilot drafts. It is copied from your Gmail signature — edit it in Gmail, then sync here.</p>
                <div style={{ border: '1px solid var(--k-e5e7eb, #e5e7eb)', borderRadius: 8, padding: 14, background: '#fff', color: '#111', maxHeight: 260, overflow: 'auto', fontSize: 13 }}>
                  {sigHtml ? <div dangerouslySetInnerHTML={{ __html: sigHtml }} /> : <span style={{ color: '#9ca3af' }}>No signature yet. Connect Google, then press “Sync from Gmail”.</span>}
                </div>
                <div style={{ marginTop: 14 }}><button style={ghost} onClick={props.onSyncSignature}>↻ Sync from Gmail</button></div>
              </section>
            </>
          )}

          {section === 'goals' && (
            <section style={card}>
              <h2 style={h2}>Goals</h2>
              <p style={sub}>Your daily call goal drives the progress ring in the Call Queue and the Dashboard.</p>
              <Row title="Daily call goal" hint="Calls you want to make each day (1–500).">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input aria-label="Daily call goal" style={{ ...input, width: 90, textAlign: 'center' }} inputMode="numeric" value={goal}
                    onChange={e => setGoal(e.target.value.replace(/[^0-9]/g, ''))} onBlur={commitGoal} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  <span style={{ fontSize: 13, color: 'var(--k-6b7280, #6b7280)' }}>calls / day</span>
                </div>
              </Row>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {[15, 25, 40, 60].map(n => (
                  <button key={n} style={{ ...ghost, ...(props.callGoal === n ? { borderColor: '#c9922c', color: '#a06f12' } : {}) }} onClick={() => { setGoal(String(n)); props.onSaveCallGoal(n); notify('Daily call goal saved'); }}>{n}</button>
                ))}
              </div>
            </section>
          )}

          {section === 'appearance' && (
            <section style={card}>
              <h2 style={h2}>Appearance</h2>
              <p style={sub}>Remembered on this device.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 440 }}>
                {(['light', 'dark'] as const).map(t => {
                  const on = props.theme === t;
                  return (
                    <button key={t} onClick={() => props.onTheme(t)} aria-pressed={on}
                      style={{ border: `2px solid ${on ? '#c9922c' : 'var(--k-e5e7eb, #e5e7eb)'}`, borderRadius: 12, padding: 12, background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif", color: 'var(--k-111, #111)' }}>
                      <div style={{ height: 64, borderRadius: 8, background: t === 'dark' ? '#16181d' : '#f4f4f5', border: '1px solid rgba(0,0,0,.12)', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t === 'dark' ? '#e5e7eb' : '#374151' }}><Ico n={t === 'dark' ? 'moon' : 'sun'} size={22} /></div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{t === 'dark' ? 'Dark' : 'Light'}{on ? ' ✓' : ''}</div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {section === 'notifications' && (
            <section style={card}>
              <h2 style={h2}>Notifications</h2>
              <p style={sub}>Phone and desktop alerts for new leads, @mentions, voicemails and signatures — they reach you even when the CRM is closed. Choose which kinds you want below.</p>
              {props.businessUnit === 'commercial'
                ? <PhoneAlerts token={props.token} visitors={props.isSuperAdmin} explainUnavailable />
                : <div style={{ fontSize: 13, color: 'var(--k-6b7280, #6b7280)' }}>Phone alerts are available in the Commercial workspace.</div>}
            </section>
          )}

          {section === 'security' && (
            <section style={card}>
              <h2 style={h2}>Security</h2>
              <p style={sub}>Protect your account and the client data in it.</p>
              <Row title="2-step verification" hint={props.hasMfa ? 'On — sign-in needs your password and a 6-digit code.' : 'Off — turn it on so a stolen password isn’t enough to get in.'}>
                <button style={props.hasMfa ? ghost : gold} onClick={props.onOpenMfa}>{props.hasMfa ? 'Manage' : 'Turn on'}</button>
              </Row>
              <Row title="Sign out" hint="Ends your session on this device.">
                <button style={ghost} onClick={props.onSignOut}>Sign out</button>
              </Row>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
