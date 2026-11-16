'use client';
import React, { useEffect, useMemo, useState } from 'react';

type Source = 'contact' | 'activity' | 'call';
type Item = { source: Source; row_id: string; contact_id: string | null; contact: string; listing_id: string; listing: string; before: string; after: string; at: string | null };
type Group = { listing_id: string; listing: string; n: number; bySource: Record<Source, number> };
type Undo = { source: Source; row_id: string; listing_id: string; before: string; after: string; tags_before: string[] };
const SRC = { contact: 'Contact notes', activity: 'Logged note', call: 'Call note' } as const;
const SKIP_KEY = 'crm:tag-suggestion-skips';

/**
 * Review old notes that name a property without a '#'. Nothing changes until you approve: "Tag it" on one note, or "Tag all N" for a whole
 * property (with a before/after preview first). "Not it" hides a row on this device. After a batch, "Undo" puts the old text back (only on
 * notes nobody has edited since). Admins only (the API refuses everyone else).
 */
export default function TagSuggestions({ authToken, onClose, onToast, onChanged }: { authToken?: string; onClose: () => void; onToast: (m: string) => void; onChanged?: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ label: string; rows: Undo[] } | null>(null);
  const [skips, setSkips] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]')); } catch { return new Set(); } });
  const h = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  const load = () => fetch('/api/crm/tag-suggestions', { headers: h }).then(r => (r.ok ? r.json() : null)).then(j => { setItems(j?.items ?? []); setGroups(j?.groups ?? []); setTotal(j?.total ?? 0); }).catch(() => setItems([]));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const key = (i: { source: string; row_id: string }) => `${i.source}:${i.row_id}`;
  const skip = (i: Item) => { const n = new Set(skips); n.add(key(i)); setSkips(n); try { localStorage.setItem(SKIP_KEY, JSON.stringify([...n])); } catch { /* ignore */ } };
  const live = useMemo(() => (items ?? []).filter(i => !skips.has(key(i))), [items, skips]);
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
  const doUndo = async () => {
    if (!undo) return;
    const r = await fetch('/api/crm/tag-suggestions', { method: 'PUT', headers: h, body: JSON.stringify({ undo: undo.rows }) }).catch(() => null);
    const j = r?.ok ? await r.json() : null;
    onToast(j ? `Undone: ${j.restored} restored${j.skipped ? `, ${j.skipped} left alone (edited since)` : ''}` : 'Could not undo');
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
          {items && ` ${live.length} left to review${total > live.length ? ` (of ${total})` : ''}.`}
        </div>
        {undo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--k-f0fdfa, #f0fdfa)', border: '1px solid var(--k-99f6e4, #99f6e4)', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
            <span style={{ flex: 1 }}>Tagged {undo.rows.length} note{undo.rows.length === 1 ? '' : 's'} for {undo.label}.</span>
            <button onClick={doUndo} style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', cursor: 'pointer' }}>Undo</button>
          </div>
        )}
        {items === null ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Looking through old notes…</div>
          : live.length === 0 ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Nothing left to review.</div>
          : groups.filter(g => byGroup.get(g.listing_id)?.length).map(g => {
            const rows = byGroup.get(g.listing_id) ?? [];
            const isOpen = open === g.listing_id;
            const parts = (['contact', 'activity', 'call'] as Source[]).map(s => ({ s, n: rows.filter(r => r.source === s).length })).filter(x => x.n).map(x => `${x.n} ${SRC[x.s].toLowerCase()}`).join(' · ');
            return (
              <div key={g.listing_id} style={{ border: '1px solid #eef0f2', borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', flexWrap: 'wrap' }}>
                  <button onClick={() => setOpen(isOpen ? null : g.listing_id)} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flex: '1 1 200px', padding: 0, fontFamily: 'inherit' }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{isOpen ? '▾' : '▸'} {g.listing}</div>
                    <div style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)' }}>{rows.length} note{rows.length === 1 ? '' : 's'} · {parts}</div>
                  </button>
                  <button disabled={busy !== null} onClick={() => { if (window.confirm(`Tag ${rows.length} note${rows.length === 1 ? '' : 's'} as ${g.listing}? Only that address in each note changes, and you can undo.`)) applyRows(g.listing_id, rows.slice(0, 500), g.listing); }}
                    style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 14px', borderRadius: 16, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>
                    {busy === g.listing_id + rows.length ? 'Tagging…' : `Tag all ${Math.min(rows.length, 500)}`}
                  </button>
                </div>
                {/* Preview: three sample before → after lines, so you can see exactly what "Tag all" will do */}
                {!isOpen && (
                  <div style={{ padding: '0 12px 10px' }}>
                    {rows.slice(0, 3).map(r => (
                      <div key={key(r)} style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)', marginTop: 4, wordBreak: 'break-word' }}>
                        <span style={{ color: 'var(--k-9ca3af, #9ca3af)' }}>…{r.before.replace(/\s+/g, ' ')}…</span><br />
                        <span style={{ color: 'var(--k-0f766e, #0f766e)', fontWeight: 600 }}>→ …{r.after.replace(/\s+/g, ' ')}…</span>
                      </div>
                    ))}
                  </div>
                )}
                {isOpen && (
                  <div style={{ padding: '0 12px 12px' }}>
                    {rows.slice(0, 100).map(i => (
                      <div key={key(i)} style={{ borderTop: '1px solid #f1f3f5', padding: '8px 0' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{i.contact}</span>
                          <span style={{ fontSize: 11, color: 'var(--k-9ca3af, #9ca3af)' }}>{SRC[i.source]}{i.at ? ` · ${new Date(i.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', margin: '4px 0 6px', wordBreak: 'break-word' }}>…{i.before.replace(/\s+/g, ' ')}…</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button disabled={busy !== null} onClick={() => applyRows(i.listing_id, [i], i.listing)} style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 14px', borderRadius: 16, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>Tag it</button>
                          <button onClick={() => skip(i)} style={{ fontSize: 12.5, padding: '5px 14px', borderRadius: 16, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'none', color: 'var(--k-6b7280, #6b7280)', cursor: 'pointer' }}>Not it</button>
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
