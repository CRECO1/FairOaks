'use client';
// Browser helpers shared by every upload screen: HEIC → JPEG, PUT-with-progress, and failure reporting.
import { checkUpload, isHeic, type UploadProfileKey } from '@/lib/upload-rules';

/**
 * HEIC photos → JPEG using the browser's OWN decoder (Safari, iPhone, iPad and Mac can read HEIC; Chrome and Firefox cannot).
 * No library: the one that works in other browsers needs `new Function`, which the CRM's security policy forbids on purpose.
 * Throws if this browser can't decode it; the caller then shows the "share it as a JPG" message.
 */
export async function heicToJpeg(file: File): Promise<File> {
  if (!isHeic(file)) return file;
  if (typeof createImageBitmap === 'undefined') throw new Error('no decoder');
  const bmp = await Promise.race([
    createImageBitmap(file),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
  ]);
  const scale = Math.min(1, 4000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('encode failed');
  return new File([blob], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' });
}

/** Convert if needed, then run the plain-language pre-check. `error` is null when the file may go. */
export async function prepareUpload(file: File, profile: UploadProfileKey): Promise<{ file: File; error: string | null; converted: boolean }> {
  let f = file, converted = false;
  if (isHeic(file)) {
    try { f = await heicToJpeg(file); converted = true; }
    catch { return { file, converted: false, error: `“${file.name}” is a HEIC photo, and this browser can’t convert it. Share it as a JPG, or on the iPhone set Settings → Camera → Formats → Most Compatible.` }; }
  }
  return { file: f, converted, error: checkUpload(f, profile) };
}

/** PUT the bytes to a signed storage URL, reporting 0–100 as they go. Resolves ok=false (never throws) so callers can show a message. */
export function putWithProgress(url: string, file: File, contentType: string, onPct: (n: number) => void): Promise<{ ok: boolean; status: number; detail: string }> {
  return new Promise(resolve => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', contentType);
    x.upload.onprogress = ev => { if (ev.lengthComputable) onPct(Math.min(99, Math.round((ev.loaded / ev.total) * 100))); };
    x.onload = () => {
      let detail = '';
      try { const j = JSON.parse(x.responseText); detail = j.message || j.error || ''; } catch { /* not JSON */ }
      resolve({ ok: x.status >= 200 && x.status < 300, status: x.status, detail });
    };
    x.onerror = () => resolve({ ok: false, status: 0, detail: 'network error' });
    x.ontimeout = () => resolve({ ok: false, status: 0, detail: 'timed out' });
    x.send(file);
  });
}

/** Fire-and-forget: tell the CRM an upload failed (audit_logs action `upload_failed`), so we see it before someone calls. */
export function reportUploadFailure(info: { target: string; name: string; size: number; stage: 'precheck' | 'convert' | 'start' | 'send' | 'save'; message: string }, authToken?: string): void {
  try {
    void fetch('/api/crm/upload-failure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({ ...info, ua: navigator.userAgent, online: navigator.onLine }),
      keepalive: true,
    }).catch(() => { /* reporting is best-effort */ });
  } catch { /* ignore */ }
}
