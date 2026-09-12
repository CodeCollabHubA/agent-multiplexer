import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const { auth } = vi.hoisted(() => ({ auth: { isAuthenticated: false, isLoading: false } }));
vi.mock('convex/react', () => ({ useConvexAuth: () => auth, useConvex: vi.fn(), useQuery: () => undefined }));
import { ConvexAuthGate, pendingInvite, randomToken, runnerIsOnline } from './Workspaces.js';
import { Backend, authenticatedTransport } from './backend.js';

describe('authenticated workspace boundary', () => {
  it('does not mount workspace queries until Convex has authenticated', () => {
    expect(renderToStaticMarkup(<ConvexAuthGate>PRIVATE</ConvexAuthGate>)).not.toContain('PRIVATE');
    auth.isLoading = true;
    expect(renderToStaticMarkup(<ConvexAuthGate>PRIVATE</ConvexAuthGate>)).toContain('Connecting');
    auth.isLoading = false; auth.isAuthenticated = true;
    expect(renderToStaticMarkup(<ConvexAuthGate>PRIVATE</ConvexAuthGate>)).toContain('PRIVATE');
  });
  it('uses 256 bits of browser randomness in URL-safe bearer tokens', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
  });
  it('marks missing and stale runner presence offline', () => {
    expect(runnerIsOnline(null, 100_000)).toBe(false);
    expect(runnerIsOnline({ lastSeen: 1 }, 100_000)).toBe(false);
    expect(runnerIsOnline({ lastSeen: 99_000 }, 100_000)).toBe(true);
  });
});
describe('workspace transport isolation', () => {
  it('adapts official query watches and unregisters every watch on disposal', () => {
    const off = vi.fn();
    const watchQuery = vi.fn(() => ({ onUpdate: vi.fn(() => off), localQueryResult: () => undefined }));
    const close = vi.fn();
    const client = { watchQuery, mutation: vi.fn(), close };
    const backend = new Backend({ client: authenticatedTransport(client as any), profileKey: 'private-a' });
    expect(watchQuery).toHaveBeenCalledTimes(4);
    for (const call of watchQuery.mock.calls as unknown[][]) expect(call[1]).toEqual({ profileKey: 'private-a' });
    backend.dispose(); backend.dispose();
    expect(off).toHaveBeenCalledTimes(4);
    expect(close).not.toHaveBeenCalled();
    const listener = vi.fn(); backend.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
  });
});

it('surfaces query failures and ignores callbacks after disposal', () => {
  const callbacks: ((value: unknown) => void)[] = [];
  let report: ((error: Error) => void) | undefined;
  const onError = vi.fn();
  const backend = new Backend({ profileKey: 'a', onError, client: {
    mutation: vi.fn(),
    onUpdate: (_name, _args, callback, error) => { callbacks.push(callback); report = error; return () => {}; },
  } });
  const listener = vi.fn(); backend.subscribe(listener);
  report?.(new Error('Membership removed'));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Membership removed' }));
  backend.dispose();
  callbacks[1]!({ home: '/secret', cwd: '/secret' });
  expect(listener).not.toHaveBeenCalled();
});


afterEach(() => vi.unstubAllGlobals());
it('preserves an invitation across the login callback clearing the URL', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('window', { location: { search: '?invite=single-use-token' } });
  expect(pendingInvite()).toBe('single-use-token');
  window.location.search = '';
  expect(pendingInvite()).toBe('single-use-token');
});
it('still returns the invitation for Auth0 appState when storage is blocked', () => {
  vi.stubGlobal('sessionStorage', { setItem: () => { throw new Error('blocked'); } });
  vi.stubGlobal('window', { location: { search: '?invite=single-use-token' } });
  expect(pendingInvite()).toBe('single-use-token');
});
it('cancels queued commands before switching workspaces', () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  const mutation = vi.fn();
  const backend = new Backend({ profileKey: 'old-workspace', client: { mutation, onUpdate: () => () => {} } });
  backend.send({ t: 'config:get', reqId: 'test' });
  backend.dispose();
  vi.runAllTimers();
  expect(mutation).not.toHaveBeenCalled();
  vi.useRealTimers();
});
