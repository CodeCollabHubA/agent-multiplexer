import { describe, expect, it } from 'vitest';
import { buildCodexConfigEntries } from './codex-config.js';

describe('buildCodexConfigEntries', () => {
  it('configures OpenRouter and Exa with environment variable names only', () => {
    const entries = buildCodexConfigEntries({ nodePath: '/node', scriptPath: '/hook.mjs', exaEnabled: true });
    expect(entries.join('\n')).toContain('https://openrouter.ai/api/v1');
    expect(entries.join('\n')).toContain('env_key="OPENROUTER_API_KEY"');
    expect(entries.join('\n')).toContain('https://mcp.exa.ai/mcp');
    expect(entries.join('\n')).toContain('env_http_headers={"x-api-key"="EXA_API_KEY"}');
    expect(entries.join('\n')).toContain('mcp_servers.agent_mux_exa');
  });

  it('always declares OpenRouter but omits Exa when its key is absent', () => {
    const entries = buildCodexConfigEntries({ nodePath: '/node', scriptPath: '/hook.mjs', exaEnabled: false });
    expect(entries.join('\n')).toContain('model_providers.openrouter');
    expect(entries.join('\n')).not.toContain('mcp_servers.agent_mux_exa');
    expect(entries.join('\n')).toContain('hooks.SessionStart');
  });
});
