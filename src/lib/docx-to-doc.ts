import mammoth from 'mammoth';

// A Word (.docx) file → My Drive editor content. mammoth turns the Word file into clean HTML (paragraphs, headings, lists, tables, bold /
// italic / underline / links); this reads that HTML into the editor's own JSON, so the result opens as an ordinary live document.
// Pictures, page headers / footers and exact Word layout are NOT carried over (the CRECO letterhead is a setting of the document instead).

type Mark = { type: string; attrs?: Record<string, unknown> };
export type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: Mark[] };
type El = { tag: string; attrs: Record<string, string>; kids: Tree[] };
type Tree = El | string;

const VOID = new Set(['br', 'img', 'hr']);
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));

function parse(html: string): El {
  const root: El = { tag: 'root', attrs: {}, kids: [] };
  const stack: El[] = [root];
  const re = /<(\/?)([a-z0-9]+)((?:\s+[^>]*?)?)(\/?)>|([^<]+)/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.kids.push(decode(m[5])); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([a-z-]+)="([^"]*)"/gi)) attrs[a[1].toLowerCase()] = decode(a[2]);
    const el: El = { tag, attrs, kids: [] };
    top.kids.push(el);
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  return root;
}

function inline(nodes: Tree[], marks: Mark[] = []): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    if (typeof n === 'string') { const t = n.replace(/\s+/g, ' '); if (t) out.push({ type: 'text', text: t, ...(marks.length ? { marks } : {}) }); continue; }
    switch (n.tag) {
      case 'strong': case 'b': out.push(...inline(n.kids, [...marks, { type: 'bold' }])); break;
      case 'em': case 'i': out.push(...inline(n.kids, [...marks, { type: 'italic' }])); break;
      case 'u': out.push(...inline(n.kids, [...marks, { type: 'underline' }])); break;
      case 's': case 'strike': case 'del': out.push(...inline(n.kids, [...marks, { type: 'strike' }])); break;
      case 'a': out.push(...inline(n.kids, /^https?:\/\//i.test(n.attrs.href ?? '') ? [...marks, { type: 'link', attrs: { href: n.attrs.href } }] : marks)); break;
      case 'br': out.push({ type: 'hardBreak' }); break;
      case 'img': break;
      default: out.push(...inline(n.kids, marks));
    }
  }
  return out;
}

/** A paragraph from inline nodes: edge whitespace trimmed, empty text dropped. */
function para(nodes: PMNode[]): PMNode {
  const c = nodes.map(n => ({ ...n }));
  while (c.length && c[0].type === 'text' && !c[0].text!.trim()) c.shift();
  while (c.length && c[c.length - 1].type === 'text' && !c[c.length - 1].text!.trim()) c.pop();
  if (c.length && c[0].type === 'text') c[0].text = c[0].text!.replace(/^\s+/, '');
  if (c.length && c[c.length - 1].type === 'text') c[c.length - 1].text = c[c.length - 1].text!.replace(/\s+$/, '');
  return c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' };
}

const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'hr', 'div', 'section', 'body', 'pre']);

function blocks(nodes: Tree[]): PMNode[] {
  const out: PMNode[] = [];
  let loose: Tree[] = [];
  const flush = () => { if (loose.some(n => (typeof n === 'string' ? n.trim() : true))) out.push(para(inline(loose))); loose = []; };
  for (const n of nodes) {
    if (typeof n === 'string' || !BLOCK.has(n.tag)) { loose.push(n); continue; }
    flush();
    if (n.tag === 'p' || n.tag === 'pre') { const p = para(inline(n.kids)); if (p.content) out.push(p); }
    else if (/^h[1-6]$/.test(n.tag)) { const c = para(inline(n.kids)).content; if (c) out.push({ type: 'heading', attrs: { level: Math.min(3, Number(n.tag[1])) }, content: c }); }
    else if (n.tag === 'ul' || n.tag === 'ol') out.push(list(n));
    else if (n.tag === 'table') { const t = table(n); if (t) out.push(t); }
    else if (n.tag === 'blockquote') { const b = blocks(n.kids); if (b.length) out.push({ type: 'blockquote', content: b }); }
    else if (n.tag === 'hr') out.push({ type: 'horizontalRule' });
    else out.push(...blocks(n.kids));
  }
  flush();
  return out;
}

function list(el: El): PMNode {
  const items: PMNode[] = [];
  for (const li of el.kids) {
    if (typeof li === 'string' || li.tag !== 'li') continue;
    const nested = li.kids.filter((k): k is El => typeof k !== 'string' && (k.tag === 'ul' || k.tag === 'ol'));
    const own = blocks(li.kids.filter(k => !(typeof k !== 'string' && (k.tag === 'ul' || k.tag === 'ol'))));
    if (!own.length || own[0].type !== 'paragraph') own.unshift({ type: 'paragraph' });
    items.push({ type: 'listItem', content: [...own, ...nested.map(list)] });
  }
  return { type: el.tag === 'ol' ? 'orderedList' : 'bulletList', content: items.length ? items : [{ type: 'listItem', content: [{ type: 'paragraph' }] }] };
}

function table(el: El): PMNode | null {
  const rows: El[] = [];
  const collect = (nodes: Tree[]) => { for (const n of nodes) if (typeof n !== 'string') { if (n.tag === 'tr') rows.push(n); else if (['thead', 'tbody', 'tfoot'].includes(n.tag)) collect(n.kids); } };
  collect(el.kids);
  if (!rows.length) return null;
  const cells = rows.map(r => r.kids.filter((c): c is El => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th')));
  const width = Math.max(1, ...cells.map(r => r.length));
  return {
    type: 'table',
    content: cells.map(r => ({
      type: 'tableRow',
      content: Array.from({ length: width }, (_, i) => {
        const c = r[i];
        const b = c ? blocks(c.kids) : [];
        return { type: c?.tag === 'th' ? 'tableHeader' : 'tableCell', content: b.length ? b : [{ type: 'paragraph' }] };
      }),
    })),
  };
}

/** The editor JSON for a .docx file (a doc with no readable text becomes one empty paragraph). */
export async function docxToDocJson(buffer: Buffer): Promise<{ json: PMNode; messages: string[] }> {
  const res = await mammoth.convertToHtml({ buffer }, {
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
    convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
  });
  const content = blocks(parse(res.value).kids);
  return { json: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, messages: res.messages.map(m => m.message) };
}

/** Plain text → editor JSON: blank lines separate paragraphs, single line breaks stay line breaks. */
export function textToDocJson(text: string): PMNode {
  const paras = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split(/\n{2,}/).map(p => p.replace(/^\n+|\n+$/g, '')).filter(p => p.trim());
  const content: PMNode[] = paras.map(p => {
    const c: PMNode[] = [];
    p.split('\n').forEach((line, i) => { if (i) c.push({ type: 'hardBreak' }); if (line.trim()) c.push({ type: 'text', text: line.replace(/\s+$/, '') }); });
    return c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' };
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
