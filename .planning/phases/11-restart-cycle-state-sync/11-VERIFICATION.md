---
phase: 11-restart-cycle-state-sync
verified: 2026-04-05T04:10:00Z
status: passed
score: 14/14 must-haves verified
re_verification: false
---

# Phase 11: Restart Cycle State Sync Verification Report

**Phase Goal:** The platform correctly handles gateway restarts triggered by config changes — detecting shutdown, maintaining connection continuity, and reconciling actual gateway state with DB records after every reconnect
**Verified:** 2026-04-05T04:10:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths — Plan 01

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When gateway sends shutdown event, instance status becomes 'restarting' (not 'stopped' or 'error') | VERIFIED | `gateway-event-relay.ts:282-299` detects `msg.event === 'shutdown'`, calls `updateStatus(instanceId, 'restarting', {}, 'Restarting...')` |
| 2 | Dashboard shows static 'Restarting...' text with spinner for restarting instances | VERIFIED | `DashboardPage.tsx:150` includes `'restarting'` in spinner condition; `index.css:1188` has `.status-restarting`; `en.json` has `common.status.restarting` |
| 3 | If gateway does not reconnect within 60 seconds, instance status becomes 'error' | VERIFIED | `gateway-event-relay.ts:289-298` sets `setTimeout(..., 60_000)` that calls `updateStatus(instanceId, 'error', {}, 'Gateway restart timed out')` |
| 4 | Health monitor does not raise alerts or transition status for 'restarting' instances | VERIFIED | `health-monitor.ts:82-83` has explicit `if (row.status === 'restarting') continue;` guard inside `checkInstances`; slow loop filters `['running', 'error']` (not 'restarting') so double protection |
| 5 | Reconnect uses exponential backoff (1s, 2s, 4s… capped at 30s) with unlimited retries during expected restart window | VERIFIED | `gateway-event-relay.ts:494-505`: `Math.min(1000 * Math.pow(2, this.retryCount - 1), 30_000)`, unlimited when `this.expectedRestart` is true |
| 6 | reconcileConnections poll does not close connections for 'restarting' instances | VERIFIED | `gateway-event-relay.ts:620-623`: `whereIn('status', ['running', 'restarting'])` — restarting instances are kept in `runningIds` and their connections are preserved |

### Observable Truths — Plan 02

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | After any WebSocket reconnect, platform queries config.get, tools.catalog, skills.status and updates DB | VERIFIED | `syncGatewayState` (instance-manager.ts:310) calls `reconcileExtensions` (which calls `tools.catalog` + `config.get` + `skills.status`) then `config.get` for hash, then `syncWorkspaceViaGateway` |
| 8 | reconcileExtensions runs on every reconnect (not just boot), promoting/demoting skills and plugins | VERIFIED | `gateway-event-relay.ts:242` calls `syncGatewayState` on every successful reconnect; `syncGatewayState:317` calls `reconcileExtensions(instanceId, '', '')` |
| 9 | reconcileExtensions calls skills.status (not skills.list) so skill reconciliation actually works | VERIFIED | `extension-lifecycle.ts:151`: `gatewayCall(instanceId, 'skills.status', {}, 15_000)` — no remaining `skills.list` references |
| 10 | Workspace files are synced from gateway via agents.files.list + agents.files.get after reconnect | VERIFIED | `syncWorkspaceViaGateway` (instance-manager.ts:245): `gatewayCall(instanceId, 'agents.files.list', ...)` + `gatewayCall(instanceId, 'agents.files.get', ...)` with Docker exec fallback |
| 11 | Config hash in DB is updated to match gateway's authoritative hash after reconnect | VERIFIED | `syncGatewayState:328-337`: calls `config.get`, reads `configResult.hash`, updates `config_hash` in DB |
| 12 | Instance stays in 'restarting' until full state sync completes, then transitions to 'running' | VERIFIED | `gateway-event-relay.ts:239-258`: `syncGatewayState(...).then(() => { if (wasExpectedRestart) updateStatus(..., 'running', ...) })` — running only set after sync completes |
| 13 | If state sync fails, instance still transitions to 'running' (stale DB better than stuck 'restarting') | VERIFIED | `gateway-event-relay.ts:250-257`: `.catch((err) => { ... if (wasExpectedRestart) updateStatus(..., 'running', ...) })` |
| 14 | Boot-time reconciliation in startInstanceAsync is preserved (reconnect is additional, not replacement) | VERIFIED | `instance-manager.ts:696`: original `reconcileExtensions(id, controlEndpoint, instance.authToken)` call in `startInstanceAsync` unchanged |

