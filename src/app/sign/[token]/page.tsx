'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { renderPdfPages, revokePages, type RenderedPage } from '@/lib/pdf-render';
import { labelFor, readTextRuns, isGenericLabel } from '@/lib/pdf-field-labels';
import { Dancing_Script, Great_Vibes, Sacramento, Homemade_Apple, Caveat } from 'next/font/google';

// Five hands to adopt from, self-hosted by next/font (so no external font request has
// to survive the CSP, and there's no flash of a fallback face before the canvas draw).
const dancing = Dancing_Script({ subsets: ['latin'], weight: '600', display: 'block' });
const vibes = Great_Vibes({ subsets: ['latin'], weight: '400', display: 'block' });
const sacramento = Sacramento({ subsets: ['latin'], weight: '400', display: 'block' });
const homemade = Homemade_Apple({ subsets: ['latin'], weight: '400', display: 'block' });
const caveat = Caveat({ subsets: ['latin'], weight: '600', display: 'block' });

const STYLES = [
  { key: 'dancing', label: 'Flowing', family: dancing.style.fontFamily },
  { key: 'vibes', label: 'Formal', family: vibes.style.fontFamily },
  { key: 'sacramento', label: 'Classic', family: sacramento.style.fontFamily },
  { key: 'homemade', label: 'Handwritten', family: homemade.style.fontFamily },
  { key: 'caveat', label: 'Casual', family: caveat.style.fontFamily },
];

type Party = { role: string; name: string; order: number; status: string };
// A spot this signer has to confirm. Positions are page fractions, y measured from
// the top to the field's baseline — the same frame the editor placed them in.
type SignField = { id: string; page: number; fx: number; fy: number; fw: number; type: string; label?: string; value?: string; required?: boolean };
type SignData = { status: string; doc_url: string | null; title: string; fields?: SignField[]; signer: { name: string; role: string; email: string; in_person?: boolean }; parties: Party[] };
const typeLabel = (t: string) => t === 'signature' ? 'Sign' : t === 'initial' ? 'Initial' : t === 'text' ? 'Fill in' : t === 'check' ? 'Check' : 'Date';
const isInput = (t: string) => t === 'text' || t === 'check';
// Imported documents carry their file name as the title ("Commercial_Lease_Amendment__filled_").
// Shown as words: an unbroken underscore run can't wrap on a phone and reads like a file path.
// Display only — the stored title (and the email subject) are left alone.
const displayTitle = (t?: string | null) => {
  const s = String(t || '').replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/\s*\(?\bfilled\b\)?\s*$/i, '').replace(/\s+/g, ' ').trim();
  return s || 'Document';
};

const GOLD = '#c9922c';
const INK = '#0d1b4b';
const TAP = 44;          // smallest comfortable thumb target, in CSS px
const PEN = 2.5;         // drawn stroke width, in CSS px
const initialsOf = (n: string) => (n || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 4);

type Pt = { x: number; y: number };
function paintStroke(ctx: CanvasRenderingContext2D, s: Pt[]) {
  if (!s.length) return;
  if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0].x, s[0].y, PEN / 2, 0, Math.PI * 2); ctx.fill(); return; }
  ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y);
  for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
  ctx.stroke();
}
function penStyle(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = PEN; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; ctx.fillStyle = '#111';
}

// The drawn signature as the server stores it. The pad's on-screen shape changes with
// the phone (portrait, landscape, desktop), so the strokes are re-rendered into one
// fixed 32:9 image — the shape the executed PDF has always stamped — scaled evenly
// and left-aligned like a signature on a line. Stretching the pad's pixels instead
// is what used to squash a phone signature sideways.
function exportStrokes(strokes: Pt[][], outW = 1280, outH = 360): string | undefined {
  const pts = strokes.flat();
  if (!pts.length) return undefined;
  const pad = PEN * 2;
  const minX = Math.min(...pts.map(p => p.x)) - pad, maxX = Math.max(...pts.map(p => p.x)) + pad;
  const minY = Math.min(...pts.map(p => p.y)) - pad, maxY = Math.max(...pts.map(p => p.y)) + pad;
  const k = Math.min(outW / (maxX - minX), outH / (maxY - minY), 8);
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.translate(0, (outH - (maxY - minY) * k) / 2);
  ctx.scale(k, k);
  ctx.translate(-minX, -minY);
  penStyle(ctx);
  strokes.forEach(s => paintStroke(ctx, s));
  return c.toDataURL('image/png');
}

// Draw text in one of the adopted hands onto a transparent canvas and hand back a PNG
// — the same shape the drawn-signature path produces, so the server stores one thing.
async function renderHand(text: string, family: string, boxW: number, boxH: number): Promise<string | undefined> {
  const t = (text || '').trim();
  if (!t) return undefined;
  const dpr = 3;                                   // stamped small on the PDF; keep it crisp
  const c = document.createElement('canvas');
  c.width = boxW * dpr; c.height = boxH * dpr;
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.scale(dpr, dpr);
  let size = Math.floor(boxH * 0.62);
  const fit = () => { ctx.font = `${size}px ${family}`; return ctx.measureText(t).width; };
  await document.fonts.load(`${size}px ${family}`, t).catch(() => { });
  while (fit() > boxW - 12 && size > 9) size -= 1;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, 6, boxH / 2);
  return c.toDataURL('image/png');
}

