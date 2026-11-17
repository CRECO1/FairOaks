// Run: npx tsx scripts/safe-object-name.test.ts
// Guards the upload bug of 2026-11-17: a name like "Smith Inc..pdf" passed the presign step and then failed the
// confirm step. Every filename must produce an object name that every confirm check accepts.
import { safeObjectName } from '../src/lib/safe-object-name';
import { newAttachmentPath, ownsAttachmentPath } from '../src/lib/copilot-attachments';

const names = [
  'Smith Holdings Inc..pdf', 'a..b..c.pdf', '...', '..', '.', '.pdf', '..pdf', '....docx', '', '   ', 'file.', 'x'.repeat(400) + '.pdf',
  '../../etc/passwd', 'a/b\\c.pdf', 'résumé – final (v2).docx', '契約書.pdf', '😀.png', 'Lease_(1)..xlsx', 'name with spaces .pdf',
  '-leading-dash.pdf', '__init__.pdf', 'Bid Proposal #2 & Co..pdf', 'IMG_0001.HEIC', 'a'.repeat(300), 'tab\tnew\nline.pdf',
];
let bad = 0;
for (const n of names) {
  const s = safeObjectName(n);
  const ok = s.length > 0 && s.length <= 120 && !s.includes('..') && !s.includes('/') && !s.includes('\\') && /^[A-Za-z0-9._-]+$/.test(s) && !/^[._-]+$/.test(s);
  // The checks the confirm routes run on a path built from it:
  const dealPath = `deal-1/${Date.now()}_${s}`, objectName = dealPath.slice('deal-1/'.length);
  const drivePath = `commercial/123e4567-e89b-12d3-a456-426614174000/${s}`;
  const driveOk = /^commercial\/([0-9a-f-]{36})\/([^/]+)$/i.exec(drivePath) && !s.includes('..');
  const dealOk = objectName && !objectName.includes('/') && !objectName.includes('..');
  // Secure folders: objectName = path minus 'req-<id>/', must have no '/' or '..'. Copilot: ownsAttachmentPath must accept it.
  const secureObj = `${Date.now()}_ab12cd34_${safeObjectName(n, 100)}`;
  const secureOk = !secureObj.includes('/') && !secureObj.includes('..');
  const att = newAttachmentPath('user-1', n);
  const copilotOk = ownsAttachmentPath('user-1', att.path);
  if (!ok || !driveOk || !dealOk || !secureOk || !copilotOk) { bad++; console.log('FAIL', JSON.stringify(n.slice(0, 40)), '->', JSON.stringify(s)); }
}
if (safeObjectName('Smith Inc..pdf') !== 'Smith_Inc.pdf') { bad++; console.log('FAIL expected Smith_Inc.pdf'); }
if (!safeObjectName('x'.repeat(400) + '.pdf').endsWith('.pdf')) { bad++; console.log('FAIL long name lost its extension'); }
console.log(bad ? `${bad} FAILED` : `all ${names.length + 2} checks passed`);
process.exit(bad ? 1 : 0);
