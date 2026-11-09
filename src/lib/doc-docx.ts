/**
 * Live document -> Word (.docx), in the browser (or on a server): the same editor content the PDF export reads, written as a real Word file
 * people can keep editing in Word. Headings, paragraphs with bold / italic / underline / strike / code / links, bullet / numbered / task
 * lists (nested), quotes, dividers, code blocks and tables. With the CRECO letterhead on, page 1 gets the logo + address block and every page
 * the tagline / address footer, like the PDF. Comment highlights are left out.
 */
import { fontByCss, rgbOf, sizePt } from '@/lib/doc-fonts';
import {
  AlignmentType, BorderStyle, LineRuleType, Document, ExternalHyperlink, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild,
} from 'docx';
import { LETTERHEAD, decodeImage, letterheadLogo, prepForExport, type PMNode } from '@/lib/doc-pdf';

const FONT = 'Calibri';
const MONO = 'Courier New';
const GOLD = 'C9922C';
const RULE = '1C1C1F';

type Marks = { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean };

/** Inline nodes -> runs (links become hyperlinks). */
function inline(nodes: PMNode[] | undefined, base: Marks = {}, size?: number): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue; }
    if (n.type !== 'text') { out.push(...inline(n.content, base, size)); continue; }
    const m = new Set((n.marks ?? []).map(k => k.type));
    const link = (n.marks ?? []).find(k => k.type === 'link')?.attrs?.href as string | undefined;
    const ts = (n.marks ?? []).find(k => k.type === 'textStyle')?.attrs ?? {};
    const fnt = fontByCss(ts.fontFamily), pt = sizePt(ts.fontSize), rgbv = rgbOf(ts.color);
    const run = new TextRun({
      text: n.text ?? '', bold: base.bold || m.has('bold'), italics: base.italic || m.has('italic'), strike: m.has('strike'),
      subScript: m.has('subscript') || undefined, superScript: m.has('superscript') || undefined,
      underline: m.has('underline') || link ? {} : undefined, font: m.has('code') ? MONO : fnt?.word ?? undefined, size: pt ? Math.round(pt * 2) : size,
      color: link ? '1D4ED8' : rgbv ? rgbv.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase() : undefined,
    });
    out.push(link && /^https?:\/\//i.test(link) ? new ExternalHyperlink({ link, children: [run] }) : run);
  }
  return out;
}

/** Paragraph / heading layout: alignment, indent (0.5" per level) and line spacing from the block's attrs. */
function blockProps(n: PMNode, spacing: { after: number } | undefined, quote: object): Record<string, unknown> {
  const a = n.attrs ?? {};
  const align = a.textAlign === 'center' ? AlignmentType.CENTER : a.textAlign === 'right' ? AlignmentType.RIGHT : undefined;
  const ind = Math.max(0, Number(a.indent) || 0), ls = Number(a.lineSpacing) || 0;
  const base = { ...quote } as { indent?: { left: number } };
  if (ind) base.indent = { left: (base.indent?.left ?? 0) + ind * 720 };
  const sp = { ...(spacing ?? {}), ...(ls ? { line: Math.round(ls * 240), lineRule: LineRuleType.AUTO } : {}) };
  return { ...base, ...(align ? { alignment: align } : {}), ...(Object.keys(sp).length ? { spacing: sp } : {}) };
}

const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
let orderedInstance = 0;

type Block = Paragraph | Table;

/** Block nodes -> Word blocks. `indent` is the quote / cell nesting; `depth` the list depth. */
function blocks(nodes: PMNode[] | undefined, ctx: { quote?: boolean } = {}): Block[] {
  const out: Block[] = [];
  const quoteProps = ctx.quote ? { indent: { left: 560 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: GOLD, space: 8 } } } : {};
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph': out.push(new Paragraph({ children: inline(n.content), ...blockProps(n, { after: 120 }, quoteProps) })); break;
      case 'image': {
        const img = decodeImage(n.attrs?.src);
        if (!img) { out.push(new Paragraph({ children: [new TextRun({ text: '[picture]', italics: true })], spacing: { after: 120 } })); break; }
        const w0 = Number(n.attrs?.iw) || 400, h0 = Number(n.attrs?.ih) || 300, w = Math.min(w0, 520);
        out.push(new Paragraph({ spacing: { after: 160 }, children: [new ImageRun({ type: img.kind, data: img.bytes, transformation: { width: w, height: Math.round((h0 / w0) * w) }, altText: { title: 'Picture', description: String(n.attrs?.alt ?? 'Picture'), name: 'picture' } })] }));
        break;
      }
      case 'heading': {
        const level = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 1)));
        out.push(new Paragraph({ heading: HEADING[level - 1], children: inline(n.content, { bold: true }, [34, 28, 24][level - 1]), ...blockProps(n, undefined, quoteProps) }));   // formatted directly too, so viewers that ignore styles still show a heading
        break;
      }
      case 'bulletList': case 'orderedList': case 'taskList': out.push(...list(n, 0, n.type === 'orderedList' ? ++orderedInstance : 0, ctx)); break;
      case 'blockquote': out.push(...blocks(n.content, { quote: true })); break;
      case 'codeBlock': {
        const text = (n.content ?? []).map(c => c.text ?? '').join('');
        text.split('\n').forEach(line => out.push(new Paragraph({ children: [new TextRun({ text: line, font: MONO, size: 19 })], shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' }, spacing: { after: 0 } })));
        out.push(new Paragraph({ children: [], spacing: { after: 80 } }));
        break;
      }
      case 'horizontalRule': out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 1 } }, spacing: { before: 120, after: 160 } })); break;
      case 'table': out.push(table(n), new Paragraph({ children: [], spacing: { after: 80 } })); break;
      default: out.push(...blocks(n.content, ctx));
    }
  }
  return out;
}