**Score:** 14/14 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/shared/src/types.ts` | 'restarting' in InstanceStatus union | VERIFIED | Line 3: `'restarting'` present in union; `npm run build -w @aquarium/shared` passes clean |
| `apps/server/src/services/gateway-event-relay.ts` | Shutdown event handling, expectedRestart flag, exponential backoff, 60s timeout | VERIFIED | All four mechanisms present and wired |
| `apps/server/src/services/health-monitor.ts` | Skip 'restarting' instances in checkInstances | VERIFIED | Lines 82-83: explicit guard present |
| `apps/web/src/index.css` | .status-restarting CSS rule | VERIFIED | Line 1188: `.status-restarting { color: var(--color-warning); background: rgba(217, 119, 6, 0.1); }` |
| `apps/web/src/pages/DashboardPage.tsx` | Spinner for 'restarting' status | VERIFIED | Line 150: `'restarting'` in spinner condition |
| `apps/server/src/services/instance-manager.ts` | syncGatewayState() orchestrator, syncWorkspaceViaGateway() helper, exported | VERIFIED | Lines 245 and 310: both functions exported |
| `apps/server/src/services/gateway-event-relay.ts` | Post-reconnect syncGatewayState call blocking running transition | VERIFIED | Lines 242-258: full chain wired |
| `apps/server/src/services/extension-lifecycle.ts` | Fixed RPC call: skills.status instead of skills.list, correct response field mapping | VERIFIED | Line 151: `skills.status`; line 170: `skill.name`; `GatewaySkillInfo.name` (not `skillId`) |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `gateway-event-relay.ts` | `instance-manager.ts updateStatus` | import + call on shutdown event | WIRED | `import { ..., updateStatus, ... }` at line 10; `updateStatus(this.instanceId, 'restarting', ...)` at line 285 |
| `gateway-event-relay.ts` | `reconcileConnections query` | `whereIn status includes 'restarting'` | WIRED | Line 621: `.whereIn('status', ['running', 'restarting'])` |
| `gateway-event-relay.ts connect response` | `syncGatewayState(instanceId)` | imported function call after reconnect | WIRED | `import { ..., syncGatewayState }` at line 10; called at line 242 |
| `syncGatewayState` | `reconcileExtensions(instanceId)` | direct function call | WIRED | `instance-manager.ts:317`: `await reconcileExtensions(instanceId, '', '')` |
| `reconcileExtensions` | `gatewayCall(instanceId, 'skills.status')` | RPC for skill state | WIRED | `extension-lifecycle.ts:151`: `gatewayCall(instanceId, 'skills.status', {}, 15_000)` |
| `syncGatewayState` | `gatewayCall(instanceId, 'config.get')` | RPC for config hash sync | WIRED | `instance-manager.ts:328`: `gatewayCall(instanceId, 'config.get', {}, 15_000)` |
| `syncGatewayState` | `agents.files.list + agents.files.get` | gatewayCall for workspace sync | WIRED | `instance-manager.ts:247,277`: both RPC calls present in `syncWorkspaceViaGateway` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SYNC-01 | Plan 01 | Platform detects gateway `shutdown` event and marks instance as "restarting" | SATISFIED | `gateway-event-relay.ts:282-299`: shutdown event detection sets 'restarting' status |
| SYNC-02 | Plan 02 | After WebSocket reconnection, platform queries gateway state and reconciles DB records | SATISFIED | `syncGatewayState` calls `config.get`, `tools.catalog`, `skills.status`; updates `config_hash` and workspace files in DB |
| SYNC-03 | Plan 02 | Extension reconciliation runs on every reconnect (not just at boot) | SATISFIED | `syncGatewayState` called on every reconnect in connect response handler; calls `reconcileExtensions` with fixed `skills.status` RPC |
| SYNC-04 | Plan 02 | After a `config.patch`-triggered restart, platform verifies success by checking `tools.catalog` for expected plugins/skills | SATISFIED | `reconcileExtensions` (called by `syncGatewayState` after reconnect) calls `tools.catalog` + `config.get` at `extension-lifecycle.ts:233-235`; demotes plugins/skills missing from gateway |
| SYNC-05 | Plans 01+02 | Persistent WebSocket connection auto-reconnects after gateway restart with full state reconciliation | SATISFIED | Exponential backoff in `scheduleReconnect`, unlimited retries during `expectedRestart`, `syncGatewayState` on every successful reconnect |

All 5 SYNC requirements are satisfied. No orphaned requirements (all phase 11 requirements were claimed in plan frontmatter).

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/server/src/services/gateway-event-relay.ts` | 14 | `RECONNECT_DELAY_MS = 5_000` declared but unused (scheduleReconnect now uses exponential backoff) | Info | Dead constant — no runtime impact, minor tidiness issue |

