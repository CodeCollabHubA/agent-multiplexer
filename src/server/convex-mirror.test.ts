import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from './store.js';
import { createWorkspace } from '../core/workspace.js';
import { emptyState } from '../core/models.js';
const service = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: any }>,
  rows: [] as Array<{ commandId: string; message: string }>,
  subscription: undefined as undefined | ((rows: any[]) => void),
  revoked: false,
  token: 'machine-secret',
  state: null as any,
}));
vi.mock('convex/browser', () => {
  const check = (name: string, args: any) => {
    service.calls.push({ name, args });
    if (service.revoked || args.profileKey !== 'space-a' || args.machineToken !== service.token) throw new Error('Unauthorized');
  };
  return {
    ConvexClient: class {
      async mutation(name: string, args: any) { check(name, args); return null; }
      onUpdate(name: string, args: any, callback: (rows: any[]) => void) { check(name, args); service.subscription = callback; return () => {}; }
      async close() {}
    },
    ConvexHttpClient: class {
      async query(name: string, args: any) { check(name, args); return name === 'mux:pullState' ? service.state : service.rows; }
    },
  };
});
import { ConvexMirror } from './convex-mirror.js';
let mirror: ConvexMirror | undefined;
beforeEach(() => {
  vi.useFakeTimers(); service.token = 'machine-secret'; service.calls = []; service.rows = []; service.revoked = false; service.subscription = undefined;
  vi.stubEnv('CONVEX_PROFILE', 'space-a'); vi.stubEnv('CONVEX_MACHINE_TOKEN', 'machine-secret');
});
afterEach(() => { mirror?.close(); mirror = undefined; vi.useRealTimers(); vi.unstubAllEnvs(); });
it('authenticates startup and every runner operation, including pushState profile ownership', async () => {
  mirror = await ConvexMirror.create('https://test.convex.cloud');
  const executed: string[] = [];
  mirror.start(async (msg) => { executed.push(msg.t); });
  mirror.push(emptyState());
  mirror.publish({ t: 'pane:data', paneId: 'p', data: 'hello' });
  mirror.publish({ t: 'pane:status', paneId: 'p', status: 'idle' });
  service.rows = [{ commandId: 'one', message: JSON.stringify({ t: 'config:get', reqId: 'req' }) }];
  service.subscription?.(service.rows);
  await vi.advanceTimersByTimeAsync(1100);
  expect(executed).toEqual(['config:get']);
  expect(service.calls.map(c => c.name)).toEqual(expect.arrayContaining(['mux:pendingCommands', 'mux:updateMachineStatus', 'mux:pushState', 'mux:appendOutput', 'mux:publishEvent', 'mux:acknowledgeCommands']));
  for (const { args } of service.calls) expect(args).toMatchObject({ profileKey: 'space-a', machineToken: 'machine-secret' });
});
it('rejects revoked credentials at startup instead of falling back to local mode', async () => {
  service.revoked = true;
  await expect(ConvexMirror.create('https://test.convex.cloud')).rejects.toThrow();
});
it('rechecks queued work after revocation before executing another command', async () => {
  mirror = await ConvexMirror.create('https://test.convex.cloud');
  const executed: string[] = [];
  mirror.start(async (msg) => { executed.push(msg.t); service.revoked = true; });
  service.rows = [
    { commandId: 'one', message: JSON.stringify({ t: 'config:get', reqId: 'one' }) },
    { commandId: 'two', message: JSON.stringify({ t: 'pane:spawn', paneId: 'danger' }) },
  ];
  service.subscription?.(service.rows);
  await vi.advanceTimersByTimeAsync(1);
  expect(executed).toEqual(['config:get']);
  expect(mirror.enabled).toBe(false);
});
it('does not execute stale rows removed from the current server queue', async () => {
  mirror = await ConvexMirror.create('https://test.convex.cloud');
  const executed: string[] = [];
  mirror.start(async (msg) => { executed.push(msg.t); });
  service.subscription?.([{ commandId: 'removed', message: '{"t":"pane:spawn"}' }]);
  await vi.advanceTimersByTimeAsync(1);
  expect(executed).toEqual([]);
});

