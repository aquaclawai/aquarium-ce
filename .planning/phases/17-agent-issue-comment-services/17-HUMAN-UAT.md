---
status: partial
phase: 17-agent-issue-comment-services
source: [17-VERIFICATION.md]
started: 2026-04-16
updated: 2026-04-16
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live E2E run of Phase 17 Playwright spec
expected: All 8 tests in `tests/e2e/issues-agents-comments.spec.ts` pass against a running server (port 3001) with a fresh SQLite DB — including direct-SQLite invariants (partial-unique `idx_one_pending_task_per_issue_agent`, CASCADE deletes, fractional-position collapse renumber, system-comment content for `status_change` entries).
result: [pending]

Run:
```
npm run dev &
sleep 3
npx playwright test tests/e2e/issues-agents-comments.spec.ts --reporter=line
```

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
