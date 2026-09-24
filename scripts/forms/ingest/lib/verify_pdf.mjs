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

/** Fill operators, and the path-ending operators that discard one instead. */
const FILL_OPS = new Set(['f', 'F', 'f*', 'b', 'b*', 'B', 'B*']);
const PATH_END_OPS = new Set(['n', 'S', 's']);
// A box has to be at least this big, in unscaled user units, to be hiding a form
// line. A page is 612x792, so this is roughly a third of an inch by a sixteenth.
const MIN_FILL_WIDTH = 20;
const MIN_FILL_HEIGHT = 4;

const allEqual = (nums, v) => nums.length > 0 && nums.every((n) => n === v);

/**
 * Count the white boxes a content stream paints over the page.
 *
 * This was a regex — white fill colour, then `re`, then a fill operator — and it
 * missed the defect entirely. `re` is only one of two ways to state a rectangle;
 * plenty of producers (pdf-lib, which our own e-sign path uses, among them) emit
 * the same box as an explicit path: `0 0 m  0 40 l  500 40 l  500 0 l  h  f`. A
 * six-box overlay scored zero, so a damaged form came back REVIEW rather than
 * DAMAGED, the auditor exited 0, and the publisher's gate waved through exactly
 * the file it exists to stop. Nothing about that was visible from reading the
 * regex; it took drawing a real overlay and watching it pass.
 *
 * So walk the stream instead: track the fill colour through q/Q the way a viewer
 * does, accumulate each path's bounding box, and count the fills that are white
 * and big enough to hide something. Small white marks (anti-aliasing slivers,
 * punctuation knocked out of a glyph) are not overlays and are skipped.
 */
export function countWhiteFills(text) {
  const token = /\[[^\]]*\]|\((?:\\.|[^\\()])*\)|<[^>]*>|\/[^\s\/\[\]<>(){}]*|[-+]?[0-9.]+|[A-Za-z'"][A-Za-z0-9'"*]*/g;

  let white = false;              // is the current fill colour white?
  const stack = [];               // q/Q graphics state, fill colour only
  let nums = [];                  // operands seen since the last operator
  let box = null;                 // current path's bounding box
  let count = 0;

  const extend = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!box) box = { x0: x, y0: y, x1: x, y1: y };
    else {
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
    }
  };

  for (const m of text.matchAll(token)) {
    const t = m[0];
    const c = t[0];
    if (c === '[' || c === '(' || c === '<' || c === '/') { nums = []; continue; }
    if ((c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.') {
      const n = Number(t);
      if (Number.isFinite(n)) nums.push(n);
      continue;
    }

    switch (t) {
      case 'q': stack.push(white); break;
      case 'Q': white = stack.length ? stack.pop() : false; break;

      // Fill colour. Grey 1, RGB 1 1 1 and CMYK 0 0 0 0 are all white.
      case 'g': white = allEqual(nums, 1); break;
      case 'rg': white = nums.length === 3 && allEqual(nums, 1); break;
      case 'k': white = nums.length === 4 && allEqual(nums, 0); break;
      case 'sc': case 'scn':
        white = nums.length === 4 ? allEqual(nums, 0) : allEqual(nums, 1);
        break;
      // A colourspace change resets the colour to that space's default: black.
      case 'cs': white = false; break;

      // Path construction.
      case 'm': case 'l':
        if (nums.length >= 2) extend(nums[nums.length - 2], nums[nums.length - 1]);
        break;
      case 'c':
        if (nums.length >= 6) for (let i = 0; i < 6; i += 2) extend(nums[i], nums[i + 1]);
        break;
      case 'v': case 'y':
        if (nums.length >= 4) for (let i = 0; i < 4; i += 2) extend(nums[i], nums[i + 1]);
        break;
      case 're':
        if (nums.length >= 4) {
          const [x, y, w, h] = nums.slice(-4);
          extend(x, y); extend(x + w, y + h);
        }
        break;
      case 'h': break;

      default:
        if (FILL_OPS.has(t)) {
          if (white && box &&
              box.x1 - box.x0 >= MIN_FILL_WIDTH &&
              box.y1 - box.y0 >= MIN_FILL_HEIGHT) count++;
          box = null;
        } else if (PATH_END_OPS.has(t)) {
          box = null;
        }
        break;
    }
    nums = [];
  }
  return count;
}

/** What a single page draws. */
export function analysePage(pdf, page) {
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const text = refs.map((r) => decode(r && pdf.context.lookup(r))).join('\n');

  const textChars = glyphCount(text);
  const drawnStrings =
    (text.match(/\bTJ\b/g)?.length ?? 0) + (text.match(/\bTj\b/g)?.length ?? 0);

  const whiteFills = countWhiteFills(text);

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
