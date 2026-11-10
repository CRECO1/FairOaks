// Word documents drawn like Word shows them: real page size and margins, fonts, colours, tables, headers/footers, images.
// (mammoth, used before, reflows the text and drops most of the layout.) Parsed and drawn in the browser only.
// SAFETY: a .docx comes from a sender, so after drawing we strip anything that could run or navigate: scripts, frames,
// forms, event handlers, and any link that is not http(s)/mailto/tel. Images are embedded as data: URIs.

export async function renderDocxInto(bytes: ArrayBuffer, host: HTMLElement): Promise<void> {
  // @ts-ignore — types ship with the package; resolved at build time
  const mod = await import('docx-preview');
  host.innerHTML = '';
  await mod.renderAsync(bytes.slice(0), host, undefined, {
    className: 'docx', inWrapper: true, ignoreWidth: false, ignoreHeight: true, ignoreFonts: false,
    breakPages: true, useBase64URL: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
    ignoreLastRenderedPageBreak: true,
  });
  scrub(host);
}

function scrub(root: HTMLElement) {
  root.querySelectorAll('script,iframe,object,embed,form,link,meta,base,audio,video,svg script').forEach(n => n.remove());
  root.querySelectorAll<HTMLElement>('*').forEach(el => {
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    if (el instanceof HTMLAnchorElement) {
      const h = el.getAttribute('href') ?? '';
      if (/^(https?:|mailto:|tel:)/i.test(h)) { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      else if (!h.startsWith('#')) el.removeAttribute('href');
    }
    if (el instanceof HTMLImageElement && !/^(data:image\/|blob:)/i.test(el.getAttribute('src') ?? '')) el.remove();
  });
}
