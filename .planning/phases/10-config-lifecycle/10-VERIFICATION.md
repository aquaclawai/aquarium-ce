---
phase: 10-config-lifecycle
verified: 2026-04-05T03:15:00Z
status: human_needed
score: 8/9 must-haves verified
human_verification:
  - test: "Confirm CFG-05 batch-semantics interpretation is accepted"
    expected: "Phase 10 implements rate-limit wait-and-retry (not proactive batching); multi-op batching is deferred to Phase 12 (EXT-03)"
    why_human: "ROADMAP success criterion 4 says 'batched into a single config.patch call' but CONTEXT.md explicitly scoped CFG-05 to wait-and-retry only for Phase 10. The planning context overrides the broad requirement text for this phase. Human confirmation that this scoping decision is accepted."
---

# Phase 10: Config Lifecycle Verification Report

**Phase Goal:** Config mutations for running instances operate on the gateway first and sync results back to DB, with correct merge-patch format, optimistic concurrency, and rate-limit enforcement
**Verified:** 2026-04-05T03:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Config change on a running instance sends config.patch to gateway first — if gateway rejects, DB is NOT updated | VERIFIED | `patchGatewayConfig` (instance-manager.ts:729-837): gateway-first loop; DB write only after successful `config.patch` (line 811); any non-retryable error throws immediately (line 832) |
| 2 | Config change on a stopped instance writes to DB only with no gateway call attempt | VERIFIED | instance-manager.ts:758-762: early return via `updateInstanceConfig` when `status !== 'running'` or no `controlEndpoint` |
| 3 | Stale baseHash conflicts are retried automatically up to 3 times by re-reading hash via config.get | VERIFIED | instance-manager.ts:765-833: `MAX_RETRIES = 3`, retry loop begins with `config.get` on each attempt; stale hash detected via `errMsg.includes('config changed since last load') \|\| errMsg.includes('CONFLICT')` at line 817 |
| 4 | Rate limit (429) errors cause the request to wait retryAfterMs then retry, not fail immediately | VERIFIED | instance-manager.ts:823-829: detects `errMsg.includes('rate limit')`, parses `retryAfterMs` from `/retry after (\d+)s/` regex, awaits `parsedMs + 1000` buffer before continuing retry loop |
| 5 | After successful config.patch, config.get is called and the authoritative hash is persisted to config_hash column | VERIFIED | instance-manager.ts:784-800: read-back via second `config.get` call; `authoritativeHash` stored to `config_hash` in DB update at line 799; fallback to pre-patch `baseHash` on read-back failure (with warning) |
| 6 | Extension credential injection uses { raw, baseHash } format instead of broken { path, value } format | VERIFIED | extension-credentials.ts:168-179: `config.get` for baseHash, `buildMergePatchFromPath` converts dot-path to nested object, `config.patch` called with `{ raw: JSON.stringify(patchObj), baseHash: cfgResult?.hash, note, restartDelayMs: 2000 }` |
| 7 | updateSecurityProfile for running instances delegates to patchGatewayConfig instead of calling reseedConfigFiles | VERIFIED | instance-manager.ts:386-418: for running instances, builds security delta via `seedConfig` (hooks, cron, models, approval), then calls `patchGatewayConfig(id, userId, securityDelta, ...)`; no `reseedConfigFiles` call in this function |
| 8 | Channel configure/disconnect for running instances pushes credential changes through patchGatewayConfig instead of reseedAndPatch | VERIFIED | channels.ts:16-49: `reseedAndPatch` deleted, replaced by `pushChannelConfigToGateway`; all 4 call sites (lines 477, 515, 552, 579) use the new helper which calls `patchGatewayConfig` |
| 9 | reseedConfigFiles is only called from boot and health-monitor recovery — not from any config update path | PARTIAL | `reseedConfigFiles` is defined in instance-manager.ts:240 and called only from health-monitor.ts (lines 120, 276 — auto-recovery and config integrity fix). NOT called from `patchGatewayConfig`, `updateSecurityProfile`, or channels.ts. However, `startInstanceAsync` does NOT call `reseedConfigFiles` — it seeds files inline via `engine.writeFiles`. The CFG-06 requirement says "only used during initial container startup (seed)" but the actual boot path (startInstanceAsync) does not use `reseedConfigFiles`. The function is exclusively used by health-monitor recovery paths. This is intentional per CONTEXT.md but differs from the stated requirement scope. |

