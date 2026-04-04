# Phase 5: OAuth & Advanced Auth - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

OAuth browser proxy flow for plugins requiring OAuth authentication, OAuth token exclusion from template exports with `requiresReAuth` flag, and SecretRef vault integration UI (1Password, HashiCorp Vault). All decisions at Claude's discretion — user deferred all gray areas.

</domain>

<decisions>
## Implementation Decisions

### OAuth Proxy Flow (OAUTH-01)
- User clicks "Connect" or "Authenticate" button on a plugin that requires OAuth in the CredentialConfigPanel
- Aquarium server initiates the OAuth flow by proxying through the gateway's existing PKCE implementation
- The platform generates a unique state token, stores it in a temporary session, and redirects the user's browser to the OAuth provider's authorize endpoint
- After user authorizes, the callback hits Aquarium server (not the container's 127.0.0.1:1455 directly — the container isn't browser-accessible)
- Aquarium server relays the authorization code to the gateway via RPC for token exchange
- Gateway stores the OAuth tokens in `~/.openclaw/auth-profiles.json` (volume-dependent)
- Aquarium server updates the plugin's status to reflect successful OAuth connection
- Claude's Discretion: popup vs redirect approach, exact RPC method names, error handling for denied/expired authorizations

### Token Export Exclusion (OAUTH-02)
- Template export detects extensions with OAuth-type credentials (auth-profiles.json reference)
- These extensions are exported with `requiresReAuth: true` flag in their `TemplateExtensionDeclaration`
- On import, the UI shows a "Requires re-authentication" indicator on OAuth-backed extensions
- The extension is inserted with `installed` status (not `active`) so it doesn't load without auth
- Claude's Discretion: how to detect OAuth vs API-key credentials, indicator UI design

### SecretRef Vault Integration (OAUTH-03)
- New "Vault Configuration" section in instance settings (not in Extensions tab — vault is instance-wide)
- Supports two vault types: 1Password CLI (`op`) and HashiCorp Vault (`vault` CLI)
- User provides: vault type, vault address/account, authentication method (token, app role, CLI login)
- Configured vault is stored as `SecretRef` source config in instance settings
- When creating extension credentials, user can choose "From vault" as the source → enters the vault path/key instead of the raw secret
- seedConfig resolves vault references at startup via `exec` SecretRef type
- Claude's Discretion: vault configuration form layout, validation approach, error messaging for vault connectivity

### OAuth Durability (from PRD Phase 5 scope)
- OAuth tokens live in `~/.openclaw/auth-profiles.json` on container volume — NOT in Aquarium DB
- Restart: survives (volume persists)
- Rebuild: survives only if volume retained
- Template export: tokens excluded, `requiresReAuth` flag set
- This is an accepted weaker guarantee than API keys — documented in PRD resolved decision #20

### Claude's Discretion (all areas)
- OAuth popup vs full-page redirect
- OAuth RPC method names and handshake protocol
- Error handling for denied/expired/revoked OAuth authorizations
- SecretRef vault form layout and validation
- Vault connectivity testing UI
- How to detect OAuth vs API-key credential type
- "Requires re-authentication" indicator design
- Vault configuration storage model (instance settings table vs dedicated table)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `gateway-rpc.ts`: GatewayRPCClient — use for OAuth token exchange relay
- `extension-credentials.ts` route: extend with OAuth initiation endpoint
- `CredentialConfigPanel.tsx`: extend with "Connect with OAuth" button for OAuth-requiring extensions
- `template-store.ts`: `exportFromInstance` already handles `TemplateExtensionDeclaration` — extend with `requiresReAuth` flag
- `adapter.ts`: seedConfig already resolves credentials — extend with `exec` SecretRef resolution
- Existing `routes/oauth.ts`: may already have OAuth patterns for other purposes — check and reuse

### Established Patterns
- Plugin credential flow: CredentialConfigPanel → extension-credentials route → config.patch RPC
- Template export with state hints (needsCredentials, enabled, etc.) — extend with requiresReAuth
- Instance settings stored in instances table config JSON column

### Integration Points
- New `routes/oauth-proxy.ts` (or extend `oauth.ts`): OAuth initiation + callback endpoints
- `CredentialConfigPanel.tsx`: "Connect" button for OAuth, "From vault" option for SecretRef
- Instance settings: vault configuration stored alongside other instance config
- `adapter.ts` seedConfig: resolve `exec` SecretRef via vault CLI command

</code_context>

<specifics>
## Specific Ideas

- PRD reference: `docs/prd-plugin-skill-marketplace.md` — Phase 5 section, PRD resolved decision #20 (OAuth durability)
- OpenClaw's PKCE OAuth flow: `http://127.0.0.1:1455/auth/callback` — not browser-accessible from outside the container. Aquarium must proxy the callback.
- SecretRef `exec` source: `{ source: "exec", provider: "vault", id: "providers/openai/apiKey" }` — the gateway executes a command to resolve the secret at runtime

</specifics>

<deferred>
## Deferred Ideas

- DB-backed OAuth token persistence (Phase 7 potential) — currently volume-dependent
- Automatic OAuth token refresh management from Aquarium side

</deferred>

---

*Phase: 05-oauth-advanced-auth*
*Context gathered: 2026-04-04*
