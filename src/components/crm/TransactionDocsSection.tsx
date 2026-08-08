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
  isMobile?: boolean;
}

const ACTIVE_STAGES = ['Active', 'LOI', 'In Contract'];

export default function TransactionDocsSection({ businessUnit, isAdmin, authToken, deals, onNewDeal, onToast, isMobile = false }: Props) {
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ form: Form; dealId?: string } | null>(null);
  const [pickForDeal, setPickForDeal] = useState<string | null>(null);
  const [formMenuOpen, setFormMenuOpen] = useState(false);

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
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: isMobile ? 23 : 26, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>Transaction Docs</h2>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
          Pick a form to fill, or attach a use-case packet to a deal below.
        </div>
      </div>

      {(() => {
        const catColor = (c?: string) => c === 'Purchase' ? { bg: '#f3e8ff', color: '#7e22ce' } : { bg: '#e0f2fe', color: '#0369a1' };
        const cats = Array.from(new Set(filtered.map(f => f.category || 'Other')));
        return (
          <div style={{ position: 'relative', maxWidth: isMobile ? '100%' : 560 }}>
            <button onClick={() => setFormMenuOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', background: formMenuOpen ? '#fffdf6' : '#fff', border: `1px solid ${formMenuOpen ? '#c9922c' : '#e5e7eb'}`, borderRadius: 12, padding: '13px 16px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
              <span style={{ fontSize: 24 }}>🖊️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>Fill out a form</div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>{loading ? 'Loading…' : `${forms.length} forms — contracts, lease, addenda & more`}</div>
              </div>
              <span style={{ fontSize: 12, color: '#c9922c', fontWeight: 700, transform: formMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
            </button>
            {formMenuOpen && (
              <>
                <div onClick={() => setFormMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, background: '#fff', border: '1px solid #eef0f2', borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,.18)', zIndex: 50, overflow: 'hidden' }}>
                  <div style={{ padding: 10, borderBottom: '1px solid #f4f5f7' }}>
                    <input autoFocus placeholder="🔍  Search forms…" value={q} onChange={e => setQ(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans',sans-serif", boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ maxHeight: '48vh', overflowY: 'auto', padding: 6 }}>
                    {filtered.length === 0 && <div style={{ padding: 24, color: '#9ca3af', textAlign: 'center', fontSize: 13 }}>No forms match.</div>}
                    {cats.map(cat => {
                      const items = filtered.filter(f => (f.category || 'Other') === cat);
                      if (!items.length) return null;
                      return (
                        <div key={cat} style={{ marginBottom: 4 }}>
                          <div style={{ fontSize: 10.5, letterSpacing: .7, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, padding: '8px 10px 4px' }}>{cat}</div>
                          {items.map(f => {
                            const cc = catColor(f.category);
                            return (
                              <div key={f.id} onClick={() => { setEditing({ form: f }); setFormMenuOpen(false); }}
                                style={{ display: 'flex', alignItems: 'center', gap: 11, padding: isMobile ? '12px 10px' : '9px 10px', minHeight: isMobile ? 48 : undefined, borderRadius: 8, cursor: 'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#fbf8f1')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                <span style={{ fontSize: 18, flexShrink: 0 }}>📄</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                                  <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 1 }}>{f.form_code ? `Form ${f.form_code}` : ''}{f.form_code && f.page_count ? ' · ' : ''}{f.page_count ? `${f.page_count} pp` : ''}</div>
                                </div>
                                {f.category && !isMobile && <span style={{ fontSize: 10.5, fontWeight: 600, color: cc.color, background: cc.bg, padding: '2px 8px', borderRadius: 20, flexShrink: 0 }}>{f.category}</span>}
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#c9922c', flexShrink: 0 }}>Fill ›</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* Active Deals — create a deal or attach a doc to one */}
      <div style={{ marginTop: isMobile ? 26 : 36 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 21, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>Active Deals</h3>
            <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 1 }}>Attach a completed form to a live deal — or start a new one.</div>
          </div>
          {onNewDeal && (
            <button onClick={onNewDeal} style={{ padding: isMobile ? '12px 16px' : '8px 16px', minHeight: isMobile ? 44 : undefined, fontSize: 13, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋ New Deal</button>
          )}
        </div>
        {activeDeals.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af', padding: '10px 0' }}>No active deals yet. Create one to start attaching documents.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {activeDeals.map(d => (
              <div key={d.id} style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.client || 'Deal'}</div>
                <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[d.property, d.type].filter(Boolean).join(' · ')}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                  {d.stage && <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', padding: '2px 8px', borderRadius: 20 }}>{d.stage}</span>}
                  <button onClick={() => setPickForDeal(d.id)} style={{ marginLeft: 'auto', padding: isMobile ? '11px 14px' : '7px 12px', minHeight: isMobile ? 44 : undefined, fontSize: 12.5, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px solid #f0e2c4', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋ Add doc</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pick a form to attach to the chosen deal */}
      {pickForDeal && (
        <div onClick={() => setPickForDeal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-end' : 'flex-start', padding: isMobile ? 0 : '12vh 16px', overflowY: isMobile ? 'hidden' : 'auto', fontFamily: "'DM Sans',sans-serif" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: isMobile ? '18px 18px 0 0' : 14, maxWidth: isMobile ? '100%' : 460, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden', ...(isMobile ? { maxHeight: '88vh', display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom)' } : {}) }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef0f2', fontWeight: 600, fontSize: 16, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ flex: 1 }}>Pick a form for this deal</span>
              <button onClick={() => setPickForDeal(null)} aria-label="Close"
                style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, width: isMobile ? 44 : 32, height: isMobile ? 44 : 32, cursor: 'pointer', fontSize: 16, color: '#6b7280', flexShrink: 0 }}>✕</button>
            </div>
            <div style={{ padding: 10, maxHeight: isMobile ? undefined : '52vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', ...(isMobile ? { flex: 1, minHeight: 0 } : {}) }}>
              {forms.map(f => (
                <button key={f.id} onClick={() => { setEditing({ form: f, dealId: pickForDeal }); setPickForDeal(null); }}
                  style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 10, alignItems: 'center', padding: isMobile ? '13px 12px' : '11px 12px', minHeight: isMobile ? 48 : undefined, border: 'none', background: 'none', cursor: 'pointer', borderRadius: 8, fontFamily: "'DM Sans',sans-serif" }}
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
          isMobile={isMobile}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
