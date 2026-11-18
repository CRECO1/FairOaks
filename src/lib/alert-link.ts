// Reads the link a phone alert carries (/crm/commercial?open=<type>[:<id>]&chat=<room>#<page>) — pure, so the server's link builders
// (push.ts) and the app that reads them (CRMApp) are tested against the same rules.
export const CHAT_ROOM_RE = /^(team|dm:[0-9a-f-]{36}:[0-9a-f-]{36})$/i;
const OPEN_RE = /^([a-z_]+)(?::([0-9a-f-]{36}))?$/i;
/** Types that are about a list rather than one row, so they need no id. */
export const ID_FREE_OPEN_TYPES = ['calls', 'task'] as const;

export type AlertLink = { hash: string; open: { type: string; id: string } | null; chat: string | null };

export function parseAlertLink(raw: string, origin = 'https://x.invalid'): AlertLink | null {
  let u: URL;
  try { u = new URL(raw, origin); } catch { return null; }
  if (!u.pathname.startsWith('/crm')) return null;
  const m = OPEN_RE.exec(u.searchParams.get('open') ?? '');
  const open = m && (m[2] || (ID_FREE_OPEN_TYPES as readonly string[]).includes(m[1])) ? { type: m[1], id: m[2] ?? '' } : null;
  const room = u.searchParams.get('chat') ?? '';
  return { hash: u.hash.slice(1), open, chat: CHAT_ROOM_RE.test(room) ? room : null };
}
