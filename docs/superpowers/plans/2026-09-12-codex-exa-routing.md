# Codex, Exa, and model routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Codex from the existing board with Exa research and configurable complexity-based OpenRouter model selection.

**Architecture:** Keep the PTY and local-first store. Introduce a pure routing configuration module, a server-side classifier, and a Codex-specific launch/lifecycle adapter. Carry sanitized routing metadata through the existing WebSocket/Convex event channel into the board.

**Tech Stack:** Existing TypeScript, Node fetch, React, Vitest, ws, node-pty; Codex CLI 0.147.0 on the observed machine.

**Spec:** `docs/superpowers/specs/2026-09-12-codex-exa-routing-design.md`

## Global Constraints

- No new runtime dependency.
- OpenAI-only is a demo default, not a hard-coded restriction.
- Providers refer to vendors accessed through OpenRouter.
- Keep that model for the session. Do not reclassify follow-up turns or silently switch models.
- Never put API keys into card/workspace state, browser storage, Convex payloads, command-line arguments, or logs.
- Keep normal Codex hook trust review.
- Existing records with no discriminator retain Devin semantics.
- Preserve unrelated work, including the pre-existing modified package-lock.json.
- No deployment or Convex schema changes.
- Execute tasks sequentially with task review; do not change shared interfaces concurrently.

## Task 1: Validated routing configuration and model selection

**Files:** Create `src/core/routing.ts`, `src/core/routing.test.ts`, and `config/routing.example.json`.

**Interfaces:**

```ts
export type TaskComplexity = 'simple' | 'standard' | 'complex';
export interface RoutingModel {
  id: string;
  label: string;
  provider: string;
  model: string;
}
export interface RoutingConfig {
  models: RoutingModel[];
  tiers: Record<TaskComplexity, string>;
  classifierModelId: string;
}
export interface RouteDecision {
  modelId: string;
  model: string;
  provider: string;
  complexity: TaskComplexity | 'manual';
  reason: string;
}
// parseRoutingConfig(input: unknown): RoutingConfig
// selectRoute(config: RoutingConfig, complexity: TaskComplexity, reason: string): RouteDecision
// selectManualRoute(config: RoutingConfig, modelId: string): RouteDecision
```

- [ ] Write tests for default tier selection, custom non-OpenAI entries, duplicate/empty IDs, unknown tier targets, missing classifier, and invalid manual selection. A representative public-contract assertion:

```ts
it('selects only a configured model for a manual override', () => {
  expect(() => selectManualRoute(DEMO_ROUTING_CONFIG, 'injected/model')).toThrow();
  expect(selectManualRoute(DEMO_ROUTING_CONFIG, 'balanced')).toMatchObject({
    model: 'openai/gpt-5.6-sol', complexity: 'manual', provider: 'openai',
  });
});
```

- [ ] Run `npm test -- src/core/routing.test.ts`; confirm failures reflect missing behavior.
- [ ] Implement the interfaces, immutable demo defaults, and parser. Require nonempty strings, unique IDs, three resolvable tiers, a resolvable classifier, and a nonempty model list. Permit other vendor slugs; never convert a slug into an executable command.
- [ ] Run the focused tests and `npm run typecheck`. Review this task before downstream work.

## Task 2: Server-side complexity classification

**Files:** Create `src/server/routing.ts`, `src/server/routing.test.ts`; update `.env.example`.

**Interfaces:** Consumes `RoutingConfig` and produces `RouteDecision`.

```ts
export interface RouteTaskInput { title: string; description: string; modelId?: string }
// routeTask(input: RouteTaskInput, config: RoutingConfig, options: {
//   apiKey: string; signal?: AbortSignal; fetch?: typeof globalThis.fetch;
// }): Promise<RouteDecision>
```

- [ ] Test against a local HTTP fixture: structured successful classification, malformed output, unknown complexity, too-long reason, 401/429/500, timeout, cancellation, and manual override issuing no classifier request.

