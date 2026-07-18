# openclaw-stream-sample.ndjson

**PLACEHOLDER** — OpenClaw NDJSON shape is MEDIUM confidence (Assumption A3 in
`.planning/phases/22-remaining-agent-backends/22-RESEARCH.md`). Plan 22-03 may
replace this fixture with a live capture if `openclaw` is locally installed at
that time; if the stream shape differs, update BOTH this fixture AND
`apps/server/src/daemon/backends/openclaw.ts`'s mapper together.

This hand-authored NDJSON mirrors the OpenCode-style discriminator
(`type: "text" | "tool_use" | "tool_result" | "done"`), per the Shape A
hypothesis documented in the research file. The last line is intentionally
malformed (PG10 coverage) — parseNdjson drops it.

Rationale for sidecar README: NDJSON is strictly one-JSON-value-per-line, so
an inline comment would either fail `JSON.parse` (breaking `parseNdjson`'s
`malformed=1` contract) or require bespoke fixture-loader logic downstream.
The sidecar keeps the fixture parseable while preserving the research
breadcrumb.
