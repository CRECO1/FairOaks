/** My Drive documents, sheets and forms open in their own browser tab (like Google Drive), at /crm/doc/<id> and /crm/form/<id>. */

/** Which workspace the page we are on belongs to (commercial = CRECO). */
export function currentBusinessUnit(): 'commercial' | 'residential' {
  if (typeof window === 'undefined') return 'commercial';
  const m = /^\/crm\/(commercial|residential)/.exec(window.location.pathname);
  if (m) return m[1] as 'commercial' | 'residential';
  const bu = new URLSearchParams(window.location.search).get('bu');
  return bu === 'residential' ? 'residential' : 'commercial';
}

const unit = (bu?: string) => (bu === 'residential' ? 'residential' : bu === 'commercial' ? 'commercial' : currentBusinessUnit());
export const driveDocPath = (id: string, bu?: string) => `/crm/doc/${id}?bu=${unit(bu)}`;
export const driveFormPath = (submissionId: string, formId: string, name: string, bu?: string) =>
  `/crm/form/${submissionId}?form=${encodeURIComponent(formId)}&name=${encodeURIComponent(name)}&bu=${unit(bu)}`;

/**
 * Opens a path in a new tab. Returns false when it could not (phones keep everything in the app, or the browser blocked the new tab), so the
 * caller falls back to opening it in place.
 */
export function openDriveTab(path: string): boolean {
  if (typeof window === 'undefined') return false;
  try { if (window.matchMedia('(max-width: 767px)').matches) return false; } catch { /* no matchMedia: treat as desktop */ }
  try { const w = window.open(path, '_blank'); return !!w; } catch { return false; }
}

/** Leaves a standalone page: closes the tab when this script opened it, otherwise goes back to the Drive in the CRM. */
export function leaveDrivePage(bu: 'commercial' | 'residential') {
  window.close();
  setTimeout(() => { window.location.href = `/crm/${bu}#transaction-docs`; }, 250);   // still here = the tab could not close itself
}
