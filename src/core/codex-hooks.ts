import { shellEscape } from './launch.js';

export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'Interrupt',
  'SessionEnd',
] as const;

/** RFC 4122/9562 UUIDs, including the UUIDv7 IDs emitted by current Codex. */
export const CODEX_SESSION_ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export type CodexHookEventName = (typeof CODEX_HOOK_EVENTS)[number];
export type CodexLifecycleState = 'idle' | 'running' | 'waiting' | 'interrupted' | 'exited';

export function codexEventState(event: CodexHookEventName): CodexLifecycleState {
  switch (event) {
    case 'SessionStart':
    case 'Stop': return 'idle';
    case 'UserPromptSubmit':
    case 'PostToolUse': return 'running';
    case 'PermissionRequest': return 'waiting';
    case 'Interrupt': return 'interrupted';
    case 'SessionEnd': return 'exited';
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** Invocation-scoped hook overrides accepted by `codex --strict-config -c`. */
export function codexHookConfigEntries(nodePath: string, scriptPath: string): string[] {
  const command = `${shellEscape(nodePath)} ${shellEscape(scriptPath)}`;
  return CODEX_HOOK_EVENTS.map((event) =>
    `hooks.${event}=[{hooks=[{type="command",command=${tomlString(command)},timeout=5}]}]`,
  );
}

/** Stable profile helper. It emits no prompt, tool, or assistant payload data. */
export function codexHookScriptSource(): string {
  return `#!/usr/bin/env node
import { openSync, writeSync, closeSync } from 'node:fs';
const allowed = new Set(${JSON.stringify(CODEX_HOOK_EVENTS)});
const sessionId = new RegExp(${JSON.stringify(CODEX_SESSION_ID_PATTERN)}, 'i');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(raw);
    const event = payload.hook_event_name;
    const id = payload.session_id;
    if (allowed.has(event) && typeof id === 'string' && sessionId.test(id)) {
      const fd = openSync('/dev/tty', 'w');
      writeSync(fd, '\\x1b]777;codex;' + event + ';' + id + '\\x07');
      closeSync(fd);
    }
  } catch { /* malformed payload or no controlling terminal */ }
  process.exit(0);
});
`;
}
