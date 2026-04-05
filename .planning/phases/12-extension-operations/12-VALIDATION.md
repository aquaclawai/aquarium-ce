---
phase: 12
slug: extension-operations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-05
---

# Phase 12 — Validation Strategy

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
- **Before `/gsd:verify-work`:** Full build + manual plugin install/activate test
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | EXT-01,EXT-02,EXT-04,EXT-05 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 12-01-02 | 01 | 1 | EXT-03 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 12-02-01 | 02 | 2 | EXT-06 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Plugin activate via config.patch | EXT-01 | Requires running gateway | Install plugin, activate, verify container NOT restarted, chat session survives |
| Plugin deactivate via config.patch | EXT-02 | Requires running gateway | Deactivate active plugin, verify gateway restarts internally, plugin absent from tools.catalog |
| Multi-plugin batch | EXT-03 | Requires multiple plugins | Install 3 plugins, activate all at once, verify single restart |
| Post-restart verification | EXT-04 | Requires gateway restart | After plugin activate, verify dashboard shows "restarting" then "active" |
| Failed plugin rollback | EXT-05 | Requires a failing plugin | Install a broken plugin, activate, verify rollback config.patch sent |
| Skill enable/disable | EXT-06 | Requires running gateway | Enable/disable skill, verify no restart, immediate effect |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
