'use client';
/**
 * Remembers "I just tapped a phone number" so the CRM can ask how the call went when
 * you come back. Calls made from a cell phone or FaceTime never reach the log; this is
 * how they get in. Kept in localStorage (not sessionStorage): on a phone, the browser
 * may reload the tab when you return from the Phone app, and a pending call must survive that.
 */
export interface PendingCall {
  /** Last 10 digits of the number tapped. */
  number: string;
  name: string | null;
  contact_id: string | null;
  /** The inbound call-back this tap is returning, when it came from a Calling Log row. */
  call_id: string | null;
  /** True when that row is still waiting on a call-back. */
  pending: boolean;
  /** Epoch ms of the tap. */
  at: number;
}

const KEY = 'crm:pending-calls';
const OLD_KEY = 'crm:pending-call';   // single-slot version: tapping a second number used to wipe the first
const MAX_AGE_MS = 24 * 3600_000;
const MAX_KEPT = 12;

function readAll(): PendingCall[] {
  try {
    let list = JSON.parse(localStorage.getItem(KEY) || 'null') as PendingCall[] | null;
    if (!Array.isArray(list)) list = [];
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null') as PendingCall | null;
    if (old) { list.push(old); localStorage.removeItem(OLD_KEY); localStorage.setItem(KEY, JSON.stringify(list)); }
    return list.filter(p => p && Date.now() - p.at < MAX_AGE_MS).sort((a, b) => b.at - a.at);
  } catch { return []; }
}
function saveAll(list: PendingCall[]): void { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_KEPT))); } catch { /* storage blocked: the prompt just won't survive a reload */ } }

/** The newest call still waiting for an outcome. */
export function readPendingCall(): PendingCall | null { return readAll()[0] ?? null; }
/** Every call tapped but not yet logged, newest first (a second tap no longer wipes the first). */
export function readPendingCalls(): PendingCall[] { return readAll(); }
export function writePendingCall(p: PendingCall): void {
  // Tapping the same number again replaces its own earlier tap; other numbers stay in the queue.
  saveAll([p, ...readAll().filter(x => x.number !== p.number)]);
}
/** Drop one pending call (by its tap time), or the newest when none is named. */
export function clearPendingCall(at?: number): void {
  const list = readAll();
  const target = at ?? list[0]?.at;
  saveAll(list.filter(x => x.at !== target));
}
