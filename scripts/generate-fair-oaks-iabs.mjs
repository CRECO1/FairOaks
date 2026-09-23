/**
 * Generate the brokerage's two "Information About Brokerage Services" notices
 * (TREC IABS 1-2, 11-03-2025): one for Fair Oaks Realty Group, one for CRECO.
 *
 * Both are the same licensed firm (TREC #9014367) operating under two assumed
 * business names, which the broker confirmed on 2026-09-18: "one iabs should be
 * under Fair Oaks Realty Group and the other CRECO - Commercial Real Estate
 * Company, same lic number."
 *
 * This is a compliance document, so the script is built to make it impossible to
 * retype or guess anything that matters:
 *
 *   - The statutory text comes from TREC's own blank IABS 1-2 PDF, untouched. The
 *     script only adds field values on top. The blank's SHA-256 is pinned so a
 *     different file can never be substituted silently.
 *   - The firm licence, designated broker and broker licence are READ OUT OF the
 *     brokerage's real IABS (compliance/iabs/source/CRECO-iabs-current-IABS-1-0.pdf)
 *     at run time — not typed here — and the run aborts if the source doesn't
 *     contain exactly what is expected.
 *   - Only the firm name (the confirmed assumed business name), email and phone
 *     differ per brand, and they are set in BRANDS below.
 *
 * The source is TREC's superseded IABS 1-0; its values are carried onto the
 * current form, which adds the §1101.563 written-agreement section and the
 * "fees are not set by law and are fully negotiable" statements.
 *
 * Outputs (compliance/iabs/), plus a copy served by the Fair Oaks site:
 *   IABS-Fair-Oaks-Realty-Group.pdf  → public/legal/IABS-Fair-Oaks-Realty-Group.pdf
 *   IABS-CRECO.pdf                   (served by crecotx.com from its own repo)
 *
 * Usage: node scripts/generate-fair-oaks-iabs.mjs
 *        python3 scripts/subset-pdf-fonts.py <out.pdf> <out.pdf>   <-- REQUIRED
 *
 * ⚠️ The subset step is not optional. TREC's blank embeds twelve FULL TrueType
 * faces (~4.2 MB of font data, sub=no) and pdf-lib copies them through verbatim,
 * so the raw output is ~1.48 MB. Those files rendered as boxes in Chrome's PDF
 * viewer (PDFium) while rendering fine in poppler and the ChromeOS Gallery app.
 * The text is Identity-H, meaning the content stream holds raw GLYPH IDS — so if
 * a viewer fails to load the embedded face for any reason and substitutes a
 * system font, every code point maps to .notdef and the whole page becomes tofu.
 * That is the failure mode, and the fix is to make the embedded fonts small and
 * properly tagged rather than 4 MB and indistinguishable from full faces.
 *
 * subset-pdf-fonts.py keeps only the glyphs actually drawn, with retain_gids so
 * the GIDs the content stream references stay valid, and tags each BaseFont
 * "ABCDEF+Name" per PDF 32000-1 §9.6.4. Output drops to ~143 KB and renders
 * pixel-identically — verified by comparing rasterisations before and after.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC_DIR = path.join(ROOT, 'compliance/iabs/source');
const SOURCE_IABS = path.join(SRC_DIR, 'CRECO-iabs-current-IABS-1-0.pdf');
const SOURCE_IABS_SHA256 = 'a34abff513945a0c97f8c40a76d64c8824dd02351f3e9f5a4ba463a75c38c14c';
const TREC_BLANK = path.join(SRC_DIR, 'TREC-IABS-1-2-blank-2025-11-03.pdf');
const TREC_BLANK_SHA256 = '5056930b66d237a7a4376db0c43f833929600f0b6e5ce6e42a417da824ef6b20';
const OUT_DIR = path.join(ROOT, 'compliance/iabs');

// Per-brand values. Everything else on the form is shared and comes from the source.
const BRANDS = [
  {
    file: 'IABS-Fair-Oaks-Realty-Group.pdf',
    publicCopy: 'public/legal/IABS-Fair-Oaks-Realty-Group.pdf',
    firmName: 'Fair Oaks Realty Group',
    email: 'info@fairoaksrealtygroup.com',
    phone: '(210) 390-9997',
  },
  {
    file: 'IABS-CRECO.pdf',
    publicCopy: null,
    firmName: 'CRECO - Commercial Real Estate Company',
    email: 'info@crecotx.com',
    phone: '(210) 817-3443',
  },
];

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
  return { firm: valuesAbove('Licensed Broker /Broker Firm Name'), broker: valuesAbove('Designated Broker of Firm') };
}

async function build(brand, src, blankBytes) {
  const pdf = await PDFDocument.load(blankBytes);
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.06, 0.09, 0.28);
  const SIZE = 9;

  // Column centres, measured from the IABS 1-2 blank's own label positions.
  const COL = { license: 242.2, email: 380.0, phone: 533.9 };
  const NAME_X = 31.0;
  const center = (text, cx, y) =>
    page.drawText(text, { x: cx - font.widthOfTextAtSize(text, SIZE) / 2, y, size: SIZE, font, color: ink });

  // Value baselines sit just above each field's underline (y≈164 and y≈128).
  const ROW_FIRM = 167;
  const ROW_BROKER = 131;

  // The name field's rule ends at x≈201pt; a long assumed name ("CRECO - Commercial
  // Real Estate Company") is set a little smaller rather than run past it.
  const NAME_MAX_W = 201 - NAME_X - 2;
  let nameSize = SIZE;
  while (font.widthOfTextAtSize(brand.firmName, nameSize) > NAME_MAX_W && nameSize > 6.5) nameSize -= 0.25;
  page.drawText(brand.firmName, { x: NAME_X, y: ROW_FIRM, size: nameSize, font, color: ink });
  center(src.firmLicense, COL.license, ROW_FIRM);
  center(brand.email, COL.email, ROW_FIRM);
  center(brand.phone, COL.phone, ROW_FIRM);

  page.drawText(src.brokerName, { x: NAME_X, y: ROW_BROKER, size: SIZE, font, color: ink });
  center(src.brokerLicense, COL.license, ROW_BROKER);
  center(brand.email, COL.email, ROW_BROKER);
  center(brand.phone, COL.phone, ROW_BROKER);

  pdf.setTitle(`Information About Brokerage Services — ${brand.firmName}`);
  pdf.setSubject(`TREC IABS 1-2 (11-03-2025) · ${brand.firmName} · TREC #${src.firmLicense}`);
  pdf.setAuthor(brand.firmName);
  pdf.setProducer('Generated from the TREC IABS 1-2 blank (pdf-lib)');
  pdf.setCreator('scripts/generate-fair-oaks-iabs.mjs');

  const bytes = Buffer.from(await pdf.save());
  const out = path.join(OUT_DIR, brand.file);
  fs.writeFileSync(out, bytes);
  if (brand.publicCopy) {
    fs.mkdirSync(path.dirname(path.join(ROOT, brand.publicCopy)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, brand.publicCopy), bytes);
  }
  return { output: path.relative(ROOT, out), publicCopy: brand.publicCopy, sha256: sha256(bytes), firmName: brand.firmName, email: brand.email, phone: brand.phone };
}

async function main() {
  const blankBytes = fs.readFileSync(TREC_BLANK);
  const blankHash = sha256(blankBytes);
  if (blankHash !== TREC_BLANK_SHA256) throw new Error(`TREC blank hash mismatch: ${blankHash}`);
  const sourceHash = sha256(fs.readFileSync(SOURCE_IABS));
  if (sourceHash !== SOURCE_IABS_SHA256) throw new Error(`source IABS hash mismatch: ${sourceHash}`);

  const raw = await readSourceValues();
  const [, firmLicense] = raw.firm;
  const [brokerName, brokerLicense] = raw.broker;
  // Refuse to proceed if the source is not shaped the way we expect.
  if (!/^\d{6,7}$/.test(firmLicense ?? '')) throw new Error(`unexpected firm row: ${JSON.stringify(raw.firm)}`);
  if (!brokerName || !/^\d{6,7}$/.test(brokerLicense ?? '')) throw new Error(`unexpected broker row: ${JSON.stringify(raw.broker)}`);
  const src = { firmLicense, brokerName, brokerLicense };

  const outputs = [];
  for (const brand of BRANDS) outputs.push(await build(brand, src, blankBytes));
  console.log(JSON.stringify({ form: 'TREC IABS 1-2 (11-03-2025)', copiedFromSource: src, outputs }, null, 2));
}

main().catch((e) => { console.error('[iabs] FAILED:', e.message); process.exit(1); });
