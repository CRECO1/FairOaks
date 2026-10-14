'use client';

import { useEffect, useMemo, useRef } from 'react';

/**
 * Screen protection for the CRM.
 *
 * Honest limit, up front: no web page can stop a screenshot. The operating
 * system takes it, and a phone camera pointed at the monitor needs no software
 * at all. What a page CAN do is make a screenshot traceable and inconvenient,
 * and make copying the book out of the page harder than looking at it:
 *
 *  1. WATERMARK. Every screen carries the viewer's name, email and the date,
 *     faintly, across the whole page. A screenshot that leaves the brokerage
 *     says who took it.
 *  2. BLUR WHEN UNFOCUSED. The Windows snipping tool and most capture apps take
 *     focus before they capture, so the CRM blurs whenever the window loses
 *     focus and clears the moment the agent clicks back in.
 *  3. SCREENSHOT KEYS. PrintScreen and the macOS capture shortcuts blank the
 *     clipboard, blur the page briefly, and are logged to audit_logs.
 *  4. NO COPY. Selecting, copying, right-clicking and dragging CRM data is
 *     switched off — except inside inputs and editors, where agents type.
 *     Attempts are logged.
 *  5. NO PRINT of the CRM screen itself (the watermark prints if it's tried).
 *
 * The account owner (super_admin) is exempt from 1–5. Everyone else gets them.
 *
 * Automated browsers are handled separately by detectAutomation() below, which
 * CRMApp checks before it renders anything.
 */

const LOG_THROTTLE_MS = 30_000;

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .crm-allow-copy');
}

/**
 * Signs that this page is being driven by automation rather than a person:
 * WebDriver (Selenium, Playwright, Puppeteer all set it), headless Chrome, and
 * the globals the common drivers leave behind. Any one is enough.
 */
export function detectAutomation(): string | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  try {
    if (navigator.webdriver) return 'navigator.webdriver';
    const ua = navigator.userAgent || '';
    if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright|Electron\/.*Headless/i.test(ua)) return 'headless-ua';
    const w = window as unknown as Record<string, unknown>;
    for (const k of ['callPhantom', '_phantom', '__nightmare', 'domAutomation', 'domAutomationController', '_selenium', 'callSelenium', '_Selenium_IDE_Recorder', '__webdriver_script_fn', '__playwright__binding__', '__pwInitScripts', '__puppeteer_evaluation_script__']) {
      if (k in w) return `global:${k}`;
    }
    // chromedriver injects $cdc_… / cdc_… properties onto document or window.
    const d = document as unknown as Record<string, unknown>;
    if (Object.keys(d).some(k => /^\$?cdc_/.test(k)) || Object.keys(w).some(k => /^\$?cdc_/.test(k))) return 'chromedriver';
    if (document.documentElement.getAttribute('webdriver') !== null) return 'webdriver-attr';
  } catch { /* never let detection itself break the CRM */ }
  return null;
}

export function reportSecurityEvent(token: string | undefined, kind: 'automation_blocked' | 'screenshot_attempt' | 'copy_attempt', detail: string, page?: string) {
  if (!token) return;
  void fetch('/api/crm/security-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, detail, page }),
    keepalive: true,
  }).catch(() => { /* logging never blocks the CRM */ });
}

