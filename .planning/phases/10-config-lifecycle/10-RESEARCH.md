# Phase 10: Config Lifecycle - Research

**Researched:** 2026-04-05
**Domain:** Gateway-first config mutation, merge-patch protocol, optimistic concurrency, rate-limit handling
**Confidence:** HIGH

## Summary

Phase 10 inverts the config update flow from DB-first to gateway-first for running instances. The core pattern is: build a merge-patch delta, send it to the gateway via `config.patch` with `baseHash` for optimistic concurrency, handle stale-hash retries and rate-limit delays, then read back the authoritative hash from `config.get` and update the DB. Stopped instances continue to write DB only; `reseedConfigFiles` is retained exclusively for boot and recovery paths.

The implementation touches three primary call sites: `patchGatewayConfig()` (the main refactor target, used by PATCH /config and channel enable/disable/policies), `updateSecurityProfile()` (currently calls reseedConfigFiles + config.patch), and `channels.ts:reseedAndPatch()` (used by channel configure/disconnect). All three currently follow a DB-first or reseed-then-patch pattern that must be inverted. The gateway's `config.patch` accepts `{ raw: "<JSON5 string>", baseHash?, note?, restartDelayMs? }` with `additionalProperties: false` -- the `{ patch: {...} }` fallback in the current code is broken, and the `{ path, value }` format used by `extension-credentials.ts` is also non-conforming.

A critical nuance is that both `config.get` and `config.patch` responses return redacted configs (sensitive fields like API keys replaced with `***`). The platform's DB config stores credential placeholders (`${CREDENTIAL:provider:type}`). This means the "config.get read-back" cannot be used to overwrite DB config content -- it is used to obtain the authoritative `hash` for the next `baseHash` parameter. The platform's own deep-merged config (with credential placeholders intact) remains the DB-stored version; only the `config_hash` column is updated from the gateway.

**Primary recommendation:** Refactor `patchGatewayConfig()` into a gateway-first flow: build JSON5 merge-patch string from configPatch, call `config.patch` with `baseHash` from `config.get`, auto-retry on stale hash (3x), queue-with-delay on rate limit (429), then persist the platform's merged config + gateway's authoritative hash to DB synchronously before returning.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Gateway-first: if `config.patch` fails, the operation fails visibly -- DB is NOT updated
- Auto-retry stale hash conflicts: re-read hash via `config.get`, re-send, up to 3 retries (matches current behavior)
- Rate limit hits (429): queue with delay -- hold the request, wait until rate limit window resets (~20s), send. User sees a "pending" state.
- Invalid config rejection: return error to user immediately, no retry
- After successful `config.patch` + read-back: DB update is synchronous (blocks the API response) -- guarantees dashboard shows correct state
- No batching needed for normal config changes -- they are rare in practice (user clicks save)
- Each change sent individually with retry-on-429 (queue with delay)
- Batching is only needed for multi-plugin operations (Phase 12, not this phase)
- reseedConfigFiles kept for: (1) initial boot, (2) auto-recovery in health-monitor (error -> running), (3) config integrity fix in health-monitor
- reseedConfigFiles eliminated from: (4) patchGatewayConfig normal flow, (5) updateSecurityProfile for running instances, (6) channels.ts channel configure
- Direct merge-patch: build the merge-patch object from the config change, JSON.stringify it, send as `{ raw: "<json5>", baseHash: "<hash>" }`
- No file writing to container volume for running instances
- After successful config.patch, call config.get to read the gateway's actual merged config
- Store the full config + hash in DB as the authoritative state
- Stopped instances: write to DB only; config takes effect on next start via reseedConfigFiles

