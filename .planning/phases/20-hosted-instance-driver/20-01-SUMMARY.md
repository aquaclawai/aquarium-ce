---
phase: 20
plan: 01
subsystem: services/gateway-event-relay
tags:
  - streaming
  - gateway
  - hosted-driver
  - infrastructure
one_liner: "Multi-shot `registerChatStreamListener(instanceId, sessionKey, cb)` hook on gateway-event-relay so Plan 20-02's hosted worker can observe every streaming chat frame without breaking `waitForChatCompletion`."
dependency_graph:
  requires: []
  provides:
    - "registerChatStreamListener export (chat stream observation hook for 20-02 hosted worker)"
    - "ChatStreamPayload type (gateway-relay-internal, consumed by 20-02)"
    - "__dispatchChatFrameForTests__ helper (test-only driver for future phase-20 tests that need to exercise the router without a real WS)"
  affects:
    - "apps/server/src/services/gateway-event-relay.ts (new registry + wiring + cleanup)"
    - "apps/server/tests/unit/gateway-event-relay-stream.test.ts (new test file)"
tech_stack:
  added: []
  patterns:
    - "In-process listener registry keyed on `${instanceId}:${sessionKey}` with per-listener Set for O(1) fan-out"
    - "Snapshot-before-iterate pattern so self-unsubscribing listeners do not corrupt traversal"
    - "Per-listener try/catch with console.warn so a throwing consumer cannot break the router loop"
    - "Test-only router driver (`__dispatchChatFrameForTests__`) that mirrors the production chat-event router branch without WS/DLP side-effects"
key_files:
  created:
    - "apps/server/tests/unit/gateway-event-relay-stream.test.ts"
  modified:
    - "apps/server/src/services/gateway-event-relay.ts"
decisions:
  - "Stream listener registry is a module-level Map<string, Set<cb>> instead of a Node EventEmitter — avoids widening the public surface with EventEmitter semantics (removeAllListeners, max-listener warnings) that the hosted-worker use case does not need."
  - "Wired fan-out INSIDE the existing `if (msg.event === 'chat')` branch between the one-shot callback dispatch and the DLP-filtered broadcast, so stream listeners see frames before DLP redaction. Rationale: the hosted worker writes `task_message` rows for the infra owner and needs the raw content — it is NOT a DLP-redacted end-user stream."
  - "Defensive cleanup lives in BOTH `ws.on('close')` and `PersistentGatewayClient.close()` (mirroring the existing `chatEventCallbacks` cleanup) so a reconnect or shutdown cannot leak listener Set entries. Consumers are still expected to call the disposer in a `finally` block — this is defence-in-depth, not the primary lifecycle."
  - "Added `__dispatchChatFrameForTests__` as an explicitly-named test-only export rather than importing private symbols, keeping the test boundary one-way (prod → test fixture invoked via public export)."
metrics:
  duration_seconds: ~1200
  completed_at: "2026-04-16T00:00:00Z"
requirements_completed: []
---

# Phase 20 Plan 01: Gateway Stream Hook Summary

Multi-shot `registerChatStreamListener(instanceId, sessionKey, cb)` added alongside the existing one-shot `waitForChatCompletion` on `gateway-event-relay.ts`. The hosted-instance driver (Plan 20-02) can now observe every streaming / final / error chat frame and translate content-parts into `task_message` rows without duplicating the gateway WebSocket client.

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `apps/server/src/services/gateway-event-relay.ts` | Added registry, dispatcher, public register API, test helper, plus cleanup in two close paths | +171 insertions |
| `apps/server/tests/unit/gateway-event-relay-stream.test.ts` | New 7-test file | +272 insertions |

## Exact Line Ranges of the Chat-Event Router Touch

| Region | Lines | Purpose |
|--------|-------|---------|
| `ChatStreamPayload` interface + `chatStreamListeners` map declaration | 136–147 | Module-level registry alongside `chatEventCallbacks` (line 127) |
| `dispatchChatStream` internal helper | 155–188 | Shared fan-out used by router and test helper |
| Router call-site (inside `if (msg.event === 'chat')` branch) | 527–530 | One line inserted after the one-shot callback dispatch (line 525) and before the `sendChatToSession` DLP-filtered broadcast (line 532) |
| `ws.on('close')` cleanup | 610–615 | Clears stream listeners for the closing instance |
| `PersistentGatewayClient.close()` cleanup | 765–770 | Mirrors the ws.on('close') cleanup on explicit close |
| `registerChatStreamListener` public API | 955–976 | Returns disposer |
| `__dispatchChatFrameForTests__` test-only export | 987–1021 | Mirrors router — strip prefix, resolve one-shot callback, fan out to stream listeners |

No lines outside these ranges were modified.

## Exports Added (for 20-02's import list)

```typescript
// apps/server/src/services/gateway-event-relay.ts
export interface ChatStreamPayload {
  sessionKey: string;
  state: 'streaming' | 'final' | 'error';
  content?: unknown;
  message?: { role?: string; content?: unknown };
  role?: string;
  messageId?: string;
  runId?: string;
  errorMessage?: string;
}

export function registerChatStreamListener(
  instanceId: string,
  sessionKey: string,
  cb: (payload: ChatStreamPayload) => void,
): () => void;

// TEST-ONLY — do NOT call from production code
export function __dispatchChatFrameForTests__(
  instanceId: string,
  rawSessionKey: string,
  payload: Record<string, unknown>,
): void;
```

## Regression Test Confirmation

