# Requirements: Aquarium CE — Gateway Communication Overhaul

**Defined:** 2026-04-05
**Core Value:** Gateway is the source of truth when containers are running; DB is the persistence layer for offline state and container initialization.

## v1.3 Requirements

Requirements for the gateway communication overhaul. Each maps to roadmap phases.

### RPC Consolidation

- [x] **RPC-01**: All gateway RPC calls route through the persistent WebSocket connection instead of opening ephemeral connections
- [x] **RPC-02**: RPC calls made while the persistent connection is unavailable are queued and retried when the connection re-establishes
- [x] **RPC-03**: The `plugins.list` RPC call (which does not exist in the gateway) is replaced with `tools.catalog` and `config.get` in all call sites
- [x] **RPC-04**: The persistent client uses the correct gateway client ID (`openclaw-control-ui`) consistently across all connection paths
- [x] **RPC-05**: Extension lifecycle reconciliation and plugin/skill catalog queries use the persistent client instead of creating ephemeral connections

### Config Lifecycle

- [x] **CFG-01**: Config updates for running instances operate on the gateway first (via `config.patch`), then sync the result back to DB on success
- [x] **CFG-02**: Config updates for stopped instances write to DB only (correct degradation when no gateway is available)
- [x] **CFG-03**: The platform tracks the gateway's `baseHash` from `config.get` and uses it for optimistic concurrency in `config.patch` calls
- [x] **CFG-04**: Config patches use the correct `{ raw: "<json5>" }` merge-patch format (RFC 7396) instead of `{ patch: {...} }` or full file overwrite
- [x] **CFG-05**: The platform enforces the 3-writes-per-60-seconds rate limit by batching multiple config changes into a single `config.patch` call
- [x] **CFG-06**: `reseedConfigFiles` is only used during initial container startup (seed), not for running instances (running instances use `config.patch`)
- [x] **CFG-07**: After a successful `config.patch`, the platform reads back the actual config from the gateway (`config.get`) and persists it to DB as the authoritative state

### Restart Cycle & State Sync

- [x] **SYNC-01**: The platform detects the gateway `shutdown` event and marks the instance as "restarting" (not "stopped" or "error")
- [x] **SYNC-02**: After a WebSocket reconnection, the platform queries gateway state (`config.get`, `tools.catalog`, `skills.status`) and reconciles DB records
- [x] **SYNC-03**: Extension reconciliation runs on every reconnect (not just at boot), promoting/demoting skills and plugins based on actual gateway state
- [x] **SYNC-04**: After a `config.patch`-triggered restart, the platform verifies success by checking `tools.catalog` for expected plugins/skills
- [x] **SYNC-05**: The persistent WebSocket connection auto-reconnects after a gateway restart with full state reconciliation

### Extension Operations

- [x] **EXT-01**: Plugin activation uses `config.patch` to add the plugin to gateway config instead of restarting the entire Docker container
- [x] **EXT-02**: Plugin deactivation uses `config.patch` to remove the plugin from gateway config instead of restarting the container
- [x] **EXT-03**: Multiple plugin operations are batched into a single `config.patch` call to respect the 3/min rate limit
- [x] **EXT-04**: After a plugin operation triggers a gateway restart (via SIGUSR1), the platform waits for reconnection and verifies the operation succeeded via `tools.catalog`
- [x] **EXT-05**: If post-restart verification shows a plugin failed to load, the platform marks it as `failed` in DB and offers rollback
- [x] **EXT-06**: Skill enable/disable/configure uses `config.patch` without triggering a restart (skills are dynamically loaded)

### Health Integration

- [ ] **HLTH-01**: The health monitor polls the gateway's HTTP `/ready` endpoint alongside Docker container status checks
- [ ] **HLTH-02**: The persistent WebSocket connection uses ping/pong frames for liveness detection (gateway unresponsive vs network down)
- [ ] **HLTH-03**: The config integrity check uses the gateway's authoritative config hash (from `config.get`) instead of comparing file hashes on disk
- [ ] **HLTH-04**: The config integrity check does not trigger `reseedConfigFiles` for running instances (eliminates the infinite reseed loop)

## v1.4 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Sync

- **ASYNC-01**: Platform subscribes to gateway events for real-time config change notifications (requires upstream gateway feature)
- **ASYNC-02**: Conflict resolution UI when Aquarium and OpenClaw Control UI race on config.patch
- **ASYNC-03**: Plugin load diagnostics via dedicated RPC (requires upstream gateway feature)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Gateway-side event emission for config/plugin/skill changes | Requires upstream OpenClaw changes -- gateway currently emits zero events for these |
| Hot-reload plugins without restart | Gateway architecture limitation -- `plugins.*` changes always trigger SIGUSR1 |
| Real-time event-driven DB sync | Gateway doesn't emit the events; using shutdown/reconnect/query pattern instead |
| Mock gateway WebSocket server for CI | Useful but separate infrastructure concern -- would be its own milestone |
| Protocol version negotiation | Current protocol v3 is stable; negotiation adds complexity without immediate value |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RPC-01 | Phase 9 | Complete |
| RPC-02 | Phase 9 | Complete |
| RPC-03 | Phase 9 | Complete |
| RPC-04 | Phase 9 | Complete |
| RPC-05 | Phase 9 | Complete |
| CFG-01 | Phase 10 | Complete |
| CFG-02 | Phase 10 | Complete |
| CFG-03 | Phase 10 | Complete |
| CFG-04 | Phase 10 | Complete |
| CFG-05 | Phase 10 | Complete |
| CFG-06 | Phase 10 | Complete |
| CFG-07 | Phase 10 | Complete |
| SYNC-01 | Phase 11 | Complete |
| SYNC-02 | Phase 11 | Complete |
| SYNC-03 | Phase 11 | Complete |
| SYNC-04 | Phase 11 | Complete |
| SYNC-05 | Phase 11 | Complete |
| EXT-01 | Phase 12 | Complete |
| EXT-02 | Phase 12 | Complete |
| EXT-03 | Phase 12 | Complete |
| EXT-04 | Phase 12 | Complete |
| EXT-05 | Phase 12 | Complete |
| EXT-06 | Phase 12 | Complete |
| HLTH-01 | Phase 13 | Pending |
| HLTH-02 | Phase 13 | Pending |
| HLTH-03 | Phase 13 | Pending |
| HLTH-04 | Phase 13 | Pending |

**Coverage:**
- v1.3 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-04-05*
*Last updated: 2026-04-05 after roadmap creation*
