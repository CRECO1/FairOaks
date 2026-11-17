// Run: npx tsx scripts/upload-rules.test.ts
// The shared pre-check every upload screen runs in the browser before any bytes are sent.
import assert from 'node:assert/strict';
import { checkUpload, isHeic, UPLOAD_PROFILES } from '../src/lib/upload-rules';

const MB = 1024 * 1024;
for (const key of ['deal', 'contact', 'secure', 'drive', 'chat'] as const) {
  for (const name of ['a.pdf', 'A.PDF', 'b.docx', 'b.doc', 'c.xlsx', 'c.xls', 'd.csv', 'e.jpg', 'e.JPEG', 'f.png', 'g.webp', 'Smith Inc..pdf'])
    assert.equal(checkUpload({ name, size: 1000 }, key), null, `${key} should take ${name}`);
}
for (const name of ['p.ppt', 'p.pptx', 'n.txt', 'g.gif']) {
  assert.equal(checkUpload({ name, size: 5 }, 'drive'), null, `drive should take ${name}`);
  assert.match(checkUpload({ name, size: 5 }, 'deal') ?? '', /can’t go in a deal/, `deal should refuse ${name} with a plain message`);
}
assert.match(checkUpload({ name: 'x.exe', size: 5 }, 'secure') ?? '', /\.exe files can’t go in a secure folder\. Use PDF/);
assert.match(checkUpload({ name: 'noext', size: 5 }, 'deal') ?? '', /That file type can’t go in a deal/);
assert.match(checkUpload({ name: 'a.pdf', size: 0 }, 'deal') ?? '', /empty/);
assert.match(checkUpload({ name: 'big.pdf', size: 26 * MB }, 'deal') ?? '', /26\.0 MB.*25 MB/);
assert.equal(checkUpload({ name: 'ok.pdf', size: 25 * MB }, 'deal'), null);
assert.ok(isHeic({ name: 'IMG_1.HEIC' }) && isHeic({ name: 'x', type: 'image/heif' }) && !isHeic({ name: 'a.jpg', type: 'image/jpeg' }));
assert.equal(UPLOAD_PROFILES.deal.types.pdf, 'application/pdf');
console.log('upload-rules: all checks passed');
