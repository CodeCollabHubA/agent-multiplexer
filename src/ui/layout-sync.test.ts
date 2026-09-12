import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../core/models.js';
import { createWorkspace, setWorkspaceLayout, renameWorkspace } from '../core/workspace.js';
import { resizeSplit, templateLayout } from '../core/layout.js';
import { PendingLayouts } from './layout-sync.js';

describe('layout echo reconciliation', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100); });
  afterEach(() => vi.useRealTimers());
  it('keeps a committed local resize through delayed echoes without discarding remote metadata', () => {
    const original = createWorkspace(emptyState(), 'Workspace', '/tmp');
    const id = original.activeWorkspaceId!;
    const layout = resizeSplit(original.workspaces[id]!.layout, [], [0.7, 0.3]);
    const pending = new PendingLayouts();
    pending.set(id, layout, 200);
    const remote = renameWorkspace(original, id, 'Remote name');
    const merged = pending.merge(remote);
    expect(merged.workspaces[id]!.layout).toEqual(layout);
    expect(merged.workspaces[id]!.name).toBe('Remote name');
    const acknowledged = setWorkspaceLayout(remote, id, layout);
    expect(pending.merge(acknowledged)).toBe(acknowledged);
    // Once acknowledged, intentional later changes from another browser apply.
    expect(pending.merge(remote)).toBe(remote);
  });

  it('does not let an earlier drag acknowledgment overwrite a later drag', () => {
    const state = createWorkspace(emptyState(), 'Workspace', '/tmp');
    const id = state.activeWorkspaceId!;
    const first = resizeSplit(state.workspaces[id]!.layout, [], [0.6, 0.4]);
    const last = resizeSplit(first, [], [0.8, 0.2]);
    const pending = new PendingLayouts();
    pending.set(id, first, 200);
    pending.set(id, last, 300);
    expect(pending.merge(setWorkspaceLayout(state, id, first)).workspaces[id]!.layout).toEqual(last);
  });

  it('accepts a local reset even when Convex coalesces away the resize acknowledgment', () => {
    const state = createWorkspace(emptyState(), 'Workspace', '/tmp');
    const id = state.activeWorkspaceId!;
    const pending = new PendingLayouts();
    pending.set(id, resizeSplit(state.workspaces[id]!.layout, [], [0.7, 0.3]), 200);
    const reset = setWorkspaceLayout(state, id, templateLayout('1x2'));
    pending.discardChanged(reset);
    expect(pending.merge(reset)).toBe(reset);
  });

  it('accepts a newer remote layout when the expected acknowledgment was superseded', () => {
    const state = createWorkspace(emptyState(), 'Workspace', '/tmp');
    const id = state.activeWorkspaceId!;
    const pending = new PendingLayouts();
    pending.set(id, resizeSplit(state.workspaces[id]!.layout, [], [0.7, 0.3]), 200);
    vi.setSystemTime(300);
    const newer = setWorkspaceLayout(state, id, resizeSplit(state.workspaces[id]!.layout, [], [0.4, 0.6]));
    expect(pending.merge(newer)).toBe(newer);
  });

  it('does not resurrect panes or workspaces when remote structure changes', () => {
    const state = createWorkspace(emptyState(), 'Workspace', '/tmp');
    const id = state.activeWorkspaceId!;
    const pending = new PendingLayouts();
    pending.set(id, resizeSplit(state.workspaces[id]!.layout, [], [0.7, 0.3]), 200);
    const changed = setWorkspaceLayout(state, id, templateLayout('1'));
    expect(pending.merge(changed)).toBe(changed);
    pending.set(id, state.workspaces[id]!.layout, 200);
    const removed = emptyState();
    expect(pending.merge(removed)).toBe(removed);
  });
});
