// What a form PDF actually draws — the single source of truth for "is this still a form?".
//
// Both the auditor (which checks what is already published) and the publisher (which
// gates what is about to be) use this, so the two can never drift apart and disagree
// about whether a file is sound.
//
// The failure this exists to catch: an e-sign overlay whose underlying blank form has
// been deleted. dotloop, zipForm and DocuSign flatten a filled form by APPENDING a
// content stream that paints a white rectangle over each blank, draws the value, then
// redraws the underline. Strip the wrong stream and the overlay is what survives. The
// result still opens, still carries the letterhead, logos and the old values with their
// underlines, and is simply missing the form — which no byte-level or page-count check
// notices, because the file is structurally perfect.

import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFArray, PDFRawStream } from 'pdf-lib';

/** A page drawing fewer characters than this is not a form page. */
export const MIN_TEXT_CHARS = 350;
/** Enough white boxes to be an overlay hiding a form, not a stray design element. */
export const MIN_WHITE_FILLS = 3;

const decode = (stream) => {
  if (!stream) return '';
  try {
    const bytes = stream instanceof PDFRawStream ? stream.asUint8Array() : stream.getContents();
    try { return inflateSync(Buffer.from(bytes)).toString('latin1'); }
    catch { return Buffer.from(bytes).toString('latin1'); }
  } catch { return ''; }
};

/**
 * Count every glyph a content stream draws, in BOTH of PDF's string forms.
 *
 * TREC forms are CID-encoded and draw hex strings — <03ED> — not parenthesised ones,
 * so counting only (...) scores a complete healthy form at zero and reports it as
 * damage. Both forms are counted wherever they occur rather than only when anchored to
 * a Tj/TJ operator, since inside a TJ array they appear bare among kerning numbers.
 */
export function glyphCount(text) {
  let n = 0;
  for (const m of text.matchAll(/\((?:\\.|[^\\()])*\)/g)) n += Math.max(m[0].length - 2, 0);
  for (const m of text.matchAll(/<([0-9A-Fa-f\s]+)>/g)) n += Math.floor(m[1].replace(/\s/g, '').length / 2);
  return n;
}

/** What a single page draws. */
export function analysePage(pdf, page) {
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const text = refs.map((r) => decode(r && pdf.context.lookup(r))).join('\n');

  const textChars = glyphCount(text);
  const drawnStrings =
    (text.match(/\bTJ\b/g)?.length ?? 0) + (text.match(/\bTj\b/g)?.length ?? 0);

  // A white fill followed by a rectangle fill: painting over the blank.
  let whiteFills = 0;
  for (const _ of text.matchAll(/(?:1\s+1\s+1\s+rg|1\s+g)[\s\S]{0,200}?re\s*(?:f|F|f\*)\b/g)) whiteFills++;

  return { streams: refs.length, textChars, drawnStrings, whiteFills };
}

/**
 * DAMAGED — sparse text AND white fills: an overlay with the form removed.
 * REVIEW   — sparse text, no white fills: often a real signature page or exhibit, so
 *            it is surfaced for a human rather than called damage.
 */
export function verdictFor(pages) {
  const damaged = [];
  const thin = [];
  for (const [i, p] of pages.entries()) {
    if (p.textChars < MIN_TEXT_CHARS && p.whiteFills >= MIN_WHITE_FILLS) damaged.push(i + 1);
    else if (p.textChars < MIN_TEXT_CHARS) thin.push(i + 1);
  }
  if (damaged.length) return { status: 'DAMAGED', pages: damaged };
  if (thin.length) return { status: 'REVIEW', pages: thin };
  return { status: 'OK', pages: [] };
}

/** Analyse raw PDF bytes. Never throws — a file that will not parse is itself a verdict. */
export async function analysePdf(bytes) {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const pages = pdf.getPages().map((p) => analysePage(pdf, p));
    if (!pages.length) return { status: 'ERROR', detail: 'no pages', pageCount: 0, pages: [], flagged: [] };
    const v = verdictFor(pages);
    return { status: v.status, flagged: v.pages, pageCount: pages.length, pages };
  } catch (err) {
    return { status: 'ERROR', detail: err?.message ?? String(err), pageCount: 0, pages: [], flagged: [] };
  }
}

/** One line per page, for error messages and verbose output. */
export function describePages(pages) {
  return pages
    .map((p, i) => `  p${i + 1}: ${p.textChars} chars, ${p.drawnStrings} text ops, ${p.whiteFills} white fills, ${p.streams} stream(s)`)
    .join('\n');
}
