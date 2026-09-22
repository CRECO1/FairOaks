'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Per-user screen watermark for the CRM.
 *
 * WHAT THIS IS AND IS NOT. A web page cannot stop an OS screenshot, and it
 * certainly cannot stop someone photographing their own monitor with a phone.
 * Nothing here pretends otherwise. What this does is make a leaked capture
 * self-identifying: whoever is signed in has their name, email and the time
 * tiled across every CRM page, so any screenshot or photo carries the identity
 * of the person who took it. That traceability is the actual control — the
 * deterrent is knowing the image points back at you.
 *
 * Deliberately low-contrast and pointer-events:none, so it reads in a capture
 * without getting in the way of working in the app all day.
 *
 * TAMPER RESISTANCE. Anyone with devtools can delete this node, and a
 * determined person will. A MutationObserver puts it back if it is removed or
 * its key styles are edited, which defeats casual "inspect → delete → screenshot"
 * without claiming to defeat anything more. Someone who disables JavaScript
 * gets no CRM at all, since the app is client-rendered.
 */

const REFRESH_MS = 60_000;

function stamp(): string {
  return new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

export default function Watermark({ name, email, sessionRef }: { name?: string | null; email?: string | null; sessionRef?: string | null }) {
  const [now, setNow] = useState(stamp);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(stamp()), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Put the layer back if it is removed or visually neutered from devtools.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;

    const enforce = () => {
      if (!el.isConnected) { parent.appendChild(el); return; }
      const s = el.style;
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') {
        s.display = ''; s.visibility = ''; s.opacity = '';
      }
    };
    const obs = new MutationObserver(enforce);
    obs.observe(parent, { childList: true });
    obs.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    const iv = setInterval(enforce, 2000);
    return () => { obs.disconnect(); clearInterval(iv); };
  }, []);

  const who = [name, email].filter(Boolean).join(' · ') || 'CRM user';
  const line = `${who}  ·  ${now}${sessionRef ? `  ·  ${sessionRef}` : ''}`;

  // Drawn as a tiled SVG data URI: one background-image instead of hundreds of
  // DOM nodes, so it costs nothing to keep on screen and survives scrolling.
  //
  // Mid-grey rather than black: the CRM has a near-black sidebar and light record
  // panes, and black at low alpha vanishes on the dark one. Grey reads on both. The
  // alpha is set so it survives a phone photo of a monitor — which is how the
  // screenshot that started this actually got taken — without fighting the UI.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="190">
    <text x="0" y="96" transform="rotate(-24 0 96)"
      font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="15" fill="#808080" fill-opacity="0.16">${escapeXml(line)}</text>
  </svg>`;

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      data-crm-watermark=""
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        pointerEvents: 'none',
        userSelect: 'none',
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
        backgroundRepeat: 'repeat',
      }}
    />
  );
}

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
