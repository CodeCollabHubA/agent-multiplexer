# Authenticated shared workspaces

Approved scope: make Auth0 login and shared workspaces ready on the supplied Cloudflare URL. Invitations only; members have equal access and no roles.

## Global constraints
- Official Auth0 React SDK and Convex Auth0 provider. Never manual OAuth flows or browser client secrets.
- Shared workspace is a secured profile containing the existing project boards and terminal sessions. Membership is checked by Convex on every read/write; knowing a profile ID grants nothing.
- Existing anonymous profile records remain inaccessible, never automatically claimed.
- Invitations are single-use, expire after seven days, are revocable, and require authenticated acceptance. Copyable links, no automated email sending.
- A separately paired runner has a random revocable credential scoped to exactly one shared workspace. Store only its hash server-side. Browser members can enqueue/read; only a valid runner can publish state/output or consume commands.
- Runner store isolated by shared workspace ID; refuse anonymous relay operation. Disable unauthenticated local terminal websocket for paired runner.
- Preserve the user's .env.production.local and all unrelated changes. No roles, Auth0 Organizations or Management API required.

## Contracts
`spaces:list {}` returns `[{profileKey,name}]` for current identity.
`spaces:create {name}` -> `{profileKey,name}` initializes empty mirrored profile.
`spaces:rename {profileKey,name}` -> null.
`spaces:members {profileKey}` -> `[{id,name,email,isSelf}]`.
`spaces:leave {profileKey}` -> null; last member cannot leave.
`spaces:createInvite {profileKey,token}` -> `{id,expiresAt}`; client generates 32 random bytes base64url, server hashes. Token is bearer, authenticated recipient required.
`spaces:invites {profileKey}` -> `[{id,expiresAt,createdAt}]` for pending only; no token hashes returned.
`spaces:revokeInvite {profileKey,id}` -> null.
`spaces:acceptInvite {token}` -> `{profileKey,name}`. Consume atomically; existing member acceptance idempotent if still pending.
`spaces:pairMachine {profileKey,token}` -> null; rotates one runner credential, clears pending commands and stale presence. Client generates random token, displays once.
`spaces:revokeMachine {profileKey}` -> null.
`spaces:machine {profileKey}` -> `{paired:boolean}`.
All existing mux functions require profileKey. Browser read/enqueue: Auth0 member. Runner pushState/updateMachineStatus/pendingCommands/acknowledgeCommands/acknowledgeCommand/appendOutput/publishEvent: `machineToken` required and hash matched to profile. Reader endpoints may accept optional machineToken for runner startup verification if necessary; never allow a runner to enqueue.
Runner env: CONVEX_URL, CONVEX_PROFILE=<secure profileKey>, CONVEX_MACHINE_TOKEN. Never use VITE_ for credential. UI uses selected profile (not VITE_CONVEX_PROFILE).

## Tasks
1. Backend: convex/schema.ts, convex/auth.config.ts, convex/access.ts, convex/spaces.ts, convex/mux.ts and focused isolation/invitation/credential tests. Use additive schema. Verify every public endpoint unauth and cross-member rejection.
2. UI: official ConvexProviderWithAuth0, authenticated space selector/create/rename/leave, invitations and pairing UI; refactor Backend to use supplied authenticated client and dispose on switch/logout. Clear caches and no singleton leakage. Files src/ui/main.tsx, App.tsx, backend.ts, new workspace components/styles/tests. Explain offline runner and prevent false saved state.
3. Runner: scoped authenticated mirror, isolated store, reject direct unauthenticated ws when paired, tests. Files src/server/convex-mirror.ts,index.ts, configuration helper/tests.
4. Integration and deployment: full test/typecheck/build, focused browser check, independent security/spec review. Document setup and deploy Convex then Cloudflare static frontend with production public env. Verify live anonymous rejection, login redirect, real create/invite/pair flow if available authenticated session.

## Verification
npm test; npm run build; focused vitest per task. Browser live login + workspace management; test invite expiry/replay/revocation and cross-workspace isolation. No claim of authenticated end-to-end readiness without evidence.