### Claude's Discretion
- How to build the merge-patch object from the various config change sources (principles, identity, agentName, mcpServers, etc.)
- Whether to store the baseHash in memory or fetch fresh from `config.get` each time
- Error message formatting for rate limit delays
- How to handle the `updateSecurityProfile` path (currently calls reseedConfigFiles + config.patch)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CFG-01 | Config updates for running instances operate on the gateway first (via `config.patch`), then sync the result back to DB on success | Core refactor of `patchGatewayConfig()` -- gateway-first flow pattern documented in Architecture Patterns section |
| CFG-02 | Config updates for stopped instances write to DB only (correct degradation when no gateway is available) | Early guard check on instance status -- existing pattern preserved; see Code Examples |
| CFG-03 | The platform tracks the gateway's `baseHash` from `config.get` and uses it for optimistic concurrency in `config.patch` calls | `config_hash` column already exists in DB; research documents hash lifecycle and stale-hash retry pattern |
| CFG-04 | Config patches use the correct `{ raw: "<json5>" }` merge-patch format (RFC 7396) instead of `{ patch: {...} }` or full file overwrite | Gateway schema verified: `ConfigPatchParamsSchema` accepts ONLY `{ raw, baseHash?, sessionKey?, note?, restartDelayMs? }` with `additionalProperties: false`; see Protocol Facts |
| CFG-05 | The platform enforces the 3-writes-per-60-seconds rate limit by batching multiple config changes into a single `config.patch` call | For Phase 10, individual sends with retry-on-429 delay; batching deferred to Phase 12. Rate limit error format documented. |
| CFG-06 | `reseedConfigFiles` is only used during initial container startup (seed), not for running instances (running instances use `config.patch`) | Three call sites to convert documented; two call sites retained (boot, health-monitor recovery) |
| CFG-07 | After a successful `config.patch`, the platform reads back the actual config from the gateway (`config.get`) and persists it to DB as the authoritative state | Read-back pattern documented with critical nuance about redacted configs -- hash is authoritative, config content uses platform's merged version |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ws | 8.20.0 | WebSocket transport for gateway RPC | Already installed; PersistentGatewayClient uses it |
| better-sqlite3 | 11.x | DB persistence (instances table, config_hash column) | Already installed; CE database layer |
| node:crypto | built-in | SHA-256 hashing, UUID generation | Already used for config_hash computation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| json5 | (not needed) | JSON5 stringify | NOT needed -- `JSON.stringify()` produces valid JSON5 (JSON is a subset of JSON5); gateway parses `raw` via JSON5 parser |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `JSON.stringify()` for raw | `json5.stringify()` | Unnecessary -- JSON is valid JSON5; adding a dep for no benefit |
| In-memory baseHash cache | Fresh `config.get` each time | Cache avoids extra RPC but can go stale; fresh fetch adds ~50ms latency but guarantees correctness. **Recommendation: fetch fresh each time** -- config changes are rare (user clicks save) so the extra round-trip is negligible |

**Installation:**
```bash
# No new packages needed. Zero new dependencies.
```

## Architecture Patterns

### Recommended Flow: Gateway-First Config Update

```
User clicks Save
       |
       v
[1] Validate configPatch locally (basic sanity)
       |
       v
[2] Is instance running + has controlEndpoint?
  NO ---> Write configPatch to DB (deep-merge) ---> Return success
  YES
   |
   v
[3] config.get(instanceId) ---> extract baseHash
       |
       v
[4] Build merge-patch: JSON.stringify(configPatch)
       |
       v
[5] config.patch({ raw: JSON.stringify(configPatch), baseHash, note, restartDelayMs: 2000 })
       |
       +--- STALE HASH ERROR ("config changed since last load")
       |         |
       |         v  retry from step [3] (up to 3 times)
       |
       +--- RATE LIMIT ERROR ("rate limit exceeded", retryAfterMs)
       |         |
       |         v  wait retryAfterMs, then retry from step [3]
       |
       +--- INVALID CONFIG ERROR
       |         |
       |         v  throw error to user immediately (no retry)
       |
       +--- SUCCESS (response includes: ok, config, restart, sentinel)
                |
                v
[6] config.get(instanceId) ---> extract authoritative hash
       |
       v
[7] Deep-merge configPatch into DB config (platform perspective, with credential placeholders)
    Update config_hash with gateway's hash
    Update updated_at
       |
       v
[8] Return updated instance to caller
```

### Critical Protocol Facts (HIGH confidence -- verified from gateway source)

1. **`config.patch` schema:** `{ raw: NonEmptyString, baseHash?: NonEmptyString, sessionKey?: string, note?: string, restartDelayMs?: integer }` with `additionalProperties: false`. The `{ patch: {...} }` format in `instance-manager.ts:820` and `{ path, value }` format in `extension-credentials.ts:150` are BOTH invalid and will be rejected or ignored.

2. **`raw` is a JSON5 string, not an object.** Client must `JSON.stringify(delta)` and pass as string. Gateway parses via `parseConfigJson5()`. Since JSON is valid JSON5, `JSON.stringify` works.