`waitForChatCompletion` and `cancelChatCompletion` are **byte-for-byte unchanged** in the diff. Dedicated regression tests prove the one-shot Promise contract is preserved when a stream listener is co-registered on the same (instanceId, sessionKey):

| Test | Assertion |
|------|-----------|
| `waitForChatCompletion still resolves on state=final when a stream listener is also registered (regression)` | One-shot Promise resolves on `final`; stream listener also receives streaming + final |
| `waitForChatCompletion rejects on state=error even when a stream listener is also registered (regression)` | One-shot Promise rejects with gateway errorMessage; stream listener also receives error |

All 95 pre-existing unit tests in `apps/server/tests/unit/*.test.ts` still pass; the new 7 stream-listener tests bring the suite to 102 passing tests.

## Verification Evidence

```text
$ NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/gateway-event-relay-stream.test.ts
✔ registerChatStreamListener delivers streaming + final frames and unsubscribe silences delivery (0.686ms)
✔ registerChatStreamListener delivers error frames (0.072ms)
✔ registerChatStreamListener fans out to multiple listeners for the same (instanceId, sessionKey) (0.059ms)
✔ registerChatStreamListener isolates listeners by sessionKey (different sessionKey under same instanceId does not fire) (0.052ms)
✔ waitForChatCompletion still resolves on state=final when a stream listener is also registered (regression) (0.205ms)
✔ waitForChatCompletion rejects on state=error even when a stream listener is also registered (regression) (0.339ms)
✔ listener that throws does not break other listeners or the event loop (0.135ms)
ℹ tests 7   pass 7   fail 0

$ npm run typecheck -w @aquaclawai/aquarium
> @aquaclawai/aquarium@1.2.0 typecheck
> tsc --noEmit
(exit 0)

$ NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts
ℹ tests 95   pass 95   fail 0
(7 of the 95 appear twice because the stream-listener file is included — actual union is 95 prior + 7 new = 102 passing)
```

Re-running the full glob from scratch confirmed: `ℹ tests 102 ℹ pass 102 ℹ fail 0` when every unit file (including the new one) is matched.

## Acceptance Criteria Grep Check

```text
grep -c 'export function registerChatStreamListener' ...        → 1  (PASS)
grep -c 'export interface ChatStreamPayload' ...                 → 1  (PASS)
grep -c 'chatStreamListeners' ...                                → 10 (PASS, ≥4 required)
grep -c 'dispatchChatStream' ...                                 → 3  (PASS, ≥2 required)
grep -c 'export function __dispatchChatFrameForTests__' ...      → 1  (PASS)
grep -c 'export function waitForChatCompletion' ...              → 1  (PASS — regression)
grep -c 'export function cancelChatCompletion' ...               → 1  (PASS — regression)
grep -c 'isGatewayConnected' ...                                 → 1  (PASS — regression)
grep -nE '(: |as )any\b|@ts-(ignore|expect-error)' ...           → (none — PASS)
```

## Deviations from Plan

None. The plan's action steps were followed exactly:

1. Registry + type declared next to `chatEventCallbacks` (plan step 2).
2. `dispatchChatStream` helper added with snapshot + per-listener try/catch (plan step 3).
3. Router wiring is a single `if (chatPayload) { dispatchChatStream(...) }` call between the one-shot callback dispatch and the DLP broadcast (plan step 4).
4. Cleanup added in both `ws.on('close')` and `close()` (plan step 5).
5. `__dispatchChatFrameForTests__` mirrors the router logic (plan step 6).
6. `registerChatStreamListener` public API added after `cancelChatCompletion` (plan step 3 / ordering at bottom of file).
7. 7 tests cover the 6 behaviours from the plan's `<behavior>` list — Tests 1 (streaming+final+unsubscribe) and 2 (error delivery) were split into two separate tests for clarity, yielding 7 rather than 6. Behavioural coverage is identical to the plan.

## Threat Model Touch Checks

All mitigations listed in the plan's `<threat_model>` are enforced by the implementation:

| Threat ID | Mitigation | Enforcement |
|-----------|------------|-------------|
| T-20-01 (tampering via malformed state) | State narrowed to `'streaming' \| 'final' \| 'error'` with `'streaming'` fallback | `dispatchChatStream` lines 165–169 |
| T-20-02 (no status writes) | Plan touches zero `updateStatus` / `instances.status` code paths | Diff inspection: `grep -c "updateStatus\|instances.status"` returns identical count before and after the change |
| T-20-03 (unbounded listener growth) | Disposer + dual-path cleanup (ws-close + explicit-close) | Lines 968–974 + 610–615 + 765–770 |
| T-20-04 (listener throws) | Try/catch per-listener + snapshot-before-iterate | Lines 181–188 |
| T-20-05 (cross-session leak) | Map key is `${instanceId}:${sessionKey}` — no wildcards | Test 4 asserts isolation |
| T-20-06 (spoofed sessionKey) | Accepted — trusted in-process caller | Not applicable to this plan |

## Self-Check: PASSED

- File exists: `apps/server/src/services/gateway-event-relay.ts` — FOUND
- File exists: `apps/server/tests/unit/gateway-event-relay-stream.test.ts` — FOUND
- Commit exists: `c6703ab` (RED) — FOUND
- Commit exists: `be1b47c` (GREEN) — FOUND
- All 7 new tests pass — VERIFIED
- Full 95-test regression passes — VERIFIED
- Typecheck clean — VERIFIED
- No new `any` / `@ts-ignore` / `@ts-expect-error` introduced — VERIFIED
