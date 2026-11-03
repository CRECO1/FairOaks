import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  // Trimmed: the key in the host's env has a trailing newline. REST calls tolerate it (it is stripped from the header), but
  // Realtime puts the key in the websocket URL as `apikey=…%0A`, and the socket never connects — live docs stayed on "Reconnecting".
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim(),
    { cookieOptions: { sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' } },
  );
}
