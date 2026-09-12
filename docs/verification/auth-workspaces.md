# Auth/workspace release verification — 12 September 2026

Frontend: https://ai-thinkers.mohammedbalila11.workers.dev/
Cloudflare version: `2dc21a67-96dd-4074-bb4a-87d44cb05f5d`.
Backend: `patient-puma-553.eu-west-1.convex.cloud` (the supplied development deployment).
Browser: Chrome on macOS. Real user session supplied by the user.

## Passed

- 262 tests across 37 files; project typecheck and production Vite build.
- Independent backend, UI, runner and integrated change reviews; scoped rereviews after fixes.
- Live Auth0 login on localhost and deployed origin; local logout returns to login.
- Production reload retains login and selected workspace access.
- Real signed-in creation of `Hackathon Demo`, rename and restoration of its name.
- Live invitation link generation and revocation; one-time runner credential display/hiding and revocation.
- Live Convex authorization: anonymous reads rejected, uninvited test identity rejected, invited identity admitted, departed identity rejected.
- Two concurrent invitation acceptances against live Convex: exactly one succeeded. Replay and revoked invitation rejected.
- Live runner credential replacement/revocation reject old credentials and clear pending commands.
- Machine paired to `Hackathon Demo`; browser shows connected runner and routing/search configured.
- Browser-created `Codex Demo` project board persisted through runner/Convex, survived browser reload and runner restart.
- Live authenticated `config:get` command reached runner and correlated response reached Convex.
- Real paired localhost WebSocket rejected unauthenticated connections with HTTP 401.
- Deployed HTML/JavaScript match the verified build. Configured server API keys, deployment key and machine token are absent from browser assets.

## Fixes driven by verification

Convex forces an Auth0 refresh after confirming a cached token. The initial setup
returned `consent_required` for silent localhost renewal. Official SDK refresh
tokens and local-storage caching, with Auth0 rotation enabled, resolved it; real
login and reload were retested successfully. No temporary token diagnostics remain.

A returning old runner could otherwise overwrite newer cloud boards. Pairing
credential changes now restore current cloud state and preserve the old local
store in a separate backup. Matching-credential restarts keep local authority.

## Limits and retained test data

Invitation acceptance/isolation were exercised with synthetic test identities via
the authenticated Convex administrator test facility, not a second person's live
Auth0 signup. New-account enrollment and multi-day refresh expiry were not tested.
Invitation expiry is covered by handler tests; real concurrent consumption was
tested against Convex's transaction engine. Filesystem rollback on injected
failure was source-reviewed, not fault-injected.

This release did not repeat paid Codex/OpenRouter/Exa inference. Prior demo testing
covers that path; the new live check covers the authenticated relay and actual
runner configuration. Concurrent project edits retain the existing full-snapshot
last-write-wins behavior.

One synthetic QA workspace (no machine credential, no project data) remains in
Convex for audit and is not visible to real users. The real demo workspace and
empty Codex Demo board are intentionally retained. Runner pairing is saved in
local gitignored `.env.runner.local`, file mode 600; restart with
`npm run start:runner`. Cloudflare hosts the browser, so the local runner must
remain running for agent execution.
