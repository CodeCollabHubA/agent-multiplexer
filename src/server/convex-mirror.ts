/** Authenticated relay for one shared workspace; credential failures close the relay. */
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { WebSocket as NodeWebSocket } from 'ws';
import { STORE_VERSION, type AppState, type Workspace } from '../core/models.js';
import type { FileStore } from './store.js';
import type { ClientMessage, ServerMessage } from './protocol.js';
import { runnerConfiguration, type RunnerConfiguration } from './runner-config.js';

type CommandRow = { commandId: string; message: string };
type ConvexClientLike = {
  mutation: (name: unknown, args: unknown) => Promise<unknown>;
  onUpdate: (
    name: unknown,
    args: unknown,
    callback: (value: CommandRow[]) => void,
    onError?: (error: Error) => void,
  ) => () => void;
  close: () => Promise<void>;
};

export class ConvexMirror {
  private client: ConvexClientLike | null = null;
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private queued: AppState | null = null;
  private output = new Map<string, string>();
  private outputTimers = new Map<string, NodeJS.Timeout>();
  private outputInFlight = new Set<string>();
  private processing = new Set<string>();
  private commandTail = Promise.resolve();
  private warned = false;
  private httpClient: { query: (name: unknown, args: unknown) => Promise<unknown> } | null = null;
  private onUnavailable: (() => void) | undefined;
  private constructor(private readonly config: RunnerConfiguration) {}

  private get credentials() {
    if (this.config.mode !== 'paired') throw new Error('Runner is not paired');
    return { profileKey: this.config.profileKey, machineToken: this.config.machineToken };
  }
  private readonly agentId = randomUUID();

  static async create(url: string | undefined): Promise<ConvexMirror> {
    const config = runnerConfiguration({ ...process.env, CONVEX_URL: url });
    const mirror = new ConvexMirror(config);
    if (config.mode === 'local') return mirror;
    try {
      const { ConvexClient, ConvexHttpClient } = await import('convex/browser');
      // HTTP queries are fresh authorization checks, not subscription-cache reads.
      mirror.httpClient = new ConvexHttpClient(config.url, {
        logger: false,
        fetch: (input, init) => globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
      }) as unknown as NonNullable<ConvexMirror['httpClient']>;
      await mirror.httpClient.query('mux:pendingCommands', mirror.credentials);
      mirror.client = new ConvexClient(config.url, {
        webSocketConstructor: NodeWebSocket as unknown as typeof WebSocket,
        logger: false,
      }) as unknown as ConvexClientLike;
    } catch {
      mirror.close();
      throw new Error('Runner could not authenticate with Convex; check pairing and connectivity');
    }
    return mirror;
  }

  /** Each new credential restores cloud state; same-credential restarts retain local authority. */
  async initializeStore(store: FileStore): Promise<void> {
    if (this.config.mode === 'local') return;
    const credentialHash = createHash('sha256').update(this.config.machineToken).digest('hex');
    if (store.pairingMatches(credentialHash)) return;
    try {
      if (!this.client || !this.httpClient) throw new Error();
      const value = await this.httpClient.query('mux:pullState', this.credentials) as {
        profile: { storeVersion: number; activeWorkspaceId?: string; workspaceOrder: string[] } | null;
        workspaces: Array<{ workspaceId: string; name: string; cwd: string; view: Workspace['view']; sessionOrder: string[]; layout: string; sessions: string; cards?: string; cardOrder?: string[]; updatedAt: number }>;
      };
      if (!value.profile || value.profile.storeVersion !== STORE_VERSION || !Array.isArray(value.profile.workspaceOrder) || !Array.isArray(value.workspaces)) throw new Error();
      const workspaces: AppState['workspaces'] = {};
      for (const row of value.workspaces) {
        if (!/^[a-zA-Z0-9_-]+$/.test(row.workspaceId)) throw new Error();
        const sessions = JSON.parse(row.sessions) as Workspace['sessions'];
        if (Object.values(sessions).some(session => !/^[a-zA-Z0-9_-]+$/.test(session.id))) throw new Error();
        const cards = JSON.parse(row.cards ?? '{}') as Workspace['cards'];
        workspaces[row.workspaceId] = {
          id: row.workspaceId, name: row.name, cwd: row.cwd, view: row.view,
          layout: JSON.parse(row.layout), sessions, sessionOrder: row.sessionOrder,
          cards, cardOrder: row.cardOrder ?? Object.keys(cards), updatedAt: row.updatedAt,
        };
      }
      if (value.profile.workspaceOrder.some(id => !Object.hasOwn(workspaces, id))) throw new Error();
      store.initializePairing({ storeVersion: STORE_VERSION, activeWorkspaceId: value.profile.activeWorkspaceId ?? null, workspaceOrder: value.profile.workspaceOrder, workspaces }, credentialHash);
    } catch {
      this.close();
      throw new Error('Runner could not initialize the shared workspace; no existing remote data was overwritten');
    }
  }

