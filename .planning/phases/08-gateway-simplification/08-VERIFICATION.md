---
phase: 08-gateway-simplification
verified: 2026-04-04T10:45:00Z
status: gaps_found
score: 4/5 must-haves verified
gaps:
  - truth: "Docker entrypoint delegates directory/permission/config logic to official entrypoint (SIMP-03 literal)"
    status: partial
    reason: "REQUIREMENTS.md SIMP-03 says the entrypoint should 'only inject platform-bridge plugin path, deferring directory/permission/config logic to official entrypoint'. The actual entrypoint retains permission fixing, directory creation, write validation, and default config generation. The CONTEXT.md pre-execution decision document deliberately kept these sections, but this means SIMP-03 as written is not satisfied by the implementation."
    artifacts:
      - path: "openclaw/docker/base/docker-entrypoint.sh"
        issue: "Entrypoint retains permission fix (lines 17-20), directory creation (lines 26-30), write validation (lines 36-42), and default config generation (lines 48-63) — these were explicitly documented as kept by design in 08-CONTEXT.md, but they contradict the literal SIMP-03 requirement"
    missing:
      - "Either: (a) update SIMP-03 in REQUIREMENTS.md to reflect the scoped decision (keep sections, only remove proxy logic), OR (b) accept as intentional deviation with documented rationale. No code change required if decision stands."
human_verification:
  - test: "Start a new instance and verify it becomes reachable without any proxy process"
    expected: "Instance starts, health check passes, WebSocket endpoint is accessible via the directly-mapped port"
    why_human: "Requires live Docker runtime to test actual container startup and port reachability"
  - test: "Verify existing running instances continue to work after the server upgrade"
    expected: "Already-running instances are unaffected — their containers keep existing port mappings"
    why_human: "Requires live environment with pre-existing instances to test backward compatibility"
---

# Phase 8: Gateway Simplification Verification Report

**Phase Goal:** The platform uses the official OpenClaw gateway's native network binding and entrypoint instead of injecting a TCP proxy and custom startup logic
**Verified:** 2026-04-04T10:45:00Z
**Status:** gaps_found (1 requirement interpretation gap — no functional code gaps)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | New instances start without any TCP proxy process — gateway binds directly via native bind:lan | VERIFIED | `PROXY_PORT_OFFSET`, `proxyPairs`, `proxyScript` all absent from docker.ts; `Entrypoint` is `exec node openclaw.mjs gateway --allow-unconfigured` (line 304) |
| 2 | Docker port mappings connect hostPort directly to containerPort (no +1 offset) | VERIFIED | Loop at docker.ts lines 241-247: `portKey = \`${p.containerPort}/${p.protocol \|\| 'tcp'}\`` maps hostPort directly — no offset arithmetic |
| 3 | Health check connects to the gateway port directly (no proxy port offset) | VERIFIED | docker.ts line 271: `const checkPort = spec.healthCheck.port;` — no `+ PROXY_PORT_OFFSET` |
| 4 | Entrypoint runs only the gateway command — no background node -e proxy process | VERIFIED | docker.ts line 304: `Entrypoint: ['sh', '-c', 'exec node openclaw.mjs gateway --allow-unconfigured']` — single process, no `&` backgrounding |
| 5 | Docker entrypoint.sh retains permission fix, directory creation, config generation, platform-bridge path injection, and command routing | VERIFIED | All sections confirmed present in docker-entrypoint.sh lines 17-118; shell syntax check passes |

**Score:** 5/5 truths verified at the implementation level

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/runtime/docker.ts` | Simplified Docker container creation without TCP proxy | VERIFIED | 609 lines; contains `exec node openclaw.mjs gateway`; no `PROXY_PORT_OFFSET`, `proxyPairs`, or `proxyScript` |
| `openclaw/docker/base/docker-entrypoint.sh` | Minimal entrypoint with platform-bridge injection | VERIFIED | 119 lines; contains `platform-bridge` at lines 57, 65, 77; header comment added at lines 4-7; shell syntax passes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/server/src/runtime/docker.ts` | Docker container entrypoint | Entrypoint array in createContainer | VERIFIED | Line 304: `Entrypoint: ['sh', '-c', 'exec node openclaw.mjs gateway --allow-unconfigured']` |
| `apps/server/src/runtime/docker.ts` | Docker port bindings | PortBindings mapping hostPort to containerPort | VERIFIED | Lines 243-245: `portKey = \`${p.containerPort}/tcp\`` used directly in both ExposedPorts and PortBindings |
| `apps/server/src/runtime/docker.ts` | Health check | spec.healthCheck.port used directly | VERIFIED | Line 271: `const checkPort = spec.healthCheck.port;` — no offset |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SIMP-01 | 08-01-PLAN.md | Remove TCP proxy injection from Docker runtime — use native `gateway.bind: lan` | SATISFIED | docker.ts has no `PROXY_PORT_OFFSET`, `proxyPairs`, or `proxyScript`; `gateway.bind: 'lan'` set in adapter.ts line 529 and `OPENCLAW_GATEWAY_BIND=lan` baked into Dockerfile line 82 |
| SIMP-03 | 08-01-PLAN.md | Simplify custom Docker entrypoint to only inject platform-bridge plugin path, deferring directory/permission/config logic to official entrypoint | PARTIAL — interpretation gap | Entrypoint has no proxy code (confirmed), and platform-bridge injection is present. However, REQUIREMENTS.md says "only inject platform-bridge path, deferring other logic to official entrypoint." The CONTEXT.md pre-execution decision explicitly kept permission fix, directory creation, write validation, and default config generation as necessary for CE (K8s compatibility, first-boot PVC setup). The implementation matches the plan's intent but diverges from SIMP-03's literal wording. Commit 133de59 adds documentation only (5 lines). |

