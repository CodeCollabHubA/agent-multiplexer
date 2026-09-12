import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from './store.js';
import { createWorkspace } from '../core/workspace.js';
import { createCard, markStarted, updateCard } from '../core/board.js';
import { emptyState } from '../core/models.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('FileStore routing compatibility', () => {
  it('round-trips optional Codex route fields and treats absent agent as legacy Devin', () => {
    const root = mkdtempSync(join(tmpdir(), 'mux-store-')); roots.push(root);
    const store = new FileStore(root);
    let state = createWorkspace(emptyState(), 'app', '/tmp');
    const wsId = state.activeWorkspaceId!;
    const created = createCard(state, wsId, { title: 'route', description: 'task', cwd: '/tmp' });
    state = markStarted(created.state, wsId, created.id, 'pane-1');
    state = updateCard(state, wsId, created.id, { agent: 'codex', modelId: 'capable', route: { modelId: 'capable', model: 'openai/gpt-6-astra', provider: 'openai', complexity: 'complex', reason: 'wide change' } });
    store.save(state);
    const card = store.load().workspaces[wsId]!.cards[created.id]!;
    expect(card).toMatchObject({ agent: 'codex', modelId: 'capable', route: { model: 'openai/gpt-6-astra' } });

    const legacy = { ...card } as any; delete legacy.agent; delete legacy.route; delete legacy.modelId;
    state = updateCard(state, wsId, created.id, { ...legacy, agent: undefined, route: undefined, modelId: undefined });
    expect(state.workspaces[wsId]!.cards[created.id]!.agent ?? 'devin').toBe('devin');
  });
});