No blockers or warnings. The unused constant is cosmetic only.

---

## Human Verification Required

### 1. End-to-end restart cycle in running instance

**Test:** With a running instance, trigger `config.patch` (e.g., change a setting in the UI). Observe the instance status badge in the Dashboard.
**Expected:** Badge changes to "Restarting..." with a spinner during the SIGUSR1 restart cycle, then returns to "Running" within ~5-10 seconds. No "error" or "stopped" flash.
**Why human:** Requires a live Docker + gateway environment; Playwright CI skips Docker-dependent tests.

### 2. 60-second timeout fallback

**Test:** Kill the gateway container while an instance is in "restarting" state (e.g., `docker stop <container>` immediately after sending SIGUSR1). Wait 60 seconds.
**Expected:** Instance transitions to "error" with status message "Gateway restart timed out".
**Why human:** Requires controlled container kill and real-time observation.

### 3. AgentSidebar / ChatHubPage i18n for fr/de/es/it locales

**Test:** Switch UI language to French/German/Spanish/Italian. Navigate to a running instance and trigger a restart.
**Expected:** AgentSidebar and ChatHubPage show a localized "restarting" label (from `chatHub.status.restarting`). Note: `fr/de/es/it` do NOT have `chatHub.status.restarting` keys — `t()` falls back to the raw string `'restarting'` (the second argument). This is functional but untranslated in the sidebar/chat hub for these 4 locales.
**Why human:** Requires language switcher + live restart + visual inspection.

> Note: The gap in `chatHub.status.restarting` for fr/de/es/it is a minor i18n completeness gap. `t('chatHub.status.restarting', inst.status)` falls back to `'restarting'` (English) in those locales. The plan's stated requirement was `common.status` + `agents.status` — `common.status.restarting` is present in all 6 locales. The `chatHub.status` key appears to have been added in a prior phase for en/zh only. This does not block phase 11's goal.

---

## Gaps Summary

No gaps blocking goal achievement. All 14 must-have truths verified, all 5 SYNC requirements satisfied, all key links confirmed wired. The single cosmetic issue (unused `RECONNECT_DELAY_MS` constant) and the minor i18n incompleteness for `chatHub.status.restarting` in fr/de/es/it do not affect correctness.

All 4 task commits confirmed in git:
- `369c598` — feat(11-01): add 'restarting' to InstanceStatus and export updateStatus
- `d66f088` — feat(11-01): shutdown event handling, exponential backoff, health monitor skip, restarting UI
- `007c43a` — feat(11-02): fix skills.status RPC bug and add syncGatewayState orchestrator
- `0b9f132` — feat(11-02): wire syncGatewayState into PersistentGatewayClient reconnect

---

_Verified: 2026-04-05T04:10:00Z_
_Verifier: Claude (gsd-verifier)_
