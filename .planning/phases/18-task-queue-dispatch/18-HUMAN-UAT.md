---
status: partial
phase: 18-task-queue-dispatch
source: [18-VERIFICATION.md]
started: 2026-04-16
updated: 2026-04-16
---

## Current Test

[awaiting Phase 19 HTTP surface before live smoke test is meaningful]

## Tests

### 1. Live-server smoke test: WS `task:cancelled` broadcast delivery
expected: Cancelling an issue via PATCH `/api/issues/:id` with `status=cancelled` produces one `task:cancelled` WS event per cancelled row, observable in a real browser client. Reassigning an issue produces one `task:cancelled` for the previous assignee's pending task.
result: [pending — deferred to Phase 19]

Blocked because Phase 18 ships no new HTTP routes; the queue/reaper/batcher/cancel surfaces are service-layer primitives consumed by Phase 19's daemon REST API and Phase 20's hosted driver.

Run (after Phase 19):
```
npm run dev &
sleep 3
# Connect a browser WS client to ws://localhost:3001/ws
# PATCH /api/issues/:id with { status: 'cancelled' }
# Observe task:cancelled events in the WS stream
```

### 2. Production singleton pool behaviour under real load
expected: 20 concurrent daemon pollers against a running server never observe two `dispatched` rows for the same (issue_id, agent_id).
result: [pending — deferred to Phase 19]

Blocked same reason. The in-process 20-poller unit test (`task-queue.test.ts`) already proves the invariant against the module boundary; the live-server test proves it across the HTTP + pool path.

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
