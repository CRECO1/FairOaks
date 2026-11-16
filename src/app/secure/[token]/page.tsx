'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

// The tenant's side of a secure document request: a private, expiring, upload-only page. No login. It shows only the
// names of what THIS person already sent; nothing here can read a file back.

interface Item { key: string; label: string }
interface UFile { id: string; item_key: string | null; name: string; file_size: number | null }
interface Data {
  state: 'ok' | 'expired' | 'revoked' | 'deleted'; agentName: string; name?: string | null; items?: Item[]; note?: string | null;
  expiresAt?: string; submitted?: boolean; files?: UFile[]; maxFileMb?: number;
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
  const [finishing, setFinishing] = useState(false);
  const [missing, setMissing] = useState(false);
  const api = `/api/secure-upload/${token}`;
  const pickRef = useRef<HTMLInputElement>(null);
  const pickKey = useRef<string>(OTHER);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(api, { cache: 'no-store' });
        if (r.status === 404) { setMissing(true); return; }
        if (r.status === 429) { setErr('Lots of people are using this link right now — please wait a minute and refresh.'); return; }
        const j: Data = await r.json();
        setData(j); setFiles(j.files ?? []); setDone(!!j.submitted);
      } catch { setErr('We couldn’t load this page. Please check your connection and refresh.'); }
    })();
  }, [api]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  }, [api]);

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
    if (r.ok) setDone(true); else setErr(r.j.error || 'Something went wrong — please try again.');
  };

  const first = (data?.name ?? '').trim().split(/\s+/)[0];
  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f6f4ef', fontFamily: '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif', color: '#1a1a1a', padding: '0 16px 48px' };
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e7e2d6', borderRadius: 12, padding: 16, marginBottom: 12 };

  const shell = (children: React.ReactNode) => (
    <div style={wrap}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ padding: '22px 0 14px', borderBottom: `3px solid ${GOLD}`, marginBottom: 18, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.5, color: GOLD }}>CRECO</span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>🔒 Secure upload</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (missing) return shell(<div style={card}><h1 style={{ fontSize: 20, margin: '0 0 8px' }}>We can’t find that link</h1><p style={{ margin: 0, color: '#4b5563' }}>Please check that you copied the whole link from your email, or ask your CRECO broker to send a new one.</p></div>);
  if (!data) return shell(err ? <div style={{ ...card, color: '#b91c1c' }}>{err}</div> : <p style={{ color: '#6b7280' }}>Loading…</p>);
  if (data.state !== 'ok') {
    const msg = data.state === 'expired' ? 'This upload link has expired.' : data.state === 'revoked' ? 'This upload link was closed.' : 'This secure folder has been closed.';
    return shell(<div style={card}><h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{msg}</h1><p style={{ margin: 0, color: '#4b5563' }}>For your protection these links only work for a short time. Please contact {data.agentName} at (210) 817-3443 and we’ll send you a new one.</p></div>);
  }

  const items = data.items ?? [];
  const byItem = (k: string) => files.filter(f => (f.item_key ?? OTHER) === k);
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
      <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>{first ? `Hi ${first} —` : 'Hello —'} upload your documents</h1>
      <p style={{ margin: '0 0 14px', color: '#4b5563', lineHeight: 1.5 }}>
        {data.agentName} asked for the items below. This page is private: only your CRECO broker can see what you upload, and files are encrypted while stored. Please don’t email these documents.
      </p>
      {items.length > 0 && <div style={{ margin: '0 0 12px', fontSize: 13.5, fontWeight: 600, color: doneItems === items.length ? '#15803d' : '#6b7280' }}>{doneItems === items.length ? '✓ Everything on the list is uploaded' : `${doneItems} of ${items.length} items uploaded`}</div>}
      {data.note && <div style={{ ...card, background: '#faf7ef', borderLeft: `3px solid ${GOLD}`, whiteSpace: 'pre-line' }}>{data.note}</div>}
      {err && <div role="alert" style={{ ...card, color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}>{err}</div>}
      {items.map(i => slot(i.key, i.label))}
      {slot(OTHER, 'Anything else you’d like to include', true)}
      <button type="button" onClick={finish} disabled={finishing || !files.length}
        style={{ width: '100%', minHeight: 52, borderRadius: 12, border: 'none', background: files.length ? '#111' : '#d1d5db', color: '#fff', fontWeight: 800, fontSize: 16, cursor: files.length && !finishing ? 'pointer' : 'default', marginTop: 4 }}>
        {finishing ? 'Sending…' : done ? '✓ Sent — tap to notify again' : 'I’m done — notify my broker'}
      </button>
      {done && <p style={{ textAlign: 'center', color: '#15803d', fontWeight: 600, marginTop: 12 }}>Thank you{first ? `, ${first}` : ''}! {data.agentName} has been told your documents arrived.</p>}
      <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
        Up to {data.maxFileMb} MB per file · PDF, photo, Word or Excel{exp && <> · this link works until {exp}</>}<br />
        Need help? Call (210) 817-3443.
      </p>
    </>,
  );
}
