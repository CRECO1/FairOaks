'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { LoiDraft, DraftSlot, Provenance } from '@/lib/loi-autofill';
import type { Side } from '@/lib/representation-side';

/**
 * Review a pre-filled Letter of Intent before anything is generated.
 *
 * The screen exists because the risk on a legal document is not an empty field, it is
 * a filled one nobody looked at. So every line says where its value came from, the
 * ones the CRM could not source are collected at the top rather than left to be
 * noticed, and Generate stays disabled until the required blanks are gone.
 *
 * Nothing here is sent. Generate files a draft PDF on the deal; e-signature remains
 * the separate step it already is.
 */

const GOLD = '#c9922c';

const TAG: Record<Provenance, { dot: string; label: string }> = {
  crm:            { dot: '#16a34a', label: 'from the CRM' },
  agent:          { dot: '#2563eb', label: 'you typed this' },
  default:        { dot: '#9ca3af', label: 'standard language' },
  needs_input:    { dot: '#ea580c', label: 'needs your input' },
  missing_source: { dot: '#dc2626', label: 'missing from your profile' },
};

const SIDES: { v: Side; label: string }[] = [
  { v: 'buyer', label: 'the Buyer' }, { v: 'tenant', label: 'the Tenant' },
  { v: 'seller', label: 'the Seller' }, { v: 'landlord', label: 'the Landlord' },
  { v: 'intermediary', label: 'both parties (intermediary)' },
];

