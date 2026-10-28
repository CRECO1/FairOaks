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
  return `<br clear="all"><br clear="all"><div dir="auto"><div dir="ltr" class="${MARKER}" data-smartmail="${MARKER}">${signature}</div></div>`;
}

/** Append the signature to an HTML email body (before </body> when there is one). */
export function withSignature(html: string, signature: string | null | undefined): string {
  if (!signature || !signature.trim() || html.includes(MARKER)) return html;
  const block = gmailSignatureBlock(signature);
  if (html.includes(SIGNATURE_SLOT)) return html.replace(SIGNATURE_SLOT, block);
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? html + block : html.slice(0, i) + block + html.slice(i);
}
