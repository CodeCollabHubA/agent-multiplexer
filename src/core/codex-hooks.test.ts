import { describe, expect, it } from 'vitest';
import { CODEX_HOOK_EVENTS, CODEX_SESSION_ID_PATTERN, codexEventState, codexHookConfigEntries, codexHookScriptSource } from './codex-hooks.js';

describe('Codex hooks', () => {
  it('configures every supported lifecycle event with one stable command', () => {
    const entries = codexHookConfigEntries('/usr/bin/node', '/profile/hooks/codex-hook.mjs');
    expect(entries).toHaveLength(CODEX_HOOK_EVENTS.length);
    for (const event of CODEX_HOOK_EVENTS) expect(entries.some((entry) => entry.startsWith(`hooks.${event}=`))).toBe(true);
    expect(entries.every((entry) => entry.includes("command=\"'/usr/bin/node' '/profile/hooks/codex-hook.mjs'\""))).toBe(true);
  });

  it('shell-quotes executable and helper paths including apostrophes', () => {
    const entries = codexHookConfigEntries("/Applications/Codex App/node's", "/Users/me/My Hooks/codex's hook.mjs");
    const encoded = entries[0]?.match(/command=("(?:\\.|[^"\\])*")/)?.[1];
    expect(encoded).toBeDefined();
    expect(JSON.parse(encoded!)).toBe("'/Applications/Codex App/node'\\''s' '/Users/me/My Hooks/codex'\\''s hook.mjs'");
  });

  it('emits only validated identity and event metadata', () => {
    const source = codexHookScriptSource();
    expect(source).toContain('session_id');
    expect(source).toContain('hook_event_name');
    expect(source).not.toContain('prompt;');
    expect(source).not.toContain('last_assistant_message');
    expect(source).toContain('/dev/tty');
  });

  it('generates validation that accepts the UUIDv7 emitted by the installed CLI', () => {
    const observed = '01a094d0-195d-78a2-b8e7-357e4c972380';
    expect(new RegExp(CODEX_SESSION_ID_PATTERN, 'i').test(observed)).toBe(true);
    expect(codexHookScriptSource()).toContain(JSON.stringify(CODEX_SESSION_ID_PATTERN));
    expect(new RegExp(CODEX_SESSION_ID_PATTERN, 'i').test('01a094d0-195d-78a2-78e7-357e4c972380')).toBe(false);
  });

  it('maps hook names to their observable lifecycle state', () => {
    expect(CODEX_HOOK_EVENTS.map(codexEventState)).toEqual([
      'idle', 'running', 'waiting', 'running', 'idle', 'interrupted', 'exited',
    ]);
  });
});
