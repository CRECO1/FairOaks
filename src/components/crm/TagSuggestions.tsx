'use client';
import React, { useEffect, useMemo, useState } from 'react';

type Source = 'contact' | 'activity' | 'call' | 'callsummary';
type Item = { source: Source; row_id: string; contact_id: string | null; contact: string; listing_id: string; listing: string; before: string; after: string; at: string | null; outreach?: boolean; safe?: boolean; verdict?: string; hint?: string; text?: string };
type Group = { listing_id: string; listing: string; n: number; outreach?: number; bySource: Partial<Record<Source, number>> };
type Undo = { source: Source; row_id: string; listing_id: string; before: string; after: string; tags_before: string[] };
const VRANK: Record<string, number> = { inquiry: 0, two: 1, general: 2, owner: 3, research: 3, system: 3 };
const vrank = (v?: string) => VRANK[v ?? 'general'] ?? 2;
const SRC = { contact: 'Contact notes', activity: 'Logged note', call: 'Call note', callsummary: 'Call summary' } as const;

/**
 * Review old notes that name a property without a '#'. Nothing changes until you approve: "Tag it" on one note, or "Tag all N" for a whole
 * property (with a before/after preview first). "Not it" hides a row on this device. After a batch, "Undo" puts the old text back (only on
 * notes nobody has edited since). Admins only (the API refuses everyone else).
 */
