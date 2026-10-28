import { htmlToText } from '@/lib/html-text';

/**
 * The readable text of a Gmail message payload: the text/plain part when the sender included one, otherwise the HTML
 * part converted with its paragraph and line breaks kept (messages sent from the CRM are HTML-only).
 */
const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');

export function extractEmailText(payload: any): string {
  if (!payload) return '';
  const walk = (p: any, mime: string): string => {
    if (p?.mimeType === mime && p.body?.data) return b64(p.body.data);
    for (const part of p?.parts ?? []) { const got = walk(part, mime); if (got) return got; }
    return '';
  };
  const plain = walk(payload, 'text/plain');
  if (plain) return plain.replace(/\r\n?/g, '\n');
  const html = walk(payload, 'text/html');
  if (html) return htmlToText(html);
  if (payload.body?.data) { const raw = b64(payload.body.data); return /<[a-z][\s\S]*>/i.test(raw) ? htmlToText(raw) : raw; }
  return '';
}
