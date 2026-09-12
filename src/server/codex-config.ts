import { codexHookConfigEntries } from '../core/codex-hooks.js';

export interface CodexConfigOptions {
  nodePath: string;
  scriptPath: string;
  exaEnabled: boolean;
}

export function buildCodexConfigEntries(options: CodexConfigOptions): string[] {
  const entries = codexHookConfigEntries(options.nodePath, options.scriptPath);
  entries.push('model_provider="openrouter"');
  entries.push('model_providers.openrouter={name="OpenRouter",base_url="https://openrouter.ai/api/v1",env_key="OPENROUTER_API_KEY",wire_api="responses"}');
  if (options.exaEnabled) {
    entries.push('mcp_servers.agent_mux_exa={url="https://mcp.exa.ai/mcp",env_http_headers={"x-api-key"="EXA_API_KEY"}}');
  }
  return entries;
}
