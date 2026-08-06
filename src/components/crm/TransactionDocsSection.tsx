'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

const TransactionDocEditor = dynamic(() => import('./TransactionDocEditor'), { ssr: false });

interface Form {
  id: string;
  name: string;
  form_code?: string;
  category?: string;
  page_count?: number;
  storage_path: string;
  url?: string | null;
  created_at?: string;
}

interface DealLite { id: string; client?: string; property?: string; type?: string; stage?: string; }

interface Props {
  businessUnit: string;
  isAdmin: boolean;
  authToken?: string;
  deals?: DealLite[];
  onNewDeal?: () => void;
  onToast: (msg: string) => void;
}

const ACTIVE_STAGES = ['Active', 'LOI', 'In Contract'];

export default function TransactionDocsSection({ businessUnit, isAdmin, authToken, deals, onNewDeal, onToast }: Props) {
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ form: Form; dealId?: string } | null>(null);
  const [pickForDeal, setPickForDeal] = useState<string | null>(null);

  const authHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return h;
  }, [authToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/forms?business_unit=${businessUnit}`, { headers: authHeaders });
      const json = await res.json();
      setForms(json.forms ?? []);
    } catch { onToast('Could not load forms'); }
    setLoading(false);
  }, [businessUnit, authHeaders, onToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return forms;
    return forms.filter(f => (f.name + ' ' + (f.form_code ?? '')).toLowerCase().includes(term));
  }, [forms, q]);

  const activeDeals = useMemo(() => (deals ?? []).filter(d => !d.stage || ACTIVE_STAGES.includes(d.stage)), [deals]);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 18 }}>
        <div>
          <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>Transaction Docs</h2>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            Your own fillable forms. Open to preview, or <strong>Fill</strong> to complete and generate a signed-ready PDF.
          </div>
        </div>
        <input
          placeholder="🔍  Search forms…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, minWidth: 240, flex: '0 1 300px', fontFamily: "'DM Sans',sans-serif" }}
        />
      </div>

      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16, fontWeight: 600 }}>
        {loading ? 'Loading…' : `${filtered.length} form${filtered.length === 1 ? '' : 's'}`}
      </div>

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '54px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
          No forms yet.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {filtered.map(f => (
          <div key={f.id} style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 26 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 19, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.2 }}>{f.name}</div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 3, fontWeight: 600 }}>
                  {f.form_code ? `Form ${f.form_code}` : ''}{f.form_code && f.page_count ? ' · ' : ''}{f.page_count ? `${f.page_count} pages` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => setEditing({ form: f })}
                style={{ flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                ✍️ Fill out
              </button>
              <a href={f.url ?? undefined} target="_blank" rel="noopener noreferrer"
                style={{ textAlign: 'center', textDecoration: 'none', padding: '9px 14px', fontSize: 13, fontWeight: 600, background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: "'DM Sans',sans-serif" }}>
                Open ↗
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Active Deals — create a deal or attach a doc to one */}
      <div style={{ marginTop: 36 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 21, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>Active Deals</h3>
            <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 1 }}>Attach a completed form to a live deal — or start a new one.</div>
          </div>
          {onNewDeal && (
            <button onClick={onNewDeal} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋ New Deal</button>
          )}
        </div>
        {activeDeals.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af', padding: '10px 0' }}>No active deals yet. Create one to start attaching documents.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {activeDeals.map(d => (
              <div key={d.id} style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.client || 'Deal'}</div>
                <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[d.property, d.type].filter(Boolean).join(' · ')}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                  {d.stage && <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', padding: '2px 8px', borderRadius: 20 }}>{d.stage}</span>}
                  <button onClick={() => setPickForDeal(d.id)} style={{ marginLeft: 'auto', padding: '7px 12px', fontSize: 12.5, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px solid #f0e2c4', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋ Add doc</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pick a form to attach to the chosen deal */}
      {pickForDeal && (
        <div onClick={() => setPickForDeal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '12vh 16px', overflowY: 'auto', fontFamily: "'DM Sans',sans-serif" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 460, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef0f2', fontWeight: 600, fontSize: 16, color: '#1a1a1a' }}>Pick a form for this deal</div>
            <div style={{ padding: 10, maxHeight: '52vh', overflowY: 'auto' }}>
              {forms.map(f => (
                <button key={f.id} onClick={() => { setEditing({ form: f, dealId: pickForDeal }); setPickForDeal(null); }}
                  style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 10, alignItems: 'center', padding: '11px 12px', border: 'none', background: 'none', cursor: 'pointer', borderRadius: 8, fontFamily: "'DM Sans',sans-serif" }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fbf8f1')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  <span style={{ fontSize: 20 }}>📄</span>
                  <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{f.name}</span>{f.form_code && <span style={{ fontSize: 12, color: '#9ca3af' }}>{f.form_code}</span>}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {editing && editing.form.url && (
        <TransactionDocEditor
          form={{ id: editing.form.id, name: editing.form.name }}
          url={editing.form.url}
          authToken={authToken}
          isAdmin={isAdmin}
          deals={deals}
          dealId={editing.dealId}
          businessUnit={businessUnit}
          onToast={onToast}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
