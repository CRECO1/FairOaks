// Client-safe constants for files attached to the Copilot chat (shared by the panel and the server).
export type AttachmentKind = 'image' | 'pdf' | 'docx' | 'xlsx' | 'text';

export const ATTACHMENT_TYPES: Record<string, { mime: string; kind: AttachmentKind }> = {
  jpg: { mime: 'image/jpeg', kind: 'image' }, jpeg: { mime: 'image/jpeg', kind: 'image' }, png: { mime: 'image/png', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' }, webp: { mime: 'image/webp', kind: 'image' },
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'docx' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'xlsx' },
  csv: { mime: 'text/csv', kind: 'text' }, txt: { mime: 'text/plain', kind: 'text' },
};
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 5;
export const ATTACHMENT_ACCEPT = ['image/*', ...Object.keys(ATTACHMENT_TYPES).map(e => `.${e}`)].join(',');

export const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();
export const attachmentInfo = (name: string) => ATTACHMENT_TYPES[extOf(name)];

/** What a chat message carries for an attached file: a small reference, never the bytes. */
export interface AttachmentRef { id: string; path: string; name: string; type?: string; size?: number }
