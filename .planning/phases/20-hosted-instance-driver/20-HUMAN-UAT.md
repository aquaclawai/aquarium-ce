---
status: partial
phase: 20-hosted-instance-driver
source: [20-VERIFICATION.md]
started: 2026-04-16
updated: 2026-04-16
---

## Current Test

[awaiting live-server + real gateway execution]

## Tests

### 1. Live gateway round-trip — `chat.send` → task_message rows
expected: Assigning an issue to an agent whose runtime is a `hosted_instance` produces `task_message` rows with `type ∈ {text, thinking, tool_use, tool_result}` matching the gateway's streamed content parts. Observable via SQLite read after a real dispatch against a running Aquarium instance.
result: [pending]

Run:
```
npm run dev &
sleep 3
# Create a hosted_instance runtime, an agent pointing to it, and an issue
# Assign the issue to the agent (status != 'backlog')
# Wait for the hosted worker tick (up to 2s) + dispatch
# Query DB: SELECT type, content FROM task_messages WHERE task_id = ? ORDER BY seq
```

### 2. Gateway disconnect resilience (HOSTED-06)
expected: Docker stop on the gateway container causes hosted worker tick to silently skip; task stays `queued`. Restart container — dispatch resumes within 2s.
result: [pending]

Run:
```
# With a queued hosted task, stop the gateway container
docker stop openclaw-instance-<id>
# Wait 5s; assert task still status='queued' in DB
docker start openclaw-instance-<id>
# Assert task transitions to dispatched within 2s of reconnection
```

### 3. Boot orphan sweep on real SIGKILL (HOSTED-04)
expected: Kill the server mid-task via `kill -9`. On restart, all in-flight hosted tasks in `dispatched` or `running` flip to `failed` with error `'hosted-orphan-on-boot'` BEFORE the HTTP listener accepts requests (Step 9b runs before Step 9c/9d).
result: [pending]

Run:
```
# With a running hosted task mid-dispatch
kill -9 $(pgrep -f aquarium)
# Restart via npm run dev
# Query DB: SELECT status, error FROM agent_task_queue WHERE id = ?
# Expect: status='failed', error='hosted-orphan-on-boot'
```

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
