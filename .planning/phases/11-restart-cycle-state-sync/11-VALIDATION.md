---
phase: 11
slug: restart-cycle-state-sync
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-05
---

# Phase 11 — Validation Strategy

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
- **Before `/gsd:verify-work`:** Full build + manual restart cycle test
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | SYNC-01 | typecheck+build | `npm run build` | ✅ | ⬜ pending |
| 11-01-02 | 01 | 1 | SYNC-02,SYNC-03 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 11-02-01 | 02 | 2 | SYNC-04,SYNC-05 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 11-02-02 | 02 | 2 | SYNC-01 | build | `npm run build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Cross-cutting "restarting" status change requires build verification across all 3 packages.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Shutdown event → "restarting" | SYNC-01 | Requires running gateway + triggering config.patch | Send config.patch, observe dashboard shows "Restarting..." |
| Full state sync after reconnect | SYNC-02 | Requires gateway restart cycle | After restart, verify DB matches gateway state |
| Extension reconciliation on reconnect | SYNC-03 | Requires gateway with plugins loaded | Add plugin, restart, verify DB reflects gateway state |
| 60s timeout to "error" | SYNC-01 | Requires gateway that fails to restart | Stop gateway container, wait 60s, verify "error" status |
| Auto-reconnect with backoff | SYNC-05 | Requires gateway restart | Trigger restart, observe reconnection in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
