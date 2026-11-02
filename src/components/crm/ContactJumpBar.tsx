'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// A contact card is one long scroll (details, campaigns, files, documents, notes, deals, tasks, activity, emails — ~4000 px
// on a phone). This sticky row of chips jumps straight to a section and shows where you are. It reads the section headings
// that are already on the card (by their text), so it adds no markup to the sections themselves and only offers the ones
// that exist for this contact.
const SECTIONS: Array<{ label: string; match: RegExp }> = [
  { label: 'Notes', match: /^notes$/i },
  { label: 'Deals', match: /^linked deals\b/i },
  { label: 'Tasks', match: /^tasks$/i },
  { label: 'Emails', match: /^email thread$/i },
  { label: 'Files', match: /^files\b/i },
  { label: 'Docs', match: /^documents\b/i },
  { label: 'Activity', match: /^activity log$/i },
];

type Found = { label: string; el: HTMLElement };

export default function ContactJumpBar() {
  const bar = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<Array<{ label: string }>>([]);
  const els = useRef<Found[]>([]);
  const [active, setActive] = useState('Info');
  const body = () => bar.current?.closest('.modal-body') as HTMLElement | null;

  const scan = useCallback(() => {
    const b = body(); if (!b) return;
    const out: Found[] = [];
    for (const e of Array.from(b.querySelectorAll<HTMLElement>('div,span,h3,h4'))) {
      if (e.children.length > 3) continue;
      const txt = (e.textContent ?? '').replace(/[\u{1F300}-\u{1FAFF}☀-➿️]/gu, '').replace(/\s+/g, ' ').trim();
      if (txt.length > 40 || getComputedStyle(e).textTransform !== 'uppercase') continue;
      const s = SECTIONS.find(x => x.match.test(txt));
      if (s && !out.some(o => o.label === s.label)) out.push({ label: s.label, el: e });
    }
    els.current = out;
    setFound(prev => (prev.length === out.length && prev.every((p, i) => p.label === out[i].label) ? prev : out.map(o => ({ label: o.label }))));
  }, []);

  useEffect(() => {
    const b = body(); if (!b) return;
    scan();
    let t: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 250); }); // Files / Emails load after the card opens
    mo.observe(b, { childList: true, subtree: true });
    const onScroll = () => {
      const top = b.getBoundingClientRect().top + 56;
      let cur = 'Info';
      for (const f of els.current) if (f.el.getBoundingClientRect().top <= top) cur = f.label;
      setActive(prev => (prev === cur ? prev : cur));
    };
    b.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    return () => { mo.disconnect(); clearTimeout(t); b.removeEventListener('scroll', onScroll); };
  }, [scan]);

  const go = (label: string) => {
    const b = body(); if (!b) return;
    if (label === 'Info') { b.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const f = els.current.find(x => x.label === label); if (!f) return;
    b.scrollTo({ top: f.el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 52, behavior: 'smooth' });
  };

  if (found.length < 2) return <div ref={bar} style={{ display: 'none' }} />;
  const chip = (on: boolean): React.CSSProperties => ({ flexShrink: 0, height: 36, padding: '0 14px', borderRadius: 999, border: `1px solid ${on ? 'var(--chip-on-line, #111)' : 'var(--k-e5e7eb)'}`, background: on ? 'var(--chip-on-bg, #111)' : 'var(--k-fff)', color: on ? 'var(--chip-on-fg, #fff)' : 'var(--k-374151)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' });
  return (
    <div ref={bar} role="navigation" aria-label="Jump to a section of this card"
      style={{ position: 'sticky', top: -20, zIndex: 3, margin: '-20px -18px 0', padding: '10px 18px', background: 'var(--k-fff)', borderBottom: '1px solid var(--k-f0f0f0)', display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
      {['Info', ...found.map(f => f.label)].map(l => <button key={l} type="button" onClick={() => go(l)} style={chip(active === l)}>{l}</button>)}
    </div>
  );
}
