// RFC 2047 header encoding for hand-built MIME messages (the Gmail API takes a raw RFC 822 string).
//
// A header with non-ASCII characters — an en/em dash in "Letter of Intent to Lease – 6609 Blanco Rd.",
// an accented name — must be sent as encoded-words (=?UTF-8?B?…?=). Left raw, Gmail decodes the UTF-8
// bytes as Latin-1 and the recipient sees "Ã¢Â€Â“". The body is a separate matter: it carries
// `Content-Type: text/html; charset=utf-8`, so it is not affected.

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;
const MAX_RAW_BYTES = 45;   // 45 bytes → 60 base64 chars; "=?UTF-8?B?" + 60 + "?=" = 72 ≤ the 75-char limit

/** Header values can't contain line breaks — a stray CR/LF would let a value inject extra headers. */
export function stripLineBreaks(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').trim();
}

/** Encode a header value (Subject, a display name) when it needs it; plain ASCII passes through. */
export function encodeHeader(value: string): string {
  const v = stripLineBreaks(value);
  if (ASCII_PRINTABLE.test(v)) return v;
  // One encoded-word per ≤45 bytes, never splitting a character, folded onto continuation lines.
  const words: string[] = [];
  let chunk = '';
  let bytes = 0;
  for (const ch of v) {                       // iterates by code point, so surrogate pairs stay whole
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > MAX_RAW_BYTES) { words.push(chunk); chunk = ''; bytes = 0; }
    chunk += ch; bytes += n;
  }
  if (chunk) words.push(chunk);
  return words.map(w => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** `Display Name <address>` with the name encoded (or quoted, if it's ASCII with specials). */
export function formatAddress(name: string | undefined | null, email: string): string {
  const n = stripLineBreaks(name ?? '');
  if (!n) return email;
  if (!ASCII_PRINTABLE.test(n)) return `${encodeHeader(n)} <${email}>`;
  return /[()<>@,;:\\".[\]]/.test(n) ? `"${n.replace(/["\\]/g, '\\$&')}" <${email}>` : `${n} <${email}>`;
}

/** Decode encoded-words back to text — what a mail client does. Used by the regression test. */
export function decodeHeader(v: string): string {
  return v
    .replace(/\?=\r?\n[ \t]+=\?/g, '?==?')   // unfold between adjacent encoded-words
    .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/gi, (_m, b64) => Buffer.from(b64, 'base64').toString('utf8'))
    .replace(/=\?UTF-8\?Q\?([^?]*)\?=/gi, (_m, q) => Buffer.from(q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x: string, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));
}

/**
 * Parameters for an attachment name that survive non-ASCII: an ASCII fallback (`name="…"`) for old clients
 * plus the RFC 2231 form (`name*=UTF-8''…`) that modern ones prefer. A raw "–" in the filename would
 * otherwise show up as mojibake just like the Subject did.
 */
export function attachmentParam(param: 'name' | 'filename', fileName: string): string {
  const clean = stripLineBreaks(fileName).replace(/["\\]/g, '');
  if (ASCII_PRINTABLE.test(clean)) return `${param}="${clean}"`;
  const ascii = clean.replace(/[\u2010-\u2015]/g, '-').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_');
  const pct = encodeURIComponent(clean).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${param}="${ascii}"; ${param}*=UTF-8''${pct}`;
}
