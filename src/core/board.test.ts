import { describe, expect, it } from 'vitest';
import {
  applyCardSession,
  applyCardStatus,
  applyCardOutcome,
  applyCardRoute,
  cardsInColumn,
  columnForStatus,
  createCard,
  markStarted,
  moveCard,
  removeCard,
  updateCard,
} from './board.js';
import { createWorkspace } from './workspace.js';
import { emptyState, type AppState } from './models.js';

/** A state with one workspace, and that workspace's id. */
function withWorkspace(): { state: AppState; wsId: string } {
  const state = createWorkspace(emptyState(), 'app', '/tmp/app');
  return { state, wsId: state.activeWorkspaceId! };
}

const newCard = (title = 'Fix auth') => {
  const { state, wsId } = withWorkspace();
  const created = createCard(state, wsId, { title, description: 'do the thing', cwd: '/tmp/app' });
  return { state: created.state, wsId, id: created.id };
};

describe('createCard', () => {
  it('lands a ticket in the backlog of its workspace and returns its id', () => {
    const { state, wsId, id } = newCard();
    expect(state.workspaces[wsId]!.cardOrder).toEqual([id]);
    expect(state.workspaces[wsId]!.cards[id]!.column).toBe('backlog');
    expect(state.workspaces[wsId]!.cards[id]!.paneId).toBeUndefined();
  });

  it('copies Codex identity and a configured model override through creation', () => {
    const { state, wsId } = withWorkspace();
    const { state: next, id } = createCard(state, wsId, {
      title: 't', description: 'd', cwd: '/tmp', agent: 'codex', modelId: 'capable',
    });
    expect(next.workspaces[wsId]!.cards[id]).toMatchObject({ agent: 'codex', modelId: 'capable' });
    expect(next.workspaces[wsId]!.cards[id]!.devinSessionId).toBeUndefined();
  });

  it('normalises a blank context key to undefined so it cannot shadow the .env default', () => {
    const { state, wsId } = withWorkspace();
    const { state: next, id } = createCard(state, wsId, {
      title: 't',
      description: 'd',
      cwd: '/tmp',
      contextApiKey: '   ',
    });
    expect(next.workspaces[wsId]!.cards[id]!.contextApiKey).toBeUndefined();
  });
});

describe('markStarted', () => {
  it('links the pane, moves to in-progress, and stamps the start once', () => {
    const { state, wsId, id } = newCard();
    const started = markStarted(state, wsId, id, 'pane-1');
    expect(started.workspaces[wsId]!.cards[id]!.paneId).toBe('pane-1');
    expect(started.workspaces[wsId]!.cards[id]!.column).toBe('in-progress');
    const stamp = started.workspaces[wsId]!.cards[id]!.startedAt;
    expect(stamp).toBeTruthy();

    // A restart keeps the original stamp so elapsed time stays honest.
    const restarted = markStarted(started, wsId, id, 'pane-2');
    expect(restarted.workspaces[wsId]!.cards[id]!.startedAt).toBe(stamp);
    expect(restarted.workspaces[wsId]!.cards[id]!.paneId).toBe('pane-2');
  });
});

describe('columnForStatus', () => {
  it('maps a live pane status to its column, idle staying in-progress', () => {
    expect(columnForStatus('running')).toBe('in-progress');
    expect(columnForStatus('idle')).toBe('in-progress');
    expect(columnForStatus('waiting')).toBe('attention');
    expect(columnForStatus('exited')).toBe('done');
  });
});

describe('applyCardStatus', () => {
  it("moves the owning card and leaves other panes' cards alone", () => {
    let { state, wsId, id } = newCard();
    state = markStarted(state, wsId, id, 'pane-1');

    state = applyCardStatus(state, 'pane-1', 'waiting');
    expect(state.workspaces[wsId]!.cards[id]!.column).toBe('attention');

    state = applyCardStatus(state, 'pane-1', 'exited');
    expect(state.workspaces[wsId]!.cards[id]!.column).toBe('done');
  });

  it('is a no-op for a pane no card owns (a terminal-grid pane)', () => {
    const { state } = newCard();
    expect(applyCardStatus(state, 'some-terminal-pane', 'running')).toBe(state);
  });
});

describe('applyCardSession', () => {
  it("records Devin's own session slug on the owning card", () => {
    let { state, wsId, id } = newCard();
    state = markStarted(state, wsId, id, 'pane-1');
    state = applyCardSession(state, 'pane-1', 'lofty-utahraptor');
    expect(state.workspaces[wsId]!.cards[id]!.devinSessionId).toBe('lofty-utahraptor');
  });
});

