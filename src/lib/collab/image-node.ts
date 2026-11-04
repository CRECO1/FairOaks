import { Node } from '@tiptap/core';

// An inline picture stored IN the document (a small data: URL, scaled down before it is added), so it syncs live like any other content.
// Only data:image and https sources are ever rendered — the value comes from shared document state.
const OK = /^(data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+|https:\/\/[^\s"'<>]+)$/;
export const safeImageSrc = (v: unknown) => (typeof v === 'string' && v.length < 2_000_000 && OK.test(v) ? v : null);

export const ImageNode = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      width: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'img[src]' }]; },
  renderHTML({ node }) {
    const src = safeImageSrc(node.attrs.src);
    if (!src) return ['span', { class: 'doc-img-missing' }, '[image]'];
    const w = Number(node.attrs.width);
    return ['img', { src, alt: String(node.attrs.alt ?? '').slice(0, 200), class: 'doc-img', ...(Number.isFinite(w) && w > 20 && w < 2000 ? { style: `width:${Math.round(w)}px` } : {}) }];
  },
});