export default function CrmShield({ name, email, token, page, exempt }: {
  name: string; email: string; token?: string; page?: string; exempt: boolean;
}) {
  const lastLog = useRef<Record<string, number>>({});
  const tokenRef = useRef(token); tokenRef.current = token;
  const pageRef = useRef(page); pageRef.current = page;

  useEffect(() => {
    if (exempt) return;
    const root = document.documentElement;
    root.classList.add('crm-protected');

    const log = (kind: 'screenshot_attempt' | 'copy_attempt', detail: string) => {
      const now = Date.now();
      if (now - (lastLog.current[kind] ?? 0) < LOG_THROTTLE_MS) return;
      lastLog.current[kind] = now;
      reportSecurityEvent(tokenRef.current, kind, detail, pageRef.current);
    };

    let unshieldTimer: ReturnType<typeof setTimeout> | null = null;
    const shield = (ms?: number) => {
      root.classList.add('crm-shielded');
      if (unshieldTimer) clearTimeout(unshieldTimer);
      if (ms) unshieldTimer = setTimeout(() => { if (document.hasFocus()) root.classList.remove('crm-shielded'); }, ms);
    };
    const unshield = () => { if (unshieldTimer) clearTimeout(unshieldTimer); root.classList.remove('crm-shielded'); };

    const onBlur = () => {
      // Focus moving into one of our own iframes (document preview, maps) is not
      // the window losing focus — don't blur the page the agent is reading.
      setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') return;
        if (!document.hasFocus()) shield();
      }, 0);
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') shield(); };

    const onCopy = (e: ClipboardEvent) => {
      if (isEditable(e.target) || isEditable(document.activeElement)) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', '');
      log('copy_attempt', e.type);
    };
    const onContextMenu = (e: MouseEvent) => { if (!isEditable(e.target)) e.preventDefault(); };
    const onDragStart = (e: DragEvent) => { if (!isEditable(e.target)) e.preventDefault(); };

    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const macCapture = e.metaKey && e.shiftKey && ['3', '4', '5', '6', 's', 'S'].includes(k);
      const winSnip = e.metaKey && e.shiftKey && (k === 's' || k === 'S');
      if (k === 'PrintScreen' || k === 'Snapshot' || macCapture || winSnip) {
        shield(1500);
        try { void navigator.clipboard?.writeText(''); } catch { /* ignore */ }
        log('screenshot_attempt', k === 'PrintScreen' ? 'PrintScreen' : `${e.metaKey ? 'Meta+' : ''}${e.shiftKey ? 'Shift+' : ''}${k}`);
        return;
      }
      // Ctrl/Cmd+P on the CRM screen: print is blocked (see CSS), say why.
      if ((e.ctrlKey || e.metaKey) && (k === 'p' || k === 'P') && !document.querySelector('.crm-print-allowed')) {
        e.preventDefault();
        log('screenshot_attempt', 'print');
      }
    };
    // PrintScreen often fires keyup only.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen' || e.key === 'Snapshot') {
        shield(1500);
        try { void navigator.clipboard?.writeText(''); } catch { /* ignore */ }
        log('screenshot_attempt', 'PrintScreen');
      }
    };

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', unshield);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('cut', onCopy, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('dragstart', onDragStart, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      root.classList.remove('crm-protected', 'crm-shielded');
      if (unshieldTimer) clearTimeout(unshieldTimer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', unshield);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('cut', onCopy, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('dragstart', onDragStart, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [exempt]);

  // Tiled watermark as an SVG background: one element, no layout cost.
  const watermark = useMemo(() => {
    if (exempt) return '';
    const stamp = `${name} · ${email} · ${new Date().toLocaleDateString('en-US')}`;
    const esc = stamp.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220"><text x="0" y="130" transform="rotate(-24 210 110)" font-family="DM Sans, Arial, sans-serif" font-size="14" fill="rgba(17,24,39,0.07)">${esc}</text></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }, [exempt, name, email]);

  if (exempt) return null;
  return (
    <>
      <style>{`
        html.crm-protected .crm-app-shell{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}
        html.crm-protected .crm-app-shell input,html.crm-protected .crm-app-shell textarea,html.crm-protected .crm-app-shell select,html.crm-protected .crm-app-shell [contenteditable="true"],html.crm-protected .crm-app-shell [contenteditable=""],html.crm-protected .crm-allow-copy{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default;}
        html.crm-protected .crm-app-shell{transition:filter .12s ease;}
        html.crm-shielded .crm-app-shell{filter:blur(18px) !important;}
        .crm-shield-veil{display:none;}
        html.crm-shielded .crm-shield-veil{display:flex;}
        @media print{html.crm-protected body:not(:has(.crm-print-allowed)) .crm-app-shell{display:none !important;}}
      `}</style>
      <div aria-hidden className="crm-watermark" style={{ position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none', backgroundImage: watermark, backgroundRepeat: 'repeat' }} />
      <div aria-hidden className="crm-shield-veil" style={{ position: 'fixed', inset: 0, zIndex: 2147483001, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', fontFamily: "'DM Sans',sans-serif", fontSize: 15, fontWeight: 600, color: '#374151' }}>
        <span style={{ background: 'rgba(255,255,255,.92)', padding: '12px 18px', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,.12)' }}>Click to return to the CRM</span>
      </div>
    </>
  );
}
