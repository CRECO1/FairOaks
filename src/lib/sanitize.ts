// Safe HTML sanitizer — uses DOMPurify client-side, returns '' during SSR.
// Usage: sanitizeHtml(untrustedHtmlString)

import type DOMPurifyType from 'dompurify';

let purify: ReturnType<typeof DOMPurifyType> | null = null;

function getPurify(): ReturnType<typeof DOMPurifyType> | null {
  if (purify) return purify;
  if (typeof window === 'undefined') return null; // SSR — skip
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DOMPurify = require('dompurify') as typeof DOMPurifyType;
  purify = DOMPurify(window);
  return purify;
}

/**
 * Sanitize an HTML string, removing all script/event-handler XSS vectors.
 * Returns an empty string during server-side rendering.
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';
  const dp = getPurify();
  if (!dp) return ''; // SSR fallback — never render untrusted HTML server-side
  return dp.sanitize(dirty, {
    ALLOWED_TAGS: ['p','br','b','i','u','strong','em','a','ul','ol','li','h1','h2','h3','h4','h5','h6','span','div','center','table','thead','tbody','tfoot','tr','td','th','img','hr','blockquote','pre','code','font','small','big','sub','sup','s','strike','del','ins','caption','col','colgroup','style','head','html','body','meta','title'],
    ALLOWED_ATTR: ['href','target','rel','src','alt','width','height','style','class','align','valign','bgcolor','color','border','cellpadding','cellspacing','colspan','rowspan','face','size','background','id','name','title','data-*'],
    FORCE_BODY: false,
  });
}
