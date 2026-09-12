# Login and shared workspaces

The browser uses the official Auth0 React SDK and Convex Auth0 integration. Convex
validates the signed identity and checks membership on every workspace, terminal,
and command request. Workspace names and IDs are not access credentials.

A shared workspace contains the existing project boards, layouts and agent
sessions. Members have equal access, including terminal control and invitations.
There are no roles. Invite people you trust to use the paired machine.

## Auth0 application

For application `CGlOWL0HkW4FAgkAEWyBpFVCn6aCdNd5` in
`dev-4hw2emzs.eu.auth0.com`, use **Single Page Application** and token endpoint
authentication method **None**. These exact origins must appear in each of
Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins:

- `http://localhost:5173`
- `https://ai-thinkers.mohammedbalila11.workers.dev`

The SDK returns to the current origin after login/logout. Vite runs on port 5173
with strictPort enabled. The domain and client ID are public identifiers. A SPA
never needs a client secret.

Enable the **Refresh Token** grant and **Refresh Token Rotation**. This demo uses
a 30-day maximum refresh-token lifetime and a seven-day idle lifetime. The official
SDK uses refresh tokens and its built-in local-storage cache so refresh and
Convex token renewal do not depend on a silent third-party iframe. Logout clears
the SDK session.

## Browser and backend configuration

```env
VITE_CONVEX_URL=https://patient-puma-553.eu-west-1.convex.cloud
VITE_AUTH0_DOMAIN=dev-4hw2emzs.eu.auth0.com
VITE_AUTH0_CLIENT_ID=CGlOWL0HkW4FAgkAEWyBpFVCn6aCdNd5
```

Use the Cloud URL (`.convex.cloud`), not the HTTP Actions URL (`.convex.site`).
These are build-time browser variables: rebuild after changing them. The browser
selects workspaces using authenticated membership; `VITE_CONVEX_PROFILE` is no
longer used.

`convex/auth.config.ts` uses the same Auth0 domain/client ID. Set both public
variables on every Convex deployment before deploying (including the demo):

```sh
npx convex env set AUTH0_DOMAIN https://dev-4hw2emzs.eu.auth0.com
npx convex env set AUTH0_CLIENT_ID CGlOWL0HkW4FAgkAEWyBpFVCn6aCdNd5
```

For another app, use its identifiers here and matching `VITE_AUTH0_*` values for
the browser, then deploy both.

## Invitations

Sign up or log in, create a shared workspace, and use its invitation controls to
create a link. Share it yourself with one person. Links expire after seven days,
work once, and can be revoked before acceptance. The recipient must sign in before
joining. Only a hash is stored in Convex; an old link cannot be recovered from the
invitation list, so generate a new one when needed. Members may leave, but the
last member cannot leave and abandon a workspace.

## Pairing the machine runner

Create a runner credential in workspace settings and copy the displayed server
configuration to the machine that will run Codex:

```env
CONVEX_URL=https://patient-puma-553.eu-west-1.convex.cloud
CONVEX_PROFILE=<workspace ID shown by the app>
CONVEX_MACHINE_TOKEN=<one-time runner credential>
```

Set `EXA_API_KEY` and `OPENROUTER_API_KEY` (or `OPEN_ROUTER_API_KEY`) on that machine
as before. When all settings are in `.env`, start with `npm run dev:server`.
Alternatively, save the three pairing settings in gitignored `.env.runner.local`
(`chmod 600 .env.runner.local`) and use `npm run start:runner`; this loads API keys
from `.env` and pairing settings from the separate file. The machine must have Codex and the
project directory available. Keep the runner running while using terminals.
Cloudflare hosts the browser; it does not run local Codex processes.

Never prefix machine tokens, API keys or deploy keys with `VITE_`. Treat the
runner configuration as a secret and do not commit it. Creating a replacement
credential revokes the old one; revoking a runner clears pending commands and
presence. It prevents subsequent access, but cannot undo work already executed.

Runner state is stored separately for each secured workspace. Pairing with a new
credential restores its current cloud state and preserves an existing local store
in a backup directory. Restarting with the same credential keeps local state
authoritative. A connection or authorization failure stops the relay and running
panes; restart the runner after restoring connectivity or pairing. Anonymous legacy
profiles are preserved and not automatically assigned to anyone. A signed-in user
cannot claim old data by guessing its profile name. Paired runners disable the
local terminal WebSocket, so the browser reaches them only through authenticated
Convex commands.

## Cloudflare deployment

The repository's `wrangler.jsonc` deploys static assets to the existing
`ai-thinkers` Worker with SPA fallback. Auth0 handles login and Convex hosts the
authorized workspace API. There is no Auth0 client secret or server API key to
configure on this static Worker.

Deploy the secured backend first using the deployment key from the gitignored
`.env` (ensure it targets the deployment used by `VITE_CONVEX_URL`):

```sh
npx convex deploy --env-file .env --typecheck enable
npm test
npm run build
npx wrangler@4 deploy
```

For this demo the frontend uses the supplied development Convex deployment.
Changing to a separate production deployment requires deploying the same schema,
functions and auth config there and rebuilding the browser with its URL.

## Verification

Check login/logout on both registered origins. Create a workspace, refresh and
confirm it persists. Accept an invitation from a second account; verify that an
uninvited account cannot read the workspace or queue commands. Pair a runner,
create a project and start a terminal; revoke the runner and confirm subsequent
commands fail. Unit tests exercise membership isolation, invitation expiry,
revocation/replay and scoped machine credentials.

Official references: [Auth0 React quickstart](https://auth0.com/docs/quickstart/spa/react),
[Convex Auth0 integration](https://docs.convex.dev/auth/auth0),
[Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/get-started/).
