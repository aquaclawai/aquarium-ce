---
status: partial
phase: 24-issue-detail-ui-task-message-streaming
source: [24-VERIFICATION.md]
started: 2026-04-17T00:00:00Z
updated: 2026-04-17T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC-3 — 60 FPS background-tab recovery at 500+ messages
expected: Open the issue detail for a live 500-msg streaming task in Chrome. Switch to another tab for at least 60 s. Return to the tab. DevTools → Performance tab (record during the return) must show NO blocking main-thread task ≥ 500 ms. Messages should catch up smoothly without app freeze. The `useTransition` + `useDeferredValue` code path is implemented; this test validates the FPS guarantee which Playwright cannot reliably assert under headless tab throttling.
result: [pending]

### 2. UX6 — XSS adversarial input audit
expected: Manually insert `task_messages` rows (via SQL or test fixture) containing adversarial content — e.g. `<script>alert(1)</script>`, `<iframe src="javascript:alert(1)"></iframe>`, `<img src=x onerror="alert(1)">`, `<a href="javascript:alert(1)">click</a>`. Navigate to the issue detail page in a live browser. Confirm: NO script execution, NO iframe load, NO onerror trigger; all adversarial input renders as escaped text or via react-markdown + rehype-sanitize. Zero `dangerouslySetInnerHTML` is already CI-enforced — this test validates the sanitization layer under live adversarial input.
result: [pending]

### 3. UX5 — Native-speaker linguistic-quality review (zh/fr/de/es/it)
expected: Switch app language to each of zh, fr, de, es, it. Open an issue detail page + Chat composer. Read the `issues.detail.*` + `chat.*` strings: page title, section labels, action sidebar buttons, task state labels, reconnect banner, truncation marker, composer placeholder, send button, keyboard hint. Confirm all strings read naturally without machine-translation artifacts. If any string reads awkwardly, raise a gap and fix in a follow-up translation plan.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
