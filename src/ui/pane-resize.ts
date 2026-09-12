/** Keep the gesture local; persistence receives only the final proportions. */
export function createSplitDrag(
  sizes: number[], index: number, start: number, total: number,
  preview: (sizes: number[]) => void, commit: (sizes: number[]) => void,
) {
  let latest = sizes;
  let ended = false;
  return {
    move(position: number) {
      if (ended || total <= 0) return;
      const a = sizes[index] ?? 0;
      const b = sizes[index + 1] ?? 0;
      const shift = Math.max(-a + 0.1, Math.min(b - 0.1, (position - start) / total));
      const next = [...sizes];
      next[index] = a + shift;
      next[index + 1] = b - shift;
      if (next.every((size, i) => size === latest[i])) return;
      latest = next;
      preview(next);
    },
    finish() {
      if (ended) return;
      ended = true;
      if (latest.some((size, i) => size !== sizes[i])) commit(latest);
    },
    cancel() { ended = true; },
  };
}

/** PTY redraws are expensive over Convex; send dimensions after resizing settles. */
export function createTerminalResize(send: (cols: number, rows: number) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sentCols = 0;
  let sentRows = 0;
  return {
    schedule(cols: number, rows: number) {
      clearTimeout(timer);
      timer = undefined;
      if (cols === sentCols && rows === sentRows) return;
      timer = setTimeout(() => {
        timer = undefined;
        sentCols = cols;
        sentRows = rows;
        send(cols, rows);
      }, 120);
    },
    cancel() { clearTimeout(timer); timer = undefined; },
  };
}
