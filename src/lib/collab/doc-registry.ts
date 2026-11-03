/**
 * doc-registry — a module-level, ref-counted registry of live collaborative
 * documents (Y.Doc + Awareness + SupabaseYjsProvider), keyed by docId.
 *
 * Why this exists: a Yjs document is a long-lived, stateful network resource
 * (an open Realtime channel, a presence identity, a CRDT state). React's render
 * lifecycle is the wrong owner for it. In dev, StrictMode mounts every effect
 * twice (mount → unmount → mount); with per-mount docs that means, on every
 * mount, a brand-new Y.Doc (new clientID), a new channel, and — on the fake
 * unmount — an awareness "removal" broadcast that wipes our presence from peers.
 * Real navigation remounts do the same in production. The result is presence
 * that flickers to "only you" and cursors that never settle.
 *
 * The registry decouples the resource's lifetime from any single mount:
 *   - acquire(docId): first caller creates the doc/awareness/provider; later
 *     callers (a StrictMode remount, a second component on the same doc) share
 *     the exact same instances and just bump a refcount.
 *   - release(docId): decrements the refcount. Real teardown is DEFERRED behind
 *     a short timer, so StrictMode's immediate re-acquire cancels it and nothing
 *     churns. Only when a doc stays unreferenced past the grace window do we
 *     destroy the provider (which announces our departure to peers) and the doc.
 *
 * This keeps exactly one clientID, one channel, and one stable presence identity
 * per document per browser tab, regardless of how React mounts the UI over it.
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseYjsProvider, type CollabStatus } from './supabase-yjs-provider';

type Status = CollabStatus;

export interface CollabHandle {
  ydoc: Y.Doc;
  awareness: Awareness;
  provider: SupabaseYjsProvider;
}

interface Entry extends CollabHandle {
  refs: number;
  teardown?: ReturnType<typeof setTimeout>;
}

const registry = new Map<string, Entry>();

// How long a doc may sit unreferenced before it's really torn down. Long enough
// to bridge StrictMode's unmount→remount gap (and a fast route change), short
// enough that a genuinely-closed doc frees its channel promptly.
const GRACE_MS = 1000;

export interface AcquireOpts {
  /** Realtime topic. Defaults to `drive-doc:<docId>`; live forms pass `form-doc:<submission id>`. */
  channel?: string;
  onStatus?: (status: Status) => void;
  /** Yjs state (Y.encodeStateAsUpdate) to seed a freshly-created doc from. */
  initialState?: Uint8Array | null;
}

/**
 * Get (or create) the shared collab handle for `docId` and take a reference to
 * it. Every acquire must be paired with exactly one release.
 */
export function acquireDoc(
  supabase: SupabaseClient,
  docId: string,
  opts: AcquireOpts = {},
): CollabHandle {
  const topic = opts.channel ?? `drive-doc:${docId}`;
  const existing = registry.get(docId);
  if (existing) {
    // Cancel a pending teardown from a just-released mount (the StrictMode case).
    if (existing.teardown) {
      clearTimeout(existing.teardown);
      existing.teardown = undefined;
    }
    existing.refs += 1;
    // Hand status reporting to the newest consumer and replay the current state
    // so a component that mounts after the channel already connected isn't stuck
    // showing "connecting".
    existing.provider.setStatusHandler(opts.onStatus);
    opts.onStatus?.(existing.provider.status);
    return existing;
  }

  const ydoc = new Y.Doc();
  // Seed persisted state BEFORE the provider connects, so the initial content is
  // already present when we announce our state vector to peers. Applied once,
  // on creation only — remounts reuse this same doc and must not re-seed.
  if (opts.initialState && opts.initialState.length) {
    Y.applyUpdate(ydoc, opts.initialState, 'seed');
  }
  const awareness = new Awareness(ydoc);
  const provider = new SupabaseYjsProvider(supabase, topic, ydoc, awareness, {
    onStatus: opts.onStatus,
  });
  const entry: Entry = { ydoc, awareness, provider, refs: 1 };
  registry.set(docId, entry);
  return entry;
}

/**
 * Release one reference to `docId`. When the last reference goes away the doc is
 * torn down after a short grace window (so an immediate remount can reclaim it).
 */
export function releaseDoc(docId: string): void {
  const entry = registry.get(docId);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0) return;

  // Stop reporting status to a component that's on its way out.
  entry.provider.setStatusHandler(undefined);
  entry.teardown = setTimeout(() => {
    // Still unreferenced after the grace window — really let it go.
    if (entry.refs === 0) {
      entry.provider.destroy();
      entry.awareness.destroy();
      entry.ydoc.destroy();
      registry.delete(docId);
    }
  }, GRACE_MS);
}
