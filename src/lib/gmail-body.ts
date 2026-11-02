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

/**
 * The message's HTML part as it was sent, for showing the email the way the recipient saw it. Empty for plain-text-only
 * messages; capped so one huge newsletter can't bloat the row. The reader sanitizes it and blocks trackers before display.
 */
export function extractEmailHtml(payload: any): string {
  const walk = (p: any): string => {
    if (p?.mimeType === 'text/html' && p.body?.data) return b64(p.body.data);
    for (const part of p?.parts ?? []) { const got = walk(part); if (got) return got; }
    return '';
  };
  return walk(payload).slice(0, 200_000);
}
