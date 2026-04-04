---
phase: 02-plugin-management
plan: "02"
subsystem: api
tags: [express, rest-api, plugins, extension-management]

# Dependency graph
requires:
  - phase: 02-plugin-management
    plan: "01"
    provides: "plugin-store service with full CRUD operations (install, activate, enable, disable, uninstall)"
provides:
  - "Plugin REST API: 7 route handlers at /api/instances/:id/plugins/*"
  - "GET /plugins — managed DB plugins + gateway built-ins (soft-log RPC failure)"
  - "GET /plugins/catalog — available plugins with search/category filtering"
  - "GET /plugins/:pluginId — single plugin read for RestartBanner polling"
  - "POST /plugins/install — artifact installation via plugin-store service"
  - "POST /plugins/:pluginId/activate — activation triggering gateway restart"
  - "PUT /plugins/:pluginId — enable/disable toggle"
  - "DELETE /plugins/:pluginId — uninstall with gateway restart"
  - "All mutations return 409 on LockConflictError"
affects:
  - 03-plugin-frontend
  - frontend-extensions-tab

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route catalog-before-parameterized: GET /catalog defined before GET /:pluginId to prevent route capture"
    - "Soft-log RPC failure pattern: plugins.list failure logged as warning, gatewayBuiltins returns empty array"
    - "Auth via req.auth!.userId (requireAuth middleware, same as skills.ts)"

key-files:
  created:
    - apps/server/src/routes/plugins.ts
  modified:
    - apps/server/src/server-core.ts

key-decisions:
  - "PLUG-04 confirmed: extension-credentials route already handles extensionKind='plugin' at line 59 — no modification needed"
  - "GET /plugins/catalog defined before GET /plugins/:pluginId — prevents 'catalog' being captured as a pluginId parameter"
  - "plugins.list RPC failure soft-logged (warn) in GET /plugins — older gateway versions may not support the method (per 02-01 decision)"
  - "installPlugin service does not require instance.controlEndpoint at route layer — service handles it internally"

patterns-established:
  - "Plugin route pattern mirrors skill route pattern exactly — same auth, error handling, LockConflictError 409 response"
  - "Route ordering: fixed literal paths (install, catalog) before parameterized paths (:pluginId)"

requirements-completed: [PLUG-01, PLUG-02, PLUG-04, PLUG-05, PLUG-08, PLUG-09]

# Metrics
duration: 2min
completed: "2026-04-04"
---

# Phase 2 Plan 02: Plugin REST API Routes Summary

**Express plugin REST API with 7 handlers bridging plugin-store service to HTTP — list, catalog, single-read, install, activate, toggle, and uninstall**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-04T02:04:53Z
- **Completed:** 2026-04-04T02:06:30Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Created `routes/plugins.ts` with all 7 plugin REST route handlers following the established `skills.ts` pattern
- Mounted plugin routes at `/api/instances` in `server-core.ts`
- Confirmed PLUG-04 compatibility: `extension-credentials` route already validates `extensionKind === 'plugin'` at line 59

## Task Commits

Each task was committed atomically:

1. **Task 1: Create plugin REST API routes and mount in server-core** - `829e4e4` (feat)

**Plan metadata:** _(to be recorded)_

## Files Created/Modified

- `apps/server/src/routes/plugins.ts` - Plugin CRUD REST API with 7 route handlers; GET list/catalog/single, POST install/activate, PUT toggle, DELETE uninstall
- `apps/server/src/server-core.ts` - Added `import pluginRoutes` and `app.use('/api/instances', pluginRoutes)` mount after skillRoutes

## Decisions Made

- PLUG-04 confirmed without modification: `extension-credentials.ts` line 59 already validates `(extensionKind !== 'skill' && extensionKind !== 'plugin')`, so plugins are supported natively.
- Catalog route placed before parameterized `:pluginId` route to prevent Express capturing "catalog" as a pluginId parameter.
- `plugins.list` RPC failure in `GET /plugins` is soft-logged (warn level) rather than throwing — per 02-01 decision that older gateway versions may not support the method.
- `installPlugin` service does not require the instance to be running at the route layer — the service handles the `controlEndpoint` check internally (unlike `skillStore.installSkill` which requires `controlEndpoint` at the route).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plugin REST API is complete and TypeScript-clean
- Frontend (Phase 3) can now call all 7 endpoints for plugin management UI
- `GET /plugins/:pluginId` is ready for RestartBanner polling pattern

---
*Phase: 02-plugin-management*
*Completed: 2026-04-04*
