# Phase 6: Offline Resilience - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Plugin artifact caching after first successful install, and cache-preferred artifact resolution on restart/rebuild. Two requirements only: OFFLINE-01 (cache on install) and OFFLINE-02 (prefer cache on restart). All decisions at Claude's discretion.

</domain>

<decisions>
## Implementation Decisions

### Artifact Cache (OFFLINE-01)
- Cache location: `~/.openclaw/plugin-cache/` on the container volume (already volume-mounted)
- After a successful `npm install` or `openclaw skills install`, copy/move the artifact tarball to the cache directory
- Cache key: `<source-type>/<package-name>/<locked-version>.tgz` (e.g., `npm/@openclaw-voice-call/1.3.2.tgz`)
- Both plugin and skill artifacts are cached (not just plugins despite the requirement name)
- Claude's Discretion: exact caching mechanism (npm pack after install, copy from npm cache, or download tarball separately)

### Cache-Preferred Resolution (OFFLINE-02)
- On restart/rebuild, Phase 3 pending replay checks cache before hitting registry
- If cached artifact exists for the `lockedVersion`: install from local tarball (`npm install ./path/to/cached.tgz`)
- If cache miss: fall back to registry as before (existing behavior)
- If registry also unavailable: extension goes to `degraded` (existing behavior from Phase 1)
- Dashboard indicator: show "cached" vs "registry" source on installed extensions (in configure panel)
- Claude's Discretion: cache validation (check hash on read?), cache cleanup policy (never auto-delete? size limit?)

### PRD Reference
- §11.3 describes the cache as a "future consideration" — this phase implements it
- The lifecycle model already supports `degraded` state for failed reinstalls — cache reduces the probability of hitting that path

### Claude's Discretion (all areas)
- Exact caching mechanism (npm pack, npm cache copy, separate download)
- Cache directory structure within `~/.openclaw/plugin-cache/`
- Whether to validate cached artifacts against `integrityHash` on read
- Cache cleanup/eviction policy
- Dashboard "cached" indicator design
- Skill artifact caching approach (skills install differently than npm packages)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `skill-store.ts` / `plugin-store.ts`: install flows — extend with cache-after-install step
- `extension-lifecycle.ts`: `replayPendingExtensions` — extend with cache-preferred resolution
- `adapter.ts`: seedConfig — no changes needed (cache is at install time, not config time)
- `CredentialConfigPanel.tsx`: configure panel — extend with "cached" indicator

### Established Patterns
- Install flows already store `lockedVersion` + `integrityHash` — cache key derivable from these
- `replayPendingExtensions` already calls `installSkill`/`installPlugin` — add cache check before registry call
- Container volume at `~/.openclaw/` is already persistent across restarts

### Integration Points
- `skill-store.ts` `installSkill`: after successful install, cache the artifact
- `plugin-store.ts` `installPlugin`: after successful install, cache the artifact
- `extension-lifecycle.ts` `replayPendingExtensions`: check cache before registry
- `CredentialConfigPanel.tsx`: show "Cached locally" indicator if artifact is cached

</code_context>

<specifics>
## Specific Ideas

- PRD reference: `docs/prd-plugin-skill-marketplace.md` — §11.3 (offline resilience)
- The cache should be created lazily — first install caches, subsequent restarts use cache
- Cache miss is a soft failure — falls back to registry, not an error

</specifics>

<deferred>
## Deferred Ideas

None — this is the final phase

</deferred>

---

*Phase: 06-offline-resilience*
*Context gathered: 2026-04-04*
