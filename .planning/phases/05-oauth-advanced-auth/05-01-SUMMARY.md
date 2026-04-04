---
phase: 05-oauth-advanced-auth
plan: "01"
subsystem: oauth-proxy
tags: [oauth, extensions, credentials, template-export, vault]
dependency_graph:
  requires: []
  provides: [oauth-proxy-route, requiresReAuth-type, template-oauth-export]
  affects: [template-store, extension-credentials, server-core]
tech_stack:
  added: []
  patterns: [oauth-browser-redirect-proxy, sentinel-credential-row, vault-metadata-persistence]
key_files:
  created:
    - apps/server/src/routes/oauth-proxy.ts
  modified:
    - packages/shared/src/types.ts
    - apps/server/src/routes/extension-credentials.ts
    - apps/server/src/server-core.ts
    - apps/server/src/services/template-store.ts
decisions:
  - "OAuth callback writes oauth_token sentinel row with credential_type='oauth_token' and value='GATEWAY_MANAGED' so template export can detect OAuth-backed extensions without storing actual tokens"
  - "oauthExtensionIds Set built from provider name AND metadata.extensionId as dual fallback for robust OAuth detection on export"
  - "requiresReAuth=true forces initial status='installed' on import, never 'pending', ensuring extension awaits user re-auth before seedConfig loads it"
  - "source/vaultPath vault metadata persisted in extension-credentials route so adapter.ts seedConfig can resolve vault references"
metrics:
  duration_seconds: 231
  tasks_completed: 2
  files_modified: 5
  completed_date: "2026-04-04"
---

# Phase 5 Plan 1: OAuth Proxy Route and Template Re-Auth Flag Summary

**One-liner:** Extension-scoped OAuth browser redirect proxy with gateway token exchange, sentinel credential rows for template export OAuth detection, and requiresReAuth import flag.

## What Was Built

### Task 1: OAuth Proxy Route and Extension-Credentials Vault Metadata

Created `apps/server/src/routes/oauth-proxy.ts` — an Express router exposing three endpoints:

- `POST /:id/oauth-proxy/initiate` — Validates instance + extension, generates a 16-byte hex state token, stores an in-memory `OAuthProxySession` (10-minute TTL), calls `auth.getOAuthUrl` RPC on the gateway (15s timeout, falls back gracefully if not supported), returns `{ authUrl, state }` to the frontend for popup/redirect.

- `GET /:id/oauth-proxy/callback` — OAuth provider callback. Validates state token (one-time use, TTL enforced), relays authorization code to gateway via `auth.exchangeToken` RPC (30s timeout). On success: writes an `oauth_token` sentinel credential row via `addCredential()` with `value='GATEWAY_MANAGED'` and `metadata.extensionId`/`metadata.extensionKind`; updates extension status `installed -> active` in the appropriate DB table. Returns an HTML page with `window.opener.postMessage` for popup close detection.

- `GET /:id/oauth-proxy/status/:extensionId` — Quick poll endpoint returning `{ connected: status === 'active' }` from `instance_plugins` or `instance_skills`.

Extended `extension-credentials.ts` to accept optional `source` and `vaultPath` fields. Added validation (source must be `'vault'` if provided; vaultPath must be non-empty string when source is vault). Persists `metadata.source = 'vault'` and `metadata.vaultPath` in the `addCredential()` call so `adapter.ts seedConfig` can resolve vault credential references.

Mounted `oauthProxyRoutes` in `server-core.ts` adjacent to the existing `extensionCredentialRoutes`.

### Task 2: requiresReAuth Type and Export/Import Logic

Added `requiresReAuth?: boolean` to `TemplateExtensionDeclaration` in `packages/shared/src/types.ts`.

Updated `exportFromInstance` in `template-store.ts`:
- Fetches all `instance_credentials` for the instance after loading extension rows
- Builds `oauthExtensionIds` Set from credentials where `credential_type === 'oauth_token'`, using both `metadata.extensionId` and `provider` as keys
- For each plugin/skill in the export loop: sets `requiresReAuth: true`, `needsCredentials: true`, and clears `config: {}` when the extension is in `oauthExtensionIds`
- Non-OAuth extensions are unaffected (field omitted when falsy)

Updated `instantiateTemplate` in `template-store.ts`:
- Derives `initialStatus` before inserting lifecycle row: `ext.requiresReAuth ? 'installed' : (ext.enabled ? 'pending' : 'disabled')`
- This ensures OAuth-backed imported extensions land in `installed` status and prompt re-authentication, never entering the `pending -> active` boot flow until the user completes OAuth

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

All 8 verification criteria passed:
1. `npm run build -w @aquarium/shared` succeeds
2. `npx tsc --noEmit -p apps/server/tsconfig.json` passes
3. `oauth-proxy.ts` exports a default Router with initiate/callback/status endpoints
4. `oauth-proxy.ts` callback calls `addCredential()` with `credential_type='oauth_token'`
5. `extension-credentials.ts` persists `source` and `vaultPath` in metadata
6. `TemplateExtensionDeclaration` includes `requiresReAuth?: boolean`
7. `exportFromInstance` detects `oauth_token` credentials and sets `requiresReAuth: true`
8. `instantiateTemplate` forces `installed` status for `requiresReAuth` extensions

## Commits

- `0f98bf7` — feat(05-01): OAuth proxy route and extension-credentials vault metadata
- `b837eac` — feat(05-01): add requiresReAuth to TemplateExtensionDeclaration, update export/import

## Self-Check: PASSED

- FOUND: apps/server/src/routes/oauth-proxy.ts
- FOUND: .planning/phases/05-oauth-advanced-auth/05-01-SUMMARY.md
- FOUND: commit 0f98bf7
- FOUND: commit b837eac
