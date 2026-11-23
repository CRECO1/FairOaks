// Run: npx tsx scripts/esign-certificate.test.ts
// The executed copy: a certificate page with the document fingerprint, each signer's device/consent/what they placed, and no page overflow.
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'crypto';
import { buildExecutedParts, deviceOf } from '../src/lib/esign';
import { readPdfText } from '../src/lib/doc-text-edit';

let bad = 0;
const t = (name: string, ok: boolean, extra = '') => { if (!ok) { bad++; console.error('FAIL', name, extra); } else console.log('ok  ', name); };

(async () => {
  t('device: iPhone Safari', deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1') === 'iPhone · Safari');
  t('device: Mac Chrome', deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36') === 'Mac · Chrome');
  t('device: unknown', deviceOf(null) === 'unknown device');

  // a plain one-page PDF (the real TREC forms are owner-encrypted, which the certificate reader can't open)
  const blank = await PDFDocument.create(); blank.addPage([612, 792]);
  const src = await blank.save();
  const signers = Array.from({ length: 8 }, (_, i) => ({
    name: `Signer Number ${i + 1}`, email: `s${i + 1}@example.test`, role: i % 2 ? 'buyer' : 'seller', index: i + 1,
    signedAt: '2026-11-23T18:00:00Z', ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', consentAt: '2026-11-23T17:59:00Z', inPerson: i === 3, style: 'script',
  }));
  const sigFields = [{ page: 1, fx: 0.2, fy: 0.7, fw: 0.2, type: 'initial', signerIndex: 1 }, { page: 1, fx: 0.2, fy: 0.8, fw: 0.2, type: 'signature', signerIndex: 1 }];
  const { clean, full } = await buildExecutedParts(src, { docTitle: 'Test', envelopeId: 'env-1', signers, sigFields });
  const cleanPages = (await PDFDocument.load(clean, { ignoreEncryption: true })).getPageCount(), fullPages = (await PDFDocument.load(full, { ignoreEncryption: true })).getPageCount();
  t('certificate adds at least one page after the signed pages', fullPages > cleanPages);
  const pages = await readPdfText(full);
  const text = pages.slice(cleanPages).map(p => p.items.map(i => i.str).join(' ')).join(' ');
  const hash = createHash('sha256').update(Buffer.from(clean)).digest('hex');
  t('certificate carries the fingerprint of the signed document', text.includes(hash.slice(0, 32)) && text.includes(hash.slice(32)));
  t('certificate names the device and consent', /iPhone · Safari/.test(text) && /e-sign consent/.test(text));
  t('certificate says what signer 1 placed', /1 signature/.test(text) && /1 initials/.test(text));
  t('certificate says who signed in person', /in person/.test(text));
  t('all eight signers are on the certificate (no overflow off the page)', signers.every(s => text.includes(s.name)));
  console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
})();
