// How an email thread reads in the CRM's deal and contact cards: who it is with, and a one-line preview that is the message, not the signature.
// Pure (no React, no database) so it can be tested on its own.

export type Addr = { name: string; email: string };

/** "A <a@x.com>, \"B, Co\" <b@x.com>" -> [{ name, email }]. Splits on commas that are not inside quotes or angle brackets, so "Smith, John" stays one person. */
export function parseAddressList(raw?: string | null): Addr[] {
  if (!raw) return [];
  const parts: string[] = []; let cur = ''; let q = false; let a = 0;
  for (const ch of raw) {
    if (ch === '"') q = !q;
    else if (!q && ch === '<') a++;
    else if (!q && ch === '>') a = Math.max(0, a - 1);
    if (ch === ',' && !q && a === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map(p => p.trim()).filter(Boolean).map(p => {
    const m = p.match(/^"?(.*?)"?\s*<([^>]+)>$/);
    const email = (m ? m[2] : p).trim();
    const name = (m ? m[1] : '').trim() || email.split('@')[0];
    return { name, email };
  });
}

export function emailDisplayName(raw: string): string {
  const addr = raw.trim().replace(/^<([^<>]*)>$/, '$1'); // a bare "<a@x.com>" is just the address
  const m = addr.match(/^"?(.+?)"?\s*<[^>]+>/);
  return m ? m[1].trim() : addr.split('@')[0];
}

const lc = (s: string) => s.trim().toLowerCase();
const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);
/** The bare address out of "Name <a@x.com>" or "a@x.com". */
export const bareEmail = (raw: string) => lc(raw.match(/<([^>]+)>/)?.[1] ?? raw);

/** A header name that is a real name, not just the address's local part ("staceygc7") or the address itself. */
export function isRealName(name: string, email: string): boolean {
  const n = name.trim();
  if (!n || n.includes('@')) return false;
  return lc(n) !== lc(email.split('@')[0] ?? '');
}

/** "jane.smith@x.com" → "Jane Smith"; anything that isn't clearly first.last stays as written. */
export function prettyLocal(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  return parts.length >= 2 && parts.every(p => /^[a-z]{2,}$/i.test(p)) ? parts.map(cap).join(' ') : local;
}

/** Every real name the thread's own headers carry, by address ("Stacey G <staceygc7@gmail.com>" teaches us who staceygc7 is). */
export function nameBook(rows: Array<{ from_email?: string | null; to_email?: string | null; cc_emails?: string | null }>): Map<string, string> {
  const book = new Map<string, string>();
  for (const r of rows) {
    for (const raw of [r.from_email, r.to_email, r.cc_emails]) {
      for (const a of parseAddressList(raw)) if (isRealName(a.name, a.email) && !book.has(lc(a.email))) book.set(lc(a.email), a.name.trim());
    }
  }
  return book;
}

/** The best name for an address: the thread's own headers, then the CRM's address book, then a tidied local part. */
export function personLabel(email: string, book: Map<string, string>, nameFor?: (email: string) => string | undefined): string {
  const e = lc(email);
  return book.get(e) ?? nameFor?.(e) ?? prettyLocal(e);
}

/**
 * Who a conversation is with, for the collapsed row: everyone on it except us, the person who wrote last first.
 * "Stacey G., Mike Carter +2". When it is only us ("You"), or a note to ourselves, it says so rather than naming the sender.
 */
export function threadPeople(
  emails: Array<{ from_email: string; to_email?: string | null; cc_emails?: string | null; direction: string }>,
  newestFirst: boolean,
  self: Set<string>,
  book: Map<string, string>,
  nameFor?: (email: string) => string | undefined,
): { label: string; primary: string; count: number } {
  const ordered = newestFirst ? emails : [...emails].reverse();
  const seen = new Set<string>(); const others: string[] = [];
  for (const m of ordered) {
    const list = m.direction === 'sent'
      ? [...parseAddressList(m.to_email), ...parseAddressList(m.cc_emails)]
      : [...parseAddressList(m.from_email), ...parseAddressList(m.to_email), ...parseAddressList(m.cc_emails)];
    for (const a of list) {
      const e = lc(a.email);
      if (!e || self.has(e) || seen.has(e)) continue;
      seen.add(e); others.push(a.email);
    }
  }
  if (!others.length) return { label: 'You', primary: bareEmail(emails[0]?.from_email ?? ''), count: 0 };
  const names = others.map(e => personLabel(e, book, nameFor));
  const shown = names.slice(0, 2);
  const extra = names.length - shown.length;
  return { label: shown.join(', ') + (extra > 0 ? ` +${extra}` : ''), primary: others[0], count: others.length };
}

// ── the one-line preview ─────────────────────────────────────────────────────
// Where the message ends and the signature begins.
const SIGNATURE_START = [
  /^(thanks|thank you|many thanks|best|best regards|kind regards|warm regards|regards|sincerely|cheers|respectfully|talk soon|sent from my)\b/i,
  /^(O|C|M|T|P|Tel|Phone|Cell|Mobile|Office|Direct)\s*:\s*[\d(+]/i,
  /^get outlook for/i,
  /^-{2,}\s*$/,
];
const GREETING_ONLY = /^(hi|hey|hello|dear|good (morning|afternoon|evening))\b[^.!?\n]{0,40}[,:]?$/i;
const NAME_COMMA = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)?,$/;   // "Zack," / "Mike Carter,"

/** The first line or two of what the person actually said: no greeting, no signature block, no markdown asterisks, no raw links. */
export function snippetOf(cleanBody: string, max = 140): string {
  const lines = String(cleanBody ?? '').split('\n').map(l => l.trim());
  const keep: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (!line) continue;
    // a bold name on a line of its own after some text starts a signature block ("*Brian Blanco*" / "Associate" / "San Antonio, TX")
    if (keep.length && /^\*{1,2}[^*\n]{2,50}\*{1,2}$/.test(line)) break;
    if (SIGNATURE_START.some(re => re.test(line)) && (keep.length || i > 0)) break;
    keep.push(line);
  }
  let first = 0;
  if (keep.length > 1 && (GREETING_ONLY.test(keep[0]) || NAME_COMMA.test(keep[0]))) first = 1;   // "Hi Zack," is not the news
  let t = keep.slice(first).join(' ');
  t = t.replace(/\[(?:image|cid):[^\]]*\]/gi, ' ')
    .replace(/<https?:\/\/[^>]+>/g, ' ').replace(/\bhttps?:\/\/\S+/g, ' ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ').trim();
  if (!t) t = keep.join(' ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,;:–—-]+$/, '') + '…';
}
