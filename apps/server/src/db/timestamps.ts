/**
 * SQLite stores timestamps as naive `YYYY-MM-DD HH:MM:SS` strings (UTC
 * per `db.fn.now()` under the CE Sqlite adapter, no timezone suffix).
 * When the client does `new Date(raw)` on that format, browsers parse it
 * as **local time** — producing a wall-clock that drifts by the local
 * timezone offset. Serializers must normalise to ISO-8601 with an
 * explicit `Z` suffix so clients interpret it as UTC unambiguously.
 *
 * Postgres returns Date objects (or ISO strings with timezone); the
 * helper is a no-op on those. The only concrete fixup is for raw SQLite
 * rows.
 *
 * This function is intentionally tolerant of unknown input shapes so
 * every serializer can pipe `row.created_at` through it without first
 * having to type-narrow.
 */
export function toIsoUtc(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const s = String(value ?? '');
  // Already ISO with a timezone suffix (…Z or +hh:mm) — leave it alone.
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  // SQLite 'YYYY-MM-DD HH:MM:SS' — insert the T separator and append Z.
  const match = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
  if (match) return `${match[1]}T${match[2]}Z`;
  // Unknown shape (e.g. already-ISO without TZ, or a milliseconds-epoch
  // number coerced to string). Let the client's Date parser decide; we
  // don't want to swallow a real bug by silently mutating the string.
  return s;
}
