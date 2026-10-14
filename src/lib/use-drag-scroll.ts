import { useCallback, useRef, useState } from 'react';

/**
 * Click-and-drag horizontal scrolling for a strip that overflows (the property card's tab row).
 * Trackpad / wheel / touch scrolling keep working; this adds dragging with the mouse.
 *
 *   const drag = useDragScroll();
 *   <div ref={drag.ref} {...drag.handlers} style={{ overflowX: 'auto', ...drag.style }}> … </div>
 *
 * A drag of more than a few pixels is not a click: the click that follows mouse-up is swallowed so
 * releasing over a tab doesn't also open it. A plain click still opens the tab.
 */
const THRESHOLD = 4;

export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const state = useRef({ down: false, startX: 0, startLeft: 0, moved: false });
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    state.current = { down: true, startX: e.clientX, startLeft: el.scrollLeft, moved: false };
    const move = (ev: MouseEvent) => {
      const s = state.current;
      if (!s.down || !ref.current) return;
      const dx = ev.clientX - s.startX;
      if (!s.moved && Math.abs(dx) < THRESHOLD) return;
      if (!s.moved) { s.moved = true; setDragging(true); }
      ref.current.scrollLeft = s.startLeft - dx;
      ev.preventDefault();
    };
    const up = () => {
      state.current.down = false;
      setDragging(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, []);

  // Capture phase: runs before the tab button's own onClick.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (state.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      state.current.moved = false;
    }
  }, []);

  return {
    ref,
    handlers: { onMouseDown, onClickCapture, onDragStart: (e: React.DragEvent) => e.preventDefault() },
    style: { cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' } as React.CSSProperties,
    dragging,
  };
}