3. **Merge-patch semantics (RFC 7396 + id-keyed arrays):**
   - `null` values delete keys
   - Objects merge recursively
   - Array values with objects containing `id` fields merge by id
   - Non-object values replace directly

4. **baseHash is mandatory when config file exists.** Omitting it returns: `"config base hash required; re-run config.get and retry"`. Stale hash returns: `"config changed since last load; re-run config.get and retry"`.

5. **Rate limit error format:** Error code `UNAVAILABLE`, message `"rate limit exceeded for config.patch; retry after Ns"`, with `retryable: true` and `retryAfterMs: <milliseconds>` in the error details.

6. **`config.patch` always triggers SIGUSR1 restart** (regardless of what changed). The reload-plan classifies every path; `plugins.*` = restart, `hooks/cron/models` = hot-reload, but config.patch itself always schedules SIGUSR1.

7. **Response shape:** `{ ok: true, path, config: <redacted>, restart: { coalesced, delayMs, ... }, sentinel: { path, payload } }`. The `config` field is redacted (sensitive values replaced). The `restart.coalesced` flag indicates if a pending restart was merged.

8. **Redacted configs:** Both `config.get` and `config.patch` responses return configs with sensitive fields replaced by `***`. The DB stores configs with `${CREDENTIAL:provider:type}` placeholders. The read-back is for the **hash**, not the config content.

### Call Site Inventory (files to modify)

| Call Site | File | Current Pattern | New Pattern |
|-----------|------|----------------|-------------|
| `patchGatewayConfig()` | `instance-manager.ts:736-845` | DB-first: deep-merge to DB -> reseedConfigFiles -> read disk -> config.patch | Gateway-first: config.get -> config.patch(raw=JSON.stringify(delta)) -> config.get read-back -> DB persist |
| `updateSecurityProfile()` | `instance-manager.ts:373-428` | DB update -> reseedConfigFiles -> read disk -> config.patch | DB update -> config.get -> config.patch(raw=securityDelta) -> config.get read-back -> update config_hash |
| `reseedAndPatch()` | `channels.ts:15-46` | reseedConfigFiles -> config.get -> config.patch({patch:{}}) | config.get -> config.patch(raw=channelDelta) -> config.get read-back -> update config_hash |
| Channel enable/disable | `channels.ts:266` | calls patchGatewayConfig | No change needed -- uses patchGatewayConfig which is being refactored |
| Channel policies | `channels.ts:309` | calls patchGatewayConfig | No change needed -- uses patchGatewayConfig which is being refactored |
| `extension-credentials.ts:150` | `routes/extension-credentials.ts` | `gatewayCall('config.patch', { path, value })` -- broken format | Fix to use `{ raw: JSON.stringify(patchObj), baseHash }` with proper merge-patch object |

### reseedConfigFiles Call Sites (retain vs. convert)

| Call Site | File:Line | Action | Reason |
|-----------|-----------|--------|--------|
| `startInstanceAsync` | `instance-manager.ts:530-540` | **RETAIN** | Boot path -- seeds initial config before gateway starts |
| Auto-recovery (error->running) | `health-monitor.ts:120` | **RETAIN** | Recovery path -- instance crashed, needs config re-seed |
| Config integrity violation | `health-monitor.ts:276` | **RETAIN** | Recovery path -- config corrupted on disk |
| `patchGatewayConfig` | `instance-manager.ts:803` | **CONVERT** to config.patch directly |  |
| `updateSecurityProfile` | `instance-manager.ts:386` | **CONVERT** to config.patch directly |  |
| `reseedAndPatch` (channel configure) | `channels.ts:17` | **CONVERT** to config.patch directly |  |
| `reseedAndPatch` (channel disconnect) | `channels.ts:17` (same fn) | **CONVERT** to config.patch directly |  |

### Building Merge-Patch Objects by Config Source

The `configPatch` parameter to `patchGatewayConfig` is already a delta object suitable for merge-patch. Current callers provide:

| Caller | configPatch Shape | Merge-Patch JSON |
|--------|-------------------|------------------|
| Instance PATCH /config (identity, agent name, principles, etc.) | `{ agentName: "...", identity: "...", principles: "..." }` | `JSON.stringify({ agentName: "...", identity: "...", principles: "..." })` |
| Channel enable/disable | `{ channels: { discord: { enabled: true } }, plugins: { entries: { discord: { enabled: true } } } }` | Same as input, stringified |
| Channel policies | `{ channels: { discord: { dmPolicy: "respond" } } }` | Same as input, stringified |
| Security profile | Requires constructing from profile -> config mapping | Build security-related config delta, stringify |

