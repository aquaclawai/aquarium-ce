import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIsoUtc } from '../../src/db/timestamps.js';

/**
 * Regression: SQLite's `db.fn.now()` writes naive `YYYY-MM-DD HH:MM:SS`
 * strings (UTC, no timezone suffix). Serializers that piped those
 * straight to `String(row.created_at)` produced a response that the
 * browser parsed as LOCAL time — so a freshly-created agent showed up
 * as "2h ago" on a UTC+2 machine. `toIsoUtc` normalises to unambiguous
 * UTC with the `Z` suffix.
 */

test('toIsoUtc converts SQLite space-separated naive timestamp to ISO UTC', () => {
  assert.equal(toIsoUtc('2026-04-17 09:49:13'), '2026-04-17T09:49:13Z');
});

test('toIsoUtc preserves fractional seconds when present', () => {
  assert.equal(toIsoUtc('2026-04-17 09:49:13.456'), '2026-04-17T09:49:13.456Z');
});

test('toIsoUtc passes through existing ISO-with-Z values', () => {
  assert.equal(toIsoUtc('2026-04-17T09:49:13Z'), '2026-04-17T09:49:13Z');
});

test('toIsoUtc passes through ISO with explicit +hh:mm offset', () => {
  assert.equal(toIsoUtc('2026-04-17T09:49:13+02:00'), '2026-04-17T09:49:13+02:00');
});

test('toIsoUtc converts Date instances (Postgres driver path) to ISO', () => {
  const d = new Date('2026-04-17T09:49:13.000Z');
  assert.equal(toIsoUtc(d), '2026-04-17T09:49:13.000Z');
});

test('toIsoUtc falls back to String() for unknown shapes (no silent mutation)', () => {
  // Millisecond epoch coerced via Number.toString — we don't try to be clever.
  assert.equal(toIsoUtc(1776531103735), '1776531103735');
});

test('toIsoUtc returns empty string for null/undefined (serializer guards above)', () => {
  assert.equal(toIsoUtc(null), '');
  assert.equal(toIsoUtc(undefined), '');
});
