---
phase: 05-oauth-advanced-auth
verified: 2026-04-03T01:00:00Z
status: human_needed
score: 11/11 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 9/11
  gaps_closed:
    - "After user authorizes in the browser, the callback relays the auth code to the gateway for token exchange"
    - "OAuth callback writes an oauth_token credential row so template export can detect it"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Open an extension credential panel on an OAuth-supporting extension and click the Connect button"
    expected: "Popup opens, user authorizes, panel shows authenticated state and extension transitions to active"
    why_human: "End-to-end OAuth popup/postMessage flow requires a running browser and gateway; can only be confirmed visually"
  - test: "Configure HashiCorp Vault in the Vault Integration section of an instance settings page"
    expected: "Form accepts address/namespace/authMethod, saves, and vault source option appears in CredentialConfigPanel"
    why_human: "Visual rendering and form state transitions require browser inspection"
---

# Phase 5: OAuth Advanced Auth Verification Report

**Phase Goal:** Users can authenticate plugins requiring OAuth via the platform's browser proxy flow, and OAuth tokens are excluded from template exports
**Verified:** 2026-04-03
**Status:** human_needed (all automated checks pass; two items require browser/runtime confirmation)
**Re-verification:** Yes — after gap closure

## Re-verification Summary

Previous status: `gaps_found` (9/11, 2 gaps)
Current status: `human_needed` (11/11 automated)

The single root-cause bug (`getInstance(instanceId, session.instanceId)` on the old line 179) has been fixed. The `OAuthProxySession` interface now includes `userId: string` (line 22), the initiate handler stores `userId: req.auth!.userId` in the session (line 87), and the callback handler correctly calls `getInstance(instanceId, session.userId)` (line 181). Both previously-blocked truths are now code-verified.

---

## Goal Achievement

### Observable Truths (Plan 05-01)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can initiate an OAuth browser redirect flow for an extension that requires OAuth credentials | VERIFIED | `POST /:id/oauth-proxy/initiate` exists in `oauth-proxy.ts` lines 46-115; validates instance, generates state token, stores `userId: req.auth!.userId` in session, calls `auth.getOAuthUrl` RPC, returns `{ authUrl, state }` |
| 2 | After user authorizes in the browser, the callback relays the auth code to the gateway for token exchange | VERIFIED | Callback handler line 181: `getInstance(instanceId, session.userId)` — `userId` is now correctly stored in `OAuthProxySession`; RPC call `auth.exchangeToken` at line 193 is reachable and correct |
| 3 | Gateway stores OAuth tokens in auth-profiles.json; extension status updates to active | VERIFIED (code path) | Lines 210-226: `instance_plugins`/`instance_skills` `status` updated from `'installed'` to `'active'` after successful RPC; runtime behavior requires human verification |
| 4 | OAuth callback writes an oauth_token credential row so template export can detect it | VERIFIED | Lines 198-207: `addCredential(session.instanceId, session.provider, 'oauth_token', 'GATEWAY_MANAGED', { extensionId, extensionKind })` is now reachable; no longer blocked by the userId bug |
| 5 | Vault-sourced credentials from extension-credentials route persist source and vaultPath in metadata | VERIFIED | `extension-credentials.ts` lines 39-40, 76-118: destructures source/vaultPath, validates, persists `metadata.source = 'vault'` and `metadata.vaultPath` in addCredential |
| 6 | Exported templates mark OAuth-backed extensions with requiresReAuth=true | VERIFIED | `template-store.ts` lines 615-671: builds `oauthExtensionIds` Set from `credential_type === 'oauth_token'` rows, sets `requiresReAuth: true` and clears config for OAuth extensions |
| 7 | Imported extensions with requiresReAuth stay in installed status and prompt re-authentication | VERIFIED | `template-store.ts` lines 1093-1110: `initialStatus = ext.requiresReAuth ? 'installed' : (ext.enabled ? 'pending' : 'disabled')` |

