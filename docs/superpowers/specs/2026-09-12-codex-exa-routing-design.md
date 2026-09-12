# Codex, Exa, and task-based model routing

## Agreed outcome

The hackathon demo uses Codex as the coding agent, Exa for research, and OpenRouter for model access. Automatic routing selects an OpenAI model based on ticket complexity. The model/provider list is configurable; OpenAI-only is a demo default, not a hard-coded restriction.

The user approved this direction on September 12, 2026. This document makes implementation decisions and verification requirements concrete for review.

## User workflow

1. Create a ticket with a title, description, and repository directory.
2. Select Auto or a configured model override. New tickets default to Codex and Auto.
3. Start the ticket. The server classifies its title and description as simple, standard, or complex through OpenRouter. Classification cannot execute tools or read repository files.
4. Display the selected model, provider, complexity, and short routing reason. Launch Codex with that exact model through OpenRouter.
5. Codex can invoke Exa MCP search when it needs external information. Research results remain visible in the real terminal tool interaction.
6. Keep that model for the session. Do not reclassify follow-up turns or silently switch models.
7. Reflect actual agent lifecycle events on the card. Failed or interrupted runs must not be marked Done merely because a process exited.

## Configuration

No new runtime dependency. Use existing TypeScript, Node fetch, React, ws, and node-pty.

Server-only environment variables:

- `OPENROUTER_API_KEY`: required for routed Codex sessions and classification.
- `EXA_API_KEY`: required when Exa search is enabled.
- `AGENT_ROUTING_CONFIG`: optional absolute path to a JSON configuration file; when absent, use bundled demo defaults.

The JSON configuration contains a `models` list, `tiers` mapping, and `classifierModelId`. Each model has an application `id`, `label`, `provider` (model vendor), and OpenRouter `model` slug. Providers refer to vendors accessed through OpenRouter; this scope does not implement independent direct-provider HTTP clients or select underlying inference hosts.

Proposed demo defaults, present in the public OpenRouter catalog on September 12, 2026:

| Tier | Application ID | OpenRouter slug |
| --- | --- | --- |
| simple | fast | openai/gpt-5.6-luna |
| standard | balanced | openai/gpt-5.6-sol |
| complex | capable | openai/gpt-6-astra |

Use `fast` for the classifier. Catalog presence is not proof of credentials, credit, or successful Codex execution; live verification must cover each configured tier before the demo.

Only sanitized model metadata and boolean integration readiness cross the browser protocol. Never put API keys into card/workspace state, browser storage, Convex payloads, command-line arguments, or logs. Pass Exa's key via an environment-derived HTTP header. Scope provider/MCP configuration to app-launched Codex sessions; preserve the user's global Codex setup.

## Routing contract and errors

Routing is explicit application-level selection followed by OpenRouter inference, not a claim that OpenRouter's automatic router made the decision.

The classifier returns exactly `{ complexity, reason }`, with complexity in the three configured tiers and reason limited to 240 characters. The server chooses the model from its validated configuration; model text cannot supply arbitrary slugs or commands. Treat the ticket as untrusted data within the classification prompt. A user override bypasses classification but still requires a configured model ID.

Use a 15-second classifier timeout. Empty prompt, malformed JSON, unknown tier/model ID, missing credentials, HTTP failures, and timeout produce a visible retryable launch error. Never silently pick a different model. Do not automatically retry a launch once a PTY exists. Canceling a pending start prevents its delayed classifier response from spawning a process. Prevent duplicate starts for the same pane.

## Codex compatibility

Add an optional `agent: 'devin' | 'codex'` discriminator. Existing records with no discriminator retain Devin semantics. Add Codex-specific session identity and routing fields rather than storing a Codex UUID in `devinSessionId`. Continue to support Devin and shell panes.

Use the installed Codex CLI (observed version 0.147.0) in the existing PTY. Configure its OpenRouter provider and Exa MCP per invocation. Use Codex-specific permission controls, defaulting to workspace-write with on-request approval; do not reinterpret Devin's permission labels or disable sandbox/approval protections.

Codex lifecycle tracking uses its documented hooks and the existing OSC transport, with an agent-specific payload adapter. Hooks report status only; they never grant or deny permissions. Keep normal Codex hook trust review. The setup guide must explain `/hooks`; untrusted hooks must be visibly reported as unverified status rather than inferred to be working. Capture the Codex session ID from subsequent events too, so skipping the initial SessionStart hook does not permanently lose identity.

Verify the actual CLI hook configuration and payloads in an isolated fixture before integrating them. If invocation-scoped hooks cannot be loaded without global mutation, stop and revise this seam rather than bypassing trust or quietly tailing undocumented data.

Codex resume uses its saved session ID. Existing Devin history and ACP trace retain their current implementation. Do not call Devin ACP for a Codex session. Codex history import and context-health estimation are outside this feature; hide unsupported actions instead of presenting fake metrics. Codex tool output and research are shown in the live terminal.

## Persistence and UI

Persist the chosen model and route reason on the originating card/session. Restarting a completed ticket makes a new routing decision; resuming an existing Codex session retains its prior route. Add optional fields without a store-version change or Convex schema migration: cards and sessions are already mirrored as JSON.

Reuse the existing field, badge, error, and modal styles from DESIGN.md. Show agent selection and model selection in ticket creation and pane launch. Empty interactive panes have no task to classify, so use the configured standard model unless the user chooses one.

## Verification and scope

Use test-first changes for configuration validation, routing, launch arguments, event folding, cancellation, persisted compatibility, and board outcomes. Run the full unit suite and production build after integration. Manually exercise a temporary repository through the browser, including search, an approval, success, failure, restart, and resume.

No automatic publishing, deployment, social posting, public access changes, or changes to existing Convex authorization are included. Preserve unrelated work, including the pre-existing modified package-lock.json. Do not run live agents in the user's active source tree for testing.

## Sources inspected

- Installed `codex --help`, `codex exec --help`, and `codex mcp add --help`.
- https://openrouter.ai/docs/cookbook/coding-agents/codex-cli
- https://openrouter.ai/api/v1/models
- https://exa.ai/docs/reference/exa-mcp
- https://github.com/exa-labs/exa-mcp-server
- https://developers.openai.com/codex/hooks
- https://developers.openai.com/codex/config-reference
