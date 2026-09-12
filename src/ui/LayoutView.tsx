/**
 * Renders the layout tree as nested flex splits with draggable dividers.
 *
 * Panes are rendered by the caller and passed in by id, so this file owns
 * geometry only — the same pane element is reused across a resize, which is what
 * keeps the terminal (and its PTY) alive through a divider drag.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createSplitDrag } from './pane-resize.js';
import { layoutStructure } from './layout-sync.js';
import type { LayoutNode } from '../core/models.js';

export function LayoutView({
  node,
  path = [],
  renderPane,
  onResize,
}: {
  node: LayoutNode;
  path?: number[];
  renderPane: (sessionId: string | null, key: string) => ReactNode;
  onResize: (path: number[], sizes: number[]) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<number[] | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  const structure = layoutStructure(node);
  useEffect(() => () => cancelDrag.current?.(), [structure]);

  if (node.type === 'leaf') {
    return <div className="pane-slot">{renderPane(node.sessionId, path.join('-'))}</div>;
  }

  const horizontal = node.dir === 'row';

  const startDrag = (index: number, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    cancelDrag.current?.();
    const container = ref.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const total = horizontal ? rect.width : rect.height;
    if (total <= 0) return;
    const drag = createSplitDrag(
      node.sizes, index, horizontal ? event.clientX : event.clientY, total,
      setPreview, (sizes) => onResize(path, sizes),
    );
    const pointerId = event.pointerId;
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointerId) drag.move(horizontal ? e.clientX : e.clientY);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      cancelDrag.current = null;
    };
    const cancel = () => {
      drag.cancel();
      cleanup();
      setPreview(null);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      move(e);
      drag.finish();
      cleanup();
      setPreview(null);
    };
    cancelDrag.current = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
  };

  return (
    <div ref={ref} className={`split split-${node.dir}`}>
      {node.children.map((child, i) => (
        <div key={i} className="split-child" style={{ flexGrow: (preview ?? node.sizes)[i] ?? 1, flexBasis: 0 }}>
          <LayoutView node={child} path={[...path, i]} renderPane={renderPane} onResize={onResize} />
          {i < node.children.length - 1 && (
            <div
              className={`divider divider-${node.dir}`}
              onPointerDown={(e) => startDrag(i, e)}
              role="separator"
              aria-orientation={horizontal ? 'vertical' : 'horizontal'}
            />
          )}
        </div>
      ))}
    </div>
  );
}
