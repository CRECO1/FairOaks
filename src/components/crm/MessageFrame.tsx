'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { sanitizeHtml } from '@/lib/sanitize';

// Old replies carry their whole history: fold it behind a "⋯" pill like Gmail does, so the new text is what you see.
// Works on already-sanitized HTML (class attributes survive); <details> needs no script, so it works in the sandbox.
function collapseQuotes(html: string): string {
  if (typeof DOMParser === 'undefined' || !html) return html;
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const body = doc.body;
    const hasTextBefore = (el: Element) => {
      const r = doc.createRange(); r.setStart(body, 0); r.setEndBefore(el);
      return r.toString().replace(/\s+/g, '').length > 15;
    };
    const wrap = (nodes: Node[]) => {
      const d = doc.createElement('details'); d.className = 'q';
      const sm = doc.createElement('summary'); sm.textContent = '⋯';
      sm.setAttribute('title', 'Show quoted text');
      nodes[0].parentNode!.insertBefore(d, nodes[0]); d.appendChild(sm); nodes.forEach(n => d.appendChild(n));
    };
    const first = body.querySelector('div.gmail_quote, blockquote.gmail_quote, div.yahoo_quoted, blockquote[type="cite"]');
    if (first && hasTextBefore(first)) {
      const next = first.previousElementSibling;
      // Gmail puts the "On … wrote:" line inside .gmail_quote; Apple Mail/Thunderbird put it just before.
      wrap(next && /wrote:\s*$/i.test(next.textContent ?? '') ? [next, first] : [first]);
      return body.innerHTML;
    }
    // Outlook: everything from the "From: … Sent: …" header block onward.
    const rp = body.querySelector('#divRplyFwdMsg');
    if (rp && hasTextBefore(rp)) {
      const nodes: Node[] = []; let n: Node | null = rp.previousElementSibling?.tagName === 'HR' ? rp.previousElementSibling : rp;
      while (n) { nodes.push(n); n = n.nextSibling; }
      wrap(nodes);
      return body.innerHTML;
    }
    // Plain text: fold from the "On … wrote:" line down.
    if (body.firstElementChild?.getAttribute('style')?.includes('pre-wrap') && body.children.length === 1) {
      const el = body.firstElementChild as HTMLElement;
      const text = el.innerHTML;
      const idx = text.search(/\n(On .{5,200}wrote:)\n/);
      if (idx > 40) { el.innerHTML = `${text.slice(0, idx)}<details class="q"><summary title="Show quoted text">⋯</summary>${text.slice(idx)}</details>`; return body.innerHTML; }
    }
  } catch { /* show it unfolded */ }
  return html;
}

// Never load tracking pixels while reading. Our own open-tracking pixel sits in every email sent from the CRM, so showing
// your sent mail here would count as the RECIPIENT opening it; incoming mail's 1×1 trackers are dropped too (privacy).
function stripTrackers(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    if (/\/api\/track\//i.test(tag)) return '';
    const one = (attr: string) => new RegExp(`\\b${attr}\\s*=\\s*["']?1(px)?["']?(?=[\\s/>"'])`, 'i').test(tag) || new RegExp(`${attr}\\s*:\\s*1px`, 'i').test(tag);
    return one('width') && one('height') ? '' : tag;
  });
}

// A sandboxed frame for the message HTML: no scripts can run, links open in new tabs, and it grows to fit its content.
export function MessageFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(120);
  const fit = useCallback(() => {
    const f = ref.current, d = f?.contentDocument;
    if (!f || !d?.documentElement || !d.body) return;
    // A wide email (a table-based signature, a fixed 600px newsletter) would be cut off at the right edge on a phone and
    // this frame can't scroll sideways, so shrink it to fit — what Gmail's phone app does — down to a still-readable 50%.
    d.body.style.zoom = '1';
    const avail = f.clientWidth, need = d.documentElement.scrollWidth;
    if (avail > 0 && need > avail + 2) d.body.style.zoom = String(Math.max(0.5, avail / need));
    setH(Math.min(30000, Math.max(40, d.documentElement.scrollHeight)));
  }, []);
  // No scripts or event handlers survive; links open in a new tab, never inside the frame.
  const safe = useMemo(() => collapseQuotes(sanitizeHtml(stripTrackers(html)).replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ')), [html]);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#222;font:14px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 .8ex;border-left:2px solid #d5d9df;padding-left:1ex;color:#555}a{color:#1a56c4}details.q{margin:10px 0}details.q>summary{display:inline-block;cursor:pointer;list-style:none;background:#eceff3;color:#4b5563;border-radius:10px;padding:0 10px;font-size:13px;line-height:18px;user-select:none}details.q>summary::-webkit-details-marker{display:none}details.q[open]>summary{margin-bottom:8px}.gmail_signature{color:#555}</style></head><body>${safe}</body></html>`;
  return <iframe ref={ref} title="Message" srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    onLoad={() => {
      fit(); setTimeout(fit, 400); setTimeout(fit, 1500);
      const d = ref.current?.contentDocument;
      if (d) { d.addEventListener('toggle', fit, true); try { new ResizeObserver(fit).observe(d.documentElement); } catch { /* older browsers: the timers above cover it */ } }
    }}
    style={{ width: '100%', height: h, border: 'none', display: 'block', background: '#fff', borderRadius: 6 }} />;
}