it('hydrates a new paired store before it can push an empty state over existing boards', async () => {
  const root = mkdtempSync(join(tmpdir(), 'runner-hydrate-'));
  try {
    service.state = { profile: { storeVersion: 1, workspaceOrder: ['board'], activeWorkspaceId: 'board' }, workspaces: [{ workspaceId: 'board', name: 'Existing board', cwd: '/tmp', view: 'board', sessionOrder: [], layout: '{"type":"leaf","sessionId":null}', sessions: '{}', cards: '{}', cardOrder: [], updatedAt: 1 }] };
    mirror = await ConvexMirror.create('https://test.convex.cloud');
    const store = new FileStore(join(root, 'store'));
    await mirror.initializeStore(store);
    expect(store.load().workspaces.board?.name).toBe('Existing board');
    expect(service.calls.some(c => c.name === 'mux:updateMachineStatus')).toBe(false);
    mirror.push(store.load());
    await vi.advanceTimersByTimeAsync(1100);
    expect(service.calls.find(c => c.name === 'mux:pushState')?.args.workspaceOrder).toEqual(['board']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('preserves local authority when restarting with the same pairing credential', async () => {
  const root = mkdtempSync(join(tmpdir(), 'runner-existing-'));
  try {
    service.state = { profile: { storeVersion: 1, workspaceOrder: [] }, workspaces: [] };
    const store = new FileStore(join(root, 'store'));
    mirror = await ConvexMirror.create('https://test.convex.cloud');
    await mirror.initializeStore(store);
    store.save(createWorkspace(emptyState(), 'Local work', '/tmp'));
    mirror.close();
    service.calls = [];
    mirror = await ConvexMirror.create('https://test.convex.cloud');
    await mirror.initializeStore(store);
    expect(service.calls.some(c => c.name === 'mux:pullState')).toBe(false);
    expect(Object.values(store.load().workspaces)[0]?.name).toBe('Local work');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('restores newer cloud boards after re-pairing an old runner and preserves its prior snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'runner-repair-'));
  try {
    service.state = { profile: { storeVersion: 1, workspaceOrder: [] }, workspaces: [] };
    const store = new FileStore(join(root, 'store'));
    mirror = await ConvexMirror.create('https://test.convex.cloud');
    await mirror.initializeStore(store);
    const oldState = createWorkspace(emptyState(), 'Old runner A local work', '/tmp');
    store.save(oldState);
    mirror.close();
    service.token = 'rotated-machine-secret';
    vi.stubEnv('CONVEX_MACHINE_TOKEN', service.token);
    service.state = { profile: { storeVersion: 1, workspaceOrder: ['new-board'], activeWorkspaceId: 'new-board' }, workspaces: [{ workspaceId: 'new-board', name: 'Newer runner B work', cwd: '/tmp', view: 'board', sessionOrder: [], layout: '{"type":"leaf","sessionId":null}', sessions: '{}', cards: '{}', cardOrder: [], updatedAt: 2 }] };
    service.calls = [];
    mirror = await ConvexMirror.create('https://test.convex.cloud');
    await mirror.initializeStore(store);
    expect(store.load().workspaces['new-board']?.name).toBe('Newer runner B work');
    const backups = readdirSync(root).filter(name => name.startsWith('store.backup-'));
    expect(backups.some(name => Object.values(new FileStore(join(root, name)).load().workspaces).some(ws => ws.name === 'Old runner A local work'))).toBe(true);
    const marker = readFileSync(join(store.root, '.machine-credential.sha256'), 'utf8');
    expect(marker.trim()).toMatch(/^[a-f0-9]{64}$/);
    expect(marker).not.toContain(service.token);
    mirror.push(store.load());
    await vi.advanceTimersByTimeAsync(1100);
    expect(service.calls.find(c => c.name === 'mux:pushState')?.args.workspaceOrder).toEqual(['new-board']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
