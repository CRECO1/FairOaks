'use client';
// On-document editor for the "Letter of Intent to Purchase". The agent edits the
// letter directly on a page-styled replica (letterhead, terms, sign-off, seller
// acceptance blocks) — add/remove/reorder term rows in place — so it reads like the
// real document. The same edits drive LoiPurchaseData; on save, loi-purchase-doc
// regenerates the exact branded PDF and writes { filled_path, values: sigFields,
// builder_data } to crm_form_submissions, so the e-sign flow is unchanged.
import React, { useEffect, useRef, useState } from 'react';
import {
  renderLoiPurchase, DEFAULT_LOI_TERMS,
  type LoiPurchaseData, type LoiTermRow, type LoiSeller,
} from '@/lib/loi-purchase-doc';

interface Prefill {
  agentName?: string; agentEmail?: string; agentPhone?: string;
  propertyAddress?: string; purchaser?: string; sellerName?: string;
}
interface Props {
  formId: string;
  name: string;
  submissionId?: string;
  listingId?: string;
  dealId?: string;
  businessUnit: string;
  authToken?: string;
  prefill?: Prefill;
  onToast: (m: string) => void;
  onClose: () => void;
  onSaved: () => void;
}

// Letterhead constants mirrored from loi-purchase-doc / branding for the replica.
const HEAD_CONTACT = '8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015      •      (210) 817-3443      •      crecotx.com';
const FOOT_TAG = 'Where your real estate ventures find the support they deserve';
const FOOT_CONTACT = '8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015   |   (210) 817-3443   |   info@crecotx.com   |   crecotx.com';
const BOILERPLATE = [
  'This letter of intent is merely a guide to the preparation of a mutually satisfactory contract and nothing in this letter of intent will be construed to preclude any other provisions from being inserted into the agreement at the request of either party.',
  'This letter of intent is non-binding on either party until an actual purchase agreement is drafted, agreed upon and executed by both parties.',
  'Should the above be acceptable to you, please indicate your acceptance by execution of this letter of intent in the space provided below.',
];

let _tid = 0;
const newId = () => `t${++_tid}`;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  return btoa(bin);
}

function seedData(prefill?: Prefill): LoiPurchaseData {
  const terms: LoiTermRow[] = DEFAULT_LOI_TERMS.map(t => {
    let value = t.value;
    if (t.label === 'Purchaser:' && prefill?.purchaser) value = prefill.purchaser;
    if (t.label === 'Seller:' && prefill?.sellerName) value = prefill.sellerName;
    if (t.label === 'Property:' && prefill?.propertyAddress) value = prefill.propertyAddress;
    return { id: newId(), label: t.label, value };
  });
  return {
    loiDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    addresseeName: prefill?.sellerName || '',
    addresseeAddr1: '',
    addresseeAddr2: '',
    reLine: prefill?.propertyAddress ? `Letter of Intent to Purchase - ${prefill.propertyAddress}` : 'Letter of Intent to Purchase',
    terms,
    additionalTerms: '',
    agentName: prefill?.agentName || '',
    agentEmail: prefill?.agentEmail || '',
    agentPhone: prefill?.agentPhone || '',
    sellers: [{ entity: prefill?.sellerName || '', signatory: '' }],
  };
}

// A borderless textarea that grows to fit its content, so edits flow like document text.
function AutoText({ value, onChange, style, placeholder, bold }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties; placeholder?: string; bold?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const el = ref.current; if (el) { el.style.height = '0px'; el.style.height = el.scrollHeight + 'px'; } };
  useEffect(fit, [value]);
  return (
    <textarea
      ref={ref} className="loi-ef" rows={1} value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)} onInput={fit}
      style={{ font: 'inherit', fontWeight: bold ? 700 : undefined, color: 'inherit', border: 'none', outline: 'none', background: 'transparent', padding: '1px 3px', margin: 0, width: '100%', resize: 'none', overflow: 'hidden', boxSizing: 'border-box', lineHeight: 1.34, ...style }}
    />
  );
}

