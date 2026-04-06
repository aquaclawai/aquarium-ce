---
phase: 9
slug: rpc-consolidation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-05
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (E2E only — no unit tests per CLAUDE.md) |
| **Config file** | `playwright.config.ts` (root) |
| **Quick run command** | `npx playwright test tests/e2e/api.spec.ts` |
| **Full suite command** | `npx playwright test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck` (compile-time verification)
- **After every plan wave:** Run `npm run build` (full build)
- **Before `/gsd:verify-work`:** Full build + manual gateway connectivity test
- **Max feedback latency:** 15 seconds (typecheck)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | RPC-01,RPC-02 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 09-01-02 | 01 | 1 | RPC-04 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 09-02-01 | 02 | 2 | RPC-05 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 09-02-02 | 02 | 2 | RPC-03 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. This phase is a pure refactoring — TypeScript compiler catches most regressions.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| RPC calls route through persistent WS | RPC-01 | Requires running gateway container | Start instance, check logs for ephemeral connections (should be none) |
| Queue + retry on disconnect | RPC-02 | Requires simulating connection drop | Start instance, kill gateway, make API call, restart gateway, verify call completes |
| plugins.list replaced | RPC-03 | Requires running gateway | Check Extensions tab catalog loads (was broken before with plugins.list) |
| Correct client ID | RPC-04 | Requires gateway log inspection | Check gateway logs for client ID on connect |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
