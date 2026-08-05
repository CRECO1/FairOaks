'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';

interface Form {
  id: string;
  name: string;
  form_code?: string;
  category?: string;
  page_count?: number;
  storage_path: string;
  created_at?: string;
}

interface Props {
  businessUnit: string;
  isAdmin: boolean;
  authToken?: string;
  onToast: (msg: string) => void;
}

export default function TransactionDocsSection({ businessUnit, authToken, onToast }: Props) {
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [viewing, setViewing] = useState<{ form: Form; url: string } | null>(null);

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

  const openView = useCallback(async (form: Form) => {
    try {
      const res = await fetch(`/api/crm/forms/${form.id}/url`, { headers: authHeaders });
      const json = await res.json();
      if (json.url) setViewing({ form, url: json.url });
      else onToast('Could not open the PDF');
    } catch { onToast('Could not open the PDF'); }
  }, [authHeaders, onToast]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return forms;
    return forms.filter(f => (f.name + ' ' + (f.form_code ?? '')).toLowerCase().includes(term));
  }, [forms, q]);

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
              <button onClick={() => openView(f)}
                style={{ flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                Open
              </button>
            </div>
          </div>
        ))}
      </div>

      {viewing && (
        <div onClick={() => setViewing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.6)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: '3vh 3vw' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #eef0f2' }}>
              <div style={{ fontWeight: 600, color: '#1a1a1a' }}>{viewing.form.name}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <a href={viewing.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#c9922c', textDecoration: 'none' }}>Download ↗</a>
                <button onClick={() => setViewing(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16, color: '#6b7280' }}>✕</button>
              </div>
            </div>
            <iframe src={viewing.url} title={viewing.form.name} style={{ flex: 1, border: 'none', width: '100%' }} />
          </div>
        </div>
      )}
    </div>
  );
}
