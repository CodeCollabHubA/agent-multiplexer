# Agent Workspace

**Coordinate Codex agents in parallel, route tasks to the right OpenAI model, and research with Exa.**

A local-first browser workspace with a ticket board and real Codex terminals. Start several tasks, see which model each uses, and step in when an agent needs attention.

## What to demo

- **Tickets → Codex:** write a task and start its native Codex terminal from the board.
- **Complexity-based routing:** OpenRouter classifies Auto tickets into simple, standard, or complex tiers. Each tier maps to a configurable model. The demo defaults use OpenAI models.
- **Manual model selection:** choose a configured model directly; empty interactive panes use the standard tier.
- **Exa search:** ask Codex to look up current documentation and cite sources. Real tool calls and results appear in the terminal.
- **Parallel work:** arrange up to six terminals, resize splits, use tabs, or maximize a pane.
- **Human control:** review native trust and approval prompts, interrupt a turn, continue the conversation, or stop an agent.
- **Recovery:** reconnect to running sessions after a browser refresh. Resume a stopped ticket with its saved model and conversation, or restart it as a fresh task.

The model badge records the launch selection and reason. Changing models inside Codex does not update that badge. Completion follows trusted lifecycle hooks; a process exit alone is not a successful task.

## Sign-in setup

The browser uses Auth0 Universal Login. Complete the callback, logout, and web-origin settings in [the Auth0 setup guide](docs/auth0-setup.md) before signing in. Convex validates authenticated workspace membership for all state, terminal and command access. Create a shared workspace, invite teammates with a single-use link, and pair a machine runner. Members have equal access; there are no roles.

## Run locally

Requirements: Node.js 20 or newer, a C toolchain for `node-pty`, Codex CLI on `PATH`, an OpenRouter API key, and an Exa API key for search.

```sh
git clone git@github.com:CodeCollabHubA/agent-multiplexer.git
cd agent-multiplexer
npm install
cp .env.example .env
```

Set `VITE_CONVEX_URL`, `OPENROUTER_API_KEY` and `EXA_API_KEY` in `.env`, then start the browser:

```sh
npm run dev:web
```

Open **http://localhost:5173** and sign in. Create a shared workspace and pair your machine using [the setup guide](docs/auth0-setup.md). Once the runner is online, create a project pointing at an existing directory, choose a board or terminal grid, and start Codex.

`OPEN_ROUTER_API_KEY` is also accepted. If using that spelling, remove the `OPENROUTER_API_KEY` line from `.env`: the canonical spelling takes precedence even when blank. Never prefix credentials with `VITE_`.

Codex starts directly with structured arguments, workspace-write sandbox access, and approval on request by default. Enable **Skip approval prompts** when creating an agent or ticket to use `--ask-for-approval never` while retaining the workspace sandbox. Blocked actions fail instead of escalating; project and hook trust prompts still apply. The choice persists for restart, resume, and retry. Review the project and generated lifecycle hooks in Codex's normal trust UI. The app does not change your global Codex configuration or bypass trust prompts.

## Configure models

Copy [config/routing.example.json](config/routing.example.json) and set `AGENT_ROUTING_CONFIG` to its **absolute path** in `.env`. Configure the model list, the three tier mappings, and the classifier model. Restart the server after changes.

Model requests, including classification, go through OpenRouter. The model list can contain other vendors' OpenRouter model identifiers; OpenAI models are configured for the demo. Invalid configuration, missing credentials, and classification failures are shown explicitly, without silently choosing a fallback model.

## Demo and verification

Follow the [demo guide](docs/demo-codex-exa-routing.md) for setup, example tasks, lifecycle checks, and the optional paid smoke test.

```sh
npm test
npm run build
```

The integration has been checked with a real Auto-routed Codex task that called Exa, returned an official documentation URL, and emitted a trusted completion hook. Other model tiers, native permission/interrupt/resume sequences, and remote Convex operation need separate live verification; fixture tests are not proof of those live paths.

## How it works

The React UI signs in with Auth0 and reads workspace state through authenticated Convex subscriptions. Commands travel through a membership-checked queue to a separately paired Node runner. The runner classifies tasks through OpenRouter, starts native Codex processes through PTYs, and streams terminal output through Convex. Observational Codex hooks supply lifecycle events and session identities. Exa is configured as a per-launch MCP server.

Project boards, cards, layouts and session metadata are stored on the runner and mirrored to Convex. Each authenticated shared workspace has an isolated local store. `DEVIN_MUX_HOME` selects the base directory, useful for a clean demo. Browser refresh reconnects to live processes; restarting the runner stops them. The authenticated browser requires Convex; setup and Cloudflare deployment are documented in [the Auth0/workspace guide](docs/auth0-setup.md). Existing anonymous profiles remain preserved and inaccessible to newly signed-in users.

## Optional legacy integration

The existing Devin adapter remains available for compatibility. Set `VITE_ENABLE_DEVIN=true` and restart the development server (or rebuild the browser bundle) to expose Devin selection, history, and context.dev configuration. Existing saved Devin tickets keep their original agent identity.

Devin history, ACP traces, and context-health indicators are legacy capabilities, not Codex features. They are excluded from the default demo flow. See [HANDOFF.md](HANDOFF.md) for historical Devin implementation notes; its old verification counts describe that earlier version.
