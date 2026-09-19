/**
 * Generate the Fair Oaks Realty Group "Information About Brokerage Services"
 * (TREC IABS) notice.
 *
 * This is a compliance document, so the script is built to make it impossible to
 * retype or guess anything that matters:
 *
 *   - The statutory text comes from TREC's own blank IABS 1-2 PDF, untouched. The
 *     script only adds field values on top. The blank's SHA-256 is pinned so a
 *     different file can never be substituted silently.
 *   - The firm name, firm licence, designated broker and broker licence are READ
 *     OUT OF the brokerage's real IABS (compliance/iabs/source/
 *     CRECO-iabs-current-IABS-1-0.pdf) at run time — not typed here — and the run
 *     aborts if the source doesn't contain exactly what is expected.
 *   - Only the contact email and phone are changed, to Fair Oaks' own.
 *
 * WHY THE CURRENT FORM AND NOT THE SOURCE'S FORM
 * The brokerage's existing IABS is TREC form IABS 1-0 (11/2/2015). TREC has
 * superseded it with IABS 1-2 (11-03-2025) — IABS 1-0 is no longer published —
 * and 1-2 adds the "WRITTEN AGREEMENTS ARE REQUIRED IN CERTAIN SITUATIONS"
 * section (Tex. Occ. Code §1101.563) and the "fees are not set by law and are
 * fully negotiable" statements, which bear directly on residential buyers.
 *
 * ASSUMED NAME
 * IABS 1-2's firm field is "Name of Sponsoring Broker (Licensed Individual or
 * Business Entity)". Nothing we hold confirms that "Fair Oaks Realty Group" is a
 * registered assumed name under TREC #9014367, so it is NOT asserted: in DRAFT
 * mode the field carries the entity name exactly as the source prints it, marked
 * with a dagger, and a visible banner explains the open question. FINAL mode
 * refuses to run until that is resolved.
 *
 * THE LITERAL VARIANT
 * The run also writes the brokerage's own IABS 1-0 with only the contact email and
 * phone swapped (white-out + redraw in the source's own position, colour and
 * weight; the field rules underneath are redrawn at their exact coordinates).
 * Everything else — including the zipForm footer — is left byte-for-byte as the
 * source has it. It is produced because it was asked for; it is marked
 * SUPERSEDED because TREC no longer publishes IABS 1-0.
 *
 * Usage:
 *   node scripts/generate-fair-oaks-iabs.mjs            # DRAFT (review copy)
 *   node scripts/generate-fair-oaks-iabs.mjs --final    # refuses until DBA confirmed
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument, PDFName, PDFArray, StandardFonts, rgb } = require('pdf-lib');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC_DIR = path.join(ROOT, 'compliance/iabs/source');
const SOURCE_IABS = path.join(SRC_DIR, 'CRECO-iabs-current-IABS-1-0.pdf');
const TREC_BLANK = path.join(SRC_DIR, 'TREC-IABS-1-2-blank-2025-11-03.pdf');
const TREC_BLANK_SHA256 = '5056930b66d237a7a4376db0c43f833929600f0b6e5ce6e42a417da824ef6b20';
const SOURCE_IABS_SHA256 = 'a34abff513945a0c97f8c40a76d64c8824dd02351f3e9f5a4ba463a75c38c14c';
const OUT_DIR = path.join(ROOT, 'compliance/iabs');

// The only two values this document changes relative to the source.
const FAIR_OAKS_EMAIL = 'info@fairoaksrealtygroup.com';
const FAIR_OAKS_PHONE = '(210) 390-9997';

// Unconfirmed — never printed as an assertion. See header.
const ASSUMED_NAME_CANDIDATE = 'Fair Oaks Realty Group';
const ASSUMED_NAME_CONFIRMED = false;

const FINAL = process.argv.includes('--final');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Pull the filled values out of the real IABS, by row, from its text layer. */
async function readSourceValues() {
  const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(SOURCE_IABS)), useSystemFonts: true }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const rows = new Map();
  for (const it of tc.items) {
    if (!it.str?.trim()) continue;
    const y = Math.round(it.transform[5]);
    const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ x: it.transform[4], s: it.str.trim() });
  }
  const sorted = [...rows].sort((a, b) => b[0] - a[0]).map(([y, items]) => ({ y, items: items.sort((a, b) => a.x - b.x) }));
  // The value row sits directly above its label row.
  const valuesAbove = (labelStart) => {
    const i = sorted.findIndex((r) => r.items[0]?.s.startsWith(labelStart));
    if (i < 1) throw new Error(`source IABS: label "${labelStart}" not found`);
    return sorted[i - 1].items.map((it) => it.s);
  };
  const firm = valuesAbove('Licensed Broker /Broker Firm Name');
  const broker = valuesAbove('Designated Broker of Firm');
  const formId = sorted.flatMap((r) => r.items.map((i) => i.s)).find((s) => /^IABS \d-\d/.test(s));
  return { firm, broker, formId };
}

