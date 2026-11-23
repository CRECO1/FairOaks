// Run: npx tsx scripts/esign-prep.test.ts
// Guards E-Sign "Auto-place" (lib/esign-prep.ts) against the TREC commercial contract (TXR-1801):
//  - initials land in the page-footer blanks, one per party per page, none on the signature pages (14–15)
//  - two buyers / two sellers each get their own footer blank and signature block, in page order
//  - the signature block is page 14 (a sentence on page 8 that says "sign" once got picked as the buyer's signature line)
//  - printed name + title come with each signature; the title is optional
import fs from 'fs';
import { detectSigningSpots } from '../src/lib/esign-prep';

let bad = 0;
const check = (name: string, ok: boolean, extra = '') => { if (!ok) { bad++; console.error('FAIL', name, extra); } else console.log('ok  ', name); };

(async () => {
  const pdf = new Uint8Array(fs.readFileSync('forms_src/credocs/commercial_contract__improved_property__722_ts74350.pdf'));
  const one = await detectSigningSpots(pdf, ['seller', 'buyer'], { initials: true, signatures: true, dates: true, names: true });
  const of = (r: typeof one, type: string, role: string) => r.fields.filter(f => f.type === type && f.signerRole === role);
  check('initials: 13 pages each', of(one, 'initial', 'seller').length === 13 && of(one, 'initial', 'buyer').length === 13);
  check('initials: none on pages 14-15', one.fields.filter(f => f.type === 'initial').every(f => f.page <= 13));
  check('initials sit in the footer (low on the page)', one.fields.filter(f => f.type === 'initial').every(f => f.fy > 0.88));
  check('buyer signature is on page 14', of(one, 'signature', 'buyer').length === 1 && of(one, 'signature', 'buyer')[0].page === 14);
  check('seller signature is on page 14', of(one, 'signature', 'seller').length === 1 && of(one, 'signature', 'seller')[0].page === 14);
  const title = of(one, 'text', 'buyer').find(f => f.label === 'Title');
  check('printed name + optional title for the buyer', of(one, 'text', 'buyer').some(f => f.label === 'Printed name') && !!title?.optional);

  const two = await detectSigningSpots(pdf, ['seller', 'seller', 'buyer', 'buyer'], { initials: true, signatures: true, dates: false, names: true });
  check('co-signers: a second initials blank each', of(two, 'initial', 'buyer').filter(f => f.slot === 1).length === 13 && of(two, 'initial', 'seller').filter(f => f.slot === 1).length === 13);
  const [b0, b1] = of(two, 'signature', 'buyer').sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  check('co-signers: second buyer signs in the second block (lower)', !!b0 && !!b1 && b1.fy > b0.fy);
  const dupes = two.fields.filter(f => f.type === 'initial' && f.slot === 1 && f.page === 1);
  check('co-signers: their initials do not sit on top of each other', dupes.length === 2 && dupes.every(a => dupes.every(b => a === b || Math.abs(a.fx - b.fx) > 0.03)));

  const solo = await detectSigningSpots(pdf, ['buyer'], { initials: true, signatures: true, dates: true, names: true });
  check('single signer: signature is the named Buyer block on page 14, not a guessed line earlier', of(solo, 'signature', 'buyer').length === 1 && of(solo, 'signature', 'buyer')[0].page === 14);

  // A block that names no party (TXR-1939 termination notice): given to the signers in printed order, not a guessed spot at the foot of the page.
  const term = await detectSigningSpots(new Uint8Array(fs.readFileSync('forms_src/credocs/commercial_contract_termination_notice__12610_ts77997.pdf')), ['seller', 'buyer'], { initials: false, signatures: true, dates: true, names: true });
  const ts = term.fields.filter(f => f.type === 'signature');
  check('unnamed blocks: both signers get a printed block (not the bottom-of-page guess)', ts.length === 2 && ts.every(f => !f.guess && f.fy > 0.7 && f.fy < 0.88), JSON.stringify(ts.map(f => f.fy)));
  check('unnamed blocks: the assumption is said out loud', term.warnings.some(w => /assumed/.test(w)));
  check('unnamed blocks: the Date on the Title line is found', term.fields.filter(f => f.type === 'date' && !f.guess).length === 2);

  // Sublessor / Sublessee are the landlord / tenant sides.
  const sub = await detectSigningSpots(new Uint8Array(fs.readFileSync('forms_src/credocs/commercial_sublease__722_ts38439.pdf')), ['landlord', 'client'], { initials: true, signatures: true, dates: true, names: true });
  check('sublease: signature blocks named by Sublessor / Sublessee are found', sub.fields.filter(f => f.type === 'signature' && !f.guess).length === 2);

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
