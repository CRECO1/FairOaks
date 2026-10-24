/**
 * Best-effort removal of script-bearing markup from agent-authored email HTML, with NO dependencies.
 *
 * This is defence in depth only. The real control for pages that serve such HTML on the app origin is a
 * `Content-Security-Policy: sandbox` header (no scripts, unique origin). A DOM-based sanitizer (DOMPurify) can't be
 * used in the server routes: isomorphic-dompurify pulls in jsdom, which fails to load in the Vercel serverless runtime
 * (ERR_REQUIRE_ESM from html-encoding-sniffer) and takes the whole route down with it.
 */
export function stripActiveContent(html: string): string {
  return html
    .replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi, '')                 // <script>…</script>
    .replace(/<\s*script\b[^>]*>/gi, '')                                          // unterminated / self-closed <script>
    .replace(/<\s*(iframe|object|embed|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')       // whole frame / plugin / form blocks
    .replace(/<\s*\/?\s*(iframe|object|embed|base|form)\b[^>]*>/gi, '')                // any stray opening or closing tags left
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')                  // onclick=, onerror=, …
    .replace(/\b(href|src|xlink:href|action|formaction)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'>\s]*/gi, '$1=$2#'); // js: URLs
}
