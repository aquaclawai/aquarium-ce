---
phase: 10
slug: config-lifecycle
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-05
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (E2E only — no unit tests per CLAUDE.md) |
| **Config file** | `playwright.config.ts` (root) |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run build` |
| **Estimated runtime** | ~15 seconds (typecheck), ~30 seconds (build) |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run build`
- **Before `/gsd:verify-work`:** Full build + manual gateway config change test
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | CFG-01,CFG-03,CFG-04 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 10-01-02 | 01 | 1 | CFG-05,CFG-07 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 10-02-01 | 02 | 2 | CFG-02,CFG-06 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 10-02-02 | 02 | 2 | CFG-06 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. This phase refactors existing config update paths — TypeScript compiler catches regressions.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gateway-first config update | CFG-01 | Requires running gateway | Change config via dashboard, verify gateway received it, verify DB updated after |
| Stale hash auto-retry | CFG-03 | Requires concurrent config edits | Edit config from Control UI while Aquarium sends config.patch, verify retry succeeds |
| Rate limit queue-with-delay | CFG-05 | Requires triggering 3/min limit | Send 4 rapid config changes, verify 4th queues and eventually sends |
| Config read-back hash sync | CFG-07 | Requires running gateway | After config.patch, verify DB has gateway's hash (not platform-generated hash) |
| reseedConfigFiles eliminated | CFG-06 | Requires running gateway | Change config normally, verify no file writes to container volume |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
