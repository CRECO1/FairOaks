// The agent's Gmail signature (synced into crm_profiles.email_signature) for emails the
// CRM sends on an agent's behalf outside Gmail — action plans, Copilot, test sends — so
// they read exactly like a message typed in Gmail. The compose box already appends it
// client-side; withSignature() is idempotent so a body that already carries it is untouched.
import type { SupabaseClient } from '@supabase/supabase-js';

const MARKER = 'gmail_signature';
// Templates with a footer (e-sign shell) drop this where the signature belongs, above the footer.
export const SIGNATURE_SLOT = '<!--agent-signature-->';

type SigProfile = { id: string; email: string | null; email_signature: string | null };

// A handful of agents; one cheap query, cached briefly per server instance.
let cache: { at: number; rows: SigProfile[] } | null = null;
const TTL_MS = 60_000;

async function signedProfiles(supabase: SupabaseClient): Promise<SigProfile[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const { data } = await supabase.from('crm_profiles').select('id, email, email_signature').not('email_signature', 'is', null).neq('email_signature', '');
  const rows = (data ?? []) as SigProfile[];
  cache = { at: Date.now(), rows };
  return rows;
}

/**
 * Signature HTML for the sender. `fromEmail` (an explicit send-as address) wins over
 * `agentId`: it matches a profile by login email, else by the address inside the
 * signature itself (a broker's CRM login can differ from the address they sign with).
 * Returns '' when nobody matches or the sender never synced a signature.
 */
export async function resolveSignature(
  supabase: SupabaseClient,
  opts: { agentId?: string | null; fromEmail?: string | null },
): Promise<string> {
  try {
    const rows = await signedProfiles(supabase);
    const email = (opts.fromEmail || '').trim().toLowerCase();
    if (email) {
      const hit =
        rows.find(r => (r.email || '').toLowerCase() === email) ??
        rows.find(r => (r.email_signature || '').toLowerCase().includes(`mailto:${email}`));
      if (hit?.email_signature) return hit.email_signature;
    }
    if (opts.agentId) return rows.find(r => r.id === opts.agentId)?.email_signature ?? '';
  } catch (err) {
    console.error('[agent-signature] lookup failed', err);
  }
  return '';
}

/**
 * The signature exactly as Gmail's own composer writes it — same wrapper, same `gmail_signature` +
 * `data-smartmail` markers, same two line breaks above it — so a message sent from the CRM is indistinguishable
 * from one typed in Gmail (Gmail and other clients recognise and fold/trim the signature the same way).
 */
export function gmailSignatureBlock(signature: string): string {
  return `<br clear="all"><br clear="all"><div dir="auto"><div dir="ltr" class="${MARKER}" data-smartmail="${MARKER}">${brandedSignature(signature)}</div></div>`;
}

const FONT = 'Arial,Helvetica,sans-serif';
const GOLD = '#C9922C';
// The signature's own logo is a Google-hosted image (googleusercontent.com/mail-sig) that only loads for the sender, so recipients saw an empty box. The card uses our own hosted logo instead.
const LOGO_URL = 'https://www.crecotx.com/images/creco-logo-light.png';
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (h: string) => h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/**
 * The agent's own Gmail signature, laid out as a clean card: logo on the left behind a gold rule; name, title and contact lines on the
 * right; the licence link and confidentiality notice underneath in small grey type. Built from the signature's own lines (name, title,
 * "O:/C:/E:" lines, website, logo image, everything after the logo), so nothing is invented and each agent's numbers stay as they wrote
 * them. If a signature doesn't look like that shape, it is returned untouched.
 */
/** Everything after the logo: the first link (the TREC brokerage-services notice) as a small underlined line, then the rest as small grey type. */
function footer(tail: string): string {
  const a = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(tail);
  const rest = plain(a ? tail.replace(a[0], ' ') : tail);
  if (!a && !rest) return '';
  return `<div style="font-family:${FONT};font-size:11px;line-height:1.5;color:#8a8a8a;margin-top:14px;max-width:560px">`
    + (a ? `<div style="margin-bottom:4px"><a href="${a[1]}" style="color:#6b6b6b;text-decoration:underline" target="_blank">${esc(plain(a[2]))}</a></div>` : '')
    + (rest ? `<div>${esc(rest)}</div>` : '')
    + `</div>`;
}

