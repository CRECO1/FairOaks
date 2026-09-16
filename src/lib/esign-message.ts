// The note that pre-fills the "message to signers" box on every e-sign send surface
// (the composer, the deal E-Sign tab, and the property send modal). It just saves the
// agent typing the same polite ask each time — they can edit or clear it before
// sending. Plain text; the invite email template wraps it.
export function defaultEsignMessage(docTitle?: string | null, agentName?: string | null): string {
  const doc = (docTitle || '').trim();
  const what = doc || 'the attached document';
  const body = `Please review and electronically sign ${what} at your convenience. If you have any questions, please don't hesitate to reach out.`;
  const name = (agentName || '').trim();
  return name ? `${body}\n\nThank you,\n${name}` : body;
}
