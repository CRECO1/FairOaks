/**
 * SupabaseYjsProvider — a minimal Yjs network provider on a Supabase Realtime *private broadcast* channel.
 * It is the transport for the CRM's live documents (Transaction Docs "Drive").
 *
 * Why hand-rolled: y-websocket / y-webrtc need a persistent socket server or WebRTC signalling, neither of which fits
 * Vercel serverless. Supabase Realtime is already in the stack, so Yjs's own binary update + awareness protocols ride
 * over a broadcast channel named `drive-doc:<docId>`.
 *
 * Security: the channel is `private`, so Realtime checks the policies on realtime.messages
 * (supabase/drive-docs-2026-11.sql) — only people who can open the document may join or send.
 *
 * Model (peers on a shared channel, no authoritative server):
 *   - On subscribe we announce our state vector (sync1); any peer holding updates we lack answers with the diff (sync2).
 *   - Local edits go out as incremental updates, batched ~60 ms so fast typing doesn't exceed Realtime's message-rate limit;
 *     peers apply them with this provider as the origin so they never echo back.
 *   - Awareness (cursor, selection, name/colour) rides the same channel, throttled.
 *   - Every 20 s a visible tab re-announces its state vector, so a dropped message heals itself instead of leaving two
 *     people on different versions until someone reloads.
 *   - Payloads over ~120 KB are split into chunks and reassembled (Realtime caps one message).
 *   - Durable persistence is NOT this file's job: the editor saves merged updates to Postgres through the CRM API.
 */

import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { toBase64, fromBase64 } from 'lib0/buffer';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

const EVENT = 'y';
const BATCH_MS = 60;
const AWARENESS_MS = 120;
const RESYNC_MS = 20_000;
const CHUNK = 120_000; // base64 characters per message

type MsgType = 'sync1' | 'sync2' | 'update' | 'awareness';
interface WireMsg {
  t: MsgType;
  from: number;                                   // sender's Yjs clientID — used to ignore our own echoes
  d: string;                                      // base64 payload (or one chunk of it)
  c?: { id: string; i: number; n: number };       // chunk info when the payload was split
}

export type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'denied';

export interface SupabaseYjsProviderOpts {
  onStatus?: (status: CollabStatus) => void;
}