### Observable Truths (Plan 05-02)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 8 | User can configure a vault provider (1Password or HashiCorp Vault) in instance settings | VERIFIED | `instances.ts` lines 334-415: GET/PUT/DELETE /:id/vault-config endpoints exist with full validation |
| 9 | Vault configuration is persisted in the instance config JSON column | VERIFIED | `instances.ts` line 382: `existingConfig.vaultConfig = validatedBody` merged into config JSON |
| 10 | Extension credentials can reference a vault path instead of storing raw secrets | VERIFIED | `extension-credentials.ts` persists `source: 'vault'` and `vaultPath` in credential metadata |
| 11 | seedConfig resolves exec SecretRef entries by generating vault CLI commands for the gateway | VERIFIED | `adapter.ts` lines 640-675: generates `['op', 'read', 'op://...']` for 1Password and `['vault', 'kv', 'get', ...]` for HashiCorp; `resolveEnv` skips `AQUARIUM_CRED_xxx` injection for vault-backed creds (line 942) |

### Observable Truths (Plan 05-03)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 12 | User sees a Connect with OAuth button in the CredentialConfigPanel when extension supports OAuth | VERIFIED | `CredentialConfigPanel.tsx` line 24: `supportsOAuth?: boolean` prop; line 330-357: renders OAuth connect section when supportsOAuth is true |
| 13 | Clicking the OAuth button opens a popup window for the authorization flow | VERIFIED | `CredentialConfigPanel.tsx` lines 108-123: `handleOAuthConnect` calls initiate endpoint, opens `window.open(authUrl, 'oauth-popup', 'width=600,height=700')` |
| 14 | After successful OAuth, the panel updates to show connected status | VERIFIED | `CredentialConfigPanel.tsx` lines 88-102: postMessage listener sets `oauthConnected=true` and calls `onSaved()`; the session userId bug that previously blocked this path is now fixed |
| 15 | User can configure vault provider in instance settings | VERIFIED | `VaultConfigSection.tsx` exists; integrated in `InstancePage.tsx` line 279; form renders for both 1Password and HashiCorp |
| 16 | User can choose 'From vault' source when entering extension credentials | VERIFIED | `CredentialConfigPanel.tsx` vault source toggle renders when `vaultConfigured=true`; posts `source: 'vault'` and `vaultPath` to extension-credentials endpoint |
| 17 | Imported templates with requiresReAuth extensions show a re-authentication indicator | VERIFIED | `CredentialConfigPanel.tsx` lines 228-232: `requiresReAuth && !oauthConnected` banner with `t('extensions.oauth.requiresReAuth')` |

