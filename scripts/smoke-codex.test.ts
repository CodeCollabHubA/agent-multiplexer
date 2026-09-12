import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { buildSmokeSpawnMessage, createExaEvidence, stopChild } from './smoke-codex.mjs';

const execFileAsync = promisify(execFile);

describe('smoke-codex', () => {
  it('reports a skipped live check without credentials', async () => {
    const env = { ...process.env };
    delete env.OPENROUTER_API_KEY;
    delete env.OPEN_ROUTER_API_KEY;
    delete env.EXA_API_KEY;
    const { stdout, stderr } = await execFileAsync(process.execPath, ['scripts/smoke-codex.mjs', '--live'], { cwd: process.cwd(), env });
    expect(stderr).toBe('');
    expect(stdout).toContain('SKIPPED: live Codex smoke requires OPENROUTER_API_KEY and EXA_API_KEY');
    expect(stdout).not.toContain('PASS');
  });

  it('uses Auto routing without assuming a configured model ID', () => {
    expect(buildSmokeSpawnMessage('/tmp/repo')).not.toHaveProperty('modelId');
  });

  it('does not accept Stop without an Exa tool invocation', () => {
    const evidence = createExaEvidence();
    evidence.push('Here is the source: https://nodejs.org/docs/latest/api/');
    expect(evidence.result()).toEqual({ toolInvoked: false, sourceUrl: undefined });
  });

  it('does not treat Exa startup readiness as a tool invocation', () => {
    const evidence = createExaEvidence();
    evidence.push('MCP tool agent_mux_exa ready at https://mcp.exa.ai/mcp\n');
    evidence.push('Answer: https://nodejs.org/docs/latest/api/');
    expect(evidence.result()).toEqual({ toolInvoked: false, sourceUrl: undefined });
  });

  it('does not accept a URL before Exa tool evidence', () => {
    const evidence = createExaEvidence();
    evidence.push('https://nodejs.org/docs/latest/api/\n');
    evidence.push('Called agent_mux_exa.search with the requested query');
    expect(evidence.result()).toEqual({ toolInvoked: true, sourceUrl: undefined });
  });

  it('accepts a source URL emitted after credible Exa tool evidence', () => {
    const evidence = createExaEvidence();
    evidence.push('• Called agent_mux_exa.search {"query":"Node.js docs"}\n');
    evidence.push('Result: https://nodejs.org/docs/latest/api/');
    expect(evidence.result()).toEqual({ toolInvoked: true, sourceUrl: 'https://nodejs.org/docs/latest/api/' });
  });

  it('waits for graceful child shutdown', async () => {
    const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: string | null; kill: (signal: string) => boolean };
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      expect(signal).toBe('SIGTERM');
      queueMicrotask(() => { child.exitCode = 0; child.emit('close', 0, null); });
      return true;
    };
    await stopChild(child, 50);
    expect(child.exitCode).toBe(0);
  });

  it('escalates a stuck child after the grace period', async () => {
    const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: string | null; kill: (signal: string) => boolean };
    const signals: string[] = [];
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      signals.push(signal);
      if (signal === 'SIGKILL') queueMicrotask(() => { child.signalCode = signal; child.emit('close', null, signal); });
      return true;
    };
    await stopChild(child, 5);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});
