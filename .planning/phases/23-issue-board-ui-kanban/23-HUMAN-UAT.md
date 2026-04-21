---
status: partial
phase: 23-issue-board-ui-kanban
source: [23-VERIFICATION.md]
started: 2026-04-17T00:00:00Z
updated: 2026-04-17T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. 60 FPS drag performance at 200+ issues (SC-3)
expected: Open DevTools → Performance tab, start recording, drag a card from Todo to In Progress across multiple columns, stop recording. Assert: "Frames" track shows mostly green bars with no red frames (>50 ms) during the drag. Playwright only asserts virtualizer DOM-size (≤ 25 cards), not frame timing.
result: [pending]

### 2. Native-speaker linguistic-quality review — zh/fr/de/es/it (SC-5)
expected: Switch language to each of zh, fr, de, es, it. Open `/issues` board. Confirm that the 6 column headers (Todo / In Progress / Done / Blocked / Cancelled / Triage or equivalents), a11y announcements (pick-up / move / drop), empty-state text, and sidebar nav label read naturally in each locale — no machine-translation artifacts. If any string reads awkwardly, raise a gap and fix in a follow-up translation plan.
result: [pending]

### 3. Visual polish — drag overlay shadow + drop-target affordance (UX3 + design quality)
expected: Open board with 5-10 issues. Drag a card. Confirm the drag overlay renders at z-index 5000 (above any modal layer), has a clear shadow/elevation distinguishing it from static cards, source card ghosts at ~40% opacity during drag. Confirm empty columns display a visible drop-target affordance (dashed border + "Drop here" localized text) when a drag is in progress.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