// The document itself. The signed URL lives on Supabase, and the app's CSP is
// `frame-src 'self'` — an <iframe>/<embed> of it is blocked and renders blank, which
// is what signers were seeing. Rendering the pages with pdf.js keeps everything
// same-origin (fetch is allowed by connect-src) and shows a real preview.
function DocView({ url, fields = [], filled, values, onFill, onClear, onPick, onLabels, activeId, focusId, signaturePng, initialsPng, dateStr, narrow }: {
  url: string;
  fields?: SignField[];
  filled?: Record<string, boolean>;
  values?: Record<string, string>;
  onFill?: (f: SignField) => void;
  onClear?: (f: SignField) => void;
  // Text / checkbox spots are filled in the "Fill in" card; tapping one on the page goes there.
  onPick?: (f: SignField) => void;
  // Printed labels found beside unlabeled fill-in spots, keyed by field id.
  onLabels?: (labels: Record<string, string>) => void;
  activeId?: string | null;
  focusId?: string | null;
  signaturePng?: string;
  initialsPng?: string;
  dateStr?: string;
  // On a phone the pages flow with the page instead of scrolling inside a box — a
  // scroller within a scroller fights the thumb, and pinch-zoom reads it better.
  narrow?: boolean;
}) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const fieldsRef = useRef(fields); fieldsRef.current = fields;
  const onLabelsRef = useRef(onLabels); onLabelsRef.current = onLabels;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageW, setPageW] = useState(0);
  const gutter = narrow ? 6 : 12;

  useEffect(() => {
    const ac = new AbortController();
    // Keep the rendered pages so cleanup can free their object URLs.
    const collected: RenderedPage[] = [];
    (async () => {
      try {
        setState('loading'); setPages([]);
        const resp = await fetch(url, { signal: ac.signal });
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (ac.signal.aborted) return;
        // A blank the agent dropped on a form line usually has no label of its own. Name
        // it after the words printed beside it ("Printed Name", "Title"), so the signer
        // isn't faced with a row of identical "Type here" boxes. Copied first: rendering
        // may hand `data` to pdf.js, which takes ownership of it.
        const unlabeled = fieldsRef.current.filter(f => isInput(f.type) && isGenericLabel(f.label));
        if (unlabeled.length) {
          readTextRuns(data.slice(0), unlabeled.map(f => f.page || 1))
            .then(runs => {
              if (ac.signal.aborted) return;
              const found: Record<string, string> = {};
              for (const f of unlabeled) { const l = labelFor(runs, f); if (l) found[f.id] = l; }
              onLabelsRef.current?.(found);
            })
            .catch(e => console.warn('[sign] field labels', e));
        }
        // Rasterize off the main thread so a long lease doesn't freeze the signing page
        // — signers are usually on a phone. Pages stream in: page 1 shows immediately.
        // On a phone the page is ~340px wide, but signers pinch-zoom to read 10pt form text.
        // The default raster (~2× the screen) went soft when zoomed; 1200px stays legible.
        const phone = window.matchMedia('(max-width: 640px)').matches;
        await renderPdfPages(data, {
          quality: 0.85, signal: ac.signal, targetWidth: phone ? 1200 : undefined,
          onPage: (p) => { collected.push(p); if (!ac.signal.aborted) setPages(prev => [...prev, p]); },
        });
        if (!ac.signal.aborted) setState('ready');
      } catch (e) {
        if (ac.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
        console.error('[sign] preview', e); setState('error');
      }
    })();
    return () => { ac.abort(); revokePages(collected); };
  }, [url]);

  // Field boxes are sized against the rendered page width, so a box covers the same
  // slice of the document on a phone as on a desktop.
  const isError = state === 'error';
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setPageW(el.clientWidth - gutter * 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gutter, isError]);

  if (isError) {
    return (
      <div style={{ padding: 34, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
        We couldn’t display the document here.{' '}
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: GOLD, fontWeight: 700 }}>Open it in a new tab ↗</a>{' '}
        to read it before signing.
      </div>
    );
  }
  const pw = pageW > 0 ? pageW : 900;
  return (
    <div id="doc-scroll" ref={scrollRef} style={{ maxHeight: narrow ? 'none' : '78vh', overflowY: narrow ? 'visible' : 'auto', background: '#4b4f52', padding: gutter }}>
      {pages.map((pg, i) => {
        const pageFields = fields.filter(f => (f.page || 1) === i + 1);
        // Markers are sized to the page, not the screen: 1.6% of the page height is about
        // 12.7pt, just under the ~13pt between lines of a TAR signature block. Fixed pixel
        // boxes (they used to be 24–46px) covered three lines each on a phone and piled up
        // over the text above. On a phone that's under 8px, so markers become slim bars
        // without text there; the "Fill in" card carries the labels.
        const ph = pw * (pg.h / Math.max(1, pg.w));
        const sigH = Math.round(Math.min(46, Math.max(8, ph * 0.016)));
        const fsz = (h: number) => Math.max(9, Math.min(13, Math.round(h * 0.62)));
        const TEXT_MIN = 11;
        // A marker stops before the next field on the same line, so a wide fill-in (the
        // editor's default) doesn't run under the Date beside it.
        const widthOf = (f: SignField) => {
          let right = f.fx + Math.max(f.fw, isInput(f.type) ? 0.08 : 0.1);
          for (const o of pageFields) if (o !== f && Math.abs(o.fy - f.fy) < 0.009 && o.fx > f.fx + 0.01) right = Math.min(right, o.fx - 0.004);
          return Math.max(0.03, right - f.fx);
        };
        return (
          <div key={i} style={{ position: 'relative', marginBottom: i === pages.length - 1 ? 0 : gutter, boxShadow: '0 2px 10px rgba(0,0,0,.4)' }}>
            {/* Height reserved from the page's shape, so lazily decoded pages don't shift
                the markers (or a jump target) while they load. */}
            <img src={pg.src} alt={`Page ${i + 1}`} loading="lazy" decoding="async"
              style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${pg.w} / ${pg.h}` }} />
            {pageFields.map(f => {
              const isNext = activeId === f.id;
              // A text / checkbox spot is filled in the "Fill in" card below the document, with
              // a real label and a thumb-sized input. On the page it's a marker the size of
              // the line it sits on, showing what goes there — tap it to jump to that input.
              if (isInput(f.type)) {
                const v = values?.[f.id] ?? '';
                const has = !!v.trim();
                const hot = focusId === f.id || isNext;
                const h = f.type === 'check' ? Math.max(8, Math.round(sigH * 0.8)) : sigH;
                const shown = f.type === 'check' ? (has ? '✔' : '') : has ? v : (f.label || typeLabel(f.type));
                return (
                  <div key={f.id} id={`fld-${f.id}`} role="button"
                    aria-label={`${f.label || typeLabel(f.type)}: ${has ? 'edit' : 'fill in'}`}
                    onClick={() => onPick?.(f)}
                    // Above the signature markers: their invisible thumb-sized tap margin spans
                    // neighbouring lines on a phone and used to swallow taps on these bars.
                    style={{ position: 'absolute', zIndex: 2, left: `${f.fx * 100}%`, width: f.type === 'check' ? h : `${widthOf(f) * 100}%`,
                      top: `${f.fy * 100}%`, transform: 'translateY(-100%)', height: h, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                    <div style={{ height: '100%', boxSizing: 'border-box', borderRadius: 3, display: 'flex', alignItems: 'center',
                      justifyContent: f.type === 'check' ? 'center' : 'flex-start', padding: f.type === 'check' ? 0 : '0 4px', overflow: 'hidden',
                      background: has ? 'rgba(255,255,255,.93)' : hot ? 'rgba(201,146,44,.32)' : 'rgba(201,146,44,.14)',
                      border: `${hot ? 2 : 1}px solid ${GOLD}`, boxShadow: focusId === f.id ? '0 0 0 3px rgba(201,146,44,.35)' : 'none' }}>
                      {h >= TEXT_MIN && <span style={{ fontSize: fsz(h), lineHeight: 1, fontWeight: has ? 600 : 700, fontStyle: has ? 'normal' : 'italic', color: has ? INK : '#7c5a12',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shown}</span>}
                    </div>
                  </div>
                );
              }
              const done = !!filled?.[f.id];
              const img = f.type === 'signature' ? signaturePng : f.type === 'initial' ? initialsPng : undefined;
              const h = f.type === 'date' ? Math.max(8, Math.round(sigH * 0.74)) : sigH;
              const boxW = widthOf(f) * pw;
              const small = h < 34;
              const labelSize = fsz(h);
              const label = boxW < 60 ? (f.type === 'initial' ? 'Init' : typeLabel(f.type))
                : isNext && boxW >= 110 ? `▶ ${typeLabel(f.type)} here` : typeLabel(f.type);
              return (
                <div key={f.id} id={`fld-${f.id}`} role="button"
                  aria-label={done ? `Clear this ${typeLabel(f.type).toLowerCase()} spot` : `${typeLabel(f.type)} here`}
                  onClick={() => (done ? onClear?.(f) : onFill?.(f))}
                  title={done ? 'Tap to clear and redo this spot' : `Click to ${typeLabel(f.type).toLowerCase()} here`}
                  style={{
                    position: 'absolute', zIndex: 1, left: `${f.fx * 100}%`, width: `${widthOf(f) * 100}%`,
                    top: `${f.fy * 100}%`, transform: 'translateY(-100%)', height: h,
                    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                  }}>
                  {/* The visible box stays in proportion to the page so it doesn't hide
                      the lines around it; this invisible margin keeps it thumb-sized. */}
                  {h < TAP && <span aria-hidden style={{ position: 'absolute', left: -6, right: -6, top: -(TAP - h) / 2, bottom: -(TAP - h) / 2 }} />}
                  <div style={{
                    position: 'relative', height: '100%', boxSizing: 'border-box', borderRadius: 5,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    background: done ? 'rgba(255,255,255,.96)' : isNext ? '#c9922c' : 'rgba(201,146,44,.38)',
                    border: done ? '1px solid #d6d9de' : `${small ? 1.5 : 2}px solid ${GOLD}`,
                    boxShadow: isNext ? `0 0 0 ${small ? 3 : 4}px rgba(201,146,44,.35)` : 'none',
                    transition: 'background .15s, box-shadow .15s',
                  }}>
                    {done
                      ? (img
                          ? <img src={img} alt="" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                          : h >= TEXT_MIN ? <span style={{ fontSize: labelSize, color: INK, fontWeight: 600, whiteSpace: 'nowrap' }}>{dateStr}</span> : null)
                      : h >= TEXT_MIN && <span style={{ fontSize: labelSize, lineHeight: 1, fontWeight: 800, color: isNext ? '#fff' : '#7c5a12', whiteSpace: 'nowrap' }}>{label}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {state === 'loading' && <div style={{ color: '#cbd5e1', textAlign: 'center', padding: pages.length ? '12px 0 4px' : 60, fontSize: 13 }}>Loading document…</div>}
    </div>
  );
}

export default function SignPage() {
  const params = useParams();
  const token = String((params as Record<string, string>)?.token ?? '');
  const [view, setView] = useState<'loading' | 'ready' | 'waiting' | 'done' | 'completed' | 'voided' | 'declined' | 'expired' | 'notfound' | 'signed' | 'error'>('loading');
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [data, setData] = useState<SignData | null>(null);
  const [finalStatus, setFinalStatus] = useState('');
  const [typed, setTyped] = useState('');
  const [initials, setInitials] = useState('');
  const [initialsEdited, setInitialsEdited] = useState(false);
  const [mode, setMode] = useState<'pick' | 'draw'>('pick');
  const [styleKey, setStyleKey] = useState(STYLES[0].key);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adoptRef = useRef<HTMLDivElement>(null);
  // The drawn signature, as strokes in CSS pixels. Kept apart from the canvas so the
  // pad can be re-rendered sharp at any size — after a rotation, or after switching
  // to "Choose a style" and back — without losing what was drawn.
  const strokes = useRef<Pt[][]>([]);
  const hasInk = () => strokes.current.some(s => s.length > 0);

  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // ── Guided signing ────────────────────────────────────────────────────────
  // Every spot the agent placed for this signer has to be clicked. Nothing is
  // applied wholesale: the signature only lands where the signer put it.
  const [filled, setFilled] = useState<Record<string, boolean>>({});
  // Text / checkbox answers the signer fills in, keyed by field id. Signature-family
  // spots are booleans in `filled`; an input spot is "done" once it holds a value.
  const [values, setValues] = useState<Record<string, string>>({});
  // Labels read off the PDF for fill-in spots the agent left unlabeled.
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [adopted, setAdopted] = useState<{ signature?: string; initials?: string } | null>(null);
  // Step 1 is adopting a signature; the document is only shown once that's done. Every
  // signing link opens here, so the signer knows exactly what will be stamped before
  // they see a single spot.
  const [adoptStep, setAdoptStep] = useState(true);
  const [adopting, setAdopting] = useState(false);
  const fields = useMemo(() => (data?.fields ?? []).map(f => isInput(f.type)
    ? { ...f, label: isGenericLabel(f.label) ? labels[f.id] : f.label }
    : f), [data, labels]);
  const inputFields = useMemo(() => fields.filter(f => isInput(f.type)), [fields]);
  const isDone = useCallback((f: SignField) => isInput(f.type) ? !!(values[f.id] ?? '').trim() : !!filled[f.id], [values, filled]);
  const remaining = useMemo(() => fields.filter(f => !isDone(f)), [fields, isDone]);
  const nextField = remaining[0] ?? null;
  const allDone = fields.length > 0 && remaining.length === 0;
  const setFieldValue = useCallback((f: SignField, v: string) => setValues(prev => ({ ...prev, [f.id]: v })), []);
  const dateStr = useMemo(() => new Date().toLocaleDateString('en-US'), []);

  const scrollToField = useCallback((id: string) => {
    const el = document.getElementById(`fld-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);
  // Fill-in answers are typed in the "Fill in" card; bring that input into view and focus it.
  const scrollToInput = useCallback((id: string) => {
    const el = document.getElementById(`in-${id}`) as HTMLInputElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el?.focus({ preventScroll: true }), 250);
  }, []);
  // Consent and the Finish button live below the document (step 2). Anything that
  // needs the signer there has to take them there — on a phone it's pages away.
  const scrollToAdopt = useCallback(() => {
    adoptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Turn the chosen hand into the images the page stamps into each spot.
  const renderAdopted = useCallback(async () => {
    const family = (STYLES.find(s => s.key === styleKey) ?? STYLES[0]).family;
    const sig = mode === 'draw'
      ? exportStrokes(strokes.current)
      : await renderHand(typed, family, 640, 150);
    const ini = await renderHand(initials, family, 220, 150);
    return { signature: sig, initials: ini };
  }, [mode, typed, initials, styleKey]);
  const adopt = useCallback(async () => {
    if (adopted) return adopted;
    const a = await renderAdopted();
    setAdopted(a);
    return a;
  }, [adopted, renderAdopted]);

  // Step 1 → step 2. Re-adopting (after "Change") replaces the marks everywhere at
  // once: placed spots draw from `adopted`, so they update without being redone.
  const adoptAndContinue = useCallback(async () => {
    if (!typed.trim()) { setErr('Enter your full legal name.'); return; }
    if (mode === 'draw' && !hasInk()) { setErr('Draw your signature, or switch to “Pick a style”.'); return; }
    setErr(''); setAdopting(true);
    try {
      const a = await renderAdopted();
      if (!a.signature) { setErr('We couldn’t create your signature. Please try again.'); return; }
      setAdopted(a);
      setAdoptStep(false);
      window.scrollTo({ top: 0 });
    } finally { setAdopting(false); }
  }, [typed, mode, renderAdopted]);

  const changeSignature = useCallback(() => {
    setErr(''); setAdoptStep(true);
    window.scrollTo({ top: 0 });
  }, []);

  const fillField = useCallback(async (f: SignField) => {
    // A text / checkbox spot is filled by typing into it, not by adopting a signature —
    // jump to it and focus the input.
    if (isInput(f.type)) {
      setErr('');
      scrollToInput(f.id);
      return;
    }
    // Adoption comes first, so this only happens if something reset it.
    if (!adopted) { setAdoptStep(true); window.scrollTo({ top: 0 }); return; }
    setErr('');
    setFilled(prev => ({ ...prev, [f.id]: true }));
    // Move them along to the next one without making them hunt for it.
    const rest = fields.filter(x => x.id !== f.id && !filled[x.id]);
    if (rest[0]) setTimeout(() => scrollToField(rest[0].id), 180);
  }, [adopted, fields, filled, scrollToField, scrollToInput]);

  // Signers can undo: tap a placed spot to clear it, or Start over to redo everything.
  const clearField = useCallback((f: SignField) => {
    setFilled(prev => { const n = { ...prev }; delete n[f.id]; return n; });
  }, []);
  const startOver = useCallback(() => { setFilled({}); setErr(''); }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/sign/${token}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setView('notfound'); return; }
        setData(j);
        // Pre-load any values already on the input fields (usually empty for the signer).
        const seed: Record<string, string> = {};
        for (const f of (j.fields ?? []) as SignField[]) if (isInput(f.type)) seed[f.id] = f.value || '';
        setValues(seed);
        setTyped(j.signer?.name || '');
        setView(['ready', 'waiting', 'done', 'completed', 'voided', 'declined', 'expired'].includes(j.status) ? j.status : 'error');
      })
      .catch(() => setView('error'));
  }, [token]);

  // Initials track the name until the signer types their own.
  useEffect(() => { if (!initialsEdited) setInitials(initialsOf(typed)); }, [typed, initialsEdited]);

  // The signature pad. The backing store matches the pad's size in device pixels, so
  // ink is sharp on a retina phone and lands exactly under the finger; strokes are
  // replayed whenever the pad changes size.
  useEffect(() => {
    if (view !== 'ready' || !adoptStep || mode !== 'draw') return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;

    const fit = () => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // Strokes stay where they were drawn. Only if the pad got smaller than the ink
      // (a landscape signature, then back to portrait) is it shrunk — evenly — to fit.
      const pts = strokes.current.flat();
      if (pts.length) {
        const maxX = Math.max(...pts.map(p => p.x)) + PEN, maxY = Math.max(...pts.map(p => p.y)) + PEN;
        const k = Math.min(1, r.width / maxX, r.height / maxY);
        if (k < 1) strokes.current = strokes.current.map(s => s.map(p => ({ x: p.x * k, y: p.y * k })));
      }
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      penStyle(ctx);
      strokes.current.forEach(s => paintStroke(ctx, s));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);

    let active: number | null = null;   // one finger draws; a second touch can't yank the line
    const pos = (e: PointerEvent): Pt => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => {
      if (active !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      active = e.pointerId;
      const p = pos(e);
      strokes.current.push([p]);
      paintStroke(ctx, [p]);
      try { c.setPointerCapture(e.pointerId); } catch { }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      e.preventDefault();
      const s = strokes.current[strokes.current.length - 1];
      // Phones batch touch samples between frames; the coalesced ones keep fast
      // strokes round instead of polygonal.
      const batch = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const pts = (batch.length ? batch : [e]).map(pos);
      paintStroke(ctx, [s[s.length - 1], ...pts]);
      s.push(...pts);
    };
    const up = (e: PointerEvent) => { if (e.pointerId === active) active = null; };
    // touch-action: none does the work on current browsers; this stops older iOS
    // Safari from scrolling the page out from under the pen.
    const noScroll = (e: TouchEvent) => e.preventDefault();
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('touchmove', noScroll, { passive: false });
    return () => {
      ro.disconnect();
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
      c.removeEventListener('touchmove', noScroll);
    };
  }, [view, adoptStep, mode]);

  function clearSig() {
    strokes.current = [];
    const c = canvasRef.current; const ctx = c?.getContext('2d');
    if (c && ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); }
  }

  const active = useMemo(() => STYLES.find(s => s.key === styleKey) ?? STYLES[0], [styleKey]);

  // Hide the floating control while the signing controls themselves are on screen.
  const [adoptInView, setAdoptInView] = useState(false);
  useEffect(() => {
    const el = adoptRef.current;
    if (view !== 'ready' || !el) return;
    const io = new IntersectionObserver(([e]) => setAdoptInView(e.isIntersecting), { rootMargin: '0px 0px -25% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [view]);

  // Declining ends the request for everyone — the sender needs to know it is dead,
  // not merely slow. A reason is invited but never required; forcing one just
  // produces "n/a".
  const decline = useCallback(async () => {
    setSubmitting(true); setErr('');
    try {
      const r = await fetch(`/api/sign/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline', reason: declineReason }),
      });
      if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || 'Could not submit.'); return; }
      setView('declined');
    } catch { setErr('Could not reach the server. Check your connection and try again.'); }
    finally { setSubmitting(false); }
  }, [token, declineReason]);

  const submit = useCallback(async () => {
    setErr('');
    if (!consent) { setErr('Please check the box to consent to sign electronically.'); return; }
    if (!adopted) { changeSignature(); return; }
    if (fields.length && remaining.length) {
      setErr(`You still have ${remaining.length} spot${remaining.length === 1 ? '' : 's'} to confirm on the document.`);
      if (isInput(remaining[0].type)) scrollToInput(remaining[0].id); else scrollToField(remaining[0].id);
      return;
    }
    setSubmitting(true);
    try {
      // Both paths hand the server a PNG, so the executed PDF stamps the signer's own
      // hand either way. Initials are always rendered in the adopted style. These are
      // the very images the signer already saw dropped into each spot.
      const a = await adopt();
      const signature_png = a.signature;
      const initials_png = a.initials;
      const res = await fetch(`/api/sign/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature_png, initials_png, typed_name: typed, signature_style: mode === 'draw' ? 'drawn' : active.key, consent, field_values: values }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'Could not submit your signature. Please try again.'); return; }
      setFinalStatus(j.status || 'signed');
      setView('signed');
    } finally { setSubmitting(false); }
  }, [consent, typed, mode, active, token, fields, remaining, adopt, adopted, changeSignature, scrollToField, scrollToInput, values]);

  // While the keyboard is up, the floating control would ride above it and cover the very
  // field being typed into — it steps aside until the signer is done typing.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isTextEntry = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'TEXTAREA'
      || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((t as HTMLInputElement).type)));
    const on = (e: FocusEvent) => { if (isTextEntry(e.target)) setTyping(true); };
    // Deferred, so moving from one input to the next doesn't flash the control back.
    const off = () => setTimeout(() => setTyping(isTextEntry(document.activeElement)), 0);
    document.addEventListener('focusin', on);
    document.addEventListener('focusout', off);
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); };
  }, []);

  // What the floating control does: walk the signer to their next spot, or — once the
  // spots are done (or the document has none) — down to Finish & Sign.
  const pill: 'jump' | 'finish' | null = view !== 'ready' || adoptStep || typing ? null
    : fields.length > 0 && !allDone && nextField ? 'jump'
    : adoptInView ? null : 'finish';

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f4f5f7', fontFamily: "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif", color: '#1a1a1a',
    padding: view === 'ready' ? '0 0 calc(96px + env(safe-area-inset-bottom))' : '0 0 48px' };
  const card: React.CSSProperties = { maxWidth: 960, margin: '0 auto', background: '#fff', borderRadius: 14, boxShadow: '0 6px 24px rgba(0,0,0,.06)', padding: narrow ? 16 : 24 };
  const header = (
    <div style={{ borderBottom: `3px solid ${GOLD}`, background: '#fff' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: narrow ? '10px 16px' : '14px 24px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/creco-logo.png" alt="CRECO — Commercial Real Estate Company" style={{ height: narrow ? 38 : 44, width: 'auto', display: 'block' }} />
        <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, letterSpacing: .3, paddingLeft: 4, borderLeft: '1px solid #e5e7eb' }}>Secure e-signature</span>
      </div>
    </div>
  );

  const msg = (icon: string, title: string, body: string) => (
    <div style={wrap}>{header}<div style={{ padding: '40px 16px' }}><div style={{ ...card, textAlign: 'center', maxWidth: 480 }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>{icon}</div>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{title}</h1>
      <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.5, margin: 0 }}>{body}</p>
    </div></div></div>
  );

  if (view === 'loading') return msg('⏳', 'Loading…', 'Fetching your document.');
  if (view === 'notfound') return msg('🔍', 'Link not found', 'This signing link is invalid or has expired. Please contact your broker for a new one.');
  if (view === 'error') return msg('⚠️', 'Something went wrong', 'We couldn’t load this document. Please try the link again in a moment.');
  if (view === 'voided') return msg('🚫', 'Request canceled', 'This signature request was canceled by the sender.');
  if (view === 'declined') return msg('✋', 'Declined', 'This document was declined and is no longer available to sign. The sender has been notified.');
  if (view === 'expired') return msg('⌛', 'This link has expired', 'For security, signing links stop working after 30 days. Please contact your broker and they’ll send you a new one.');
  if (view === 'waiting') return msg('⏱️', 'Waiting on a previous signer', 'It’s not your turn yet. We’ll email you the moment the document is ready for your signature.');
  if (view === 'done') return msg('✅', 'You’ve already signed', 'Your signature is on file. You’ll receive the fully executed copy once everyone has signed.');
  if (view === 'completed') return msg('🎉', 'Fully executed', `“${data?.title ? displayTitle(data.title) : 'This document'}” has been signed by all parties. A copy has been emailed to you.`);
  if (view === 'signed') return msg(finalStatus === 'completed' ? '🎉' : '✅', 'Signature recorded — thank you!', finalStatus === 'completed' ? 'All parties have now signed. The fully executed copy is on its way to your inbox.' : 'Your signature has been recorded. We’ll route the document to the next party and email you the final copy when it’s complete.');

  // view === 'ready'
  const tab = (k: 'pick' | 'draw', label: string) => (
    <button onClick={() => setMode(k)}
      style={{ flex: 1, minWidth: 0, minHeight: TAP, padding: '10px 4px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', border: 'none', borderRadius: 8, whiteSpace: 'nowrap',
        background: mode === k ? '#fff' : 'transparent', color: mode === k ? INK : '#6b7280', boxShadow: mode === k ? '0 1px 3px rgba(0,0,0,.12)' : 'none' }}>
      {label}
    </button>
  );

  return (
    <div style={wrap}>
      {header}
      <div style={{ padding: narrow ? '16px 12px' : '20px 16px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
          <h1 style={{ fontSize: narrow ? 20 : 22, margin: 0, overflowWrap: 'anywhere' }}>{displayTitle(data?.title)}</h1>
          <span style={{ fontSize: 13, color: '#6b7280' }}>for {data?.signer?.name} · signing as <strong style={{ textTransform: 'capitalize' }}>{data?.signer?.role}</strong></span>
        </div>

        {/* The device was handed over by the agent, so the person now holding it
            should be in no doubt about whose signature is about to be recorded. */}
        {data?.signer?.in_person && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '11px 14px', marginBottom: 14, fontSize: 13.5, color: '#78350f', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
            <strong>In-person signing.</strong> You are signing as <strong>{data.signer.name}</strong> ({data.signer.email}) on your agent’s device.
            If that isn’t you, hand it back before going any further.
          </div>
        )}

        {/* Step 1 — adopt the signature before the document is shown, the way
            DocuSign's "Adopt Your Signature" comes first. The document keeps loading
            underneath, so it's ready the moment they continue. */}
        {adoptStep && (
          <div style={{ ...card, maxWidth: 720, scrollMarginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: GOLD, marginBottom: 6 }}>Step 1 of 2 · Adopt your signature</div>
            <p style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.5, margin: '0 0 16px' }}>
              Confirm your name and choose how your signature and initials will look. They’re placed wherever the document asks you to sign or initial — you’ll see each spot next.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ flex: '2 1 260px', minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Full legal name</label>
                <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Your full name" autoComplete="name"
                  style={{ width: '100%', padding: '11px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: '1 1 110px', minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Initials</label>
                <input value={initials} onChange={e => { setInitialsEdited(true); setInitials(e.target.value.slice(0, 4)); }} placeholder="ABC" autoCapitalize="characters"
                  style={{ width: '100%', padding: '11px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, background: '#f1f2f4', borderRadius: 10, padding: 4, marginBottom: 14 }}>
              {tab('pick', narrow ? '✍️ Pick a style' : '✍️  Choose a style')}
              {tab('draw', narrow ? '🖊 Draw it' : '🖊  Draw it yourself')}
            </div>

            {mode === 'pick' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(288px,100%),1fr))', gap: 10 }}>
                  {STYLES.map(s => {
                    const on = s.key === styleKey;
                    return (
                      <button key={s.key} onClick={() => setStyleKey(s.key)}
                        style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', background: on ? '#fffdf6' : '#fff', minWidth: 0,
                          border: on ? `2px solid ${GOLD}` : '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: s.family, fontSize: 23, color: INK, lineHeight: 1.55, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {typed.trim() || 'Your name'}
                        </span>
                        <span style={{ flexShrink: 0, fontFamily: s.family, fontSize: 20, color: INK, opacity: .75, borderLeft: '1px solid #eef0f2', paddingLeft: 10 }}>
                          {initials || 'AB'}
                        </span>
                        {on && <span style={{ flexShrink: 0, color: GOLD, fontSize: 14, fontWeight: 800 }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', margin: '10px 2px 16px' }}>
                  Pick the hand you want. It’s used for your signature <em>and</em> your initials wherever the document asks for them.
                </div>
              </>
            ) : (
              <>
                <div style={{ position: 'relative' }}>
                  <canvas ref={canvasRef} aria-label="Signature pad — draw your signature with your finger or mouse"
                    style={{ display: 'block', width: '100%', height: narrow ? 180 : 160, background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10, boxSizing: 'border-box', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', cursor: 'crosshair' }} />
                  <span aria-hidden style={{ position: 'absolute', left: 16, right: 16, bottom: 38, borderBottom: '1px dashed #d6d9de', pointerEvents: 'none' }} />
                </div>
                {/* Clear sits below the pad, not on it: on a phone a signature that ran to the
                    right edge landed on the button and wiped itself. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 16px' }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#9ca3af', paddingLeft: 2 }}>
                    Draw above with your mouse or finger. Your initials use the <strong>{active.label}</strong> style.
                  </div>
                  <button onClick={clearSig} style={{ flexShrink: 0, minHeight: TAP, minWidth: 64, fontSize: 13, fontWeight: 600, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0 14px', cursor: 'pointer' }}>Clear</button>
                </div>
              </>
            )}
            {err && <div role="alert" style={{ background: '#fef2f2', color: '#dc2626', fontSize: 13.5, padding: '10px 12px', borderRadius: 8, marginBottom: 12 }}>{err}</div>}
            <button onClick={adoptAndContinue} disabled={adopting}
              style={{ width: '100%', minHeight: 52, padding: '14px 0', background: GOLD, color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: adopting ? 'default' : 'pointer', opacity: adopting ? 0.7 : 1 }}>
              {adopting ? 'Adopting…' : 'Adopt and continue ▸'}
            </button>
            {!declining ? (
              <button onClick={() => setDeclining(true)} disabled={submitting}
                style={{ width: '100%', marginTop: 6, minHeight: TAP, padding: '12px 0', background: 'none', color: '#9ca3af', border: 'none', fontSize: 13.5, cursor: 'pointer', textDecoration: 'underline' }}>
                I can’t sign this
              </button>
            ) : (
              <div style={{ marginTop: 14, padding: 14, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 10 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Decline to sign?</div>
                <div style={{ fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.5, marginBottom: 10 }}>
                  This cancels the request for everyone and notifies the sender. It can’t be undone — a new request would have to be sent.
                </div>
                {/* 16px text: anything smaller makes iOS zoom the whole page on focus. */}
                <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3}
                  placeholder="What’s the problem? (optional, but it helps)"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #fecaca', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', resize: 'vertical', marginBottom: 10 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setDeclining(false); setDeclineReason(''); }} disabled={submitting}
                    style={{ flex: 1, minHeight: TAP, padding: '12px 0', background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    Never mind
                  </button>
                  <button onClick={decline} disabled={submitting}
                    style={{ flex: 1, minHeight: TAP, padding: '12px 0', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                    {submitting ? '…' : 'Decline'}
                  </button>
                </div>
              </div>
            )}
            {data && data.parties.length > 1 && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f3f4f6', fontSize: 12, color: '#9ca3af' }}>
                Signing order: {data.parties.map(p => `${p.name} (${p.role})${p.status === 'signed' ? ' ✓' : ''}`).join('  →  ')}
              </div>
            )}
          </div>
        )}

        <div style={adoptStep ? { display: 'none' } : undefined}>
        {fields.length > 0 && !allDone && (
          <div style={{ maxWidth: 960, margin: '0 auto 12px', fontSize: 14, color: '#7c5a12', background: '#fffdf6', border: '1px solid #f0e2c4', borderRadius: 10, padding: '12px 16px', lineHeight: 1.5 }}>
            <strong>Place your signature.</strong>{' '}
            {narrow
              // Nine lines of instructions pushed the document off a phone's first screen.
              ? <>Tap the gold spots in the document, or the gold <span style={{ color: GOLD, fontWeight: 700 }}>Jump</span> button.{inputFields.length > 0 && <> Type your details under <strong>Fill in</strong>.</>}</>
              : <>Tap each highlighted gold spot in the document below (there {fields.length === 1 ? 'is 1' : `are ${fields.length}`}), or use the gold <span style={{ color: GOLD, fontWeight: 700 }}>Jump to my signature</span> button.{inputFields.length > 0 && <> Type your details under <strong>Fill in</strong>.</>} Then check the box and Finish &amp; Sign.</>}
            {/* Its own row: a 44px-tall button inline in the paragraph split it in two. */}
            <div>
              <button onClick={changeSignature} style={{ display: 'inline-flex', alignItems: 'center', minHeight: TAP, background: 'none', border: 'none', padding: 0, color: GOLD, fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'underline' }}>Change my signature style</button>
            </div>
          </div>
        )}
        {/* Edge to edge on a phone: every pixel of width is document you can read. */}
        <div style={{ ...card, marginBottom: 16, padding: 0, overflow: 'hidden', ...(narrow ? { margin: '0 -12px 16px', borderRadius: 0 } : {}) }}>
          {data?.doc_url
            ? <DocView url={data.doc_url} fields={fields} filled={filled} values={values} onFill={fillField} onClear={clearField}
                onPick={f => scrollToInput(f.id)} onLabels={setLabels} focusId={focusId}
                activeId={nextField?.id ?? null} narrow={narrow}
                signaturePng={adopted?.signature} initialsPng={adopted?.initials} dateStr={dateStr} />
            : <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Document preview unavailable.</div>}
          {fields.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, rowGap: 8, padding: '10px 14px', borderTop: '1px solid #eef0f2', background: allDone ? '#ecfdf5' : '#fffdf6', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: allDone ? '#15803d' : '#7c5a12', ...(narrow ? { flex: '1 1 100%' } : {}) }}>
                {allDone ? `✓ All ${fields.length} spot${fields.length === 1 ? '' : 's'} confirmed` : `${fields.length - remaining.length} of ${fields.length} confirmed`}
              </span>
              {!narrow && <span style={{ flex: 1 }} />}
              {Object.keys(filled).length > 0 && (
                <button onClick={startOver} title="Clear what you've placed and start again"
                  style={{ minHeight: TAP, fontSize: 13, fontWeight: 700, color: '#7c5a12', background: '#fff', border: '1px solid #e6d3a2', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', whiteSpace: 'nowrap', ...(narrow ? { flex: '1 1 auto' } : {}) }}>↺ Start over</button>
              )}
              {!allDone && (
                <button onClick={() => { if (nextField) { if (!isInput(nextField.type)) scrollToField(nextField.id); fillField(nextField); } }}
                  style={{ minHeight: TAP, fontSize: 14, fontWeight: 800, color: '#fff', background: GOLD, border: 'none', borderRadius: 8, padding: '10px 18px', cursor: 'pointer', whiteSpace: 'nowrap', ...(narrow ? { flex: '1 1 auto' } : {}) }}>
                  {remaining.length === fields.length ? 'Place my signature ▸' : `Place next — ${fields.length - remaining.length + 1} of ${fields.length} ▸`}
                </button>
              )}
            </div>
          )}
          {data?.doc_url && (
            <div style={{ padding: '4px 16px', borderTop: '1px solid #eef0f2', textAlign: 'center' }}>
              <a href={data.doc_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', padding: '13px 10px', fontSize: 13, color: GOLD, fontWeight: 600, textDecoration: 'none' }}>Open document in a new tab ↗</a>
            </div>
          )}
        </div>

        {inputFields.length > 0 && (
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: GOLD, marginBottom: 4 }}>Fill in</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14, lineHeight: 1.5 }}>
              These go on the document where it’s marked in gold. Tap <strong>Show</strong> to see the spot.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {inputFields.map((f, n) => {
                const label = f.label || `${f.type === 'check' ? 'Checkbox' : 'Blank'} ${n + 1}`;
                const v = values[f.id] ?? '';
                const focus = { onFocus: () => setFocusId(f.id), onBlur: () => setFocusId(id => (id === f.id ? null : id)) };
                const show = (
                  <button type="button" onClick={() => scrollToField(f.id)}
                    style={{ minHeight: TAP, padding: '0 4px 0 10px', background: 'none', border: 'none', color: GOLD, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    Show ↑
                  </button>
                );
                return f.type === 'check' ? (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minHeight: TAP, fontSize: 15, fontWeight: 600, color: '#1f2937', cursor: 'pointer' }}>
                      <input id={`in-${f.id}`} type="checkbox" checked={!!v.trim()} onChange={e => setFieldValue(f, e.target.checked ? '✔' : '')} {...focus}
                        style={{ width: 22, height: 22, accentColor: GOLD, flexShrink: 0 }} />
                      {label}
                    </label>
                    {show}
                  </div>
                ) : (
                  <div key={f.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label htmlFor={`in-${f.id}`} style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: '#374151' }}>{label}</label>
                      {show}
                    </div>
                    {/* 16px text: anything smaller makes iOS zoom the page when the signer taps in. */}
                    <input id={`in-${f.id}`} value={v} onChange={e => setFieldValue(f, e.target.value)} {...focus}
                      autoComplete="off" enterKeyHint="next"
                      style={{ width: '100%', minHeight: TAP, padding: '10px 12px', boxSizing: 'border-box', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', color: INK,
                        border: `1.5px solid ${v.trim() ? '#e5e7eb' : '#e6d3a2'}`, background: v.trim() ? '#fff' : '#fffdf6' }} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div ref={adoptRef} style={{ ...card, scrollMarginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: GOLD, marginBottom: 12 }}>Step 2 of 2 · Finish &amp; sign</div>

          {/* The adopted marks, as they're being placed in the document. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid #eef0f2', borderRadius: 10, marginBottom: 16 }}>
            <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {adopted?.signature && <img src={adopted.signature} alt="Your adopted signature" style={{ height: 44, maxWidth: '70%', objectFit: 'contain', objectPosition: 'left' }} />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {adopted?.initials && <img src={adopted.initials} alt="Your adopted initials" style={{ height: 36, objectFit: 'contain', borderLeft: '1px solid #eef0f2', paddingLeft: 12 }} />}
            </div>
            <button onClick={changeSignature}
              style={{ flexShrink: 0, minHeight: TAP, fontSize: 13, fontWeight: 700, color: '#7c5a12', background: '#fff', border: '1px solid #e6d3a2', borderRadius: 8, padding: '0 14px', cursor: 'pointer' }}>
              Change
            </button>
          </div>

          <label id="finish-section" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 13.5, color: '#374151', lineHeight: 1.5, cursor: 'pointer', marginBottom: 16, padding: '4px 0' }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 1, accentColor: GOLD, width: 22, height: 22, flexShrink: 0 }} />
            <span>I agree to sign this document electronically, and I consent to the use of electronic records and signatures for this transaction (ESIGN/UETA). I have reviewed the document above.</span>
          </label>

          {err && <div role="alert" style={{ background: '#fef2f2', color: '#dc2626', fontSize: 13.5, padding: '10px 12px', borderRadius: 8, marginBottom: 12 }}>{err}</div>}

          <button onClick={submit} disabled={submitting}
            style={{ width: '100%', minHeight: 52, padding: '14px 0', background: GOLD, color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Submitting…'
              : fields.length && remaining.length ? `${remaining.length} spot${remaining.length === 1 ? '' : 's'} left to confirm`
              : 'Finish & Sign'}
          </button>

          {!declining ? (
            <button onClick={() => setDeclining(true)} disabled={submitting}
              style={{ width: '100%', marginTop: 6, minHeight: TAP, padding: '12px 0', background: 'none', color: '#9ca3af', border: 'none', fontSize: 13.5, cursor: 'pointer', textDecoration: 'underline' }}>
              I can’t sign this
            </button>
          ) : (
            <div style={{ marginTop: 14, padding: 14, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Decline to sign?</div>
              <div style={{ fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.5, marginBottom: 10 }}>
                This cancels the request for everyone and notifies the sender. It can’t be undone — a new request would have to be sent.
              </div>
              {/* 16px text: anything smaller makes iOS zoom the whole page on focus. */}
              <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3}
                placeholder="What’s the problem? (optional, but it helps)"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #fecaca', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', resize: 'vertical', marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setDeclining(false); setDeclineReason(''); }} disabled={submitting}
                  style={{ flex: 1, minHeight: TAP, padding: '12px 0', background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  Never mind
                </button>
                <button onClick={decline} disabled={submitting}
                  style={{ flex: 1, minHeight: TAP, padding: '12px 0', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? '…' : 'Decline'}
                </button>
              </div>
            </div>
          )}

          {data && data.parties.length > 1 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f3f4f6', fontSize: 12, color: '#9ca3af' }}>
              Signing order: {data.parties.map(p => `${p.name} (${p.role})${p.status === 'signed' ? ' ✓' : ''}`).join('  →  ')}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Always-reachable control. While spots remain it jumps straight to the next
          one and places it, so a signer never hunts through a long document. After
          that it takes them down to Finish & Sign, which on a phone is pages below
          the document. It steps aside while the signing controls are on screen. */}
      {pill && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', padding: '0 12px calc(14px + env(safe-area-inset-bottom))', pointerEvents: 'none', zIndex: 60 }}>
          {pill === 'jump' && nextField ? (
            <button
              onClick={() => { if (!isInput(nextField.type)) scrollToField(nextField.id); fillField(nextField); }}
              title="Jump to your next signing spot and sign it"
              style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, minHeight: 52, maxWidth: '100%', whiteSpace: 'nowrap', background: GOLD, color: '#fff', border: 'none', borderRadius: 999, padding: narrow ? '12px 18px' : '13px 22px', fontSize: narrow ? 14 : 15, fontWeight: 800, cursor: 'pointer', boxShadow: '0 10px 28px rgba(201,146,44,.5)' }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, background: 'rgba(255,255,255,.25)', borderRadius: 999, padding: '2px 9px', flexShrink: 0 }}>{fields.length - remaining.length} / {fields.length}</span>
              {remaining.length === fields.length ? 'Jump to my signature ▸' : `Jump to next — ${typeLabel(nextField.type)} ▸`}
            </button>
          ) : (
            <button onClick={scrollToAdopt}
              style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, minHeight: 52, maxWidth: '100%', whiteSpace: 'nowrap', background: allDone ? '#15803d' : GOLD, color: '#fff', border: 'none', borderRadius: 999, padding: narrow ? '12px 20px' : '13px 24px', fontSize: narrow ? 14 : 15, fontWeight: 800, cursor: 'pointer', boxShadow: '0 10px 28px rgba(0,0,0,.25)' }}>
              {allDone ? '✓ Spots placed — Finish & Sign ▾' : 'Sign this document ▾'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
