---
phase: 03-clawhub-trust-policy
plan: "01"
subsystem: trust-policy
tags: [trust, types, migration, sqlite, service]
dependency_graph:
  requires: [extension-types, extension-tables]
  provides: [trust-types, trust-overrides-table, trust-store-service]
  affects: [03-03-trust-routes, 03-04-trust-ui]
tech_stack:
  added: []
  patterns: [deny-by-default-trust, upsert-on-conflict, dialect-aware-raw-sql]
key_files:
  created:
    - apps/server/src/db/migrations/037_trust_overrides.ts
    - apps/server/src/services/trust-store.ts
  modified:
    - packages/shared/src/types.ts
decisions:
  - "TrustOverride optional field on InstancePlugin and InstanceSkill is forward-compatible — existing rows return undefined, consumers check for non-null before applying trust logic"
  - "unscanned tier blocks without override possibility — virusTotalPassed false/null treated identically (both indicate scan not cleared)"
  - "createTrustOverride uses dialect-aware ON CONFLICT DO UPDATE for SQLite vs Postgres (EXCLUDED vs excluded keyword case matches each dialect)"
  - "Migration 037 registered directly in knex_migrations as .js (matching existing convention) after direct SQLite CREATE TABLE — pre-existing knex corrupt-directory issue prevents npm run migrate from executing"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-04-04"
  tasks_completed: 2
  files_changed: 3
---

# Phase 3 Plan 01: Trust Policy Foundation Summary

**One-liner:** Trust tier computation and deny-by-default policy enforcement with TrustTier/TrustSignals/TrustOverride types, trust_overrides SQLite table, and trust-store service for bundled/verified/community/unscanned classification.

## What Was Built

This plan establishes the trust policy foundation layer. All trust-related features (routes, UI enforcement, ClawHub catalog) depend on these types, the DB table, and the service functions.

### Shared Types (packages/shared/src/types.ts)

Note: types were already added in commit a62ebfd (feat(03-02)) which ran in a prior session. This plan's work confirmed their correctness and added the migration.

| Type | Kind | Purpose |
|------|------|---------|
| `TrustTier` | union type | 'bundled' | 'verified' | 'community' | 'unscanned' |
| `TrustSignals` | interface | verifiedPublisher, downloadCount, ageInDays, virusTotalPassed from ClawHub |
| `TrustOverride` | interface | Admin approval record with reason, userId, credentialAccessAcknowledged |
| `TrustDecision` | union type | 'allow' | 'block' |
| `TrustEvaluation` | interface | Full evaluation result: tier + decision + signals + override + blockReason |
| `ClawHubCatalogEntry` | interface | ClawHub catalog item with trustSignals, kind discriminator |

Optional fields added to extension interfaces:
- `InstancePlugin.trustOverride?: TrustOverride | null`
- `InstanceSkill.trustOverride?: TrustOverride | null`
- `PluginCatalogEntry.trustSignals?: TrustSignals`, `trustTier?: TrustTier`
- `SkillCatalogEntry.trustSignals?: TrustSignals`, `trustTier?: TrustTier`

### Migration 037 (apps/server/src/db/migrations/037_trust_overrides.ts)

Creates `trust_overrides` table:

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | app-generated |
| instance_id | UUID FK | -> instances(id) ON DELETE CASCADE |
| extension_id | string | ClawHub extension identifier |
| extension_kind | string | 'plugin' or 'skill' |
| action | string | DEFAULT 'allow' (only override type currently) |
| reason | text | Admin-provided justification |
| user_id | UUID | Admin who created the override |
| credential_access_acknowledged | integer | Boolean: user confirmed credential access risk |
| created_at | timestamp | UTC |
| UNIQUE | (instance_id, extension_id, extension_kind) | One override per extension per instance |

### Trust-Store Service (apps/server/src/services/trust-store.ts)

Five exported functions:

**`computeTrustTier(source, signals) -> TrustTier`**
- `bundled` → source.type === 'bundled'
- `unscanned` → signals null, virusTotalPassed null, or virusTotalPassed false
- `verified` → verifiedPublisher AND downloadCount > 100 AND ageInDays > 90 AND virusTotalPassed true
- `community` → everything else (ClawHub extension not meeting verified bar)

**`evaluateTrustPolicy(instanceId, extensionId, extensionKind, source, signals) -> Promise<TrustEvaluation>`**
- bundled/verified → `allow` immediately
- unscanned → `block` with no override path ("Security scan not available or failed")
- community → check DB for override; `allow` if found, `block` if not ("An admin must approve")

**`createTrustOverride(instanceId, extensionId, extensionKind, reason, userId, credentialAccessAcknowledged)`**
- Guards: throws if `credentialAccessAcknowledged !== true`
- Upserts via dialect-aware `ON CONFLICT DO UPDATE`
- Returns the stored row

**`getTrustOverride(instanceId, extensionId, extensionKind) -> Promise<TrustOverride | null>`**

**`getTrustOverridesForInstance(instanceId) -> Promise<TrustOverride[]>`**

## Deviations from Plan

### Context Difference (Not a Bug)

**1. [Pre-existing] Types already committed in 03-02**
- **Found during:** Task 1 verification
- **Issue:** The feat(03-02) commit (a62ebfd) ran in a prior session and included all Trust Policy Types plus the optional fields on InstancePlugin/InstanceSkill/PluginCatalogEntry/SkillCatalogEntry. Task 1 edits were no-ops on types.ts.
- **Impact:** None — types are correct; migration was still needed and created fresh.

### Auto-fixed Issues

**2. [Rule 3 - Blocking] knex `npm run migrate` corrupt directory error**
- **Found during:** Task 1 verification
- **Issue:** Pre-existing mismatch: knex_migrations records `.js` extension names but migration files are `.ts`. Knex validate step fails with "corrupt migration directory" when `.js` files don't exist.
- **Fix:** Created trust_overrides table directly via `sqlite3` CLI, then inserted migration record into knex_migrations manually (matching `.js` naming convention of existing rows).
- **Files modified:** None (DB change)

## Self-Check: PASSED

- [x] packages/shared/src/types.ts — TrustTier, TrustSignals, TrustOverride, TrustEvaluation, ClawHubCatalogEntry exported
- [x] apps/server/src/db/migrations/037_trust_overrides.ts — exists, creates trust_overrides table
- [x] apps/server/src/services/trust-store.ts — exists, exports 5 functions
- [x] trust_overrides table in SQLite DB — confirmed via sqlite3 query
- [x] Migration 037 registered in knex_migrations — confirmed
- [x] `npm run build -w @aquarium/shared` — passes
- [x] `npm run typecheck -w @aquaclawai/aquarium` — passes
- [x] Commits: 8dde316 (migration), 45c928e (trust-store service)
