/**
 * The local server: PTY host, ACP reader, file store, Convex mirror.
 *
 * "Local-first web" means this runs on the user's own machine. That is what
 * makes the whole design work: `devin` is on PATH here, its auth is already
 * established here, and git worktrees and repos are real paths here. The browser
 * is a view onto this process, not a tenant of a shared one.
 */
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { buildTrace } from '../core/trace.js';
import { applySignal } from '../core/status.js';
import { RuntimeState } from './runtime-state.js';
import { loadEnvFile, openRouterApiKey } from './env.js';
import { FileStore } from './store.js';
import { PaneSupervisor } from './panes.js';
import { HealthWatcher } from './health.js';
import { ConvexMirror } from './convex-mirror.js';
import { AcpRequestError, listSessions, loadSession } from './acp-client.js';
import type { ClientMessage, ServerMessage } from './protocol.js';
import { loadRoutingConfig } from './routing.js';
import { LaunchCoordinator } from './launch-coordinator.js';
import { codexEventState } from '../core/codex-hooks.js';
import { configurationMetadata } from './config-metadata.js';
import { shouldReportPaneExited } from './pane-attachment.js';

// Before anything reads process.env: the server runs under tsx and gets none of
// Vite's dotenv handling, so without this CONTEXT_DEV_API_KEY is undefined in
// the one process that needs it. It is the fallback for every workspace that
// has no context.dev key of its own — see core/mcp.ts.
loadEnvFile();
if (!process.env.CONTEXT_DEV_API_KEY?.trim()) {
  console.warn('[mcp] no CONTEXT_DEV_API_KEY set — panes get context.dev only from a workspace key');
}

const PORT = Number(process.env.PORT || 5177);

const store = new FileStore();
const runtime = new RuntimeState();
const clients = new Set<WebSocket>();
let mirror: ConvexMirror | null = null;
const launchedAgents = new Map<string, 'devin' | 'codex' | 'shell'>();

let routingConfig: ReturnType<typeof loadRoutingConfig> | null = null;
let routingConfigError: string | undefined;
try {
  routingConfig = loadRoutingConfig();
} catch (error) {
  routingConfigError = (error as Error).message.slice(0, 240);
  console.error(`[routing] ${routingConfigError}`);
}

const publicConfig = () => configurationMetadata(routingConfig, process.env, routingConfigError);

