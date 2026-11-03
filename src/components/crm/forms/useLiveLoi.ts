'use client';

/**
 * useLiveLoi — several people edit the same Letter of Intent at once (the on-document LoiBuilder).
 *
 * Same room, channel and access rule as live forms (`form-doc:<submission id>`, see useLiveForm and supabase/forms-live-2026-11.sql);
 * only the shape of the data differs. A letter is a handful of fixed fields (date, addressee, Re:, stipulations, sign-off…), an ORDERED
 * list of term rows (label + value), one or two acceptance blocks, and the attached-exhibit list:
 *   - fixed fields and acceptance blocks → primitive entries in the flat map `s`
 *   - term rows → their text as primitives in `t` (`<id>|label`, `<id>|value`) and their ORDER as a Y.Array of ids, so two people adding
 *     rows at once both get theirs and a reorder is a delete+insert
 *   - exhibits → one JSON string (they're attached/removed whole)
 * Saving is still explicit ("Save"): it regenerates the branded PDF and writes crm_form_submissions, from the shared working copy.
 * Joining works as in forms: take the room's state if anyone is in it, else seed it from the saved copy; nothing is written back from a
 * tab until its first sync has settled.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { createClient } from '@/lib/supabase/client';
import { acquireDoc, releaseDoc, type CollabHandle } from '@/lib/collab/doc-registry';
import type { LivePeer, LiveStatus } from './useLiveForm';
import type { LoiPurchaseData } from '@/lib/loi-spec';

const REQUIRED = ['loiDate', 'addresseeName', 'addresseeAddr1', 'addresseeAddr2', 'reLine', 'additionalTerms', 'agentName', 'agentEmail', 'agentPhone'] as const;
const OPTIONAL = ['intro', 'subtitle', 'variant'] as const;
const LOCAL = 'live-loi-local';
const LOCK_MS = 30_000;
const SETTLE_MS = 900;
const COLORS = ['#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#4f46e5', '#c9922c'];
const colorFor = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; };

type D = LoiPurchaseData;

/** One canonical shape (fixed key order) so "did anything change?" is a plain string compare. */
function canon(d: D): D {
  const o: Record<string, unknown> = {};
  for (const k of REQUIRED) o[k] = d[k] ?? '';
  for (const k of OPTIONAL) if (d[k] !== undefined && d[k] !== null) o[k] = d[k];
  o.terms = d.terms.map(t => ({ id: t.id as string, label: t.label ?? '', value: t.value ?? '' }));
  o.sellers = d.sellers.map(s => ({ entity: s.entity ?? '', signatory: s.signatory ?? '' }));
  if (d.exhibits && d.exhibits.length) o.exhibits = d.exhibits;
  return o as unknown as D;
}
const same = (a: D, b: D) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function project(h: CollabHandle, like: D): D | null {
  const s = h.ydoc.getMap<unknown>('s'), t = h.ydoc.getMap<unknown>('t'), order = h.ydoc.getArray<string>('order');
  const ids = [...new Set(order.toArray())].filter(id => t.has(`${id}|label`) || t.has(`${id}|value`));
  if (!ids.length && !s.size) return null;
  const n = Math.max(1, Math.min(2, Number(s.get('sellerCount') ?? like.sellers.length ?? 1)));
  const out: Record<string, unknown> = { ...like };
  for (const k of REQUIRED) out[k] = (s.get(k) as string | undefined) ?? '';
  for (const k of OPTIONAL) { const v = s.get(k); if (v === undefined) delete out[k]; else out[k] = v; }
  out.terms = ids.map(id => ({ id, label: (t.get(`${id}|label`) as string) ?? '', value: (t.get(`${id}|value`) as string) ?? '' }));
  out.sellers = Array.from({ length: n }, (_, i) => ({ entity: (s.get(`seller${i}|entity`) as string) ?? '', signatory: (s.get(`seller${i}|signatory`) as string) ?? '' }));
  const ex = s.get('exhibits');
  if (typeof ex === 'string') { try { out.exhibits = JSON.parse(ex); } catch { /* keep as is */ } } else delete out.exhibits;
  return out as unknown as D;
}

function write(h: CollabHandle, data: D, base: D | null) {
  const s = h.ydoc.getMap<unknown>('s'), t = h.ydoc.getMap<unknown>('t'), order = h.ydoc.getArray<string>('order');
  const cur = canon(data), old = base ? canon(base) : null;
  const put = (m: Y.Map<unknown>, k: string, v: unknown, was: unknown) => { if (v === was && old) return; if (v === undefined || v === null) m.delete(k); else m.set(k, v); };
  for (const k of REQUIRED) put(s, k, cur[k], old?.[k]);
  for (const k of OPTIONAL) put(s, k, cur[k], old?.[k]);
  put(s, 'sellerCount', cur.sellers.length, old?.sellers.length);
  cur.sellers.forEach((x, i) => { put(s, `seller${i}|entity`, x.entity, old?.sellers[i]?.entity); put(s, `seller${i}|signatory`, x.signatory, old?.sellers[i]?.signatory); });
  if (old) for (let i = cur.sellers.length; i < old.sellers.length; i++) { s.delete(`seller${i}|entity`); s.delete(`seller${i}|signatory`); }
  put(s, 'exhibits', cur.exhibits?.length ? JSON.stringify(cur.exhibits) : undefined, old?.exhibits?.length ? JSON.stringify(old.exhibits) : undefined);
  const oldTerms = new Map((old?.terms ?? []).map(x => [x.id, x]));
  for (const x of cur.terms) { const o = oldTerms.get(x.id); put(t, `${x.id}|label`, x.label, o?.label); put(t, `${x.id}|value`, x.value, o?.value); }
  const curIds = new Set(cur.terms.map(x => x.id));
  for (const id of oldTerms.keys()) if (!curIds.has(id)) { t.delete(`${id}|label`); t.delete(`${id}|value`); }
  // Order: change only the stretch that differs (so two people inserting rows in different places both keep theirs).
  const yIds = order.toArray(), want: string[] = cur.terms.map(x => x.id as string);
  if (JSON.stringify(yIds) !== JSON.stringify(want)) {
    let i = 0; while (i < yIds.length && i < want.length && yIds[i] === want[i]) i++;
    let j = 0; while (j < yIds.length - i && j < want.length - i && yIds[yIds.length - 1 - j] === want[want.length - 1 - j]) j++;
    if (yIds.length - i - j > 0) order.delete(i, yIds.length - i - j);
    if (want.length - i - j > 0) order.insert(i, want.slice(i, want.length - j));
  }
}

