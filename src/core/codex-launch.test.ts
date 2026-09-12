import { describe, expect, it } from 'vitest';
import { buildCodexArgs, buildCodexLaunch } from './codex-launch.js';

describe('buildCodexArgs', () => {
  it('builds a fresh interactive launch from structured arguments', () => {
    expect(buildCodexArgs({ model: 'openai/gpt-5.6-sol', configEntries: ['x=1'], prompt: 'fix it' })).toEqual([
      'codex', '--strict-config', '--no-alt-screen', '--sandbox', 'workspace-write', '--ask-for-approval', 'on-request', '-m', 'openai/gpt-5.6-sol', '-c', 'x=1', '--', 'fix it',
    ]);
  });

  it('places the session id after the resume subcommand', () => {
    expect(buildCodexArgs({ model: 'm', resumeSessionId: '123e4567-e89b-12d3-a456-426614174000', prompt: 'continue' })).toEqual([
      'codex', '--strict-config', '--no-alt-screen', '--sandbox', 'workspace-write', '--ask-for-approval', 'on-request', '-m', 'm', 'resume', '123e4567-e89b-12d3-a456-426614174000', '--', 'continue',
    ]);
  });

  it('quotes shell metacharacters only when rendering the shell command', () => {
    const command = buildCodexLaunch({ model: 'x; echo bad', prompt: "$(touch /tmp/no) 'quoted'" });
    expect(command).toBe("codex --strict-config --no-alt-screen --sandbox workspace-write --ask-for-approval on-request -m 'x; echo bad' -- '$(touch /tmp/no) '\\''quoted'\\'''");
  });

  it.each([undefined, '123e4567-e89b-12d3-a456-426614174000'])('separates a leading-hyphen prompt when resume id is %s', (resumeSessionId) => {
    const args = buildCodexArgs({ model: 'm', resumeSessionId, prompt: '--help' });
    expect(args.slice(-2)).toEqual(['--', '--help']);
  });

  it('does not add Devin flags or secret values', () => {
    const args = buildCodexArgs({ model: 'openai/gpt-5.6-sol', configEntries: ['model_providers.openrouter.env_key="OPENROUTER_API_KEY"', 'mcp_servers.agent_mux_exa.env_http_headers={"x-api-key"="EXA_API_KEY"}'] });
    expect(args.join(' ')).toContain('OPENROUTER_API_KEY');
    expect(args.join(' ')).toContain('EXA_API_KEY');
    expect(args.join(' ')).not.toContain('--export');
    expect(args.join(' ')).not.toContain('--permission-mode');
    expect(args.join(' ')).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
});

it.each([undefined, 'saved-session'])('skips approvals only with explicit opt-in, retaining sandbox and hook trust (%s)', (resumeSessionId) => {
  const args = buildCodexArgs({ model: 'm', skipApprovals: true, resumeSessionId });
  expect(args.slice(args.indexOf('--ask-for-approval'), args.indexOf('--ask-for-approval') + 2)).toEqual(['--ask-for-approval', 'never']);
  expect(args).toContain('workspace-write');
  expect(args.join(' ')).not.toContain('--dangerously-bypass');
  expect(buildCodexLaunch({ model: 'm', skipApprovals: true })).toContain('--ask-for-approval never');
});
