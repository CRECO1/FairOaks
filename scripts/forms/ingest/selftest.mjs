// Self-test for lib/verify_pdf.mjs — run it after touching that file.
//
//   node scripts/forms/ingest/selftest.mjs
//
// There is no test runner in this repo, so this is a script: it builds its own
// fixtures with pdf-lib, asserts the verdicts, and exits non-zero on a failure.
//
// It exists because this checker has now been silently wrong twice, and both
// times the symptom was a healthy form being called damaged — which is the
// failure mode nobody chases, because the honest reaction is "the checker is
// being fussy" rather than "the checker is broken":
//
//   1. text inside a Form XObject was not counted at all, so a page whose whole
//      body is an imported template scored 0 characters;
//   2. /Contents given as an indirect reference to an array was treated as one
//      stream and decoded to nothing, so a seven-stream page scored 0 too.
//
// The second one cuts the other way as well, which is the real reason to guard
// it: a genuinely damaged page that reads as 0 chars AND 0 white fills is
// downgraded from DAMAGED to REVIEW, and REVIEW does not fail the build.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { analysePdf } from './lib/verify_pdf.mjs';

const cases = [];
const def = (name, expect, build) => cases.push({ name, expect, build });

// An e-sign overlay whose blank form was deleted: a few filled values, white
// boxes where the form's blanks used to be. This must stay DAMAGED.
def('overlay with the form deleted', 'DAMAGED', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const y of [700, 660, 620, 580]) page.drawRectangle({ x: 100, y, width: 300, height: 12, color: rgb(1, 1, 1) });
  for (const [i, v] of ['CRECO', '1353 W French Pl', '3', '09/06/2025'].entries()) {
    page.drawText(v, { x: 104, y: 702 - i * 40, size: 9, font });
  }
  return doc.save();
});

// Sparse but no white fills — a signature page or an exhibit. Surfaced for a
// human, never called damage.
def('genuinely thin exhibit page', 'REVIEW', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('Exhibit A', { x: 72, y: 720, size: 12, font });
  return doc.save();
});

// A healthy form whose text lives entirely in a Form XObject, the way a forms
// portal emits an imported template. Regression guard for defect 1.
def('form body inside a Form XObject', 'OK', async () => {
  const inner = await PDFDocument.create();
  const page = inner.addPage([612, 792]);
  const font = await inner.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 40; i++) {
    page.drawText(`Paragraph ${i}: the quick brown fox jumps over the lazy dog, repeatedly.`, { x: 60, y: 740 - i * 17, size: 9, font });
  }
  const host = await PDFDocument.create();
  const [tpl] = await host.embedPdf(await inner.save());
  host.addPage([612, 792]).drawPage(tpl, { x: 0, y: 0, width: 612, height: 792 });
  return host.save();
});

// /Contents as an indirect reference to an array of streams. Regression guard
// for defect 2 — this scored 0 chars / 1 stream before the fix.
def('/Contents is an indirect array', 'OK', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 40; i++) {
    page.drawText(`Line ${i}: the quick brown fox jumps over the lazy dog, repeatedly.`, { x: 60, y: 740 - i * 17, size: 9, font });
  }
  await doc.save();                       // force the content stream to be built
  const { PDFName } = await import('pdf-lib');
  // pdf-lib already stores /Contents as a DIRECT PDFArray, so the indirection is
  // made by registering that very array and pointing /Contents at the new ref.
  // (Wrapping it in another array instead produces an array-of-array, which is
  // simply a broken PDF — qpdf reports no content streams at all.)
  const array = page.node.get(PDFName.of('Contents'));
  page.node.set(PDFName.of('Contents'), doc.context.register(array));
  return doc.save();
});

let failed = 0;
for (const c of cases) {
  let got;
  try { got = (await analysePdf(await c.build())).status; }
  catch (err) { got = `threw: ${err.message}`; }
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${c.name} — expected ${c.expect}, got ${got}`);
}
console.log(`\n${cases.length} case(s), ${failed} failed`);
process.exit(failed ? 1 : 0);
