// The note that pre-fills the "message to signers" box on every e-sign send surface
// (the composer, the deal E-Sign tab, and the property send modal). It just saves the
// agent typing the same polite ask each time — they can edit or clear it before
// sending. Plain text; the invite email template wraps it.
//
// It is a template. The send screens fill {{document_name}} up front so the agent can
// see it and reword it ("the lease agreement for 8000 Fair Oaks Plaza, Suite 3118").
// The rest is resolved on the server when each invite is built (inviteEmail in
// lib/esign.ts), never typed in by the browser:
//   {{first_name}}  — that signer's first name (one message goes to every signer)
//   {{sender_name}} — the CRM user who created the request, from their profile
//   {{company}}     — the brand of the workspace it was sent from
// so a request Brian sends signs off as Brian, and one Zack sends signs off as Zack.
export const ESIGN_MESSAGE_TEMPLATE =
  'Hi {{first_name}},\n\n' +
  'Please review and sign {{document_name}} at your convenience. Don\'t hesitate to reach out if you have any questions.\n\n' +
  'Thank you,\n{{sender_name}}\n{{company}}';

export function firstNameOf(name?: string | null): string {
  return (name || '').trim().split(/\s+/)[0] || '';
}

// Mirrors the assumed names each brand trades under (see brandName in lib/esign.ts).
export function companyFor(unit?: string | null): string {
  return unit === 'residential' ? 'Fair Oaks Realty Group' : 'CRECO — Commercial Real Estate Company';
}

interface MessageVars { firstName?: string | null; documentName?: string | null; senderName?: string | null; company?: string | null }

// Fill whichever placeholders are given; a key left undefined keeps its {{token}}.
// An empty value disappears cleanly: "Hi {{first_name}}," → "Hi,", and a sign-off
// line that held only that token is dropped rather than left blank.
export function renderEsignMessage(tpl: string, v: MessageVars): string {
  const fill = (s: string, keys: string[], val: string | null | undefined) => {
    if (val === undefined) return s;
    const t = (val ?? '').trim();
    for (const key of keys) {
      s = t ? s.split(`{{${key}}}`).join(t)
            : s.replace(new RegExp(`\\n\\{\\{${key}\\}\\}(?=\\n|$)`, 'g'), '').replace(new RegExp(` ?\\{\\{${key}\\}\\}`, 'g'), '');
    }
    return s;
  };
  let out = fill(tpl, ['first_name'], v.firstName);
  out = fill(out, ['document_name', 'document'], v.documentName);   // {{document}}: older drafts
  out = fill(out, ['sender_name'], v.senderName);
  out = fill(out, ['company'], v.company);
  return out;
}

export function defaultEsignMessage(docTitle?: string | null): string {
  return renderEsignMessage(ESIGN_MESSAGE_TEMPLATE, { documentName: (docTitle || '').trim() || 'the attached document' });
}
