---
phase: 05-oauth-advanced-auth
plan: "02"
subsystem: vault-integration
tags: [vault, secretref, exec, onepassword, hashicorp, credentials, extension-credentials]
dependency_graph:
  requires: []
  provides: [vault-config-api, exec-secretref-resolution]
  affects: [instance-settings, extension-credentials, seedConfig, resolveEnv]
tech_stack:
  added: []
  patterns: [exec-secretref, vault-cli-command-injection, instance-config-json-storage]
key_files:
  created:
    - apps/server/src/db/migrations/038_vault_config.ts
  modified:
    - apps/server/src/routes/instances.ts
    - apps/server/src/agent-types/openclaw/adapter.ts
decisions:
  - "Vault config stored in instances.config JSON column (no schema migration needed)"
  - "exec SecretRef gated on supportsSecretRef(imageTag) — older gateways fall back gracefully"
  - "vault-backed credential env injection skipped in resolveEnv — exec resolution handles it"
  - "VAULT_ADDR/VAULT_NAMESPACE injected via resolveEnv (not seedConfig) — container env vars"
  - "Mixed vault + env-backed credentials per instance supported — each credential resolved independently"
metrics:
  duration_seconds: 181
  completed_date: "2026-04-04"
  tasks_completed: 2
  files_modified: 3
---

# Phase 5 Plan 02: SecretRef Vault Integration Summary

**One-liner:** Vault config API (1Password/HashiCorp) stored in instance config JSON with exec SecretRef injection in seedConfig for gateway CLI-based secret resolution at container startup.

## What Was Built

### Task 1: Vault Config API Endpoint and Migration Placeholder

Added three endpoints to `apps/server/src/routes/instances.ts`:

- `GET /:id/vault-config` — reads `vaultConfig` from instance config JSON
- `PUT /:id/vault-config` — validates and persists vault config (`type`, `address`, `namespace`, `authMethod`, `mountPath`)
- `DELETE /:id/vault-config` — removes vault config from instance config JSON

Validation rules:
- `type` required: must be `'onepassword'` or `'hashicorp'`
- `address` required for `hashicorp` type
- All endpoints verify instance ownership via `req.auth!.userId`

Created no-op migration `038_vault_config.ts` documenting that vault config lives in the existing `instances.config` JSON column.

### Task 2: exec SecretRef Resolution in seedConfig

Extended `adapter.ts` `seedConfig` and `resolveEnv` functions:

**seedConfig changes:**
- Extracts `vaultConfig` from `userConfig` at function start
- When vault is configured and gateway supports SecretRef, adds `vault: { source: 'exec' }` provider to `cfg.secrets.providers`
- Iterates `credentials` looking for `metadata.source === 'vault'` + `metadata.vaultPath`
- For vault-backed credentials, generates exec SecretRef command:
  - 1Password: `['op', 'read', 'op://<vaultPath>']`
  - HashiCorp: `['vault', 'kv', 'get', '-field=value', '-mount=<mountPath>', '<vaultPath>']`
- Injects exec SecretRef into `skills.entries.<id>.env.<field>` or `plugins.entries.<id>.config.<field>`
- Vault-backed credentials skip `AQUARIUM_CRED_xxx` env injection (no raw secret in container env)

**resolveEnv changes:**
- Extracts `vaultConfig` from `instance.config`
- Injects `VAULT_ADDR` and optionally `VAULT_NAMESPACE` for HashiCorp Vault
- Skips env var injection for any credential with `metadata.source === 'vault'`

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `apps/server/src/db/migrations/038_vault_config.ts` — FOUND
- `apps/server/src/routes/instances.ts` vault-config routes — FOUND (lines 334, 354, 395)
- `apps/server/src/agent-types/openclaw/adapter.ts` exec SecretRef — FOUND
- Commits `8e88f85` and `d147f79` — verified via git log
- TypeScript typecheck (`npx tsc --noEmit -p apps/server/tsconfig.json`) — PASSED