async function main() {
  // ── 1. Pin the TREC blank ───────────────────────────────────────────────────
  const blankBytes = fs.readFileSync(TREC_BLANK);
  const blankHash = sha256(blankBytes);
  if (blankHash !== TREC_BLANK_SHA256) throw new Error(`TREC blank hash mismatch: ${blankHash}`);

  // ── 2. Lift the licence data from the real IABS ─────────────────────────────
  const sourceHash = sha256(fs.readFileSync(SOURCE_IABS));
  if (sourceHash !== SOURCE_IABS_SHA256) throw new Error(`source IABS hash mismatch: ${sourceHash}`);
  const src = await readSourceValues();
  const [firmName, firmLicense] = src.firm;
  const [brokerName, brokerLicense] = src.broker;
  // Refuse to proceed if the source is not shaped the way we expect.
  if (!firmName || !/^\d{6,7}$/.test(firmLicense ?? '')) throw new Error(`unexpected firm row: ${JSON.stringify(src.firm)}`);
  if (!brokerName || !/^\d{6,7}$/.test(brokerLicense ?? '')) throw new Error(`unexpected broker row: ${JSON.stringify(src.broker)}`);

  if (FINAL && !ASSUMED_NAME_CONFIRMED) {
    throw new Error('FINAL refused: the assumed-name question is unresolved. Confirm it with the broker first.');
  }

  // ── 3. Fill the current TREC form ───────────────────────────────────────────
  const pdf = await PDFDocument.load(blankBytes);
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.09, 0.28);
  const red = rgb(0.75, 0.05, 0.05);
  const SIZE = 9;

  // Column centres, measured from the IABS 1-2 blank's own label positions.
  const COL = { license: 242.2, email: 380.0, phone: 533.9 };
  const NAME_X = 31.0;
  const center = (text, cx, y, f = font, size = SIZE, color = ink) =>
    page.drawText(text, { x: cx - f.widthOfTextAtSize(text, size) / 2, y, size, font: f, color });

  // Value baselines sit just above each field's underline (y≈164 and y≈128).
  const ROW_FIRM = 167;
  const ROW_BROKER = 131;

  page.drawText(firmName, { x: NAME_X, y: ROW_FIRM, size: SIZE, font, color: ink });
  center(firmLicense, COL.license, ROW_FIRM);
  center(FAIR_OAKS_EMAIL, COL.email, ROW_FIRM);
  center(FAIR_OAKS_PHONE, COL.phone, ROW_FIRM);

  page.drawText(brokerName, { x: NAME_X, y: ROW_BROKER, size: SIZE, font, color: ink });
  center(brokerLicense, COL.license, ROW_BROKER);
  center(FAIR_OAKS_EMAIL, COL.email, ROW_BROKER);
  center(FAIR_OAKS_PHONE, COL.phone, ROW_BROKER);

  if (!FINAL) {
    // Dagger on the firm name, pointing at the open question.
    page.drawText('†', { x: NAME_X + font.widthOfTextAtSize(firmName, SIZE) + 1.5, y: ROW_FIRM + 3, size: 7, font: bold, color: red });
    // Review banner in the top margin, clear of the TREC logo, title and form date.
    page.drawText('DRAFT — FOR BROKER REVIEW. NOT FOR CLIENT USE.', { x: 27, y: 783, size: 7.5, font: bold, color: red });
    const note = `\u2020 PLACEHOLDER — Primary Assumed Business Name "${ASSUMED_NAME_CANDIDATE}" is NOT asserted: no document on file ` +
      `confirms it is registered under TREC #${firmLicense}. Broker to confirm before use.`;
    let noteSize = 6;
    while (font.widthOfTextAtSize(note, noteSize) > 490) noteSize -= 0.1;
    page.drawText(note, { x: 27, y: 774.5, size: noteSize, font, color: red });
  }

  pdf.setTitle('Information About Brokerage Services — Fair Oaks Realty Group');
  pdf.setSubject(`TREC IABS 1-2 (11-03-2025) · sponsoring broker TREC #${firmLicense} · ${FINAL ? 'FINAL' : 'DRAFT for broker review'}`);
  pdf.setProducer('Fair Oaks Realty Group — generated from the TREC IABS 1-2 blank (pdf-lib)');
  pdf.setCreator('scripts/generate-fair-oaks-iabs.mjs');

  const out = path.join(OUT_DIR, FINAL ? 'IABS-Fair-Oaks-Realty-Group.pdf' : 'IABS-Fair-Oaks-Realty-Group-DRAFT.pdf');
  const bytes = await pdf.save();
  fs.writeFileSync(out, bytes);

  const literal = FINAL ? null : await buildLiteralVariant(firmLicense);

  console.log(JSON.stringify({
    output: path.relative(ROOT, out),
    sha256: sha256(Buffer.from(bytes)),
    literalVariant: literal,
    form: 'TREC IABS 1-2 (11-03-2025)',
    trecBlankSha256: blankHash,
    sourceFormId: src.formId,
    copiedVerbatimFromSource: { firmName, firmLicense, brokerName, brokerLicense },
    changed: { email: FAIR_OAKS_EMAIL, phone: FAIR_OAKS_PHONE },
    assumedName: ASSUMED_NAME_CONFIRMED ? ASSUMED_NAME_CANDIDATE : 'UNCONFIRMED — placeholder only, not asserted',
    mode: FINAL ? 'FINAL' : 'DRAFT',
  }, null, 2));
}

