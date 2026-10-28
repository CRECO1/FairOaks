/**
 * Email HTML → readable plain text, keeping the shape the sender wrote: paragraph breaks, line breaks, bullet lists
 * and decoded characters ("&nbsp;" must never reach the screen). The CRM stores and shows emails as text; the old
 * conversions collapsed every newline into a space, so a three-paragraph email with options became one run-on block.
 * Client-safe (no Node APIs) — the thread view and the server routes share it.
 */
const NAMED: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  deg: '°', times: '×', laquo: '«', raquo: '»', euro: '€', pound: '£', cent: '¢', sect: '§', para: '¶',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      return code === 0xa0 ? ' ' : String.fromCodePoint(code);
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// A link whose text is already a URL/domain/email reads fine alone; a labelled link ("Leave a review") keeps its address.
const looksLikeAddress = (t: string) => /^(https?:\/\/|www\.|mailto:)/i.test(t) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) || /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(t);

export function htmlToText(html: string): string {
  let t = String(html ?? '').replace(/\r\n?/g, '\n');
  t = t.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const txt = decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (!txt) return /^https?:/i.test(href) ? href : '';
    if (looksLikeAddress(txt) || !/^https?:/i.test(href) || href.length > 120) return txt;
    return `${txt} (${href})`;
  });
  // A block element starts a new line even right after inline text ("<b>Name</b><div>Title</div>" is two lines in a
  // browser). Opening blocks leave a marker that merges with an already-pending newline, so back-to-back <div>s stay
  // single-spaced while <div><br></div> still makes a blank line.
  t = t.replace(/<(span|a|b|strong|em|i|font|label)\b[^>]*display\s*:\s*block[^>]*>/gi, '\u0001$&');
  t = t.replace(/<(div|p|ul|ol|table|tr|h[1-6]|blockquote|pre)\b[^>]*>/gi, '\u0001');
  t = t
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\u0001• ')
    .replace(/<\/(p|h[1-6]|blockquote|ul|ol|table|pre)>/gi, '\n\n')
    .replace(/<\/(div|tr|li)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]*>/g, '');
  t = t.replace(/\n?\u0001/g, '\n').replace(/\u0001/g, '');
  t = decodeEntities(t);
  return t.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
