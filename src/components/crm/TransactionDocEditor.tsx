'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { parseRich, drawRichText, hasMarkup, type RichFonts } from '@/lib/rich-text';
import RichText, { RtFormatButtons } from '@/components/crm/RichText';
import LoiPurchaseBuilder from '@/components/crm/LoiPurchaseBuilder';

// The Letter of Intent to Purchase is a dynamic term-list doc, not a fixed overlay
// form — whichever surface opens it (deals page, property, Transaction Docs library),
// hand it to the builder so it never gets filled as flat fields.
const LOI_PURCHASE_FORM_ID = 'b58b11d1-c5fb-4861-97c5-97b0ab1026fb';

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
  type: 'text' | 'check' | 'signature' | 'initial' | 'date';
  signerRole?: 'client' | 'landlord' | 'agent';  // signature/initial/date placeholders belong to a party
  fieldKey?: string;        // fields sharing a key fill together (type once, fill everywhere)
  label?: string;           // human label, shown as the blank's placeholder
  defaultValue?: string;    // template's starting text, kept so re-saving the layout preserves it
}
// Only the PDF's own point dimensions are kept — the rendered pixel size is now
// decided by CSS (width:100% capped at RENDER_W, with a matching aspect-ratio).
interface PageDim { num: number; pw: number; ph: number; }

const RENDER_W = 850;
let _idc = 0;
const nextId = () => `f${++_idc}`;

