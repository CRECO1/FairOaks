// Shared bits of TeamChat (server routes + page). Rooms: 'team' (everyone in the workspace) or 'dm:<idA>:<idB>' (ids sorted).
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DM_RE = new RegExp(`^dm:(${UUID}):(${UUID})$`, 'i');
export const MAX_BODY = 4000;
export const dmRoom = (a: string, b: string) => `dm:${[a.toLowerCase(), b.toLowerCase()].sort().join(':')}`;
/** The other person in a DM room, or null when `me` is not one of its two people (or it is not a DM room). */
export function dmOther(room: string, me: string): string | null {
  const m = DM_RE.exec(room); if (!m) return null;
  const [a, b] = [m[1].toLowerCase(), m[2].toLowerCase()], x = me.toLowerCase();
  if (a === b) return null;
  return x === a ? b : x === b ? a : null;
}
export const isDmRoom = (room: string) => DM_RE.test(room);