export class SupabaseYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private readonly channel: RealtimeChannel;
  private readonly clientId: number;
  private destroyed = false;
  private _status: CollabStatus = 'connecting';
  private onStatus?: (status: CollabStatus) => void;
  private pendingUpdates: Uint8Array[] = [];
  private updateTimer?: ReturnType<typeof setTimeout>;
  private pendingAwareness = new Set<number>();
  private awarenessTimer?: ReturnType<typeof setTimeout>;
  private resyncTimer?: ReturnType<typeof setInterval>;
  private chunks = new Map<string, { parts: string[]; got: number; t: MsgType; from: number }>();
  private seq = 0;

  get status(): CollabStatus { return this._status; }

  /** Re-point the status callback (the doc/provider outlives any one React mount). */
  setStatusHandler(fn?: (status: CollabStatus) => void) { this.onStatus = fn; }

  private setStatus(s: CollabStatus) { this._status = s; this.onStatus?.(s); }

  /** @param channelName the full Realtime topic, e.g. `drive-doc:<id>` or `form-doc:<id>` (the realtime.messages policies key off this prefix) */
  constructor(supabase: SupabaseClient, channelName: string, doc: Y.Doc, awareness: Awareness, opts: SupabaseYjsProviderOpts = {}) {
    this.doc = doc;
    this.awareness = awareness;
    this.clientId = doc.clientID;
    this.onStatus = opts.onStatus;

    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', this.onUnload);

    this.setStatus('connecting');
    this.channel = supabase.channel(channelName, {
      config: { private: true, broadcast: { self: false, ack: false } },
    });
    this.channel.on('broadcast', { event: EVENT }, ({ payload }) => this.onMessage(payload as WireMsg));
    this.channel.subscribe((status, err) => {
      if (this.destroyed) return;
      if (status === 'SUBSCRIBED') {
        this.setStatus('connected');
        // Announce our state vector so peers send what we're missing, and push our presence so cursors show immediately.
        this.send('sync1', Y.encodeStateVector(this.doc));
        this.queueAwareness([this.clientId]);
        if (!this.resyncTimer) {
          this.resyncTimer = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            this.send('sync1', Y.encodeStateVector(this.doc));
          }, RESYNC_MS);
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // A policy refusal arrives as CHANNEL_ERROR with an "unauthorized" message; anything else is a plain drop.
        const msg = String((err as { message?: string } | undefined)?.message ?? '');
        this.setStatus(/unauthori|not allowed|denied|permission/i.test(msg) ? 'denied' : 'disconnected');
      }
    });
  }

  // ── local → wire ───────────────────────────────────────────────────────────

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // applied from the network — don't rebroadcast
    this.pendingUpdates.push(update);
    if (!this.updateTimer) this.updateTimer = setTimeout(this.flushUpdates, BATCH_MS);
  };

  private flushUpdates = () => {
    this.updateTimer = undefined;
    if (!this.pendingUpdates.length) return;
    const merged = this.pendingUpdates.length === 1 ? this.pendingUpdates[0] : Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];
    this.send('update', merged);
  };

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === 'remote') return;
    this.queueAwareness([...added, ...updated, ...removed]);
  };

  private queueAwareness(clients: number[]) {
    clients.forEach(c => this.pendingAwareness.add(c));
    if (!this.awarenessTimer) this.awarenessTimer = setTimeout(this.flushAwareness, AWARENESS_MS);
  }

  private flushAwareness = () => {
    this.awarenessTimer = undefined;
    const list = [...this.pendingAwareness];
    this.pendingAwareness.clear();
    if (list.length) this.send('awareness', encodeAwarenessUpdate(this.awareness, list));
  };

  private send(t: MsgType, payload: Uint8Array) {
    if (this.destroyed) return;
    const d = toBase64(payload);
    if (d.length <= CHUNK) {
      void this.channel.send({ type: 'broadcast', event: EVENT, payload: { t, from: this.clientId, d } satisfies WireMsg });
      return;
    }
    const id = `${this.clientId}.${++this.seq}`;
    const n = Math.ceil(d.length / CHUNK);
    for (let i = 0; i < n; i++) {
      void this.channel.send({ type: 'broadcast', event: EVENT, payload: { t, from: this.clientId, d: d.slice(i * CHUNK, (i + 1) * CHUNK), c: { id, i, n } } satisfies WireMsg });
    }
  }

  // ── wire → local ───────────────────────────────────────────────────────────

  private onMessage = (msg: WireMsg) => {
    if (this.destroyed || !msg || msg.from === this.clientId) return;
    if (msg.c) {
      const key = `${msg.from}:${msg.c.id}`;
      let e = this.chunks.get(key);
      if (!e) { e = { parts: new Array(msg.c.n).fill(''), got: 0, t: msg.t, from: msg.from }; this.chunks.set(key, e); }
      if (!e.parts[msg.c.i]) { e.parts[msg.c.i] = msg.d; e.got += 1; }
      if (e.got < msg.c.n) return;
      this.chunks.delete(key);
      if (this.chunks.size > 50) this.chunks.clear(); // a peer that dropped mid-send must not leak memory
      this.handle(msg.t, fromBase64(e.parts.join('')));
      return;
    }
    this.handle(msg.t, fromBase64(msg.d));
  };

  private handle(t: MsgType, data: Uint8Array) {
    switch (t) {
      case 'sync1':
        // A peer announced its state vector — answer with only what it is missing (may be empty).
        this.send('sync2', Y.encodeStateAsUpdate(this.doc, data));
        // Awareness has no late-joiner replay, so re-announce our presence — but never a "removal" mid-teardown.
        if (this.awareness.getLocalState() !== null) this.queueAwareness([this.clientId]);
        break;
      case 'sync2':
      case 'update':
        Y.applyUpdate(this.doc, data, this); // origin = this provider, so onDocUpdate won't rebroadcast it
        break;
      case 'awareness':
        applyAwarenessUpdate(this.awareness, data, 'remote');
        break;
    }
  }

  private onUnload = () => { removeAwarenessStates(this.awareness, [this.clientId], 'window unload'); };

  destroy() {
    if (this.destroyed) return;
    this.flushUpdates();
    this.destroyed = true;
    clearTimeout(this.updateTimer); clearTimeout(this.awarenessTimer); clearInterval(this.resyncTimer);
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this.onUnload);
    removeAwarenessStates(this.awareness, [this.clientId], 'provider destroy');
    void this.channel.unsubscribe();
    this.setStatus('disconnected');
  }
}
