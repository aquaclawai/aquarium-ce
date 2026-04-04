---
phase: 06-offline-resilience
plan: 01
subsystem: infra
tags: [artifact-cache, docker-exec, npm-pack, extension-lifecycle, i18n, react]

# Dependency graph
requires:
  - phase: 04-template-portability
    provides: replayPendingExtensions flow (Phase 3 replay) that this plan enhances
  - phase: 02-plugin-management
    provides: installPlugin and plugin-store.ts that this plan adds caching to
  - phase: 01-skill-management
    provides: installSkill and skill-store.ts that this plan adds caching to

provides:
  - artifact-cache service with cacheArtifact, isArtifactCached, getCachedArtifactPath
  - Cache-after-install in plugin-store.ts and skill-store.ts (OFFLINE-01)
  - Cache-preferred resolution in replayPendingExtensions (OFFLINE-02)
  - UI "Artifact cached locally" indicator in CredentialConfigPanel version info section

affects: [extension-lifecycle, plugin-store, skill-store, credential-config-panel, i18n]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OFFLINE cache pattern: fire-and-forget cacheArtifact after successful install, non-blocking"
    - "Soft cache probe: isArtifactCached uses docker exec test -e, returns false on any error"
    - "Cache-preferred replay: check cache first, use file: source on hit, fall through silently on miss"
    - "getInstanceRuntimeInfo: lightweight DB query in lifecycle service to avoid circular dep with instance-manager"

key-files:
  created:
    - apps/server/src/services/artifact-cache.ts
  modified:
    - apps/server/src/services/plugin-store.ts
    - apps/server/src/services/skill-store.ts
    - apps/server/src/services/extension-lifecycle.ts
    - apps/web/src/components/extensions/CredentialConfigPanel.tsx
    - apps/web/src/components/extensions/ExtensionsTab.tsx
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json

key-decisions:
  - "Plugin cache uses npm pack + mv rename to canonical {version}.tgz — npm pack names output differently from lockedVersion"
  - "exec optional guard: if engine.exec is undefined, warn-log and skip caching — Kubernetes engine may not support exec"
  - "getInstanceRuntimeInfo DB query in extension-lifecycle avoids importing getInstance (circular dep with instance-manager)"
  - "isCachedLocally indicator is client-side derived (non-bundled + lockedVersion + active/installed/disabled) — no new API needed"
  - "Pre-existing ESLint error in untracked useInstanceModels.ts deferred — out of scope for this plan"

requirements-completed: [OFFLINE-01, OFFLINE-02]

# Metrics
duration: 6min
completed: 2026-04-03
---

# Phase 06 Plan 01: Artifact Caching for Offline Resilience Summary

**Plugin/skill artifact caching via docker exec that stores tarballs in container persistent volume and enables cache-preferred replay on gateway restart, with a UI source indicator in the configure panel**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-03T06:54:56Z
- **Completed:** 2026-04-03T07:00:46Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- Created `artifact-cache.ts` service with `CACHE_BASE`, `getCachedArtifactPath`, `isArtifactCached`, and `cacheArtifact` exports
- Integrated cache-after-install in `installPlugin` and `installSkill` (fire-and-forget, never blocks install flow)
- Modified `replayPendingExtensions` to check local cache before hitting registry for both plugins and skills (OFFLINE-02)
- Added "Artifact cached locally" indicator to `CredentialConfigPanel` version info section, with all 6 locale translations

## Task Commits

1. **Task 1: Create artifact-cache service and integrate cache-after-install** - `d4b7129` (feat)
2. **Task 2: Cache-preferred resolution on replay + UI cached indicator + i18n** - `ffa6c6d` (feat)

## Files Created/Modified

