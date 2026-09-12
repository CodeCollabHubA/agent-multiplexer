import type { AppState } from '../core/models.js';
import { applyCardOutcome, applyCardRoute, applyCardSession, applyCardStatus, updateCard } from '../core/board.js';
import { updateSession } from '../core/workspace.js';
import type { ServerMessage } from './protocol.js';

/** Current invocation only: terminal bytes live in the supervisor's bounded buffer. */
export class RuntimeState {
  private revision = Date.now();
  private panes = new Map<string, Map<string, ServerMessage>>();

  record(message: ServerMessage): boolean {
    if (!('paneId' in message) || message.t === 'pane:data' || message.t === 'pane:snapshot' || message.t === 'pane:health') return false;
    if (message.t === 'pane:status' || message.t === 'pane:outcome' || message.t === 'pane:error') {
      this.revision = Math.max(Date.now(), this.revision + 1);
      message.runtimeRevision = this.revision;
    }
    const id = message.paneId;
    if (message.t === 'pane:starting') this.panes.set(id, new Map());
    const pane = this.panes.get(id) ?? new Map<string, ServerMessage>();
    this.panes.set(id, pane);
    if (message.t === 'pane:status' && (message.status === 'running' || message.status === 'waiting' || message.status === 'interrupted')) {
      pane.delete('pane:outcome');
    }
    // Delete/reinsert keeps the snapshot in causal order, including status after identity.
    pane.delete(message.t);
    pane.set(message.t, message);
    return true;
  }

  messages(paneId?: string, includeReset = false): ServerMessage[] {
    const panes = paneId ? [this.panes.get(paneId)].filter(p => p !== undefined) : [...this.panes.values()];
    return panes.flatMap(pane => [...pane.values()].filter(message =>
      includeReset || message.t !== 'pane:starting' || (!pane.has('pane:spawned') && !pane.has('pane:error') && !pane.has('pane:outcome')),
    ));
  }

  /** Reconcile late client saves too: events can precede the first saved card binding. */
  reconcile(state: AppState): AppState {
    let next = state;
    for (const message of this.messages(undefined, true)) {
      if (!('paneId' in message)) continue;
      const id = message.paneId;
      const wsId = next.workspaceOrder.find(ws => next.workspaces[ws]?.sessions[id]);
      if (message.t === 'pane:starting') {
        if (wsId) next = updateSession(next, wsId, id, { route: undefined, codexSessionId: undefined, devinSessionId: undefined });
        for (const ws of next.workspaceOrder) {
          for (const card of Object.values(next.workspaces[ws]?.cards ?? {})) {
            if (card.paneId === id) next = updateCard(next, ws, card.id, { route: undefined, codexSessionId: undefined, devinSessionId: undefined });
          }
        }
      } else if (message.t === 'pane:route') {
        if (wsId) next = updateSession(next, wsId, id, { route: message.route });
        next = applyCardRoute(next, id, message.route);
      } else if (message.t === 'pane:codex-session' || message.t === 'pane:session') {
        const codex = message.t === 'pane:codex-session';
        const sessionId = codex ? message.codexSessionId : message.devinSessionId;
        if (wsId) next = updateSession(next, wsId, id, codex ? { codexSessionId: sessionId } : { devinSessionId: sessionId });
        next = applyCardSession(next, id, sessionId, codex ? 'codex' : 'devin');
      } else if (message.t === 'pane:status') next = applyCardStatus(next, id, message.status, message.runtimeRevision);
      else if (message.t === 'pane:error') next = applyCardOutcome(next, id, { kind: 'failed', message: message.error }, message.runtimeRevision);
      else if (message.t === 'pane:outcome') next = applyCardOutcome(next, id, message.outcome === 'failed' ? { kind: 'failed', message: message.error ?? 'Agent failed' } : { kind: message.outcome }, message.runtimeRevision);
    }
    // Replaying the same snapshot must not churn timestamps or trigger save loops.
    for (const wsId of next.workspaceOrder) {
      const before = state.workspaces[wsId];
      const after = next.workspaces[wsId];
      if (before && after && JSON.stringify({ ...before, updatedAt: 0 }) === JSON.stringify({ ...after, updatedAt: 0 })) {
        next.workspaces[wsId] = before;
      }
    }
    return next.workspaceOrder.every(id => next.workspaces[id] === state.workspaces[id]) ? state : next;
  }
}
