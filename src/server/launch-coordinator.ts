import { selectRoute, type RouteDecision, type RoutingConfig } from '../core/routing.js';
import { routeTask, type RouteTaskInput } from './routing.js';
import type { ClientMessage, ServerMessage } from './protocol.js';
import type { PaneHandle, SpawnOptions } from './panes.js';

type SpawnMessage = Extract<ClientMessage, { t: 'pane:spawn' }>;
type RouteFn = (input: RouteTaskInput, config: RoutingConfig, options: { apiKey: string; signal: AbortSignal }) => Promise<RouteDecision>;

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Could not start agent';
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 240);
}

export class LaunchCoordinator {
  private generations = new Map<string, number>();
  private pending = new Map<string, AbortController>();

  constructor(private deps: {
    config: RoutingConfig | null;
    configError?: string;
    apiKey: string;
    route?: RouteFn;
    has?: (paneId: string) => boolean;
    authorize?: () => Promise<void>;
    spawn: (options: SpawnOptions) => PaneHandle | null | object;
  }) {}

  cancel(paneId: string): void {
    this.generations.set(paneId, (this.generations.get(paneId) ?? 0) + 1);
    this.pending.get(paneId)?.abort();
    this.pending.delete(paneId);
  }

  cancelAll(): void {
    for (const paneId of this.pending.keys()) this.cancel(paneId);
  }

  isPending(paneId: string): boolean {
    return this.pending.has(paneId);
  }

  async start(msg: SpawnMessage, send: (message: ServerMessage) => void): Promise<PaneHandle | null | object | undefined> {
    if (this.pending.has(msg.paneId) || this.deps.has?.(msg.paneId)) return;
    const generation = (this.generations.get(msg.paneId) ?? 0) + 1;
    this.generations.set(msg.paneId, generation);
    const controller = new AbortController();
    this.pending.set(msg.paneId, controller);
    try {
      send({ t: 'pane:starting', paneId: msg.paneId, routing: !msg.shellOnly && msg.agent === 'codex' });
      if (msg.shellOnly || (msg.agent ?? 'devin') === 'devin') {
        if (this.deps.authorize) await this.deps.authorize();
        if (controller.signal.aborted || this.generations.get(msg.paneId) !== generation) return;
        const pane = this.deps.spawn(msg);
        if (pane) {
          send({ t: 'pane:spawned', paneId: msg.paneId });
        }
        else send({ t: 'pane:error', paneId: msg.paneId, error: 'Agent process could not be started', retryable: true });
        return pane;
      }
      if (!this.deps.config) {
        send({ t: 'pane:error', paneId: msg.paneId, error: this.deps.configError ?? 'Routing configuration is unavailable', retryable: true });
        return;
      }
      if (!this.deps.apiKey.trim()) {
        send({ t: 'pane:error', paneId: msg.paneId, error: 'OpenRouter is not configured on the server', retryable: true });
        return;
      }

      let decision: RouteDecision;
      if (msg.route) {
        const selected = this.deps.config.models.find((m) => m.id === msg.route!.modelId);
        if (!selected || selected.model !== msg.route.model) throw new Error('Saved model is no longer available with the same configuration');
        decision = msg.route;
      } else if (!msg.prompt?.trim() && !msg.title?.trim() && msg.modelId === undefined) {
        decision = selectRoute(this.deps.config, 'standard', 'Default for an interactive pane');
      } else {
        decision = await (this.deps.route ?? routeTask)(
          { title: msg.title ?? '', description: msg.prompt ?? '', modelId: msg.modelId },
          this.deps.config,
          { apiKey: this.deps.apiKey, signal: controller.signal },
        );
      }
      if (this.deps.authorize) await this.deps.authorize();
      if (controller.signal.aborted || this.generations.get(msg.paneId) !== generation) return;
      send({ t: 'pane:route', paneId: msg.paneId, route: decision });
      const pane = this.deps.spawn({ ...msg, agent: 'codex', route: decision, model: undefined });
      if (pane) {
        send({ t: 'pane:spawned', paneId: msg.paneId });
        send({ t: 'pane:status', paneId: msg.paneId, status: 'idle' });
      }
      else send({ t: 'pane:error', paneId: msg.paneId, error: 'Agent process could not be started', retryable: true });
      return pane;
    } catch (error) {
      if (!controller.signal.aborted && this.generations.get(msg.paneId) === generation) {
        send({ t: 'pane:error', paneId: msg.paneId, error: safeError(error), retryable: true });
      }
    } finally {
      if (this.generations.get(msg.paneId) === generation) this.pending.delete(msg.paneId);
    }
  }
}
