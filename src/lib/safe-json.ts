/**
 * Parse a JSON response from an external API without throwing.
 *
 * `await res.json()` throws when the upstream returns an HTML error page, an
 * empty body, or a gateway timeout — which in an OAuth callback or a cron route
 * surfaces as an unhandled 500 rather than the route's own error branch.
 *
 * Returns `null` on a non-OK status or an unparseable body, having logged the
 * status and a snippet of what actually came back. Callers must handle null;
 * it is deliberately not `{}` so that array-shaped responses can't silently
 * turn into an object with no `.length`.
 */
export async function safeJson<T>(res: Response, context: string): Promise<T | null> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[${context}] upstream HTTP ${res.status}`, body.slice(0, 500));
    return null;
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    console.error(`[${context}] upstream returned a non-JSON body`, e);
    return null;
  }
}
