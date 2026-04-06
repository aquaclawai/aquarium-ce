---
phase: 08-gateway-simplification
plan: 01
subsystem: infra
tags: [docker, runtime, tcp-proxy, gateway, bind-lan]

# Dependency graph
requires:
  - phase: 07-plugin-extension-fixes
    provides: Bug-free plugin management that this simplification builds on
provides:
  - Direct Docker port mapping without TCP proxy intermediary
  - Simplified container entrypoint (exec gateway only, no background proxy)
  - Health checks connecting to gateway port directly
affects: [runtime, docker, instance-lifecycle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct port binding via gateway native bind:lan instead of TCP proxy workaround"

key-files:
  created: []
  modified:
    - apps/server/src/runtime/docker.ts
    - openclaw/docker/base/docker-entrypoint.sh

key-decisions:
  - "Removed TCP proxy entirely -- gateway bind:lan makes it obsolete"
  - "Kept entrypoint functionally unchanged -- only added documentation comment"

patterns-established:
  - "Gateway containers use direct port mapping (hostPort -> containerPort) with no intermediary proxy"

requirements-completed: [SIMP-01, SIMP-03]

# Metrics
duration: 2min
completed: 2026-04-04
---

# Phase 8 Plan 1: Remove TCP Proxy Summary

**Removed TCP proxy injection from Docker runtime -- gateway native bind:lan enables direct port mapping with no intermediary process**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-04T10:27:38Z
- **Completed:** 2026-04-04T10:30:04Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Removed all TCP proxy code from docker.ts (PROXY_PORT_OFFSET, proxyPairs, proxyScript, proxy comment block)
- Simplified port mapping from hostPort -> proxyPort (containerPort + 1) to hostPort -> containerPort (direct)
- Fixed health check to connect to gateway port directly instead of proxy port
- Simplified container entrypoint from two-process (proxy + gateway) to single-process (gateway only)
- Confirmed docker-entrypoint.sh has no proxy logic and documented its minimality

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove TCP proxy injection from docker.ts** - `82620a3` (feat)
2. **Task 2: Confirm and document entrypoint minimality** - `133de59` (docs)

## Files Created/Modified
- `apps/server/src/runtime/docker.ts` - Removed TCP proxy injection: simplified port mapping, health check, and entrypoint
- `openclaw/docker/base/docker-entrypoint.sh` - Added header comment documenting purpose and bind:lan strategy

## Decisions Made
- Removed TCP proxy entirely rather than making it configurable -- the official gateway's native `bind:lan` support makes the proxy fully obsolete
- Kept docker-entrypoint.sh functionally identical -- the entrypoint already had no proxy code (that was injected by docker.ts), so only a documentation comment was added

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- This is the final plan in the final phase of the v1.2 milestone
- All gateway simplification work is complete
- New and restarted instances will use direct port mapping
- Already-running instances are unaffected (they keep their existing containers)

## Self-Check: PASSED

- [x] 08-01-SUMMARY.md exists
- [x] docker.ts modified (no proxy references)
- [x] docker-entrypoint.sh modified (header comment added)
- [x] Commit 82620a3 exists (Task 1)
- [x] Commit 133de59 exists (Task 2)

---
*Phase: 08-gateway-simplification*
*Completed: 2026-04-04*
