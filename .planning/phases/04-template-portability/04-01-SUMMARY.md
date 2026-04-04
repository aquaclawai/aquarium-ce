---
phase: 04-template-portability
plan: "01"
subsystem: template
tags: [template, export, extensions, credentials, security, scrubbing]

# Dependency graph
requires:
  - phase: 01-skill-management
    provides: instance_skills table and ExtensionStatus lifecycle types
  - phase: 02-plugin-management
    provides: instance_plugins table and PluginSource lifecycle types
provides:
  - TemplateExtensionDeclaration type for serializing extension lifecycle state in templates
  - Extension lifecycle reads from instance_plugins/instance_skills in both export paths
  - OpenClaw config credential scrubbing (plugins.entries, skills.entries, providers)
  - Workspace file allowlist enforcement with skills/*/SKILL.md support
  - Secret scanning with [REDACTED] replacement in workspace files
  - Local skill rejection when scripts/ or assets/ directories present
affects:
  - 04-template-portability (import path, template consumers expecting extensions field)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Export-time credential scrubbing using SENSITIVE_PATTERNS regex matching
    - Extension lifecycle state encoded as enabled/needsCredentials hints
    - Legacy fallback to plugin_dependencies when lifecycle tables are empty

key-files:
  created: []
  modified:
    - packages/shared/src/types.ts
    - apps/server/src/services/template-store.ts
    - apps/server/src/agent-types/openclaw/reverse-adapter.ts
    - apps/server/src/services/template-file-format.ts

key-decisions:
  - "SecurityWarning type extended with 'redacted_secret' variant — workspace secrets use different type than hardcoded key warnings"
  - "scrubOpenclawConfigCredentials() extracted as standalone helper at bottom of reverse-adapter.ts — reusable and testable separately from reverseAdaptFromContainer"
  - "Legacy fallback reads plugin_dependencies from template_contents (not instance config) when lifecycle tables empty"
  - "SENSITIVE_PATTERNS and maskValue exported from reverse-adapter.ts — template-store.ts keeps its own local copies to avoid circular imports"
  - "Workspace skills/*/SKILL.md files read through skillDirsForCheck loop — only SKILL.md files exported, not scripts or assets"

patterns-established:
  - "Extension lifecycle mapping: active=enabled/noCredNeeded, installed=enabled/needsCredentials, disabled=disabled/noCredNeeded, degraded=enabled/noCredNeeded"
  - "Credential scrubbing placeholder format: ${CREDENTIAL:<entityId>:<fieldName>}"
  - "Fail-fast pattern for local skill rejection: check before reading any workspace files"

requirements-completed: [TMPL-01, TMPL-02, TMPL-03, TMPL-04, TMPL-05]

# Metrics
duration: 15min
completed: 2026-04-04
---

# Phase 4 Plan 01: Template Portability Export Summary

**Template export now captures extension lifecycle from DB tables, scrubs OpenClaw config credentials with ${CREDENTIAL:...} placeholders, enforces workspace allowlist with secrets redacted, and rejects local skills containing executable scripts**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-04T05:00:00Z
- **Completed:** 2026-04-04T05:02:25Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `TemplateExtensionDeclaration` type to shared types with kind, source, lifecycle hints (enabled/needsCredentials), lockedVersion, and integrityHash
- Extended both export paths (DB-only and live container) to read `instance_plugins`/`instance_skills` tables and produce `extensions` array in template content
- Added credential scrubbing for `plugins.entries.*.config`, `skills.entries.*`, and `providers.*` namespace in OpenClaw config
- Replaced warning-only workspace file scanning with active `[REDACTED]` replacement using new `redacted_secret` SecurityWarning type
- Added local skill rejection: export fails with clear error if `scripts/` or `assets/` directories found in any workspace skill
- Updated `WORKSPACE_ALLOWLIST` to include `USER.md` and added `skills/*/SKILL.md` enumeration
- Template file format updated to read/write `extensions` field in `template.json`

## Task Commits

1. **Task 1: Shared types + DB-only export path** - `3afe192` (feat)
2. **Task 2: Live container export path** - `057b273` (feat)

## Files Created/Modified
- `packages/shared/src/types.ts` - Added `TemplateExtensionDeclaration` interface and `extensions` field to `ExportTemplateResponse.content`; extended `SecurityWarning.type` to include `'redacted_secret'`
- `apps/server/src/services/template-store.ts` - DB-only export: reads extension lifecycle tables, maps rows to `TemplateExtensionDeclaration[]`, scrubs OpenClaw config credentials, legacy fallback to `plugin_dependencies`
- `apps/server/src/agent-types/openclaw/reverse-adapter.ts` - Exported `SENSITIVE_PATTERNS` and `maskValue`; replaced allowlist with `WORKSPACE_ALLOWLIST`; added local skill rejection; changed secret scanning to redaction; reads lifecycle tables; added `scrubOpenclawConfigCredentials()` helper
- `apps/server/src/services/template-file-format.ts` - Added `extensions` field to `TemplateJsonSchema`, `ParsedOctemplate.content`, reads/writes extensions in `generateOctemplate`/`parseOctemplate`

## Decisions Made
- `SecurityWarning.type` extended with `'redacted_secret'` rather than overloading `'possible_hardcoded_key'` — redacted secrets in workspace files are a different category (already fixed) from config warnings (advisory)
- `scrubOpenclawConfigCredentials()` extracted as a standalone function rather than inlining into `reverseAdaptFromContainer` — keeps the main function readable and makes the scrubbing logic reusable
- `SENSITIVE_PATTERNS` exported from `reverse-adapter.ts` but `template-store.ts` keeps its own local copy — avoids a potential circular import between the two service-layer files
- Legacy fallback reads `template_contents.plugin_dependencies` (not raw instance config) for pre-migration instances — the template content is the authoritative source for what was originally installed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both export paths produce `extensions` arrays ready for template import/instantiation
- Config credential placeholders ready for resolution during `instantiateTemplate`
- Workspace file allowlist and secret redaction reduce risk of accidental secret leakage in published templates

---
*Phase: 04-template-portability*
*Completed: 2026-04-04*
