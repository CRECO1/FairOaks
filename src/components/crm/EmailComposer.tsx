'use client';

import React, { useEffect, useRef, useState } from 'react';
import { sanitizeHtml } from '@/lib/sanitize';

// One composer for every "write an email" surface (deal Emails tab, contact card,
// inline thread reply). State and sending stay with the caller — this is the UI only.

const ADDR_VALID = /\S+@\S+\.\S+/;
const splitAddrs = (v: string) => v.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
const chipLabel = (a: string) => {
  const m = a.match(/^(.*)<(.+)>$/);
  return m ? (m[1].trim().replace(/^"|"$/g, '') || m[2].trim()) : a;
};

const LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--k-6b7280)', width: 52, flexShrink: 0, paddingTop: 11 };
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 6, padding: '2px 12px', borderBottom: '1px solid var(--k-f3f4f6)' };
const CHIP: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', padding: '3px 4px 3px 9px', background: 'var(--k-f3f4f6)', border: '1px solid var(--k-e5e7eb)', borderRadius: 14, fontSize: 13, color: 'var(--k-374151)' };

// Chips + a free-typing tail. The parent only ever sees one comma-separated string, and
// anything still being typed is included in it, so a pending address is never silently dropped.
function AddressField({ value, onChange, placeholder, autoFocus, leading }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; leading?: React.ReactNode }) {
  const [chips, setChips] = useState<string[]>(() => splitAddrs(value));
  const [draft, setDraft] = useState('');
  const emitted = useRef(value);

  // A reply-all (or a clear) changes the string from outside — re-read it.
  useEffect(() => {
    if (value !== emitted.current) { setChips(splitAddrs(value)); setDraft(''); emitted.current = value; }
  }, [value]);

  const emit = (c: string[], d: string) => {
    const v = [...c, d.trim()].filter(Boolean).join(', ');
    emitted.current = v;
    onChange(v);
  };
  const commit = () => {
    const d = draft.trim();
    if (!d || !ADDR_VALID.test(d)) return;
    const next = [...chips, d];
    setChips(next); setDraft(''); emit(next, '');
  };
  const bad = draft.trim().length > 0 && !ADDR_VALID.test(draft.trim());

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: '6px 0' }}>
      {leading}
      {chips.map((a, i) => (
        <span key={a + i} style={CHIP} title={a}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chipLabel(a)}</span>
          <button type="button" aria-label={`Remove ${a}`} onClick={() => { const next = chips.filter((_, j) => j !== i); setChips(next); emit(next, draft); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-9ca3af)', fontSize: 15, lineHeight: 1, padding: '0 4px', minWidth: 0, minHeight: 0 }}>×</button>
        </span>
      ))}
      <input
        value={draft} autoFocus={autoFocus} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder={chips.length ? '' : placeholder}
        onChange={e => {
          const v = e.target.value;
          // A typed or pasted delimiter commits what came before it.
          if (/[,;\s]$/.test(v) && ADDR_VALID.test(v)) {
            const parts = splitAddrs(v.replace(/\s+/g, ','));
            const next = [...chips, ...parts.filter(p => ADDR_VALID.test(p))];
            setChips(next); setDraft(''); emit(next, '');
          } else { setDraft(v); emit(chips, v); }
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && !draft && chips.length) { const next = chips.slice(0, -1); setChips(next); emit(next, ''); }
        }}
        onBlur={commit}
        style={{ flex: '1 1 140px', minWidth: 120, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: bad ? 'var(--k-dc2626)' : 'var(--k-111)', fontFamily: "'DM Sans',sans-serif", padding: '6px 2px' }}
      />
    </div>
  );
}

export type EmailComposerProps = {
  isMobile: boolean;
  title: string;
  replyingTo?: string | null;
  to: string;
  toName?: string;
  moreTo: string; setMoreTo: (v: string) => void;
  cc: string; setCc: (v: string) => void;
  individual: boolean; setIndividual: (v: boolean) => void;
  subject: string; setSubject: (v: string) => void;
  subjectReadOnly?: boolean;
  autoCcLabel?: string;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  attachments: File[]; setAttachments: React.Dispatch<React.SetStateAction<File[]>>;
  signature?: string | null;
  onSyncSignature: () => void;
  sending: boolean;
  sendLabel?: string;
  onSend: () => void;
  onDiscard: () => void;
};

