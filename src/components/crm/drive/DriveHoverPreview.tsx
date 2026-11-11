'use client';

/**
 * Hover preview for My Drive: rest the pointer on a document and a small read-only preview floats beside it (the card itself is
 * DriveHoverCard.tsx, loaded the first time one opens).
 *
 * - The pointer has to settle for about half a second before anything loads, so sweeping down a list does no work.
 * - The card never takes the pointer (clicks go straight through to the row) and hides on press (click or drag), scroll, resize, Esc, and when
 *   any other panel opens (`enabled` goes false).
 * - Mouse only. Phones and touch have no hover; the eye icon (Quick look) is still the way to peek there.
 * - Folders get no card; there is nothing to show.
 *
 * Use: `const hover = useDriveHoverPreview({ enabled, authToken, describe })`, spread `{...hover.bind(kind, item)}` on the element that
 * opens the item, and render `{hover.card}` once, inline next to the Quick look panel (not in a portal: the CRM's colour tokens live on
 * .crm-app-shell, and a portal into <body> would lose them).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { DIName } from './DriveIcons';
import type { DriveDoc, DriveFile, DriveFormItem } from '@/lib/drive-types';

export type HoverKind = 'folder' | 'doc' | 'file' | 'form';
export type HoverItem = DriveDoc | DriveFile | DriveFormItem;
/** What the card's header says about the item: supplied by the Drive so it matches the list row exactly. */
export interface HoverInfo { title: string; sub: string; icon: DIName; color: string }
/** Where and what the open card is about. */
export interface Shown { kind: Exclude<HoverKind, 'folder'>; item: HoverItem; x: number; top: number; bottom: number }
type HoverHandlers = Partial<Pick<React.DOMAttributes<HTMLElement>, 'onMouseEnter' | 'onMouseLeave' | 'onMouseDown' | 'onContextMenu'>>;

const DriveHoverCard = dynamic(() => import('./DriveHoverCard'), { ssr: false });

const SETTLE_MS = 520;   // how long the pointer has to rest before a card opens
const QUICK_MS = 150;    // ...and when moving straight from one card to the next
const canHover = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

export function useDriveHoverPreview(o: { enabled: boolean; authToken?: string; describe: (kind: HoverKind, item: HoverItem) => HoverInfo }): { bind: (kind: HoverKind, item: HoverItem) => HoverHandlers; card: React.ReactNode } {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef(0);
  const visible = useRef(false);
  const lastHidden = useRef(0);
  const opts = useRef(o); opts.current = o;

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    if (visible.current) { visible.current = false; lastHidden.current = performance.now(); setShown(null); }
  }, []);

  const arm = useCallback((kind: Shown['kind'], item: HoverItem, e: React.MouseEvent<HTMLElement>) => {
    if (!opts.current.enabled || !canHover()) return;
    window.clearTimeout(timer.current);
    void import('./DriveHoverCard');   // start fetching the card's code while the pointer settles
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const delay = performance.now() - lastHidden.current < 450 ? QUICK_MS : SETTLE_MS;
    timer.current = window.setTimeout(() => { visible.current = true; setShown({ kind, item, x, top: r.top, bottom: r.bottom }); }, delay);
  }, []);

  const bind = useCallback((kind: HoverKind, item: HoverItem): HoverHandlers => (kind === 'folder' ? {} : {
    onMouseEnter: e => arm(kind, item, e),
    onMouseLeave: hide, onMouseDown: hide, onContextMenu: hide,   // pressing the mouse (a click, or the start of a drag) closes it
  }), [arm, hide]);

  // Another panel opened (or the Drive moved to the trash / a phone layout): drop any card and any pending one.
  useEffect(() => { if (!o.enabled) hide(); }, [o.enabled, hide]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!shown) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
      window.removeEventListener('keydown', key, true);
    };
  }, [shown, hide]);

  const card = shown ? <DriveHoverCard key={`${shown.kind}:${shown.item.id}:${shown.item.updated_at}`} shown={shown} token={o.authToken} info={o.describe(shown.kind, shown.item)} /> : null;
  return { bind, card };
}
