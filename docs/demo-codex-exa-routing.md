# Codex, Exa, and task routing demo

This app runs the real Codex TUI locally. For Codex tickets, it classifies the
ticket through OpenRouter, launches the selected model through OpenRouter, and
optionally registers Exa as an invocation-scoped MCP server. Agent execution and
repository access stay on this machine; classification, inference, and search
requests leave the host for OpenRouter and Exa.

## Setup

Install Node 20 or newer and Codex CLI, then create a local `.env`:

```bash
cp .env.example .env
# Edit .env and set these server-only values:
# OPENROUTER_API_KEY=...
# EXA_API_KEY=...
npm install
npm run dev
```

OpenRouter bills the classifier call and every Codex inference call. The
`provider` value shown in the UI describes the model vendor; model access is
still through OpenRouter. Exa usage is billed and governed by the Exa account.
Keys remain in the server environment. They are not sent to browser state,
Convex, card JSON, command-line arguments, or logs. Codex receives the key names
in invocation-scoped configuration and reads their values from its environment.
Exa receives its key through an environment-derived `x-api-key` header.

`EXA_API_KEY` is optional for ordinary Codex work. When it is absent, Exa is not
registered and the UI reports search unavailable. `OPENROUTER_API_KEY` is
required to start any routed Codex pane, including a manual model override.

## Routing configuration

With no `AGENT_ROUTING_CONFIG`, the app uses the same defaults as
[`config/routing.example.json`](../config/routing.example.json):

```json
{
  "models": [
    { "id": "fast", "label": "Fast", "provider": "openai", "model": "openai/gpt-5.6-luna" },
    { "id": "balanced", "label": "Balanced", "provider": "openai", "model": "openai/gpt-5.6-sol" },
    { "id": "capable", "label": "Capable", "provider": "openai", "model": "openai/gpt-6-astra" }
  ],
  "tiers": { "simple": "fast", "standard": "balanced", "complex": "capable" },
  "classifierModelId": "fast"
}
```

To customize it, copy that file, edit it, and set its absolute path:

```bash
AGENT_ROUTING_CONFIG=/absolute/path/to/routing.json
```

Each model needs a unique application `id`, a UI `label`, a displayed model
vendor in `provider`, and an OpenRouter model slug in `model`. Every tier and
`classifierModelId` must reference one of those IDs. The classifier returns only
`complexity` and a short reason; the server chooses the configured slug. A
manual model selection bypasses classification while still using OpenRouter.
An empty interactive Codex pane uses the standard tier.

The example slugs reflect the configured demo as of September 12, 2026. Catalog
availability does not prove that an account has access or credit. Check the
current OpenRouter catalog and test all intended tiers before presenting a live
demo.

## Trust, lifecycle, and sessions

Each launch adds hooks for `SessionStart`, `UserPromptSubmit`,
`PermissionRequest`, `PostToolUse`, `Stop`, `Interrupt`, and `SessionEnd` through
Codex's invocation-scoped `--strict-config` configuration. Codex uses
`workspace-write` sandboxing and `on-request` approval. Review the repository
and the generated hook in the normal Codex trust prompts, or inspect `/hooks`.
The app does not edit global Codex configuration or automate trust.

Until a trusted hook arrives, the UI says **Status unverified**. A `Stop` hook
means the turn completed and moves its ticket to Done; process exit alone is not
accepted as task completion. Provider errors, interrupts, and cancellations
remain visible. A native turn interruption moves the card to Attention while
keeping its terminal alive; enter a follow-up to continue that conversation.
Explicit Stop terminates the process. Final terminal output remains available
alongside recovery controls. Retry selects a fresh route and waits for new
trusted hooks. Resume reopens the saved Codex UUID on its recorded model without
resubmitting the original ticket. Runtime status, route, and identity are replayed
when the browser reconnects; detached completion is saved by the server.

Codex history import, ACP trace, and context-health estimation are not supported.
Those controls remain Devin-specific. The Codex terminal shows its live tool
output, including Exa results. There is no independent direct-provider client,
automatic model switching within a session, live provider health check, or
proof that a returned source is correct beyond what is visible in the terminal.

Legacy records without an `agent` field continue to launch Devin. Devin session
import/resume, ACP history, context health, permission modes, and context.dev MCP
behavior are unchanged. Plain shell panes also keep their existing shell launch.

## Opt-in live smoke check

The default invocation performs no paid call:

```bash
node scripts/smoke-codex.mjs
```

To make one bounded live classification, Codex, and Exa check, export both keys
in the current shell and opt in explicitly:

```bash
OPENROUTER_API_KEY=... EXA_API_KEY=... node scripts/smoke-codex.mjs --live
```

The script creates a temporary Git repository, `DEVIN_MUX_HOME`, and
`CODEX_HOME`, starts the real app server on an unused local port, exercises Auto
classification, and launches its selected model with a prompt that requests
exactly one Exa lookup. It stops after 90 seconds. It
shows Codex's trust prompts for manual review, does not touch global Codex
configuration, and removes its temporary files on exit. It prints neither keys
nor launch arguments. Missing credentials or executables report **SKIPPED**;
they are never counted as a pass. **PASS** requires a trusted Codex `Stop`, a
visible `agent_mux_exa` invocation, and an HTTP(S) source URL shown after that
invocation. Provider failure, timeout, missing evidence, or process exit without
that event fails.

Terminal matching is a smoke-level check, not proof of source quality or a
cryptographic tool receipt. Before a demo, inspect the visible tool call, its
result, and the cited page in the terminal. If Codex changes its TUI wording so
the invocation cannot be recognized, the script reports **NOT VERIFIED** rather
than treating a completed turn as Exa success.

The integrated local fixture verification used Codex CLI 0.147.0 and observed
`SessionStart`, `UserPromptSubmit`, `Stop`, and `SessionEnd` with a UUIDv7 session
ID through the production launcher, hook helper, and OSC scanner. That fixture
used a local Responses endpoint and fake credentials. It did not make a live
OpenRouter or Exa call. Browser flows were exercised with dummy classifier and
CLI fixtures. The subsequent live smoke below verified actual provider and search integration.

`OPEN_ROUTER_API_KEY` is accepted anywhere `OPENROUTER_API_KEY` is used above.
The canonical spelling wins when both exist (including a blank canonical value).
Keys remain server-side; the Codex child receives the canonical environment name.

On September 12, 2026, live verification also passed: the production classifier
selected the fast OpenAI tier, native Codex 0.147.0 invoked `agent_mux_exa`,
returned an official Node.js documentation URL, and emitted a trusted `Stop`.
A separate direct Exa MCP search and OpenRouter classifier request passed as well.
This verifies the fast tier; the other tiers still need live checks before use
in a presentation. Native permission/interrupt/resume coverage remains separate
from this bounded search smoke.

App-launched Codex starts the executable with structured arguments directly,
so shell startup applications cannot intercept it. The final live smoke passed
with the normal inherited `SHELL` and the original `OPEN_ROUTER_API_KEY` alias,
without a shell wrapper or manual credential renaming. Devin and plain-shell
launch behavior are unchanged. Normal Codex project and hook trust prompts
still require review.

Final browser checks verified interruption and follow-up on the same session,
current status and route replay in a fresh browser, visible retained output and
successful Retry with a new Codex UUID, and manual card moves surviving replay
until the next actual lifecycle event. These browser checks used local fixtures;
the live search smoke above used real Codex, OpenRouter, and Exa.
