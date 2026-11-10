'use client';

/**
 * useLiveForm — several people fill the same transaction form at once.
 *
 * The form is a list of blanks (id, page, position, value, …). Each blank is shared as a handful of PRIMITIVE entries in one flat
 * Yjs map (`<id>|value`, `<id>|fx`, … plus `<id>|_` marking that the blank exists), carried over a Supabase Realtime private channel
 * `form-doc:<submission id>` (see lib/collab and supabase/forms-live-2026-11.sql for who may join). Flat primitives, not nested
 * objects, on purpose: two people who join an empty room and both seed it write identical values to identical keys, which merges
 * to the same thing — nested maps would let one seed silently replace the other's.
 *
 * Saving is NOT live: "Save to deal" still builds the PDF and writes crm_form_submissions as before, from the shared working copy.
 *
 * Joining: the saved copy is only used to seed the room when nobody else is in it. A person arriving while others are editing takes
 * THEIR (newer) state, and nothing is written back from this tab until that first sync has settled — so opening an old saved copy
 * can never overwrite what teammates have already typed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { createClient } from '@/lib/supabase/client';
import { acquireDoc, releaseDoc, type CollabHandle } from '@/lib/collab/doc-registry';

export interface LiveField {
  id: string; page: number; fx: number; fy: number; fw: number; value: string; size: number; type: string;
  signerRole?: string; signerKey?: string; signerEmail?: string; signerName?: string; fieldKey?: string; label?: string; defaultValue?: string;
}
export interface LivePeer { clientId: number; name: string; color: string; sel: string | null; selAt: number }
export type LiveStatus = 'off' | 'connecting' | 'live' | 'denied' | 'offline';

const PROPS = ['page', 'fx', 'fy', 'fw', 'value', 'size', 'type', 'signerRole', 'signerKey', 'signerEmail', 'signerName', 'signerIndex', 'fieldKey', 'label', 'defaultValue'] as const;   // signerIndex too: dropping it falls back to matching a spot to a signer by ROLE
const COLORS = ['#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#4f46e5', '#c9922c'];
const LOCAL = 'live-form-local';
const LOCK_MS = 30_000;  // a selected blank stays reserved for its person for this long after their last move / keystroke
const SETTLE_MS = 900;   // how long a newcomer waits for the people already in the room to hand over their state

const colorFor = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; };
const same = (a: LiveField[], b: LiveField[]) => JSON.stringify(a) === JSON.stringify(b);

function project<T extends LiveField>(map: Y.Map<unknown>): T[] {
  const order = new Map<string, number>();
  map.forEach((v, k) => { if (k.endsWith('|_')) order.set(k.slice(0, -2), Number(v) || 0); });
  const out: T[] = [];
  for (const [id] of order) {
    const g = (p: string) => map.get(`${id}|${p}`);
    out.push({
      id, page: (g('page') as number) ?? 1, fx: (g('fx') as number) ?? 0, fy: (g('fy') as number) ?? 0, fw: (g('fw') as number) ?? 0.1,
      value: (g('value') as string) ?? '', size: (g('size') as number) ?? 11, type: (g('type') as string) ?? 'text',
      signerRole: g('signerRole') as string | undefined, signerKey: g('signerKey') as string | undefined,
      signerEmail: g('signerEmail') as string | undefined, signerName: g('signerName') as string | undefined,
      fieldKey: g('fieldKey') as string | undefined, label: g('label') as string | undefined, defaultValue: g('defaultValue') as string | undefined,
    } as T);
  }
  return out.sort((a, b) => (order.get(a.id)! - order.get(b.id)!) || a.id.localeCompare(b.id));
}

export function useLiveForm<T extends LiveField>(o: {
  submissionId: string | null | undefined;
  enabled: boolean;
  fields: T[];
  setFields: (fs: T[]) => void;
  selected: string | null;
}) {
  const [status, setStatus] = useState<LiveStatus>('off');
  const [peers, setPeers] = useState<LivePeer[]>([]);
  const [synced, setSynced] = useState(false);
  const [me, setMe] = useState<{ id: string; name: string; color: string } | null>(null);
  const handleRef = useRef<CollabHandle | null>(null);
  const baseRef = useRef<Map<string, T>>(new Map());      // the blanks as last exchanged with the room
  const fieldsRef = useRef(o.fields); fieldsRef.current = o.fields;
  const setFieldsRef = useRef(o.setFields); setFieldsRef.current = o.setFields;
  const adoptedRef = useRef(false);                        // the room had state and this tab took it

  // Who am I (name for the presence label)?
  useEffect(() => {
    if (!o.enabled) return;
    let off = false;
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user || off) return;
        const { data } = await sb.from('crm_profiles').select('first_name,last_name').eq('id', user.id).maybeSingle();
        const name = `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim() || user.email?.split('@')[0] || 'Teammate';
        if (!off) setMe({ id: user.id, name, color: colorFor(user.id) });
      } catch { /* presence names are cosmetic */ }
    })();
    return () => { off = true; };
  }, [o.enabled]);

  // Connect.
  useEffect(() => {
    const id = o.submissionId;
    if (!o.enabled || !id || !me) { setStatus('off'); return; }
    const sb = createClient();
    sb.auth.getSession().then(({ data }) => { if (data.session?.access_token) sb.realtime.setAuth(data.session.access_token); });
    const h = acquireDoc(sb, `form:${id}`, {
      channel: `form-doc:${id}`,
      onStatus: s => setStatus(s === 'connected' ? 'live' : s === 'denied' ? 'denied' : s === 'connecting' ? 'connecting' : 'offline'),
    });
    handleRef.current = h;
    const map = h.ydoc.getMap<unknown>('f');
    h.awareness.setLocalStateField('user', { name: me.name, color: me.color });

    const ingest = () => {
      const proj = project<T>(map);
      adoptedRef.current = proj.length > 0 || adoptedRef.current;
      baseRef.current = new Map(proj.map(f => [f.id, { ...f }]));
      if (!same(proj, fieldsRef.current)) setFieldsRef.current(proj);
    };
    const onMap = (ev: Y.YMapEvent<unknown>) => { if (ev.transaction.origin !== LOCAL && synced0.current) ingest(); };
    const synced0 = { current: false };
    map.observe(onMap);

    const refreshPeers = () => {
      const list: LivePeer[] = [];
      h.awareness.getStates().forEach((s, clientId) => {
        if (clientId === h.ydoc.clientID) return;
        const st = s as { user?: { name: string; color: string }; sel?: string | null; selAt?: number };
        if (st.user?.name) list.push({ clientId, name: st.user.name, color: st.user.color, sel: st.sel ?? null, selAt: st.selAt ?? 0 });
      });
      setPeers(list);
    };
    h.awareness.on('change', refreshPeers);
    refreshPeers();

    // Once connected, give the people already here a moment to hand over their state, then either adopt it or seed the room.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (synced0.current) return;
      synced0.current = true;
      if ([...map.keys()].some(k => k.endsWith('|_'))) ingest();    // the room has state: take it
      else {                                                         // empty room: the saved copy seeds it
        const seed = fieldsRef.current;
        h.ydoc.transact(() => seed.forEach((f, i) => writeField(map, f, i)), LOCAL);
        baseRef.current = new Map(seed.map(f => [f.id, { ...f }]));
      }
      setSynced(true);
    };
    const poll = setInterval(() => {
      if (h.provider.status === 'connected' && !settle && !synced0.current) settle = setTimeout(finish, SETTLE_MS);
      if (synced0.current) clearInterval(poll);
    }, 150);

    return () => {
      clearInterval(poll); clearTimeout(settle);
      map.unobserve(onMap); h.awareness.off('change', refreshPeers);
      h.awareness.setLocalState(null);
      handleRef.current = null; adoptedRef.current = false; baseRef.current = new Map();
      setSynced(false); setPeers([]);
      releaseDoc(`form:${id}`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.enabled, o.submissionId, me]);

  // Local edits -> the room (only once this tab has settled with it).
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !synced || !o.enabled) return;
    const map = h.ydoc.getMap<unknown>('f');
    const cur = new Map(o.fields.map(f => [f.id, f]));
    const base = baseRef.current;
    let changed = false;
    h.ydoc.transact(() => {
      for (const [id, f] of cur) {
        const b = base.get(id);
        if (!b) { writeField(map, f, undefined); changed = true; continue; }
        for (const p of PROPS) {
          const v = (f as unknown as Record<string, unknown>)[p], old = (b as unknown as Record<string, unknown>)[p];
          if (v !== old) { if (v === undefined || v === null) map.delete(`${id}|${p}`); else map.set(`${id}|${p}`, v); changed = true; }
        }
      }
      for (const id of base.keys()) if (!cur.has(id)) { for (const p of ['_', ...PROPS]) map.delete(`${id}|${p}`); changed = true; }
    }, LOCAL);
    if (changed) {
      baseRef.current = new Map(o.fields.map(f => [f.id, { ...f }]));
      if (o.selected) h.awareness.setLocalStateField('selAt', Date.now());   // typing keeps my blank reserved
    }
  }, [o.fields, synced, o.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which blank I'm in (for the others' outlines and the soft lock).
  useEffect(() => {
    const a = handleRef.current?.awareness; if (!a) return;
    a.setLocalStateField('sel', o.selected); a.setLocalStateField('selAt', Date.now());
  }, [o.selected, synced, status]);

  // A reservation lapses after LOCK_MS of inactivity (re-checked every few seconds), so a blank someone walked away from frees up.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!peers.some(p => p.sel)) return;
    const t = setInterval(() => tick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, [peers]);
  const lockOf = useCallback((id: string) => peers.find(p => p.sel === id && Date.now() - p.selAt < LOCK_MS) ?? null, [peers]);

  const hasLiveState = useCallback(() => adoptedRef.current, []);
  return { status: o.enabled ? status : ('off' as LiveStatus), peers, synced, hasLiveState, lockOf };
}

function writeField(map: Y.Map<unknown>, f: LiveField, index: number | undefined) {
  map.set(`${f.id}|_`, index ?? Date.now());
  for (const p of PROPS) {
    const v = (f as unknown as Record<string, unknown>)[p];
    if (v !== undefined && v !== null) map.set(`${f.id}|${p}`, v);
  }
}