function broadcast(msg: ServerMessage) {
  if (runtime.record(msg)) {
    const state = runtime.reconcile(store.load());
    store.save(state);
    mirror?.push(state);
  }
  // Relay to Convex too (no-op unless configured), so a remote browser sees the
  // same terminal output, status and lifecycle events as a local one.
  mirror?.publish(msg);
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

const supervisor = new PaneSupervisor(store, {
  onData: (paneId, data) => broadcast({ t: 'pane:data', paneId, data }),
  onSignal: (paneId, signal) => {
    // applySignal encodes the precedence rule (identity never moves the badge);
    // we route by the shape it produces rather than re-deciding here.
    const next = applySignal({ status: 'idle', hooked: false, lastOutputAt: 0 }, signal);
    if (signal.kind === 'session') {
      broadcast({ t: 'pane:session', paneId, devinSessionId: signal.devinSessionId });
    } else {
      broadcast({ t: 'pane:status', paneId, status: next.status });
    }
  },
  onCodexEvent: (paneId, signal) => {
    broadcast({ t: 'pane:codex-session', paneId, codexSessionId: signal.codexSessionId });
    const lifecycle = codexEventState(signal.event);
    const status = lifecycle;
    broadcast({ t: 'pane:status', paneId, status });
    if (signal.event === 'Stop') broadcast({ t: 'pane:outcome', paneId, outcome: 'completed' });

  },
  onExit: (paneId, code) => {
    health.untrack(paneId);
    broadcast({ t: 'pane:exit', paneId, code });
    const agent = launchedAgents.get(paneId);
    if (agent !== 'shell' && code !== 0) broadcast({ t: 'pane:outcome', paneId, outcome: 'failed', error: `Agent process exited with code ${code}` });
    else if (agent === 'devin' && code === 0) broadcast({ t: 'pane:outcome', paneId, outcome: 'completed' });
  },
});

const health = new HealthWatcher((paneId, h) => broadcast({ t: 'pane:health', paneId, health: h }));
health.start();

const launches = new LaunchCoordinator({
  config: routingConfig,
  configError: routingConfigError,
  apiKey: openRouterApiKey(process.env),
  has: (paneId) => supervisor.has(paneId),
  spawn: (options) => {
    launchedAgents.set(options.paneId, options.shellOnly ? 'shell' : (options.agent ?? 'devin'));
    const pane = supervisor.spawn(options);
    if (pane?.exportPath) health.track(options.paneId, pane.exportPath);
    return pane;
  },
});

mirror = await ConvexMirror.create(process.env.CONVEX_URL || process.env.VITE_CONVEX_URL);

/**
 * Handle one client message. `send` is the reply channel for THIS caller — a
 * WebSocket's own socket for a local browser, or `mirror.publish` for a command
 * that arrived over Convex from a remote browser. `source` is set only for the
 * WebSocket path, so the state echo can skip the sender.
 */
async function handle(
  send: (message: ServerMessage) => void,
  msg: ClientMessage,
  source?: WebSocket,
): Promise<void> {
  switch (msg.t) {
    case 'state:save': {
      const reconciled = runtime.reconcile(msg.state);
      store.save(reconciled);
      mirror?.push(reconciled);
      if (reconciled !== msg.state) send({ t: 'state', state: reconciled });
      // Echo to OTHER clients so two open tabs converge; echoing to the sender
      // would fight its own local edits.
      for (const peer of clients) {
        if (peer !== source && peer.readyState === peer.OPEN) {
          peer.send(JSON.stringify({ t: 'state', state: reconciled } satisfies ServerMessage));
        }
      }
      break;
    }

    case 'pane:spawn': {
      if (launches.isPending(msg.paneId) || supervisor.has(msg.paneId)) {
        for (const event of runtime.messages(msg.paneId)) send(event);
      } else {
        // Classification must not block later cancellation commands from Convex.
        void launches.start(msg, broadcast).catch(() => {
          broadcast({ t: 'pane:error', paneId: msg.paneId, error: 'Agent launch could not be completed', retryable: true });
        });
      }
      break;
    }

    case 'config:get':
      send({ t: 'config:result', reqId: msg.reqId, config: publicConfig() });
      break;

    case 'pane:input':
      supervisor.write(msg.paneId, msg.data);
      break;

    case 'pane:attach': {
      // Replay the pane's recent output to THIS client only. The live stream is
      // still broadcast to everyone; a reattaching terminal came up empty and
      // needs the backlog to repaint. Always reply — even with empty data — so
      // the client can stop queuing live output and start writing it directly.
      for (const event of runtime.messages(msg.paneId)) send(event);
      const snapshot = supervisor.snapshot(msg.paneId);
      if (shouldReportPaneExited(supervisor, launches.isPending(msg.paneId), msg.paneId)) {
        send({ t: 'pane:status', paneId: msg.paneId, status: 'exited' });
      }
      const data = snapshot ?? '';
      send({ t: 'pane:snapshot', paneId: msg.paneId, data });
      break;
    }

    case 'pane:resize':
      supervisor.resize(msg.paneId, msg.cols, msg.rows);
      break;

    case 'pane:kill':
      launches.cancel(msg.paneId);
      supervisor.kill(msg.paneId);
      health.untrack(msg.paneId);
      broadcast({ t: 'pane:status', paneId: msg.paneId, status: 'exited' });
      broadcast({ t: 'pane:outcome', paneId: msg.paneId, outcome: 'canceled' });
      break;

    case 'sessions:list': {
      try {
        const sessions = await listSessions(msg.cwd);
        send({ t: 'sessions:result', reqId: msg.reqId, sessions });
      } catch (err) {
        send({ t: 'sessions:result', reqId: msg.reqId, error: (err as Error).message });
      }
      break;
    }

    case 'trace:load': {
      try {
        const updates = await loadSession(msg.sessionId, msg.cwd);
        const trace = buildTrace(msg.sessionId, updates);
        send({ t: 'trace:result', reqId: msg.reqId, trace });
      } catch (err) {
        send({
          t: 'trace:result',
          reqId: msg.reqId,
          error: (err as Error).message,
          errorKind: err instanceof AcpRequestError ? err.kind : 'unknown',
        });
      }
      break;
    }
  }
}

// Push the current tree once at boot, then relay: browser commands over Convex
// are routed into the same handler, replying back over Convex.
mirror.push(store.load());
mirror.start((message) => handle((response) => mirror?.publish(response), message));

const http = createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, profile: store.root, convex: mirror?.enabled ?? false }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, path: '/pty' });

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(
    JSON.stringify({
      t: 'env',
      home: homedir(),
      cwd: process.cwd(),
      // Whether, not what: the key stays on this side of the socket.
      hasDefaultContextKey: Boolean(process.env.CONTEXT_DEV_API_KEY?.trim()),
    } satisfies ServerMessage),
  );
  ws.send(JSON.stringify({ t: 'state', state: store.load() } satisfies ServerMessage));
  ws.send(JSON.stringify({ t: 'config:result', config: publicConfig() } satisfies ServerMessage));
  for (const event of runtime.messages()) ws.send(JSON.stringify(event));

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    void handle((message) => ws.send(JSON.stringify(message)), msg, ws).catch((err) =>
      console.error('[server]', err),
    );
  });

  ws.on('close', () => clients.delete(ws));
});

http.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] pty+acp on http://127.0.0.1:${PORT}  profile: ${store.root}`);
});

/**
 * Kill every PTY on the way out. An orphaned `devin` holds its session lock,
 * which would make that session unloadable in the trace panel afterwards.
 */
function shutdown() {
  supervisor.killAll();
  health.stop();
  mirror?.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
