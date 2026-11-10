'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// The composer's formatting toolbar: buttons light up for what the cursor is in (bold, list, link…), a proper inline link
// editor instead of a browser prompt (keeps your selection, fixes "www…" / email addresses, edits or removes an existing
// link, ⌘/Ctrl+K), strikethrough / quote / clear-formatting, and one icon style throughout.

type Active = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; ul: boolean; ol: boolean; quote: boolean; link: boolean };
const NONE: Active = { bold: false, italic: false, underline: false, strike: false, ul: false, ol: false, quote: false, link: false };

const ico = (d: React.ReactNode, w = 16) => <svg width={w} height={w} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const I = {
  ul: ico(<><circle cx="2.5" cy="4" r=".6" fill="currentColor" /><circle cx="2.5" cy="8" r=".6" fill="currentColor" /><circle cx="2.5" cy="12" r=".6" fill="currentColor" /><path d="M6 4h8M6 8h8M6 12h8" /></>),
  ol: ico(<><path d="M6 4h8M6 8h8M6 12h8" /><path d="M2 3l1-.7V6M2 9.6c.2-.5 1.8-.9 1.8.2 0 .8-1.8 1.4-1.8 2.2h2" strokeWidth="1.1" /></>),
  quote: ico(<path d="M3 11V8c0-2 1-3.2 3-3.6M9 11V8c0-2 1-3.2 3-3.6M3 8h3v3H3zM9 8h3v3H9z" />),
  link: ico(<path d="M6.8 9.2a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.2 6.8a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />),
  clear: ico(<><path d="M3 3.5h8M7 3.5l-2 9M5 12.5h4" /><path d="M10.5 9.5l3 3M13.5 9.5l-3 3" /></>),
  tpl: ico(<><path d="M4 1.8h5.2L12.5 5v9.2H4z" /><path d="M9 1.8V5.2h3.5M6 8.5h4M6 11h4" /></>),
  folder: ico(<path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.5 1.7H13c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" />),
  clip: ico(<path d="M13 7.7L8 12.7a3.2 3.2 0 0 1-4.5-4.5l5.3-5.3a2.1 2.1 0 0 1 3 3L6.6 11.2a1 1 0 0 1-1.5-1.5l4.7-4.7" />),
};

const EMOJI = ['😀','😃','😄','😁','😊','🙂','😉','😍','🥰','😎','🤝','👍','👏','🙌','🙏','💪','🎉','✅','⭐','🔥','💯','❤️','😂','🤣','😅','🤔','😬','😢','🙈','👋','👌','✌️','👀','📅','📞','📧','📎','📍','🏢','🏠','🏬','🏗️','🔑','💼','💰','📈','📊','📝','🕐','⏰','🚀','☀️','🌟','☕','🍀','✨','❗','❓','➡️','👉','🙂‍↕️'];

const insideBody = (body: HTMLElement | null, n: Node | null) => !!(body && n && body.contains(n));
const elOf = (n: Node | null) => (n && n.nodeType === 1 ? (n as Element) : n?.parentElement) ?? null;

/** Turn what an agent typed into a safe, working address: add https://, recognise emails, refuse script-ish schemes. */
export function normalizeLink(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[\w.-]+:\d+/.test(v)) return null; // javascript:, data:, file: …
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^[\d\s().+-]{7,}$/.test(v)) return `tel:${v.replace(/[^\d+]/g, '')}`;
  return /\s/.test(v) ? null : `https://${v}`;
}

