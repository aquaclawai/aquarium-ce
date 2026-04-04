---
phase: 04-template-portability
plan: 02
subsystem: extension-lifecycle
tags: [extensions, skills, plugins, startup, phase3-replay, seedConfig]
dependency_graph:
  requires: []
  provides: [3-phase-startup-model, phase1-skills-in-seedconfig, phase3-pending-replay]
  affects: [instance-manager, extension-lifecycle, openclaw-adapter]
tech_stack:
  added: []
  patterns: [3-phase startup model, non-blocking replay loop, backward-compat wrapper]
key_files:
  created: []
  modified:
    - apps/server/src/agent-types/openclaw/adapter.ts
    - apps/server/src/services/extension-lifecycle.ts
    - apps/server/src/services/instance-manager.ts
decisions:
  - "getPendingExtensionsForReplay kept as deprecated backward-compat wrapper delegating to getPendingExtensions"
  - "Phase 3 replay in startInstanceAsync placed inside the main try block so errors are non-fatal (no separate try block needed)"
  - "replayPendingExtensions calls installSkill/installPlugin which handle status transitions internally; only failed cases need manual updateSkillStatus/updatePluginStatus"
metrics:
  duration_minutes: 10
  completed_date: "2026-04-04T04:59:49Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 4 Plan 02: 3-Phase Startup Model Summary

**One-liner:** 3-phase startup model wired end-to-end — seedConfig now includes active/degraded skills (Phase 1), and pending extensions are replayed after reconciliation (Phase 3) via new `replayPendingExtensions` function.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend seedConfig to include managed skills (Phase 1) | 78de85a | adapter.ts |
| 2 | Phase 3 pending replay — extend lifecycle service + wire into startInstanceAsync | 74e2b2d | extension-lifecycle.ts, instance-manager.ts |

## What Was Built

### Task 1 — seedConfig Phase 1 (adapter.ts)

Added managed skills loading in `seedConfig` after the existing security config assignment. Queries `instance_skills` WHERE `status IN ('active', 'degraded')` and merges entries into `cfg.skills.entries`. Pending, installed, failed, and disabled skills are excluded — per PRD §5.4, Phase 1 config is active/degraded only.

### Task 2 — Phase 3 pending replay (extension-lifecycle.ts + instance-manager.ts)

**extension-lifecycle.ts changes:**
- Added `getPendingExtensions(instanceId)` returning `{ skills: InstanceSkill[], plugins: InstancePlugin[] }` — queries both `instance_skills` and `instance_plugins` for `status = 'pending'`
- Deprecated `getPendingExtensionsForReplay` as a backward-compat wrapper delegating to `getPendingExtensions`
- Added `replayPendingExtensions(instanceId, controlEndpoint, authToken, userId)` — iterates pending skills via `installSkill` and pending plugins via `installPlugin`, wrapping each in try/catch. Failures are logged and tracked but never thrown. Returns `{ installed, failed, needsCredentials }` for observability.

**instance-manager.ts changes:**
- Updated import to include `replayPendingExtensions`
- Added Phase 1 comment block before `seedConfig` call
- Renamed Phase 2 comment to "boot + reconcile" for clarity
- Added Phase 3 block after Phase 2 reconciliation: calls `replayPendingExtensions`, logs results if any extensions were processed, non-fatal error handling

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium` passes
- seedConfig queries `instance_skills` for active/degraded skills and merges into `cfg.skills.entries`
- Phase 3 `replayPendingExtensions` call exists in `startInstanceAsync` after Phase 2 reconciliation
- `getPendingExtensions` covers both plugins and skills with proper row mapping

## Self-Check: PASSED

Files exist:
- FOUND: apps/server/src/agent-types/openclaw/adapter.ts
- FOUND: apps/server/src/services/extension-lifecycle.ts
- FOUND: apps/server/src/services/instance-manager.ts

Commits exist:
- FOUND: 78de85a (Task 1 - seedConfig skills)
- FOUND: 74e2b2d (Task 2 - Phase 3 replay)
