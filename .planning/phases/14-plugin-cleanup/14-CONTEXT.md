# Phase 14: Plugin Cleanup - Context

**Gathered:** 2026-04-05 (auto mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove dead RPC methods from the platform-bridge plugin and replace ClawHub marketplace calls with direct HTTP from the platform. After this phase, the plugin only contains `platform.ping` and `platform.runtime`.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (all areas — auto mode)

**Direct HTTP for ClawHub (CLEAN-01, CLEAN-02):**
- `marketplace-client.ts` replaces `gatewayCall(instanceId, 'clawhub.search/info', ...)` with direct `fetch()` to the ClawHub API
- ClawHub API URL sourced from `config.ts` (new config field, env var `CLAWHUB_API_URL`)
- The built-in fallback registry (BUILTIN_REGISTRY) moves from the plugin to `marketplace-client.ts` — used when ClawHub API is unreachable
- Function signatures change: remove `instanceId` parameter (no longer routing through gateway), add optional `clawHubUrl` parameter or read from config
- Callers in `routes/plugins.ts`, `routes/skills.ts` updated to pass new params

**Plugin method removal (CLEAN-03, CLEAN-04):**
- Delete from `openclaw/plugin/index.ts`: `skills.list`, `plugins.list`, `agents.workspace.init`, `clawhub.search`, `clawhub.info`
- Delete associated helpers: `loadState()`, `fetchClawHub()`, `BUILTIN_REGISTRY`, `DEFAULT_TEMPLATES`
- Keep only: `platform.ping`, `platform.runtime`
- Plugin becomes minimal (~30 lines of registration code)

</decisions>

<canonical_refs>
## Canonical References

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `marketplace-client.ts` (apps/server/src/services/) — already has `searchClawHub()` and `getClawHubExtensionInfo()` with response parsing, just needs transport swap
- `fetchClawHub()` in plugin (openclaw/plugin/index.ts:246) — HTTP fetch pattern to copy/adapt for platform-side
- `BUILTIN_REGISTRY` in plugin — fallback data to move to marketplace-client
- `config.ts` (apps/server/src/) — existing config pattern for adding CLAWHUB_API_URL

### Established Patterns
- Platform uses `node:fetch` (Node 22+ global) for HTTP calls
- Config values sourced from `config.ts` object, never `process.env` directly
- Soft-fail pattern: return empty results on ClawHub API failure (already in marketplace-client)

### Integration Points
- `marketplace-client.ts` — transport swap (RPC → HTTP)
- `routes/plugins.ts` — calls `searchClawHub(controlEndpoint, authToken, ...)` → changes to `searchClawHub(params)` (no endpoint/token)
- `routes/skills.ts` — same pattern as plugins
- `openclaw/plugin/index.ts` — method deletion
- `config.ts` — add `clawHubApiUrl` config field

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — analysis stayed within phase scope.

</deferred>

---

*Phase: 14-plugin-cleanup*
*Context gathered: 2026-04-05*
