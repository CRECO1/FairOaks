'use client';
import React, { useEffect, useState } from 'react';

type Asker = { contact_id: string; name: string; email: string | null; asked_at: string | null; snippet: string | null; skip: string | null; drafted: boolean };
type Alt = { id: string; label: string; type: string | null; sq_ft: number | null; price: string | null; city: string | null };
type Data = { listing: { label: string; status: string }; askers: Asker[]; alternatives: Alt[]; eligible: boolean };

const WHAT: Record<string, string> = { leased: 'has been leased', sold: 'has sold', pending: 'is under contract' };
const pill = { fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 18, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' } as const;

/**
 * When a property has leased, sold or gone under contract: the people who asked about it, and a short list of OUR other active listings that may suit them.
 * "Save drafts" puts one email per person in YOUR Drafts (your signature) to read, edit and send yourself; nothing is sent from here.
 */
export default function ReofferToAskers({ authToken, listingId, onClose, onToast }: { authToken?: string; listingId: string; onClose: () => void; onToast: (m: string) => void }) {
  const [d, setD] = useState<Data | null | false>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ made: number; skipped: { name: string; why: string }[] } | null>(null);
  const h = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    let alive = true;
    fetch(`/api/crm/reoffer?listing_id=${listingId}`, { headers: h }).then(r => (r.ok ? r.json() : null)).then((j: Data | null) => {
      if (!alive) return;
      if (!j) { setD(false); return; }
      setD(j); setPick(new Set(j.askers.filter(a => !a.skip && !a.drafted).map(a => a.contact_id)));
    }).catch(() => { if (alive) setD(false); });
    return () => { alive = false; };
  }, [listingId, authToken]); // eslint-disable-line

  const save = async () => {
    if (!pick.size) return;
    setBusy(true);
    const r = await fetch('/api/crm/reoffer', { method: 'POST', headers: h, body: JSON.stringify({ listing_id: listingId, contact_ids: [...pick] }) }).catch(() => null);
    const j = r?.ok ? await r.json() : null;
    setBusy(false);
    if (!j) { onToast('Could not save the drafts'); return; }
    setResult({ made: j.made, skipped: j.skipped ?? [] });
    onToast(`${j.made} draft${j.made === 1 ? '' : 's'} saved to your Drafts (nothing sent)`);
  };

  const ok = d ? d.askers.filter(a => !a.skip && !a.drafted) : [];
  return (
    <div role="dialog" aria-label="Re-offer to the people who asked" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--k-fff, #fff)', width: 'min(680px, 100%)', maxHeight: '88vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: '18px 16px 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>↩ Re-offer to the people who asked</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
        {d === null && <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Checking who asked…</div>}
        {d === false && <div style={{ fontSize: 13, color: '#b91c1c' }}>Could not load this. You may not have access to re-offer this property.</div>}
        {d && (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', marginBottom: 10 }}>
              {d.listing.label} {WHAT[d.listing.status] ?? 'is no longer available'}. This saves one email per person to <b>your Drafts</b> with your signature. You read, edit and send each one yourself: nothing is sent from here.
            </div>
            {!d.eligible && <div style={{ fontSize: 13, color: '#b45309', marginBottom: 8 }}>This property is still marked {d.listing.status || 'active'}. Mark it leased, sold or under contract first.</div>}
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Our listings the email will suggest {d.alternatives.length ? `(${d.alternatives.length})` : ''}</div>
            {d.alternatives.length === 0
              ? <div style={{ fontSize: 12.5, color: 'var(--k-9ca3af, #9ca3af)', marginBottom: 10 }}>No other active listing of the same kind and type, so the email just points to crecotx.com/listings and offers to keep looking.</div>
              : <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>{d.alternatives.map(a => <li key={a.id}><b>{a.label}</b>{[a.type, a.sq_ft ? `${a.sq_ft.toLocaleString('en-US')} SF` : null, a.city, a.price].filter(Boolean).map(x => ` · ${x}`).join('')}</li>)}</ul>}
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>People who asked ({d.askers.length})</div>
            {d.askers.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--k-9ca3af, #9ca3af)' }}>No one has been tagged on this property.</div>}
            {d.askers.map(a => (
              <label key={a.contact_id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderTop: '1px solid #f1f3f5', opacity: a.skip || a.drafted ? 0.6 : 1 }}>
                <input type="checkbox" disabled={!!a.skip || a.drafted || !!result} checked={pick.has(a.contact_id)} onChange={e => setPick(p => { const n = new Set(p); if (e.target.checked) n.add(a.contact_id); else n.delete(a.contact_id); return n; })} style={{ marginTop: 3 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                  <b>{a.name}</b> <span style={{ color: 'var(--k-6b7280, #6b7280)' }}>{a.email ?? ''}</span>
                  {a.skip && <span style={{ color: '#b45309' }}> · left out: {a.skip}</span>}
                  {a.drafted && <span style={{ color: 'var(--k-0f766e, #0f766e)' }}> · already has a draft</span>}
                  {a.snippet && <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af, #9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.snippet}</div>}
                </span>
              </label>
            ))}
            {result ? (
              <div style={{ marginTop: 12, fontSize: 13.5, color: 'var(--k-0f766e, #0f766e)', fontWeight: 600 }}>✓ {result.made} draft{result.made === 1 ? '' : 's'} saved. Open Emails → Drafts to review and send them.{result.skipped.length > 0 && <span style={{ color: '#b45309', fontWeight: 500 }}> Left out: {result.skipped.map(s => `${s.name} (${s.why})`).join(', ')}.</span>}</div>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button disabled={busy || !d.eligible || !pick.size} onClick={save} style={{ ...pill, opacity: busy || !d.eligible || !pick.size ? 0.55 : 1 }}>{busy ? 'Saving…' : `Save ${pick.size} draft${pick.size === 1 ? '' : 's'} to my Drafts`}</button>
                <span style={{ fontSize: 12, color: 'var(--k-9ca3af, #9ca3af)' }}>{ok.length} of {d.askers.length} can get an email.</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
