/**
 * ONE list of what each kind of upload accepts — read by the server routes AND the browser screens, so a route, a
 * picker and an error message can never disagree again. (The Supabase buckets' own `allowed_mime_types` are the one
 * copy that lives in the database: a type added here for deals/contacts also needs the `deal-docs` bucket changed.)
 */
export const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};
const pick = (...exts: string[]): Record<string, string> => Object.fromEntries(exts.map(e => [e, MIME[e]]));

/** PDF, Word, Excel, CSV, JPG, PNG, WebP — the main set every document upload takes. */
const CORE = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'webp'] as const;
const MB = 1024 * 1024;

export type UploadProfileKey = 'deal' | 'contact' | 'secure' | 'drive' | 'chat';
export const UPLOAD_PROFILES: Record<UploadProfileKey, { types: Record<string, string>; maxBytes: number; where: string; friendly: string }> = {
  deal:    { types: pick(...CORE), maxBytes: 25 * MB, where: 'a deal',          friendly: 'PDF, Word, Excel, CSV, JPG, PNG or WebP' },
  contact: { types: pick(...CORE), maxBytes: 25 * MB, where: 'a contact',       friendly: 'PDF, Word, Excel, CSV, JPG, PNG or WebP' },
  secure:  { types: pick(...CORE), maxBytes: 25 * MB, where: 'a secure folder', friendly: 'PDF, Word, Excel, CSV, JPG, PNG or WebP' },
  drive:   { types: pick(...CORE, 'ppt', 'pptx', 'gif', 'txt'), maxBytes: 25 * MB, where: 'My Drive', friendly: 'PDF, Word, Excel, PowerPoint, CSV, text, JPG, PNG, WebP or GIF' },
  chat:    { types: pick(...CORE, 'ppt', 'pptx', 'gif', 'txt'), maxBytes: 25 * MB, where: 'chat',     friendly: 'PDF, Word, Excel, PowerPoint, CSV, text, JPG, PNG, WebP or GIF' },
};

export const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();
export const isHeic = (f: { name: string; type?: string }) => /^(heic|heif)$/.test(extOf(f.name)) || /^image\/hei[cf]$/i.test(f.type ?? '');
const mb = (n: number) => (n / MB).toFixed(1);

/** Plain-language reason a file can't be uploaded there, or null if it is fine. Runs in the browser BEFORE any bytes are sent. */
export function checkUpload(file: { name: string; size: number }, key: UploadProfileKey): string | null {
  const p = UPLOAD_PROFILES[key];
  if (!file.name?.trim()) return 'This file has no name.';
  if (file.size === 0) return `“${file.name}” is empty (0 bytes), so there is nothing to upload.`;
  const ext = extOf(file.name);
  if (!p.types[ext]) {
    const kind = ext && ext !== file.name.toLowerCase() ? `.${ext} files` : 'That file type';
    return `${kind} can’t go in ${p.where}. Use ${p.friendly}.`;
  }
  if (file.size > p.maxBytes) return `“${file.name}” is ${mb(file.size)} MB — ${p.where} takes files up to ${Math.round(p.maxBytes / MB)} MB. Shrink or split it first.`;
  return null;
}