export default function TagSuggestions({ authToken, onClose, onToast, onChanged, onOpenContact }: { authToken?: string; onClose: () => void; onToast: (m: string) => void; onChanged?: () => void; onOpenContact?: (id: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [tenantsOut, setTenantsOut] = useState(0);
  const [logOut, setLogOut] = useState(0);
  const [cardMode, setCardMode] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 640); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const [cardPos, setCardPos] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ label: string; rows: Undo[]; targeted?: { row_id: string; listing_id: string }[]; skipped?: { source: string; row_id: string; listing_id: string }[] } | null>(null);
  const h = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  const load = () => fetch('/api/crm/tag-suggestions', { headers: h }).then(r => (r.ok ? r.json() : null)).then(j => { setItems(j?.items ?? []); setGroups(j?.groups ?? []); setTotal(j?.total ?? 0); setTenantsOut(j?.tenantsLeftOut ?? 0); setLogOut(j?.logLinesLeftOut ?? 0); }).catch(() => setItems([]));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const key = (i: { source: string; row_id: string }) => `${i.source}:${i.row_id}`;
  // "Not it" is remembered for the whole team (stored on the server), and can be undone.
  const skip = async (i: Item) => {
    const r = await fetch('/api/crm/tag-suggestions', { method: 'POST', headers: h, body: JSON.stringify({ mode: 'skip', listing_id: i.listing_id, items: [{ source: i.source, row_id: i.row_id }] }) }).catch(() => null);
    const j = r?.ok ? await r.json() : null;
    if (!j) { onToast('Could not save that'); return; }
    setItems(cur => (cur ?? []).filter(x => key(x) !== key(i)));
    setUndo({ label: `${i.contact} (not it)`, rows: [], skipped: j.skipped });
    onChanged?.();
  };
  const live = useMemo(() => items ?? [], [items]);
  const byGroup = useMemo(() => { const m = new Map<string, Item[]>(); for (const i of live) m.set(i.listing_id, [...(m.get(i.listing_id) ?? []), i]); return m; }, [live]);

  const post = async (listingId: string, rows: Item[]) => {
    const r = await fetch('/api/crm/tag-suggestions', { method: 'POST', headers: h, body: JSON.stringify({ listing_id: listingId, items: rows.map(i => ({ source: i.source, row_id: i.row_id })) }) }).catch(() => null);
    if (!r?.ok) return null;
    return (await r.json()) as { done: number; failed: number; undo: Undo[] };
  };
  const applyRows = async (listingId: string, rows: Item[], label: string) => {
    setBusy(listingId + rows.length);
    const out = await post(listingId, rows);
    setBusy(null);
    if (!out) { onToast('Could not tag those (the notes may have changed)'); return; }
    const done = new Set(out.undo.map(u => key(u)));
    setItems(cur => (cur ?? []).filter(x => !done.has(key(x))));
    setUndo({ label, rows: out.undo });
    onChanged?.();
    onToast(`Tagged ${out.done} note${out.done === 1 ? '' : 's'}${out.failed ? ` (${out.failed} had changed and were skipped)` : ''}`);
  };
  // "Apply the safe ones": every note that says it is an inquiry ("Engaged:", "Crexi lead", "asked about"…) and is not an outreach list, across all
  // properties, in batches per property. One Undo puts them all back (only notes nobody has edited since).
  const safeRows = useMemo(() => live.filter(i => i.safe), [live]);
  const safeProps = useMemo(() => new Set(safeRows.map(i => i.listing_id)).size, [safeRows]);
  const applySafe = async () => {
    if (!safeRows.length || !window.confirm(`Tag ${safeRows.length} notes across ${safeProps} propert${safeProps === 1 ? 'y' : 'ies'}? Only notes that say they are inquiries (not outreach lists) are included, only the address in each note changes, and one Undo puts them all back.`)) return;
    setBusy('safe');
    const all: Undo[] = []; let failed = 0;
    const byL = new Map<string, Item[]>(); for (const r of safeRows) byL.set(r.listing_id, [...(byL.get(r.listing_id) ?? []), r]);
    for (const [lid, rows] of byL) {
      for (let i = 0; i < rows.length; i += 500) {
        const out = await post(lid, rows.slice(i, i + 500));
        if (!out) { failed += Math.min(500, rows.length - i); continue; }
        all.push(...out.undo); failed += out.failed;
      }
    }
    setBusy(null);
    const done = new Set(all.map(u => key(u)));
    setItems(cur => (cur ?? []).filter(x => !done.has(key(x))));
    setUndo({ label: `${safeProps} propert${safeProps === 1 ? 'y' : 'ies'}`, rows: all });
    onChanged?.();
    onToast(`Tagged ${all.length} note${all.length === 1 ? '' : 's'}${failed ? ` (${failed} had changed and were skipped)` : ''}`);
  };
  // Outreach lists: "we contacted them about this property". Recorded separately (🎯 targeted), the note text is not touched, and it never counts as an inquiry.
  const markTargeted = async (listingId: string, listing: string, rows: Item[], ask = true) => {
    const mine = rows.filter(r => r.source === 'contact').slice(0, 500);
    if (!mine.length || (ask && !window.confirm(`Mark ${mine.length} contact${mine.length === 1 ? '' : 's'} as targeted for ${listing}? Their notes are not changed, and they do not count as inquiries. You can undo.`))) return;
    setBusy('t' + listingId);
    const r = await fetch('/api/crm/tag-suggestions', { method: 'POST', headers: h, body: JSON.stringify({ mode: 'targeted', listing_id: listingId, items: mine.map(i => ({ source: i.source, row_id: i.row_id })) }) }).catch(() => null);
    const j = r?.ok ? await r.json() : null;
    setBusy(null);
    if (!j) { onToast('Could not mark those'); return; }
    const gone = new Set(mine.map(i => key(i)));
    setItems(cur => (cur ?? []).filter(x => !gone.has(key(x))));
    setUndo({ label: `${listing} (targeted)`, rows: [], targeted: j.added });
    onChanged?.();
    onToast(`Marked ${j.done} as targeted for ${listing}`);
  };
  // One card at a time: the whole note, who it is about, and big buttons (keys A / T / N / S, ← →). Inquiry-looking notes first.
  const queue = useMemo(() => [...live].sort((a, b) => vrank(a.verdict) - vrank(b.verdict)), [live]);
  const cur = queue[Math.min(cardPos, Math.max(0, queue.length - 1))];
  const act = async (kind: 'tag' | 'target' | 'skip' | 'later') => {
    if (!cur || busy !== null) return;
    if (kind === 'later') { setCardPos(p => Math.min(p + 1, Math.max(0, queue.length - 1))); return; }
    if (kind === 'tag') await applyRows(cur.listing_id, [cur], cur.listing);
    else if (kind === 'target') { if (cur.source !== 'contact') return; await markTargeted(cur.listing_id, cur.listing, [cur], false); }
    else await skip(cur);
  };
  useEffect(() => {
    if (!cardMode) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'a') { e.preventDefault(); void act('tag'); } else if (k === 't') { e.preventDefault(); void act('target'); } else if (k === 'n') { e.preventDefault(); void act('skip'); }
      else if (k === 's' || k === 'arrowright') { e.preventDefault(); void act('later'); } else if (k === 'arrowleft') { e.preventDefault(); setCardPos(p => Math.max(0, p - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line
  // Bulk by the suggested answer: every note whose hint says "Looks like an inquiry" (tag them), or "Looks like a general note" (hide them as Not it, for the
  // whole team). Outreach lists and phone-call summaries are left out (those have their own buttons / are reviewed by hand). Preview first, one Undo.
  const bulkInq = useMemo(() => live.filter(i => i.source !== 'callsummary' && !i.outreach && i.verdict === 'inquiry'), [live]);
  const bulkGen = useMemo(() => live.filter(i => i.source !== 'callsummary' && !i.outreach && i.verdict === 'general'), [live]);
  const bulkOther = useMemo(() => live.filter(i => i.source !== 'callsummary' && (i.verdict === 'owner' || i.verdict === 'research' || i.verdict === 'system')), [live]);
  // Outreach-list entries (we contacted them): one tap marks them all as targeted, whatever property they are on. Owners and research are never in this list.
  const bulkTarget = useMemo(() => live.filter(i => i.source === 'contact' && i.outreach && i.verdict !== 'owner' && i.verdict !== 'research' && i.verdict !== 'system' && i.verdict !== 'two'), [live]);
  const sample = (rows: Item[], tagged: boolean) => rows.slice(0, 3).map(r => `• ${r.contact}: …${(tagged ? r.after : r.before).replace(/\s+/g, ' ').slice(0, 110)}…`).join('\n');
  const applyInquiries = async () => {
    if (!bulkInq.length || !window.confirm(`Tag ${bulkInq.length} notes that look like inquiries? Only the address in each note changes, and one Undo puts them all back.\n\nExamples:\n${sample(bulkInq, true)}`)) return;
    setBusy('bulk');
    const all: Undo[] = []; let failed = 0;
    const byL = new Map<string, Item[]>(); for (const r of bulkInq) byL.set(r.listing_id, [...(byL.get(r.listing_id) ?? []), r]);
    for (const [lid, rows] of byL) for (let i = 0; i < rows.length; i += 500) {
      const out = await post(lid, rows.slice(i, i + 500));
      if (!out) { failed += Math.min(500, rows.length - i); continue; }
      all.push(...out.undo); failed += out.failed;
    }
    setBusy(null);
    const done = new Set(all.map(u => key(u)));
    setItems(cur => (cur ?? []).filter(x => !done.has(key(x))));
    setUndo({ label: 'the inquiry-looking notes', rows: all });
    onChanged?.();
    onToast(`Tagged ${all.length} note${all.length === 1 ? '' : 's'}${failed ? ` (${failed} had changed and were skipped)` : ''}`);
  };
  const hideRows = async (rows0: Item[], what: string) => {
    if (!rows0.length || !window.confirm(`Hide ${rows0.length} notes that look like ${what} (Not it, for the whole team)? Their text is not changed, and one Undo brings them all back.\n\nExamples:\n${sample(rows0, false)}`)) return;
    setBusy('bulk');
    const hidden: { source: string; row_id: string; listing_id: string }[] = [];
    const byL = new Map<string, Item[]>(); for (const r of rows0) byL.set(r.listing_id, [...(byL.get(r.listing_id) ?? []), r]);
    for (const [lid, rows] of byL) for (let i = 0; i < rows.length; i += 500) {
      const r = await fetch('/api/crm/tag-suggestions', { method: 'POST', headers: h, body: JSON.stringify({ mode: 'skip', listing_id: lid, items: rows.slice(i, i + 500).map(x => ({ source: x.source, row_id: x.row_id })) }) }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      if (j?.skipped) hidden.push(...j.skipped);
    }
    setBusy(null);
    const gone = new Set(hidden.map(x => `${x.source}:${x.row_id}`));
    setItems(cur => (cur ?? []).filter(x => !gone.has(key(x))));
    setUndo({ label: `the ${what.replace(/^an? /, '')}`, rows: [], skipped: hidden });
    onChanged?.();
    onToast(`Hid ${hidden.length} note${hidden.length === 1 ? '' : 's'}`);
  };
  const targetAll = async () => {
    if (!bulkTarget.length || !window.confirm(`Mark ${bulkTarget.length} contact${bulkTarget.length === 1 ? '' : 's'} as targeted (we reached out to them)? Their notes are not changed, they do not count as inquiries, and one Undo reverses it.\n\nExamples:\n${sample(bulkTarget, false)}`)) return;
    setBusy('bulk');
    const added: { row_id: string; listing_id: string }[] = [];
    const byL = new Map<string, Item[]>(); for (const r of bulkTarget) byL.set(r.listing_id, [...(byL.get(r.listing_id) ?? []), r]);
    for (const [lid, rows] of byL) for (let i = 0; i < rows.length; i += 500) {
      const r = await fetch('/api/crm/tag-suggestions', { method: 'POST', headers: h, body: JSON.stringify({ mode: 'targeted', listing_id: lid, items: rows.slice(i, i + 500).map(x => ({ source: x.source, row_id: x.row_id })) }) }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      if (j?.added) added.push(...j.added);
    }
    setBusy(null);
    const gone = new Set(bulkTarget.filter(x => added.some(a => a.row_id === x.row_id && a.listing_id === x.listing_id)).map(x => key(x)));
    setItems(cur => (cur ?? []).filter(x => !gone.has(key(x))));
    setUndo({ label: 'the outreach-list entries (targeted)', rows: [], targeted: added });
    onChanged?.();
    onToast(`Marked ${added.length} as targeted`);
  };
  const hideGeneral = () => hideRows(bulkGen, 'general notes');
  const hideOther = () => hideRows(bulkOther, 'owner research, landlord / owner contacts or system messages');
  const doUndo = async () => {
    if (!undo) return;
    let restored = 0, skipped = 0, ok = true;
    if (undo.skipped?.length) {
      const r = await fetch('/api/crm/tag-suggestions', { method: 'PUT', headers: h, body: JSON.stringify({ unskip: undo.skipped }) }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      if (!j) ok = false; else restored += j.restored;
    }
    if (undo.targeted?.length) {
      for (let i = 0; i < undo.targeted.length; i += 500) {
        const r = await fetch('/api/crm/tag-suggestions', { method: 'PUT', headers: h, body: JSON.stringify({ untarget: undo.targeted.slice(i, i + 500) }) }).catch(() => null);
        const j = r?.ok ? await r.json() : null;
        if (!j) { ok = false; break; }
        restored += j.restored;
      }
    }
    for (let i = 0; ok && i < undo.rows.length; i += 500) {
      const r = await fetch('/api/crm/tag-suggestions', { method: 'PUT', headers: h, body: JSON.stringify({ undo: undo.rows.slice(i, i + 500) }) }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      if (!j) { ok = false; break; }
      restored += j.restored; skipped += j.skipped;
    }
    onToast(ok ? `Undone: ${restored} restored${skipped ? `, ${skipped} left alone (edited since)` : ''}` : 'Could not undo');
    setUndo(null); onChanged?.(); load();
  };

  return (
    <div role="dialog" aria-label="Suggested property tags" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--k-fff, #fff)', width: 'min(720px, 100%)', maxHeight: '88vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: '18px 18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>🏠 Suggested property tags</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', marginBottom: 12 }}>
          Old notes that name one of our properties but were never tagged. Tagging changes only that address in the note into a # tag, so it counts on the property. Nothing changes until you tap, and a batch can be undone.
          {items && ` ${live.length} left to review${total > live.length ? ` (of ${total})` : ''}.`}{tenantsOut > 0 && ` ${tenantsOut} notes that are current tenants' rent-roll lines are left out.`}{logOut > 0 && ` ${logOut} system log line${logOut === 1 ? ' (a stage move or completed task) is' : 's (stage moves, completed tasks) are'} kept out of this list.`}
        </div>
        {undo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--k-f0fdfa, #f0fdfa)', border: '1px solid var(--k-99f6e4, #99f6e4)', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
            <span style={{ flex: 1 }}>{undo.skipped ? `Hid ${undo.skipped.length} note${undo.skipped.length === 1 ? '' : 's'}` : undo.targeted ? `Marked ${undo.targeted.length} contact${undo.targeted.length === 1 ? '' : 's'}` : `Tagged ${undo.rows.length} note${undo.rows.length === 1 ? '' : 's'}`} for {undo.label}.</span>
            <button onClick={doUndo} style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', cursor: 'pointer' }}>Undo</button>
          </div>
        )}
        {items && !cardMode && (bulkInq.length > 0 || bulkGen.length > 0 || bulkOther.length > 0 || bulkTarget.length > 0) && (
          <div style={{ border: '1px solid var(--k-e5e7eb, #e5e7eb)', borderRadius: 12, padding: '10px 12px', marginBottom: 12, background: 'var(--k-f9fafb, #f9fafb)' }}>
            <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', marginBottom: 8 }}>Bulk by the suggested answer (you see examples first, and one Undo reverses it):</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {bulkInq.length > 0 && <button disabled={busy !== null} onClick={applyInquiries} style={{ fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 18, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>{busy === 'bulk' ? 'Working…' : `🏠 Tag the ${bulkInq.length} that look like inquiries`}</button>}
              {bulkTarget.length > 0 && <button disabled={busy !== null} onClick={targetAll} title="Outreach-list lines (prospect —, ASK FOR, TOP TARGET): we contacted them, they did not ask" style={{ fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 18, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer' }}>{busy === 'bulk' ? 'Working…' : `🎯 Mark the ${bulkTarget.length} outreach entries as targeted`}</button>}
              {bulkOther.length > 0 && <button disabled={busy !== null} onClick={hideOther} title="Owner research from county records, landlord / owner contacts of the property, and system messages: none of them is someone asking about it" style={{ fontSize: 13, padding: '8px 14px', borderRadius: 18, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', color: 'var(--k-374151, #374151)', cursor: 'pointer' }}>{busy === 'bulk' ? 'Working…' : `Hide the ${bulkOther.length} owner / research / system notes`}</button>}
              {bulkGen.length > 0 && <button disabled={busy !== null} onClick={hideGeneral} style={{ fontSize: 13, padding: '8px 14px', borderRadius: 18, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', color: 'var(--k-374151, #374151)', cursor: 'pointer' }}>{busy === 'bulk' ? 'Working…' : `Hide the ${bulkGen.length} general notes`}</button>}
            </div>
          </div>
        )}
        {items && live.length > 0 && !cardMode && (
          <button onClick={() => { setCardMode(true); setCardPos(0); }} style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 14px', borderRadius: 16, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', cursor: 'pointer', marginBottom: 10 }}>⚡ Review one at a time ({live.length})</button>
        )}
        {cardMode && (() => {
          const matchRe = cur ? new RegExp(`${cur.listing.split(/\s+/).slice(0, 3).map(w => w.replace(/[.*+?^${}()[\]\\|]/g, '\\$&')).join('\\s+')}`, 'i') : null;
          const t = cur?.text ?? cur?.before ?? '';
          const m = matchRe ? matchRe.exec(t) : null;
          return (
            <div style={{ border: '1px solid #eef0f2', borderRadius: 14, padding: '14px 16px', marginBottom: 12, background: 'var(--k-fafafa, #fafafa)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)', flex: 1 }}>{queue.length === 0 ? 'All done' : `${Math.min(cardPos, queue.length - 1) + 1} of ${queue.length}`}{!narrow && <> · keys: <b>A</b> asked · <b>T</b> targeted · <b>N</b> not it · <b>S</b> skip · ← →</>}</span>
                <button onClick={() => setCardMode(false)} style={{ fontSize: 12.5, padding: '4px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', cursor: 'pointer' }}>Back to groups</button>
              </div>
              {!cur ? <div style={{ fontSize: 13.5, padding: '10px 0' }}>Nothing left to review. 🎉</div> : (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{cur.contact_id && onOpenContact ? <button onClick={() => onOpenContact(cur.contact_id as string)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>{cur.contact}</button> : cur.contact}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--k-9ca3af, #9ca3af)' }}>{SRC[cur.source]}{cur.at ? ` · ${new Date(cur.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: 'var(--k-0f766e, #0f766e)' }}>→ {cur.listing}</span>
                  </div>
                  {cur.hint && <div style={{ fontSize: 11.5, color: 'var(--k-6b7280, #6b7280)', marginBottom: 6 }}>{cur.hint}{cur.outreach ? ' · looks like an outreach list entry' : ''}</div>}
                  <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--k-fff, #fff)', border: '1px solid #eef0f2', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
                    {m ? <>{t.slice(0, m.index)}<mark style={{ background: '#fef08a', padding: '0 2px', borderRadius: 3 }}>{m[0]}</mark>{t.slice(m.index + m[0].length)}</> : t}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button disabled={busy !== null} onClick={() => act('tag')} style={{ fontSize: 14, fontWeight: 700, padding: '10px 18px', borderRadius: 20, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>🏠 Asked (A)</button>
                    {cur.source === 'contact' && <button disabled={busy !== null} onClick={() => act('target')} style={{ fontSize: 14, fontWeight: 700, padding: '10px 18px', borderRadius: 20, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer' }}>🎯 Targeted (T)</button>}
                    <button disabled={busy !== null} onClick={() => act('skip')} style={{ fontSize: 14, padding: '10px 18px', borderRadius: 20, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', color: 'var(--k-6b7280, #6b7280)', cursor: 'pointer' }}>Not it (N)</button>
                    <button disabled={busy !== null} onClick={() => act('later')} style={{ fontSize: 14, padding: '10px 18px', borderRadius: 20, border: 'none', background: 'none', color: 'var(--k-6b7280, #6b7280)', cursor: 'pointer' }}>Skip for now (S)</button>
                  </div>
                </>
              )}
            </div>
          );
        })()}
        {items && safeRows.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--k-f9fafb, #f9fafb)', border: '1px solid var(--k-e5e7eb, #e5e7eb)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ flex: '1 1 220px', fontSize: 13 }}><b>{safeRows.length} note{safeRows.length === 1 ? '' : 's'} look{safeRows.length === 1 ? 's' : ''} safe</b> across {safeProps} propert{safeProps === 1 ? 'y' : 'ies'}: they say “Engaged:”, “Crexi lead” or “asked about”, and outreach lists are left out.</div>
            <button disabled={busy !== null} onClick={applySafe} style={{ fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 18, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>{busy === 'safe' ? 'Tagging…' : `Apply the ${safeRows.length} safe ones`}</button>
          </div>
        )}
        {cardMode ? null : items === null ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Looking through old notes…</div>
          : live.length === 0 ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Nothing left to review.</div>
          : groups.filter(g => byGroup.get(g.listing_id)?.length).map(g => {
            const rows = byGroup.get(g.listing_id) ?? [];
            const inquiryRows = rows.filter(r => !r.outreach);
            const outreachN = rows.length - inquiryRows.length;
            const isOpen = open === g.listing_id;
            const parts = (['contact', 'activity', 'call', 'callsummary'] as Source[]).map(s => ({ s, n: rows.filter(r => r.source === s).length })).filter(x => x.n).map(x => `${x.n} ${SRC[x.s].toLowerCase()}`).join(' · ');
            return (
              <div key={g.listing_id} style={{ border: '1px solid #eef0f2', borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', flexWrap: 'wrap' }}>
                  <button onClick={() => setOpen(isOpen ? null : g.listing_id)} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flex: '1 1 200px', padding: 0, fontFamily: 'inherit' }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{isOpen ? '▾' : '▸'} {g.listing}</div>
                    <div style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)' }}>{rows.length} note{rows.length === 1 ? '' : 's'} · {parts}</div>
                    {outreachN > 0 && <div style={{ fontSize: 12, color: '#b45309' }}>{outreachN} look like outreach lists (we contacted them), not inquiries, so “Tag all” leaves them out</div>}
                  </button>
                  {outreachN > 0 && rows.some(r => r.outreach && r.source === 'contact') && (
                    <button disabled={busy !== null} onClick={() => markTargeted(g.listing_id, g.listing, rows.filter(r => r.outreach))}
                      title="Record that we reached out to these people about this property, without counting them as inquiries"
                      style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 14px', borderRadius: 16, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer' }}>
                      {busy === 't' + g.listing_id ? 'Marking…' : `🎯 Mark ${rows.filter(r => r.outreach && r.source === 'contact').length} as targeted`}
                    </button>
                  )}
                  {inquiryRows.length > 0 && (
                    <button disabled={busy !== null} onClick={() => { if (window.confirm(`Tag ${Math.min(inquiryRows.length, 500)} note${inquiryRows.length === 1 ? '' : 's'} as ${g.listing}? Only that address in each note changes, and you can undo.`)) applyRows(g.listing_id, inquiryRows.slice(0, 500), g.listing); }}
                      style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 14px', borderRadius: 16, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>
                      {busy === g.listing_id + inquiryRows.length ? 'Tagging…' : `Tag all ${Math.min(inquiryRows.length, 500)}`}
                    </button>
                  )}
                </div>
                {/* Preview: three sample before → after lines, so you can see exactly what "Tag all" will do */}
                {!isOpen && (
                  <div style={{ padding: '0 12px 10px' }}>
                    {(inquiryRows.length ? inquiryRows : rows).slice(0, 3).map(r => (
                      <div key={key(r)} style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)', marginTop: 4, wordBreak: 'break-word' }}>
                        <span style={{ color: 'var(--k-9ca3af, #9ca3af)' }}>…{r.before.replace(/\s+/g, ' ')}…</span><br />
                        <span style={{ color: 'var(--k-0f766e, #0f766e)', fontWeight: 600 }}>→ …{r.after.replace(/\s+/g, ' ')}…</span>
                      </div>
                    ))}
                  </div>
                )}
                {isOpen && (
                  <div style={{ padding: '0 12px 12px' }}>
                    {[...rows].sort((a, b) => vrank(a.verdict) - vrank(b.verdict)).slice(0, 100).map(i => (
                      <div key={key(i)} style={{ borderTop: '1px solid #f1f3f5', padding: '8px 0' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{i.contact}</span>
                          {i.hint && <span title="A suggestion only: you decide" style={{ fontSize: 10.5, borderRadius: 20, padding: '1px 7px', border: '1px solid', ...(i.verdict === 'inquiry' ? { color: '#0f766e', background: '#f0fdfa', borderColor: '#99f6e4' } : i.verdict === 'two' ? { color: '#6d28d9', background: '#f5f3ff', borderColor: '#ddd6fe' } : { color: '#6b7280', background: '#f9fafb', borderColor: '#e5e7eb' }) }}>{i.hint}</span>}
                          {i.outreach && <span title="Looks like an outreach list entry, not an inquiry" style={{ fontSize: 10.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 20, padding: '1px 7px' }}>outreach list</span>}
                          <span style={{ fontSize: 11, color: 'var(--k-9ca3af, #9ca3af)' }}>{SRC[i.source]}{i.at ? ` · ${new Date(i.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', margin: '4px 0 6px', wordBreak: 'break-word' }}>…{i.before.replace(/\s+/g, ' ')}…</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button disabled={busy !== null} onClick={() => applyRows(i.listing_id, [i], i.listing)} style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 14px', borderRadius: 16, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>Tag as asked</button>
                          {i.source === 'contact' && <button disabled={busy !== null} onClick={() => markTargeted(i.listing_id, i.listing, [i], false)} title="We reached out to them; they didn't ask" style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 14px', borderRadius: 16, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer' }}>🎯 Targeted</button>}
                          <button onClick={() => skip(i)} title="Hide this note for the whole team" style={{ fontSize: 12.5, padding: '5px 14px', borderRadius: 16, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'none', color: 'var(--k-6b7280, #6b7280)', cursor: 'pointer' }}>Not it</button>
                        </div>
                      </div>
                    ))}
                    {rows.length > 100 && <div style={{ fontSize: 12, color: 'var(--k-9ca3af, #9ca3af)', paddingTop: 6 }}>Showing the first 100 of {rows.length}. “Tag all” covers up to 500 at once.</div>}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
