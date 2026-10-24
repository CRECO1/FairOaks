/**
 * Escape LIKE/ILIKE wildcards so a user-supplied string matches literally. PostgREST has no
 * case-insensitive `eq`, so `.ilike('email', escapeLike(x))` is the exact case-insensitive match.
 */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, c => '\\' + c);
}
