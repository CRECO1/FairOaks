'use client';
// Editable term-list builder for the "Letter of Intent to Purchase". Unlike the
// coordinate-overlay TransactionDocEditor, this drives a dynamic document: the agent
// adds/removes/edits term rows, a Commission row and a free-text Other Stipulations
// block, and 1–2 seller acceptance blocks. On save it regenerates the branded PDF
// (loi-purchase-doc) and writes { filled_path, values: sigFields, builder_data } to
// crm_form_submissions, so the existing send-for-signature flow consumes it unchanged.
import React, { useEffect, useState, useCallback } from 'react';
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

const INP: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13.5, fontFamily: "'DM Sans',sans-serif", color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' };
const LBL: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, display: 'block' };
const SECTION: React.CSSProperties = { border: '1px solid #eef0f2', borderRadius: 12, padding: 16, marginBottom: 14, background: '#fff' };
const H: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: '#1a1a1a', marginBottom: 10 };

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  return btoa(bin);
}

function seedData(prefill?: Prefill): LoiPurchaseData {
  const terms = DEFAULT_LOI_TERMS.map(t => {
    if (t.label === 'Purchaser:' && prefill?.purchaser) return { ...t, value: prefill.purchaser };
    if (t.label === 'Seller:' && prefill?.sellerName) return { ...t, value: prefill.sellerName };
    if (t.label === 'Property:' && prefill?.propertyAddress) return { ...t, value: prefill.propertyAddress };
    return { ...t };
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

export default function LoiPurchaseBuilder({ formId, submissionId, listingId, dealId, businessUnit, authToken, prefill, onToast, onClose, onSaved }: Props) {
  const [data, setData] = useState<LoiPurchaseData>(() => seedData(prefill));
  const [savedId, setSavedId] = useState<string | undefined>(submissionId);
  const [loading, setLoading] = useState(!!submissionId);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  // Re-editing: hydrate from the saved builder_data.
  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/crm/form-submissions/${submissionId}`, { headers: authHeaders });
        const j = await r.json();
        const bd = j?.submission?.builder_data;
        if (!cancelled && bd && Array.isArray(bd.terms)) setData({ ...seedData(prefill), ...bd, sellers: bd.sellers?.length ? bd.sellers : [{ entity: '', signatory: '' }] });
      } catch { /* fall back to seeded defaults */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [submissionId]); // eslint-disable-line

  const patch = (p: Partial<LoiPurchaseData>) => setData(d => ({ ...d, ...p }));
  const setTerm = (i: number, p: Partial<LoiTermRow>) => setData(d => ({ ...d, terms: d.terms.map((t, k) => k === i ? { ...t, ...p } : t) }));
  const removeTerm = (i: number) => setData(d => ({ ...d, terms: d.terms.filter((_, k) => k !== i) }));
  const addTerm = () => setData(d => ({ ...d, terms: [...d.terms, { label: '', value: '' }] }));
  const moveTerm = (i: number, dir: -1 | 1) => setData(d => {
    const j = i + dir; if (j < 0 || j >= d.terms.length) return d;
    const t = [...d.terms]; [t[i], t[j]] = [t[j], t[i]]; return { ...d, terms: t };
  });
  const setSeller = (i: number, p: Partial<LoiSeller>) => setData(d => ({ ...d, sellers: d.sellers.map((s, k) => k === i ? { ...s, ...p } : s) }));
  const setSellerCount = (n: 1 | 2) => setData(d => {
    if (n === 1) return { ...d, sellers: [d.sellers[0] || { entity: '', signatory: '' }] };
    return { ...d, sellers: [d.sellers[0] || { entity: '', signatory: '' }, d.sellers[1] || { entity: '', signatory: '' }] };
  });

  const generate = useCallback(async () => {
    const buf = await fetch('/creco-letterhead-logo.png').then(r => r.arrayBuffer());
    return renderLoiPurchase(data, new Uint8Array(buf));
  }, [data]);

  async function doPreview() {
    setBusy(true);
    try {
      const { pdfBytes } = await generate();
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) { console.error(e); onToast('Could not build preview'); }
    finally { setBusy(false); }
  }

  async function save(closeAfter: boolean) {
    if (!data.terms.some(t => t.value.trim() || t.label.trim())) { onToast('Add at least one term'); return; }
    setBusy(true);
    try {
      const { pdfBytes, sigFields } = await generate();
      const res = await fetch('/api/crm/form-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          form_id: formId,
          deal_id: dealId || null,
          listing_id: listingId || null,
          business_unit: businessUnit,
          title: 'Letter of Intent to Purchase',
          values: sigFields,
          builder_data: data,
          pdfBase64: bytesToBase64(pdfBytes),
          submission_id: savedId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onToast(j.error || 'Save failed'); return; }
      if (j.submission?.id) setSavedId(j.submission.id);
      onSaved();
      if (closeAfter) onClose();
      else onToast('Saved ✓');
    } catch (e) { console.error(e); onToast('Save failed'); }
    finally { setBusy(false); }
  }

  const twoSellers = data.sellers.length > 1;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,20,0.55)', zIndex: 1000, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', background: '#fff', borderBottom: '1px solid #eef0f2' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1a1a1a' }}>Letter of Intent to Purchase</div>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>Editable terms · add or remove any row · regenerates the branded PDF</div>
        </div>
        <button onClick={doPreview} disabled={busy} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: '#a06a12', background: '#fff', border: '1px solid #f0e2c4', borderRadius: 8, cursor: 'pointer' }}>👁 Preview</button>
        <button onClick={() => save(false)} disabled={busy} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer' }}>Save</button>
        <button onClick={() => save(true)} disabled={busy} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 800, color: '#fff', background: '#c9922c', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Working…' : 'Save & close'}</button>
        <button onClick={onClose} style={{ padding: '8px 10px', fontSize: 15, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* ── Editor column ── */}
        <div style={{ flex: previewUrl ? '0 0 52%' : 1, overflowY: 'auto', padding: 18, background: '#f7f8f9' }}>
          {loading ? <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</div> : (
            <>
              <div style={SECTION}>
                <div style={H}>Letter details</div>
                <div style={{ marginBottom: 10 }}><label style={LBL}>Date</label><input style={INP} value={data.loiDate} onChange={e => patch({ loiDate: e.target.value })} /></div>
                <div style={{ marginBottom: 10 }}><label style={LBL}>Addressee — name</label><input style={INP} value={data.addresseeName} onChange={e => patch({ addresseeName: e.target.value })} placeholder="Seller entity" /></div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}><label style={LBL}>Street</label><input style={INP} value={data.addresseeAddr1} onChange={e => patch({ addresseeAddr1: e.target.value })} /></div>
                  <div style={{ flex: 1 }}><label style={LBL}>City, State ZIP</label><input style={INP} value={data.addresseeAddr2} onChange={e => patch({ addresseeAddr2: e.target.value })} /></div>
                </div>
                <div><label style={LBL}>Re: line</label><input style={INP} value={data.reLine} onChange={e => patch({ reLine: e.target.value })} /></div>
              </div>

              <div style={SECTION}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ ...H, flex: 1, marginBottom: 0 }}>Terms</div>
                  <button onClick={addTerm} style={{ fontSize: 12.5, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px solid #f0e2c4', borderRadius: 7, padding: '5px 11px', cursor: 'pointer' }}>+ Add row</button>
                </div>
                <div style={{ fontSize: 11.5, color: '#9ca3af', margin: '4px 0 12px' }}>Drop rows you don’t need with ✕; reorder with ▲▼.</div>
                {data.terms.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
                      <button onClick={() => moveTerm(i, -1)} disabled={i === 0} title="Move up" style={{ fontSize: 10, color: i === 0 ? '#d1d5db' : '#9ca3af', background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', padding: 0 }}>▲</button>
                      <button onClick={() => moveTerm(i, 1)} disabled={i === data.terms.length - 1} title="Move down" style={{ fontSize: 10, color: i === data.terms.length - 1 ? '#d1d5db' : '#9ca3af', background: 'none', border: 'none', cursor: i === data.terms.length - 1 ? 'default' : 'pointer', padding: 0 }}>▼</button>
                    </div>
                    <input style={{ ...INP, flex: '0 0 150px', fontWeight: 700 }} value={t.label} onChange={e => setTerm(i, { label: e.target.value })} placeholder="Label" />
                    <textarea style={{ ...INP, flex: 1, minHeight: 38, resize: 'vertical' }} value={t.value} onChange={e => setTerm(i, { value: e.target.value })} placeholder="Value" />
                    <button onClick={() => removeTerm(i)} title="Remove row" style={{ fontSize: 13, color: '#dc2626', background: '#fff', border: '1px solid #fecaca', borderRadius: 7, padding: '6px 9px', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                  </div>
                ))}
              </div>

              <div style={SECTION}>
                <div style={H}>Other Stipulations</div>
                <textarea style={{ ...INP, minHeight: 80, resize: 'vertical' }} value={data.additionalTerms} onChange={e => patch({ additionalTerms: e.target.value })} placeholder="Any additional terms that don’t fit the rows above. One per line." />
              </div>

              <div style={SECTION}>
                <div style={H}>Signature / sign-off</div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}><label style={LBL}>Your name</label><input style={INP} value={data.agentName} onChange={e => patch({ agentName: e.target.value })} /></div>
                  <div style={{ flex: 1 }}><label style={LBL}>Email</label><input style={INP} value={data.agentEmail} onChange={e => patch({ agentEmail: e.target.value })} /></div>
                  <div style={{ flex: 1 }}><label style={LBL}>Phone</label><input style={INP} value={data.agentPhone} onChange={e => patch({ agentPhone: e.target.value })} /></div>
                </div>
              </div>

              <div style={SECTION}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ ...H, flex: 1, marginBottom: 0 }}>Seller acceptance</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setSellerCount(1)} style={{ fontSize: 12, fontWeight: 700, color: twoSellers ? '#9ca3af' : '#fff', background: twoSellers ? '#fff' : '#c9922c', border: '1px solid ' + (twoSellers ? '#e5e7eb' : '#c9922c'), borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>1 signer</button>
                    <button onClick={() => setSellerCount(2)} style={{ fontSize: 12, fontWeight: 700, color: twoSellers ? '#fff' : '#9ca3af', background: twoSellers ? '#c9922c' : '#fff', border: '1px solid ' + (twoSellers ? '#c9922c' : '#e5e7eb'), borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>2 signers</button>
                  </div>
                </div>
                {data.sellers.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}><label style={LBL}>Seller {i + 1} — entity / name</label><input style={INP} value={s.entity} onChange={e => setSeller(i, { entity: e.target.value })} /></div>
                    <div style={{ flex: 1 }}><label style={LBL}>Signatory (printed name)</label><input style={INP} value={s.signatory} onChange={e => setSeller(i, { signatory: e.target.value })} placeholder="e.g. Jane Doe, Manager" /></div>
                  </div>
                ))}
                <div style={{ fontSize: 11.5, color: '#9ca3af' }}>Signature &amp; date lines are filled by the signer during e-sign.</div>
              </div>
            </>
          )}
        </div>

        {/* ── Preview column ── */}
        {previewUrl && (
          <div style={{ flex: 1, borderLeft: '1px solid #eef0f2', background: '#e9ebee', minWidth: 0 }}>
            <iframe title="LOI preview" src={previewUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
          </div>
        )}
      </div>
    </div>
  );
}
