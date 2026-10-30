'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileRow } from '@/lib/gmail-live';

// "Files" in Emails: every attachment in your mail as a list of FILES (not conversations) — find the flyer, the OM, the BOV,
// the signed lease without opening thread after thread. Read live from your Gmail; nothing is copied.

const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (ms: number) => new Date(ms).toLocaleDateString('en-US', { ...CT, month: 'short', day: 'numeric', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const kindOf = (f: FileRow): 'pdf' | 'doc' | 'sheet' | 'image' | 'other' => {
  if (/pdf/i.test(f.mime) || /\.pdf$/i.test(f.name)) return 'pdf';
  if (/word|document|\.docx?$|\.rtf$|\.txt$/i.test(f.mime + f.name)) return 'doc';
  if (/sheet|excel|csv|\.xlsx?$|\.csv$/i.test(f.mime + f.name)) return 'sheet';
  if (/^image\//i.test(f.mime)) return 'image';
  return 'other';
};
const ICON = { pdf: '📕', doc: '📃', sheet: '📊', image: '🖼️', other: '📎' } as const;
const previewable = (f: FileRow) => /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i.test(f.mime);
const who = (raw: string) => { const m = raw.match(/^"?(.*?)"?\s*<([^>]+)>$/); return (m ? m[1].trim() || m[2] : raw).replace(/"/g, ''); };

export default function GmailFiles(p: {
  box: 'inbox' | 'sent'; isMobile: boolean; account: string | null; q: string;
  onOpenThread: (f: FileRow) => void; notify: (m: string) => void; onShowThreads: () => void;
}) {
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [type, setType] = useState<'all' | 'pdf' | 'doc' | 'sheet' | 'image'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const url = useCallback((pageToken?: string) => {
    const sp = new URLSearchParams({ box: p.box });
    if (p.q) sp.set('q', p.q);
    if (p.account) sp.set('account', p.account);
    if (pageToken) sp.set('pageToken', pageToken);
    return `/api/gmail/files?${sp}`;
  }, [p.box, p.q, p.account]);

  useEffect(() => {
    let live = true;
    setFiles(null); setErr('');
    fetch(url()).then(async r => { const j = await r.json().catch(() => ({})); if (!live) return; if (!r.ok) { setErr(j.error ?? 'Could not load your files.'); setFiles([]); return; } setFiles(j.files ?? []); setNext(j.next ?? null); })
      .catch(() => { if (live) { setErr('Could not reach Gmail — check your connection.'); setFiles([]); } });
    return () => { live = false; };
  }, [url]);

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    try { const j = await (await fetch(url(next))).json(); setFiles(prev => [...(prev ?? []), ...(j.files ?? [])]); setNext(j.next ?? null); } finally { setLoadingMore(false); }
  };

  const open = async (f: FileRow, asDownload = false) => {
    const key = `${f.messageId}:${f.part}`;
    setBusy(key);
    const tab = !asDownload && previewable(f) ? window.open('', '_blank') : null; // must open inside the click
    try {
      const r = await fetch(`/api/gmail/mailbox-attachment?messageId=${f.messageId}&part=${encodeURIComponent(f.part)}${p.account ? `&account=${encodeURIComponent(p.account)}` : ''}`);
      if (!r.ok) throw new Error(String(r.status));
      const u = URL.createObjectURL(new Blob([await r.blob()], { type: f.mime }));
      if (tab) tab.location.href = u;
      else { const a = document.createElement('a'); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(u), 120_000);
    } catch { tab?.close(); p.notify(`Couldn’t open ${f.name} — try again.`); } finally { setBusy(null); }
  };

  const counts = useMemo(() => { const c = { all: 0, pdf: 0, doc: 0, sheet: 0, image: 0 }; for (const f of files ?? []) { c.all++; const k = kindOf(f); if (k !== 'other') c[k]++; } return c; }, [files]);
  const shown = useMemo(() => (files ?? []).filter(f => type === 'all' || kindOf(f) === type), [files, type]);
  const chip = (on: boolean): React.CSSProperties => ({ padding: p.isMobile ? '8px 14px' : '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? '#111' : 'var(--k-e5e7eb)'}`, background: on ? '#111' : 'var(--k-fff)', color: on ? '#fff' : 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' });
  const dim = 'var(--k-9ca3af)';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="crm-tabs-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
          {([['all', 'All files'], ['pdf', '📕 PDFs'], ['doc', '📃 Documents'], ['sheet', '📊 Spreadsheets'], ['image', '🖼️ Pictures']] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setType(v)} style={chip(type === v)}>{l}{counts[v] ? <span style={{ marginLeft: 6, opacity: 0.7, fontWeight: 500 }}>{counts[v]}</span> : null}</button>
          ))}
        </div>
        <button type="button" onClick={p.onShowThreads} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Show as conversations</button>
      </div>
      {files === null ? (
        <div aria-busy="true" style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, padding: 24, color: dim, fontSize: 14 }}>Finding the files in your mail…</div>
      ) : err ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px dashed var(--k-e5e7eb)', borderRadius: 12, fontSize: 14 }}>{err}</div>
      ) : shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px dashed var(--k-e5e7eb)', borderRadius: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-374151)' }}>No files{type !== 'all' ? ' of that kind' : ''} here</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>{p.q ? 'Try different words in the search box.' : next ? 'Try “Load older files”.' : 'Attachments in this folder will be listed here.'}</div>
          {next && <button type="button" onClick={() => void more()} style={{ marginTop: 12, border: '1px solid var(--k-d1d5db)', background: 'var(--k-fff)', borderRadius: 8, padding: '7px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Load older files</button>}
        </div>
      ) : (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
          {shown.map((f, i) => {
            const key = `${f.messageId}:${f.part}`;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none' }}>
                <button type="button" onClick={() => void open(f)} disabled={busy === key} aria-label={`${previewable(f) ? 'Open' : 'Download'} ${f.name}`} title={previewable(f) ? 'Open' : 'Download'}
                  style={{ width: 40, height: 40, flexShrink: 0, border: '1px solid var(--k-e5e7eb)', borderRadius: 10, background: 'var(--k-f9fafb)', fontSize: 20, cursor: 'pointer' }}>{busy === key ? '⏳' : ICON[kindOf(f)]}</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{f.name}</span>
                    <span style={{ fontSize: 12, color: dim, flexShrink: 0 }}>{fmtBytes(f.size)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.box === 'sent' ? 'Sent' : who(f.from)} · {f.subject}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: dim, flexShrink: 0 }}>{when(f.date)}</span>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {!p.isMobile && <button type="button" onClick={() => void open(f, true)} aria-label={`Download ${f.name}`} title="Download" style={{ width: 32, height: 32, border: '1px solid var(--k-e5e7eb)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-6b7280)', cursor: 'pointer' }}>⬇</button>}
                  <button type="button" onClick={() => p.onOpenThread(f)} title="Open the conversation this came in" style={{ height: 32, padding: '0 10px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif" }}>{p.isMobile ? '✉' : 'Conversation →'}</button>
                </div>
              </div>
            );
          })}
          {next && (
            <button type="button" onClick={() => void more()} disabled={loadingMore} style={{ width: '100%', padding: 13, border: 'none', borderTop: '1px solid var(--k-f0f0f0)', background: 'var(--k-fafafa)', color: 'var(--k-374151)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>{loadingMore ? 'Loading…' : 'Load older files'}</button>
          )}
        </div>
      )}
    </div>
  );
}