**Orphaned requirements check:** REQUIREMENTS.md traceability table maps only SIMP-01 and SIMP-03 to Phase 8. No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `openclaw/docker/base/docker-entrypoint.sh` | 67-77 | `node -e` inline script for JSON manipulation | Info | Pre-existing pattern (not introduced by this phase); used for platform-bridge config injection, not proxy logic. Does not affect goal. |

No blocker or warning anti-patterns introduced by this phase.

### Proxy Removal Verification (Explicit Check)

Ran `grep -n "PROXY_PORT_OFFSET|proxyPairs|proxyScript|node -e" apps/server/src/runtime/docker.ts`:

- Line 274 match: `node -e "require('net').connect..."` — this is the **health check TCP probe** using Node's net module, which is the correct pattern for checking gateway connectivity in minimal Alpine images that lack `nc`/`curl`. This is NOT a proxy process.

No proxy-related patterns remain in docker.ts.

### Commit Verification

Both task commits confirmed in git log:
- `82620a3` — `feat(08-01): remove TCP proxy injection from Docker runtime` — modifies `apps/server/src/runtime/docker.ts` (35 deletions, 8 insertions)
- `133de59` — `docs(08-01): document entrypoint minimality and confirm no proxy logic` — modifies `openclaw/docker/base/docker-entrypoint.sh` (5 insertions)

### Human Verification Required

#### 1. New Instance Startup Without Proxy

**Test:** Start a new instance (or restart an existing one) via the Aquarium dashboard
**Expected:** Instance transitions to `running` state, health check passes, the WebSocket endpoint (ws://localhost:{hostPort}) is reachable — with no TCP proxy process visible inside the container (`docker exec <id> ps aux` shows only the gateway process)
**Why human:** Requires a live Docker environment to test actual container creation and port reachability

#### 2. Backward Compatibility for Existing Instances

**Test:** With pre-existing running instances, upgrade the Aquarium server (deploy the new docker.ts), and verify the already-running instances remain accessible
**Expected:** Instances that were created with the old proxy-based port mapping continue to work; no disruption to the existing container port bindings
**Why human:** Requires a live environment with pre-deployed instances to test

### SIMP-03 Gap Discussion

The gap identified is an **interpretation mismatch** between REQUIREMENTS.md wording and the implemented scoping decision:

**REQUIREMENTS.md SIMP-03 literal:** "only inject platform-bridge plugin path, deferring directory/permission/config logic to official entrypoint"

**08-CONTEXT.md decision (pre-execution):** Keep all existing entrypoint sections — they serve CE-specific needs (K8s privilege dropping via gosu, first-boot PVC directory initialization, write validation fail-fast, default config so gateway starts without platform). The official OpenClaw entrypoint does not handle these CE requirements.

**What was removed:** Any proxy injection (confirmed: docker.ts used to inject a proxy script into the Entrypoint string; that code is now gone).

**Recommendation:** Update REQUIREMENTS.md to accurately reflect the scoped decision — SIMP-03 should read "Remove proxy logic from the Docker entrypoint and confirm the entrypoint only retains CE-necessary setup (platform-bridge path injection, directory creation, and permission fixes)" — OR accept this as an intentional, documented deviation. The implementation is correct for the use case; the requirements document needs to catch up.

This is a documentation gap, not a functional code gap.

### Gaps Summary

One gap found: SIMP-03 as written in REQUIREMENTS.md is not fully satisfied — the entrypoint retains permission fixing, directory creation, write validation, and default config generation rather than deferring these to "the official OpenClaw entrypoint." This was a deliberate, pre-documented decision (08-CONTEXT.md) based on CE-specific requirements that the upstream entrypoint does not handle. The phase's core objective (no TCP proxy) is fully achieved.

**Resolution options (no code change needed):**
1. Update REQUIREMENTS.md SIMP-03 description to reflect the scoped decision
2. Accept as intentional deviation — mark SIMP-03 as "partially satisfied with documented rationale"

All functional truths verified. The platform no longer injects a TCP proxy. Direct port mapping, direct health checks, and single-process container startup are all confirmed in the codebase.

---

_Verified: 2026-04-04T10:45:00Z_
_Verifier: Claude (gsd-verifier)_
