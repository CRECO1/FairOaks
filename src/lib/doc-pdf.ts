/**
 * Live document -> PDF, in the browser (pdf-lib, no server).
 *
 * Takes the editor's ProseMirror JSON (headings, paragraphs with bold / italic / underline / strike / links, bullet / numbered / task
 * lists, quotes, dividers, code, tables) and lays it out on US Letter pages with the standard Helvetica fonts, wrapping text, breaking
 * pages, and numbering them. Comment highlights are left out. Helvetica can only draw Latin-1 text, so smart quotes and dashes are
 * mapped to plain ones and anything else (emoji…) is dropped rather than failing the export.
 */
import { fontByCss, rgbOf, sizePt } from '@/lib/doc-fonts';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

type Mark = { type: string; attrs?: Record<string, unknown> };
export type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: Mark[] };

const PW = 612, PH = 792, ML = 64, MR = 64, MT = 64, MB = 62;
const CW = PW - ML - MR;
const INK = rgb(0.1, 0.1, 0.12), GREY = rgb(0.36, 0.38, 0.42), GOLD = rgb(0.79, 0.57, 0.17), LINE = rgb(0.82, 0.84, 0.87), BLUE = rgb(0.11, 0.31, 0.85);

export const winAnsi = (s: string) => (s || '')
  .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[•●]/g, '*').replace(/[✓✔✅☑]/g, 'x').replace(/ /g, ' ')
  // eslint-disable-next-line no-control-regex
  .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');

interface Run { text: string; fam?: 'sans' | 'serif' | 'mono' | null; bold?: boolean; italic?: boolean; code?: boolean; underline?: boolean; strike?: boolean; link?: boolean; size: number; color?: ReturnType<typeof rgb>; br?: boolean }
interface Seg { text: string; font: PDFFont; size: number; underline?: boolean; strike?: boolean; color: ReturnType<typeof rgb>; w: number }
interface Line { segs: Seg[]; w: number }

/** The CRECO letterhead, laid out like the preset Letters of Intent: the logo block once at the top of the FIRST page, and a light rule + tagline + address line at the foot of EVERY page. */
export const LETTERHEAD = {
  contact: '8000 Fair Oaks Pkwy, Suite 100, Fair Oaks Ranch, TX 78015      •      (210) 817-3443      •      crecotx.com',
  tagline: 'Where your real estate ventures find the support they deserve',
  footContact: '8000 Fair Oaks Pkwy, Suite 100, Fair Oaks Ranch, TX 78015   |   (210) 817-3443   |   info@crecotx.com   |   crecotx.com',
  logoPath: '/creco-letterhead-logo.png',
};
let logoCache: Uint8Array | null = null;
/** The letterhead logo's bytes (fetched once). */
export async function letterheadLogo(): Promise<Uint8Array | null> {
  if (logoCache) return logoCache;
  // On the server (emailing a document as a PDF) there is no page origin: read the file from the app's own public folder, else fetch the live site's copy.
  if (typeof window === 'undefined') {
    try { const [{ readFile }, path] = await Promise.all([import('fs/promises'), import('path')]); logoCache = new Uint8Array(await readFile(path.join(process.cwd(), 'public', LETTERHEAD.logoPath))); return logoCache; } catch { /* fall through */ }
    try { const r = await fetch(`https://www.fairoaksrealtygroup.com${LETTERHEAD.logoPath}`); if (r.ok) { logoCache = new Uint8Array(await r.arrayBuffer()); return logoCache; } } catch { /* no logo */ }
    return null;
  }
  try { const r = await fetch(LETTERHEAD.logoPath); if (!r.ok) return null; logoCache = new Uint8Array(await r.arrayBuffer()); return logoCache; } catch { return null; }
}

/**
 * What leaves the app (PDF / Word / signature): suggested deletions are dropped and suggested additions kept as plain text (the document
 * as it would read if every suggestion were accepted), and inline pictures become their own blocks so both writers can place them.
 */
