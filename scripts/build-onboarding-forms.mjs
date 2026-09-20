/**
 * Turn the broker's two onboarding .docx files into e-signable CRM forms:
 *
 *   CRECO_Independent_Contractor_Agreement.docx
 *   CRECO_Brokerage_Policies_and_Procedures_Manual.docx
 *
 * These are legal instruments the broker supplied. The text is reproduced
 * VERBATIM — every word, in order, exactly as written. This script never
 * rewrites, summarises or "cleans up" a single clause, and it verifies that
 * promise at the end by extracting the text back out of the PDF it produced
 * and diffing it against the .docx word-for-word. A mismatch aborts the run.
 *
 * Why it re-renders rather than converting: this machine has no LibreOffice,
 * Word or pandoc, so there is no way to convert the .docx directly. Instead it
 * reads the paragraphs, runs and justification out of the .docx XML and lays
 * them out in Times at 10pt on Letter with the document's own margins — the
 * same typeface, size and page geometry Word would use. Laying it out here has
 * a second payoff: the script knows exactly where every fill-in blank lands, so
 * the CRM field coordinates are computed, not eyeballed.
 *
 * Field coordinates follow the convention in lib/esign.ts: x/y/w are fractions
 * of the page, y measured from the TOP, and y is the field's BASELINE (the
 * printed underline), because that is where stampSignerFields draws.
 *
 * Nothing is sent. This only builds the templates; the broker sends each
 * envelope himself from the CRM.
 *
 * Usage: node scripts/build-onboarding-forms.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const SRC_DIR = '/Users/creco/Documents/CRECO/Onboarding';
const OUT_DIR = path.join(SRC_DIR, 'generated');

// Letter, and the margins declared in the .docx (twips ÷ 20 = points).
const PAGE = { w: 612, h: 792 };
const MARGIN = { top: 1000 / 20, right: 1080 / 20, bottom: 820 / 20, left: 1080 / 20 };
const BODY_W = PAGE.w - MARGIN.left - MARGIN.right;
const FONT_SIZE = 10;          // w:sz 20 half-points
const LEADING = 13.2;
const PARA_GAP = 6;

// ── .docx reading ───────────────────────────────────────────────────────────

function unzipDocx(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));
  execFileSync('unzip', ['-o', '-q', file, '-d', dir]);
  return dir;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');     // last, so "&amp;lt;" survives correctly
}

/**
 * Paragraphs as { align, runs: [{ text, bold }] }.
 * Tabs become a single space and <w:br/> a space — neither carries meaning in
 * these two documents, and collapsing them keeps the verbatim check honest.
 */
function readParagraphs(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const body = xml.slice(xml.indexOf('<w:body>'), xml.indexOf('</w:body>'));
  const paraXml = body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? [];
  const out = [];
  for (const p of paraXml) {
    const alignM = p.match(/<w:jc w:val="([^"]+)"/);
    const align = alignM ? alignM[1] : 'left';
    const runs = [];
    for (const r of p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []) {
      const rPr = (r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) ?? [''])[0];
      const bold = /<w:b\/>|<w:b /.test(rPr);
      let text = '';
      for (const piece of r.match(/<w:tab\/>|<w:br\/>|<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) ?? []) {
        if (piece === '<w:tab/>' || piece === '<w:br/>') { text += ' '; continue; }
        text += decodeXmlEntities(piece.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, ''));
      }
      if (text) runs.push({ text, bold });
    }
    out.push({ align, runs });
  }
  return out;
}

