/**
 * Serialise a JSON-LD graph for embedding in a <script type="application/ld+json">.
 *
 * `JSON.stringify` does not escape `<`, so any string that contains the literal
 * sequence `</script>` closes the tag early and everything after it is parsed as
 * HTML. Most of this site's structured data is hand-written, but the listing and
 * neighbourhood pages interpolate MLS-sourced text, which we do not control.
 *
 * Escaping `<`, `>` and `&` as unicode escapes keeps the payload valid JSON —
 * consumers decode it identically — while making tag breakout impossible.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
