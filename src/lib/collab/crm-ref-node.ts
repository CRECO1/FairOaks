import { Node } from '@tiptap/core';

// An "@" mention of a CRM contact or deal inside a document: a small inline chip that stores only the record's id + the name it had
// when it was inserted. Clicking it opens the record (the click is handled by the editor, which asks the CRM to open it).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const safeCrmRef = (kind: unknown, id: unknown): { kind: 'contact' | 'deal'; id: string } | null =>
  (kind === 'contact' || kind === 'deal') && typeof id === 'string' && UUID.test(id) ? { kind, id } : null;

export const CrmRefNode = Node.create({
  name: 'crmRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: 'contact' }, id: { default: '' }, label: { default: '' } };
  },
  parseHTML() { return [{ tag: 'span[data-crm-ref]' }]; },
  renderHTML({ node }) {
    const ref = safeCrmRef(node.attrs.kind, node.attrs.id);
    const label = String(node.attrs.label ?? '').slice(0, 120);
    return ['span', { class: `crm-ref crm-ref-${ref?.kind ?? 'contact'}`, 'data-crm-ref': '1', ...(ref ? { 'data-kind': ref.kind, 'data-id': ref.id } : {}), title: ref?.kind === 'deal' ? 'Open this deal' : 'Open this contact' }, `@${label}`];
  },
  renderText({ node }) { return `@${String(node.attrs.label ?? '')}`; },
});
