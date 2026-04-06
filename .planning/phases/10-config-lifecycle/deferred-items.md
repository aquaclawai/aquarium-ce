# Phase 10: Deferred Items

## Pre-existing Issues (Out of Scope)

### 1. `updateSecurityProfile` still uses old adapter.translateRPC + `{ patch: {} }` fallback
- **File:** `apps/server/src/services/instance-manager.ts` line 412
- **Issue:** `updateSecurityProfile` still uses `adapter.translateRPC` for config.get/config.patch with old `{ patch: {} }` fallback format and `reseedConfigFiles` call
- **Noted in:** 10-CONTEXT.md decision "Eliminate from: (5) `updateSecurityProfile` for running instances"
- **Expected fix in:** Plan 10-02 or later call site cleanup
