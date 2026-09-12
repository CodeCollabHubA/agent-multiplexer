/** Browser transport scoped to one selected workspace. The authentication
 * provider owns the shared Convex client; this adapter owns only its watches,
 * requests and local caches. Explicit local WebSocket transport is retained
 * for development callers. */
import type { ConvexReactClient } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import type { ClientMessage, ServerMessage } from '../server/protocol.js';
import type { AcpErrorKind, AcpSessionSummary } from '../core/acp.js';
import type { AppState, Card, Workspace } from '../core/models.js';
import type { Trace } from '../core/trace.js';

type Listener = (msg: ServerMessage) => void;
export type ConvexClientLike = {
  mutation: (name: unknown, args: unknown) => Promise<unknown>;
  onUpdate: (
    name: unknown,
    args: unknown,
    callback: (value: any) => void,
    onError?: (error: Error) => void,
  ) => () => void;
};
/** Adapt the provider-owned client without creating another auth session. */
export function authenticatedTransport(client: ConvexReactClient): ConvexClientLike {
  return {
    mutation: (name, args) => client.mutation(makeFunctionReference<'mutation'>(String(name)), args as Record<string, any>),
    onUpdate: (name, args, callback, onError) => {
      const watch = client.watchQuery(makeFunctionReference<'query'>(String(name)), args as Record<string, any>);
      const update = () => {
        try { const value = watch.localQueryResult(); if (value !== undefined) callback(value); }
        catch (error) { onError?.(error instanceof Error ? error : new Error(String(error))); }
      };
      const off = watch.onUpdate(update);
      update();
      return off;
    },
  };
}
type QueuedCommand = { commandId: string; message: string; createdAt: number };

/**
 * A request that failed, carrying the server's classification.
 *
 * `kind` is what lets the trace panel tell "this session is open in a pane"
 * (expected, and the user can act on it) apart from an actual fault.
 */
export class BackendError extends Error {
  readonly kind: AcpErrorKind;
  constructor(message: string, kind: AcpErrorKind = 'unknown') {
    super(message);
    this.name = 'BackendError';
    this.kind = kind;
  }
}

export class Backend {
  private ws: WebSocket | null = null;
  private convex: ConvexClientLike | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMessage[] = [];
  private commandQueue: QueuedCommand[] = [];
  private commandTimer: number | null = null;
  private commandInFlight = false;
  private reconnectTimer: number | null = null;
  private latestState: ServerMessage | null = null;
  private latestEnv: ServerMessage | null = null;
  private latestRuntime = new Map<string, ServerMessage>();
  private snapshots = new Map<string, { snapshot: string; outputVersion: number }>();
  /**
   * Panes whose terminal mounted and asked for its backlog before any output
   * had arrived over Convex. We answer them with a `pane:snapshot` the moment
   * the first `terminalState` row for that pane lands, so the very first chunk
   * of output is never lost to the attach handshake.
   */
  private attachWaiters = new Set<string>();
  private seenEvents = new Set<string>();
  private readonly profileKey: string;
  private disposed = false;
  private subscriptions: (() => void)[] = [];
  private pendingRequests = new Set<() => void>();
  private url: string;
  private onError?: (error: Error) => void;

