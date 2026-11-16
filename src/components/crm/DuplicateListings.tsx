'use client';
import React, { useEffect, useState } from 'react';

type Row = { id: string; name: string; address: string; status: string; created_at: string; refs: Record<string, number>; refTotal: number; askedPeople: number; targetedPeople: number };
type Group = { address: string; keeper: string; rows: Row[] };
type Recent = { id: string; at: string; keeper: string; dup: string; moved: number };

/**
 * The same street address saved as more than one property. Pick the one to keep (the suggestion is the one with the most attached); "Merge" moves
 * everything from the other onto it and hides the other as "merged" (never deleted). Every merge can be undone from the list at the bottom.
 */
export default function DuplicateListings({ authToken, onClose, onToast, onChanged }: { authToken?: string; onClose: () => void; onToast: (m: string) => void; onChanged: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const h = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };
  const load = () => fetch('/api/crm/duplicate-listings', { headers: h }).then(r => (r.ok ? r.json() : null)).then(j => {
    setGroups(j?.groups ?? []); setRecent(j?.recent ?? []);
    const p: Record<string, string> = {}; for (const g of (j?.groups ?? []) as Group[]) p[g.address] = g.keeper; setPick(p);
  }).catch(() => setGroups([]));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const merge = async (g: Group) => {
    const keeper = pick[g.address] ?? g.keeper; const others = g.rows.filter(r => r.id !== keeper);
    if (!window.confirm(`Merge ${others.length} duplicate row${others.length === 1 ? '' : 's'} of ${g.address} into the one you picked?\n\nEverything attached to the others (deals, documents, contacts, tags…) moves onto it, and the others are hidden as “merged”, not deleted. You can undo this.`)) return;
    setBusy(g.address);
    let failed = 0;
    for (const o of others) {
      const r = await fetch('/api/crm/duplicate-listings', { method: 'POST', headers: h, body: JSON.stringify({ keeper, dup: o.id }) }).catch(() => null);
      if (!r?.ok) failed++;
    }
    setBusy(null);
    onToast(failed ? `Merged with ${failed} problem${failed === 1 ? '' : 's'}: nothing was lost, check the list` : `Merged ${g.address}. Undo is at the bottom of this window.`);
    onChanged(); load();
  };
  const undo = async (m: Recent) => {
    setBusy(m.id);
    const r = await fetch('/api/crm/duplicate-listings', { method: 'POST', headers: h, body: JSON.stringify({ undo: m.id }) }).catch(() => null);
    setBusy(null);
    onToast(r?.ok ? `Undone: ${m.dup} is back as its own property` : 'Could not undo that');
    onChanged(); load();
  };
  const holds = (r: Row) => [...Object.entries(r.refs).map(([k, n]) => `${n} ${k.toLowerCase()}`), r.askedPeople ? `${r.askedPeople} asked` : '', r.targetedPeople ? `${r.targetedPeople} reached out` : ''].filter(Boolean).join(' · ') || 'nothing attached';

  return (
    <div role="dialog" aria-label="Duplicate properties" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--k-fff, #fff)', width: 'min(760px, 100%)', maxHeight: '88vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: '18px 18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>🧹 Duplicate properties</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', marginBottom: 12 }}>The same street address saved as more than one property row. Tags land on every copy, so counts double. Pick the one to keep and merge. Nothing is deleted, and a merge can be undone.</div>
        {groups === null ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Looking for duplicates…</div>
          : groups.length === 0 ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>No duplicate properties found. 🎉</div>
          : groups.map(g => (
            <div key={g.address} style={{ border: '1px solid #eef0f2', borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>{g.address} <span style={{ fontWeight: 500, color: 'var(--k-9ca3af, #9ca3af)' }}>· {g.rows.length} rows</span></div>
              {g.rows.map(r => (
                <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid #f4f5f7', cursor: 'pointer' }}>
                  <input type="radio" name={`keep-${g.address}`} checked={(pick[g.address] ?? g.keeper) === r.id} onChange={() => setPick(p => ({ ...p, [g.address]: r.id }))} style={{ marginTop: 4 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                    <b>Keep this one</b> {r.id === g.keeper && <span style={{ fontSize: 11, color: 'var(--k-0f766e, #0f766e)' }}>(suggested: most attached)</span>}
                    <div style={{ color: 'var(--k-374151, #374151)' }}>{r.name || r.address} · {r.status}{r.created_at ? ` · added ${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</div>
                    <div style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)' }}>{holds(r)}</div>
                  </span>
                </label>
              ))}
              <button disabled={busy !== null} onClick={() => merge(g)} style={{ marginTop: 8, fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 18, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>{busy === g.address ? 'Merging…' : `Merge the other${g.rows.length > 2 ? 's' : ''} into the one I picked`}</button>
            </div>
          ))}
        {recent.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Recent merges (undo)</div>
            {recent.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid #f4f5f7', fontSize: 13 }}>
                <span style={{ flex: '1 1 220px' }}>{m.dup} → {m.keeper} <span style={{ color: 'var(--k-9ca3af, #9ca3af)' }}>· {m.moved} item{m.moved === 1 ? '' : 's'} moved · {new Date(m.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></span>
                <button disabled={busy !== null} onClick={() => undo(m)} style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', cursor: 'pointer' }}>{busy === m.id ? 'Undoing…' : 'Undo'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