```ts
it('rejects an unknown classifier tier instead of launching another model', async () => {
  const fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ complexity: 'unbounded', reason: 'x' }) } }],
  }), { status: 200 });
  await expect(routeTask({ title: 'Fix copy', description: 'Correct a spelling error' },
    DEMO_ROUTING_CONFIG, { apiKey: 'fixture', fetch })).rejects.toThrow();
});
```

- [ ] Run `npm test -- src/server/routing.test.ts` and confirm the intended failures.
- [ ] POST to `https://openrouter.ai/api/v1/chat/completions`, with the configured classifier slug, strict JSON-schema response format, no tools, and a 15-second abort deadline. Use a system instruction describing simple/local edits, standard implementation/debugging, and complex cross-component reasoning. Put title and description into a serialized user message; do not concatenate them into system instructions.
- [ ] Parse and validate output; map the tier through `selectRoute`. Return bounded, sanitized errors without provider response bodies or credentials. Add environment-variable documentation with empty key values.
- [ ] Run the focused tests and `npm run typecheck`; review before launch integration.

## Task 3: Codex launch and lifecycle adapter

**Files:** Create `src/core/codex-launch.ts`, `src/core/codex-launch.test.ts`, `src/core/codex-hooks.ts`, `src/core/codex-hooks.test.ts`, `src/server/codex-config.ts`, `src/server/codex-config.test.ts`; update `src/server/panes.ts`, `src/core/models.ts`, `src/core/osc.ts`, and corresponding tests.

**Interfaces:** Add optional `agent: 'devin' | 'codex'`, `codexSessionId`, and `route: RouteDecision` to cards/sessions; absence means Devin. Codex launch receives the selected model, cwd, optional prompt/resume ID, and app-generated config entries. It must never consume raw browser provider URLs or keys.

- [ ] Confirm invocation-scoped inline Codex hooks using `--strict-config` in a temporary fixture. Record the CLI version and payload shape; do not globally edit Codex configuration or bypass hook trust. Stop and revise the design if this seam cannot work as specified.
- [ ] Write tests proving shell metacharacters in prompts/paths remain literal; correct `codex resume` syntax; per-session OpenRouter/Exa config; no keys in argv; preservation of global user settings; and no Devin export/config flags on Codex launches.

```ts
it('never passes secrets in the generated command', () => {
  const args = buildCodexArgs({ model: 'openai/gpt-5.6-sol', exaEnabled: true });
  expect(args.join(' ')).toContain('OPENROUTER_API_KEY');
  expect(args.join(' ')).toContain('EXA_API_KEY');
  expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
});
```

- [ ] Run focused Codex tests, observe red, then implement structured argument generation and reuse the existing shell-quoting convention only when converting to the PTY shell command.
- [ ] Configure the OpenRouter provider at `https://openrouter.ai/api/v1`; source authentication from the server environment. Configure Exa at `https://mcp.exa.ai/mcp` with `env_http_headers` mapping `x-api-key` to `EXA_API_KEY`. Use a distinct app-owned MCP identifier to avoid replacing a user-defined server.
- [ ] Add Codex-only observational lifecycle hooks: prompt submission/running, permission request/waiting, post-tool/running, stop/idle, interrupt/interrupted, session end/exited. Validate and capture session ID on all available events. Hook output must not approve tools or expose payload contents. Handle missing hook trust explicitly.
- [ ] Prevent an old PTY exit callback from deleting a newly restarted pane: compare the exiting handle with the currently stored handle. Add a regression test using controllable PTY events.
- [ ] Run Codex and existing launch/OSC tests. Verify a real Codex terminal in a disposable repository, including its normal hook trust setup, before claiming lifecycle support.

## Task 4: Board integration, errors, and persistence

