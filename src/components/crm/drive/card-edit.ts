/** "Edit as a live document" for a Word / text file on a deal's Docs tab or a contact's Files. */
export const canEditCardFile = (name: string) => /\.(docx|txt)$/i.test(name);
export const OPEN_LIVE_DOC = 'crm:open-live-doc';

export const LIVE_DOCS_CHANGED = 'crm:live-docs-changed';

/** Converts a card file to a live document (once) and links it to the card. Does not open anything. */
export async function convertCardFile(source: 'deal' | 'client', id: string, authToken: string | undefined): Promise<{ ok: true; docId: string } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/crm/drive/card-doc/convert', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }, body: JSON.stringify({ source, id }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || 'Could not make it editable' };
    window.dispatchEvent(new Event(LIVE_DOCS_CHANGED));
    return { ok: true, docId: (j as { item: { id: string } }).item.id };
  } catch { return { ok: false, error: 'Could not make it editable' }; }
}

/** Converts (once) and asks the card's Live documents section to open the editor. Resolves true when it worked. */
export async function editCardFile(source: 'deal' | 'client', id: string, authToken: string | undefined, onToast: (m: string) => void): Promise<boolean> {
  onToast('Opening as an editable document…');
  const r = await convertCardFile(source, id, authToken);
  if (!r.ok) { onToast(r.error); return false; }
  window.dispatchEvent(new CustomEvent(OPEN_LIVE_DOC, { detail: { id: r.docId, handled: false } }));
  return true;
}
