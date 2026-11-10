'use client';

// Attach files to a deal. The file goes straight from the browser to Supabase Storage
// through a signed upload URL, and /api/crm/docs only records it. Posting the file
// through the API route instead runs into Vercel's 4.5 MB request-body limit: the
// platform answers 413 before the route ever runs, so phone photos and scanned PDFs
// — routinely 2–8 MB — never attached, and the old handler hung on "Uploading…"
// trying to read that plain-text 413 as JSON.

import React, { useEffect, useRef, useState } from 'react';
import { autoConvertCardFile, convertCardFile } from '@/components/crm/drive/card-edit';

// MIME types as well as extensions: an extension-only list makes Android grey out
// files whose provider reports no name, and without image types iOS doesn't offer
// Photo Library or the camera. iOS also converts HEIC photos to JPEG when JPEG is
// what the page asks for.
export const DEAL_DOC_ACCEPT = [
  'application/pdf', '.pdf',
  'application/msword', '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx',
  'image/jpeg', '.jpg', '.jpeg', 'image/png', '.png', 'image/webp', '.webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx', 'application/vnd.ms-excel', '.xls', 'text/csv', '.csv',
].join(',');
const MAX_BYTES = 25 * 1024 * 1024;   // the deal-docs bucket's own limit
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

export interface UploadedDealDoc { id: string; name: string }

// Also serves a contact's Files (pass `clientId`): same flow, /api/crm/client-docs.
export default function DealDocUpload({ dealId, clientId, authToken, showToast, onUploaded, compact = false }: {
  /** Once the list below already has files: a one-line drop zone instead of the tall one. */
  compact?: boolean;
  dealId?: string;
  clientId?: string;
  authToken?: string;
  showToast: (m: string) => void;
  onUploaded: (doc: UploadedDealDoc) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [touch, setTouch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const convertedRef = useRef(0);
  const endpoint = clientId ? '/api/crm/client-docs' : '/api/crm/docs';
  const owner = clientId ? { clientId } : { dealId };
  const noun = clientId ? 'contact' : 'deal';
  useEffect(() => { setTouch(window.matchMedia('(pointer: coarse)').matches); }, []);

  const headers = (json: boolean): Record<string, string> => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  });

  // Returns an error message, { dup } when the deal already has this exact file, or null once the file is stored and recorded.
  async function uploadOne(file: File): Promise<string | { dup: string } | null> {
    if (file.size > MAX_BYTES) return `${file.name} is ${mb(file.size)} MB — the limit is 25 MB`;
    const pre = await fetch(endpoint, {
      method: 'POST', headers: headers(true),
      body: JSON.stringify({ action: 'presign', ...owner, filename: file.name, file_size: file.size }),
    });
    const pj = await pre.json().catch(() => ({}));
    if (!pre.ok) return pj.error || `Couldn't start the upload (${pre.status})`;

    const put = await fetch(pj.uploadUrl, { method: 'PUT', headers: { 'Content-Type': pj.contentType }, body: file });
    if (!put.ok) {
      const detail = await put.json().then((j: { message?: string; error?: string }) => j.message || j.error).catch(() => '');
      return `Storage refused ${file.name} (${put.status}${detail ? `: ${detail}` : ''})`;
    }

    const conf = await fetch(endpoint, {
      method: 'POST', headers: headers(true),
      body: JSON.stringify({ action: 'confirm', ...owner, storagePath: pj.storagePath, filename: file.name }),
    });
    const cj = await conf.json().catch(() => ({}));
    if (!conf.ok) return cj.error || `Couldn't save ${file.name} to the ${noun} (${conf.status})`;
    if (cj.duplicate) return { dup: cj.doc?.name ?? 'an existing file' };   // already attached: nothing was added
    onUploaded(cj.doc);
    // A Word / text file is also made editable right away (a live document linked to this card). The upload already succeeded, so a
    // problem here is only mentioned, never an error.
    if (autoConvertCardFile(file.name) && cj.doc?.id) {
      const r = await convertCardFile(clientId ? 'client' : 'deal', cj.doc.id as string, authToken);
      if (r.ok) convertedRef.current += 1; else showToast(`${file.name} was uploaded, but ${r.error.charAt(0).toLowerCase()}${r.error.slice(1)}`);
    } else if (/\.(doc|rtf)$/i.test(file.name)) showToast(`${file.name} was uploaded. Older Word (.doc) files can’t be edited here — save it as .docx in Word and upload that`);
    return null;
  }

  async function uploadAll(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (!files.length || status) return;
    let ok = 0, skipped = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        setStatus(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : `Uploading ${files[i].name}…`);
        const err = await uploadOne(files[i]).catch(() => 'Upload failed — check your connection and try again');
        if (err && typeof err === 'object') { skipped++; showToast(`${files[i].name} is already on this ${noun} as “${err.dup}” — not added again`); }
        else if (err) showToast(err); else ok++;
      }
      const made = convertedRef.current; convertedRef.current = 0;
      if (ok) showToast((ok === 1 && files.length === 1 ? `${files[0].name} uploaded ✓` : `${ok} of ${files.length - skipped} new files uploaded ✓`) + (made ? ` — ${made === 1 ? 'it is' : `${made} are`} also ready to edit as a live document` : ''));
    } finally {
      setStatus(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  // A <label> around the input, not a div that calls input.click(): tapping it opens
  // the picker natively on every phone, with no script in the gesture path.
  return (
    <label
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); uploadAll(e.dataTransfer.files); }}
      style={{ display: 'block', position: 'relative', border: `2px dashed ${dragging ? '#c9922c' : '#d1d5db'}`, borderRadius: 10, padding: compact ? '10px 16px' : '26px 20px', minHeight: 44,
        textAlign: 'center', cursor: status ? 'default' : 'pointer', background: dragging ? '#fef9f0' : '#f9fafb', marginBottom: 16, transition: 'all .15s' }}>
      <input ref={inputRef} type="file" multiple accept={DEAL_DOC_ACCEPT} disabled={!!status}
        aria-label={`Upload files to this ${noun}`}
        onChange={e => uploadAll(e.target.files)}
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0, opacity: 0 }} />
      {status ? (
        <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#c9922c' }}>
          <span aria-hidden style={{ fontSize: 18 }}>⏳</span>
          <span style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{status}</span>
        </div>
      ) : (
        <>
          {compact ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span aria-hidden style={{ fontSize: 16 }}>📎</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: '#374151' }}>{touch ? 'Tap to add another file or photo' : 'Drop files here or click to add more'}</span>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>PDF, Word, Excel, CSV, JPG, PNG · 25 MB each</span>
            </div>
          ) : (
            <>
              <div aria-hidden style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                {touch ? 'Tap to add a file or photo' : 'Drop files here or click to browse'}
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>PDF, Word, Excel, CSV, JPG, PNG · Max 25 MB each</div>
            </>
          )}
        </>
      )}
    </label>
  );
}
