# Phase 25 — Deferred Items

Out-of-scope issues encountered during plan execution. Tracked here so they
are not lost, but NOT fixed under Plan 25-00 per gsd-executor "SCOPE
BOUNDARY" rule (only fix issues DIRECTLY caused by current task changes).

## Plan 25-00

### Pre-existing lint error (Phase 24 file)

- **File:** `apps/web/src/components/issues/detail/ReconnectBanner.tsx:59:51`
- **Rule:** `error  Error: Cannot call impure function during render`
- **Origin commit:** `8ff7bb6 feat(24-03): ReconnectBanner + isConnected-driven resubscribe + __aquariumForceWsClose hook`
- **Plan 25-00 scope:** not touching this file; no edits by Plan 25-00 caused
  or could fix this.
- **Discovered during:** `npm run lint -w @aquarium/web` in Task 1 verify
  gate. ESLint exits 1 but the error is pre-existing Phase 24 code; the 28
  warnings (all `react-hooks/exhaustive-deps`) are also pre-existing.
- **Disposition:** Owner of Phase 24 / current maintainer should fix under a
  separate chore commit. Plan 25-00 verify gate proceeds because the
  failure is not regressable to Plan 25-00's diff.

## Notes

- CE build (`npm run build:ce -w @aquarium/web`) is green.
- `npm run typecheck -w @aquaclawai/aquarium` is green.
- i18n parity script is green (2231 keys across 6 locales).
