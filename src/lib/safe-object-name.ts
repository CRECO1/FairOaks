/**
 * The one way to turn a user's filename into a storage object name.
 *
 * Every upload route builds its storage path from this, and every confirm step validates that path
 * (no "/", no "..", non-empty). A name made here can never fail that second check, whatever the file
 * is called — "Smith Inc..pdf", "...", ".pdf", emoji, 400 characters, only dots. The person's real
 * filename is stored separately in the database and shown unchanged.
 */
export function safeObjectName(filename: string, max = 120): string {
  let s = String(filename ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')           // "Inc..pdf" -> "Inc.pdf": ".." is what the confirm checks reject
    .replace(/^[._]+(?=.)/, '');         // no leading dots (hidden / relative-looking names)
  if (s.length > max) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 12 ? s.slice(dot) : '';
    s = s.slice(0, max - ext.length) + ext;
  }
  if (!s || /^[._-]*$/.test(s)) s = 'file' + (s.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '');
  return s;
}