  /** Revalidate immediately before executing work delayed by classification. */
  async assertAuthorized(): Promise<void> {
    if (this.config.mode === 'local') return;
    await this.currentCommands();
  }

  private async currentCommands(): Promise<CommandRow[]> {
    if (!this.client || !this.httpClient) throw new Error('Runner relay is unavailable');
    try {
      const rows = await this.httpClient.query('mux:pendingCommands', this.credentials);
      if (!this.client) throw new Error('Runner relay is unavailable');
      return rows as CommandRow[];
    } catch {
      this.unavailable();
      throw new Error('Runner authorization or connectivity check failed');
    }
  }

  private unavailable(): void {
    if (!this.client) return;
    console.warn('[convex] runner relay stopped; verify pairing and connectivity before restarting');
    this.close();
    this.onUnavailable?.();
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Begin relaying: publish machine presence on a heartbeat, and subscribe to
   * the command queue so a remote browser's input/spawn/resize/kill reach the
   * PTYs. `onCommand` is the server's own message handler.
   */
  start(onCommand: (message: ClientMessage) => Promise<void>, onUnavailable?: () => void): void {
    this.onUnavailable = onUnavailable;
    if (!this.client) return;
    const updateStatus = () =>
      this.fire('mux:updateMachineStatus', {
        ...this.credentials,
        home: homedir(),
        cwd: process.cwd(),
        agentId: this.agentId,
        hasDefaultContextKey: Boolean(process.env.CONTEXT_DEV_API_KEY?.trim()),
      });
    updateStatus();
    this.heartbeat = setInterval(updateStatus, 10_000);
    this.heartbeat.unref?.();
    this.unsubscribe = this.client.onUpdate(
      'mux:pendingCommands',
      { ...this.credentials },
      (rows) => this.consume(rows, onCommand),
      () => this.unavailable(),
    );
  }

  /** Relay a server→browser message to Convex. Terminal bytes are batched. */
  publish(message: ServerMessage): void {
    if (!this.client) return;
    if (message.t === 'pane:data') {
      this.publishOutput(message.paneId, message.data);
      return;
    }
    this.fire('mux:publishEvent', {
      ...this.credentials,
      eventId: randomUUID(),
      message: JSON.stringify(message),
      createdAt: Date.now(),
    });
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.outputTimers.values()) clearTimeout(timer);
    this.outputTimers.clear();
    this.output.clear();
    this.queued = null;
    const client = this.client;
    this.client = null;
    void client?.close().catch(() => {});
  }

  private consume(rows: CommandRow[], onCommand: (message: ClientMessage) => Promise<void>): void {
    if (!this.client) return;
    const pending = rows.filter((row) => !this.processing.has(row.commandId));
    if (pending.length === 0) return;
    for (const row of pending) this.processing.add(row.commandId);
    this.commandTail = this.commandTail.then(async () => {
      for (const row of pending) {
        if (!this.client) break;
        try {
          const current = (await this.currentCommands()).find(command => command.commandId === row.commandId);
          if (!current) continue;
          await onCommand(JSON.parse(current.message) as ClientMessage);
          await this.client?.mutation('mux:acknowledgeCommands', { ...this.credentials, commandIds: [row.commandId] });
        } catch {
          // Never execute the remaining subscription snapshot after failed authorization.
          this.unavailable();
          break;
        }
      }
    }).finally(() => {
      for (const row of pending) this.processing.delete(row.commandId);
    });
  }