**Key insight:** For `patchGatewayConfig`, the `configPatch` parameter IS the merge-patch delta. Just `JSON.stringify(configPatch)` and send as `raw`. No deep-merge needed on the platform side before sending -- the gateway handles the merge.

### updateSecurityProfile Special Case

Current flow:
1. Update `security_profile` column in DB
2. Call `reseedConfigFiles(id)` -- this regenerates the full openclaw.json from DB config + credentials
3. Read the on-disk file back
4. Send as `config.patch({ raw: fullFileContent, baseHash })`

New flow:
1. Update `security_profile` column in DB
2. Build security profile delta object (the config fields that change when security profile changes)
3. Send `config.patch({ raw: JSON.stringify(securityDelta), baseHash })` via `patchGatewayConfig`
4. config.get read-back for authoritative hash

The security delta construction depends on what `seedConfig` does for different security profiles. The security profile affects fields like `hooks`, `cron` schedules, approval requirements, etc. The implementation should extract the security-profile-to-config mapping from the adapter's `seedConfig` logic into a reusable function.

**Simpler alternative (recommended):** Have `updateSecurityProfile` call `patchGatewayConfig` with the security-relevant config delta, instead of having its own config.patch flow. This reduces duplication.

### channels.ts reseedAndPatch Replacement

Current `reseedAndPatch()` does: reseedConfigFiles (writes to disk) -> config.get (get hash) -> config.patch({patch:{}, baseHash}) -- sending an empty patch with the hash just to trigger SIGUSR1 restart.

The channel configure/disconnect routes store credentials in DB first, then call `reseedAndPatch` to push the new credential into the running gateway. The credential-to-config resolution happens in `seedConfig()`.

**Problem:** Channel credentials are resolved by `seedConfig()` into actual config content (e.g., WhatsApp API key -> `channels.whatsapp.credentials.apiKey`). The gateway needs the resolved config, not the credential placeholder.

**Solution:** For channel configure/disconnect, the route should:
1. Store/delete credentials in DB (already done)
2. Build the channel config delta from the credential data (resolve credential -> config mapping)
3. Call `patchGatewayConfig(instanceId, userId, channelConfigDelta)` which handles the gateway-first flow

This means the credential-to-config resolution logic (currently buried in `seedConfig()`) needs to be extractable for individual channel changes. If this is too complex for Phase 10, an acceptable intermediate step is to have `reseedAndPatch` call `patchGatewayConfig` with the full channel section from a fresh `seedConfig()` result (without writing to disk).

### Anti-Patterns to Avoid
- **Never write DB before gateway confirms** (for running instances) -- this was the root cause of P5 (silent state divergence)
- **Never use `{ patch: {...} }` or `{ path, value }` format** -- the gateway schema rejects these with `additionalProperties: false`
- **Never store redacted config from gateway into DB** -- credential placeholders would be lost
- **Never call reseedConfigFiles for a config change to a running instance** -- this writes to the container volume, which the gateway may overwrite or normalize

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Merge-patch merge | Custom deep-merge for config delta | `JSON.stringify(configPatch)` as raw merge-patch | Gateway handles RFC 7396 merge internally; platform just sends the delta |
| Rate limit tracking | Client-side rate-limit counter | Gateway's error response `retryAfterMs` | Gateway already tracks per-client; use its `retryAfterMs` value for delay |
| Config hash computation | SHA-256 of serialized config | `config.get` response `hash` field | Gateway computes hash of raw file; platform hash would differ due to formatting |
| Conflict detection | Timestamp-based or version-number concurrency | Gateway's `baseHash` optimistic concurrency | Gateway is the authority; hash-based CAS is already implemented |

**Key insight:** The gateway does most of the heavy lifting. The platform's job is to correctly format the request and handle the response, not to replicate gateway logic.

## Common Pitfalls

### Pitfall 1: Redacted Config Stored as Authoritative
**What goes wrong:** After config.get read-back, platform stores the redacted config to DB, losing `${CREDENTIAL:...}` placeholders. Next boot, seedConfig reads DB config with `***` instead of credential references.
**Why it happens:** The CONTEXT.md says "store the full config + hash in DB as authoritative" which could be interpreted as storing the gateway's response.
**How to avoid:** Only store the **hash** from config.get. The config content in DB is the platform's deep-merged version (with credential placeholders intact). Update `config_hash` column from gateway's authoritative hash.
**Warning signs:** Credentials stop resolving after a config change, `***` appears in DB config.