export default function EmailComposer(p: EmailComposerProps) {
  const [showCc, setShowCc] = useState(() => p.cc.trim().length > 0);
  const [showMore, setShowMore] = useState(false);
  const [showSig, setShowSig] = useState(false);
  const attachRef = useRef<HTMLInputElement>(null);
  const hasExtras = p.moreTo.trim().length > 0 || p.cc.trim().length > 0;

  // A reply-all fills Cc from outside; make sure it is visible.
  useEffect(() => { if (p.cc.trim()) setShowCc(true); }, [p.cc]);

  const cmd = (c: string, v?: string) => { p.bodyRef.current?.focus(); document.execCommand(c, false, v); };
  const tb = (extra?: React.CSSProperties): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: p.isMobile ? 40 : 32, height: p.isMobile ? 40 : 32, padding: '0 6px', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', color: 'var(--k-374151)', fontSize: 14, fontFamily: "'DM Sans',sans-serif", ...extra });
  const sep = <span style={{ width: 1, height: 18, background: 'var(--k-e5e7eb)', margin: '0 4px', flexShrink: 0 }} />;

  const discard = () => {
    const typed = (p.bodyRef.current?.innerText ?? '').trim().length > 0 || p.attachments.length > 0 || (!p.subjectReadOnly && p.subject.trim().length > 0);
    if (typed && !confirm('Discard this email?')) return;
    p.onDiscard();
  };
  const addLink = () => {
    const url = window.prompt('Link address', 'https://');
    if (url && url !== 'https://') cmd('createLink', url);
  };

  return (
    <div
      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!p.sending) p.onSend(); } }}
      style={{ marginBottom: 14, border: '1px solid var(--k-e5e7eb)', borderRadius: 12, background: 'var(--k-fff)', boxShadow: '0 4px 18px rgba(0,0,0,.07)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 4px 14px', background: 'var(--k-f9fafb)', borderBottom: '1px solid var(--k-e5e7eb)' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
        <button type="button" onClick={discard} aria-label="Close" title="Close" style={tb({ fontSize: 18, color: 'var(--k-6b7280)' })}>✕</button>
      </div>

      {p.replyingTo && (
        <div style={{ padding: '7px 14px', background: 'var(--k-eff6ff)', borderBottom: '1px solid var(--k-bfdbfe)', fontSize: 12, color: 'var(--k-1d4ed8)' }}>
          ↩ Replying to “{p.replyingTo}” — stays in the same Gmail thread
        </div>
      )}

      {/* To */}
      <div style={ROW}>
        <span style={LABEL}>To</span>
        <AddressField value={p.moreTo} onChange={p.setMoreTo} placeholder="Add people…"
          leading={
            <span style={{ ...CHIP, padding: '3px 10px', background: 'var(--k-fdf6e8)', borderColor: 'var(--k-fde68a)', color: 'var(--k-92400e)' }} title={p.to}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.toName ? `${p.toName} · ${p.to}` : p.to}</span>
            </span>
          } />
        {!showCc && (
          <button type="button" onClick={() => setShowCc(true)} style={{ ...tb({ color: '#c9922c', fontWeight: 700, fontSize: 13 }), marginTop: 4 }}>Cc</button>
        )}
      </div>
      {showCc && (
        <div style={ROW}>
          <span style={LABEL}>Cc</span>
          <AddressField value={p.cc} onChange={p.setCc} placeholder="Cc…" autoFocus={!p.cc.trim()} />
        </div>
      )}
      {p.autoCcLabel && (
        <div style={{ padding: '6px 12px 6px 70px', fontSize: 12, color: 'var(--k-92400e)', background: 'var(--k-fef9f0)', borderBottom: '1px solid var(--k-f3f4f6)' }}>
          Also copied to tagged agents: {p.autoCcLabel}
        </div>
      )}

      {/* Subject */}
      <div style={ROW}>
        <span style={LABEL}>Subject</span>
        {p.subjectReadOnly ? (
          <span style={{ flex: 1, minWidth: 0, padding: '11px 0', fontSize: 14, fontWeight: 600, color: 'var(--k-374151)' }}>{p.subject}</span>
        ) : (
          <input value={p.subject} onChange={e => p.setSubject(e.target.value)} placeholder="What's this about?" aria-label="Subject"
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, fontWeight: 600, color: 'var(--k-111)', fontFamily: "'DM Sans',sans-serif", padding: '10px 2px' }} />
        )}
      </div>

      {hasExtras && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--k-6b7280)', padding: '8px 14px', borderBottom: '1px solid var(--k-f3f4f6)', cursor: 'pointer' }}>
          <input type="checkbox" checked={p.individual} onChange={e => p.setIndividual(e.target.checked)} style={{ marginTop: 2 }} />
          <span><strong style={{ color: 'var(--k-374151)' }}>See who opens it.</strong> {p.individual
            ? 'Everyone gets their own copy; replies still go to the whole group.'
            : 'One shared email — opens can’t be tied to one person.'}</span>
        </label>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, padding: '4px 8px', borderBottom: '1px solid var(--k-f3f4f6)' }}>
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('bold'); }} aria-label="Bold" title="Bold" style={tb({ fontWeight: 800 })}>B</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('italic'); }} aria-label="Italic" title="Italic" style={tb({ fontStyle: 'italic', fontFamily: 'Georgia,serif' })}>I</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('underline'); }} aria-label="Underline" title="Underline" style={tb({ textDecoration: 'underline' })}>U</button>
        {sep}
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('insertUnorderedList'); }} aria-label="Bullet list" title="Bullet list" style={tb()}>
          <svg width="15" height="12" viewBox="0 0 14 11" fill="currentColor"><circle cx="1.5" cy="1.5" r="1.5"/><rect x="4" y="0.5" width="10" height="2" rx="1"/><circle cx="1.5" cy="5.5" r="1.5"/><rect x="4" y="4.5" width="10" height="2" rx="1"/><circle cx="1.5" cy="9.5" r="1.5"/><rect x="4" y="8.5" width="10" height="2" rx="1"/></svg>
        </button>
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('insertOrderedList'); }} aria-label="Numbered list" title="Numbered list" style={tb({ fontSize: 12, fontWeight: 700 })}>1.</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); addLink(); }} aria-label="Add link" title="Add link" style={tb()}>🔗</button>
        {sep}
        <button type="button" onClick={() => setShowMore(v => !v)} aria-label="More formatting" aria-expanded={showMore} title="More formatting" style={tb({ fontSize: 13, fontWeight: 700, background: showMore ? 'var(--k-f3f4f6)' : 'none' })}>Aa</button>
        {!p.isMobile && <button type="button" onClick={() => attachRef.current?.click()} aria-label="Attach files" title="Attach files" style={tb({ marginLeft: 'auto', gap: 5, fontSize: 13 })}>📎 Attach</button>}
        <input ref={attachRef} type="file" multiple style={{ display: 'none' }}
          onChange={e => { const files = Array.from(e.target.files ?? []); p.setAttachments(prev => [...prev, ...files]); e.target.value = ''; }} />
      </div>
      {showMore && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, padding: '4px 8px', background: 'var(--k-f9fafb)', borderBottom: '1px solid var(--k-f3f4f6)' }}>
          <select aria-label="Font family" defaultValue="Arial" onChange={e => cmd('fontName', e.target.value)} style={{ height: p.isMobile ? 40 : 30, border: '1px solid var(--k-e5e7eb)', borderRadius: 6, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 6px' }}>
            {['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS'].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select aria-label="Font size" defaultValue="3" onChange={e => cmd('fontSize', e.target.value)} style={{ height: p.isMobile ? 40 : 30, border: '1px solid var(--k-e5e7eb)', borderRadius: 6, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 6px' }}>
            {[['1', '8'], ['2', '10'], ['3', '12'], ['4', '14'], ['5', '18'], ['6', '24'], ['7', '36']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label title="Text color" aria-label="Text color" style={{ ...tb({ position: 'relative', flexDirection: 'column', gap: 0 }) }}>
            <span style={{ fontWeight: 800, fontSize: 14, lineHeight: 1 }}>A</span>
            <span style={{ display: 'block', height: 3, width: 14, background: '#c9922c', borderRadius: 1, marginTop: 1 }} />
            <input type="color" defaultValue="#000000" onChange={e => cmd('foreColor', e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
          </label>
          {sep}
          <button type="button" onMouseDown={e => { e.preventDefault(); cmd('justifyLeft'); }} aria-label="Align left" title="Align left" style={tb()}><svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="4.5" width="9" height="2" rx="1"/><rect x="0" y="9" width="12" height="2" rx="1"/></svg></button>
          <button type="button" onMouseDown={e => { e.preventDefault(); cmd('justifyCenter'); }} aria-label="Align center" title="Align center" style={tb()}><svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2.5" y="4.5" width="9" height="2" rx="1"/><rect x="1" y="9" width="12" height="2" rx="1"/></svg></button>
          <button type="button" onMouseDown={e => { e.preventDefault(); cmd('justifyRight'); }} aria-label="Align right" title="Align right" style={tb()}><svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="5" y="4.5" width="9" height="2" rx="1"/><rect x="2" y="9" width="12" height="2" rx="1"/></svg></button>
          {sep}
          <button type="button" onMouseDown={e => { e.preventDefault(); cmd('outdent'); }} aria-label="Outdent" title="Outdent" style={tb({ fontSize: 13 })}>⇤</button>
          <button type="button" onMouseDown={e => { e.preventDefault(); cmd('indent'); }} aria-label="Indent" title="Indent" style={tb({ fontSize: 13 })}>⇥</button>
        </div>
      )}

      {/* Body */}
      <div
        ref={p.bodyRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Email body"
        data-placeholder="Write your message…"
        style={{ minHeight: p.isMobile ? 200 : 190, maxHeight: p.isMobile ? '45vh' : 360, overflowY: 'auto', padding: '12px 14px', fontSize: 15, fontFamily: 'Arial, sans-serif', lineHeight: 1.6, outline: 'none', color: 'var(--k-111)' }}
      />

      {p.attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px 10px' }}>
          {p.attachments.map((file, i) => (
            <span key={i} style={CHIP}>
              <span>📎</span>
              <span style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
              <span style={{ color: 'var(--k-9ca3af)', fontSize: 11 }}>{file.size > 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</span>
              <button type="button" onClick={() => p.setAttachments(prev => prev.filter((_, idx) => idx !== i))} aria-label={`Remove ${file.name}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-9ca3af)', fontSize: 15, lineHeight: 1, padding: '0 4px', minWidth: 0, minHeight: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Signature */}
      {p.signature && (
        <div style={{ padding: '0 14px 8px' }}>
          <button type="button" onClick={() => setShowSig(v => !v)} aria-expanded={showSig}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-9ca3af)', fontSize: 12, padding: '4px 0', fontFamily: "'DM Sans',sans-serif" }}>
            ✍ Your signature is added {showSig ? '▴' : '▾'}
          </button>
          {showSig && (
            <div style={{ marginTop: 2 }}>
              <div style={{ padding: '8px 10px', background: 'var(--k-f9fafb)', borderRadius: 8, fontSize: 13, color: 'var(--k-374151)' }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.signature) }} />
              <button type="button" onClick={p.onSyncSignature}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c9922c', fontSize: 12, fontWeight: 700, padding: '6px 0', fontFamily: "'DM Sans',sans-serif" }}>↻ Re-sync from Gmail</button>
            </div>
          )}
        </div>
      )}

      {/* Send bar — sticks to the bottom of the scrolling card on phones */}
      <div style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--k-fff)', borderTop: '1px solid var(--k-e5e7eb)' }}>
        {p.isMobile && (
          <button type="button" onClick={() => attachRef.current?.click()} aria-label="Attach files" title="Attach files"
            style={{ width: 48, height: 48, flexShrink: 0, background: 'var(--k-f3f4f6)', border: 'none', borderRadius: 10, fontSize: 18, cursor: 'pointer' }}>📎</button>
        )}
        <button type="button" onClick={p.onSend} disabled={p.sending}
          style={{ flex: p.isMobile ? 1 : undefined, minWidth: 120, height: p.isMobile ? 48 : 40, padding: '0 22px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: p.sending ? 'default' : 'pointer', opacity: p.sending ? 0.7 : 1, fontFamily: "'DM Sans',sans-serif" }}>
          {p.sending ? 'Sending…' : (p.sendLabel ?? 'Send')}
        </button>
        <button type="button" onClick={discard}
          style={{ height: p.isMobile ? 48 : 40, padding: '0 14px', background: 'none', color: 'var(--k-6b7280)', border: 'none', borderRadius: 10, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          Discard
        </button>
        {!p.isMobile && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--k-9ca3af)' }}>⌘↵ to send</span>}
      </div>
    </div>
  );
}
