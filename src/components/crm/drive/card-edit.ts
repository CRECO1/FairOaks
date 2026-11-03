/** "Edit as a live document" for a Word / text file on a deal's Docs tab or a contact's Files. */
export const canEditCardFile = (name: string) => /\.(docx|txt)$/i.test(name);
export const OPEN_LIVE_DOC = 'crm:open-live-doc';

/** Converts (once) and asks the card's Live documents section to open the editor. Resolves true when it worked. */
export async function editCardFile(source: 'deal' | 'client', id: string, authToken: string | undefined, onToast: (m: string) => void): Promise<boolean> {
  onToast('Opening as an editable document…');
  try {
    const r = await fetch('/api/crm/drive/card-doc/convert', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }, body: JSON.stringify({ source, id }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { onToast((j as { error?: string }).error || 'Could not open it for editing'); return false; }
    window.dispatchEvent(new CustomEvent(OPEN_LIVE_DOC, { detail: { id: (j as { item: { id: string } }).item.id, handled: false } }));
    return true;
  } catch { onToast('Could not open it for editing'); return false; }
}
