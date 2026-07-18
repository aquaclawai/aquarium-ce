---
status: partial
phase: 25-management-uis
source: [25-VERIFICATION.md]
started: 2026-04-18T00:00:00Z
updated: 2026-04-18T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. MGMT-03 copy-button cross-browser clipboard test
expected: In Chrome, Firefox, Safari (on macOS), create a new daemon token via DaemonTokenCreateModal. When the plaintext is displayed, click the copy button, then paste into any text field (e.g. terminal / text editor). Assert: pasted content matches the plaintext shown in the modal exactly. Click "I've saved it" to dismiss. Revisit the Daemon Tokens page; confirm the plaintext is gone (only hashed/masked projection shown in the list). Playwright synthetic clicks cannot assert the clipboard contents reliably across browsers — this test validates the `navigator.clipboard.writeText()` path end-to-end.
result: [pending]

### 2. MGMT-01/02/03 + UX5 — Native-speaker linguistic-quality review (zh/fr/de/es/it)
expected: Switch app language to each of zh, fr, de, es, it. Visit Agents, Runtimes, and Daemon Tokens pages. Confirm all `management.*` strings read naturally in each locale — column headers, status badge labels, form labels, empty states, confirmation dialog copy, ChatComposer-adjacent labels, filter chip labels, kind labels, create modal copy, revoke confirmation. Confirm the 3 new sidebar nav labels (`sidebar.agents`, `sidebar.runtimes`, `sidebar.daemonTokens`) read naturally. If any string sounds awkward or machine-translated, raise a gap and fix in a follow-up translation plan.
result: [pending]

### 3. Empty-state design quality — Agents / Runtimes / Daemon Tokens
expected: With zero agents (or all archived), zero runtimes registered, and zero daemon tokens, visit each of the 3 pages. Confirm each renders a polished empty state — not a blank table. The EmptyState component should display: an icon or illustration, a heading ("No agents yet" / "No runtimes registered" / "No daemon tokens yet"), a supportive one-sentence description, and a primary CTA button (e.g. "Create your first agent"). Verify visual design quality matches Phase 23/24 conventions — no jarring whitespace, consistent spacing, accessible color contrast.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
