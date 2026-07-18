import type { DaemonToken } from '@aquarium/shared';

/**
 * Phase 25 Plan 25-03 — pure derivation of daemon-token status from its
 * server-projected lifecycle fields.
 *
 * Rules (from UI-SPEC §Per-daemon-token-status):
 *   - `revokedAt !== null`                         → 'revoked'  (priority over expiry)
 *   - `expiresAt !== null && expiresAt <= now`     → 'expired'
 *   - `expiresAt !== null && within 7 days of now` → 'expiring_soon'
 *   - otherwise                                    → 'active'
 *
 * Pure function — no side effects, no i18n. Consumers pass their own `now`
 * for testability. Used by `DaemonTokenList` to render the status badge
 * and drive the `data-token-status` attribute.
 */
export type DaemonTokenDerivedStatus =
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'revoked';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function deriveTokenStatus(
  token: DaemonToken,
  now: Date = new Date(),
): DaemonTokenDerivedStatus {
  if (token.revokedAt !== null) return 'revoked';
  if (token.expiresAt !== null) {
    const exp = new Date(token.expiresAt);
    if (!Number.isFinite(exp.getTime())) return 'active';
    const nowMs = now.getTime();
    if (exp.getTime() <= nowMs) return 'expired';
    if (exp.getTime() - nowMs <= SEVEN_DAYS_MS) return 'expiring_soon';
  }
  return 'active';
}