export function prepForExport(doc: PMNode): PMNode {
  const clean = (n: PMNode): PMNode[] => {
    if (n.type === 'text') {
      if ((n.marks ?? []).some(m => m.type === 'suggestDel')) return [];
      const marks = (n.marks ?? []).filter(m => m.type !== 'suggestAdd' && m.type !== 'suggestDel');
      return [{ ...n, marks }];
    }
    if (n.type === 'crmRef') return [{ type: 'text', text: `@${String((n.attrs as { label?: string } | undefined)?.label ?? '')}` }];
    const kids = (n.content ?? []).flatMap(clean);
    if (n.type === 'paragraph' || n.type === 'heading') {
      const imgs = kids.filter(k => k.type === 'image'), rest = kids.filter(k => k.type !== 'image');
      if (!imgs.length) return [{ ...n, content: rest }];
      return [...(rest.length ? [{ ...n, content: rest }] : []), ...imgs];
    }
    return [{ ...n, content: n.content ? kids : undefined }];
  };
  return clean(doc)[0] ?? doc;
}

/** A data:image URL's bytes + kind (null when it is not a picture the writers can embed). */
export function decodeImage(src: unknown): { bytes: Uint8Array; kind: 'png' | 'jpg' | 'gif' } | null {
  const m = typeof src === 'string' ? /^data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/=]+)$/.exec(src) : null;
  if (!m) return null;
  const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, kind: m[1] === 'png' ? 'png' : m[1] === 'gif' ? 'gif' : 'jpg' };
}

