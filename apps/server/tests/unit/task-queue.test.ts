import { test } from 'node:test';

/**
 * Phase 18-01 task-queue lifecycle tests.
 *
 * Wave 0 stub: one `test.todo(...)` per requirement so the file exists and
 * `node --test` discovers it. The real assertions land in Task 4 of 18-01.
 */

test.todo('claim: single claim — BEGIN IMMEDIATE + NOT EXISTS subquery returns queued row exactly once (TASK-01)');
test.todo('claim: 20-concurrent — Promise.all of claimTask yields 1 dispatched per (issue, agent) pair (TASK-01 / SC-1)');
test.todo('lifecycle: dispatched → running → completed (TASK-02)');
test.todo('discard: completeTask on cancelled returns { discarded: true } without error (TASK-06)');
test.todo('discard: failTask on cancelled returns { discarded: true } without error (TASK-06)');
test.todo('cancelTask: cancel flips status and isTaskCancelled returns true (TASK-05 service surface)');
