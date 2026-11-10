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
 * Opens a path in its own tab, and a second press on the same document brings that tab back instead of opening a copy (the tab is named after the
 * document). Returns false when it could not (phones keep everything in the app, or the browser blocked the new tab), so the caller falls back to
 * opening it in place; `onBlocked` gets a one-line explanation when it was the browser's pop-up blocker.
 */
export function openDriveTab(path: string, onBlocked?: (msg: string) => void): boolean {
  if (typeof window === 'undefined') return false;
  try { if (window.matchMedia('(max-width: 767px)').matches) return false; } catch { /* no matchMedia: treat as desktop */ }
  try {
    const base = path.split('?')[0];
    const w = window.open('', `crm-drive-${base.replace(/[^a-z0-9]/gi, '-')}`);   // finds the tab if it is already open; otherwise a new, blank one
    if (!w) throw new Error('blocked');
    let here = ''; try { here = w.location.pathname; } catch { /* another site: reload it below */ }
    if (here !== base) w.location.href = path; else w.focus();
    return true;
  } catch {
    onBlocked?.('Your browser blocked the new tab, so it opened here. Allow pop-ups for this site to open documents in their own tab.');
    return false;
  }
}

/** Tabs tell each other that something in My Drive changed (a rename, a save, sharing), so lists in other tabs refresh. */
const CHANNEL = 'crm-drive';
export function announceDriveChanged() {
  try { const c = new BroadcastChannel(CHANNEL); c.postMessage('changed'); c.close(); } catch { /* no BroadcastChannel: lists refresh on their own next time */ }
}
export function onDriveChanged(cb: () => void): () => void {
  try { const c = new BroadcastChannel(CHANNEL); c.onmessage = () => cb(); return () => c.close(); } catch { return () => {}; }
}

/** Leaves a standalone page: closes the tab when this script opened it, otherwise goes back to the Drive in the CRM. */
export function leaveDrivePage(bu: 'commercial' | 'residential') {
  window.close();
  setTimeout(() => { window.location.href = `/crm/${bu}#transaction-docs`; }, 250);   // still here = the tab could not close itself
}
