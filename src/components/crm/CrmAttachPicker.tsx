'use client';

import React, { useEffect, useState } from 'react';
import type { CrmAttachItem, CrmAttachGroup } from '@/lib/crm-attachments';

// "Attach from the CRM": pick documents that are already on this deal's Docs tab (files the agent uploaded, forms
// they pulled in, signed copies). The server attaches them when the email is sent — nothing is downloaded first.

const key = (i: CrmAttachItem) => `${i.kind}:${i.id}`;
const fmt = (n: number | null) => n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const icon = (i: CrmAttachItem) => i.kind === 'signed' ? '✅' : i.kind === 'form' ? '📝' : /^image\//.test(i.type) ? '🖼️' : /word|document/.test(i.type) ? '📃' : '📄';

export default function CrmAttachPicker(p: {
  ctx: { dealId?: string; clientId?: string };
  chosen: CrmAttachItem[];
  onAdd: (items: CrmAttachItem[]) => void;
  onClose: () => void;
  isMobile: boolean;
}) {
  const [groups, setGroups] = useState<CrmAttachGroup[] | null>(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState<Record<string, CrmAttachItem>>({});
  const already = new Set(p.chosen.map(key));

  useEffect(() => {
    let live = true;
    const qs = p.ctx.dealId ? `dealId=${p.ctx.dealId}` : p.ctx.clientId ? `clientId=${p.ctx.clientId}` : '';
    if (!qs) { setGroups([]); return; }
    fetch(`/api/crm/attachables?${qs}`).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!live) return;
      if (!r.ok) { setErr(j.error ?? 'Couldn’t load documents'); setGroups([]); } else setGroups(j.groups ?? []);
    }).catch(() => { if (live) { setErr('Couldn’t load documents'); setGroups([]); } });
    return () => { live = false; };
  }, [p.ctx.dealId, p.ctx.clientId]);

  const n = Object.keys(pick).length;
  const toggle = (i: CrmAttachItem) => setPick(s => { const k = key(i); const c = { ...s }; if (c[k]) delete c[k]; else c[k] = i; return c; });

  return (
    <div role="dialog" aria-label="Attach from the deal" onClick={p.onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1400, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: p.isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--k-fff)', width: '100%', maxWidth: 520, maxHeight: p.isMobile ? '82vh' : '70vh', display: 'flex', flexDirection: 'column', borderRadius: p.isMobile ? '16px 16px 0 0' : 14, boxShadow: '0 20px 60px rgba(0,0,0,.3)', paddingBottom: p.isMobile ? 'env(safe-area-inset-bottom)' : 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--k-f0f0f0)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-111)' }}>Attach from the deal</div>
            <div style={{ fontSize: 12, color: 'var(--k-6b7280)' }}>Documents already on the deal’s Docs tab. They’re attached when you send — nothing to download.</div>
          </div>
          <button type="button" onClick={p.onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--k-9ca3af)', cursor: 'pointer', width: 40, height: 40, minWidth: 0, minHeight: 0 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {groups === null ? <div style={{ padding: 24, fontSize: 14, color: 'var(--k-9ca3af)' }}>Loading documents…</div>
          : err ? <div style={{ padding: 24, fontSize: 14, color: 'var(--k-991b1b)' }}>{err}</div>
          : groups.length === 0 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 14, color: 'var(--k-6b7280)' }}>
              No documents on this deal yet.<br /><span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>Add files or forms on the deal’s Docs tab, then attach them here.</span>
            </div>
          ) : groups.map(g => (
            <div key={g.dealId}>
              {groups.length > 1 || p.ctx.clientId ? <div style={{ padding: '10px 16px 4px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700 }}>{g.title}</div> : null}
              {g.items.map(i => {
                const k = key(i), done = already.has(k), on = !!pick[k];
                return (
                  <button key={k} type="button" disabled={done} onClick={() => toggle(i)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: p.isMobile ? '12px 16px' : '9px 16px', minHeight: p.isMobile ? 56 : 44, background: on ? 'var(--k-fef9f0)' : 'none', border: 'none', borderTop: '1px solid var(--k-f5f5f5)', cursor: done ? 'default' : 'pointer', textAlign: 'left', opacity: done ? 0.5 : 1, fontFamily: "'DM Sans',sans-serif" }}>
                    <span aria-hidden style={{ width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${on ? '#c9922c' : 'var(--k-d1d5db)'}`, background: on ? '#c9922c' : 'var(--k-fff)', color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on || done ? '✓' : ''}</span>
                    <span aria-hidden style={{ fontSize: 20, flexShrink: 0 }}>{icon(i)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--k-9ca3af)' }}>{done ? 'Already attached' : i.sub}{fmt(i.size) ? ` · ${fmt(i.size)}` : ''}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: '1px solid var(--k-f0f0f0)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={p.onClose} style={{ height: p.isMobile ? 46 : 38, padding: '0 16px', background: 'var(--k-f3f4f6)', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--k-374151)' }}>Cancel</button>
          <button type="button" disabled={!n} onClick={() => { p.onAdd(Object.values(pick)); p.onClose(); }}
            style={{ height: p.isMobile ? 46 : 38, padding: '0 20px', background: n ? '#c9922c' : 'var(--k-e5e7eb)', color: n ? '#fff' : 'var(--k-9ca3af)', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: n ? 'pointer' : 'default' }}>
            {n ? `Attach ${n} file${n === 1 ? '' : 's'}` : 'Attach'}
          </button>
        </div>
      </div>
    </div>
  );
}
