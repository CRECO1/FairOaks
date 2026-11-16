// One wording for a secure document request's state — used by the contact/deal section and by the My Drive index.
// Client-safe (no server imports).
export interface SecureStateInput {
  status: 'open' | 'revoked'; purged_at: string | null; expires_at: string; submitted_at: string | null;
  first_viewed_at: string | null; sent_at: string | null; fileCount: number;
  /** A folder an agent made (not a request to a contact): it may have no link at all. */
  kind?: 'request' | 'folder';
}
export type SecureStateKey = 'deleted' | 'closed' | 'expired' | 'received' | 'uploading' | 'opened' | 'waiting' | 'unsent' | 'private' | 'shared';
export function secureState(r: SecureStateInput): { key: SecureStateKey; text: string; color: string; bg: string } {
  if (r.purged_at) return { key: 'deleted', text: 'Deleted', color: '#6b7280', bg: '#f3f4f6' };
  if (r.kind === 'folder') {
    const live = r.status === 'open' && Date.parse(r.expires_at) > Date.now();
    if (!live) return { key: 'private', text: 'Private — no link', color: '#374151', bg: '#eef0f3' };
    if (r.submitted_at) return { key: 'received', text: 'Files received', color: '#15803d', bg: '#dcfce7' };
    return { key: 'shared', text: 'Shared by link', color: '#1d4ed8', bg: '#dbeafe' };
  }
  if (r.status === 'revoked') return { key: 'closed', text: 'Link closed', color: '#6b7280', bg: '#f3f4f6' };
  if (Date.parse(r.expires_at) <= Date.now()) return { key: 'expired', text: 'Link expired', color: '#b45309', bg: '#fef3c7' };
  if (r.submitted_at) return { key: 'received', text: 'Received', color: '#15803d', bg: '#dcfce7' };
  if (r.fileCount) return { key: 'uploading', text: 'Uploading', color: '#1d4ed8', bg: '#dbeafe' };
  if (r.first_viewed_at) return { key: 'opened', text: 'Opened — nothing yet', color: '#a06a12', bg: '#fdf6e9' };
  return r.sent_at ? { key: 'waiting', text: 'Waiting for them', color: '#6b7280', bg: '#f3f4f6' } : { key: 'unsent', text: 'Link not sent', color: '#6b7280', bg: '#f3f4f6' };
}
