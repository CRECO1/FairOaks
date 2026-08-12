// Dev-only check: stamp every field's default onto the blank template using the
// SAME math as TransactionDocEditor.build() (Helvetica, size 11 * 0.85, x = fx*w+2,
// y = h - fy*h + 2), so the preview shows exactly what an agent downloads when they
// open the form and change nothing. Not part of the published template.
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

(async () => {
  const doc = await PDFDocument.load(fs.readFileSync(__dirname + '/loi_purchase.pdf'));
  const fields = JSON.parse(fs.readFileSync(__dirname + '/fields.json', 'utf8'));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pgs = doc.getPages();
  const SIZE = 11 * 0.85;
  let over = 0;
  for (const f of fields) {
    const pg = pgs[f.page - 1]; if (!pg) continue;
    const { width, height } = pg.getSize();
    const x = f.fx * width + 2;
    const y = height - f.fy * height + 2;
    const text = f.default || '';
    if (!text) continue;
    const w = font.widthOfTextAtSize(text, SIZE);
    if (w > f.fw * width + 1) { over++; console.warn('OVERFLOW', f.field_key, Math.round(w), '>', Math.round(f.fw * width)); }
    pg.drawText(text, { x, y, size: SIZE, font, color: rgb(0.06, 0.06, 0.1) });
  }
  fs.writeFileSync(__dirname + '/loi_purchase.preview.pdf', await doc.save());
  console.log('preview written · overflowing lines:', over);
})().catch(e => { console.error(e); process.exit(1); });
