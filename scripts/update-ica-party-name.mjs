/**
 * Change the Broker's party name in the source Independent Contractor
 * Agreement .docx — and nothing else.
 *
 * Authorised by Zack on 2026-09-19: "put the llc with dba names on the
 * contractor agreements. iabs is fine", then extended to cover both brands —
 * the same LLC operates CRECO and Fair Oaks Realty Group under TREC #9014367.
 *
 * The party name is a single bold run in the opening paragraph, so this is one
 * substitution inside word/document.xml. Everything else — every clause, the
 * blanks, the signature block, the styling — is left byte-for-byte alone, and
 * the script proves it: it re-reads the rebuilt file and asserts that the only
 * difference from the original text is this one name.
 *
 * The assumed name is spelled the way the brokerage's IABS prints it
 * ("CRECO - Commercial Real Estate Company", spaced hyphen), because Zack said
 * the IABS is correct and should not change.
 *
 * The original is preserved at Onboarding/backups/ before anything is written.
 *
 * Usage: node scripts/update-ica-party-name.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const SRC = '/Users/creco/Documents/CRECO/Onboarding/CRECO_Independent_Contractor_Agreement.docx';
const BACKUP_DIR = '/Users/creco/Documents/CRECO/Onboarding/backups';

const OLD_NAME = 'CRECO, Commercial Real Estate Company';
const NEW_NAME =
  'Commercial Real Estate Brokerage, LLC d/b/a CRECO - Commercial Real Estate Company and Fair Oaks Realty Group';

/** Plain text of a .docx, paragraph per line — for the before/after diff. */
function docxText(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-read-'));
  execFileSync('unzip', ['-o', '-q', file, '-d', dir]);
  const xml = fs.readFileSync(path.join(dir, 'word/document.xml'), 'utf8');
  const body = xml.slice(xml.indexOf('<w:body>'), xml.indexOf('</w:body>'));
  const decode = s => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&');
  return (body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? [])
    .map(p => decode((p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) ?? [])
      .map(t => t.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, '')).join('')))
    .join('\n');
}

// ── 1. Back up the original, once ───────────────────────────────────────────
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const backup = path.join(BACKUP_DIR, 'CRECO_Independent_Contractor_Agreement.ORIGINAL-2026-09-19.docx');
if (!fs.existsSync(backup)) {
  fs.copyFileSync(SRC, backup);
  console.log(`backed up original → ${backup}`);
} else {
  console.log(`original already backed up → ${backup}`);
}
const beforeText = docxText(backup);

// ── 2. Rewrite the one run ──────────────────────────────────────────────────
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-edit-'));
execFileSync('unzip', ['-o', '-q', SRC, '-d', work]);
const docPath = path.join(work, 'word/document.xml');
let xml = fs.readFileSync(docPath, 'utf8');

const occurrences = xml.split(OLD_NAME).length - 1;
if (occurrences !== 1) {
  throw new Error(`expected the party name exactly once in document.xml, found ${occurrences}. Aborting rather than guessing which to change.`);
}
xml = xml.replace(OLD_NAME, NEW_NAME);
fs.writeFileSync(docPath, xml);

// ── 3. Repack, preserving the rest of the package untouched ─────────────────
const out = path.join(work, 'rebuilt.docx');
// -X drops extra file attributes; the file list comes from the original so
// nothing is added or dropped.
const entries = execFileSync('unzip', ['-Z1', SRC], { encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean);
execFileSync('zip', ['-X', '-q', out, ...entries], { cwd: work });

// ── 4. Verify: exactly one line differs, and it is the intended one ─────────
const afterText = docxText(out);
const b = beforeText.split('\n');
const a = afterText.split('\n');
if (a.length !== b.length) throw new Error(`paragraph count changed: ${b.length} → ${a.length}`);
const diffs = [];
for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) diffs.push(i);
if (diffs.length !== 1) {
  throw new Error(`expected exactly 1 changed paragraph, got ${diffs.length}: ${JSON.stringify(diffs)}`);
}
const [i] = diffs;
if (b[i].replace(OLD_NAME, NEW_NAME) !== a[i]) {
  throw new Error('the changed paragraph differs by more than the party name.');
}
console.log(`\n✓ exactly one paragraph changed (paragraph ${i}), and only by the party name`);

// ── 5. Install over the source, restoring its read-only mode ────────────────
const mode = fs.statSync(SRC).mode;
fs.chmodSync(SRC, 0o600);
fs.copyFileSync(out, SRC);
fs.chmodSync(SRC, mode);
console.log(`wrote ${SRC}`);

console.log('\n── new opening sentence ──');
console.log(a[i]);