  constructor(options: { client: ConvexClientLike; profileKey: string; onError?: (error: Error) => void } | { url: string }) {
    this.url = 'url' in options ? options.url : '';
    this.profileKey = 'profileKey' in options ? options.profileKey : '';
    if ('client' in options) { this.onError = options.onError; this.convex = options.client; this.connectConvex(); }
    else this.connect();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.subscriptions) off();
    this.subscriptions = [];
    for (const cancel of this.pendingRequests) cancel();
    this.pendingRequests.clear();
    if (this.commandTimer !== null) window.clearTimeout(this.commandTimer);
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; this.ws.close(); }
    this.ws = null;
    this.commandQueue = []; this.queue = [];
    this.latestState = null; this.latestEnv = null;
    this.latestRuntime.clear(); this.snapshots.clear(); this.attachWaiters.clear(); this.seenEvents.clear();
    this.listeners.clear();
  }

  private watch(name: string, args: unknown, callback: (value: any) => void) {
    if (this.disposed) return;
    const off = this.convex!.onUpdate(name, args, value => {
      if (!this.disposed) callback(value);
    }, error => this.fail(error));
    if (this.disposed) off();
    else this.subscriptions.push(off);
  }

  private fail(error: Error) {
    if (this.disposed) return;
    this.dispose();
    this.onError?.(error);
  }

  private connectConvex() {
    const args = { profileKey: this.profileKey };

    this.watch('mux:pullState', args, (value) => {
      if (!value?.profile) return;
      const workspaces: Record<string, Workspace> = {};
      for (const row of value.workspaces as any[]) {
        try {
          const cards = row.cards ? (JSON.parse(row.cards) as Record<string, Card>) : {};
          workspaces[row.workspaceId] = {
            id: row.workspaceId,
            name: row.name,
            cwd: row.cwd,
            view: row.view,
            sessionOrder: row.sessionOrder,
            layout: JSON.parse(row.layout),
            sessions: JSON.parse(row.sessions),
            cards,
            cardOrder: (row.cardOrder ?? Object.keys(cards)).filter((id: string) => Boolean(cards[id])),
            updatedAt: row.updatedAt,
          };
        } catch {
          continue;
        }
      }
      const state: AppState = {
        storeVersion: value.profile.storeVersion,
        activeWorkspaceId: value.profile.activeWorkspaceId ?? null,
        workspaceOrder: value.profile.workspaceOrder.filter((id: string) => Boolean(workspaces[id])),
        workspaces,
      };
      this.emit({ t: 'state', state });
    });

    this.watch('mux:getMachineStatus', args, (value) => {
      if (value) {
        this.emit({
          t: 'env',
          home: value.home,
          cwd: value.cwd,
          hasDefaultContextKey: value.hasDefaultContextKey ?? false,
        });
      }
    });

    // Terminal output. A pane seen for the first time delivers its whole
    // backlog via pane:snapshot (so the terminal's attach logic completes);
    // afterwards only the newest chunk is streamed as pane:data.
    this.watch('mux:terminalState', args, (rows) => {
      for (const row of rows as any[]) {
        const previous = this.snapshots.get(row.paneId);
        this.snapshots.set(row.paneId, { snapshot: row.snapshot, outputVersion: row.outputVersion });
        if (this.attachWaiters.has(row.paneId)) {
          // A terminal was waiting for its backlog: hand it the whole snapshot
          // now (completing its attach), then stream only increments after.
          this.attachWaiters.delete(row.paneId);
          this.emit({ t: 'pane:snapshot', paneId: row.paneId, data: row.snapshot });
        } else if (previous && row.outputVersion > previous.outputVersion && row.lastChunk) {
          this.emit({ t: 'pane:data', paneId: row.paneId, data: row.lastChunk });
        }
      }
    });

    this.watch('mux:realtimeEvents', args, (rows) => {
      for (const row of rows as any[]) {
        if (this.seenEvents.has(row.eventId)) continue;
        this.seenEvents.add(row.eventId);
        try {
          this.emit(JSON.parse(row.message) as ServerMessage);
        } catch {
          continue;
        }
      }
    });
  }

  // ---- local WebSocket path -------------------------------------------------

  private connect() {
    if (this.disposed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      // Replay anything queued while we were down — a spawn issued during a
      // server restart should still happen, not vanish.
      const pending = this.queue;
      this.queue = [];
      for (const msg of pending) ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      this.emit(msg);
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.reconnectTimer !== null) return;
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 1000);
    };

    ws.onerror = () => ws.close();
  }

  private emit(msg: ServerMessage): void {
    if (this.disposed) return;
    // Cache the messages a late subscriber needs to catch up. Terminal bytes and
    // snapshots are one-shot streams and are never cached.
    if (msg.t === 'state') this.latestState = msg;
    else if (msg.t === 'env') this.latestEnv = msg;
    else if ('paneId' in msg && msg.t !== 'pane:data' && msg.t !== 'pane:snapshot') {
      if (msg.t === 'pane:starting') {
        for (const [key, value] of this.latestRuntime) if ('paneId' in value && value.paneId === msg.paneId) this.latestRuntime.delete(key);
      }
      if (msg.t === 'pane:status' && (msg.status === 'running' || msg.status === 'waiting' || msg.status === 'interrupted')) {
        const key = `pane:launch:${msg.paneId}`;
        if (this.latestRuntime.get(key)?.t === 'pane:outcome') this.latestRuntime.delete(key);
      }
      const launchMessage = msg.t === 'pane:starting' || msg.t === 'pane:spawned' || msg.t === 'pane:error' || msg.t === 'pane:outcome';
      this.latestRuntime.set(`${launchMessage ? 'pane:launch' : msg.t}:${msg.paneId}`, msg);
    }
    for (const listener of this.listeners) listener(msg);
  }

  send(msg: ClientMessage) {
    if (this.disposed) return;
    if (this.convex) {
      // A terminal that just mounted wants its backlog. If we already have a
      // snapshot for the pane, answer immediately; otherwise remember the pane
      // and answer when its first terminalState row lands, so a freshly-spawned
      // pane's opening output is not dropped by an empty early reply.
      if (msg.t === 'pane:attach') {
        const snap = this.snapshots.get(msg.paneId);
        if (snap) this.emit({ t: 'pane:snapshot', paneId: msg.paneId, data: snap.snapshot });
        else this.attachWaiters.add(msg.paneId);
        this.enqueue(msg);
        return;
      }
      this.enqueue(msg);
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  private enqueue(msg: ClientMessage): void {
    // Coalesce keystroke and resize bursts so the command queue stays small.
    const last = this.commandQueue.at(-1);
    if (last && (msg.t === 'pane:input' || msg.t === 'pane:resize')) {
      const previous = JSON.parse(last.message) as ClientMessage;
      if (msg.t === 'pane:input' && previous.t === 'pane:input' && previous.paneId === msg.paneId) {
        last.message = JSON.stringify({ ...msg, data: previous.data + msg.data });
        return;
      }
      if (msg.t === 'pane:resize' && previous.t === 'pane:resize' && previous.paneId === msg.paneId) {
        last.message = JSON.stringify(msg);
        return;
      }
    }
    this.commandQueue.push({
      commandId: crypto.randomUUID(),
      message: JSON.stringify(msg),
      createdAt: Date.now(),
    });
    if (this.commandTimer === null) this.commandTimer = window.setTimeout(() => this.flushCommands(), 16);
  }

  private flushCommands(): void {
    this.commandTimer = null;
    if (this.disposed || !this.convex || this.commandInFlight || this.commandQueue.length === 0) return;
    const commands = this.commandQueue;
    this.commandQueue = [];
    this.commandInFlight = true;
    void this.convex
      .mutation('mux:enqueueCommands', { profileKey: this.profileKey, commands })
      .catch((error: unknown) => {
        if (this.disposed) return;
        this.commandQueue = [];
        this.fail(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        this.commandInFlight = false;
        if (!this.disposed && this.commandQueue.length > 0 && this.commandTimer === null) {
          this.commandTimer = window.setTimeout(() => this.flushCommands(), 16);
        }
      });
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    // Catch a late subscriber up to the current world without waiting for the
    // next update — important on the Convex path, where subscriptions fire once
    // and then only on change.
    if (this.latestEnv) listener(this.latestEnv);
    if (this.latestState) listener(this.latestState);
    for (const message of this.latestRuntime.values()) listener(message);
    return () => this.listeners.delete(listener);
  }

  /**
   * Correlated request: send with a reqId, resolve on the matching reply.
   *
   * `match` returns a tagged result rather than throwing, because it runs inside
   * the socket listener where a throw would escape into the message loop and
   * take down every other subscriber.
   */
  private request<T>(
    msg: ClientMessage,
    match: (m: ServerMessage) => { value: T } | { error: string; kind?: AcpErrorKind } | undefined,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Workspace closed'));
    return new Promise((resolve, reject) => {
      const cancel = () => { window.clearTimeout(timer); off(); reject(new Error('Workspace closed')); };
      this.pendingRequests.add(cancel);
      const timer = window.setTimeout(() => {
        off();
        this.pendingRequests.delete(cancel);
        reject(new Error('timed out'));
      }, 90_000);
      const off = this.subscribe((m) => {
        const outcome = match(m);
        if (!outcome) return;
        window.clearTimeout(timer);
        this.pendingRequests.delete(cancel);
        off();
        if ('error' in outcome) reject(new BackendError(outcome.error, outcome.kind));
        else resolve(outcome.value);
      });
      this.send(msg);
    });
  }

  listSessions(cwd: string): Promise<AcpSessionSummary[]> {
    const reqId = Math.random().toString(36).slice(2);
    return this.request<AcpSessionSummary[]>({ t: 'sessions:list', cwd, reqId }, (m) => {
      if (m.t !== 'sessions:result' || m.reqId !== reqId) return undefined;
      return m.error ? { error: m.error } : { value: m.sessions ?? [] };
    });
  }

  loadTrace(sessionId: string, cwd: string): Promise<Trace> {
    const reqId = Math.random().toString(36).slice(2);
    return this.request<Trace>({ t: 'trace:load', sessionId, cwd, reqId }, (m) => {
      if (m.t !== 'trace:result' || m.reqId !== reqId) return undefined;
      if (m.error) return { error: m.error, kind: m.errorKind };
      return m.trace ? { value: m.trace } : { error: 'the agent returned no trace' };
    });
  }
}
