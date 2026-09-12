import { describe, expect, it, vi } from 'vitest';
import { createSplitDrag, createTerminalResize } from './pane-resize.js';

describe('split drag persistence', () => {
  it('previews locally and commits only the final size on release', () => {
    const preview = vi.fn();
    const commit = vi.fn();
    const drag = createSplitDrag([0.5, 0.5], 0, 100, 1000, preview, commit);
    drag.move(200);
    drag.move(300);
    expect(preview).toHaveBeenLastCalledWith([0.7, 0.3]);
    expect(commit).not.toHaveBeenCalled();
    drag.finish();
    drag.finish();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith([0.7, 0.3]);
  });

  it('does not save a click or canceled gesture and ignores later moves', () => {
    const commit = vi.fn();
    const preview = vi.fn();
    createSplitDrag([0.5, 0.5], 0, 0, 1000, preview, commit).finish();
    const drag = createSplitDrag([0.5, 0.5], 0, 0, 1000, preview, commit);
    drag.move(200);
    drag.cancel();
    drag.move(300);
    drag.finish();
    expect(preview).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it('clamps adjacent panes while preserving the other split sizes', () => {
    const preview = vi.fn();
    const drag = createSplitDrag([0.3, 0.4, 0.3], 1, 0, 100, preview, vi.fn());
    drag.move(1000);
    expect(preview.mock.lastCall?.[0][0]).toBe(0.3);
    expect(preview.mock.lastCall?.[0][1]).toBeCloseTo(0.6);
    expect(preview.mock.lastCall?.[0][2]).toBeCloseTo(0.1);
  });
});

describe('terminal resize delivery', () => {
  it('coalesces a resize burst and does not repeat unchanged terminal dimensions', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const resize = createTerminalResize(send);
    resize.schedule(80, 24);
    resize.schedule(81, 24);
    resize.schedule(90, 25);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(90, 25);
    resize.schedule(90, 25);
    vi.runAllTimers();
    expect(send).toHaveBeenCalledOnce();
    resize.schedule(95, 25);
    resize.cancel();
    vi.runAllTimers();
    expect(send).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
