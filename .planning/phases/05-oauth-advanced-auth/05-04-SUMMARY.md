---
phase: 05-oauth-advanced-auth
plan: "04"
subsystem: auth
tags: [oauth, express, typescript, instance-manager]

requires:
  - phase: 05-oauth-advanced-auth
    provides: OAuth proxy route, OAuthProxySession, callback handler, addCredential sentinel write

provides:
  - OAuth callback correctly resolves the instance via session.userId instead of session.instanceId
  - Token exchange RPC, sentinel credential write, and extension status update are now reachable

affects: [05-oauth-advanced-auth]

tech-stack:
  added: []
  patterns:
    - "OAuthProxySession stores userId at initiate time so the callback can authenticate getInstance without relying on the request context (callback is browser-redirected, not user-authenticated)"

key-files:
  created: []
  modified:
    - apps/server/src/routes/oauth-proxy.ts

key-decisions:
  - "userId stored in OAuthProxySession at POST /initiate time so the GET /callback (which carries no auth cookie) can pass the correct userId to getInstance"

patterns-established: []

requirements-completed: [OAUTH-01, OAUTH-02]

duration: 1min
completed: "2026-04-04"
---

# Phase 05 Plan 04: OAuth Callback userId Bug Fix Summary

**Three-line fix: added userId to OAuthProxySession, stored req.auth!.userId at initiate, corrected callback getInstance(instanceId, session.userId) from session.instanceId**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-04T06:51:52Z
- **Completed:** 2026-04-04T06:52:46Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- OAuthProxySession interface now carries userId alongside instanceId
- Initiate handler persists the authenticated user's id into the session at creation time
- Callback handler no longer passes an instance UUID where a user UUID is required — getInstance returns a valid instance, unblocking token exchange, sentinel credential write, and extension activation

## Task Commits

1. **Task 1: Add userId to OAuthProxySession and fix callback getInstance call** - `6484dd9` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `apps/server/src/routes/oauth-proxy.ts` - Added userId field to OAuthProxySession, stored req.auth!.userId in oauthSessions.set, fixed getInstance(instanceId, session.userId)

## Decisions Made

None - followed plan as specified. The bug and fix were precisely described in the plan.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 05 OAuth advanced auth is complete; all four plans (01-04) executed
- Requirements OAUTH-01 and OAUTH-02 are satisfied: callback relays auth code to gateway for token exchange, writes oauth_token sentinel row, updates extension status to active

---
*Phase: 05-oauth-advanced-auth*
*Completed: 2026-04-04*