### Pitfall 2: extension-credentials.ts Uses Wrong config.patch Format
**What goes wrong:** The `{ path: configPath, value: secretRef }` format at `extension-credentials.ts:150` is not in the `ConfigPatchParamsSchema` (which has `additionalProperties: false`). This call may silently fail or be rejected.
**Why it happens:** Phase 9 deferred this to Phase 10: "Preserve the existing parameter format (Phase 10 addresses correct config.patch format)."
**How to avoid:** Convert to `{ raw: JSON.stringify({ skills: { entries: { [id]: { env: { [field]: secretRef } } } } }), baseHash }` format. This is a Phase 10 deliverable.
**Warning signs:** Extension credential injection fails silently.

### Pitfall 3: config.patch Triggers SIGUSR1 Even for Non-Plugin Changes
**What goes wrong:** Every `config.patch` call triggers a gateway SIGUSR1 restart, even for changes to hooks, cron, or models that could be hot-reloaded. This causes unnecessary downtime.
**Why it happens:** The `config.patch` handler unconditionally calls `scheduleGatewaySigusr1Restart()` at line 409 of the gateway source. The hot-reload classification in `config-reload-plan.ts` only applies to file-watcher-driven changes, not `config.patch`.
**How to avoid:** Accept this as a gateway limitation. Use `restartDelayMs: 2000` to give the platform time to process the response before the restart. In the future, the gateway may add a hot-reload path for `config.patch`.
**Warning signs:** Users report brief disconnections after every config save.

### Pitfall 4: Race Between config.patch Response and SIGUSR1
**What goes wrong:** The `config.patch` response arrives, platform starts config.get read-back, but SIGUSR1 fires during the read-back, killing the gateway. The read-back fails or returns stale data.
**Why it happens:** `restartDelayMs` defaults to 0 if not specified. Even with 2000ms delay, the timing can be tight.
**How to avoid:** Always set `restartDelayMs: 2000` (matches current code). The post-patch config.get is critical -- if it fails, catch the error and fall back to using the hash from the `config.patch` response (which includes `restart.delayMs`). If config.get fails, still persist the platform's merged config to DB; the hash will be refreshed on next operation.
**Warning signs:** Intermittent "Gateway RPC timeout: config.get" errors after config saves.

### Pitfall 5: Channel Configure Still Needs Credential Resolution
**What goes wrong:** Channel configure/disconnect routes store/delete credentials, then need to push the change to the gateway. But the gateway needs actual credential values in the config (e.g., WhatsApp API key), not the `${CREDENTIAL:...}` placeholder.
**Why it happens:** The current `reseedAndPatch` flow uses `reseedConfigFiles` which calls `seedConfig()` to resolve credentials into config. Removing reseedConfigFiles means losing this credential resolution step.
**How to avoid:** For channel operations, the simplest approach is to let `reseedConfigFiles` remain as the mechanism that resolves credentials and writes files, then use `config.patch` to trigger the restart. Alternatively, extract the credential resolution logic from `seedConfig` into a helper. **Recommendation:** Keep the channel configure path using `patchGatewayConfig` with the resolved channel config section -- build the delta from the credential data, not from seedConfig.
**Warning signs:** Channel credentials not reaching the gateway after configure.

### Pitfall 6: Empty Patch on reseedAndPatch Replacement
**What goes wrong:** Current `reseedAndPatch` sends `config.patch({ patch: {}, baseHash })` -- an empty patch just to trigger SIGUSR1. The `{ patch: {} }` format is already broken. But the intent (trigger restart after file-system credential change) needs to be preserved.
**How to avoid:** When the goal is to trigger a restart (not to change config), send `config.patch({ raw: "{}", baseHash })` -- an empty JSON object as merge-patch, which changes nothing but triggers SIGUSR1. However, this is wasteful of the 3/60s rate limit. Better: build the actual channel config delta and send it as a real merge-patch.

## Code Examples

