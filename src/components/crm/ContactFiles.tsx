'use client';

import React, { useCallback, useEffect, useState } from 'react';
import DealDocUpload from '@/components/crm/DealDocUpload';
import LinkedDocs from '@/components/crm/drive/LinkedDocs';
import type { DrivePerson } from '@/components/crm/drive/DocsDrive';
import { canEditCardFile, editCardFile } from '@/components/crm/drive/card-edit';

// The "Files" section of a contact card: documents and photos uploaded onto the person, plus every file on the Docs
// tab of their deals (tagged with the deal it came from). Open / preview use a freshly signed link at click time.

interface ContactFile {
  id: string; source: 'client' | 'deal'; name: string; size: number | null; type: string | null;
  uploaded_by: string | null; created_at: string; from: string | null; url: string | null;
}

const PREVIEWABLE = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'docx', 'xlsx', 'xls', 'csv'];
const kb = (n: number | null) => (n == null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const icon = (name: string) => (/\.(png|jpe?g|webp|gif)$/i.test(name) ? '🖼' : '📄');

export default function ContactFiles({ clientId, authToken, userId, isAdmin, showToast, onPreview, userName, profiles, isMobile, onSignDoc }: {
  clientId: string;
  authToken?: string;
  userId?: string;
  isAdmin: boolean;
  showToast: (m: string) => void;
  onPreview: (f: { url: string; name: string; type?: string | null }) => void;
  userName?: string;
  profiles?: DrivePerson[];
  isMobile?: boolean;
  onSignDoc?: (docId: string, title: string, dealId?: string) => void;
}) {
  const [files, setFiles] = useState<ContactFile[] | null>(null);
  const [adding, setAdding] = useState(false);
  const auth = useCallback((): Record<string, string> => (authToken ? { Authorization: `Bearer ${authToken}` } : {}), [authToken]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/crm/client-docs?clientId=${clientId}`, { headers: auth() });
      const j = await r.json().catch(() => ({}));
      setFiles(r.ok ? (j.files ?? []) : []);
    } catch { setFiles([]); }
  }, [clientId, auth]);
  useEffect(() => { setFiles(null); setAdding(false); load(); }, [load]);

  const freshUrl = async (f: ContactFile) => {
    try {
      const r = await fetch(`/api/crm/client-docs?docId=${f.id}&source=${f.source}`, { headers: auth() });
      return r.ok ? ((await r.json()).url as string | undefined) ?? null : null;
    } catch { return null; }
  };
  const open = async (f: ContactFile, preview: boolean) => {
    // Opened synchronously: window.open() after an await is blocked as a popup.
    const win = preview ? null : window.open('', '_blank');
    if (win) win.opener = null;
    const url = await freshUrl(f);
    if (!url) { win?.close(); showToast('Could not open the file.'); return; }
    if (preview) onPreview({ url, name: f.name, type: f.type });
    else if (win) win.location.href = url; else window.location.href = url;
  };
  const remove = async (f: ContactFile) => {
    if (!confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
    const r = await fetch(f.source === 'deal' ? '/api/crm/docs' : '/api/crm/client-docs', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ docId: f.id }),
    });
    if (!r.ok) { showToast((await r.json().catch(() => ({})))?.error || 'Could not delete the file'); return; }
    setFiles(fs => (fs ?? []).filter(x => x.id !== f.id));
    showToast(`${f.name} deleted`);
  };

  const list = files ?? [];
  const label: React.CSSProperties = { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600 };
  return (
    <>
    {userId && <LinkedDocs clientId={clientId} authToken={authToken} currentUser={{ id: userId, name: userName ?? '' }} profiles={profiles ?? []} isAdmin={isAdmin} isMobile={!!isMobile} onToast={showToast} onSignDoc={onSignDoc} />}
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={label}>Files{list.length ? ` (${list.length})` : ''}</div>
        <button type="button" onClick={() => setAdding(a => !a)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c9922c', fontSize: 12, fontWeight: 700, padding: 0, ...(typeof window !== 'undefined' && (window.innerWidth < 768 || window.matchMedia?.('(pointer: coarse)').matches) ? { minHeight: 40, padding: '0 10px' } : {}) }}>
          {adding ? 'Done' : '＋ Add a file'}
        </button>
      </div>
      {adding && <DealDocUpload clientId={clientId} authToken={authToken} showToast={showToast} onUploaded={() => load()} />}
      {files === null ? (
        <div style={{ fontSize: 13, color: 'var(--k-9ca3af)' }}>Loading…</div>
      ) : list.length === 0 ? (
        !adding && <div style={{ fontSize: 13, color: '#d1d5db' }}>No files yet. Add a lease copy, an ID or a notice — files on their deals show here too.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map(f => {
            const ext = (f.name.split('.').pop() || '').toLowerCase();
            return (
              <div key={`${f.source}:${f.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, padding: '9px 12px' }}>
                <span style={{ fontSize: 17, flexShrink: 0 }}>{icon(f.name)}</span>
                <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-1a1a1a)', overflowWrap: 'anywhere' }}>{f.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>
                    {[f.from, kb(f.size), new Date(f.created_at).toLocaleDateString()].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {canEditCardFile(f.name) && (
                  <button onClick={() => void editCardFile(f.source, f.id, authToken, showToast)} title="Edit as a live document" style={{ fontSize: 12, fontWeight: 600, color: '#a06a12', background: 'var(--k-fdf6e9)', border: '1px solid var(--k-f0e2c4)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', flexShrink: 0 }}>{/\.(xlsx|xlsm|xls|csv)$/i.test(f.name) ? '✎ Edit sheet' : '✎ Edit'}</button>
                )}
                {PREVIEWABLE.includes(ext) && (
                  <button onClick={() => open(f, true)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', flexShrink: 0 }}>👁 View</button>
                )}
                <button onClick={() => open(f, false)} style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: '#111', border: 'none', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', flexShrink: 0 }}>↓ Open</button>
                {(isAdmin || f.uploaded_by === userId) && (
                  <button onClick={() => remove(f)} title="Delete this file" aria-label={`Delete ${f.name}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 15, padding: '4px 2px', flexShrink: 0 }}>🗑</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </>
  );
}
