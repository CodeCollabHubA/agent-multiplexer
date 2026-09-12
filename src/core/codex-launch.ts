import { shellEscape } from './launch.js';

export interface CodexLaunchOptions {
  model: string;
  skipApprovals?: boolean;
  prompt?: string;
  resumeSessionId?: string;
  configEntries?: string[];
}

/** Structured argv for an interactive Codex TUI. Values remain unquoted here. */
export function buildCodexArgs(options: CodexLaunchOptions): string[] {
  const args = [
    'codex', '--strict-config', '--no-alt-screen',
    '--sandbox', 'workspace-write', '--ask-for-approval', options.skipApprovals === true ? 'never' : 'on-request',
    '-m', options.model,
  ];
  for (const entry of options.configEntries ?? []) args.push('-c', entry);
  if (options.resumeSessionId) args.push('resume', options.resumeSessionId);
  if (options.prompt !== undefined) args.push('--', options.prompt);
  return args;
}

/** Render structured argv for the existing login-shell PTY boundary. */
export function buildCodexLaunch(options: CodexLaunchOptions): string {
  const parts = [
    'codex', '--strict-config', '--no-alt-screen',
    '--sandbox', 'workspace-write', '--ask-for-approval', options.skipApprovals === true ? 'never' : 'on-request',
    '-m', shellEscape(options.model),
  ];
  for (const entry of options.configEntries ?? []) parts.push('-c', shellEscape(entry));
  if (options.resumeSessionId) parts.push('resume', shellEscape(options.resumeSessionId));
  if (options.prompt !== undefined) parts.push('--', shellEscape(options.prompt));
  return parts.join(' ');
}
