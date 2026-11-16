'use client';
import React, { useEffect, useState } from 'react';

type Item = { id: string; name: string; source: string; at: string; snippet: string | null };

/** Admin health line: of the leads that arrived this week, how many were tagged to a property at import, and which named none. */
export default function LeadTagHealth({ authToken, onOpenContact }: { authToken?: string; onOpenContact?: (id: string) => void }) {
  const [d, setD] = useState<{ total: number; tagged: number; untagged: number; items: Item[] } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!authToken) return;
    let alive = true;
    fetch('/api/crm/lead-tag-health', { headers: { Authorization: `Bearer ${authToken}` } }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setD(j); }).catch(() => {});
    return () => { alive = false; };
  }, [authToken]);
  if (!d || d.total === 0) return null;
  return (
    <div style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)' }}>
      <button onClick={() => d.untagged > 0 && setOpen(o => !o)} title="Leads from the last 7 days: how many were tagged to a property when they arrived"
        style={{ background: 'none', border: 'none', padding: 0, cursor: d.untagged > 0 ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 12.5, color: 'inherit', textAlign: 'left' }}>
        🏠 Leads, last 7 days: <b>{d.total}</b> new · <b style={{ color: 'var(--k-0f766e, #0f766e)' }}>{d.tagged}</b> tagged to a property{d.untagged > 0 && <> · <b style={{ color: '#b45309' }}>{d.untagged}</b> named no property {open ? '▾' : '▸'}</>}
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {d.items.map(i => (
            <button key={i.id} onClick={() => onOpenContact?.(i.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'var(--k-fff, #fff)', border: '1px solid #eef0f2', borderRadius: 10, padding: '7px 11px', marginBottom: 5, cursor: onOpenContact ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--k-111, #111)' }}>{i.name}</span> <span style={{ fontSize: 11.5 }}>· {i.source} · {new Date(i.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              {i.snippet && <div style={{ fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.snippet}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