export async function docToPdf(rawDoc: PMNode, title: string, opts: { letterhead?: boolean } = {}): Promise<Uint8Array> {
  const doc = prepForExport(rawDoc);
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(title) || 'Document'); pdf.setCreator('CRECO CRM');
  const F = {
    r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold),
    i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique), c: await pdf.embedFont(StandardFonts.Courier),
    // serif (Georgia / Times New Roman in the toolbar) and a bold Courier, only embedded when a run asks for them
    sr: null as PDFFont | null, sb: null as PDFFont | null, si: null as PDFFont | null, sbi: null as PDFFont | null, cb: null as PDFFont | null,
  };
  const anyFam = (n: PMNode): Set<string> => { const out = new Set<string>(); const w = (x: PMNode) => { for (const k of x.marks ?? []) if (k.type === 'textStyle') { const f = fontByCss(k.attrs?.fontFamily); if (f?.pdf) out.add(f.pdf); } (x.content ?? []).forEach(w); }; w(n); return out; };
  const fams = anyFam(doc);
  if (fams.has('serif')) { F.sr = await pdf.embedFont(StandardFonts.TimesRoman); F.sb = await pdf.embedFont(StandardFonts.TimesRomanBold); F.si = await pdf.embedFont(StandardFonts.TimesRomanItalic); F.sbi = await pdf.embedFont(StandardFonts.TimesRomanBoldItalic); }
  if (fams.has('mono')) F.cb = await pdf.embedFont(StandardFonts.CourierBold);
  const pages: PDFPage[] = [];
  let page: PDFPage, y = 0;
  // Letterhead (as on the preset LOIs): logo block on page 1 only; rule + tagline + address line at the foot of every page.
  const lh = !!opts.letterhead;
  const logo = lh ? await letterheadLogo() : null;
  const logoImg = logo ? await pdf.embedPng(logo) : null;
  const logoW = 240, logoH = logoImg ? (logoImg.height / logoImg.width) * logoW : 0;
  const TIMES = lh ? await pdf.embedFont(StandardFonts.TimesRoman) : null;
  const TIMESI = lh ? await pdf.embedFont(StandardFonts.TimesRomanItalic) : null;
  const firstTop = lh ? PH - 30 - logoH - 13 - 9 - 24 : PH - MT;   // below the logo, contact line and rule
  const bottom = lh ? 80 : MB;
  const BLACK = rgb(0.07, 0.07, 0.08);
  const newPage = () => {
    const first = pages.length === 0;
    page = pdf.addPage([PW, PH]); pages.push(page); y = first ? firstTop : PH - MT;
    if (!lh || !TIMES || !TIMESI) return;
    const center = (t: string, cy: number, size: number, font: PDFFont, color = GREY) => page.drawText(t, { x: (PW - font.widthOfTextAtSize(t, size)) / 2, y: cy, size, font, color });
    if (first) {
      let hy = PH - 30 - logoH;
      if (logoImg) page.drawImage(logoImg, { x: (PW - logoW) / 2, y: hy, width: logoW, height: logoH });
      hy -= 13; center(winAnsi(LETTERHEAD.contact), hy, 8, TIMES);
      hy -= 9; page.drawLine({ start: { x: ML, y: hy }, end: { x: PW - MR, y: hy }, thickness: 2.4, color: BLACK });
    }
    page.drawLine({ start: { x: ML, y: 64 }, end: { x: PW - MR, y: 64 }, thickness: 2.4, color: BLACK });
    center(LETTERHEAD.tagline, 51, 8.5, TIMESI, rgb(0.23, 0.23, 0.25));
    center(winAnsi(LETTERHEAD.footContact), 40, 7.5, TIMES);
  };
  // Pictures are embedded up front (pdf-lib embeds are async; layout below is synchronous).
  const embedded = new Map<PMNode, Awaited<ReturnType<typeof pdf.embedPng>>>();
  const findImgs = (n: PMNode): PMNode[] => (n.type === 'image' ? [n] : (n.content ?? []).flatMap(findImgs));
  for (const n of findImgs(doc)) { const d = decodeImage(n.attrs?.src); if (!d || d.kind === 'gif') continue; try { embedded.set(n, d.kind === 'png' ? await pdf.embedPng(d.bytes) : await pdf.embedJpg(d.bytes)); } catch { /* shown as [picture] */ } }
  newPage();
  const need = (h: number) => { if (y - h < bottom) newPage(); };
  const fontOf = (r: Run) => {
    const fam = r.code ? 'mono' : r.fam;
    if (fam === 'serif' && F.sr) return r.bold && r.italic ? F.sbi! : r.bold ? F.sb! : r.italic ? F.si! : F.sr;
    if (fam === 'mono') return r.bold && F.cb ? F.cb : F.c;
    return r.bold && r.italic ? F.bi : r.bold ? F.b : r.italic ? F.i : F.r;
  };

  // Inline content -> runs
  const runsOf = (n: PMNode, base: Pick<Run, 'size' | 'bold' | 'italic' | 'color'>): Run[] => {
    const out: Run[] = [];
    const walk = (x: PMNode) => {
      if (x.type === 'text') {
        const m = new Set((x.marks ?? []).map(k => k.type));
        const ts = (x.marks ?? []).find(k => k.type === 'textStyle')?.attrs ?? {}; const fnt = fontByCss(ts.fontFamily); const rgbv = rgbOf(ts.color); const pt = sizePt(ts.fontSize);
        out.push({ text: winAnsi(x.text ?? ''), fam: fnt?.pdf ?? null, size: pt ?? base.size, bold: base.bold || m.has('bold'), italic: base.italic || m.has('italic'), code: m.has('code'), underline: m.has('underline') || m.has('link'), strike: m.has('strike'), link: m.has('link'), color: m.has('link') ? BLUE : rgbv ? rgb(rgbv[0] / 255, rgbv[1] / 255, rgbv[2] / 255) : base.color });
      } else if (x.type === 'hardBreak') out.push({ text: '', size: base.size, br: true });
      else (x.content ?? []).forEach(walk);
    };
    (n.content ?? []).forEach(walk);
    return out;
  };

  // Wrap runs into lines no wider than `width`
  const wrap = (runs: Run[], width: number): Line[] => {
    const lines: Line[] = [{ segs: [], w: 0 }];
    const cur = () => lines[lines.length - 1];
    for (const r of runs) {
      if (r.br) { lines.push({ segs: [], w: 0 }); continue; }
      const font = fontOf(r);
      for (const tok of r.text.split(/(\s+)/).filter(t => t !== '')) {
        const isSpace = /^\s+$/.test(tok);
        let t = isSpace ? ' ' : tok;
        let w = font.widthOfTextAtSize(t, r.size);
        if (isSpace && cur().segs.length === 0) continue;          // no leading space on a line
        if (!isSpace && cur().w + w > width && cur().segs.length) lines.push({ segs: [], w: 0 });
        while (!isSpace && w > width) {                              // one word wider than the line: split it
          let k = t.length; while (k > 1 && font.widthOfTextAtSize(t.slice(0, k), r.size) > width) k--;
          cur().segs.push({ text: t.slice(0, k), font, size: r.size, underline: r.underline, strike: r.strike, color: r.color ?? INK, w: font.widthOfTextAtSize(t.slice(0, k), r.size) });
          lines.push({ segs: [], w: 0 }); t = t.slice(k); w = font.widthOfTextAtSize(t, r.size);
        }
        cur().segs.push({ text: t, font, size: r.size, underline: r.underline, strike: r.strike, color: r.color ?? INK, w });
        cur().w += w;
      }
    }
    return lines;
  };
  const lineH = (l: Line, size: number) => Math.max(size, ...l.segs.map(s => s.size)) * 1.38;

  // Draw wrapped lines at x..x+width, breaking pages as needed. `first` runs once with the page + baseline of the first line.
  const paragraph = (runs: Run[], o: { x?: number; width?: number; align?: string; size?: number; after?: number; before?: number; ls?: number; first?: (p: PDFPage, baseline: number) => void; bar?: boolean }) => {
    const x0 = o.x ?? ML, width = o.width ?? CW, size = o.size ?? 11;
    const lines = wrap(runs, width);
    if (o.before) y -= o.before;
    let firstDone = false, barTop = y;
    for (const l of lines) {
      const h = lineH(l, size) * (o.ls ? o.ls / 1.15 : 1);
      if (y - h < bottom) { if (o.bar) page.drawRectangle({ x: x0 - 9, y, width: 3, height: barTop - y, color: GOLD }); newPage(); barTop = y; }
      const base = y - size;
      let x = x0 + (o.align === 'center' ? (width - l.w) / 2 : o.align === 'right' ? width - l.w : 0);
      for (const s of l.segs) {
        if (s.text.trim() || s.text === ' ') {
          page.drawText(s.text, { x, y: base, size: s.size, font: s.font, color: s.color });
          if (s.underline) page.drawLine({ start: { x, y: base - 1.5 }, end: { x: x + s.w, y: base - 1.5 }, thickness: 0.5, color: s.color });
          if (s.strike) page.drawLine({ start: { x, y: base + s.size * 0.3 }, end: { x: x + s.w, y: base + s.size * 0.3 }, thickness: 0.6, color: s.color });
        }
        x += s.w;
      }
      if (!firstDone) { firstDone = true; o.first?.(page, base); }
      y -= h;
    }
    if (o.bar) page.drawRectangle({ x: x0 - 9, y, width: 3, height: barTop - y, color: GOLD });
    y -= o.after ?? 6;
  };

  const blocks = (nodes: PMNode[], x: number, width: number) => { for (const n of nodes) block(n, x, width); };
  const block = (n: PMNode, x: number, width: number) => {
    const align = n.attrs?.textAlign as string | undefined;
    const ind = Math.min(width * 0.6, Math.max(0, Number(n.attrs?.indent) || 0) * 36), ls = Number(n.attrs?.lineSpacing) || undefined;
    switch (n.type) {
      case 'heading': {
        const lv = Number(n.attrs?.level ?? 1), size = lv === 1 ? 22 : lv === 2 ? 16.5 : 13.5;
        need(size * 3);
        paragraph(runsOf(n, { size, bold: true, color: INK }), { x: x + ind, width: width - ind, align, size, before: lv === 1 ? 4 : 10, after: 5, ls });
        break;
      }
      case 'paragraph': paragraph(runsOf(n, { size: 11, color: INK }), { x: x + ind, width: width - ind, align, size: 11, after: 6, ls }); break;
      case 'image': {
        const img = decodeImage(n.attrs?.src);
        if (!img || img.kind === 'gif') { paragraph([{ text: '[picture]', size: 10, color: GREY, italic: true }], { x, width, size: 10, after: 6 }); break; }
        const pic = embedded.get(n) ?? null;
        if (!pic) break;
        const w = Math.min(width, pic.width * 0.75), h = (pic.height / pic.width) * w;
        need(Math.min(h, PH - MT - bottom));
        page.drawImage(pic, { x, y: y - h, width: w, height: h }); y -= h + 8;
        break;
      }
      case 'blockquote': {
        const start = y;
        for (const c of n.content ?? []) paragraph(runsOf(c, { size: 11, color: GREY }), { x: x + 12, width: width - 12, size: 11, after: 4, bar: true });
        void start; y -= 2; break;
      }
      case 'horizontalRule': need(14); page.drawLine({ start: { x, y: y - 5 }, end: { x: x + width, y: y - 5 }, thickness: 0.8, color: LINE }); y -= 14; break;
      case 'codeBlock': paragraph(runsOf(n, { size: 9.5, color: INK }).map(r => ({ ...r, code: true })), { x: x + 6, width: width - 12, size: 9.5, after: 8 }); break;
      case 'bulletList': case 'orderedList': case 'taskList': list(n, x, width); break;
      case 'table': table(n, x, width); break;
      default: if (n.content) blocks(n.content, x, width);
    }
  };

  const list = (n: PMNode, x: number, width: number) => {
    const items = n.content ?? [];
    const start = Number(n.attrs?.start ?? 1);
    items.forEach((it, idx) => {
      const kids = it.content ?? [];
      const ind = 20;
      let marked = false;
      kids.forEach(k => {
        if (k.type === 'paragraph' || k.type === 'heading') {
          paragraph(runsOf(k, { size: 11, color: n.type === 'taskList' && it.attrs?.checked ? GREY : INK }), {
            x: x + ind, width: width - ind, size: 11, after: 3,
            first: marked ? undefined : (p, base) => {
              marked = true;
              if (n.type === 'taskList') {
                const bx = x + 3, by = base - 1;
                p.drawRectangle({ x: bx, y: by, width: 9, height: 9, borderColor: GREY, borderWidth: 0.9 });
                if (it.attrs?.checked) { p.drawLine({ start: { x: bx + 1.8, y: by + 4.5 }, end: { x: bx + 4, y: by + 2 } , thickness: 1.2, color: INK }); p.drawLine({ start: { x: bx + 4, y: by + 2 }, end: { x: bx + 7.8, y: by + 7.5 }, thickness: 1.2, color: INK }); }
              } else if (n.type === 'orderedList') p.drawText(`${start + idx}.`, { x: x + 2, y: base, size: 11, font: F.r, color: INK });
              else p.drawText('-', { x: x + 6, y: base, size: 11, font: F.b, color: INK });
            },
          });
        } else block(k, x + ind, width - ind);
      });
      if (!kids.length) y -= 4;
    });
    y -= 3;
  };

  const table = (n: PMNode, x: number, width: number) => {
    const rows = (n.content ?? []).map(r => (r.content ?? []));
    const cols = Math.max(1, ...rows.map(r => r.length));
    const cw = width / cols, pad = 5, size = 9.5;
    for (const row of rows) {
      const cells = row.map(c => {
        const head = c.type === 'tableHeader';
        const runs: Run[] = [];
        (c.content ?? []).forEach((p, i) => { if (i) runs.push({ text: '', size, br: true }); runs.push(...runsOf(p, { size, bold: head, color: INK })); });
        return { head, lines: wrap(runs, cw - pad * 2) };
      });
      const h = Math.max(...cells.map(c => c.lines.reduce((a, l) => a + lineH(l, size), 0)), size * 1.4) + pad * 2;
      need(Math.min(h, PH - MT - bottom));
      cells.forEach((c, ci) => {
        const cx = x + ci * cw;
        page.drawRectangle({ x: cx, y: y - h, width: cw, height: h, borderColor: LINE, borderWidth: 0.7, color: c.head ? rgb(0.95, 0.96, 0.97) : undefined });
        let ty = y - pad;
        for (const l of c.lines) {
          const lh = lineH(l, size); let tx = cx + pad;
          for (const s of l.segs) { if (s.text.trim()) page.drawText(s.text, { x: tx, y: ty - size, size, font: s.font, color: s.color }); tx += s.w; }
          ty -= lh;
        }
      });
      y -= h;
    }
    y -= 8;
  };

  blocks(doc.content ?? [], ML, CW);
  pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, lh ? { x: PW - MR - 24, y: 24, size: 8, font: F.r, color: GREY } : { x: PW / 2 - 14, y: 30, size: 8.5, font: F.r, color: GREY }));
  return pdf.save();
}

/** Trigger a browser download of some bytes. */
export function saveBytes(bytes: Uint8Array, filename: string, type = 'application/pdf') {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export const pdfName = (title: string) => `${(title || 'Document').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Document'}.pdf`;
