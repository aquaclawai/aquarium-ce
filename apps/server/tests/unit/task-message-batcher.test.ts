import { test } from 'node:test';

/**
 * Phase 18-02 task-message-batcher tests — STUB (Wave 0 / Plan 18-01).
 *
 * Real assertions land in Plan 18-02:
 *   • Monotonic seq=1..N under 500-message interleave across multiple tasks
 *   • 500 ms flush cadence
 *   • MAX(seq)+1 under BEGIN IMMEDIATE — UNIQUE(task_id, seq) backstop never fires
 */

test.todo('batcher: 500 messages from 20 appenders produce strictly monotonic seq 1..500 per task (TASK-03)');
test.todo('batcher: per-task buffer flushes at 500ms interval (TASK-03)');
test.todo('batcher: MAX(seq)+1 inside BEGIN IMMEDIATE is race-free (TASK-03 / SQ2)');