export function useLiveLoi(o: {
  submissionId: string | null | undefined;
  enabled: boolean;
  data: D;
  setData: (d: D) => void;
  /** The `data-lk` key of the field this person is in (null when none). */
  selected: string | null;
}) {
  const [status, setStatus] = useState<LiveStatus>('off');
  const [peers, setPeers] = useState<LivePeer[]>([]);
  const [synced, setSynced] = useState(false);
  const [me, setMe] = useState<{ id: string; name: string; color: string } | null>(null);
  const handleRef = useRef<CollabHandle | null>(null);
  const baseRef = useRef<D | null>(null);
  const dataRef = useRef(o.data); dataRef.current = o.data;
  const setDataRef = useRef(o.setData); setDataRef.current = o.setData;

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
      } catch { /* names are cosmetic */ }
    })();
    return () => { off = true; };
  }, [o.enabled]);

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
    h.awareness.setLocalStateField('user', { name: me.name, color: me.color });
    const settled = { current: false };

    const ingest = () => {
      const proj = project(h, dataRef.current);
      if (!proj) return;
      baseRef.current = proj;
      if (!same(proj, dataRef.current)) setDataRef.current(proj);
    };
    const onChange = (ev: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => { if (tr.origin !== LOCAL && settled.current) ingest(); void ev; };
    h.ydoc.getMap('s').observeDeep(onChange); h.ydoc.getMap('t').observeDeep(onChange); h.ydoc.getArray('order').observeDeep(onChange);

    const refreshPeers = () => {
      const list: LivePeer[] = [];
      h.awareness.getStates().forEach((st, clientId) => {
        if (clientId === h.ydoc.clientID) return;
        const x = st as { user?: { name: string; color: string }; sel?: string | null; selAt?: number };
        if (x.user?.name) list.push({ clientId, name: x.user.name, color: x.user.color, sel: x.sel ?? null, selAt: x.selAt ?? 0 });
      });
      setPeers(list);
    };
    h.awareness.on('change', refreshPeers); refreshPeers();

    let settle: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled.current) return;
      settled.current = true;
      const proj = project(h, dataRef.current);
      if (proj) ingest();                                   // someone is here: take their state
      else { h.ydoc.transact(() => write(h, dataRef.current, null), LOCAL); baseRef.current = dataRef.current; }  // empty room: the saved letter seeds it
      setSynced(true);
    };
    const poll = setInterval(() => {
      if (h.provider.status === 'connected' && !settle && !settled.current) settle = setTimeout(finish, SETTLE_MS);
      if (settled.current) clearInterval(poll);
    }, 150);

    return () => {
      clearInterval(poll); clearTimeout(settle);
      h.ydoc.getMap('s').unobserveDeep(onChange); h.ydoc.getMap('t').unobserveDeep(onChange); h.ydoc.getArray('order').unobserveDeep(onChange);
      h.awareness.off('change', refreshPeers); h.awareness.setLocalState(null);
      handleRef.current = null; baseRef.current = null; setSynced(false); setPeers([]);
      releaseDoc(`form:${id}`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.enabled, o.submissionId, me]);

  // Local edits -> the room.
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !synced || !o.enabled) return;
    if (baseRef.current && same(baseRef.current, o.data)) return;
    h.ydoc.transact(() => write(h, o.data, baseRef.current), LOCAL);
    baseRef.current = o.data;
    if (o.selected) h.awareness.setLocalStateField('selAt', Date.now());
  }, [o.data, synced, o.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const a = handleRef.current?.awareness; if (!a) return;
    a.setLocalStateField('sel', o.selected); a.setLocalStateField('selAt', Date.now());
  }, [o.selected, synced, status]);

  const [, tick] = useState(0);
  useEffect(() => {
    if (!peers.some(p => p.sel)) return;
    const t = setInterval(() => tick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, [peers]);
  const lockOf = useCallback((key: string) => peers.find(p => p.sel === key && Date.now() - p.selAt < LOCK_MS) ?? null, [peers]);
  const lockedKeys = peers.filter(p => p.sel && Date.now() - p.selAt < LOCK_MS);

  return { status: o.enabled ? status : ('off' as LiveStatus), peers, synced, lockOf, lockedKeys };
}
