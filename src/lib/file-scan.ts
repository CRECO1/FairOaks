// In-house safety scan for tenant uploads (secure documents). It runs inside our own server on the stored file and
// sends the file NOWHERE — tenant financials never leave our storage.
//
// What this is: a content check that refuses the file shapes malware actually uses to reach an office (macros, embedded
// scripts and programs, remote-template links, disguised or polyglot files, archive bombs, and the standard EICAR antivirus
// test string). What it is NOT: a signature antivirus. It will not recognise a brand-new strain hiding inside an otherwise
// ordinary file. Layering a signature engine on top is a separate decision (see the note in secure-upload.ts).
import JSZip from 'jszip';
import { inflateSync } from 'zlib';

export type ScanResult = { ok: true } | { ok: false; reason: string; code: string };
const bad = (code: string, reason: string): ScanResult => ({ ok: false, code, reason });

export const SCAN_VERSION = 1;
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const MAX_UNZIPPED = 300 * 1024 * 1024;     // an office file that unpacks past this is a bomb, not a bank statement
const MAX_ENTRIES = 4000;

const latin = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1');
const has = (hay: string, re: RegExp) => re.test(hay);

// Signatures of things that must never ride along inside a "document".
function trailingExecutable(tail: Uint8Array): string | null {
  const t = latin(tail);
  if (t.startsWith('MZ') || t.includes('This program cannot be run in DOS mode')) return 'a Windows program';
  if (t.includes('\x7fELF')) return 'a program';
  if (t.includes('PK\x03\x04')) return 'a hidden archive';
  if (t.includes('%PDF-')) return 'a hidden PDF';
  if (/<script[\s>]/i.test(t) || /<\?php/i.test(t) || /#!\/(bin|usr)\//.test(t)) return 'a hidden script';
  return null;
}

/** Is this unpacked attachment itself something dangerous? (Used for files hidden inside a PDF.) */
async function dangerousPayload(p: Uint8Array): Promise<string | null> {
  const t = latin(p.subarray(0, 4096));
  if (t.startsWith('MZ') || t.includes('This program cannot be run in DOS mode')) return 'a Windows program';
  if (t.startsWith('\x7fELF')) return 'a program';
  if (t.startsWith('#!') || /<script[\s>]/i.test(t) || /<\?php/i.test(t)) return 'a script';
  if (latin(p).includes(EICAR)) return 'the antivirus test file';
  if (p[0] === 0xd0 && p[1] === 0xcf && p[2] === 0x11 && p[3] === 0xe0) { const r = scanOle(p); if (!r.ok) return r.reason; }
  if (p[0] === 0x50 && p[1] === 0x4b && p[2] === 0x03 && p[3] === 0x04) { const r = await scanZipOffice('docx', p); if (!r.ok && r.code !== 'zip-corrupt') return r.reason; }
  return null;
}

async function scanPdf(b: Uint8Array): Promise<ScanResult> {
  const s = latin(b);
  if (has(s, /\/Launch\b/)) return bad('pdf-launch', 'a PDF that tries to launch a program');
  if (has(s, /\/(JavaScript|JS)\b\s*[\(<\/\[]|\/S\s*\/JavaScript\b/)) return bad('pdf-js', 'a PDF with embedded scripts');
  if (has(s, /\/RichMedia\b/)) return bad('pdf-media', 'a PDF with embedded media');
  // Attached files are normal in fillable forms (applications, leases), so they are opened and judged by what they ARE.
  if (has(s, /\/(U?F)\s*\(([^)]*)\.(exe|scr|bat|cmd|com|dll|msi|jar|js|jse|vbs|vbe|wsf|ps1|lnk|hta)\)/i)) return bad('pdf-embedded-exe', 'a PDF with a program attached to it');
  let looked = 0;
  for (const m of s.matchAll(/\/EmbeddedFile\b/g)) {
    if (++looked > 20) return bad('pdf-embedded-many', 'a PDF with an unusual number of attached files');
    const st = s.indexOf('stream', m.index!); if (st < 0) continue;
    const start = st + 6 + (s[st + 6] === '\r' ? 2 : 1);
    const end = s.indexOf('endstream', start); if (end < 0) continue;
    let payload: Uint8Array = b.subarray(start, end);
    // This object's own dictionary only (from its "obj" keyword to its stream) — never the neighbouring object's.
    const dict = s.slice(Math.max(0, s.lastIndexOf('obj', m.index!)), st);
    if (/\/FlateDecode/.test(dict)) {
      // If it will not unpack, judge the raw bytes rather than skipping the file.
      try { payload = inflateSync(Buffer.from(payload), { maxOutputLength: 60 * 1024 * 1024 }); } catch { /* scan as-is */ }
    }
    const why = await dangerousPayload(payload);
    if (why) return bad('pdf-embedded-bad', `a PDF with ${why} attached inside it`);
  }
  // Anything after the final %%EOF beyond line endings is data the viewer never shows.
  const eof = s.lastIndexOf('%%EOF');
  if (eof > -1) { const tail = b.subarray(eof + 5); if (tail.length > 1024) { const hit = trailingExecutable(tail); if (hit) return bad('pdf-trailing', `a PDF with ${hit} attached after the end`); } }
  return { ok: true };
}

function scanImage(ext: string, b: Uint8Array): ScanResult {
  // Find where the picture ends; whatever follows is only a problem if it looks like something runnable.
  let end = -1;
  if (ext === 'png') { const i = latin(b).lastIndexOf('IEND'); if (i > -1) end = i + 8; }
  else if (ext === 'jpg' || ext === 'jpeg') { for (let i = b.length - 2; i > 1; i--) { if (b[i] === 0xff && b[i + 1] === 0xd9) { end = i + 2; break; } } }
  else if (ext === 'webp') { const size = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0; if (size + 8 <= b.length) end = size + 8; }
  if (end > -1 && b.length - end > 512) {
    const hit = trailingExecutable(b.subarray(end));
    if (hit) return bad('image-polyglot', `an image with ${hit} hidden inside it`);
  }
  return { ok: true };
}

async function scanZipOffice(ext: string, b: Uint8Array): Promise<ScanResult> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(b); } catch { return bad('zip-corrupt', 'a damaged or unreadable document'); }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) return bad('zip-bomb', 'an archive with an unusual number of parts');
  let unzipped = 0;
  for (const n of names) {
    const f = zip.files[n] as unknown as { _data?: { uncompressedSize?: number }; dir: boolean };
    unzipped += f._data?.uncompressedSize ?? 0;
    if (/(^|\/)\.\.(\/|$)|^\//.test(n)) return bad('zip-path', 'a document with unsafe file paths inside');
    if (/vbaproject\.bin$/i.test(n) || /\.(vba|vbs)$/i.test(n)) return bad('office-macro', 'a document containing macros');
    if (/(^|\/)(activeX|embeddings|oleObject)[^/]*$/i.test(n) || /\/(activeX|embeddings)\//i.test(n)) return bad('office-embedded', 'a document with embedded objects');
    if (/\.(exe|dll|scr|bat|cmd|com|js|jse|vbe|wsf|ps1|msi|jar|lnk|hta)$/i.test(n)) return bad('office-exe', 'a document with a program inside it');
  }
  if (unzipped > MAX_UNZIPPED) return bad('zip-bomb', 'a document that expands to an unreasonable size');
  // Remote template / external link tricks live in the .rels files.
  for (const n of names.filter(x => x.endsWith('.rels'))) {
    const xml = await zip.files[n].async('string').catch(() => '');
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const r = m[0];
      if (/TargetMode="External"/i.test(r) && /Type="[^"]*\/(attachedTemplate|oleObject|externalLink|frame|subDocument|package)"/i.test(r)) return bad('office-remote', 'a document that pulls content from another website');
    }
  }
  // xlsx: Excel 4 macros hide in sheets flagged as macro sheets.
  if (ext === 'xlsx' && zip.file('xl/workbook.xml')) {
    const wb = await zip.file('xl/workbook.xml')!.async('string').catch(() => '');
    if (/state="veryHidden"/i.test(wb) && /xlm|macrosheet/i.test(names.join(' '))) return bad('office-xlm', 'a spreadsheet with hidden macro sheets');
  }
  return { ok: true };
}

