// Regression test for the "Letter of Intent to Lease Ã¢Â€Â“ 6609 Blanco Rd." mojibake.
// Run:  npx tsx scripts/mime-header.test.ts
import assert from 'node:assert/strict';
import { attachmentParam, decodeHeader, encodeHeader, formatAddress, stripLineBreaks } from '../src/lib/mime-header';

const LOI_EN = 'Letter of Intent to Lease – 6609 Blanco Rd.';      // en dash U+2013 (what the CRM generates)
const LOI_EM = 'Letter of Intent to Lease — 6609 Blanco Rd.';      // em dash U+2014

for (const subject of [LOI_EN, LOI_EM, 'Propuesta para José Peña — Café', '[Copy] ' + LOI_EN]) {
  const enc = encodeHeader(subject);
  assert.match(enc, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=(\r\n =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=)*$/, 'encoded-word form');
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(enc), 'header is pure ASCII on the wire');
  for (const w of enc.split('\r\n ')) assert.ok(w.length <= 75, `encoded-word ≤ 75 chars (got ${w.length})`);
  assert.equal(decodeHeader(enc), subject, 'decodes back to the original');
}
assert.equal(decodeHeader(encodeHeader(LOI_EM)).includes('\u2014'), true, 'em dash survives');
assert.equal(decodeHeader(encodeHeader(LOI_EM)).includes('Ã'), false, 'no mojibake');

// Long subjects split into several encoded-words without cutting a character in half.
const long = ('Résumé — ' + 'ñ'.repeat(80) + ' 😀 end');
assert.equal(decodeHeader(encodeHeader(long)), long);

// ASCII passes through untouched; line breaks can't inject headers.
assert.equal(encodeHeader('Plain subject'), 'Plain subject');
assert.equal(encodeHeader('Hi\r\nBcc: evil@example.com'), 'Hi Bcc: evil@example.com');
assert.equal(stripLineBreaks('a\nb'), 'a b');

// From display names: encoded when non-ASCII, quoted when ASCII with specials, bare otherwise.
assert.equal(formatAddress('Zachary Stovall', 'z@x.com'), 'Zachary Stovall <z@x.com>');
assert.equal(formatAddress('Stovall, Zachary', 'z@x.com'), '"Stovall, Zachary" <z@x.com>');
assert.equal(formatAddress(undefined, 'z@x.com'), 'z@x.com');
const from = formatAddress('José Peña', 'j@x.com');
assert.ok(from.endsWith(' <j@x.com>') && decodeHeader(from.replace(/ <.*$/, '')) === 'José Peña');

// Attachment filenames get an ASCII fallback plus the RFC 2231 form.
const att = attachmentParam('filename', 'Letter of Intent to Lease – 6609 Blanco Rd..pdf');
assert.ok(att.includes(`filename*=UTF-8''Letter%20of%20Intent%20to%20Lease%20%E2%80%93%206609%20Blanco%20Rd..pdf`), att);
assert.ok(att.startsWith('filename="Letter of Intent to Lease - 6609 Blanco Rd..pdf"'), att);
assert.equal(attachmentParam('name', 'a.pdf'), 'name="a.pdf"');

console.log('mime-header: all assertions passed');
