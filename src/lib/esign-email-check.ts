// Catches the email mistakes that otherwise only show up as a bounce days later: not an address at all, a placeholder, or a
// near-miss of a common mail provider ("gmial.com", ".con"). `emailProblem` blocks; `emailWarning` only asks.

const FORMAT = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[A-Za-z]{2,}$/;

/** Not usable as an address at all. null when it looks like one. */
export function emailProblem(raw: string): string | null {
  const e = raw.trim();
  if (!e) return null;
  if (/[,;\s]/.test(e)) return 'One address only — no spaces, commas or semicolons';
  if (!FORMAT.test(e)) return 'That doesn’t look like an email address';
  return null;
}

const TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yhoo.com': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com',
};

/** Valid-looking but probably not meant to go out. null when nothing looks off. */
export function emailWarning(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (!e || emailProblem(e)) return null;
  const [local, domain] = e.split('@');
  if (/\.(invalid|test|example|localhost)$/.test(domain) || /^(example\.(com|org|net))$/.test(domain)) return 'This looks like a placeholder address — a real signer would never receive it';
  if (/^(test|testing|asdf|none|noemail|no-email|na|n-a|unknown|tbd)$/.test(local)) return 'This looks like a placeholder name before the @';
  if (/^(no-?reply|do-?not-?reply|donotreply)$/.test(local)) return 'A no-reply address can’t sign anything';
  if (TYPOS[domain]) return `Did you mean ${local}@${TYPOS[domain]}?`;
  if (domain.endsWith('.con') || domain.endsWith('.cmo') || domain.endsWith('.vom')) return `The ending “.${domain.split('.').pop()}” looks like a typo for “.com”`;
  return null;
}