### Example 1: Gateway-First patchGatewayConfig (Core Pattern)
```typescript
// Source: refactored patchGatewayConfig in instance-manager.ts
// Verified gateway schema: ConfigPatchParamsSchema (openclaw/.../protocol/schema/config.ts:31)

export async function patchGatewayConfig(
  instanceId: string,
  userId: string,
  configPatch: Record<string, unknown>,
  note?: string,
): Promise<void> {
  const instance = await getInstance(instanceId, userId);
  if (!instance) throw new Error('Instance not found');

  // Stopped instances: DB-only (CFG-02)
  if (instance.status !== 'running' || !instance.controlEndpoint) {
    const mergedConfig = deepMerge(
      (instance.config || {}) as Record<string, unknown>,
      configPatch,
    );
    await updateInstanceConfig(instanceId, userId, mergedConfig);
    return;
  }

  // Gateway-first for running instances (CFG-01)
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Step 1: Get current hash (CFG-03)
    const cfgResult = await gatewayCall(instanceId, 'config.get', {}) as {
      hash?: string;
    };
    const baseHash = cfgResult?.hash;
    if (!baseHash) throw new Error('Unable to retrieve gateway config hash');

    // Step 2: Send merge-patch (CFG-04)
    try {
      await gatewayCall(instanceId, 'config.patch', {
        raw: JSON.stringify(configPatch),
        baseHash,
        note: note || 'Platform config update',
        restartDelayMs: 2000,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Stale hash: retry from step 1
      if (errMsg.includes('config changed since last load') && attempt < MAX_RETRIES) {
        continue;
      }

      // Rate limit: wait and retry (CFG-05)
      const retryMatch = errMsg.match(/retry after (\d+)s/);
      if (retryMatch && errMsg.includes('rate limit')) {
        const waitMs = parseInt(retryMatch[1], 10) * 1000 + 1000; // add 1s buffer
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      // All other errors: fail visibly (locked decision)
      throw err;
    }

    // Step 3: Read-back hash (CFG-07)
    let authoritativeHash = baseHash; // fallback if read-back fails
    try {
      const readBack = await gatewayCall(instanceId, 'config.get', {}) as {
        hash?: string;
      };
      if (readBack?.hash) authoritativeHash = readBack.hash;
    } catch {
      // Read-back failed (gateway may be restarting) -- use pre-patch hash
      // Hash will be refreshed on next operation
    }

    // Step 4: DB sync (synchronous -- locked decision)
    const mergedConfig = deepMerge(
      (instance.config || {}) as Record<string, unknown>,
      configPatch,
    );
    await db('instances').where({ id: instanceId }).update({
      config: JSON.stringify(mergedConfig),
      config_hash: authoritativeHash,
      updated_at: db.fn.now(),
    });

    return;
  }

  throw new Error('Config patch failed after max retries');
}
```

### Example 2: Rate Limit Error Detection
```typescript
// Source: gateway rate limit response format
// Verified: openclaw/src/gateway/server-methods.ts:116-132

// Gateway rate limit error arrives as:
// { ok: false, error: { message: "rate limit exceeded for config.patch; retry after 45s",
//                        code: "UNAVAILABLE", retryable: true, retryAfterMs: 45000,
//                        details: { method: "config.patch", limit: "3 per 60s" } } }
//
// In PersistentGatewayClient.call(), this becomes:
// Error("Gateway RPC error: rate limit exceeded for config.patch; retry after 45s")

function parseRateLimitDelay(errorMessage: string): number | null {
  if (!errorMessage.includes('rate limit')) return null;
  const match = errorMessage.match(/retry after (\d+)s/);
  if (!match) return null;
  return parseInt(match[1], 10) * 1000;
}
```

### Example 3: extension-credentials.ts Fix (CFG-04)
```typescript
// Current (broken -- { path, value } not in ConfigPatchParamsSchema):
await gatewayCall(instanceId, 'config.patch', { path: configPath, value: secretRef }, 30_000);

// Correct: build merge-patch object from path notation
// "skills.entries.mySkill.env.API_KEY" -> { skills: { entries: { mySkill: { env: { API_KEY: secretRef } } } } }
function buildMergePatchFromPath(path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.');
  let obj: Record<string, unknown> = {};
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return obj;
}

// Usage:
const patchObj = buildMergePatchFromPath(configPath, secretRef);
const cfgResult = await gatewayCall(instanceId, 'config.get', {}) as { hash?: string };
await gatewayCall(instanceId, 'config.patch', {
  raw: JSON.stringify(patchObj),
  baseHash: cfgResult?.hash,
  note: `Extension credential: ${validatedKind} ${validatedExtensionId}`,
  restartDelayMs: 2000,
}, 30_000);
```

