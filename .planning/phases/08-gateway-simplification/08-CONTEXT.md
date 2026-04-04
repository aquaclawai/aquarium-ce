# Phase 8: Gateway Simplification - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove the TCP proxy injection from Docker runtime and simplify the custom Docker entrypoint. The official OpenClaw gateway natively supports `gateway.bind: lan` (0.0.0.0 binding), making the CE TCP proxy workaround obsolete. The entrypoint should delegate most logic to the official entrypoint, keeping only platform-bridge plugin path injection.

</domain>

<decisions>
## Implementation Decisions

### Proxy removal (SIMP-01)
- Remove all TCP proxy code from `docker.ts`: `PROXY_PORT_OFFSET`, `proxyPairs`, `proxyScript`, and the `node -e` prefix in entrypoint
- Change Docker port mapping from `hostPort → proxyPort (containerPort + 1)` to `hostPort → containerPort` (direct gateway port)
- Fix health check: remove `+ PROXY_PORT_OFFSET` — connect to gateway port directly (18789)
- Simplify entrypoint from `node -e '${proxyScript}' & exec node openclaw.mjs gateway --allow-unconfigured` to just `exec node openclaw.mjs gateway --allow-unconfigured`
- `gateway.bind: lan` already set in adapter.ts (line 529) and env vars (line 883) — no changes needed there
- Endpoint URLs (`ws://localhost:${hostPort}`) stay the same — the hostPort just maps to a different container port

### Entrypoint simplification (SIMP-03)
- Keep permission fix (gosu re-exec as node user) — still needed for K8s
- Keep directory creation (`~/.openclaw/credentials`, `workspace`, etc.) — still needed on first PVC mount
- Keep write permission validation — safety check
- Keep default openclaw.json generation — keeps gateway functional without platform
- Keep platform-bridge plugin path injection — CE-specific, no upstream equivalent
- Keep command routing (gateway/login/health/shell) — still functional
- The entrypoint is already fairly minimal at ~113 lines; the simplification is mostly about removing any proxy-related logic that might exist in it

### Backward compatibility
- Already-running instances won't be affected — they keep their existing containers
- New instances and restarted instances will use the simplified direct binding
- No migration needed — the `gateway.bind: lan` config is already being seeded
- The Dockerfile env vars `OPENCLAW_GATEWAY_BIND=lan` and `OPENCLAW_GATEWAY_PORT=18789` are already set

### Claude's Discretion
- Whether to add a comment explaining why no proxy is needed
- How to structure the port allocation code after simplification
- Whether to clean up any other proxy-related dead code paths

</decisions>

<code_context>
## Existing Code Insights

### Key Files to Modify
- `apps/server/src/runtime/docker.ts` — TCP proxy injection (lines 235-323), health check (lines 282-291), port mapping (lines 251-259)
- `openclaw/docker/base/docker-entrypoint.sh` — Custom entrypoint (~113 lines)

### Integration Points
- `apps/server/src/services/instance-manager.ts` (line 489) — reads `controlEndpoint` from `result.endpoints` — no change needed, endpoint URL format stays the same
- `apps/server/src/agent-types/openclaw/adapter.ts` (lines 529, 883) — already sets `bind: 'lan'` — no change needed

### Established Patterns
- Port allocation via `allocatePort()` (lines 25-40) stays the same
- Docker `PortBindings` and `ExposedPorts` construction stays the same, just different target port
- Health check pattern (net.connect TCP check) stays the same, just different port number

</code_context>

<specifics>
## Specific Ideas

- The scout confirmed the proxy removal is surgical: remove PROXY_PORT_OFFSET constant, simplify the port mapping loop, remove proxyScript construction, simplify entrypoint string, fix health check port
- The entrypoint.sh changes are minimal — the entrypoint doesn't contain proxy logic itself (that's injected by docker.ts), so SIMP-03 is more about reviewing what's truly needed vs what the official entrypoint already handles

</specifics>

<deferred>
## Deferred Ideas

- Using the official base image directly (no custom Dockerfile) — requires more testing
- Removing tini/gosu from the image — still needed for K8s signal forwarding and privilege dropping

</deferred>

---

*Phase: 08-gateway-simplification*
*Context gathered: 2026-04-04*