**Score:** 11/11 core truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/routes/oauth-proxy.ts` | OAuth proxy route (initiate + callback + status) | VERIFIED | 278 lines; exports default Router; all 3 endpoints present; `OAuthProxySession` now has `userId: string`; callback uses `session.userId` |
| `packages/shared/src/types.ts` | requiresReAuth field on TemplateExtensionDeclaration | VERIFIED | Line 653: `requiresReAuth?: boolean` |
| `apps/server/src/services/template-store.ts` | OAuth detection in export, requiresReAuth import handling | VERIFIED | Lines 615-671 (export), lines 1093-1110 (import) |
| `apps/server/src/db/migrations/038_vault_config.ts` | No-op migration documenting vault config in JSON | VERIFIED | File exists; no-op up/down |
| `apps/server/src/routes/instances.ts` | PUT/GET/DELETE /:id/vault-config endpoints | VERIFIED | Lines 334, 354, 395 |
| `apps/server/src/agent-types/openclaw/adapter.ts` | exec SecretRef resolution in seedConfig | VERIFIED | Lines 640-703 (seedConfig), line 942 (resolveEnv skip) |
| `apps/web/src/components/extensions/CredentialConfigPanel.tsx` | OAuth connect button and vault source option | VERIFIED | Contains oauth-proxy/initiate call (line 113); supportsOAuth prop; vault toggle |
| `apps/web/src/components/extensions/VaultConfigSection.tsx` | Vault configuration form component | VERIFIED | Exports VaultConfigSection; GET/PUT/DELETE vault-config calls |
| `apps/web/src/i18n/locales/en.json` | English i18n keys for OAuth and vault UI | VERIFIED | `extensions.oauth` and `extensions.vault` namespaces present |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `oauth-proxy.ts` initiate | session store | `userId: req.auth!.userId` stored at line 87 | WIRED | `OAuthProxySession.userId` field added; value set from authenticated request |
| `oauth-proxy.ts` callback | gateway-rpc.ts | `rpc.call('auth.exchangeToken', ...)` | WIRED | Lines 189-193: RPC call reachable now that `getInstance(instanceId, session.userId)` returns a valid instance |
| `oauth-proxy.ts` callback | credential-store.ts | `addCredential` with `oauth_token` type | WIRED | Lines 198-207: `addCredential(session.instanceId, session.provider, 'oauth_token', 'GATEWAY_MANAGED', ...)` now reachable |
| `extension-credentials.ts` | credential-store.ts | `addCredential` with vault source/vaultPath in metadata | VERIFIED | Lines 116-118: `metadata.source = 'vault'` and `metadata.vaultPath` passed to addCredential |
| `template-store.ts` | instance_credentials | `credential_type = 'oauth_token'` detection | VERIFIED | Line 624: `cred.credential_type === 'oauth_token'` check; Set built from both `meta.extensionId` and `cred.provider` |
| `instances.ts` | instances.config | JSON merge for vaultConfig key | VERIFIED | Line 382: `existingConfig.vaultConfig = validatedBody` |
| `adapter.ts` | seedConfig | exec SecretRef generates vault CLI command | VERIFIED | Lines 666-675: conditional for `onepassword` vs `hashicorp` |
| `CredentialConfigPanel.tsx` | `/api/instances/:id/oauth-proxy/initiate` | `api.post` for OAuth initiation | VERIFIED | Line 113: `api.post(\`/instances/${instanceId}/oauth-proxy/initiate\`, ...)` |
| `VaultConfigSection.tsx` | `/api/instances/:id/vault-config` | `api.put` for vault configuration | VERIFIED | Line 92: `api.put(\`/instances/${instanceId}/vault-config\`, body)` |

---

## Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OAUTH-01 | 05-01, 05-03 | User can authenticate plugins requiring OAuth via browser redirect flow proxied by the platform | VERIFIED | Full callback path now operational: session stores userId, getInstance returns valid instance, exchangeToken RPC fires, addCredential writes sentinel row, extension status promoted to active |
| OAUTH-02 | 05-01, 05-03 | OAuth tokens excluded from template export with `requiresReAuth` flag | VERIFIED | Export detection (oauthExtensionIds Set, requiresReAuth: true) and import handling (forced installed status) both implemented; the oauth_token sentinel row that feeds the detection is now correctly written by the fixed callback |
| OAUTH-03 | 05-02, 05-03 | User can configure SecretRef vault integration (1Password, HashiCorp Vault) | VERIFIED | Vault config CRUD endpoints exist; exec SecretRef generation in seedConfig; resolveEnv skips vault-backed env vars; VaultConfigSection UI; credential source toggle |

---

## Anti-Patterns Found

None. The previously-identified blocker (getInstance called with wrong userId) has been fixed. No new anti-patterns detected in the modified file.

---

## Human Verification Required

### 1. OAuth popup flow end-to-end

**Test:** On a running instance with an OAuth-supporting extension, open the credential panel and click the Connect button. Observe the popup, complete authorization, and check extension status.
**Expected:** Popup completes, extension transitions from installed to active, credential panel shows authenticated status, subsequent template export marks the extension with requiresReAuth=true.
**Why human:** Requires a running gateway supporting `auth.getOAuthUrl` and `auth.exchangeToken` RPC methods; postMessage cross-window behavior requires browser inspection.

### 2. Vault configuration and credential resolution

**Test:** Configure HashiCorp Vault in instance settings; then add a credential with "From vault" source using a vault path. Start the instance and verify the gateway receives exec SecretRef commands (not plaintext env vars).
**Expected:** Gateway container starts without AQUARIUM_CRED_xxx env vars for vault-backed creds; vault CLI commands appear in the gateway config.
**Why human:** Requires a running gateway container with vault CLI available; exec SecretRef behavior is observable only in container environment inspection.

---

## Gaps Summary

No gaps remain. The single root-cause bug identified in the initial verification has been resolved:

- `OAuthProxySession` now declares `userId: string` (line 22)
- Initiate handler stores `userId: req.auth!.userId` in the session object (line 87)
- Callback handler calls `getInstance(instanceId, session.userId)` (line 181)

With this fix, the entire OAuth callback path is code-verified: getInstance returns the correct instance, the `auth.exchangeToken` RPC call is reachable, the `oauth_token` sentinel credential row is written via addCredential, and the extension status DB update executes. All three requirements (OAUTH-01, OAUTH-02, OAUTH-03) are satisfied at the code level. Runtime behavior of the OAuth popup flow and vault SecretRef resolution still requires human confirmation.

---

_Verified: 2026-04-03_
_Verifier: Claude (gsd-verifier)_