- `apps/server/src/services/artifact-cache.ts` - New cache service: CACHE_BASE const, getCachedArtifactPath (pure string), isArtifactCached (docker exec test -e), cacheArtifact (npm pack for plugins, cp -r for skills)
- `apps/server/src/services/plugin-store.ts` - Added cacheArtifact fire-and-forget after version pinning in installPlugin
- `apps/server/src/services/skill-store.ts` - Added cacheArtifact fire-and-forget with lightweight DB query for runtimeId/deploymentTarget in installSkill
- `apps/server/src/services/extension-lifecycle.ts` - Added getInstanceRuntimeInfo helper, cache-preferred resolution in replayPendingExtensions for both plugins and skills
- `apps/web/src/components/extensions/CredentialConfigPanel.tsx` - Added isBundled prop, isCachedLocally derived state, cached indicator row in version info section
- `apps/web/src/components/extensions/ExtensionsTab.tsx` - Pass isBundled={source?.type === 'bundled'} to both CredentialConfigPanel usages
- `apps/web/src/i18n/locales/en.json` — Added `extensions.version.cachedLocally`
- `apps/web/src/i18n/locales/zh.json` — Added `extensions.version.cachedLocally`
- `apps/web/src/i18n/locales/fr.json` — Added `extensions.version.cachedLocally`
- `apps/web/src/i18n/locales/de.json` — Added `extensions.version.cachedLocally`
- `apps/web/src/i18n/locales/es.json` — Added `extensions.version.cachedLocally`
- `apps/web/src/i18n/locales/it.json` — Added `extensions.version.cachedLocally`

## Decisions Made

- Plugin cache uses `npm pack` then renames result to canonical `{version}.tgz` — npm pack names the output by package name, not version, so a rename step is needed for deterministic look-ups
- `exec` is optional on the `RuntimeEngine` interface; guard with `if (!engine.exec)` and warn-log to handle Kubernetes or other engines without exec support
- `getInstanceRuntimeInfo` is a lightweight DB query inside `extension-lifecycle.ts` rather than importing `getInstance` — avoids the circular dep that `getInstance` would create with `instance-manager.ts`
- The `isCachedLocally` indicator is purely client-side derived (no new API needed): if extension is non-bundled, has a lockedVersion, and is in active/installed/disabled state, it was successfully installed and therefore cached

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added exec availability guard in cacheArtifact and isArtifactCached**
- **Found during:** Task 1 (Creating artifact-cache.ts)
- **Issue:** `RuntimeEngine.exec` is declared optional (`exec?`) in types.ts — calling it directly without checking would throw if engine doesn't support exec (e.g., Kubernetes)
- **Fix:** Added `if (!engine.exec) return false` (isArtifactCached) and `if (!engine.exec) { warn; return }` (cacheArtifact)
- **Files modified:** `apps/server/src/services/artifact-cache.ts`
- **Verification:** TypeScript compiles cleanly with no errors
- **Committed in:** d4b7129 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Guard is a correctness requirement — without it, Kubernetes deployments would throw instead of skipping cache. No scope creep.

## Issues Encountered

Pre-existing ESLint error in untracked file `apps/web/src/hooks/useInstanceModels.ts` (line 21: setState sync in effect). This file is not tracked in git and is unrelated to any changes in this plan. Logged to `deferred-items.md` in phase directory. The modified files in this plan (`CredentialConfigPanel.tsx`, `ExtensionsTab.tsx`) pass lint cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Milestone v1.1 Plugin & Skill Marketplace is fully complete — this was the final plan of the final phase
- All 6 phases delivered: skill management, plugin management, ClawHub trust policy, template portability, OAuth/advanced auth, offline resilience
- The artifact caching infrastructure is in place; real-world effectiveness depends on gateway container supporting npm pack and having /home/node/.openclaw/ as a persistent volume

---
*Phase: 06-offline-resilience*
*Completed: 2026-04-03*

## Self-Check: PASSED

- artifact-cache.ts: FOUND
- plugin-store.ts: FOUND
- extension-lifecycle.ts: FOUND
- CredentialConfigPanel.tsx: FOUND
- 06-01-SUMMARY.md: FOUND
- Commit d4b7129: FOUND
- Commit ffa6c6d: FOUND