/** The document's text, normalised for comparison: collapse whitespace. */
function paragraphsToText(paras) {
  return paras
    .map(p => p.runs.map(r => r.text).join(''))
    .join('\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

// ── Layout ──────────────────────────────────────────────────────────────────

const BLANK_RE = /_{3,}/;

/** Split runs into words that remember their own bold flag. */
function runsToWords(runs) {
  const words = [];
  for (const run of runs) {
    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { words.push({ space: true, bold: run.bold }); continue; }
      words.push({ text: part, bold: run.bold });
    }
  }
  // Collapse runs of spaces to single separators.
  const out = [];
  for (const w of words) {
    if (w.space) { if (out.length && !out[out.length - 1].space) out.push(w); }
    else out.push(w);
  }
  while (out.length && out[0].space) out.shift();
  while (out.length && out[out.length - 1].space) out.pop();
  return out;
}

class Renderer {
  constructor(pdf, fonts, logoPng, footerText) {
    this.pdf = pdf;
    this.fonts = fonts;                 // { reg, bold }
    this.logoPng = logoPng;
    this.footerText = footerText;
    this.blanks = [];                   // { page, x, y, w, context }
    this.pageIndex = 0;
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE.w, PAGE.h]);
    this.pageIndex += 1;
    this.y = PAGE.h - MARGIN.top;
  }

  /**
   * Footers are drawn after the body, because Word's footer carries PAGE and
   * NUMPAGES field codes — which extract as empty text — and the total is not
   * known until the last page exists.
   */
  drawFooters() {
    if (!this.footerText) return;
    // Word's footer ends in "Page  of " (PAGE + NUMPAGES) or just "Page "
    // (PAGE alone); reproduce whichever the document actually asked for.
    const withTotal = /Page\s+of\s*$/i.test(this.footerText);
    const base = this.footerText.replace(/\s*Page(\s+of)?\s*$/i, '').trim();
    const pages = this.pdf.getPages();
    pages.forEach((pg, i) => {
      const size = 7.5;
      const line = withTotal
        ? `${base}    Page ${i + 1} of ${pages.length}`
        : `${base}    Page ${i + 1}`;
      const w = this.fonts.reg.widthOfTextAtSize(line, size);
      pg.drawText(line, {
        x: (PAGE.w - w) / 2, y: MARGIN.bottom - 16, size,
        font: this.fonts.reg, color: rgb(0.47, 0.47, 0.47),
      });
    });
  }

  ensure(space) {
    if (this.y - space < MARGIN.bottom) this.newPage();
  }

  font(bold) { return bold ? this.fonts.bold : this.fonts.reg; }

  width(word) { return this.font(word.bold).widthOfTextAtSize(word.text, FONT_SIZE); }

  /** Draw one word, recording any underscore blank inside it. */
  drawWord(word, x, baseline, context) {
    const font = this.font(word.bold);
    this.page.drawText(word.text, { x, y: baseline, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
    const m = word.text.match(BLANK_RE);
    if (m) {
      const prefix = word.text.slice(0, m.index);
      const dx = font.widthOfTextAtSize(prefix, FONT_SIZE);
      const bw = font.widthOfTextAtSize(m[0], FONT_SIZE);
      this.blanks.push({
        page: this.pageIndex,
        x: (x + dx) / PAGE.w,
        // Baseline from the top, matching lib/esign.ts.
        y: (PAGE.h - baseline) / PAGE.h,
        w: bw / PAGE.w,
        context,
      });
    }
  }

  paragraph(para) {
    const words = runsToWords(para.runs);
    if (!words.length) { this.y -= LEADING; return; }

    const spaceW = this.fonts.reg.widthOfTextAtSize(' ', FONT_SIZE);
    const context = words.map(w => w.space ? ' ' : w.text).join('').trim();

    // Break into lines.
    const lines = [];
    let line = [], lineW = 0;
    for (const w of words) {
      if (w.space) { if (line.length) { line.push(w); lineW += spaceW; } continue; }
      const ww = this.width(w);
      if (lineW + ww > BODY_W && line.length) {
        while (line.length && line[line.length - 1].space) { line.pop(); lineW -= spaceW; }
        lines.push({ words: line, width: lineW });
        line = [w]; lineW = ww;
      } else {
        line.push(w); lineW += ww;
      }
    }
    if (line.length) {
      while (line.length && line[line.length - 1].space) { line.pop(); lineW -= spaceW; }
      lines.push({ words: line, width: lineW });
    }

    lines.forEach((ln, i) => {
      this.ensure(LEADING);
      const baseline = this.y - FONT_SIZE;
      const isLast = i === lines.length - 1;
      const gaps = ln.words.filter(w => w.space).length;

      let x = MARGIN.left;
      let extra = 0;
      if (para.align === 'center') x = MARGIN.left + (BODY_W - ln.width) / 2;
      else if (para.align === 'right') x = MARGIN.left + (BODY_W - ln.width);
      else if (para.align === 'both' && !isLast && gaps > 0) extra = (BODY_W - ln.width) / gaps;

      for (const w of ln.words) {
        if (w.space) { x += spaceW + extra; continue; }
        this.drawWord(w, x, baseline, context);
        x += this.width(w);
      }
      this.y -= LEADING;
    });
    this.y -= PARA_GAP;
  }

  logo(widthPt = 150) {
    if (!this.logoPng) return;
    const img = this.logoPng;
    const h = (img.height / img.width) * widthPt;
    this.ensure(h + 6);
    this.page.drawImage(img, { x: (PAGE.w - widthPt) / 2, y: this.y - h, width: widthPt, height: h });
    this.y -= h + 6;
  }
}

// ── Verbatim check ──────────────────────────────────────────────────────────

async function pdfText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out += tc.items.map(it => it.str).join(' ') + ' ';
  }
  return out;
}