**Score:** 8/9 truths fully verified (1 partial — see CFG-06 below)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/services/instance-manager.ts` | Gateway-first patchGatewayConfig with retry, rate-limit, and hash read-back | VERIFIED | Contains `gatewayCall(instanceId, 'config.patch'` at line 774; full gateway-first loop with MAX_RETRIES=3, rate-limit delay, stale-hash retry, read-back |
| `apps/server/src/routes/extension-credentials.ts` | Correct merge-patch format for credential injection | VERIFIED | Contains `raw: JSON.stringify` at line 175; `buildMergePatchFromPath` helper at lines 16-27; config.get + config.patch + read-back pattern |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/server/src/services/instance-manager.ts` | `apps/server/src/agent-types/openclaw/gateway-rpc.ts` | `gatewayCall(instanceId, 'config.get'\|'config.patch')` | WIRED | Line 25: `import { gatewayCall } from '../agent-types/openclaw/gateway-rpc.js'`; used at lines 748, 769, 774, 786 |
| `apps/server/src/routes/extension-credentials.ts` | `apps/server/src/agent-types/openclaw/gateway-rpc.ts` | `gatewayCall(instanceId, 'config.get'\|'config.patch')` | WIRED | Line 7: `import { gatewayCall } from '../agent-types/openclaw/gateway-rpc.js'`; used at lines 168, 174, 183 |
| `apps/server/src/services/instance-manager.ts:updateSecurityProfile` | `apps/server/src/services/instance-manager.ts:patchGatewayConfig` | Direct function call with security config delta | WIRED | `patchGatewayConfig(id, userId, securityDelta, ...)` at line 414 |
| `apps/server/src/routes/channels.ts` | `apps/server/src/services/instance-manager.ts:patchGatewayConfig` | Direct function call via `pushChannelConfigToGateway` | WIRED | Line 3: imports `patchGatewayConfig`; used at line 45 inside `pushChannelConfigToGateway`; called at lines 477, 515, 552, 579 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CFG-01 | 10-01, 10-02 | Config updates for running instances operate on the gateway first | SATISFIED | `patchGatewayConfig` gateway-first loop; `updateSecurityProfile` and `pushChannelConfigToGateway` both delegate to it for running instances |
| CFG-02 | 10-01 | Config updates for stopped instances write to DB only | SATISFIED | instance-manager.ts:758-762: early return via `updateInstanceConfig` when not running |
| CFG-03 | 10-01 | Platform tracks gateway's `baseHash` from `config.get` for optimistic concurrency | SATISFIED | instance-manager.ts:769-770: `config.get` at start of each retry iteration; `baseHash` used in `config.patch` call at line 776 |
| CFG-04 | 10-01 | Config patches use `{ raw: "<json5>" }` merge-patch format | SATISFIED | `{ raw: JSON.stringify(configPatch), baseHash, note, restartDelayMs: 2000 }` at lines 774-779; no `{ patch: {} }` or `{ path, value }` format found anywhere |
| CFG-05 | 10-01 | Rate-limit enforcement | PARTIAL/SCOPED | Wait-and-retry implemented (lines 823-829); CONTEXT.md explicitly deferred proactive batching to Phase 12. ROADMAP success criterion 4 says "batched into single config.patch call" but phase planning scoped this to retry-on-429 only. See Human Verification. |
| CFG-06 | 10-02 | `reseedConfigFiles` only used during initial container startup, not for running instances config update paths | SATISFIED | `reseedConfigFiles` not called from `patchGatewayConfig`, `updateSecurityProfile`, or channels.ts. Called only from health-monitor.ts (recovery). `startInstanceAsync` seeds inline via `engine.writeFiles` (not `reseedConfigFiles`). The recovery use in health-monitor is accepted per CONTEXT.md. |
| CFG-07 | 10-01 | After successful `config.patch`, reads back actual config from gateway and persists to DB | SATISFIED | instance-manager.ts:784-800: second `config.get` call for authoritative hash; stored to `config_hash` column; fallback to pre-patch hash on read-back failure |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/server/src/services/instance-manager.ts` | 795 | Comment says "credential placeholders" | Info | Informational comment only — not a code anti-pattern |

No stub implementations, empty handlers, or broken wiring patterns found. No `{ patch: {} }` or `{ path, value }` format remnants found. TypeScript compiles cleanly with zero errors.

### Human Verification Required

#### 1. CFG-05 Batch Semantics Scope Acceptance

**Test:** Review the planning decision for CFG-05 in Phase 10.
**Expected:** The CONTEXT.md explicitly states "No batching needed for normal config changes — they are rare in practice. Batching is only needed for multi-plugin operations (Phase 12, not this phase)." The PLAN mapped CFG-05 to rate-limit wait-and-retry. The REQUIREMENTS.md marks CFG-05 complete. Confirm this scoping is accepted, i.e., Phase 10 satisfies CFG-05 via wait-and-retry, and the "batching" aspect of the requirement is deferred to Phase 12 (EXT-03).
**Why human:** The ROADMAP success criterion 4 says "batched into a single config.patch call" which literally means coalescing concurrent calls — but the phase planning context explicitly scoped this out. Automated verification cannot resolve this planning-level judgment call.

### Gaps Summary

No blocking gaps. All gateway-first config lifecycle mechanics are implemented and wired. The only open item is a human confirmation on the CFG-05 scoping decision, which was a deliberate planning choice documented in CONTEXT.md.

The one "partial" truth (CFG-06: reseedConfigFiles in startInstanceAsync vs health-monitor) is not a gap — startInstanceAsync seeds files inline via `engine.writeFiles`, which achieves the same outcome. The function `reseedConfigFiles` is exclusively used for recovery (health-monitor), which is the intended scope per CONTEXT.md.

---

_Verified: 2026-04-05T03:15:00Z_
_Verifier: Claude (gsd-verifier)_