  private publishOutput(paneId: string, data: string): void {
    this.output.set(paneId, `${this.output.get(paneId) ?? ''}${data}`);
    this.scheduleOutput(paneId, 25);
  }

  private scheduleOutput(paneId: string, delay: number): void {
    if (this.outputInFlight.has(paneId) || this.outputTimers.has(paneId)) return;
    const timer = setTimeout(() => this.flushOutput(paneId), delay);
    timer.unref?.();
    this.outputTimers.set(paneId, timer);
  }

  private flushOutput(paneId: string): void {
    this.outputTimers.delete(paneId);
    if (!this.client || this.outputInFlight.has(paneId)) return;
    const queued = this.output.get(paneId);
    if (!queued) return;
    const data = queued.slice(0, 64_000);
    const remaining = queued.slice(data.length);
    if (remaining) this.output.set(paneId, remaining);
    else this.output.delete(paneId);
    this.outputInFlight.add(paneId);
    let retryDelay = 0;
    void this.client
      .mutation('mux:appendOutput', { ...this.credentials, paneId, data })
      .then(
        () => {
          this.warned = false;
        },
        (_err: Error) => {
          this.unavailable();
          retryDelay = 500;
          this.output.set(paneId, `${data}${this.output.get(paneId) ?? ''}`);
          if (!this.warned) console.warn('[convex] realtime mutation failed');
          this.warned = true;
        },
      )
      .finally(() => {
        this.outputInFlight.delete(paneId);
        if (this.client && this.output.has(paneId)) this.scheduleOutput(paneId, retryDelay);
      });
  }

  private fire(name: string, args: unknown): void {
    if (!this.client) return;
    void this.client.mutation(name, args).then(
      () => {
        this.warned = false;
      },
      (_err: Error) => {
        this.unavailable();
        if (!this.warned) console.warn('[convex] realtime mutation failed');
        this.warned = true;
      },
    );
  }

  /** Queue a push. Coalesces bursts (a divider drag emits many state updates). */
  push(state: AppState): void {
    if (!this.client) return;
    this.queued = state;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const pending = this.queued;
      this.queued = null;
      if (pending) void this.flush(pending);
    }, 1000);
    this.timer.unref?.();
  }

  private async flush(state: AppState): Promise<void> {
    if (!this.client) return;
    try {
      // Reference the function by path string: the generated `api` object only
      // exists after `convex dev` has run, and the server must start without it.
      await this.client.mutation('mux:pushState', {
        ...this.credentials,
        storeVersion: state.storeVersion,
        activeWorkspaceId: state.activeWorkspaceId ?? undefined,
        workspaceOrder: state.workspaceOrder,
        workspaces: state.workspaceOrder
          .map((id) => state.workspaces[id])
          .filter((ws): ws is NonNullable<typeof ws> => Boolean(ws))
          .map((ws) => ({
            id: ws.id,
            name: ws.name,
            cwd: ws.cwd,
            view: ws.view,
            updatedAt: ws.updatedAt,
            // Trees, pane maps and cards are stored opaquely: their shape belongs
            // to core/models.ts, and mirroring it into a Convex schema would mean
            // migrating two stores every time one gains a field.
            layout: JSON.stringify(ws.layout),
            sessions: JSON.stringify(ws.sessions),
            sessionOrder: ws.sessionOrder,
            cards: JSON.stringify(ws.cards ?? {}),
            cardOrder: ws.cardOrder ?? [],
          })),
      });
      this.warned = false;
    } catch {
      this.unavailable();
      if (!this.warned) {
        console.warn('[convex] push failed; local store is unaffected');
        this.warned = true; // once per outage, not once per second
      }
    }
  }
}
