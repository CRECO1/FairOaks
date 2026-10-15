// A tiny bridge between the document editors and the Copilot panel, which are mounted in
// different parts of the CRM and know nothing about each other.
//
//  - An editor that has a SAVED document on screen registers it (setOpenDoc), so the
//    Copilot can be told "the agent is looking at THIS document" and "this LOI" resolves.
//  - When the Copilot edits a document it announces it (announceDocUpdated); an editor
//    showing that document reloads, so the change appears live instead of being
//    overwritten by the next Save of a stale copy.
export interface OpenDoc { submissionId: string; title: string; kind: 'loi' | 'form' }

const KEY = '__crmOpenDoc';
export const DOC_UPDATED_EVENT = 'crm:doc-updated';

export function setOpenDoc(d: OpenDoc | null) {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[KEY] = d;
}

export function getOpenDoc(): OpenDoc | null {
  if (typeof window === 'undefined') return null;
  const d = (window as unknown as Record<string, unknown>)[KEY] as OpenDoc | null | undefined;
  return d && d.submissionId ? d : null;
}

export function announceDocUpdated(submissionId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DOC_UPDATED_EVENT, { detail: { submissionId } }));
}