describe('Codex routing and outcomes', () => {
  it('persists a route and Codex UUID without populating Devin identity', () => {
    let { state, wsId, id } = newCard();
    state = updateCard(state, wsId, id, { agent: 'codex' });
    state = markStarted(state, wsId, id, 'pane-1');
    const route = { modelId: 'capable', model: 'openai/gpt-6-astra', provider: 'openai', complexity: 'complex' as const, reason: 'Cross-component work' };
    state = applyCardRoute(state, 'pane-1', route);
    state = applyCardSession(state, 'pane-1', '550e8400-e29b-41d4-a716-446655440000', 'codex');
    expect(state.workspaces[wsId]!.cards[id]).toMatchObject({ route, codexSessionId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(state.workspaces[wsId]!.cards[id]!.devinSessionId).toBeUndefined();
  });

  it('keeps Auto as user intent so a fresh restart reclassifies', () => {
    let { state, wsId, id } = newCard();
    state = updateCard(state, wsId, id, { agent: 'codex', modelId: undefined });
    state = markStarted(state, wsId, id, 'pane-1');
    state = applyCardRoute(state, 'pane-1', { modelId: 'fast', model: 'openai/fast', provider: 'openai', complexity: 'simple', reason: 'small' });
    expect(state.workspaces[wsId]!.cards[id]!.modelId).toBeUndefined();
    state = markStarted(state, wsId, id, 'pane-2');
    expect(state.workspaces[wsId]!.cards[id]!.modelId).toBeUndefined();
    expect(state.workspaces[wsId]!.cards[id]!.route).toBeUndefined();
  });

  it('preserves an explicit configured model override after routing', () => {
    let { state, wsId, id } = newCard();
    state = updateCard(state, wsId, id, { agent: 'codex', modelId: 'capable' });
    state = markStarted(state, wsId, id, 'pane-1');
    state = applyCardRoute(state, 'pane-1', { modelId: 'capable', model: 'openai/capable', provider: 'openai', complexity: 'manual', reason: 'chosen' });
    expect(state.workspaces[wsId]!.cards[id]!.modelId).toBe('capable');
  });

  it('does not complete a Codex ticket on a failed process exit', () => {
    let { state, wsId, id } = newCard();
    state = updateCard(state, wsId, id, { agent: 'codex' });
    state = markStarted(state, wsId, id, 'pane-1');
    const result = applyCardOutcome(state, 'pane-1', { kind: 'failed', message: 'Provider unavailable' });
    expect(result.workspaces[wsId]!.cards[id]!.column).toBe('attention');
  });

  it('does not treat a Codex exited status as task completion', () => {
    let { state, wsId, id } = newCard();
    state = updateCard(state, wsId, id, { agent: 'codex' });
    state = markStarted(state, wsId, id, 'pane-1');
    state = applyCardStatus(state, 'pane-1', 'exited');
    expect(state.workspaces[wsId]!.cards[id]!.column).toBe('in-progress');
  });

  it('marks Done only for an explicit completed outcome', () => {
    let { state, wsId, id } = newCard();
    state = markStarted(state, wsId, id, 'pane-1');
    expect(applyCardOutcome(state, 'pane-1', { kind: 'canceled' }).workspaces[wsId]!.cards[id]!.column).toBe('attention');
    expect(applyCardOutcome(state, 'pane-1', { kind: 'completed' }).workspaces[wsId]!.cards[id]!.column).toBe('done');
  });

  it('clears obsolete runtime identity and route when a routed card restarts', () => {
    let { state, wsId, id } = newCard();
    state = updateCard(state, wsId, id, { agent: 'codex', codexSessionId: 'old', route: { modelId: 'fast', model: 'old', provider: 'openai', complexity: 'simple', reason: 'old' } });
    state = markStarted(state, wsId, id, 'pane-new');
    expect(state.workspaces[wsId]!.cards[id]).toMatchObject({ paneId: 'pane-new', column: 'in-progress' });
    expect(state.workspaces[wsId]!.cards[id]!.codexSessionId).toBeUndefined();
    expect(state.workspaces[wsId]!.cards[id]!.route).toBeUndefined();
  });
});

describe('moveCard / updateCard / removeCard / cardsInColumn', () => {
  it('supports manual placement, edits, deletion and column queries', () => {
    let { state, wsId, id } = newCard('one');
    const second = createCard(state, wsId, { title: 'two', description: 'd', cwd: '/tmp' });
    state = second.state;

    state = updateCard(state, wsId, id, { title: 'renamed' });
    expect(state.workspaces[wsId]!.cards[id]!.title).toBe('renamed');

    state = moveCard(state, wsId, id, 'done');
    expect(cardsInColumn(state.workspaces[wsId]!, 'done').map((c) => c.id)).toEqual([id]);
    expect(cardsInColumn(state.workspaces[wsId]!, 'backlog').map((c) => c.id)).toEqual([second.id]);

    state = removeCard(state, wsId, id);
    expect(state.workspaces[wsId]!.cardOrder).toEqual([second.id]);
    expect(state.workspaces[wsId]!.cards[id]).toBeUndefined();
  });
});
