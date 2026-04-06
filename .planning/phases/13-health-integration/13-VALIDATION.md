---
phase: 13
slug: health-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-05
---

# Phase 13 — Validation Strategy

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
- **Before `/gsd:verify-work`:** Full build + manual health endpoint test
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | HLTH-01,HLTH-02 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 13-01-02 | 01 | 1 | HLTH-03,HLTH-04 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HTTP /ready polling | HLTH-01 | Requires running gateway | Start instance, check health monitor logs for /ready polls |
| WS ping/pong liveness | HLTH-02 | Requires running gateway | Start instance, freeze gateway, verify detection within 60s |
| Gateway-authoritative hash | HLTH-03 | Requires running gateway | Edit config via Control UI, verify DB hash updates to match |
| No reseedConfigFiles for running | HLTH-04 | Requires running gateway | Trigger config hash mismatch, verify no file writes to container |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
