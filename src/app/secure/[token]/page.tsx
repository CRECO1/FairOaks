'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

// The visitor's side of a secure folder: a private, expiring page with no login.
//  • A plain link is UPLOAD-ONLY: it shows only the names of what was sent through it; nothing here can read a file back.
//  • A link with a password shows a password box and nothing else until it is right. If the folder's owner allowed it, the
//    visitor can then also open the folder's files. The pass lasts 30 minutes and lives only in this tab.

interface Item { key: string; label: string }
interface UFile { id: string; item_key: string | null; name: string; file_size: number | null; mine?: boolean }
interface Data {
  state: 'ok' | 'expired' | 'revoked' | 'deleted' | 'password'; agentName: string; name?: string | null; items?: Item[]; note?: string | null;
  expiresAt?: string; submitted?: boolean; files?: UFile[]; maxFileMb?: number;
  kind?: 'request' | 'folder'; title?: string | null; canView?: boolean; lockedMinutes?: number;
}

const GOLD = '#c9922c';
const kb = (n: number | null) => (n == null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const OTHER = 'other';

export default function SecureUploadPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [files, setFiles] = useState<UFile[]>([]);
  const [busy, setBusy] = useState<Record<string, string>>({});   // item key → "Uploading name…"
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sentBefore, setSentBefore] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [missing, setMissing] = useState(false);
  const api = `/api/secure-upload/${token}`;
  const pickRef = useRef<HTMLInputElement>(null);
  const pickKey = useRef<string>(OTHER);
  // The pass a right password earns. Kept for this tab only (sessionStorage), so a refresh doesn't ask again within its 30 minutes.
  const passKey = `secure-pass:${token}`;
  const pass = useRef<string | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const headers = useCallback((json = false): Record<string, string> => ({ ...(json ? { 'Content-Type': 'application/json' } : {}), ...(pass.current ? { 'x-secure-session': pass.current } : {}) }), []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(api, { cache: 'no-store', headers: headers() });
      if (r.status === 404) { setMissing(true); return; }
      if (r.status === 429) { setErr('Lots of people are using this link right now — please wait a minute and refresh.'); return; }
      const j: Data = await r.json();
      setData(j); setFiles(j.files ?? []); setDone(!!j.submitted); setSentBefore(!!j.submitted);
      if (j.state === 'password' && j.lockedMinutes) setPwErr(`Too many wrong passwords. Please wait ${j.lockedMinutes} minute${j.lockedMinutes === 1 ? '' : 's'} and try again.`);
    } catch { setErr('We couldn’t load this page. Please check your connection and refresh.'); }
  }, [api, headers]);
  useEffect(() => {
    try { pass.current = sessionStorage.getItem(passKey); } catch { /* private window: just ask for the password */ }
    void load();
  }, [load, passKey]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch(api, { method: 'POST', headers: headers(true), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    // The pass ran out (or the password was changed): back to the password box, nothing lost on the server.
    if (r.status === 401 && j.needsPassword) {
      pass.current = null; try { sessionStorage.removeItem(passKey); } catch { /* ignore */ }
      setPwErr('For your security, please enter the password again.');
      setData(d => (d ? { state: 'password', agentName: d.agentName } : d));
    }
    return { ok: r.ok, j };
  }, [api, headers, passKey]);

  const unlock = async () => {
    if (!password || unlocking) return;
    setUnlocking(true); setPwErr(null);
    try {
      const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unlock', password }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 410) { setData(d => ({ state: 'revoked', agentName: d?.agentName ?? 'your CRECO broker' })); return; }
      if (!r.ok || !j.session) { setPwErr(j.error || 'That’s not the password.'); return; }
      pass.current = j.session as string;
      try { sessionStorage.setItem(passKey, pass.current); } catch { /* still works for this page load */ }
      setPassword('');
      await load();
    } catch { setPwErr('We couldn’t check the password. Please check your connection and try again.'); }
    finally { setUnlocking(false); }
  };

  const openFile = async (f: UFile) => {
    setOpening(f.id); setErr(null);
    // Opened synchronously: a tab opened after an await is blocked as a pop-up.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    const r = await post({ action: 'download', fileId: f.id });
    setOpening(null);
    if (!r.ok || !r.j.url) { win?.close(); if (!r.j.needsPassword) setErr(r.j.error || 'Could not open that file.'); return; }
    if (win) win.location.href = r.j.url; else window.location.href = r.j.url;
  };

  const upload = async (itemKey: string, list: FileList | null) => {
    if (!list?.length) return;
    setErr(null); setDone(false);
    for (const file of Array.from(list)) {
      setBusy(b => ({ ...b, [itemKey]: `Uploading ${file.name}…` }));
      try {
        const pre = await post({ action: 'presign', filename: file.name, file_size: file.size });
        if (!pre.ok) { setErr(pre.j.error || 'Could not start the upload.'); break; }
        const sent = await new Promise<boolean>(resolve => {
          const x = new XMLHttpRequest();
          x.open('PUT', pre.j.uploadUrl);
          x.setRequestHeader('Content-Type', pre.j.contentType);
          x.upload.onprogress = e => { if (e.lengthComputable) setBusy(b => ({ ...b, [itemKey]: `Uploading ${file.name}… ${Math.round((e.loaded / e.total) * 100)}%` })); };
          x.onload = () => resolve(x.status >= 200 && x.status < 300);
          x.onerror = () => resolve(false);
          x.send(file);
        });
        if (!sent) { setErr(`We couldn’t upload ${file.name}. Please check your connection and try again.`); break; }
        const conf = await post({ action: 'confirm', storagePath: pre.j.storagePath, filename: file.name, itemKey });
        if (!conf.ok) { setErr(conf.j.error || `Couldn’t save ${file.name}.`); break; }
        setFiles(fs => [...fs, conf.j.file as UFile]);
      } catch { setErr(`We couldn’t upload ${file.name}. Please check your connection and try again.`); break; }
    }
    setBusy(b => { const n = { ...b }; delete n[itemKey]; return n; });
  };

  const remove = async (f: UFile) => {
    if (!confirm(`Remove "${f.name}"?`)) return;
    const r = await post({ action: 'remove', fileId: f.id });
    if (r.ok) { setFiles(fs => fs.filter(x => x.id !== f.id)); setDone(false); } else setErr(r.j.error || 'Could not remove that file.');
  };

  const finish = async () => {
    setFinishing(true); setErr(null);
    const r = await post({ action: 'finish' });
    setFinishing(false);
    if (r.ok) { setDone(true); setSentBefore(true); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* older browsers */ } } else setErr(r.j.error || 'Something went wrong — please try again.');
  };

  const first = (data?.name ?? '').trim().split(/\s+/)[0];
  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f6f4ef', fontFamily: '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif', color: '#1a1a1a', padding: '0 16px 48px' };
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e7e2d6', borderRadius: 12, padding: 16, marginBottom: 12 };

  const shell = (children: React.ReactNode) => (
    <div style={wrap}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ padding: '22px 0 14px', borderBottom: `3px solid ${GOLD}`, marginBottom: 18, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.5, color: GOLD }}>CRECO</span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>🔒 Secure folder</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (missing) return shell(<div style={card}><h1 style={{ fontSize: 20, margin: '0 0 8px' }}>We can’t find that link</h1><p style={{ margin: 0, color: '#4b5563' }}>Please check that you copied the whole link from your email, or ask your CRECO broker to send a new one.</p></div>);
  if (!data) return shell(err ? <div style={{ ...card, color: '#b91c1c' }}>{err}</div> : <p style={{ color: '#6b7280' }}>Loading…</p>);
  if (data.state === 'password') {
    return shell(
      <form onSubmit={e => { e.preventDefault(); void unlock(); }} style={card}>
        <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>🔑 This folder needs a password</h1>
        <p style={{ margin: '0 0 14px', color: '#4b5563', lineHeight: 1.5 }}>{data.agentName} set a password on this private folder and will have given it to you separately — by phone or text, not by email.</p>
        <label htmlFor="secure-pw" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Password</label>
        <input id="secure-pw" type="password" autoFocus autoComplete="off" value={password} onChange={e => { setPassword(e.target.value); setPwErr(null); }}
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 48, borderRadius: 10, border: `1.5px solid ${pwErr ? '#fca5a5' : '#d1d5db'}`, padding: '0 14px', fontSize: 16 }} />
        {pwErr && <div role="alert" style={{ color: '#b91c1c', fontSize: 13.5, marginTop: 8 }}>{pwErr}</div>}
        <button type="submit" disabled={!password || unlocking}
          style={{ marginTop: 14, width: '100%', minHeight: 50, borderRadius: 12, border: 'none', background: password ? '#111' : '#d1d5db', color: '#fff', fontWeight: 800, fontSize: 16, cursor: password && !unlocking ? 'pointer' : 'default' }}>
          {unlocking ? 'Checking…' : 'Open the folder'}
        </button>
        <p style={{ color: '#9ca3af', fontSize: 12, margin: '14px 0 0', lineHeight: 1.6, textAlign: 'center' }}>Don’t have the password? Call {data.agentName} at (210) 817-3443.</p>
      </form>,
    );
  }
  if (data.state !== 'ok') {
    const msg = data.state === 'expired' ? 'This upload link has expired.' : data.state === 'revoked' ? 'This upload link was closed.' : 'This secure folder has been closed.';
    return shell(<div style={card}><h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{msg}</h1><p style={{ margin: 0, color: '#4b5563' }}>For your protection these links only work for a short time. Please contact {data.agentName} at (210) 817-3443 and we’ll send you a new one.</p></div>);
  }

  const items = data.items ?? [];
  const isFolder = data.kind === 'folder';
  const sentFiles = files.filter(f => f.mine !== false);          // what came in through this link (the visitor can remove these)
  const byItem = (k: string) => sentFiles.filter(f => (f.item_key ?? OTHER) === k);
  const doneItems = items.filter(i => byItem(i.key).length > 0).length;
  const exp = data.expiresAt ? new Date(data.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '';

  const slot = (k: string, label: string, optional?: boolean) => {
    const mine = byItem(k);
    return (
      <div key={k} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ width: 24, height: 24, borderRadius: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, background: mine.length ? '#16a34a' : '#fff', color: mine.length ? '#fff' : '#9ca3af', border: mine.length ? 'none' : '2px solid #d1d5db' }}>{mine.length ? '✓' : ''}</span>
          <div style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{label}{optional && <span style={{ fontWeight: 400, color: '#6b7280' }}> (optional)</span>}</div>
        </div>
        {mine.map(f => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13.5, color: '#374151' }}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>📄 {f.name} <span style={{ color: '#9ca3af' }}>{kb(f.file_size)}</span></span>
            <button type="button" onClick={() => remove(f)} aria-label={`Remove ${f.name}`} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13, padding: '8px 4px' }}>Remove</button>
          </div>
        ))}
        {busy[k] && <div style={{ marginTop: 8, fontSize: 13, color: GOLD }}>{busy[k]}</div>}
        <button type="button" disabled={!!busy[k]} onClick={() => { pickKey.current = k; pickRef.current?.click(); }}
          style={{ marginTop: 10, width: '100%', minHeight: 46, borderRadius: 10, border: `1.5px dashed ${GOLD}`, background: '#fffaf0', color: '#8a5f12', fontWeight: 700, fontSize: 15, cursor: busy[k] ? 'default' : 'pointer' }}>
          {mine.length ? '＋ Add another file' : '＋ Choose file or take a photo'}
        </button>
      </div>
    );
  };

  return shell(
    <>
      <input ref={pickRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,image/*" hidden
        onChange={e => { void upload(pickKey.current, e.target.files); e.target.value = ''; }} />
      {isFolder ? (
        <>
          <h1 style={{ fontSize: 22, margin: '0 0 6px', overflowWrap: 'anywhere' }}>{data.title || 'Secure folder'}</h1>
          <p style={{ margin: '0 0 14px', color: '#4b5563', lineHeight: 1.5 }}>
            {data.agentName} set up this private folder for you. {data.canView ? 'You can open the files in it and add your own.' : 'Add your documents below.'} Files are encrypted while stored — please don’t email these documents.
          </p>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>{first ? `Hi ${first} —` : 'Hello —'} upload your documents</h1>
          <p style={{ margin: '0 0 14px', color: '#4b5563', lineHeight: 1.5 }}>
            {data.agentName} asked for the items below. This page is private: only your CRECO broker can see what you upload, and files are encrypted while stored. Please don’t email these documents.
          </p>
        </>
      )}
      {done && (
        <div role="status" style={{ background: '#f0fdf4', border: '2px solid #16a34a', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#15803d' }}>✓ Your documents were sent</div>
          <div style={{ fontSize: 14, color: '#166534', marginTop: 4, lineHeight: 1.5 }}>
            {data.agentName} has been notified that {sentFiles.length} file{sentFiles.length === 1 ? '' : 's'} arrived. You can close this page now. If you add another file below, you’ll see a button to send it too.
          </div>
        </div>
      )}
      {items.length > 0 && <div style={{ margin: '0 0 12px', fontSize: 13.5, fontWeight: 600, color: doneItems === items.length ? '#15803d' : '#6b7280' }}>{doneItems === items.length ? '✓ Everything on the list is uploaded' : `${doneItems} of ${items.length} items uploaded`}</div>}
      {data.note && <div style={{ ...card, background: '#faf7ef', borderLeft: `3px solid ${GOLD}`, whiteSpace: 'pre-line' }}>{data.note}</div>}
      {err && <div role="alert" style={{ ...card, color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}>{err}</div>}
      {data.canView && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: files.length ? 4 : 0 }}>Files in this folder{files.length ? ` (${files.length})` : ''}</div>
          {files.length === 0 ? <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 4 }}>Nothing here yet.</div> : files.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #f1eee6' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#1f2937', overflowWrap: 'anywhere' }}>📄 {f.name} <span style={{ color: '#9ca3af' }}>{kb(f.file_size)}{f.mine ? ' · added by you' : ''}</span></span>
              <button type="button" onClick={() => void openFile(f)} disabled={opening === f.id}
                style={{ minHeight: 40, padding: '0 14px', borderRadius: 9, border: 'none', background: '#111', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', flexShrink: 0 }}>{opening === f.id ? 'Opening…' : 'Open'}</button>
            </div>
          ))}
        </div>
      )}
      {items.map(i => slot(i.key, i.label))}
      {slot(OTHER, isFolder ? 'Add your files' : 'Anything else you’d like to include', !isFolder)}
      {done ? (
        <div role="status" style={{ ...card, textAlign: 'center', background: '#f0fdf4', borderColor: '#86efac', marginTop: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#15803d' }}>✓ All done — nothing more to do</div>
          <div style={{ fontSize: 13.5, color: '#166534', marginTop: 4 }}>{data.agentName} has your documents. You can close this page.</div>
        </div>
      ) : (
        <button type="button" onClick={finish} disabled={finishing || !sentFiles.length}
          style={{ width: '100%', minHeight: 52, borderRadius: 12, border: 'none', background: sentFiles.length ? '#111' : '#d1d5db', color: '#fff', fontWeight: 800, fontSize: 16, cursor: sentFiles.length && !finishing ? 'pointer' : 'default', marginTop: 4 }}>
          {finishing ? 'Sending…' : sentBefore ? 'Send the new files too' : 'I’m done — send to my broker'}
        </button>
      )}
      <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
        Up to {data.maxFileMb} MB per file · PDF, photo, Word or Excel{exp && <> · this link works until {exp}</>}<br />
        Need help? Call (210) 817-3443.
      </p>
    </>,
  );
}