export function brandedSignature(signature: string): string {
  try {
    const nameM = /<b[^>]*>([\s\S]*?)<\/b>/i.exec(signature);
    const imgM = /<img\b[^>]*>/i.exec(signature);
    if (!nameM || !imgM || nameM.index > imgM.index) return signature;
    const name = plain(nameM[1]);
    const head = signature.slice(nameM.index + nameM[0].length, imgM.index);
    const lines = [...head.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)].map(m => m[1]).filter(h => plain(h));
    if (!name || !lines.length || !lines.some(h => /^\s*(O|C|E|M|P|T):/i.test(plain(h)))) return signature;
    const src = /\ssrc="([^"]+)"/i.exec(imgM[0])?.[1];
    if (!src || !/^https:\/\//i.test(src.replace(/&amp;/g, '&'))) return signature;
    const tail = signature.slice(imgM.index + imgM[0].length).replace(/^\s*(<br\s*\/?>)?\s*<\/div>/i, '');
    // lines before the first labelled line are the title / location; the rest are contact lines
    const firstLabel = lines.findIndex(h => /^\s*(O|C|E|M|P|T):/i.test(plain(h)));
    const title = firstLabel > 0 ? plain(lines[0]) : '';
    const where = firstLabel > 1 ? plain(lines[1]) : '';
    const contact = lines.slice(Math.max(firstLabel, 0));
    const row = (h: string) => {
      const t = plain(h);
      const lab = /^(O|C|E|M|P|T):\s*/i.exec(t);
      const link = /<a\b[^>]*href="([^"]+)"[^>]*>/i.exec(h);
      const val = lab ? t.slice(lab[0].length) : t;
      const shown = link ? `<a href="${link[1]}" style="color:#111;text-decoration:none;border-bottom:1px solid ${GOLD}" target="_blank">${esc(val)}</a>` : esc(val);
      return `<tr><td style="padding:0 10px 0 0;color:${GOLD};font-weight:700;font-size:11px;letter-spacing:1px;width:14px">${lab ? esc(lab[1].toUpperCase()) : '&nbsp;'}</td><td style="padding:1px 0;color:#333;font-size:13px">${shown}</td></tr>`;
    };
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${FONT};margin:0"><tr>`
      + `<td valign="middle" align="center" style="padding:0 16px 0 0;border-right:3px solid ${GOLD};vertical-align:middle"><img src="${LOGO_URL}" width="150" alt="CRECO — Commercial Real Estate Company" style="display:block;width:150px;height:auto;border:0"></td>`
      + `<td valign="top" style="padding:0 0 0 16px;font-family:${FONT}">`
      + `<div style="font-size:17px;font-weight:700;color:#111;line-height:1.25">${esc(name)}</div>`
      + (title ? `<div style="font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${GOLD};margin:2px 0 0">${esc(title)}</div>` : '')
      + (where ? `<div style="font-size:12px;color:#666;margin:2px 0 8px">${esc(where)}</div>` : '<div style="height:8px"></div>')
      + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${contact.map(row).join('')}</table>`
      + `</td></tr></table>`
      + footer(tail);
  } catch {
    return signature;
  }
}

/** The message typography every CRM-sent email gets, so bodies don't depend on each mail client's default font. */
export function withBodyStyle(html: string): string {
  return `<div style="font-family:${FONT};font-size:14px;line-height:1.55;color:#222">${html}</div>`;
}

/** Append the signature to an HTML email body (before </body> when there is one). */
export function withSignature(html: string, signature: string | null | undefined): string {
  if (!signature || !signature.trim() || html.includes(MARKER)) return html;
  const block = gmailSignatureBlock(signature);
  if (html.includes(SIGNATURE_SLOT)) return html.replace(SIGNATURE_SLOT, block);
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? html + block : html.slice(0, i) + block + html.slice(i);
}
