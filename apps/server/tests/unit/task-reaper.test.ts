import { test } from 'node:test';

/**
 * Phase 18-03 task-reaper tests — STUB (Wave 0 / Plan 18-01).
 *
 * Real assertions land in Plan 18-03:
 *   • Fake-clock reaper fails `dispatched > 5min` and `running > 2.5h` in one tick
 *   • Race: daemon wins → reaper UPDATE WHERE status='dispatched' matches 0 rows
 *   • Boot wiring: startTaskReaper / stopTaskReaper idempotent
 */

test.todo('reaper: dispatched > 5min flips to failed on next tick (TASK-04)');
test.todo('reaper: running > 2.5h flips to failed on next tick (TASK-04)');
test.todo('reaper: start/stop idempotent (TASK-04)');
