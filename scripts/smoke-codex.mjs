#!/usr/bin/env node
/** Opt-in live smoke for the real app Codex/OpenRouter/Exa launch path. */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const LIVE_FLAG = '--live';
const TIMEOUT_MS = 90_000;
const SERVER_STOP_MS = 2_000;

export function buildSmokeSpawnMessage(repo) {
  return {
    t: 'pane:spawn', paneId: 'codex-smoke', cwd: repo, cols: 100, rows: 30,
    agent: 'codex', permissionMode: 'accept-edits',
    title: 'Bounded Codex and Exa smoke check',
    prompt: 'Use the Exa MCP tool exactly once to find the official Node.js documentation homepage. Reply with one source URL and one short sentence. Do not create or edit files.',
  };
}

/** Terminal evidence is intentionally stricter than seeing an MCP name or URL. */
export function createExaEvidence() {
  let tail = '';
  let toolInvoked = false;
  let sourceUrl;
  return {
    push(chunk) {
      const clean = String(chunk).replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '');
      tail = (tail + clean).slice(-16_384);
      if (!toolInvoked) {
        const patterns = [
          /\b(?:called|calling|invoked|invoking)\b[^\r\n]{0,160}\bagent_mux_exa(?:[.:/][\w-]+)?\b/i,
          /\bagent_mux_exa(?:[.:/][\w-]+)?\b[^\r\n]{0,160}\b(?:called|calling|invoked|invoking)\b/i,
        ];
        const match = patterns.map((pattern) => ({ match: pattern.exec(tail), pattern })).find(({ match }) => match);
        if (match?.match) {
          toolInvoked = true;
          tail = tail.slice(match.match.index + match.match[0].length);
        }
      }
      if (toolInvoked && !sourceUrl) {
        const urls = tail.match(/https?:\/\/[^\s<>"'\])}]+/g) ?? [];
        sourceUrl = urls.find((url) => !/^https?:\/\/(?:mcp\.exa\.ai|openrouter\.ai)(?:\/|$)/i.test(url));
      }
    },
    result: () => ({ toolInvoked, sourceUrl }),
  };
}

export async function stopChild(child, graceMs = SERVER_STOP_MS) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveClose) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolveClose(); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      const forceTimer = setTimeout(finish, graceMs);
      forceTimer.unref?.();
    }, graceMs);
    timer.unref?.();
    child.once('close', finish);
    try { child.kill('SIGTERM'); } catch { finish(); }
  });
}

async function main() {
  if (!process.argv.includes(LIVE_FLAG)) {
    console.log('SKIPPED: live Codex smoke is opt-in; rerun with --live (may incur OpenRouter and Exa charges)');
    return 0;
  }
  if (process.env.OPENROUTER_API_KEY === undefined && process.env.OPEN_ROUTER_API_KEY !== undefined) {
    process.env.OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;
  }
  const missing = ['OPENROUTER_API_KEY', 'EXA_API_KEY'].filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.log(`SKIPPED: live Codex smoke requires OPENROUTER_API_KEY and EXA_API_KEY; missing ${missing.join(', ')}`);
    return 0;
  }
  for (const command of ['git', 'codex']) {
    try { execFileSync(command, ['--version'], { stdio: 'ignore' }); }
    catch { console.log(`SKIPPED: live Codex smoke requires ${command} on PATH`); return 0; }
  }

  const scratch = mkdtempSync(join(tmpdir(), 'agent-mux-codex-smoke-'));
  const repo = join(scratch, 'repo');
  const appProfile = join(scratch, 'app-profile');
  const codexHome = join(scratch, 'codex-home');
  const evidence = createExaEvidence();
  let server;
  let ws;
  let timer;
  let rawMode = false;
  let cleanupPromise;

  const cleanup = (code) => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      clearTimeout(timer);
      if (rawMode) { process.stdin.setRawMode(false); rawMode = false; }
      process.stdin.pause();
      if (ws) await new Promise((done) => {
        const fallback = setTimeout(done, 250);
        ws.once('close', () => { clearTimeout(fallback); done(); });
        try { ws.close(); } catch { clearTimeout(fallback); done(); }
      });
      await stopChild(server);
      rmSync(scratch, { recursive: true, force: true });
      return code;
    })();
    return cleanupPromise;
  };

  let resolveResult;
  const result = new Promise((resolveResultPromise) => { resolveResult = resolveResultPromise; });
  const finish = (code) => void cleanup(code).then(resolveResult);
  process.once('SIGINT', () => finish(130));
  process.once('SIGTERM', () => finish(143));

  try {
    for (const dir of [repo, appProfile, codexHome]) mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '--quiet', repo]);
    const port = await new Promise((resolvePort, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => resolvePort(address.port));
      });
    });
    server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, PORT: String(port), DEVIN_MUX_HOME: appProfile, CODEX_HOME: codexHome, CONVEX_URL: '', VITE_CONVEX_URL: '' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await new Promise((resolveOpen, reject) => {
      const deadline = Date.now() + 10_000;
      const connect = () => {
        ws = new WebSocket(`ws://127.0.0.1:${port}/pty`);
        ws.once('open', resolveOpen);
        ws.once('error', () => {
          ws.close();
          if (Date.now() >= deadline) reject(new Error('server readiness timeout'));
          else setTimeout(connect, 100);
        });
      };
      connect();
    });

    console.log('LIVE: temporary repository, app profile, and CODEX_HOME created (90-second limit).');
    console.log('Review repository and hook trust prompts normally. No trust bypass is used.');
    console.log('PASS requires Auto classification, a trusted Stop hook, visible Exa tool invocation, and a later source URL.');
    if (process.stdin.isTTY) { process.stdin.setRawMode(true); rawMode = true; }
    process.stdin.resume();
    process.stdin.on('data', (data) => ws?.send(JSON.stringify({ t: 'pane:input', paneId: 'codex-smoke', data: data.toString() })));
    ws.on('message', (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.t === 'pane:data') { process.stdout.write(message.data); evidence.push(message.data); }
      if (message.t === 'pane:error') {
        console.log('\nFAILED: the app reported a launch error (credential values were not printed).');
        finish(1);
      }
      if (message.t === 'pane:outcome' && message.outcome === 'completed') {
        const observed = evidence.result();
        if (!observed.toolInvoked || !observed.sourceUrl) {
          console.log('\nNOT VERIFIED: trusted Stop observed, but terminal evidence did not show both an Exa tool invocation and a later source URL.');
          finish(1);
        } else {
          console.log(`\nPASS: trusted Stop and visible Exa tool result observed (${observed.sourceUrl}).`);
          finish(0);
        }
      }
    });
    ws.send(JSON.stringify(buildSmokeSpawnMessage(repo)));
    timer = setTimeout(() => { console.log('\nFAILED: live smoke was not verified within 90 seconds.'); finish(1); }, TIMEOUT_MS);
  } catch {
    console.log('FAILED: could not prepare the temporary live smoke environment.');
    finish(1);
  }
  return result;
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = await main();
