import type { AppState, LayoutNode } from '../core/models.js';

/** Sizes are excluded so remote metadata cannot interrupt the current gesture. */
export function layoutStructure(node: LayoutNode): string {
  return node.type === 'leaf'
    ? JSON.stringify(['leaf', node.sessionId])
    : JSON.stringify([node.dir, node.children.map(layoutStructure)]);
}

/** Protect only unacknowledged geometry, while accepting remote session/status edits. */
export class PendingLayouts {
  private layouts = new Map<string, { layout: LayoutNode; updatedAt: number }>();

  set(workspaceId: string, layout: LayoutNode, updatedAt: number): void {
    this.layouts.set(workspaceId, { layout, updatedAt });
  }

  /** Reset/template changes supersede a drag even if Convex coalesces its echo away. */
  discardChanged(local: AppState): void {
    for (const [id, { layout }] of this.layouts) {
      if (JSON.stringify(local.workspaces[id]?.layout) !== JSON.stringify(layout)) this.layouts.delete(id);
    }
  }

  merge(remote: AppState): AppState {
    let next = remote;
    for (const [id, { layout, updatedAt }] of this.layouts) {
      const workspace = remote.workspaces[id];
      if (!workspace || workspace.updatedAt > updatedAt || layoutStructure(workspace.layout) !== layoutStructure(layout)
        || JSON.stringify(workspace.layout) === JSON.stringify(layout)) {
        this.layouts.delete(id);
        continue;
      }
      next = {
        ...next,
        workspaces: { ...next.workspaces, [id]: { ...workspace, layout } },
      };
    }
    return next;
  }
}