**Files:** Update `src/server/index.ts`, `src/server/protocol.ts`, `src/core/board.ts`, `src/core/board.test.ts`, `src/ui/backend.ts`, `src/ui/App.tsx`, `src/ui/PaneLauncher.tsx`, `src/ui/CardDialog.tsx`, `src/ui/CardDetail.tsx`, `src/ui/BoardView.tsx`, `src/ui/Sidebar.tsx`, and `src/ui/styles.css`. Add focused server launch-coordinator and store compatibility tests. Keep state-machine helpers in focused modules if needed rather than expanding App with network logic.

**Interfaces:** Add agent and optional configured model ID to spawn requests. Add sanitized configuration/readiness request/reply, `pane:route` with `RouteDecision`, and `pane:error` with a bounded error string. Carry generic messages through existing Convex realtime events; do not alter its database schema.

- [ ] Test legacy records still resolve to Devin; Codex UUIDs do not populate Devin fields; route decisions survive file-store round trips; canceled/failed launches do not mark Done; and restarting a routed card clears obsolete runtime state.

```ts
it('does not complete a Codex ticket on a failed process exit', () => {
  const result = applyCardOutcome(startedCodexState, paneId, { kind: 'failed', message: 'Provider unavailable' });
  expect(result.workspaces[wsId].cards[cardId].column).toBe('attention');
});
```

- [ ] Add a launch coordinator with per-pane cancellation and generation identity. Route asynchronously without holding up resize/input/kill messages. Reject duplicate starts; killing during classification aborts pending work and makes a late result inert. Tests must prove these behaviors with delayed classifier responses.
- [ ] Default new cards/panes to Codex. Auto on a ticket classifies its prompt; an empty interactive pane uses the standard tier. Add the configured model dropdown and explicit agent selection. Keep existing Devin autonomy options confined to Devin; show Codex's actual workspace-write/on-request policy.
- [ ] Show routing in progress, selected model/provider/tier/reason, search readiness, and retryable errors. Disable duplicate Start while pending. Keys remain in server environment only.
- [ ] Persist route and agent identity on their owning records. Codex resume retains its model. Guard Devin ACP trace/import actions from Codex sessions and hide unsupported Codex context-health metrics.
- [ ] Retain the existing opaque session/card Convex serialization. Add a transport test proving the configuration/readiness reply contains no keys. Update status replay handling so old exit events cannot override newer runs.
- [ ] Run all tests and `npm run build`; review UI and integration together.

## Task 5: Demo verification and documentation

**Files:** Update `README.md` and `.env.example`; add `docs/demo-codex-exa-routing.md` and `scripts/smoke-codex.mjs`.

- [ ] Document the routing JSON format, key placement, OpenRouter billing path, Exa MCP setup, Codex hook trust, supported session controls, and honest unsupported features. Explain that vendor configuration is via OpenRouter.
- [ ] Add a repeatable opt-in smoke script that creates a temporary repository/profile, checks prerequisites without printing keys, and launches only a bounded fixture task. Missing credentials must report a skipped live check, not success.
- [ ] Manually verify in the browser: simple ticket, complex ticket, manual override, real Exa query with a source URL, approval/attention, completion, provider failure, retry, cancellation while routing, reload, and Codex resume. Use model responses/tool output as evidence, not just configured labels.
- [ ] Verify a legacy Devin card and a shell pane still use their existing launch behavior with fixture processes where Devin is unavailable.
- [ ] Run `npm test` and `npm run build`. Record actual results, CLI version, configured model slugs, and any skipped live cases. Existing large-bundle warning may remain; no unrelated bundle refactor.
- [ ] Perform final code review against the spec. Keep unrelated package-lock changes out of the implementation diff. Leave deployment and submission for a separately authorized step.

## Plan self-review

Task 1 owns model types/defaults, Task 2 consumes them, Task 3 adds agent launch metadata, and Task 4 carries both into the board. Shared model/protocol/UI files are changed sequentially. Task 5 proves the integrated user workflow. The runtime hook seam is an explicit feasibility gate, not permission to fabricate badges or bypass trust. No implementation or live API execution has occurred as part of writing this plan.