// pdf-lib's StandardFonts.Helvetica can only draw WinAnsi (Latin-1) glyphs;
// any smart quote / dash / check mark / emoji throws mid-render. Map the common
// typographic characters to ASCII and drop anything else so a save never crashes.
const winAnsi = (s: string): string =>
  (s || '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•●]/g, '*')
    .replace(/[✓✔✅]/g, 'X')
    .replace(/ /g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');

interface DealLite { id: string; client?: string; property?: string; type?: string; }

export default function TransactionDocEditor({
  form, url, authToken, isAdmin, deals, dealId, listingId, businessUnit, submissionId, fieldPrefill, isMobile = false, onToast, onClose, onSaved,
}: {
  form: { id: string; name: string };
  url: string;
  authToken?: string;
  isAdmin?: boolean;
  deals?: DealLite[];
  dealId?: string;
  listingId?: string;  // when set, the doc saves into this property's folder (deal picker hidden)
  businessUnit?: string;
  submissionId?: string;
  fieldPrefill?: Record<string, string>;  // field_key → value, seeded into a blank form (e.g. the agent's own info)
  isMobile?: boolean;
  onToast?: (msg: string) => void;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [pages, setPages] = useState<PageDim[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tool, setTool] = useState<'text' | 'check' | 'signature' | 'initial' | 'date' | 'select'>('select');
  const [sigRole, setSigRole] = useState<'client' | 'landlord' | 'agent'>('client');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dealSel, setDealSel] = useState<string>(dealId ?? '');
  const subIdRef = useRef<string | undefined>(submissionId);
  // Pages used to render at a hard 850px, which overflows any phone. They now fill
  // the available width, capped at RENDER_W — so desktop still lands on exactly 850
  // and narrower screens scale down. 'full' pins the page back to 850 with
  // horizontal scroll, for tapping small fields precisely on a phone.
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit');
  const [noticeOpen, setNoticeOpen] = useState(isMobile);

  const bytesRef = useRef<Uint8Array | null>(null);
  const pdfRef = useRef<{ getPage: (n: number) => Promise<PdfPage> } | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; ofx: number; ofy: number; pw: number; ph: number } | null>(null);

  // The LOI to Purchase is delegated to the builder (see the early return below) —
  // skip all overlay PDF/field loading for it.
  const isLoi = form.id === LOI_PURCHASE_FORM_ID;

  // ── Load PDF + measure pages ────────────────────────────────────────────────
  useEffect(() => {
    if (isLoi) return;
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
          dims.push({ num: i, pw: base.width, ph: base.height });
        }
        if (cancelled) return;
        setPages(dims);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) { console.error('[DocEditor]', e); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [url, isLoi]);

  // ── Load fields: a saved submission's values (re-edit) or the blank template ─
  useEffect(() => {
    if (isLoi) return;
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
        setFields(json.fields.map((r: { page?: number; x: number; y: number; w: number; type?: string; field_key?: string | null; label?: string | null; default_value?: string | null; signer_role?: string | null }) => {
          const t = String(r.type || 'text');
          const type: Field['type'] = t === 'check' ? 'check' : t === 'signature' ? 'signature' : t === 'initial' ? 'initial' : (t === 'date' || t === 'date_signed') ? 'date' : 'text';
          return {
            id: nextId(), page: r.page ?? 1, fx: r.x, fy: r.y, fw: r.w,
            // A template may ship starting text (default_value) — e.g. the standard
            // LOI terms, which the agent then edits. The logged-in agent's own info
            // still wins, so agent_name/phone/email fill with the real sender.
            value: (r.field_key && fieldPrefill?.[r.field_key]) || r.default_value || '',
            size: 11, type,
            signerRole: (r.signer_role as Field['signerRole']) ?? undefined,
            fieldKey: r.field_key ?? undefined, label: r.label ?? undefined,
            defaultValue: r.default_value ?? undefined,
          };
        }));
      } catch { /* no template yet */ }
    })();
    return () => { cancelled = true; };
  }, [form.id, authToken, submissionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add a field on click ────────────────────────────────────────────────────
  const onPageClick = useCallback((e: React.MouseEvent, pd: PageDim) => {
    if (tool === 'select') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const id = nextId();
    const isSig = tool === 'signature' || tool === 'initial' || tool === 'date';
    const fw = tool === 'check' ? 0.03 : tool === 'initial' ? 0.07 : tool === 'date' ? 0.12 : tool === 'signature' ? 0.22 : 0.28;
    setFields(f => [...f, { id, page: pd.num, fx, fy, fw, value: tool === 'check' ? '✔' : '', size: 11, type: tool, signerRole: isSig ? sigRole : undefined }]);
    setSelected(id);
    setTool('select');
  }, [tool]);

  // ── Drag ────────────────────────────────────────────────────────────────────
  // The page's pixel size is read live off the DOM at drag time — it varies with the
  // viewport now that pages are width-driven, and measuring on demand can't go stale.
  const beginDrag = (id: string, clientX: number, clientY: number, f: Field, fieldBox: HTMLElement) => {
    const page = fieldBox.parentElement;
    if (!page) return;
    const r = page.getBoundingClientRect();
    setSelected(id);
    drag.current = { id, sx: clientX, sy: clientY, ofx: f.fx, ofy: f.fy, pw: r.width, ph: r.height };
  };
  const onDragStart = (e: React.MouseEvent<HTMLDivElement>, f: Field) => {
    e.stopPropagation();
    beginDrag(f.id, e.clientX, e.clientY, f, e.currentTarget);
  };
  // Only an already-selected field takes over touch, so a finger landing on any of
  // the dozens of blank-line fields still scrolls the page rather than dragging.
  const onTouchDragStart = (e: React.TouchEvent<HTMLDivElement>, f: Field) => {
    if (selected !== f.id) return;
    const t = e.touches[0]; if (!t) return;
    e.stopPropagation();
    beginDrag(f.id, t.clientX, t.clientY, f, e.currentTarget);
  };
  useEffect(() => {
    const apply = (clientX: number, clientY: number) => {
      const d = drag.current; if (!d) return;
      const dfx = (clientX - d.sx) / d.pw;
      const dfy = (clientY - d.sy) / d.ph;
      setFields(fs => fs.map(f => f.id === d.id ? { ...f, fx: Math.max(0, Math.min(0.98, d.ofx + dfx)), fy: Math.max(0, Math.min(0.99, d.ofy + dfy)) } : f));
    };
    const move = (e: MouseEvent) => { apply(e.clientX, e.clientY); };
    const touchMove = (e: TouchEvent) => {
      const t = e.touches[0]; if (!t || !drag.current) return;
      // Non-passive so the page doesn't scroll out from under the field being moved.
      e.preventDefault();
      apply(t.clientX, t.clientY);
    };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, []);

  // Typing in a field also fills every other field that shares its fieldKey — so a
  // tenant name / suite / date entered once propagates to all its occurrences.
  const updateVal = (id: string, value: string) => setFields(fs => {
    const key = fs.find(f => f.id === id)?.fieldKey;
    return fs.map(f => (f.id === id || (key && f.fieldKey === key)) ? { ...f, value } : f);
  });
  const delField = (id: string) => { setFields(fs => fs.filter(f => f.id !== id)); setSelected(null); };

  // ── Generate filled PDF ─────────────────────────────────────────────────────
  const build = useCallback(async (): Promise<Uint8Array | null> => {
    if (!bytesRef.current) return null;
    // Texas REALTORS PDFs ship with permission encryption; pdf-lib refuses to
    // load them for editing unless we explicitly ignore it.
    const doc = await PDFDocument.load(bytesRef.current, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const rich: RichFonts = {
      reg: font,
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      ital: await doc.embedFont(StandardFonts.HelveticaOblique),
      boldItal: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    };
    const ink = rgb(0.06, 0.06, 0.1);
    const pgs = doc.getPages();
    for (const f of fields) {
      const pg = pgs[f.page - 1]; if (!pg) continue;
      if (f.type === 'signature' || f.type === 'initial' || f.type === 'date') continue; // signer placeholders — stamped at signing time
      const { width, height } = pg.getSize();
      const x = f.fx * width + 2;
      // Baseline sits just above the blank line (detected fy = the underline),
      // matching where the on-screen field renders.
      const y = height - f.fy * height + 2;
      const size = f.size * 0.85;
      if (f.type === 'check') { if (f.value) pg.drawText('X', { x, y, size, font, color: ink }); continue; }
      const val = winAnsi(f.value || '');
      if (!val) continue;
      // Wrap long values to the field's width instead of running off the page; a short
      // plain value keeps the single-drawText fast path (clean text extraction).
      const maxW = Math.max(24, f.fw * width - 4);
      if (hasMarkup(val)) {
        drawRichText({ page: pg, runs: parseRich(val), x, y, size, lineHeight: size * 1.08, maxW, fonts: rich, color: ink });
      } else if (font.widthOfTextAtSize(val, size) <= maxW) {
        pg.drawText(val, { x, y, size, font, color: ink });
      } else {
        drawRichText({ page: pg, runs: parseRich(val), x, y, size, lineHeight: size * 1.08, maxW, fonts: rich, color: ink });
      }
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
      const payload = { fields: fields.map(f => ({ page: f.page, fx: f.fx, fy: f.fy, fw: f.fw, type: f.type, signer_role: f.signerRole ?? null, field_key: f.fieldKey ?? null, label: f.label ?? null, default_value: f.defaultValue ?? null })) };
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
        body: JSON.stringify({ form_id: form.id, deal_id: dealSel || null, listing_id: listingId ?? null, business_unit: businessUnit, title: form.name, values: fields, pdfBase64, submission_id: subIdRef.current }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.submission?.id) subIdRef.current = j.submission.id;
        onToast?.(dealSel ? '✓ Saved to the deal' : '✓ Saved to Transaction Docs');
        onSaved?.();
      } else {
        let detail = '';
        try { detail = (await res.json())?.error || ''; } catch { /* non-JSON */ }
        console.error('[saveToDeal] server', res.status, detail);
        onToast?.(detail ? `Could not save — ${detail}` : `Could not save (${res.status})`);
      }
    } catch (e) {
      console.error('[saveToDeal]', e);
      onToast?.('Could not save');
    }
    finally { setBusy(false); }
  }, [build, fields, dealSel, listingId, authToken, form.id, form.name, businessUnit, onToast, onSaved]);

  const toolBtn = (t: typeof tool, label: string) => (
    <button onClick={() => setTool(t)}
      style={{ padding: isMobile ? '10px 14px' : '7px 14px', minHeight: isMobile ? 44 : undefined, whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
        border: tool === t ? '1px solid #c9922c' : '1px solid #e5e7eb', background: tool === t ? '#fdf6e9' : '#fff', color: tool === t ? '#a06a12' : '#374151' }}>
      {label}
    </button>
  );
  const actionBtn: React.CSSProperties = {
    padding: isMobile ? '11px 14px' : '8px 16px', minHeight: isMobile ? 44 : undefined, whiteSpace: 'nowrap',
    fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
  };

  // Delegate the Letter of Intent to Purchase to its dynamic builder, regardless of
  // which surface opened it — so it's never filled as flat overlay fields.
  if (isLoi) {
    return (
      <LoiPurchaseBuilder
        formId={form.id}
        name={form.name}
        submissionId={submissionId}
        listingId={listingId}
        dealId={dealSel || dealId || undefined}
        businessUnit={businessUnit ?? 'commercial'}
        authToken={authToken}
        prefill={{
          agentName: fieldPrefill?.agent_name,
          agentEmail: fieldPrefill?.agent_email,
          agentPhone: fieldPrefill?.agent_phone,
          propertyAddress: fieldPrefill?.property,
          purchaser: fieldPrefill?.purchaser,
        }}
        onToast={m => onToast?.(m)}
        onClose={onClose}
        onSaved={() => onSaved?.()}
      />
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.55)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar — on a phone the title + close sit on their own row so ✕ is always
          reachable, and the actions scroll horizontally underneath. */}
      <div style={{ background: '#fff', borderBottom: '1px solid #eef0f2', padding: isMobile ? '9px 12px' : '10px 18px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 8 : 12, flexWrap: isMobile ? 'nowrap' : 'wrap', flexShrink: 0, paddingTop: isMobile ? 'calc(9px + env(safe-area-inset-top))' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: isMobile ? 17 : 20, fontWeight: 600, color: '#1a1a1a', marginRight: isMobile ? 0 : 8, flex: isMobile ? 1 : undefined, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.name}</div>
          {isMobile && (
            <>
              <button onClick={() => setZoom(z => (z === 'fit' ? 'full' : 'fit'))} aria-label="Toggle zoom"
                style={{ ...actionBtn, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', flexShrink: 0 }}>
                {zoom === 'fit' ? '🔍 100%' : '🔍 Fit'}
              </button>
              <button onClick={onClose} aria-label="Close"
                style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, width: 44, height: 44, cursor: 'pointer', fontSize: 18, color: '#6b7280', flexShrink: 0 }}>✕</button>
            </>
          )}
        </div>

        {!isMobile && (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {toolBtn('text', '➕ Text field')}
              {toolBtn('check', '☑︎ Check')}
              <span style={{ width: 1, height: 22, background: '#e5e7eb', margin: '0 2px' }} />
              <RtFormatButtons compact />
              <span style={{ width: 1, height: 22, background: '#e5e7eb', margin: '0 2px' }} />
              <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600 }}>Signer:</span>
              <select value={sigRole} onChange={e => setSigRole(e.target.value as 'client' | 'landlord' | 'agent')} title="Which party will fill this signature/initial/date field"
                style={{ padding: '7px 8px', fontSize: 12.5, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontFamily: "'DM Sans',sans-serif" }}>
                <option value="client">Client</option>
                <option value="landlord">Landlord</option>
                <option value="agent">Agent</option>
              </select>
              {toolBtn('signature', '✒ Signature')}
              {toolBtn('initial', '✎ Initials')}
              {toolBtn('date', '📅 Date')}
              <span style={{ width: 1, height: 22, background: '#e5e7eb', margin: '0 2px' }} />
              {toolBtn('select', '↖︎ Select / move')}
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>{fields.length} field{fields.length === 1 ? '' : 's'} · {tool !== 'select' ? 'click a page to place' : 'drag to move, click ✕ to delete'}</div>
          </>
        )}

        <div
          style={isMobile
            ? { display: 'flex', gap: 8, alignItems: 'center', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }
            : { marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {isAdmin && !isMobile && <button onClick={saveTemplate} disabled={busy} style={{ ...actionBtn, background: '#fff', color: '#a06a12', border: '1px solid #f0e2c4' }}>💾 Save field layout</button>}
          {!listingId && deals && deals.length > 0 && (
            <select value={dealSel} onChange={e => setDealSel(e.target.value)} title="Link this document to a deal"
              style={{ padding: isMobile ? '11px 10px' : '8px 10px', minHeight: isMobile ? 44 : undefined, fontSize: 13, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', maxWidth: 230, flexShrink: 0, fontFamily: "'DM Sans',sans-serif" }}>
              <option value="">— Link to a deal —</option>
              {deals.map(d => <option key={d.id} value={d.id}>{[d.client, d.property].filter(Boolean).join(' · ') || 'Deal'}</option>)}
            </select>
          )}
          <button onClick={saveToDeal} disabled={busy} style={{ ...actionBtn, background: '#fff', color: '#166534', border: '1px solid #bbf7d0' }}>{busy ? '…' : (dealSel ? '💾 Save to deal' : listingId ? '💾 Save to property' : '💾 Save')}</button>
          <button onClick={download} disabled={busy} style={{ ...actionBtn, background: '#c9922c', color: '#fff', border: 'none' }}>{busy ? 'Working…' : '⬇ Download'}</button>
          {!isMobile && <button onClick={onClose} aria-label="Close" style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 16, color: '#6b7280' }}>✕</button>}
        </div>
      </div>

      {/* Mobile: be honest that precise field placement wants a bigger screen */}
      {isMobile && noticeOpen && status === 'ready' && (
        <div style={{ background: '#fffdf6', borderBottom: '1px solid #f0e2c4', padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start', flexShrink: 0 }}>
          <span style={{ fontSize: 15, lineHeight: 1.3 }}>💡</span>
          <div style={{ flex: 1, fontSize: 12.5, color: '#7c5a12', lineHeight: 1.45, fontFamily: "'DM Sans',sans-serif" }}>
            You can fill, save and download this form here. Adding or repositioning fields is far easier on a desktop.
          </div>
          <button onClick={() => setNoticeOpen(false)} aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: '#a08a52', fontSize: 15, cursor: 'pointer', width: 32, height: 32, flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* Pages */}
      {/* alignItems must not be `center` while the page overflows: a centered flex item
          overflows on BOTH sides and the leading half becomes unreachable by scrolling.
          'fit' never overflows, so it keeps the centring. */}
      <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch', padding: isMobile ? '12px 6px calc(24px + env(safe-area-inset-bottom))' : '22px 12px', display: 'flex', flexDirection: 'column', alignItems: zoom === 'full' ? 'flex-start' : 'center' }}>
        {status === 'loading' && <div style={{ color: '#e5e7eb', padding: 60 }}>Loading document…</div>}
        {status === 'error' && <div style={{ color: '#fca5a5', padding: 60 }}>Couldn’t open this document.</div>}
        {/* 'fit' fills the pane but caps at RENDER_W, so a wide screen still lands on
            exactly 850 as before; 'full' pins it there and lets the pane scroll. */}
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isMobile ? 12 : 18,
            ...(zoom === 'full'
              ? { width: RENDER_W, flex: '0 0 auto' }
              : { width: '100%', maxWidth: RENDER_W }),
          }}>
        {pages.map(pd => {
          // Field boxes are positioned in page fractions, so they follow the container
          // for free. Font sizes are the one px-denominated part, so they're expressed
          // in cqw — a share of the page's own rendered width — and the layout engine
          // keeps them in step at every size. At 850px this reproduces the old
          // `f.size * (850/pw) * 0.85` px exactly, so desktop output is unchanged.
          const cqw = (pts: number) => `${(pts / pd.pw * 100).toFixed(4)}cqw`;
          return (
          <div key={pd.num} onClick={e => onPageClick(e, pd)}
            style={{ position: 'relative', width: '100%', aspectRatio: `${pd.pw}/${pd.ph}`, containerType: 'inline-size', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,.25)', cursor: tool === 'select' ? 'default' : 'crosshair' }}>
            <PageCanvas pageNum={pd.num} pdfRef={pdfRef} />
            {fields.filter(f => f.page === pd.num).map(f => {
              const isSel = selected === f.id;
              const isCheck = f.type === 'check';
              const isSig = f.type === 'signature' || f.type === 'initial' || f.type === 'date';
              // Pin the box BOTTOM to the detected underline (fy) via translateY(-100%),
              // and keep it one tight line tall so adjacent blanks don't merge into a block.
              // The 11px floor keeps the box tappable once the page scales down.
              const em = f.size * 0.85;
              if (isSig) {
                const role = f.signerRole || 'client';
                const rc = role === 'landlord' ? '#2563eb' : role === 'agent' ? '#16a34a' : '#c9922c';
                const kind = f.type === 'signature' ? 'Signature' : f.type === 'initial' ? 'Initials' : 'Date';
                const glyph = f.type === 'signature' ? '✒' : f.type === 'initial' ? '✎' : '📅';
                return (
                  <div key={f.id}
                    onMouseDown={e => onDragStart(e, f)} onTouchStart={e => onTouchDragStart(e, f)}
                    title={`${role} — ${kind} · filled when ${role} signs`}
                    style={{ position: 'absolute', left: `${f.fx * 100}%`, top: `${f.fy * 100}%`, width: `${f.fw * 100}%`,
                      height: `max(16px, ${cqw(em * 1.6)})`, transform: 'translateY(-100%)', boxSizing: 'border-box', borderRadius: 3, overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: isSel ? 'none' : undefined, cursor: 'move',
                      background: `${rc}22`, border: `1.5px dashed ${rc}`, outline: isSel ? `2px solid ${rc}` : 'none' }}>
                    <span style={{ fontSize: `max(7px, ${cqw(6.5)})`, fontWeight: 700, color: rc, textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 3px', pointerEvents: 'none' }}>{glyph} {role} {kind}</span>
                    {isSel && (
                      <button onClick={e => { e.stopPropagation(); delField(f.id); }} onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} aria-label="Delete field"
                        style={{ position: 'absolute', top: isMobile ? -13 : -9, right: isMobile ? -13 : -9, width: isMobile ? 26 : 17, height: isMobile ? 26 : 17, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: isMobile ? 13 : 10, cursor: 'pointer', lineHeight: isMobile ? '26px' : '17px', padding: 0 }}>✕</button>
                    )}
                  </div>
                );
              }
              return (
              <div key={f.id}
                onMouseDown={e => onDragStart(e, f)}
                onTouchStart={e => onTouchDragStart(e, f)}
                style={{ position: 'absolute', left: `${f.fx * 100}%`, top: `${f.fy * 100}%`, width: `${f.fw * 100}%`,
                  height: `max(11px, ${cqw(em * 1.1)})`, transform: 'translateY(-100%)', boxSizing: 'border-box', borderRadius: 2, overflow: 'visible',
                  display: 'flex', alignItems: isCheck ? 'center' : 'flex-end', touchAction: isSel ? 'none' : undefined,
                  background: isSel ? 'rgba(201,146,44,.20)' : (isCheck ? 'rgba(37,99,235,.05)' : 'rgba(37,99,235,.07)'),
                  outline: isSel ? '1.5px solid #c9922c' : 'none' }}>
                {isCheck ? (
                  <input
                    className="pdf-fill-input"
                    value={f.value}
                    placeholder={f.label || ''}
                    title={f.label || ''}
                    onChange={e => updateVal(f.id, e.target.value)}
                    onMouseDown={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                    onFocus={() => setSelected(f.id)}
                    style={{ width: '100%', height: 'auto', minHeight: 0, boxSizing: 'border-box', border: 'none', background: 'transparent', outline: 'none',
                      fontSize: cqw(em), lineHeight: cqw(em * 1.05), color: '#0b1f4d',
                      textAlign: 'center', padding: '0 2px', margin: 0, fontFamily: 'Helvetica, Arial, sans-serif' }}
                  />
                ) : (
                  <RichText
                    value={f.value}
                    onChange={v => updateVal(f.id, v)}
                    placeholder={f.label || ''}
                    onFocus={() => setSelected(f.id)}
                    stopDrag
                    style={{ width: '100%', minHeight: 0, fontSize: cqw(em), lineHeight: cqw(em * 1.05), color: '#0b1f4d',
                      textAlign: 'left', padding: '0 2px', fontFamily: 'Helvetica, Arial, sans-serif', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  />
                )}
                {isSel && (
                  <button onClick={e => { e.stopPropagation(); delField(f.id); }}
                    onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}
                    aria-label="Delete field"
                    style={{ position: 'absolute', top: isMobile ? -13 : -9, right: isMobile ? -13 : -9, width: isMobile ? 26 : 17, height: isMobile ? 26 : 17, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: isMobile ? 13 : 10, cursor: 'pointer', lineHeight: isMobile ? '26px' : '17px', padding: 0 }}>✕</button>
                )}
              </div>
            );
            })}
          </div>
          );
        })}
        </div>
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