function scanOle(b: Uint8Array): ScanResult {
  // Legacy .doc/.xls store macros in a "Macros"/"_VBA_PROJECT" storage; the stream names are UTF-16 in the directory.
  const s = latin(b);
  const u16 = (w: string) => w.split('').join('\0');
  if (s.includes(u16('_VBA_PROJECT')) || s.includes(u16('VBA') + '\0') || s.includes(u16('Macros'))) return bad('ole-macro', 'an older Word/Excel file containing macros');
  if (s.includes(u16('ObjectPool'))) return bad('ole-embedded', 'an older Word/Excel file with embedded objects');
  return { ok: true };
}

function scanCsv(b: Uint8Array): ScanResult {
  const s = latin(b.subarray(0, 2_000_000));
  if (/(^|[\n\r,;"'])\s*[=+\-@]\s*(cmd|powershell|mshta|msexcel|msword|dde)\b[^\n\r]{0,40}\|/i.test(s)) return bad('csv-dde', 'a spreadsheet with a command hidden in a cell');
  return { ok: true };
}

/** Scan one file's bytes. `ext` is the lower-case extension the tenant uploaded (already checked against the allow-list). */
export async function scanFile(ext: string, buf: Uint8Array): Promise<ScanResult> {
  // The standard antivirus test file, in any wrapper: also how we prove the scanner is awake.
  if (latin(buf).includes(EICAR)) return bad('eicar', 'the standard antivirus test file');
  switch (ext) {
    case 'pdf': return scanPdf(buf);
    case 'png': case 'jpg': case 'jpeg': case 'webp': return scanImage(ext, buf);
    case 'docx': case 'xlsx': return scanZipOffice(ext, buf);
    case 'doc': case 'xls': return scanOle(buf);
    case 'csv': return scanCsv(buf);
    default: return bad('type', 'a file type that is not accepted');
  }
}