export default function EmailToolbar(p: {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  isMobile: boolean;
  showTpl: boolean; onToggleTpl: () => void;
  showMore: boolean; onToggleMore: () => void;
  onDealDocs?: () => void;
  onAttach?: () => void;
  attachCount: number;
  /** Desktop: the composer's bottom bar. Aa / attach / link / deal docs / templates render there (Gmail-style) and the formatting row only shows when Aa is on. */
  slot?: HTMLElement | null;
  /** Called after a change made by a toolbar button, so the composer can autosave. */
  onChange?: () => void;
}) {
  const [on, setOn] = useState<Active>(NONE);
  const [mac, setMac] = useState(false);
  useEffect(() => { setMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)); }, []);
  const mod = mac ? '⌘' : 'Ctrl+';
  const smod = mac ? '⌘⇧' : 'Ctrl+Shift+';

  const savedRange = useRef<Range | null>(null);
  const [link, setLink] = useState<{ url: string; editing: boolean; hasSel: boolean } | null>(null);
  const [linkErr, setLinkErr] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const insertEmoji = (e: string) => { p.bodyRef.current?.focus(); document.execCommand('insertText', false, e); p.onChange?.(); setEmojiOpen(false); };
  const linkInput = useRef<HTMLInputElement>(null);

  // Track what the cursor is in so the buttons reflect it.
  useEffect(() => {
    const read = () => {
      const body = p.bodyRef.current, sel = window.getSelection();
      if (!body || !sel || !sel.rangeCount || !insideBody(body, sel.anchorNode)) return;
      const q = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
      const el = elOf(sel.anchorNode);
      const next: Active = {
        bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'),
        ul: q('insertUnorderedList'), ol: q('insertOrderedList'),
        quote: !!el?.closest('blockquote') && body.contains(el.closest('blockquote')),
        link: !!el?.closest('a') && body.contains(el.closest('a')),
      };
      setOn(prev => (Object.keys(next) as (keyof Active)[]).every(k => prev[k] === next[k]) ? prev : next);
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [p.bodyRef]);

  const run = (c: string, v?: string) => { p.bodyRef.current?.focus(); document.execCommand(c, false, v); p.onChange?.(); };

  const openLink = useCallback(() => {
    const body = p.bodyRef.current, sel = window.getSelection();
    if (!body) return;
    if (sel && sel.rangeCount && insideBody(body, sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    else { body.focus(); savedRange.current = null; }
    const a = elOf(sel?.anchorNode ?? null)?.closest('a');
    setLinkErr('');
    setLink({ url: a && body.contains(a) ? a.getAttribute('href') ?? '' : '', editing: !!(a && body.contains(a)), hasSel: !!(sel && !sel.isCollapsed && insideBody(body, sel.anchorNode)) });
    setTimeout(() => linkInput.current?.focus(), 0);
  }, [p.bodyRef]);

  // ⌘/Ctrl+K inside the message.
  useEffect(() => {
    const el = p.bodyRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); openLink(); } };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [p.bodyRef, openLink]);

  const restore = () => {
    const body = p.bodyRef.current;
    body?.focus();
    const r = savedRange.current;
    if (r) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
  };
  const applyLink = () => {
    const url = normalizeLink(link?.url ?? '');
    if (!url) { setLinkErr('Enter a web address, email or phone number'); return; }
    restore();
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) document.execCommand('createLink', false, url);
    else {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const a = elOf(sel?.anchorNode ?? null)?.closest('a');
      if (a && p.bodyRef.current?.contains(a)) a.setAttribute('href', url);
      else document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url.replace(/^(https?:\/\/|mailto:|tel:)/i, ''))}</a>&nbsp;`);
    }
    setLink(null); p.onChange?.();
  };
  const removeLink = () => { restore(); document.execCommand('unlink'); setLink(null); p.onChange?.(); };
  const closeLink = () => { setLink(null); setLinkErr(''); restore(); };

  const btn = (active = false, extra?: React.CSSProperties): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, flexShrink: 0,
    minWidth: p.isMobile ? 40 : 32, height: p.isMobile ? 40 : 32, padding: '0 6px', border: 'none', borderRadius: 6, cursor: 'pointer',
    background: active ? 'var(--k-fdf6e8, #fdf6e8)' : 'none', color: active ? '#a06a12' : 'var(--k-374151)',
    fontSize: 14, fontFamily: "'DM Sans',sans-serif", ...extra,
  });
  const sep = <span aria-hidden style={{ width: 1, height: 18, background: 'var(--k-e5e7eb)', margin: '0 4px', flexShrink: 0 }} />;
  // mousedown (not click) + preventDefault keeps the text selection while a formatting button is pressed.
  const fmt = (label: string, tip: string, active: boolean, fn: () => void, content: React.ReactNode, extra?: React.CSSProperties) => (
    <button type="button" onMouseDown={e => { e.preventDefault(); fn(); }} aria-label={label} aria-pressed={active} title={tip} style={btn(active, extra)}>{content}</button>
  );

  const bottom = !p.isMobile && !!p.slot;
  const ib = (active = false, extra?: React.CSSProperties) => btn(active, { minWidth: 36, height: 36, borderRadius: 18, padding: '0 8px', ...extra });
  const bottomActions = bottom ? createPortal(
    <>
      <button type="button" onClick={p.onToggleMore} aria-label="Formatting options" aria-pressed={p.showMore} title={`Formatting options (${smod}F)`} style={ib(p.showMore, { fontSize: 15, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 })}>A<span style={{ fontSize: 11, textDecoration: 'none', marginLeft: 1 }}>a</span></button>
      {p.onAttach && <button type="button" onClick={p.onAttach} aria-label="Attach files" title={`Attach files from your computer (${smod}A)`} style={ib(false, { position: 'relative' })}>{ico(I.clip.props.children, 18)}{p.attachCount > 0 && <span style={{ position: 'absolute', top: 1, right: 0, background: '#c9922c', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 700, minWidth: 15, height: 15, lineHeight: '15px', textAlign: 'center', padding: '0 3px' }}>{p.attachCount}</span>}</button>}
      <button type="button" onMouseDown={e => { e.preventDefault(); openLink(); }} aria-label="Add link" title={`Add or edit link (${mod}K)`} style={ib(on.link || !!link)}>{ico(I.link.props.children, 18)}</button>
      {p.onDealDocs && <button type="button" onClick={p.onDealDocs} aria-label="Attach from the deal" title="Attach a document from this deal — nothing to download (no shortcut)" style={ib()}>{ico(I.folder.props.children, 18)}</button>}
      <button type="button" onClick={p.onToggleTpl} aria-label="Templates" aria-expanded={p.showTpl} title="Templates" style={ib(p.showTpl)}>{ico(I.tpl.props.children, 18)}</button>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setEmojiOpen(v => !v)} aria-label="Insert emoji" aria-haspopup="true" aria-expanded={emojiOpen} title="Insert emoji" style={ib(emojiOpen, { fontSize: 17 })}>🙂</button>
        {emojiOpen && (
          <>
            <div onClick={() => setEmojiOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div role="dialog" aria-label="Emoji" style={{ position: 'absolute', left: 0, bottom: 'calc(100% + 8px)', zIndex: 41, width: 262, padding: 8, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,.2)' }}>
              {EMOJI.map(e => <button key={e} type="button" onMouseDown={ev => ev.preventDefault()} onClick={() => insertEmoji(e)} aria-label={e} style={{ width: 28, height: 28, minWidth: 0, minHeight: 0, border: 'none', background: 'none', borderRadius: 6, fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 0 }}>{e}</button>)}
            </div>
          </>
        )}
      </span>
    </>, p.slot as HTMLElement) : null;

  return (
    <>
      {bottomActions}
      {(!bottom || p.showMore) && <div role="toolbar" aria-label="Formatting"
        style={{ display: 'flex', alignItems: 'center', flexWrap: p.isMobile ? 'nowrap' : 'wrap', overflowX: p.isMobile ? 'auto' : 'visible', ...(p.isMobile ? { scrollbarWidth: 'none' as const, WebkitOverflowScrolling: 'touch' as const } : {}), gap: 2, padding: '4px 8px', borderBottom: '1px solid var(--k-f3f4f6)', WebkitOverflowScrolling: 'touch' }}>
        {fmt('Bold', `Bold (${mod}B)`, on.bold, () => run('bold'), 'B', { fontWeight: 800 })}
        {fmt('Italic', `Italic (${mod}I)`, on.italic, () => run('italic'), 'I', { fontStyle: 'italic', fontFamily: 'Georgia,serif' })}
        {fmt('Underline', `Underline (${mod}U)`, on.underline, () => run('underline'), 'U', { textDecoration: 'underline' })}
        {fmt('Strikethrough', 'Strikethrough', on.strike, () => run('strikeThrough'), 'S', { textDecoration: 'line-through' })}
        {sep}
        {fmt('Bullet list', 'Bullet list', on.ul, () => run('insertUnorderedList'), I.ul)}
        {fmt('Numbered list', 'Numbered list', on.ol, () => run('insertOrderedList'), I.ol)}
        {fmt('Quote', 'Quote', on.quote, () => run('formatBlock', on.quote ? 'p' : 'blockquote'), I.quote)}
        {sep}
        {fmt('Add link', `Add or edit link (${mod}K)`, on.link || !!link, openLink, I.link)}
        {fmt('Clear formatting', 'Clear formatting — plain text again', false, () => { run('removeFormat'); run('unlink'); }, I.clear)}
        {sep}
        {!bottom && <button type="button" onClick={p.onToggleTpl} aria-label="Templates" aria-expanded={p.showTpl} title="Templates" style={btn(p.showTpl, { fontSize: 13, fontWeight: 600 })}>{I.tpl}{!p.isMobile && 'Templates'}</button>}
        {!bottom && <button type="button" onClick={p.onToggleMore} aria-label="More formatting" aria-expanded={p.showMore} title="Font, size, colour, alignment" style={btn(p.showMore, { fontSize: 13, fontWeight: 700 })}>Aa</button>}
        {!p.isMobile && !bottom && p.onDealDocs && <button type="button" onClick={p.onDealDocs} aria-label="Attach from the deal" title="Attach a document from this deal — nothing to download" style={btn(false, { marginLeft: 'auto', fontSize: 13, fontWeight: 600 })}>{I.folder}Deal docs</button>}
        {!p.isMobile && !bottom && p.onAttach && <button type="button" onClick={p.onAttach} aria-label="Attach files" title="Attach files from your computer" style={btn(false, { marginLeft: p.onDealDocs ? 0 : 'auto', fontSize: 13, fontWeight: 600 })}>{I.clip}Attach{p.attachCount > 0 && <span style={{ background: '#c9922c', color: '#fff', borderRadius: 9, fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, lineHeight: '18px', textAlign: 'center', padding: '0 5px' }}>{p.attachCount}</span>}</button>}
      </div>}

      {link && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '6px 8px', background: 'var(--k-f9fafb)', borderBottom: '1px solid var(--k-f3f4f6)', fontFamily: "'DM Sans',sans-serif" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--k-6b7280)' }}>{link.editing ? 'Edit link' : link.hasSel ? 'Link the selected text to' : 'Insert link'}</span>
          <input ref={linkInput} value={link.url} onChange={e => { setLink({ ...link, url: e.target.value }); setLinkErr(''); }} placeholder="Paste or type an address — website, email or phone" aria-label="Link address"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); applyLink(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLink(); } }}
            style={{ flex: '1 1 220px', minWidth: 0, height: p.isMobile ? 40 : 30, padding: '0 10px', border: `1px solid ${linkErr ? '#dc2626' : 'var(--k-e5e7eb)'}`, borderRadius: 6, background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }} />
          <button type="button" onClick={applyLink} style={{ height: p.isMobile ? 40 : 30, padding: '0 14px', border: 'none', borderRadius: 6, background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{link.editing ? 'Update' : 'Add'}</button>
          {link.editing && <button type="button" onClick={removeLink} style={{ height: p.isMobile ? 40 : 30, padding: '0 10px', border: '1px solid var(--k-e5e7eb)', borderRadius: 6, background: 'var(--k-fff)', color: 'var(--k-991b1b)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Remove</button>}
          <button type="button" onClick={closeLink} aria-label="Cancel" style={{ height: p.isMobile ? 40 : 30, padding: '0 8px', border: 'none', background: 'none', color: 'var(--k-9ca3af)', fontSize: 18, cursor: 'pointer', minWidth: 0 }}>×</button>
          {linkErr && <span style={{ flexBasis: '100%', fontSize: 12, color: '#dc2626' }}>{linkErr}</span>}
        </div>
      )}
    </>
  );
}
