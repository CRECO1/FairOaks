'use client';
import React, { useEffect, useMemo, useState } from 'react';

type Source = 'contact' | 'activity' | 'call';
type Item = { source: Source; row_id: string; contact_id: string | null; contact: string; listing_id: string; listing: string; before: string; after: string; at: string | null; outreach?: boolean; safe?: boolean; verdict?: string; hint?: string };
type Group = { listing_id: string; listing: string; n: number; outreach?: number; bySource: Record<Source, number> };
type Undo = { source: Source; row_id: string; listing_id: string; before: string; after: string; tags_before: string[] };
const SRC = { contact: 'Contact notes', activity: 'Logged note', call: 'Call note' } as const;

/**
 * Review old notes that name a property without a '#'. Nothing changes until you approve: "Tag it" on one note, or "Tag all N" for a whole
 * property (with a before/after preview first). "Not it" hides a row on this device. After a batch, "Undo" puts the old text back (only on
 * notes nobody has edited since). Admins only (the API refuses everyone else).
 */
export default function TagSuggestions({ authToken, onClose, onToast, onChanged }: { authToken?: string; onClose: () => void; onToast: (m: string) => void; onChanged?: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [tenantsOut, setTenantsOut] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ label: string; rows: Undo[]; targeted?: { row_id: string; listing_id: string }[]; skipped?: { source: string; row_id: string; listing_id: string }[] } | null>(null);
  const h = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  const load = () => fetch('/api/crm/tag-suggestions', { headers: h }).then(r => (r.ok ? r.json() : null)).then(j => { setItems(j?.items ?? []); setGroups(j?.groups ?? []); setTotal(j?.total ?? 0); setTenantsOut(j?.tenantsLeftOut ?? 0); }).catch(() => setItems([]));
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
          {items && ` ${live.length} left to review${total > live.length ? ` (of ${total})` : ''}.`}{tenantsOut > 0 && ` ${tenantsOut} notes that are current tenants' rent-roll lines are left out.`}
        </div>
        {undo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--k-f0fdfa, #f0fdfa)', border: '1px solid var(--k-99f6e4, #99f6e4)', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
            <span style={{ flex: 1 }}>{undo.skipped ? `Hid 1 note` : undo.targeted ? `Marked ${undo.targeted.length} contact${undo.targeted.length === 1 ? '' : 's'}` : `Tagged ${undo.rows.length} note${undo.rows.length === 1 ? '' : 's'}`} for {undo.label}.</span>
            <button onClick={doUndo} style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', cursor: 'pointer' }}>Undo</button>
          </div>
        )}
        {items && safeRows.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--k-f9fafb, #f9fafb)', border: '1px solid var(--k-e5e7eb, #e5e7eb)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ flex: '1 1 220px', fontSize: 13 }}><b>{safeRows.length} notes look safe</b> across {safeProps} propert{safeProps === 1 ? 'y' : 'ies'}: they say “Engaged:”, “Crexi lead” or “asked about”, and outreach lists are left out.</div>
            <button disabled={busy !== null} onClick={applySafe} style={{ fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 18, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>{busy === 'safe' ? 'Tagging…' : `Apply the ${safeRows.length} safe ones`}</button>
          </div>
        )}
        {items === null ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Looking through old notes…</div>
          : live.length === 0 ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Nothing left to review.</div>
          : groups.filter(g => byGroup.get(g.listing_id)?.length).map(g => {
            const rows = byGroup.get(g.listing_id) ?? [];
            const inquiryRows = rows.filter(r => !r.outreach);
            const outreachN = rows.length - inquiryRows.length;
            const isOpen = open === g.listing_id;
            const parts = (['contact', 'activity', 'call'] as Source[]).map(s => ({ s, n: rows.filter(r => r.source === s).length })).filter(x => x.n).map(x => `${x.n} ${SRC[x.s].toLowerCase()}`).join(' · ');
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
                    {[...rows].sort((a, b) => ({ inquiry: 0, two: 1, general: 2 } as Record<string, number>)[a.verdict ?? 'general'] - ({ inquiry: 0, two: 1, general: 2 } as Record<string, number>)[b.verdict ?? 'general']).slice(0, 100).map(i => (
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
