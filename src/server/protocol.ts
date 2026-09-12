/**
 * The websocket protocol between the browser and this server. Shared by both
 * sides so a message shape cannot drift.
 */
import type { AppState, DevinPermissionMode } from '../core/models.js';
import type { RouteDecision, RoutingModel } from '../core/routing.js';

export interface AgentConfiguration {
  models: RoutingModel[];
  standardModelId?: string;
  routingReady: boolean;
  searchReady: boolean;
  error?: string;
}
import type { ContextHealth } from '../core/context-health.js';
import type { AcpErrorKind, AcpSessionSummary } from '../core/acp.js';
import type { PaneStatus } from '../core/models.js';
import type { Trace } from '../core/trace.js';

export type ClientMessage =
  | { t: 'state:save'; state: AppState }
  /** `contextApiKey` is the owning workspace's; the server falls back to .env. */
  | { t: 'pane:spawn'; paneId: string; cwd: string; cols: number; rows: number; model?: string; modelId?: string; agent?: 'devin' | 'codex'; route?: RouteDecision; permissionMode: DevinPermissionMode; prompt?: string; title?: string; resumeSessionId?: string; shellOnly?: boolean; contextApiKey?: string }
  | { t: 'config:get'; reqId: string }
  | { t: 'pane:input'; paneId: string; data: string }
  /** Sent when a terminal mounts, to replay the pane's recent output into it. */
  | { t: 'pane:attach'; paneId: string }
  | { t: 'pane:resize'; paneId: string; cols: number; rows: number }
  | { t: 'pane:kill'; paneId: string }
  | { t: 'sessions:list'; cwd: string; reqId: string }
  | { t: 'trace:load'; sessionId: string; cwd: string; reqId: string };

export type ServerMessage =
  | { t: 'state'; state: AppState }
  /**
   * Sent once on connect: real paths the browser cannot know on its own, plus
   * whether the server holds a default context.dev key. The key itself never
   * crosses — only whether one exists, so the create-workspace dialog can say
   * what leaving its field blank will actually do.
   */
  | { t: 'env'; home: string; cwd: string; hasDefaultContextKey: boolean }
  | { t: 'pane:data'; paneId: string; data: string }
  /**
   * Replayed recent output for one pane, in response to `pane:attach`. Sent only
   * to the attaching client so a terminal that just mounted (workspace switch,
   * grid re-render, page reload) repaints instead of coming up blank.
   */
  | { t: 'pane:snapshot'; paneId: string; data: string }
  | { t: 'pane:status'; paneId: string; status: PaneStatus; runtimeRevision?: number }
  | { t: 'config:result'; reqId?: string; config: AgentConfiguration }
  | { t: 'pane:route'; paneId: string; route: RouteDecision }
  | { t: 'pane:starting'; paneId: string; routing: boolean }
  | { t: 'pane:spawned'; paneId: string }
  | { t: 'pane:error'; paneId: string; error: string; retryable: boolean; runtimeRevision?: number }
  | { t: 'pane:codex-session'; paneId: string; codexSessionId: string }
  | { t: 'pane:outcome'; paneId: string; outcome: 'completed' | 'failed' | 'canceled'; error?: string; runtimeRevision?: number }
  | { t: 'pane:session'; paneId: string; devinSessionId: string }
  | { t: 'pane:exit'; paneId: string; code: number }
  | { t: 'pane:health'; paneId: string; health: ContextHealth }
  | { t: 'sessions:result'; reqId: string; sessions?: AcpSessionSummary[]; error?: string }
  /** `errorKind` lets the panel show a locked session as a state, not a fault. */
  | { t: 'trace:result'; reqId: string; trace?: Trace; error?: string; errorKind?: AcpErrorKind };