export default function LoiPurchaseBuilder({ formId, submissionId, listingId, dealId, businessUnit, authToken, prefill, onToast, onClose, onSaved }: Props) {
  const [data, setData] = useState<LoiPurchaseData>(() => seedData(prefill));
  const [savedId, setSavedId] = useState<string | undefined>(submissionId);
  const [loading, setLoading] = useState(!!submissionId);
  const [busy, setBusy] = useState(false);
  const logoRef = useRef<Uint8Array | null>(null);
  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/crm/form-submissions/${submissionId}`, { headers: authHeaders });
        const j = await r.json();
        const bd = j?.submission?.builder_data;
        if (!cancelled && bd && Array.isArray(bd.terms)) {
          setData({
            ...seedData(prefill), ...bd,
            terms: bd.terms.map((t: LoiTermRow) => ({ id: t.id || newId(), label: t.label || '', value: t.value || '' })),
            sellers: bd.sellers?.length ? bd.sellers : [{ entity: '', signatory: '' }],
          });
        }
      } catch { /* fall back to seeded defaults */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [submissionId]); // eslint-disable-line

  const patch = (p: Partial<LoiPurchaseData>) => setData(d => ({ ...d, ...p }));
  const setTerm = (i: number, p: Partial<LoiTermRow>) => setData(d => ({ ...d, terms: d.terms.map((t, k) => k === i ? { ...t, ...p } : t) }));
  const removeTerm = (i: number) => setData(d => ({ ...d, terms: d.terms.filter((_, k) => k !== i) }));
  const addTermAfter = (i: number) => setData(d => { const t = [...d.terms]; t.splice(i + 1, 0, { id: newId(), label: '', value: '' }); return { ...d, terms: t }; });
  const moveTerm = (i: number, dir: -1 | 1) => setData(d => { const j = i + dir; if (j < 0 || j >= d.terms.length) return d; const t = [...d.terms]; [t[i], t[j]] = [t[j], t[i]]; return { ...d, terms: t }; });
  const setSeller = (i: number, p: Partial<LoiSeller>) => setData(d => ({ ...d, sellers: d.sellers.map((s, k) => k === i ? { ...s, ...p } : s) }));
  const setSellerCount = (n: 1 | 2) => setData(d => n === 1
    ? { ...d, sellers: [d.sellers[0] || { entity: '', signatory: '' }] }
    : { ...d, sellers: [d.sellers[0] || { entity: '', signatory: '' }, d.sellers[1] || { entity: '', signatory: '' }] });

  async function getLogo(): Promise<Uint8Array> {
    if (!logoRef.current) { const buf = await fetch('/creco-letterhead-logo.png').then(r => r.arrayBuffer()); logoRef.current = new Uint8Array(buf); }
    return logoRef.current;
  }

  async function save(closeAfter: boolean) {
    if (!data.terms.some(t => t.value.trim() || t.label.trim())) { onToast('Add at least one term'); return; }
    setBusy(true);
    try {
      const { pdfBytes, sigFields } = await renderLoiPurchase(data, await getLogo());
      const res = await fetch('/api/crm/form-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          form_id: formId, deal_id: dealId || null, listing_id: listingId || null,
          business_unit: businessUnit, title: 'Letter of Intent to Purchase',
          values: sigFields, builder_data: data, pdfBase64: bytesToBase64(pdfBytes), submission_id: savedId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onToast(j.error || 'Save failed'); return; }
      if (j.submission?.id) setSavedId(j.submission.id);
      onSaved();
      if (closeAfter) onClose(); else onToast('Saved ✓');
    } catch (e) { console.error(e); onToast('Save failed'); }
    finally { setBusy(false); }
  }

  const twoSellers = data.sellers.length > 1;
  const SIGLINE: React.CSSProperties = { flex: 1, borderBottom: '1px solid #9ca3af', height: 15, marginLeft: 8 };
  const ctrlBtn: React.CSSProperties = { fontSize: 11, lineHeight: 1, color: '#9ca3af', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 5, cursor: 'pointer', padding: '2px 4px' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,20,0.6)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .loi-ef { transition: background .12s, box-shadow .12s; border-radius: 3px; }
        .loi-ef:hover { background: #f5f5f3; }
        .loi-ef:focus { background: #fff8e6; box-shadow: inset 0 0 0 1px #ecd9a8; }
        .loi-ef::placeholder { color: #b9bcc2; font-style: italic; }
        .loi-row .loi-gutter { opacity: 0; transition: opacity .12s; }
        .loi-row:hover .loi-gutter { opacity: 1; }
      `}</style>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', background: '#fff', borderBottom: '1px solid #eef0f2', fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1a1a1a' }}>Letter of Intent to Purchase</div>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>Edit directly on the letter · hover a term for ↑ ↓ ＋ ✕</div>
        </div>
        <button onClick={() => save(false)} disabled={busy} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer' }}>Save</button>
        <button onClick={() => save(true)} disabled={busy} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 800, color: '#fff', background: '#c9922c', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save & close'}</button>
        <button onClick={onClose} style={{ padding: '8px 10px', fontSize: 16, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
      </div>

      {/* The page */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#e9ebee', padding: '26px 16px' }}>
        {loading ? <div style={{ textAlign: 'center', color: '#6b7280', fontFamily: "'DM Sans',sans-serif", marginTop: 40 }}>Loading…</div> : (
          <div style={{ width: 816, maxWidth: '100%', margin: '0 auto', background: '#fff', boxShadow: '0 2px 18px rgba(0,0,0,0.16)', padding: '46px 92px 40px', fontFamily: 'Georgia, "Times New Roman", serif', color: '#16181c', fontSize: 14, lineHeight: 1.34, boxSizing: 'border-box' }}>
            {/* Letterhead */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/creco-letterhead-logo.png" alt="CRECO" style={{ display: 'block', width: 300, maxWidth: '70%', margin: '0 auto 8px' }} />
            <div style={{ textAlign: 'center', fontSize: 10.5, color: '#57595e', marginBottom: 6 }}>{HEAD_CONTACT}</div>
            <div style={{ borderBottom: '3px solid #1c1c1f', marginBottom: 22 }} />

            {/* Date / addressee / re */}
            <div style={{ marginBottom: 16, maxWidth: 240 }}><AutoText value={data.loiDate} onChange={v => patch({ loiDate: v })} placeholder="Date" /></div>
            <div style={{ marginBottom: 14, maxWidth: 360 }}>
              <AutoText value={data.addresseeName} onChange={v => patch({ addresseeName: v })} placeholder="Addressee name (seller)" />
              <AutoText value={data.addresseeAddr1} onChange={v => patch({ addresseeAddr1: v })} placeholder="Street address" />
              <AutoText value={data.addresseeAddr2} onChange={v => patch({ addresseeAddr2: v })} placeholder="City, State ZIP" />
            </div>
            <div style={{ display: 'flex', marginBottom: 20 }}>
              <span style={{ fontWeight: 700, flex: '0 0 30px' }}>Re:</span>
              <div style={{ flex: 1 }}><AutoText value={data.reLine} onChange={v => patch({ reLine: v })} placeholder="Re: line" /></div>
            </div>

            <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 700, margin: '0 0 16px' }}>Letter of Intent to Purchase</div>

            {/* Terms */}
            {data.terms.map((t, i) => (
              <div key={t.id} className="loi-row" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 6, position: 'relative' }}>
                <div className="loi-gutter" style={{ position: 'absolute', left: -74, top: 0, display: 'flex', gap: 3, fontFamily: "'DM Sans',sans-serif" }}>
                  <button title="Move up" onClick={() => moveTerm(i, -1)} disabled={i === 0} style={{ ...ctrlBtn, opacity: i === 0 ? 0.4 : 1 }}>↑</button>
                  <button title="Move down" onClick={() => moveTerm(i, 1)} disabled={i === data.terms.length - 1} style={{ ...ctrlBtn, opacity: i === data.terms.length - 1 ? 0.4 : 1 }}>↓</button>
                </div>
                <div style={{ flex: '0 0 150px' }}><AutoText bold value={t.label} onChange={v => setTerm(i, { label: v })} placeholder="Label" /></div>
                <div style={{ flex: 1 }}><AutoText value={t.value} onChange={v => setTerm(i, { value: v })} placeholder="Value" /></div>
                <div className="loi-gutter" style={{ display: 'flex', gap: 3, paddingTop: 1, fontFamily: "'DM Sans',sans-serif" }}>
                  <button title="Add row below" onClick={() => addTermAfter(i)} style={{ ...ctrlBtn, color: '#a06a12' }}>＋</button>
                  <button title="Remove row" onClick={() => removeTerm(i)} style={{ ...ctrlBtn, color: '#dc2626' }}>✕</button>
                </div>
              </div>
            ))}
            <button onClick={() => addTermAfter(data.terms.length - 1)} style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px dashed #e6d3a2', borderRadius: 7, padding: '4px 12px', cursor: 'pointer', margin: '4px 0 14px' }}>＋ Add term</button>

            {/* Other Stipulations */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Other Stipulations:</div>
              <AutoText value={data.additionalTerms} onChange={v => patch({ additionalTerms: v })} placeholder="Any additional terms that don’t fit the rows above…" />
            </div>

            {/* Boilerplate */}
            {BOILERPLATE.map((p, i) => <p key={i} style={{ margin: '0 0 10px' }}>{p}</p>)}

            {/* Sign-off */}
            <div style={{ margin: '18px 0 6px' }}>Sincerely,</div>
            <div style={{ marginBottom: 22, maxWidth: 320 }}>
              <AutoText value={data.agentName} onChange={v => patch({ agentName: v })} placeholder="Your name" />
              <AutoText value={data.agentEmail} onChange={v => patch({ agentEmail: v })} placeholder="Your email" />
              <AutoText value={data.agentPhone} onChange={v => patch({ agentPhone: v })} placeholder="Your phone" />
            </div>

            {/* Seller acceptance */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontWeight: 700 }}>Seller:</span>
              <div style={{ display: 'flex', gap: 5, fontFamily: "'DM Sans',sans-serif" }}>
                <button onClick={() => setSellerCount(1)} style={{ fontSize: 11.5, fontWeight: 700, color: twoSellers ? '#9ca3af' : '#fff', background: twoSellers ? '#fff' : '#c9922c', border: '1px solid ' + (twoSellers ? '#e5e7eb' : '#c9922c'), borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>1 signer</button>
                <button onClick={() => setSellerCount(2)} style={{ fontSize: 11.5, fontWeight: 700, color: twoSellers ? '#fff' : '#9ca3af', background: twoSellers ? '#c9922c' : '#fff', border: '1px solid ' + (twoSellers ? '#c9922c' : '#e5e7eb'), borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>2 signers</button>
              </div>
            </div>
            {data.sellers.map((s, i) => (
              <div key={i} style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, letterSpacing: 0.3, margin: '6px 0 10px' }}>AGREED TO &amp; ACCEPTED BY:</div>
                <div style={{ maxWidth: 360, marginBottom: 12 }}><AutoText value={s.entity} onChange={v => setSeller(i, { entity: v })} placeholder={`Seller ${i + 1} — entity / name`} /><div style={{ borderBottom: '1px solid #9ca3af', marginTop: -2 }} /></div>
                <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 12, maxWidth: 420 }}><span>Signature:</span><span style={SIGLINE} /><span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10.5, color: '#b08833', marginLeft: 8, whiteSpace: 'nowrap' }}>✎ signed at e-sign</span></div>
                <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 12, maxWidth: 420 }}><span>Name:</span><div style={{ flex: 1, marginLeft: 8, borderBottom: '1px solid #9ca3af' }}><AutoText value={s.signatory} onChange={v => setSeller(i, { signatory: v })} placeholder="printed name" /></div></div>
                <div style={{ display: 'flex', alignItems: 'flex-end', maxWidth: 420 }}><span>Date:</span><span style={SIGLINE} /><span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10.5, color: '#b08833', marginLeft: 8, whiteSpace: 'nowrap' }}>✎ signed at e-sign</span></div>
              </div>
            ))}

            {/* Footer */}
            <div style={{ borderTop: '3px solid #1c1c1f', marginTop: 26, paddingTop: 8, textAlign: 'center' }}>
              <div style={{ fontStyle: 'italic', fontSize: 11, color: '#3a3a3f' }}>{FOOT_TAG}</div>
              <div style={{ fontSize: 9.5, color: '#57595e', marginTop: 2 }}>{FOOT_CONTACT}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
