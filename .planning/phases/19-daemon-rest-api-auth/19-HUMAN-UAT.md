---
status: partial
phase: 19-daemon-rest-api-auth
source: [19-VERIFICATION.md]
started: 2026-04-16
updated: 2026-04-16
---

## Current Test

[awaiting manual live-server execution]

## Tests

### 1. SC-3 full-duration rate-limit exemption (production-mode)
expected: 1 req/sec for 5 min against `POST /api/daemon/runtimes/:id/tasks/claim` returns 200/404 throughout (never 429); per-token bucket (1000/min) dominates; global `/api/` limiter exempts `/api/daemon/*` correctly.
result: [pending]

Run:
```
NODE_ENV=production npm run dev &
sleep 3
# Mint a daemon token via POST /api/daemon-tokens (user auth)
TOKEN="adt_..."
for i in $(seq 1 300); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/daemon/runtimes/R/tasks/claim
  sleep 1
done | sort | uniq -c
# Expect: 0 lines showing 429
```

### 2. Full Playwright E2E run against live server
expected: `npx playwright test tests/e2e/daemon-rest.spec.ts` → 5 pass, 1 skip (SC-3 CI-skipped) with a running server.
result: [pending]

Run:
```
npm run dev &
sleep 3
npx playwright test tests/e2e/daemon-rest.spec.ts --reporter=line
```

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
