'use client';
import React, { useEffect, useState } from 'react';

type Item = { source: 'contact' | 'activity' | 'call'; row_id: string; contact_id: string | null; contact: string; listing_id: string; listing: string; before: string; after: string; at: string | null };
const SRC = { contact: 'Contact notes', activity: 'Logged note', call: 'Call note' } as const;
const SKIP_KEY = 'crm:tag-suggestion-skips';

/**
 * Review old notes that name a property without a '#'. Nothing changes until you approve a row: "Tag it" replaces just that address in the
 * note with its #tag. "Not it" hides the row on this device. Admins only (the API refuses everyone else).
 */
export default function TagSuggestions({ authToken, onClose, onToast, onChanged }: { authToken?: string; onClose: () => void; onToast: (m: string) => void; onChanged?: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [skips, setSkips] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]')); } catch { return new Set(); } });
  const h = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    let alive = true;
    fetch('/api/crm/tag-suggestions', { headers: h }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive) { setItems(j?.items ?? []); setTotal(j?.total ?? 0); } }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []); // eslint-disable-line

  const key = (i: Item) => `${i.source}:${i.row_id}`;
  const skip = (i: Item) => { const n = new Set(skips); n.add(key(i)); setSkips(n); try { localStorage.setItem(SKIP_KEY, JSON.stringify([...n])); } catch { /* ignore */ } };
  const apply = async (i: Item) => {
    setBusy(key(i));
    const r = await fetch('/api/crm/tag-suggestions', { method: 'POST', headers: h, body: JSON.stringify({ source: i.source, row_id: i.row_id, listing_id: i.listing_id }) }).catch(() => null);
    setBusy(null);
    if (!r?.ok) { onToast('Could not tag that one (the note may have changed)'); return; }
    setItems(cur => (cur ?? []).filter(x => key(x) !== key(i)));
    onChanged?.();
    onToast(`Tagged ${i.listing}`);
  };
  const shown = (items ?? []).filter(i => !skips.has(key(i)));

  return (
    <div role="dialog" aria-label="Suggested property tags" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--k-fff, #fff)', width: 'min(720px, 100%)', maxHeight: '88vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: '18px 18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>🏠 Suggested property tags</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', marginBottom: 12 }}>
          Old notes that name one of our properties but were never tagged. “Tag it” changes only that address in the note into a # tag, so it counts on the property. Nothing changes until you tap.
          {total > shown.length + skips.size ? ` Showing the first ${items?.length ?? 0} of ${total}.` : ''}
        </div>
        {items === null ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Looking through old notes…</div>
          : shown.length === 0 ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Nothing left to review.</div>
          : shown.map(i => (
            <div key={key(i)} style={{ border: '1px solid #eef0f2', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{i.contact}</span>
                <span style={{ fontSize: 11, color: 'var(--k-9ca3af, #9ca3af)' }}>{SRC[i.source]}{i.at ? ` · ${new Date(i.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--k-0f766e, #0f766e)' }}>→ {i.listing}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', margin: '6px 0 8px', wordBreak: 'break-word' }}>…{i.before.replace(/\s+/g, ' ')}…</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy === key(i)} onClick={() => apply(i)} style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 14px', borderRadius: 16, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>{busy === key(i) ? 'Tagging…' : 'Tag it'}</button>
                <button onClick={() => skip(i)} style={{ fontSize: 12.5, padding: '6px 14px', borderRadius: 16, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'none', color: 'var(--k-6b7280, #6b7280)', cursor: 'pointer' }}>Not it</button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