### Example 4: updateSecurityProfile Refactor
```typescript
// Simplified: delegate to patchGatewayConfig for the gateway-first flow
export async function updateSecurityProfile(
  id: string, userId: string, profile: SecurityProfile
): Promise<Instance> {
  const instance = await getInstance(id, userId);
  if (!instance) throw new Error('Instance not found');

  // 1. Update the security_profile column
  await db('instances').where({ id, user_id: userId })
    .update({ security_profile: profile, updated_at: db.fn.now() });

  // 2. For running instances, push security-related config delta to gateway
  if (instance.status === 'running' && instance.controlEndpoint) {
    // Build the config delta that corresponds to this security profile change.
    // The adapter's seedConfig knows how to map profile -> config; extract that logic.
    const securityDelta = buildSecurityProfileDelta(instance, profile);
    if (securityDelta && Object.keys(securityDelta).length > 0) {
      await patchGatewayConfig(id, userId, securityDelta, `Security profile -> ${profile}`);
    }
  }

  return (await getInstance(id, userId))!;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DB-first config update (write DB, then push to gateway) | Gateway-first (push to gateway, then sync DB) | Phase 10 (this phase) | Eliminates P5 silent state divergence |
| reseedConfigFiles for all config changes | reseedConfigFiles for boot/recovery only | Phase 10 (this phase) | Eliminates container volume writes for running instances |
| `{ patch: {...} }` config.patch format | `{ raw: "<json5>" }` merge-patch format | Gateway 2026.3.13+ | Correct protocol; old format was broken |
| File-hash-based config integrity check | Gateway-hash-based config integrity (Phase 13) | Phase 13 (future) | Eliminates P4 infinite reseed loop |
| Ephemeral GatewayRPCClient for RPC | gatewayCall() facade (Phase 9) | Phase 9 (complete) | All RPC through persistent client |

**Deprecated/outdated:**
- `{ patch: configPatch }` parameter: Never worked; gateway schema has `additionalProperties: false`
- `{ path, value }` parameter: Not part of ConfigPatchParamsSchema; likely silently dropped
- reseedConfigFiles for running instance config changes: Replaced by direct config.patch
- Reading container files for config content: Replaced by config.get for hash

## Open Questions

1. **Security profile to config delta mapping**
   - What we know: `seedConfig()` in the adapter maps security profiles to full config files. The mapping includes hooks, cron schedules, approval requirements, and DLP settings.
   - What's unclear: How to extract just the delta for a security profile change without regenerating the full config. The `seedConfig` function returns the complete config file set, not a diff.
   - Recommendation: Either (a) compute the delta by calling seedConfig twice (once with old profile, once with new) and diffing, or (b) create a dedicated `buildSecurityProfileDelta()` function that returns only the security-relevant config keys. Option (b) is cleaner but requires understanding all security-profile-affected config keys. Start with option (a) as it's correct by construction.

2. **Channel credential resolution without reseedConfigFiles**
   - What we know: Channel configure stores credentials in DB, then reseedConfigFiles resolves them into gateway config (e.g., Telegram bot token -> channels.telegram.credentials.botToken).
   - What's unclear: The credential-to-config mapping for each channel type. This is currently only expressed in `seedConfig()`.
   - Recommendation: For Phase 10, keep a simplified resolution path: after storing credentials, call the adapter's `seedConfig()` to get the full channel config section, then extract the relevant channel delta and send as merge-patch. This reuses existing logic without extracting it.

3. **config.patch response hash vs. config.get hash**
   - What we know: config.patch response includes a `config` field (redacted). It does NOT include a `hash` field -- the hash is only in config.get responses.
   - What's unclear: Whether the config.patch response's `sentinel.payload` or `restart` metadata includes enough info to derive the hash.
   - Recommendation: Use `config.get` after successful `config.patch` for the authoritative hash. The extra round-trip is acceptable given config changes are rare user actions.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (Chromium) |
| Config file | `playwright.config.ts` at repo root |
| Quick run command | `npx playwright test tests/e2e/api.spec.ts -x` |
| Full suite command | `npx playwright test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CFG-01 | Config updates operate gateway-first for running instances | e2e (requires Docker) | `npx playwright test tests/e2e/instance-lifecycle.spec.ts -x` | Exists but doesn't test config lifecycle |
| CFG-02 | Stopped instances write DB only | e2e | `npx playwright test tests/e2e/api.spec.ts -g "config" -x` | Needs new test |
| CFG-03 | baseHash tracked and used for concurrency | manual-only | N/A -- requires running gateway to verify hash flow | Manual: verify via gateway logs |
| CFG-04 | Correct `{ raw }` merge-patch format | manual-only | N/A -- requires running gateway | Manual: observe config.patch RPC in gateway logs |
| CFG-05 | Rate limit enforcement via retry-on-429 | manual-only | N/A -- rate limit requires 4+ rapid calls | Manual: fire 4 config.patch calls, verify delay |
| CFG-06 | reseedConfigFiles not called for running instances | manual-only | N/A -- verify via code review + logs | Code review: grep for reseedConfigFiles calls |
| CFG-07 | config.get read-back persists authoritative hash | manual-only | N/A -- requires running gateway | Manual: verify config_hash column updated |

