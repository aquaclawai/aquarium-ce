---
phase: 04-template-portability
plan: 03
subsystem: api
tags: [trust, templates, plugins, skills, sqlite, lifecycle]

# Dependency graph
requires:
  - phase: 04-01
    provides: "TemplateExtensionDeclaration[] in export response, extension lifecycle tables"
  - phase: 03-clawhub-trust-policy
    provides: "evaluateTrustPolicy function, trust tier computation, TrustEvaluation type"
provides:
  - "instantiateTemplate evaluates trust for each extension at import time (no deferred scanning)"
  - "Lifecycle rows (instance_plugins/instance_skills) inserted only for extensions passing trust"
  - "Blocked extensions returned in blockedExtensions[] with reason (hard-blocked)"
  - "Community extensions without override returned in requiresTrustOverride[] (soft-blocked)"
  - "InstantiateTemplateResponse extended with blockedExtensions, requiresTrustOverride, extensionsImported"
affects: [template-import-routes, frontend-import-ui, trust-policy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Trust re-evaluation at import time using null signals (bundled=pass, unscanned=block, community=check override)"
    - "Format discrimination: TemplateExtensionDeclaration[] detected by presence of 'kind' field vs legacy PluginDependency[]"
    - "generateDependencySetupCommands skips plugins/skills when new extension format detected (MCP only)"

key-files:
  created: []
  modified:
    - packages/shared/src/types.ts
    - apps/server/src/services/template-store.ts

key-decisions:
  - "plugin_dependencies ContentRow column reused for new TemplateExtensionDeclaration[] — discriminated by presence of 'kind' field, no schema migration needed"
  - "Trust re-evaluation uses null signals at import time — no gateway running during instantiation, non-bundled extensions default to unscanned"
  - "Community tier split: without override -> requiresTrustOverride[] (can be resolved post-import); unscanned/scan-failed -> blockedExtensions[] (permanent block)"
  - "Lifecycle rows use 'pending' status for enabled extensions and 'disabled' for disabled — Phase 3 startup reconciler activates pending extensions"

patterns-established:
  - "Synchronous trust gate: all extensions evaluated before any lifecycle row is written"
  - "Non-throwing import: blocked extensions never throw — they accumulate in response arrays, caller decides how to surface to user"

requirements-completed: [TMPL-06, TMPL-07]

# Metrics
duration: 4min
completed: 2026-04-04
---

# Phase 4 Plan 3: Trust Re-evaluation at Template Import Summary

**instantiateTemplate evaluates trust policy per extension at import time using evaluateTrustPolicy, inserting lifecycle rows only for passing extensions and returning blocked/override-required lists in the response**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-04T05:03:49Z
- **Completed:** 2026-04-04T05:07:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended `InstantiateTemplateResponse` with `blockedExtensions[]`, `requiresTrustOverride[]`, and `extensionsImported` optional fields (backward compatible)
- Added format discrimination logic in `instantiateTemplate` to detect new `TemplateExtensionDeclaration[]` (has `kind` field) vs legacy `PluginDependency[]` in `content.plugin_dependencies`
- Synchronous `evaluateTrustPolicy(null signals)` loop: bundled/verified pass, unscanned hard-block, community check override
- Insert `instance_plugins` or `instance_skills` lifecycle rows only for extensions that pass trust; blocked extensions accumulate in response arrays
- `generateDependencySetupCommands` skips plugins/skills for new-format templates (MCP servers only)
- Legacy templates without new extension format continue working via existing setup command path

## Task Commits

1. **Task 1: Extend shared types for import response with trust warnings** - `dcb1391` (feat)
2. **Task 2: Synchronous trust re-evaluation and lifecycle row insertion** - `07884ce` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `packages/shared/src/types.ts` - Extended `InstantiateTemplateResponse` with blockedExtensions, requiresTrustOverride, extensionsImported optional fields
- `apps/server/src/services/template-store.ts` - Added evaluateTrustPolicy import, format discrimination, trust evaluation loop, lifecycle row insertion, extended return value

## Decisions Made
- `plugin_dependencies` ContentRow column reused for new `TemplateExtensionDeclaration[]` — discriminated by presence of `kind` field; no schema migration needed for this plan
- Trust re-evaluation uses `null` signals at import time — no gateway running during instantiation, so non-bundled extensions default to `unscanned` tier and are blocked unless they have an existing DB override
- Community tier split: without override -> `requiresTrustOverride[]` (caller can prompt admin to approve post-import); unscanned/scan-failed -> `blockedExtensions[]` (permanent block, no override path)
- Lifecycle rows use `pending` status for enabled extensions (Phase 3 startup reconciler activates them) and `disabled` for disabled extensions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Template import trust gate is complete; blocked extension arrays are available in the response for the frontend to surface warnings to the user
- Phase 4 Plan 4 (if any) can rely on `blockedExtensions[]` and `requiresTrustOverride[]` in instantiateTemplate response
- Trust override UI from Phase 3 can be reused for handling `requiresTrustOverride[]` items post-import

---
*Phase: 04-template-portability*
*Completed: 2026-04-04*
