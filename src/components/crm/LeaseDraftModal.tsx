'use client';

import React, { useState } from 'react';

// Describe a lease in a sentence; the assistant fills the values and you check them.
// Everything it proposes is editable here, and nothing is generated until Create is
// pressed — the draft is a starting point, not an answer.

export interface LeaseDraftValues {
  tenant_name: string; building: string; suite: string; effective_date: string;
  term_months: string; end_date: string; monthly_rent: string; security_deposit: string;
  tenant_phone: string; tenant_email: string; tenant_signer?: string; monthly_rent_year2: string; year2_start: string;
  internet_fee: string;
}

const FIELDS: Array<[keyof LeaseDraftValues, string]> = [
  ['tenant_name', 'Tenant name'], ['tenant_signer', 'Signing for tenant (if a business)'], ['building', 'Building'], ['suite', 'Suite'],
  ['effective_date', 'Start date'], ['term_months', 'Term (months)'], ['end_date', 'End date'],
  ['monthly_rent', 'Monthly rent ($)'], ['monthly_rent_year2', 'Year 2 rent ($)'],
  ['year2_start', 'Year 2 starts'], ['internet_fee', 'Internet ($/mo)'], ['security_deposit', 'Security deposit ($)'],
  ['tenant_phone', 'Tenant phone'], ['tenant_email', 'Tenant email'],
];

const EXAMPLES = [
  '24 months for Ashley Pugh starting Oct 1, $808 then $840, no deposit',
  '12 month renewal for KJF Insurance at the current rent',
];

export default function LeaseDraftModal({ listingId, authToken, onToast, onCreate, onClose, initialValues }: {
  listingId?: string;
  /** Edit an existing generated lease: skip drafting, start from its saved values. */
  initialValues?: LeaseDraftValues;
  authToken?: string;
  onToast: (m: string) => void;
  onCreate: (v: LeaseDraftValues) => Promise<void> | void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const editing = !!initialValues;
  const [values, setValues] = useState<LeaseDraftValues | null>(initialValues ?? null);
  const [notes, setNotes] = useState<string[]>([]);
  const [matchedSuite, setMatchedSuite] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const draft = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/crm/lease-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ listing_id: listingId, prompt }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { onToast(j.error || 'Could not draft the lease'); return; }
      setValues(j.values); setNotes(j.notes ?? []); setMatchedSuite(j.matched_suite || '');
    } catch { onToast('Could not reach the drafting service'); }
    finally { setBusy(false); }
  };

  const inp: React.CSSProperties = { padding: '7px 9px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13.5, width: '100%', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" };
  const lbl: React.CSSProperties = { fontSize: 10.5, letterSpacing: .5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 4 };

  return (
    <div onClick={onClose} className="crm-sheet" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} className="crm-sheet-panel" style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 760, padding: 22, fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{editing ? '✏️ Edit lease' : '✨ Draft a lease'}</div>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#9ca3af', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: 14 }}>
          {editing
            ? 'Change any value and save — the lease is regenerated with the clauses reflowed, and the change is logged in its history.'
            : 'Describe the lease in a sentence. It fills the form from the rent roll — you check it before anything is created.'}
        </div>

        {!editing && <><textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') draft(); }}
          placeholder={EXAMPLES[0]}
          style={{ ...inp, resize: 'vertical', marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={draft} disabled={busy || !prompt.trim()}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy || !prompt.trim() ? .6 : 1 }}>
            {busy ? 'Drafting…' : 'Draft it'}
          </button>
          {!values && EXAMPLES.map(x => (
            <button key={x} onClick={() => setPrompt(x)} style={{ background: 'none', border: 'none', color: '#a06a12', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>{x}</button>
          ))}
        </div></>}

        {values && (
          <>
            {notes.length > 0 && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '11px 14px', marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#78350f', marginBottom: 6 }}>Check these before you create it</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#78350f', lineHeight: 1.55 }}>
                  {notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}
            {matchedSuite && (
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10 }}>Matched to suite {matchedSuite} on the rent roll.</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 11, marginBottom: 16 }}>
              {FIELDS.map(([k, label]) => (
                <div key={k}>
                  <div style={lbl}>{label}</div>
                  <input value={values[k] ?? ''} onChange={e => setValues(v => v ? { ...v, [k]: e.target.value } : v)}
                    placeholder={k === 'security_deposit' ? 'blank = no deposit' : k.includes('year2') ? 'blank = flat rent' : ''}
                    style={inp} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button disabled={creating}
                onClick={async () => { setCreating(true); try { await onCreate(values); } finally { setCreating(false); } }}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#111', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: creating ? 'default' : 'pointer', opacity: creating ? .6 : 1 }}>
                {creating ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save & regenerate' : 'Create lease')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
