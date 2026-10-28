import { htmlToText } from '@/lib/html-text';

/**
 * Our own website's lead notification ("🔥 HOT LEAD", "New Lead — CRECO") is a label/value table. Flattened like any
 * other email it reads as one run-on line ("NameJay Perez Emailjperez7@… Phone— Source…"). This turns each two-cell row
 * into its own "Label: value" line, keeps the multi-line Message as a block, and drops the heading and the
 * "Reply by email" button — so the lead's details are readable on the deal card.
 */
export function formatLeadEmail(html: string): string {
  const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  let h = html
    .replace(/>\s+</g, '><') // indentation between tags would otherwise become blank lines
    .replace(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi, '')
    .replace(/<a\b[^>]*mailto:[^>]*display\s*:\s*inline-block[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<tr\b[^>]*>\s*<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>\s*<\/tr>/gi, (_m, label: string, value: string) => {
      const l = strip(label).replace(/:\s*$/, '');
      if (/^message$/i.test(l)) return `<div>&nbsp;</div><div>${l}:</div><div>${value.trim().replace(/\r?\n/g, '<br>')}</div>`;
      return `<div>${l}: ${strip(value) || '—'}</div>`;
    })
    // the layout <table> itself shouldn't add blank lines between the rows we just made
    .replace(/<\/?table\b[^>]*>/gi, '');
  h = h.replace(/<img\b[^>]*>/gi, '');
  return htmlToText(h).replace(/\n{3,}/g, '\n\n').trim();
}
