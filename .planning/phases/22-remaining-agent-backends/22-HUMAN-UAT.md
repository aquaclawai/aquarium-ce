---
status: partial
phase: 22-remaining-agent-backends
source: [22-VERIFICATION.md]
started: 2026-04-17T00:00:00Z
updated: 2026-04-17T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC-3: Runtime switch claude→codex produces no task_message schema change
expected: After completing a task via claude, stop daemon, restart with codex binary on PATH, complete a second task on the same agent — inspect task_messages rows: columns and JSON shapes are identical between the two tasks. Open issue detail UI: tool_use/tool_result/text/thinking render visually identical.
result: [pending]

### 2. OpenClaw real binary happy path — confirm Shape A assumption (A3) or discover Shape B
expected: Run openclaw locally with daemon registered and claim a task. Verify NDJSON output matches the Shape A mapper in openclaw.ts (text/tool_use/tool_result/error/done). If Shape B is discovered, update `mapOpenclawEventToAgentMessage` and `openclaw-stream-sample.ndjson` together.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
