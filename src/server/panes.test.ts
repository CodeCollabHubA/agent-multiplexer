import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakePty {
  data?: (data: string) => void;
  exit?: (event: { exitCode: number }) => void;
  kill = vi.fn(); write = vi.fn(); resize = vi.fn();
  onData(callback: (data: string) => void) { this.data = callback; }
  onExit(callback: (event: { exitCode: number }) => void) { this.exit = callback; }
}
const { spawned, spawnMock } = vi.hoisted(() => {
  const spawned: Array<{ data?: (data: string) => void; exit?: (event: { exitCode: number }) => void }> = [];
  return { spawned, spawnMock: vi.fn(() => { const pty = new FakePty(); spawned.push(pty); return pty; }) };
});
vi.mock('node-pty', () => ({ spawn: spawnMock }));

import { FileStore } from './store.js';
import { PaneSupervisor } from './panes.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pane-codex-')); spawned.length = 0; spawnMock.mockClear(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });

function supervisor() {
  return new PaneSupervisor(new FileStore(root), { onData: vi.fn(), onSignal: vi.fn(), onCodexEvent: vi.fn(), onExit: vi.fn() });
}

describe('PaneSupervisor Codex adapter', () => {
  it('launches Codex without Devin config/export flags and keeps keys out of argv', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'secret-router');
    vi.stubEnv('EXA_API_KEY', 'secret-exa');
    const panes = supervisor();
    panes.spawn({ paneId: 'p', cwd: root, cols: 80, rows: 24, agent: 'codex', model: 'openai/gpt-5.6-sol', permissionMode: 'accept-edits', prompt: 'hello' });
    const shellArgs = (spawnMock.mock.calls as unknown[][])[0]?.[1] as string[];
    expect((spawnMock.mock.calls as unknown[][])[0]?.[0]).toBe('codex');
    const command = 'codex ' + shellArgs.join(' ');
    expect(command).toContain('codex --strict-config --no-alt-screen');
    expect(command).toContain('--sandbox workspace-write --ask-for-approval on-request');
    expect(command).not.toContain('--export');
    expect(command).not.toContain('--permission-mode');
    expect(command).not.toContain('secret-router');
    expect(command).not.toContain('secret-exa');
    expect(command).toContain(process.execPath);
  });

  it('routes Codex OSC only to onCodexEvent', () => {
    const onSignal = vi.fn(); const onCodexEvent = vi.fn();
    const panes = new PaneSupervisor(new FileStore(root), { onData: vi.fn(), onSignal, onCodexEvent, onExit: vi.fn() });
    panes.spawn({ paneId: 'p', cwd: root, cols: 80, rows: 24, agent: 'codex', model: 'm', permissionMode: 'accept-edits' });
    spawned[0]?.data?.('\x1b]777;codex;SessionStart;123e4567-e89b-12d3-a456-426614174000\x07');
    expect(onCodexEvent).toHaveBeenCalledWith('p', { kind: 'codex', event: 'SessionStart', codexSessionId: '123e4567-e89b-12d3-a456-426614174000' });
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('does not let an old exit callback delete a restarted pane', () => {
    const panes = supervisor();
    const options = { paneId: 'p', cwd: root, cols: 80, rows: 24, shellOnly: true, permissionMode: 'accept-edits' as const };
    panes.spawn(options);
    panes.spawn(options);
    spawned[0]?.exit?.({ exitCode: 0 });
    expect(panes.has('p')).toBe(true);
    expect(panes.snapshot('p') ?? '').not.toContain('[process exited');
  });
});

it('ignores every stale data callback after kill or replacement', () => {
  const handlers = { onData: vi.fn(), onSignal: vi.fn(), onCodexEvent: vi.fn(), onExit: vi.fn() };
  const panes = new PaneSupervisor(new FileStore(root), handlers);
  const opts = { paneId: 'p', cwd: root, cols: 80, rows: 24, agent: 'codex' as const, model: 'm', permissionMode: 'accept-edits' as const };
  panes.spawn(opts);
  panes.kill('p');
  const late = '\x1b]777;codex;Stop;123e4567-e89b-12d3-a456-426614174000\x07late';
  spawned[0]?.data?.(late);
  panes.spawn(opts);
  spawned[0]?.data?.(late);
  expect(handlers.onCodexEvent).not.toHaveBeenCalled();
  expect(handlers.onData).not.toHaveBeenCalled();
  expect(panes.snapshot('p') ?? '').not.toContain('late');
});

it('forwards the alias as the canonical credential only in child environment', () => {
  vi.stubEnv('OPENROUTER_API_KEY', undefined);
  vi.stubEnv('OPEN_ROUTER_API_KEY', 'alias-only-secret');
  const panes = supervisor();
  panes.spawn({ paneId: 'alias', cwd: root, cols: 80, rows: 24, agent: 'codex', model: 'm', permissionMode: 'accept-edits' });
  const call = (spawnMock.mock.calls as unknown[][])[0]!;
  expect((call[2] as {env: Record<string, string>}).env.OPENROUTER_API_KEY).toBe('alias-only-secret');
  expect(JSON.stringify(call[1])).not.toContain('alias-only-secret');
  vi.unstubAllEnvs();
});

it('forwards per-agent skip-approval choice to the native Codex process', () => {
  supervisor().spawn({ paneId: 'p', cwd: root, cols: 80, rows: 24, agent: 'codex', model: 'm', permissionMode: 'accept-edits', skipApprovals: true });
  const args = (spawnMock.mock.calls as unknown[][])[0]?.[1] as string[];
  expect(args.join(' ')).toContain('--sandbox workspace-write --ask-for-approval never');
  expect(args.join(' ')).not.toContain('--dangerously-bypass');
});
