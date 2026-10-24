// Safe HTML sanitizer — isomorphic-dompurify works in both SSR and browser contexts.
// Usage: sanitizeHtml(untrustedHtmlString)

import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize an HTML string, removing all script/event-handler XSS vectors.
 * Works server-side (SSR) and client-side — never returns empty string on the server.
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, {
    // Allowlist — explicitly safe tags only. Never include script/style/html/head/body/meta.
    ALLOWED_TAGS: ['p','br','b','i','u','strong','em','a','ul','ol','li','h1','h2','h3','h4','h5','h6','span','div','table','thead','tbody','tfoot','tr','td','th','img','hr','blockquote','pre','code','small','sub','sup','s','strike','del','ins','caption','col','colgroup'],
    ALLOWED_ATTR: ['href','target','rel','src','alt','width','height','style','class','align','valign','border','cellpadding','cellspacing','colspan','rowspan','id','title'],
    // Force all links to be safe
    FORCE_BODY: true,
    // Strip any remaining dangerous protocols
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
