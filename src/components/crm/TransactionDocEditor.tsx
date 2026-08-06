'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// A zipForms-style fillable editor: renders a flat PDF's pages inline (pdf.js),
// lets an agent drop text/check fields anywhere, type into them, then generates
// a completed PDF with the values stamped on (pdf-lib). Field positions are
// stored as page-relative fractions (0..1) so they're resolution-independent.

interface Field {
  id: string;
  page: number;      // 1-based
  fx: number; fy: number;   // top-left, fraction of page w/h
  fw: number;               // width fraction
  value: string;
  size: number;             // font size in PDF points
  type: 'text' | 'check';
}
interface PageDim { num: number; w: number; h: number; pw: number; ph: number; }

const RENDER_W = 850;
let _idc = 0;
const nextId = () => `f${++_idc}`;

interface DealLite { id: string; client?: string; property?: string; type?: string; }

export default function TransactionDocEditor({
  form, url, authToken, isAdmin, deals, dealId, businessUnit, submissionId, onToast, onClose, onSaved,
}: {
  form: { id: string; name: string };
  url: string;
  authToken?: string;
  isAdmin?: boolean;
  deals?: DealLite[];
  dealId?: string;
  businessUnit?: string;
  submissionId?: string;
  onToast?: (msg: string) => void;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [pages, setPages] = useState<PageDim[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tool, setTool] = useState<'text' | 'check' | 'select'>('text');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dealSel, setDealSel] = useState<string>(dealId ?? '');
  const subIdRef = useRef<string | undefined>(submissionId);

  const bytesRef = useRef<Uint8Array | null>(null);
  const pdfRef = useRef<{ getPage: (n: number) => Promise<PdfPage> } | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; ofx: number; ofy: number; pw: number; ph: number } | null>(null);

  // ── Load PDF + measure pages ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const ab = await resp.arrayBuffer();
        bytesRef.current = new Uint8Array(ab.slice(0)); // copy — pdf.js detaches the buffer
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data: ab }).promise;
        pdfRef.current = pdf as unknown as { getPage: (n: number) => Promise<PdfPage> };
        const dims: PageDim[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i);
          const base = p.getViewport({ scale: 1 });
          const scale = RENDER_W / base.width;
          const vp = p.getViewport({ scale });
          dims.push({ num: i, w: vp.width, h: vp.height, pw: base.width, ph: base.height });
        }
        if (cancelled) return;
        setPages(dims);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) { console.error('[DocEditor]', e); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  // ── Load fields: a saved submission's values (re-edit) or the blank template ─
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h: Record<string, string> = {};
        if (authToken) h.Authorization = `Bearer ${authToken}`;
        if (submissionId) {
          const r = await fetch(`/api/crm/form-submissions/${submissionId}`, { headers: h });
          const j = await r.json();
          if (cancelled) return;
          const vals = j.submission?.values;
          if (Array.isArray(vals) && vals.length) {
            setFields(vals.map((f: Field) => ({ ...f, id: nextId() })));
            return;
          }
        }
        const res = await fetch(`/api/crm/forms/${form.id}/fields`, { headers: h });
        const json = await res.json();
        if (cancelled || !Array.isArray(json.fields)) return;
        setFields(json.fields.map((r: { page?: number; x: number; y: number; w: number; type?: string }) => ({
          id: nextId(), page: r.page ?? 1, fx: r.x, fy: r.y, fw: r.w,
          value: '', size: 11, type: r.type === 'check' ? 'check' : 'text',
        })));
      } catch { /* no template yet */ }
    })();
    return () => { cancelled = true; };
  }, [form.id, authToken, submissionId]);

  // ── Add a field on click ────────────────────────────────────────────────────
  const onPageClick = useCallback((e: React.MouseEvent, pd: PageDim) => {
    if (tool === 'select') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const id = nextId();
    setFields(f => [...f, { id, page: pd.num, fx, fy, fw: tool === 'check' ? 0.03 : 0.28, value: tool === 'check' ? '✔' : '', size: 11, type: tool }]);
    setSelected(id);
    setTool('select');
  }, [tool]);

  // ── Drag ────────────────────────────────────────────────────────────────────
  const onDragStart = (e: React.MouseEvent, f: Field, pd: PageDim) => {
    e.stopPropagation();
    setSelected(f.id);
    drag.current = { id: f.id, sx: e.clientX, sy: e.clientY, ofx: f.fx, ofy: f.fy, pw: pd.w, ph: pd.h };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current; if (!d) return;
      const dfx = (e.clientX - d.sx) / d.pw;
      const dfy = (e.clientY - d.sy) / d.ph;
      setFields(fs => fs.map(f => f.id === d.id ? { ...f, fx: Math.max(0, Math.min(0.98, d.ofx + dfx)), fy: Math.max(0, Math.min(0.99, d.ofy + dfy)) } : f));
    };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const updateVal = (id: string, value: string) => setFields(fs => fs.map(f => f.id === id ? { ...f, value } : f));
  const delField = (id: string) => { setFields(fs => fs.filter(f => f.id !== id)); setSelected(null); };

  // ── Generate filled PDF ─────────────────────────────────────────────────────
  const build = useCallback(async (): Promise<Uint8Array | null> => {
    if (!bytesRef.current) return null;
    const doc = await PDFDocument.load(bytesRef.current);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pgs = doc.getPages();
    for (const f of fields) {
      const pg = pgs[f.page - 1]; if (!pg) continue;
      const { width, height } = pg.getSize();
      const x = f.fx * width;
      const y = height - f.fy * height - f.size;
      pg.drawText(f.value || '', { x, y, size: f.size, font, color: rgb(0.06, 0.06, 0.1) });
    }
    return doc.save();
  }, [fields]);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const out = await build();
      if (!out) return;
      const blob = new Blob([out.slice()], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${form.name} (filled).pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally { setBusy(false); }
  }, [build, form.name]);

  const saveTemplate = useCallback(async () => {
    setBusy(true);
    try {
      const h: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) h.Authorization = `Bearer ${authToken}`;
      const payload = { fields: fields.map(f => ({ page: f.page, fx: f.fx, fy: f.fy, fw: f.fw, type: f.type })) };
      const res = await fetch(`/api/crm/forms/${form.id}/fields`, { method: 'PUT', headers: h, body: JSON.stringify(payload) });
      onToast?.(res.ok ? '✓ Field layout saved for this form' : 'Could not save the layout');
    } catch { onToast?.('Could not save the layout'); }
    finally { setBusy(false); }
  }, [fields, authToken, form.id, onToast]);

  const saveToDeal = useCallback(async () => {
    setBusy(true);
    try {
      const out = await build();
      if (!out) return;
      // base64-encode the PDF in chunks (avoids call-stack limits on big files)
      let bin = '';
      const bytes = new Uint8Array(out);
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
      const pdfBase64 = btoa(bin);
      const h: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) h.Authorization = `Bearer ${authToken}`;
      const res = await fetch('/api/crm/form-submissions', {
        method: 'POST', headers: h,
        body: JSON.stringify({ form_id: form.id, deal_id: dealSel || null, business_unit: businessUnit, title: form.name, values: fields, pdfBase64, submission_id: subIdRef.current }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.submission?.id) subIdRef.current = j.submission.id;
        onToast?.(dealSel ? '✓ Saved to the deal' : '✓ Saved to Transaction Docs');
        onSaved?.();
      } else onToast?.('Could not save');
    } catch { onToast?.('Could not save'); }
    finally { setBusy(false); }
  }, [build, fields, dealSel, authToken, form.id, form.name, businessUnit, onToast, onSaved]);

  const toolBtn = (t: typeof tool, label: string) => (
    <button onClick={() => setTool(t)}
      style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
        border: tool === t ? '1px solid #c9922c' : '1px solid #e5e7eb', background: tool === t ? '#fdf6e9' : '#fff', color: tool === t ? '#a06a12' : '#374151' }}>
      {label}
    </button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.55)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #eef0f2', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 600, color: '#1a1a1a', marginRight: 8 }}>{form.name}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {toolBtn('text', '➕ Text field')}
          {toolBtn('check', '☑︎ Check')}
          {toolBtn('select', '↖︎ Select / move')}
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>{fields.length} field{fields.length === 1 ? '' : 's'} · {tool !== 'select' ? 'click a page to place' : 'drag to move, click ✕ to delete'}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {isAdmin && <button onClick={saveTemplate} disabled={busy} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: '#fff', color: '#a06a12', border: '1px solid #f0e2c4', borderRadius: 8, cursor: 'pointer' }}>💾 Save field layout</button>}
          {deals && deals.length > 0 && (
            <select value={dealSel} onChange={e => setDealSel(e.target.value)} title="Link this document to a deal"
              style={{ padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', maxWidth: 230, fontFamily: "'DM Sans',sans-serif" }}>
              <option value="">— Link to a deal —</option>
              {deals.map(d => <option key={d.id} value={d.id}>{[d.client, d.property].filter(Boolean).join(' · ') || 'Deal'}</option>)}
            </select>
          )}
          <button onClick={saveToDeal} disabled={busy} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: '#fff', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 8, cursor: 'pointer' }}>{busy ? '…' : (dealSel ? '💾 Save to deal' : '💾 Save')}</button>
          <button onClick={download} disabled={busy} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>{busy ? 'Working…' : '⬇ Download'}</button>
          <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 16, color: '#6b7280' }}>✕</button>
        </div>
      </div>

      {/* Pages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '22px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        {status === 'loading' && <div style={{ color: '#e5e7eb', padding: 60 }}>Loading document…</div>}
        {status === 'error' && <div style={{ color: '#fca5a5', padding: 60 }}>Couldn’t open this document.</div>}
        {pages.map(pd => (
          <div key={pd.num} onClick={e => onPageClick(e, pd)}
            style={{ position: 'relative', width: pd.w, height: pd.h, background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,.25)', cursor: tool === 'select' ? 'default' : 'crosshair', flex: '0 0 auto' }}>
            <PageCanvas pageNum={pd.num} pdfRef={pdfRef} />
            {fields.filter(f => f.page === pd.num).map(f => (
              <div key={f.id}
                onMouseDown={e => onDragStart(e, f, pd)}
                style={{ position: 'absolute', left: `${f.fx * 100}%`, top: `${f.fy * 100}%`, width: `${f.fw * 100}%`,
                  outline: selected === f.id ? '2px solid #c9922c' : '1px dashed rgba(201,146,44,.7)', background: 'rgba(255,249,235,.75)', borderRadius: 3 }}>
                <input
                  value={f.value}
                  onChange={e => updateVal(f.id, e.target.value)}
                  onMouseDown={e => e.stopPropagation()}
                  onFocus={() => setSelected(f.id)}
                  style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: f.size * (pd.w / pd.pw), color: '#111', padding: '1px 3px', fontFamily: 'Helvetica, Arial, sans-serif' }}
                />
                {selected === f.id && (
                  <button onClick={e => { e.stopPropagation(); delField(f.id); }}
                    style={{ position: 'absolute', top: -10, right: -10, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: '18px', padding: 0 }}>✕</button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Per-page canvas ────────────────────────────────────────────────────────────
interface PdfViewport { width: number; height: number; }
interface PdfPage { getViewport: (o: { scale: number }) => PdfViewport; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; canvas: HTMLCanvasElement }) => { promise: Promise<void> }; }

function PageCanvas({ pageNum, pdfRef }: { pageNum: number; pdfRef: React.RefObject<{ getPage: (n: number) => Promise<PdfPage> } | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdf = pdfRef.current; const canvas = ref.current;
      if (!pdf || !canvas) return;
      const page = await pdf.getPage(pageNum);
      const base = page.getViewport({ scale: 1 });
      const scale = RENDER_W / base.width;
      const vp = page.getViewport({ scale });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx || cancelled) return;
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    })();
    return () => { cancelled = true; };
  }, [pageNum, pdfRef]);
  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />;
}