export default function FormAutofillReview({
  formId, formName, dealId, contactId, listingId, authToken, onClose, onFiled, onToast,
}: {
  formId: string; formName: string;
  /** All optional — a deal is a convenience, not a requirement. */
  dealId?: string | null; contactId?: string | null; listingId?: string | null;
  authToken?: string;
  onClose: () => void;
  onFiled: (submissionId: string, url: string | null) => void;
  onToast: (m: string) => void;
}) {
  const [draft, setDraft] = useState<LoiDraft | null>(null);
  const [provided, setProvided] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  // With no deal there is nowhere to persist the side, so it rides along with this
  // draft instead. Deliberately not a reason to create a deal the agent didn't ask for.
  const [sideOverride, setSideOverride] = useState<Side | null>(null);

  const headers = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  }), [authToken]);

  // Re-draft on the server whenever the agent's own values change: the mapping,
  // the required check and the side all live there, so the client never decides
  // what a field should contain.
  const refresh = useCallback(async (next: Record<string, string>) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/crm/form-fill/draft', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ form_id: formId, deal_id: dealId ?? null, contact_id: contactId ?? null, listing_id: listingId ?? null, side: sideOverride, provided: next }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'Could not build the draft.'); return; }
      setDraft(j.draft as LoiDraft);
    } catch { setError('Network error — try again.'); }
    finally { setLoading(false); }
  }, [formId, dealId, contactId, listingId, sideOverride, headers]);

  useEffect(() => { refresh({}); }, [refresh]);

  /** Commit an edit: keep it locally, then let the server re-derive everything. */
  const commit = (slot: string, value: string) => {
    const next = { ...provided, [slot]: value };
    setProvided(next);
    refresh(next);
  };

  async function chooseSide(side: Side) {
    setSideOverride(side);
    if (!dealId) { onToast(`Using: we represent ${SIDES.find(s => s.v === side)?.label ?? side}`); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/crm/deals?id=${dealId}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ representation_side: side }) });
      if (!r.ok) { onToast('Could not save it to the deal — using it for this document'); return; }
      onToast(`✓ Saved to the deal — we represent ${SIDES.find(s => s.v === side)?.label ?? side}`);
    } finally { setBusy(false); }
  }

  async function generate() {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/crm/form-fill/generate', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ form_id: formId, deal_id: dealId ?? null, contact_id: contactId ?? null, listing_id: listingId ?? null, side: sideOverride, provided, acknowledge_direction: ack }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'Could not generate the document.'); return; }
      onToast('✓ Draft filed on the deal — nothing sent');
      onFiled(j.submission?.id, j.url ?? null);
    } catch { setError('Network error — try again.'); }
    finally { setBusy(false); }
  }

  const missing = draft ? draft.slots.filter(s => s.required && !String(s.value).trim()) : [];
  const canGenerate = !!draft && missing.length === 0 && (!draft.blocked || ack) && !busy && !loading;

  const field = (s: DraftSlot) => {
    const t = TAG[s.provenance];
    const multiline = s.value.length > 60 || /\n/.test(s.value);
    return (
      <div key={s.slot} style={{ padding: '10px 0', borderBottom: '1px solid #f1f1f0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{s.label}</span>
          {s.required && <span style={{ fontSize: 10, fontWeight: 700, color: '#b91c1c', letterSpacing: .4 }}>REQUIRED</span>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: t.dot, display: 'inline-block' }} />
            {t.label}
          </span>
        </div>
        {multiline ? (
          <textarea className="crm-input" defaultValue={s.value} onBlur={e => { if (e.target.value !== s.value) commit(s.slot, e.target.value); }}
            style={{ width: '100%', minHeight: 62, resize: 'vertical', fontSize: 13.5, boxSizing: 'border-box' }} />
        ) : (
          <input className="crm-input" defaultValue={s.value} placeholder={s.provenance === 'needs_input' ? 'Type it in…' : ''}
            onBlur={e => { if (e.target.value !== s.value) commit(s.slot, e.target.value); }}
            style={{ width: '100%', fontSize: 13.5, boxSizing: 'border-box' }} />
        )}
        <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 4 }}>{s.source}</div>
        {s.check && <div style={{ fontSize: 11.5, color: '#a06a12', marginTop: 3 }}>⚠ {s.check}</div>}
      </div>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1300, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: '4vh 12px' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: 'min(760px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,.25)', fontFamily: "'DM Sans',sans-serif", overflow: 'hidden' }}>

        <div style={{ padding: '16px 20px', background: '#1a1a1a', color: '#fff', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>✨</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700 }}>Auto-fill · {formName}</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>Review every line before generating. Nothing is sent.</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 15 }}>✕</button>
        </div>

        <div style={{ padding: 20, maxHeight: '68vh', overflowY: 'auto' }}>
          {loading && !draft && <div style={{ color: '#9ca3af', fontSize: 14, padding: '20px 0' }}>Reading the deal…</div>}
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '10px 13px', fontSize: 13, marginBottom: 14 }}>{error}</div>}

          {draft && (
            <>
              {/* Which side we act for — stated, and changeable here. */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: 6 }}>We represent</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select className="crm-input" value={draft.side.side === 'unknown' ? '' : draft.side.side} disabled={busy}
                    onChange={e => e.target.value && chooseSide(e.target.value as Side)}
                    style={{ width: 'auto', minWidth: 210, fontSize: 13.5 }}>
                    <option value="">— not established —</option>
                    {SIDES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, letterSpacing: .3,
                    background: draft.side.confidence === 'confirmed' ? '#dcfce7' : draft.side.confidence === 'high' ? '#e0f2fe' : '#fef3c7',
                    color: draft.side.confidence === 'confirmed' ? '#166534' : draft.side.confidence === 'high' ? '#075985' : '#92400e' }}>
                    {draft.side.confidence === 'confirmed' ? 'confirmed' : draft.side.confidence === 'conflict' ? 'conflicting signals' : `inferred · ${draft.side.confidence}`}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 7, lineHeight: 1.5 }}>{draft.side.reason}</div>
              </div>

              {draft.blocked && (
                <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#9a3412', marginBottom: 4 }}>🛑 Check the direction of this letter</div>
                  <div style={{ fontSize: 12.5, color: '#7c2d12', lineHeight: 1.55 }}>{draft.blocked.reason}</div>
                  <div style={{ fontSize: 12.5, color: '#7c2d12', lineHeight: 1.55, marginTop: 6 }}>{draft.blocked.fix}</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, color: '#7c2d12', cursor: 'pointer' }}>
                    <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                    I have checked this and want to continue.
                  </label>
                </div>
              )}

              {draft.needsInput.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>Needs your input · {draft.needsInput.length}</div>
                  <div style={{ fontSize: 12.5, color: '#78350f', lineHeight: 1.6 }}>
                    {draft.needsInput.map(s => s.label).join(' · ')}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#a16207', marginTop: 6 }}>These are left blank on purpose — the CRM has no source for them and nothing is guessed.</div>
                </div>
              )}

              {draft.unmatchedProvided.length > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Not on this form · {draft.unmatchedProvided.length}</div>
                  <div style={{ fontSize: 12.5, color: '#991b1b', lineHeight: 1.6 }}>{draft.unmatchedProvided.join(' · ')}</div>
                  <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 6 }}>These values match no field on this letter, so they are not on it. Use the fields below.</div>
                </div>
              )}

              {draft.checkThese.length > 0 && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', marginBottom: 6 }}>Check these · {draft.checkThese.length}</div>
                  {draft.checkThese.map(s => (
                    <div key={s.slot} style={{ fontSize: 12.5, color: '#1e3a8a', lineHeight: 1.6 }}><strong>{s.label}</strong> — {s.check}</div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 6 }}>{draft.slots.map(field)}</div>
            </>
          )}
        </div>

        <div style={{ padding: '13px 20px', borderTop: '1px solid #e5e7eb', background: '#fafafa', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, fontSize: 12.5, color: missing.length ? '#b91c1c' : '#6b7280', minWidth: 200 }}>
            {loading ? 'Re-checking…'
              : missing.length ? `${missing.length} required field${missing.length === 1 ? '' : 's'} still blank: ${missing.map(m => m.label).join(', ')}`
              : `Generates a draft PDF, filed on ${draft?.filesOn.label ?? 'the deal'}. Nothing is emailed or sent for signature.`}
          </div>
          <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={generate} disabled={!canGenerate}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13.5, fontFamily: 'inherit',
              background: canGenerate ? GOLD : '#e5e7eb', color: canGenerate ? '#fff' : '#9ca3af', cursor: canGenerate ? 'pointer' : 'default' }}>
            {busy ? 'Generating…' : 'Generate draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
