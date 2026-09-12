import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runnerConfiguration, runnerStoreRoot, allowLocalSocket } from './runner-config.js';
import { FileStore } from './store.js';
import { createWorkspace } from '../core/workspace.js';
import { emptyState } from '../core/models.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('fails closed on missing or partial pairing rather than using default/anonymous', () => {
  for (const env of [{ CONVEX_URL: 'https://test.convex.cloud' }, { CONVEX_URL: 'https://test.convex.cloud', CONVEX_PROFILE: 'p' }, { CONVEX_MACHINE_TOKEN: 'token', DEVIN_MUX_LOCAL_DEV: '1' }]) {
    expect(() => runnerConfiguration(env)).toThrow();
  }
  expect(runnerConfiguration({})).toEqual({ mode: 'local' });
  expect(runnerConfiguration({ CONVEX_URL: 'https://test.convex.cloud', CONVEX_PROFILE: 'secure', CONVEX_MACHINE_TOKEN: 'secret' })).toEqual({ mode: 'paired', url: 'https://test.convex.cloud', profileKey: 'secure', machineToken: 'secret' });
});
it('isolates paired stores from anonymous state and other shared workspaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'paired-store-')); roots.push(root);
  new FileStore(root).save(createWorkspace(emptyState(), 'private legacy project', '/tmp'));
  const a = new FileStore(runnerStoreRoot(root, { mode: 'paired', url: 'https://test.convex.cloud', profileKey: '../../private', machineToken: 'secret' }));
  a.save(createWorkspace(emptyState(), 'shared A', '/tmp'));
  const b = new FileStore(runnerStoreRoot(root, { mode: 'paired', url: 'https://test.convex.cloud', profileKey: 'another', machineToken: 'secret' }));
  expect(a.root.startsWith(join(root, 'shared-workspaces') + '/')).toBe(true);
  expect(b.load().workspaceOrder).toEqual([]);
  expect(new FileStore(root).load().workspaceOrder).toHaveLength(1);
});
it('rejects every local websocket when paired and foreign browser origins in local dev', () => {
  const paired = { mode: 'paired', url: 'https://test.convex.cloud', profileKey: 'secure', machineToken: 'secret' } as const;
  for (const origin of [undefined, 'http://localhost:5173', 'https://attacker.test']) expect(allowLocalSocket(paired, origin, '127.0.0.1')).toBe(false);
  for (const origin of ['https://attacker.test', 'null', 'http://localhost.attacker.test']) expect(allowLocalSocket({ mode: 'local' }, origin, '127.0.0.1')).toBe(false);
  expect(allowLocalSocket({ mode: 'local' }, 'http://localhost:5173', '127.0.0.1')).toBe(true);
  expect(allowLocalSocket({ mode: 'local' }, undefined, '127.0.0.1')).toBe(true);
  expect(allowLocalSocket({ mode: 'local' }, 'http://localhost:5173', '192.0.2.1')).toBe(false);
});
