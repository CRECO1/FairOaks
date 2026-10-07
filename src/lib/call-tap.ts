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

const KEY = 'crm:pending-call';
const MAX_AGE_MS = 6 * 3600_000;

export function readPendingCall(): PendingCall | null {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || 'null') as PendingCall | null;
    return j && Date.now() - j.at < MAX_AGE_MS ? j : null;
  } catch { return null; }
}
export function writePendingCall(p: PendingCall): void { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked: the prompt just won't survive a reload */ } }
export function clearPendingCall(): void { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
