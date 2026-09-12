import { describe, expect, it, vi } from 'vitest';
import { LaunchCoordinator } from './launch-coordinator.js';
import { DEMO_ROUTING_CONFIG } from '../core/routing.js';

const request = { t: 'pane:spawn' as const, paneId: 'p1', cwd: '/tmp', cols: 80, rows: 24, agent: 'codex' as const, permissionMode: 'accept-edits' as const, prompt: 'Build it' };

describe('LaunchCoordinator', () => {
  it('rejects duplicate starts while classification is pending', async () => {
    let resolve!: (value: any) => void;
    const route = vi.fn(() => new Promise<any>((r) => { resolve = r; }));
    const spawn = vi.fn(() => ({}));
    const send = vi.fn();
    const coordinator = new LaunchCoordinator({ config: DEMO_ROUTING_CONFIG, apiKey: 'key', route, spawn });
    const first = coordinator.start(request, send);
    await coordinator.start(request, send);
    expect(route).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'pane:error' }));
    resolve({ modelId: 'fast', model: 'openai/x', provider: 'openai', complexity: 'simple', reason: 'small' });
    await first;
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('makes a delayed classifier result inert after kill', async () => {
    let resolve!: (value: any) => void;
    const route = vi.fn(() => new Promise<any>((r) => { resolve = r; }));
    const spawn = vi.fn();
    const coordinator = new LaunchCoordinator({ config: DEMO_ROUTING_CONFIG, apiKey: 'key', route, spawn });
    const pending = coordinator.start(request, vi.fn());
    coordinator.cancel('p1');
    resolve({ modelId: 'fast', model: 'openai/x', provider: 'openai', complexity: 'simple', reason: 'small' });
    await pending;
    expect(spawn).not.toHaveBeenCalled();
  });

  it('uses the standard tier for an empty interactive Codex pane', async () => {
    const spawn = vi.fn(() => ({}));
    const send = vi.fn();
    const coordinator = new LaunchCoordinator({ config: DEMO_ROUTING_CONFIG, apiKey: 'key', route: vi.fn(), spawn });
    await coordinator.start({ ...request, prompt: undefined }, send);
    expect((spawn.mock.calls as any)[0][0].route).toMatchObject({ modelId: 'balanced', complexity: 'standard' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ t: 'pane:route', paneId: 'p1' }));
  });

  it('rejects resume when a saved model id now resolves to a different slug', async () => {
    const spawn = vi.fn();
    const send = vi.fn();
    const coordinator = new LaunchCoordinator({ config: DEMO_ROUTING_CONFIG, apiKey: 'key', spawn });
    await coordinator.start({ ...request, route: { modelId: 'fast', model: 'openai/removed', provider: 'openai', complexity: 'simple', reason: 'saved' }, resumeSessionId: '550e8400-e29b-41d4-a716-446655440000' }, send);
    expect(spawn).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ t: 'pane:error', error: expect.stringContaining('no longer available') }));
  });
});

it('does not replace an already live process', async () => {
  const spawn = vi.fn(() => ({})); let live = false;
  const coordinator = new LaunchCoordinator({ config: DEMO_ROUTING_CONFIG, apiKey: 'key', has: () => live, spawn: (o) => { live = true; return spawn(); } });
  const send = vi.fn();
  await coordinator.start({ ...request, prompt: undefined }, send);
  await coordinator.start(request, send);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'pane:error' }));
});
it.each(['devin', 'shell'])('contains %s launch exceptions', async (agent) => {
  const send = vi.fn();
  const coordinator = new LaunchCoordinator({ config: null, apiKey: '', spawn: () => { throw new Error('spawn failed'); } });
  await expect(coordinator.start({ ...request, agent: 'devin', shellOnly: agent === 'shell' }, send)).resolves.toBeUndefined();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ t: 'pane:error', error: 'spawn failed' }));
});
