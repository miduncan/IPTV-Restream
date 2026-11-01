import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';

const DEFAULT_WIDTH = 390;
const MIN_WIDTH = 300;
const MAX_WIDTH = 640;
const STORAGE_KEY = 'streamhub.sidebarWidth';

function savedWidth() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const width = stored === null ? DEFAULT_WIDTH : Number(stored);
    return Number.isFinite(width) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export default function ResizableSidebar({ children }: { children: ReactNode }) {
  const [preferredWidth, setPreferredWidth] = useState(savedWidth);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const maxWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth - 480));
  const width = Math.min(preferredWidth, maxWidth);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(preferredWidth)); } catch { /* Resizing works without storage. */ }
  }, [preferredWidth]);

  useEffect(() => {
    if (!dragging) return;
    document.documentElement.classList.add('sidebar-resizing');
    const stop = () => { drag.current = null; setDragging(false); };
    window.addEventListener('blur', stop);
    return () => {
      document.documentElement.classList.remove('sidebar-resizing');
      window.removeEventListener('blur', stop);
    };
  }, [dragging]);

  const resizeTo = (nextWidth: number) => setPreferredWidth(Math.max(MIN_WIDTH, Math.min(maxWidth, nextWidth)));

  return <aside id="player-sidebar" className="player-sidebar" style={{ '--sidebar-width': `${width}px` } as CSSProperties}>
    <div role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="player-sidebar" aria-valuemin={MIN_WIDTH} aria-valuemax={maxWidth} aria-valuenow={width} aria-valuetext={`${width} pixels`} tabIndex={0} title="Drag to resize. Double-click to reset." className={`sidebar-resize-handle ${dragging ? 'sidebar-resize-handle-active' : ''}`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        setDragging(true);
      }}
      onPointerMove={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        resizeTo(drag.current.startWidth + drag.current.startX - event.clientX);
      }}
      onPointerUp={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onDoubleClick={() => setPreferredWidth(DEFAULT_WIDTH)}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') resizeTo(width + (event.shiftKey ? 48 : 16));
        else if (event.key === 'ArrowRight') resizeTo(width - (event.shiftKey ? 48 : 16));
        else if (event.key === 'Home') resizeTo(MIN_WIDTH);
        else if (event.key === 'End') resizeTo(maxWidth);
        else return;
        event.preventDefault();
      }}
    />
    {children}
  </aside>;
}