function list(node: PMNode, level: number, instance: number, ctx: { quote?: boolean }): Block[] {
  const out: Block[] = [];
  const ordered = node.type === 'orderedList', task = node.type === 'taskList';
  for (const item of node.content ?? []) {
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
        out.push(...list(child, Math.min(level + 1, 4), child.type === 'orderedList' ? ++orderedInstance : 0, ctx));
        continue;
      }
      const kids = inline(child.content);
      const lead = task && first ? [new TextRun({ text: item.attrs?.checked ? '☑ ' : '☐ ' })] : [];
      out.push(new Paragraph({
        children: [...lead, ...kids], spacing: { after: 60 },
        ...(first && !task ? { numbering: { reference: ordered ? 'numbers' : 'bullets', level, ...(ordered ? { instance } : {}) } } : { indent: { left: 360 * (level + 1) + (task ? 0 : 360) } }),
        ...(task && first ? { indent: { left: 360 * (level + 1), hanging: 0 } } : {}),
      }));
      first = false;
    }
  }
  return out;
}

function table(node: PMNode): Table {
  const rows = (node.content ?? []).filter(r => r.type === 'tableRow');
  const cols = Math.max(1, ...rows.map(r => (r.content ?? []).length));
  const edge = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge },
    rows: rows.map(r => new TableRow({
      children: Array.from({ length: cols }, (_, i) => {
        const c = (r.content ?? [])[i];
        const head = c?.type === 'tableHeader';
        const inner = blocks(c?.content);
        return new TableCell({
          width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          shading: head ? { type: ShadingType.CLEAR, fill: 'F3F4F6' } : undefined,
          children: inner.length ? inner : [new Paragraph({ children: [] })],
        });
      }),
    })),
  });
}

/** Width / height of a PNG, read from its header (the letterhead logo). */
function pngSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 24 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

export async function docToDocx(doc: PMNode, title: string, opts: { letterhead?: boolean } = {}): Promise<Uint8Array> {
  orderedInstance = 0;
  const body = blocks(prepForExport(doc).content);
  const levels = (fmt: typeof LevelFormat.BULLET | typeof LevelFormat.DECIMAL) => Array.from({ length: 5 }, (_, level) => ({
    level, format: fmt, text: fmt === LevelFormat.BULLET ? ['•', '◦', '▪', '•', '◦'][level] : `%${level + 1}.`, alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
  }));
  // (Each numbered list gets its own `instance`, so every list starts again at 1.)
  const numbering = {
    config: [
      { reference: 'bullets', levels: levels(LevelFormat.BULLET) },
      { reference: 'numbers', levels: levels(LevelFormat.DECIMAL) },
    ],
  };

  let headers: Record<string, Header> | undefined, footers: Record<string, Footer> | undefined;
  if (opts.letterhead) {
    const logo = await letterheadLogo();
    const dims = logo ? pngSize(logo) : null;
    const lw = 300, lh = dims ? Math.round((dims.h / dims.w) * lw) : 90;
    const center = (text: string, size: number, extra: { italics?: boolean; color?: string } = {}) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text, size, font: 'Times New Roman', ...extra })] });
    headers = {
      first: new Header({
        children: [
          ...(logo ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new ImageRun({ type: 'png', data: logo, transformation: { width: lw, height: lh }, altText: { title: 'CRECO', description: 'CRECO Commercial Real Estate Company', name: 'logo' } })] })] : []),
          center(LETTERHEAD.contact.replace(/\s{2,}/g, '  '), 16, { color: '5B6068' }),
          new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: RULE, space: 1 } }, spacing: { after: 120 } }),
        ],
      }),
      default: new Header({ children: [new Paragraph({ children: [] })] }),
    };
    const foot = () => new Footer({
      children: [
        new Paragraph({ children: [], border: { top: { style: BorderStyle.SINGLE, size: 18, color: RULE, space: 4 } }, spacing: { after: 40 } }),
        center(LETTERHEAD.tagline, 17, { italics: true, color: '3B3B40' }),
        center(LETTERHEAD.footContact.replace(/\s{2,}/g, '  '), 15, { color: '5B6068' }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 14, color: '9CA3AF' })] }),
      ],
    });
    footers = { first: foot(), default: foot() };
  }

  const document = new Document({
    title: title || 'Document', creator: 'CRECO CRM',
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, font: FONT }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: FONT }, paragraph: { spacing: { before: 220, after: 110 }, keepNext: true } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: FONT }, paragraph: { spacing: { before: 180, after: 90 }, keepNext: true } },
      ],
    },
    numbering,
    sections: [{
      properties: { titlePage: !!opts.letterhead, page: { size: { width: 12240, height: 15840 }, margin: { top: 1300, bottom: opts.letterhead ? 1500 : 1300, left: 1300, right: 1300, header: 500, footer: 500 } } },
      headers, footers,
      children: body.length ? body : [new Paragraph({ children: [] })],
    }],
  });
  const blob = typeof window !== 'undefined' ? await Packer.toBlob(document) : null;
  return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array(await Packer.toBuffer(document));
}

export const docxName = (title: string) => `${(title || 'Document').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Document'}.docx`;
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