/**
 * The source IABS 1-0 with only email + phone replaced, in both filled rows.
 *
 * zipForm wrote each filled value as its own BT…ET block in the page's last
 * content stream, positioned by a Tm at (x, -y) from the top-left. The four old
 * email/phone blocks are emptied — so the old values are gone from the text layer,
 * not merely painted over — and the new values are drawn at the same baseline,
 * size and colour (9pt, navy 0/0/.502), centred in their field as the source's
 * are. Nothing else in the stream is touched.
 */
async function buildLiteralVariant(firmLicense) {
  const pdf = await PDFDocument.load(fs.readFileSync(SOURCE_IABS));
  const page = pdf.getPage(0);
  // The source values are set in Arial-BoldMT. Embed the same face when the
  // machine has it so the new values match in every viewer; Helvetica-Bold has
  // identical metrics and is the fallback.
  const ARIAL_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
  let valueFont;
  if (fs.existsSync(ARIAL_BOLD)) {
    pdf.registerFontkit(require('@pdf-lib/fontkit'));
    valueFont = await pdf.embedFont(fs.readFileSync(ARIAL_BOLD), { subset: true });
  } else {
    valueFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  }
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0, 0, 0.501961);
  const red = rgb(0.75, 0.05, 0.05);

  // ── Remove the old email/phone text-show operations ──────────────────────
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const OLD_VALUE = /(1\.00 \.00 \.00 1\.00 (?:357\.624|505\.008) -(?:579\.1885|612\.1644)  Tm\s*)\((?:[^()\\]|\\.)*\)'/g;
  let removed = 0;
  for (const ref of refs) {
    const stream = pdf.context.lookup(ref);
    const text = zlib.inflateSync(Buffer.from(stream.contents), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1');
    const hits = text.match(OLD_VALUE)?.length ?? 0;
    if (!hits) continue;
    removed += hits;
    pdf.context.assign(ref, pdf.context.flateStream(Buffer.from(text.replace(OLD_VALUE, "$1()'"), 'latin1')));
  }
  if (removed !== 4) throw new Error(`expected to remove 4 old email/phone values, removed ${removed}`);

  // ── Draw the new values in the vacated positions ──────────────────────────
  const FIELDS = { email: [311, 486], phone: [493.488, 576] };   // field rules' x-extent
  for (const baseline of [212.81, 179.84]) {                        // firm row, designated-broker row
    for (const [key, [x0, x1]] of Object.entries(FIELDS)) {
      const text = key === 'email' ? FAIR_OAKS_EMAIL : FAIR_OAKS_PHONE;
      const w = valueFont.widthOfTextAtSize(text, 9);
      page.drawText(text, { x: (x0 + x1) / 2 - w / 2, y: baseline, size: 9, font: valueFont, color: navy });
    }
  }

  // Placeholder for the assumed name: a dagger on the firm field, explained in
  // the top margin. The printed firm name itself is untouched.
  // The firm name's measured width in the source is 171.9pt.
  page.drawText('\u2020', { x: 36 + 171.9 + 1.5, y: 216, size: 7, font: bold, color: red });
  const lines = [
    [`DRAFT — FOR BROKER REVIEW. NOT FOR CLIENT USE.  SUPERSEDED FORM: TREC replaced IABS 1-0 with IABS 1-2 (11-03-2025).`, bold, 7],
    [`\u2020 PLACEHOLDER — Primary Assumed Business Name "${ASSUMED_NAME_CANDIDATE}" is NOT asserted: no document on file confirms it is`, font, 6.5],
    [`registered under TREC #${firmLicense}. Broker to confirm. The zipForm footer below is reproduced unchanged from the source.`, font, 6.5],
  ];
  let y = 782;
  for (const [t, f, size] of lines) { page.drawText(t, { x: 36, y, size, font: f, color: red }); y -= 8.5; }

  pdf.setTitle('Information About Brokerage Services (IABS 1-0, SUPERSEDED) — Fair Oaks Realty Group');
  pdf.setSubject(`TREC IABS 1-0 (11/2/2015, superseded) · TREC #${firmLicense} · DRAFT for broker review`);
  pdf.setCreator('scripts/generate-fair-oaks-iabs.mjs');

  const out = path.join(OUT_DIR, 'IABS-1-0-SUPERSEDED-Fair-Oaks-Realty-Group-DRAFT.pdf');
  const bytes = await pdf.save();
  fs.writeFileSync(out, bytes);
  return { output: path.relative(ROOT, out), sha256: sha256(Buffer.from(bytes)), form: 'TREC IABS 1-0 (11/2/2015) — superseded' };
}

main().catch((e) => { console.error('[iabs] FAILED:', e.message); process.exit(1); });