/** Compare ignoring all whitespace — line breaks differ, words must not. */
function assertVerbatim(label, sourceText, renderedText, footerText) {
  const strip = s => s.replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
  let rendered = strip(renderedText);
  // The page footer repeats on every page and is not body text.
  if (footerText) {
    const base = strip(footerText.replace(/\s*Page(\s+of)?\s*$/i, ''));
    if (base) {
      const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Only strip the footer where it is FOLLOWED by the page number. The
      // manual's own acknowledgment text contains its title word-for-word
      // ("I have received the CRECO Brokerage Policies and Procedures
      // Manual."), and a bare match would delete that body sentence and hide
      // a real discrepancy.
      rendered = rendered.replace(new RegExp(`${esc}\\s*Page \\d+( of \\d+)?`, 'g'), ' ');
    }
    rendered = strip(rendered);
  }
  const src = strip(sourceText).replace(/\s+/g, '');
  const got = rendered.replace(/\s+/g, '');
  if (src !== got) {
    let i = 0;
    while (i < Math.min(src.length, got.length) && src[i] === got[i]) i++;
    throw new Error(
      `${label}: rendered text does not match the .docx VERBATIM.\n` +
      `  first difference at char ${i}\n` +
      `  docx: …${src.slice(Math.max(0, i - 60), i + 60)}…\n` +
      `  pdf : …${got.slice(Math.max(0, i - 60), i + 60)}…`,
    );
  }
  console.log(`  ✓ verbatim check passed (${src.length} chars matched exactly)`);
}

// ── Build one document ──────────────────────────────────────────────────────

async function buildDoc({ srcFile, outFile, label, logoWidth, startAt = 0 }) {
  console.log(`\n${label}`);
  const dir = unzipDocx(srcFile);
  const paras = readParagraphs(path.join(dir, 'word/document.xml'));
  const sourceText = paragraphsToText(paras);

  // Footer text, if the .docx has one.
  let footerText = '';
  const footerPath = path.join(dir, 'word/footer1.xml');
  if (fs.existsSync(footerPath)) {
    const fx = fs.readFileSync(footerPath, 'utf8');
    footerText = decodeXmlEntities((fx.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) ?? [])
      .map(t => t.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, '')).join('')).trim();
  }

  const pdf = await PDFDocument.create();
  const fonts = {
    reg: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
  };

  const mediaDir = path.join(dir, 'word/media');
  let logo = null;
  if (fs.existsSync(mediaDir)) {
    const png = fs.readdirSync(mediaDir).find(f => f.toLowerCase().endsWith('.png'));
    if (png) logo = await pdf.embedPng(fs.readFileSync(path.join(mediaDir, png)));
  }

  const r = new Renderer(pdf, fonts, logo, footerText);
  if (logo) r.logo(logoWidth);
  for (const p of paras.slice(startAt)) r.paragraph(p);
  r.drawFooters();

  pdf.setTitle(label);
  pdf.setAuthor('CRECO, Commercial Real Estate Company');
  pdf.setSubject('Agent onboarding — reproduced verbatim from the broker-supplied .docx');
  pdf.setProducer('build-onboarding-forms.mjs (pdf-lib)');

  const bytes = await pdf.save();
  assertVerbatim(label, sourceText, await pdfText(bytes), footerText);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, outFile), bytes);
  console.log(`  wrote ${path.join(OUT_DIR, outFile)} (${pdf.getPageCount()} pages, ${(bytes.length / 1024).toFixed(0)} KB)`);
  console.log(`  blanks found: ${r.blanks.length}`);
  return { blanks: r.blanks, pages: pdf.getPageCount(), file: path.join(OUT_DIR, outFile) };
}

// ── Run ─────────────────────────────────────────────────────────────────────

const ica = await buildDoc({
  srcFile: path.join(SRC_DIR, 'CRECO_Independent_Contractor_Agreement.docx'),
  outFile: 'CRECO_Independent_Contractor_Agreement.pdf',
  label: 'CRECO Independent Contractor Agreement',
  logoWidth: 150,
  startAt: 1,   // first paragraph is the empty one holding the logo
});

const manual = await buildDoc({
  srcFile: path.join(SRC_DIR, 'CRECO_Brokerage_Policies_and_Procedures_Manual.docx'),
  outFile: 'CRECO_Brokerage_Policies_and_Procedures_Manual.pdf',
  label: 'CRECO Brokerage Policies and Procedures Manual',
  logoWidth: 150,
  startAt: 1,
});

fs.writeFileSync(
  path.join(OUT_DIR, 'blanks.json'),
  JSON.stringify({ ica: ica.blanks, manual: manual.blanks }, null, 2),
);
console.log(`\nblank map → ${path.join(OUT_DIR, 'blanks.json')}`);