### Sampling Rate
- **Per task commit:** `npx playwright test tests/e2e/api.spec.ts -x` (basic API health)
- **Per wave merge:** `npx playwright test` (full suite, CI-safe tests only)
- **Phase gate:** Full suite green + manual testing of gateway-first flow with running instance

### Wave 0 Gaps
- [ ] No existing test covers config lifecycle for running instances (all config tests are API-level, not gateway-level)
- [ ] Gateway interaction requires Docker -- CI skips these tests (`CI=true` mode)
- [ ] Manual testing guide needed for verifying gateway-first config flow

*(Manual testing is the primary validation method for this phase due to the gateway dependency. See `docs/manual-testing-guide.md` if it exists.)*

## Sources

### Primary (HIGH confidence)
- OpenClaw gateway source: `openclaw/src/gateway/protocol/schema/config.ts:19-31` -- ConfigPatchParamsSchema definition, `additionalProperties: false`
- OpenClaw gateway source: `openclaw/src/gateway/server-methods/config.ts:317-437` -- config.patch handler, merge-patch flow, SIGUSR1 scheduling
- OpenClaw gateway source: `openclaw/src/gateway/server-methods/config.ts:54-98` -- requireConfigBaseHash, error messages for stale/missing hash
- OpenClaw gateway source: `openclaw/src/gateway/control-plane-rate-limit.ts:3-4` -- 3 requests per 60s limit
- OpenClaw gateway source: `openclaw/src/gateway/server-methods.ts:38,109-133` -- CONTROL_PLANE_WRITE_METHODS, rate limit error response format
- OpenClaw gateway source: `openclaw/src/config/merge-patch.ts:62-97` -- RFC 7396 merge-patch + id-keyed array merge
- OpenClaw gateway source: `openclaw/src/config/redact-snapshot.ts:373-380` -- redactConfigObject used in both config.get and config.patch responses
- Aquarium source: `apps/server/src/services/instance-manager.ts:736-845` -- current patchGatewayConfig (DB-first)
- Aquarium source: `apps/server/src/services/instance-manager.ts:373-428` -- current updateSecurityProfile
- Aquarium source: `apps/server/src/services/instance-manager.ts:239-328` -- current reseedConfigFiles
- Aquarium source: `apps/server/src/routes/channels.ts:15-46` -- current reseedAndPatch
- Aquarium source: `apps/server/src/routes/extension-credentials.ts:148-160` -- broken config.patch format
- Aquarium source: `apps/server/src/agent-types/openclaw/gateway-rpc.ts:12-26` -- gatewayCall facade (Phase 9)
- Aquarium source: `apps/server/src/services/gateway-event-relay.ts:453-501` -- PersistentGatewayClient.call() with queue

### Secondary (MEDIUM confidence)
- Phase 9 research: `.planning/phases/09-rpc-consolidation/09-RESEARCH.md` -- gatewayCall facade pattern, queue behavior
- Milestone research: `.planning/research/SUMMARY.md` -- pitfalls P1, P3, P4, P5 relevant to config lifecycle

### Tertiary (LOW confidence)
- None -- all findings verified from source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies; all verified from installed packages
- Architecture: HIGH -- gateway protocol verified from source; current code paths read directly
- Pitfalls: HIGH -- all pitfalls verified from gateway source (schema, error formats, restart behavior)
- Protocol format: HIGH -- ConfigPatchParamsSchema with additionalProperties:false verified directly

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable -- gateway protocol v3 is not changing soon)
